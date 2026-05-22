export const config = { runtime: 'edge' };

// ════════════════════════════════════════════════════════════════════
// api/sofia-digitar-finanto.js
//
// Recebe { convData, oportunidade } da Sofia (api/agent.js) e digita a
// proposta na FINANTO (plataforma Ajin) — INSS Novo (op 1) e Port+Refin
// (op 4). Retorna { simulationId, signatureUrl, status, ... } pra Sofia
// mandar o link de assinatura pro cliente no WhatsApp.
//
// Auth: aceita Bearer (sessão do FlowForce) OU x-internal-secret
// (WEBHOOK_SECRET — usado quando chamado pelo agent.js internamente).
// ════════════════════════════════════════════════════════════════════

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';
import { dbInsert, dbSelect, dbUpdate } from './_lib/supabase.js';

const AJIN_BASE = () => (process.env.FINANTO_URL || 'https://api.ajin.io').trim().replace(/\/+$/, '');
const AJIN_KEY = () => (process.env.FINANTO_KEY || '').trim();

// Type codes / operation codes Ajin
const TYPE_INSS = 20;
const OP_NOVO = 1;
const OP_PORTABILIDADE = 3;
const OP_PORT_REFIN = 4;

// ── Cliente HTTP Ajin ────────────────────────────────────────────────
async function ajin(method, path, body) {
  const key = AJIN_KEY();
  if (!key) throw new Error('FINANTO_KEY nao configurado');
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'apikey': key,
    },
  };
  if (body !== undefined && body !== null && method !== 'GET') {
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(AJIN_BASE() + path, opts);
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 2000) }; }
  return { ok: r.ok, status: r.status, data: d };
}

// ── Helpers ──────────────────────────────────────────────────────────

// Parse brasileiro "1.234,56" → 1234.56
function parseBR(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v).trim().replace(/R\$\s*/g, '').replace(/\s/g, '');
  if (!s) return 0;
  if (s.indexOf(',') >= 0) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
  return parseFloat(s) || 0;
}

// CPF apenas dígitos
function onlyDigits(s) { return String(s || '').replace(/\D/g, ''); }

// Data: "12/03/1958" → "1958-03-12"; aceita ISO direto
function toIsoDate(s) {
  if (!s) return null;
  const t = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.substring(0, 10);
  const m = t.match(/^(\d{2})[/\-](\d{2})[/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

// Mapeamento de banco origem (código 3 dígitos do Multicorban → lenderCode Ajin)
// Por padrão, Ajin aceita o mesmo código numérico FEBRABAN. Tira leading zero.
function banco3ToLenderCode(cod) {
  const c = String(cod || '').replace(/\D/g, '');
  if (!c) return null;
  return parseInt(c, 10);
}

// ── Constrói borrower (cliente) a partir de conv.data da Sofia ──────
function buildBorrower(d) {
  const cpf = onlyDigits(d.cpf);
  const nome = d.nome_completo || d.nome || '';
  if (!cpf || cpf.length !== 11) throw new Error('CPF invalido');
  if (!nome) throw new Error('Nome obrigatorio');

  const borrower = {
    name: nome,
    identity: cpf,
  };
  const birth = toIsoDate(d.data_nascimento);
  if (birth) borrower.birthDate = birth;
  if (d.beneficio) borrower.benefit = String(d.beneficio).replace(/\D/g, '');
  if (d.nome_mae) borrower.motherName = d.nome_mae;
  if (d.email) borrower.email = d.email;
  if (d.sexo) borrower.gender = d.sexo === 'F' ? 'F' : 'M';
  if (d.especie) borrower.benefitType = { code: parseInt(String(d.especie).replace(/\D/g, ''), 10) || undefined };

  // Endereço
  if (d.cep || d.endereco) {
    borrower.address = {
      zipCode: onlyDigits(d.cep) || undefined,
      street: d.endereco || undefined,
      number: d.numero_end || undefined,
      complement: d.complemento || undefined,
      neighborhood: d.bairro || undefined,
      city: d.cidade || undefined,
      state: d.uf || undefined,
    };
  }

  // RG / documento
  if (d.rg_numero) {
    borrower.document = {
      type: 'rg',
      number: String(d.rg_numero),
      issuer: d.rg_orgao || 'SSP',
      issuerState: d.rg_uf || d.uf || undefined,
      issueDate: toIsoDate(d.rg_data) || undefined,
    };
  }

  // Telefones
  if (d.telefone) {
    const tel = onlyDigits(d.telefone);
    if (tel.length >= 10) {
      const ddd = tel.length === 13 ? tel.substring(2, 4) : tel.substring(0, 2);
      const num = tel.length === 13 ? tel.substring(4) : tel.substring(2);
      borrower.phones = [{ ddd, number: num }];
    }
  }

  return borrower;
}

// ── Constrói creditBankAccount (conta de depósito) ──────────────────
function buildCreditBankAccount(d) {
  if (!d.banco_deposito && !d.agencia && !d.conta) return null;
  return {
    bankCode: String(d.banco_deposito || '').replace(/\D/g, '') || undefined,
    agencyNumber: String(d.agencia || '').replace(/\D/g, '') || undefined,
    accountNumber: String(d.conta || '').replace(/\D/g, '') || undefined,
    accountDigit: d.conta_digito || undefined,
    accountType: (d.tipo_conta || '').toLowerCase().includes('pou') ? 'savings' : 'checking',
  };
}

// ── Lista regras FINANTO/QITech compatíveis pra (type, operation) ───
async function pickRule({ type, operation, prazoDesejado, lenderCode }) {
  const r = await ajin('POST', '/v3/loan-product-rules/search/basic', {
    type: { code: { eq: type } },
    operation: { code: { eq: operation } },
    offset: 0,
    limit: 50,
  });
  if (!r.ok) return { ok: false, error: 'Falha ao listar regras: HTTP ' + r.status, raw: r.data };
  const items = r.data?.items || [];
  if (!items.length) return { ok: false, error: 'Nenhuma regra disponivel para op=' + operation };

  // Filtra por prazo se vier
  let candidatas = items;
  if (prazoDesejado) {
    candidatas = items.filter((it) => {
      const min = it.term?.min ?? 0;
      const max = it.term?.max ?? 999;
      return prazoDesejado >= min && prazoDesejado <= max;
    });
    if (!candidatas.length) candidatas = items; // fallback
  }

  // Preferir QI Tech (329) se vier no nome/lender (default FINANTO)
  const prefQI = candidatas.find((it) =>
    /qi.?tech|qitech|329/i.test(JSON.stringify({ name: it.name, lender: it.lender, product: it.product })),
  );
  return { ok: true, rule: prefQI || candidatas[0], allCount: candidatas.length };
}

// ── Loga evento na conversa (pra UI mostrar) ────────────────────────
async function logEvent(telefone, tipo, detalhes) {
  try {
    await dbInsert('inss_conversas_eventos', {
      telefone: onlyDigits(telefone) || telefone || '',
      tipo,
      detalhes,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[sofia-digitar-finanto] logEvent erro:', e?.message);
  }
}

// Grava status da proposta na conversa (campo proposta_finanto jsonb)
async function patchConversa(telefone, patch) {
  try {
    const numClean = onlyDigits(telefone);
    if (!numClean) return;
    const { data: c } = await dbSelect('inss_conversas', { filters: { telefone: numClean }, single: true });
    if (!c) return;
    const existing = c.proposta_finanto || {};
    await dbUpdate('inss_conversas', { id: c.id }, {
      proposta_finanto: { ...existing, ...patch, updated_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[sofia-digitar-finanto] patchConversa erro:', e?.message);
  }
}

// ════════════════════════════════════════════════════════════════════
// FLUXO PRINCIPAL — INSS NOVO (operation 1)
// ════════════════════════════════════════════════════════════════════
async function digitarInssNovo({ convData, oportunidade, telefone }) {
  const trace = [];
  const trc = (step, info) => trace.push({ step, ts: Date.now(), ...info });

  const borrower = buildBorrower(convData);
  const creditBankAccount = buildCreditBankAccount(convData);

  // 1) Escolhe regra (FINANTO/QITech, INSS, operação 1)
  trc('pickRule.start', { type: TYPE_INSS, operation: OP_NOVO, prazo: oportunidade?.prazo });
  const pr = await pickRule({ type: TYPE_INSS, operation: OP_NOVO, prazoDesejado: oportunidade?.prazo || 108 });
  if (!pr.ok) return { success: false, step: 'pickRule', error: pr.error, trace };
  const rule = pr.rule;
  trc('pickRule.ok', { ruleId: rule?.id, ruleName: rule?.name });

  // 2) Calcula (rate, term, parcela, loanValue)
  const term = oportunidade?.prazo || 108;
  const rate = oportunidade?.taxa || rule?.rate || 1.85;
  const installmentValue = Math.round(Number(oportunidade?.novaParc || 0) * 100) / 100;
  const loanValue = Math.round(Number(oportunidade?.valor || 0) * 100) / 100;

  trc('calculate.start', { ruleId: rule.id, term, rate, installmentValue, loanValue });
  const calc = await ajin('POST', '/v3/loan-inss-simulations/calculation', {
    ruleId: rule.id,
    term,
    rate,
    installmentValue: installmentValue || undefined,
    loanValue: loanValue || undefined,
    hasInsurance: false,
  });
  if (!calc.ok) {
    trc('calculate.fail', { status: calc.status, error: calc.data?.title || calc.data?.detail });
    return { success: false, step: 'calculate', error: calc.data?.title || calc.data?.detail || 'Falha no calculo', trace, raw: calc.data };
  }
  const calculated = calc.data;
  trc('calculate.ok', { netValue: calculated.netValue, loanValue: calculated.loanValue });

  // 3) Cria simulação (proposta em rascunho)
  const item = {
    ruleId: rule.id,
    term: calculated.term || term,
    rate: calculated.rate || rate,
    loanValue: calculated.loanValue || loanValue,
    installmentValue: calculated.installmentValue || installmentValue,
    netValue: calculated.netValue,
    hasInsurance: false,
  };
  trc('createProposal.start');
  const sim = await ajin('POST', '/v3/loan-inss-simulations', {
    borrower,
    items: [item],
    creditBankAccount,
    step: { code: 0, name: null },
    note: 'Digitada via Sofia (FlowForce)',
  });
  if (!sim.ok || !sim.data?.id) {
    trc('createProposal.fail', { status: sim.status, error: sim.data?.title || sim.data?.detail });
    return { success: false, step: 'createProposal', error: sim.data?.title || sim.data?.detail || 'Falha ao criar simulacao', trace, raw: sim.data };
  }
  const simulationId = sim.data.id;
  const simCode = sim.data.code;
  trc('createProposal.ok', { simulationId, simCode });
  await patchConversa(telefone, { simulationId, code: simCode, type: 'novo', status: 'rascunho' });

  // 4) Auth-term INSS/DATAPREV
  trc('getAuthTerm.start');
  const authR = await ajin('GET', `/v3/loan-inss-simulations/${simulationId}/auth-term`);
  if (!authR.ok || !authR.data?.key) {
    trc('getAuthTerm.fail', { status: authR.status });
    return { success: false, step: 'getAuthTerm', simulationId, error: 'Falha ao gerar termo INSS', trace, raw: authR.data };
  }
  const authTermKey = authR.data.key;
  const jaAssinado = authR.data?.status?.key === 'signed';
  trc('getAuthTerm.ok', { authTermKey, jaAssinado });

  // 5) Assina termo (opt-in automático — Lhamas é correspondente)
  if (!jaAssinado) {
    trc('signTerm.start');
    const signR = await ajin('PUT', `/v3/signer/${authTermKey}/accept`, {
      position: { latitude: '-235489', longitude: '-466388' },
    });
    if (!signR.ok || signR.data?.status?.key !== 'signed') {
      trc('signTerm.fail', { status: signR.status });
      return { success: false, step: 'signTerm', simulationId, error: 'Falha ao assinar termo INSS', trace, raw: signR.data };
    }
    trc('signTerm.ok');
  }

  // 6) Gera contratos (cria Loan)
  trc('generateContracts.start');
  const gen = await ajin('POST', `/v3/loan-inss-simulations/${simulationId}/actions`, { command: 'create_loans' });
  if (!gen.ok) {
    trc('generateContracts.fail', { status: gen.status, error: gen.data?.title || gen.data?.detail });
    return { success: false, step: 'generateContracts', simulationId, error: gen.data?.title || gen.data?.detail || 'Falha ao gerar contratos', trace, raw: gen.data };
  }
  trc('generateContracts.ok');

  // 7) Pega URL da assinatura
  const signature = gen.data?.signature || sim.data?.signature || null;
  const signatureUrl = signature?.url || null;
  const items = gen.data?.items || sim.data?.items || [];

  await patchConversa(telefone, {
    simulationId,
    code: simCode,
    type: 'novo',
    status: 'gerado',
    signatureUrl,
    rate,
    term,
    loanValue: calculated.loanValue || loanValue,
    netValue: calculated.netValue,
    installmentValue: calculated.installmentValue || installmentValue,
  });
  await logEvent(telefone, 'finanto_digitada', {
    simulationId, code: simCode, type: 'novo', signatureUrl,
    loanValue, installmentValue, term, rate,
  });

  return {
    success: true,
    type: 'novo',
    simulationId,
    code: simCode,
    signatureUrl,
    loanValue: calculated.loanValue || loanValue,
    netValue: calculated.netValue,
    installmentValue: calculated.installmentValue || installmentValue,
    term,
    rate,
    items,
    trace,
  };
}

// ════════════════════════════════════════════════════════════════════
// FLUXO PRINCIPAL — INSS PORT+REFIN (operation 4)
// ════════════════════════════════════════════════════════════════════
async function digitarInssPortRefin({ convData, oportunidade, telefone }) {
  const trace = [];
  const trc = (step, info) => trace.push({ step, ts: Date.now(), ...info });

  const borrower = buildBorrower(convData);
  const creditBankAccount = buildCreditBankAccount(convData);

  // Dados do contrato origem (obrigatórios pra port+refin)
  const origem = oportunidade?.origem || {};
  const lenderCode = banco3ToLenderCode(origem.cod || origem.codigo || origem.banco_codigo);
  if (!lenderCode) {
    return { success: false, step: 'validate', error: 'Banco origem (lenderCode) ausente na oportunidade' };
  }
  if (!origem.contrato) {
    return { success: false, step: 'validate', error: 'Numero do contrato origem ausente' };
  }

  const originContract = {
    lenderCode,
    contractNumber: String(origem.contrato),
    term: origem.prazoTotal || origem.prazo_total || undefined,
    installmentsRemaining: origem.prazoRestante || origem.prazo_restante || undefined,
    installmentValue: parseBR(origem.parcela),
    dueBalanceValue: parseBR(origem.saldo),
  };
  trc('originContract', originContract);

  // 1) Escolhe regra (FINANTO/QITech, INSS, operação 4 Port+Refin)
  trc('pickRule.start', { type: TYPE_INSS, operation: OP_PORT_REFIN, prazo: oportunidade?.prazo });
  let pr = await pickRule({ type: TYPE_INSS, operation: OP_PORT_REFIN, prazoDesejado: oportunidade?.prazo || 108 });
  // Fallback: tenta op=3 (portabilidade pura) se não tem op=4 disponível
  if (!pr.ok) {
    trc('pickRule.fallbackOp3');
    pr = await pickRule({ type: TYPE_INSS, operation: OP_PORTABILIDADE, prazoDesejado: oportunidade?.prazo || 108 });
  }
  if (!pr.ok) return { success: false, step: 'pickRule', error: pr.error, trace };
  const rule = pr.rule;
  trc('pickRule.ok', { ruleId: rule.id, ruleName: rule.name });

  // 2) Calcula com originContract
  const term = oportunidade?.prazo || 108;
  const rate = oportunidade?.taxa || rule?.rate || 1.85;
  const installmentValue = Math.round(Number(oportunidade?.novaParc || 0) * 100) / 100;
  const loanValue = Math.round(Number(oportunidade?.valor || oportunidade?.troco || 0) * 100) / 100;

  trc('calculate.start', { ruleId: rule.id, term, rate, installmentValue, loanValue, originContract });
  const calc = await ajin('POST', '/v3/loan-inss-simulations/calculation', {
    ruleId: rule.id,
    term,
    rate,
    installmentValue: installmentValue || undefined,
    loanValue: loanValue || undefined,
    hasInsurance: false,
    originContract,
  });
  if (!calc.ok) {
    trc('calculate.fail', { status: calc.status, error: calc.data?.title || calc.data?.detail });
    return { success: false, step: 'calculate', error: calc.data?.title || calc.data?.detail || 'Falha no calculo', trace, raw: calc.data };
  }
  const calculated = calc.data;
  trc('calculate.ok', { netValue: calculated.netValue, loanValue: calculated.loanValue });

  // 3) Cria simulação
  const item = {
    ruleId: rule.id,
    term: calculated.term || term,
    rate: calculated.rate || rate,
    loanValue: calculated.loanValue || loanValue,
    installmentValue: calculated.installmentValue || installmentValue,
    netValue: calculated.netValue,
    hasInsurance: false,
    originContract,
  };
  trc('createProposal.start');
  const sim = await ajin('POST', '/v3/loan-inss-simulations', {
    borrower,
    items: [item],
    creditBankAccount,
    step: { code: 0, name: null },
    note: 'Port+Refin digitada via Sofia (FlowForce)',
  });
  if (!sim.ok || !sim.data?.id) {
    trc('createProposal.fail', { status: sim.status, error: sim.data?.title || sim.data?.detail });
    return { success: false, step: 'createProposal', error: sim.data?.title || sim.data?.detail || 'Falha ao criar simulacao', trace, raw: sim.data };
  }
  const simulationId = sim.data.id;
  const simCode = sim.data.code;
  trc('createProposal.ok', { simulationId, simCode });
  await patchConversa(telefone, { simulationId, code: simCode, type: 'port_refin', status: 'rascunho' });

  // 4) Auth-term INSS/DATAPREV
  trc('getAuthTerm.start');
  const authR = await ajin('GET', `/v3/loan-inss-simulations/${simulationId}/auth-term`);
  if (!authR.ok || !authR.data?.key) {
    trc('getAuthTerm.fail');
    return { success: false, step: 'getAuthTerm', simulationId, error: 'Falha ao gerar termo INSS', trace, raw: authR.data };
  }
  const authTermKey = authR.data.key;
  const jaAssinado = authR.data?.status?.key === 'signed';
  trc('getAuthTerm.ok', { authTermKey, jaAssinado });

  // 5) Assina termo
  if (!jaAssinado) {
    trc('signTerm.start');
    const signR = await ajin('PUT', `/v3/signer/${authTermKey}/accept`, {
      position: { latitude: '-235489', longitude: '-466388' },
    });
    if (!signR.ok || signR.data?.status?.key !== 'signed') {
      trc('signTerm.fail');
      return { success: false, step: 'signTerm', simulationId, error: 'Falha ao assinar termo INSS', trace, raw: signR.data };
    }
    trc('signTerm.ok');
  }

  // 6) Gera Loans (port + refin → costumam ser 2 contratos)
  trc('generateContracts.start');
  const gen = await ajin('POST', `/v3/loan-inss-simulations/${simulationId}/actions`, { command: 'create_loans' });
  if (!gen.ok) {
    trc('generateContracts.fail', { status: gen.status, error: gen.data?.title || gen.data?.detail });
    return { success: false, step: 'generateContracts', simulationId, error: gen.data?.title || gen.data?.detail || 'Falha ao gerar contratos', trace, raw: gen.data };
  }
  trc('generateContracts.ok');

  const signature = gen.data?.signature || sim.data?.signature || null;
  const signatureUrl = signature?.url || null;
  const items = gen.data?.items || sim.data?.items || [];

  await patchConversa(telefone, {
    simulationId,
    code: simCode,
    type: 'port_refin',
    status: 'gerado',
    signatureUrl,
    rate,
    term,
    loanValue: calculated.loanValue || loanValue,
    installmentValue: calculated.installmentValue || installmentValue,
    troco: oportunidade?.troco,
    reducao: oportunidade?.reducao,
    bancoOrigem: origem.banco || origem.cod,
    contratoOrigem: origem.contrato,
  });
  await logEvent(telefone, 'finanto_digitada', {
    simulationId, code: simCode, type: 'port_refin', signatureUrl,
    loanValue, installmentValue, term, rate,
    bancoOrigem: origem.banco, contratoOrigem: origem.contrato,
    troco: oportunidade?.troco, reducao: oportunidade?.reducao,
  });

  return {
    success: true,
    type: 'port_refin',
    simulationId,
    code: simCode,
    signatureUrl,
    loanValue: calculated.loanValue || loanValue,
    netValue: calculated.netValue,
    installmentValue: calculated.installmentValue || installmentValue,
    term,
    rate,
    troco: oportunidade?.troco,
    reducao: oportunidade?.reducao,
    items,
    trace,
  };
}

// ════════════════════════════════════════════════════════════════════
// HANDLER
// ════════════════════════════════════════════════════════════════════
export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  try {
    const body = req.method === 'POST' ? await req.json() : {};
    const action = body.action || 'digitar';

    if (action === 'digitar') {
      const convData = body.convData || {};
      const oportunidade = body.oportunidade || null;
      const telefone = body.telefone || convData.telefone || '';

      if (!oportunidade) return jsonError('oportunidade obrigatoria', 400, req);
      if (!oportunidade.tipo) return jsonError('oportunidade.tipo obrigatorio (emprestimo_novo | portabilidade)', 400, req);

      const tipo = oportunidade.tipo;
      let result;
      if (tipo === 'emprestimo_novo' || tipo === 'novo') {
        result = await digitarInssNovo({ convData, oportunidade, telefone });
      } else if (tipo === 'portabilidade' || tipo === 'port_refin' || tipo === 'port') {
        result = await digitarInssPortRefin({ convData, oportunidade, telefone });
      } else {
        return jsonError(`Tipo de oportunidade nao suportado: ${tipo} (use 'emprestimo_novo' ou 'portabilidade')`, 400, req);
      }
      return jsonResp(result, result.success ? 200 : 500, req);
    }

    if (action === 'status') {
      // Consulta status atual da proposta na FINANTO (refresh)
      if (!body.simulationId) return jsonError('simulationId obrigatorio', 400, req);
      const r = await ajin('GET', `/v3/loan-inss-simulations/${body.simulationId}`);
      return jsonResp({ success: r.ok, ...r.data }, r.ok ? 200 : 500, req);
    }

    return jsonError('action invalida (use: digitar | status)', 400, req);
  } catch (err) {
    console.error('[sofia-digitar-finanto] erro:', err?.message, err?.stack);
    return jsonResp({
      success: false,
      error: err?.message || 'Erro interno',
      stack: (err?.stack || '').substring(0, 500),
    }, 500, req);
  }
}
