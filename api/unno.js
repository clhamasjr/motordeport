// ══════════════════════════════════════════════════════════════════
// api/unno.js — Unno Tech: Consignado CLT (fluxo C6-like)
//
// ENDPOINTS REAIS DESCOBERTOS (via engenharia reversa do app deles):
//   POST  /auth/api/v1/terms                    → cria termo + retorna link
//   GET   /auth/api/v1/terms/latest/{uuid}      → status do termo (PENDING/AGREED)
//   GET   /proposal/api/v1/proposals?productType=CONSIGNADO_CLT → propostas
//   POST  /proposal/api/v1/proposals/{uuid}/cancel → cancela
//
// FLUXO OPERACIONAL (modelo C6 no motor V2):
//   1. Operador consulta CPF no V2
//   2. Motor chama action 'iniciarSimulacao' → POST /auth/api/v1/terms
//      → recebe { uuid, link }
//   3. Card no V2 mostra "Aguarda autorização" + botão WhatsApp
//   4. Operador envia link ao cliente via WhatsApp (manual ou via skill)
//   5. Cliente acessa link, lê termo, clica "Autorizar Consulta"
//   6. Unno cria proposta e roda risk-analysis automático
//   7. Polling (action 'verificarStatus') le proposals filtrando por CPF
//   8. Quando proposta aparece com status integrated/rejected → card vira
//      ok/falha
//
// Auth: login HUMANO (username+password). JWT user-type, TTL ~4h.
// Cache de token via TOKEN_CACHE (decodifica exp do JWT).
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';

// ── Config ─────────────────────────────────────────────────────
function getConfig() {
  return {
    BASE: (process.env.UNNO_BASE_URL || 'https://gtw.unnotech.com.br').trim(),
    USER: (process.env.UNNO_USERNAME || '').trim(),
    PASS: (process.env.UNNO_PASSWORD || '').trim(),
    // UUIDs descobertos via Network do painel
    BANK_PROVIDER_QITECH: 'a3f2c1d4-7e85-4b9a-b2c3-1d4e5f6a7b8c',
    BANK_PROVIDER_CREDSPOT: 'b7e4f2a1-3d9c-4e8b-a5f6-2c1d0e9f8a7b',
  };
}

// ── Token cache (JWT humano, TTL ~4h) ──────────────────────────
let TOKEN_CACHE = { token: null, expiresAt: 0 };

function decodeJwtExp(token) {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const { exp } = JSON.parse(json);
    return typeof exp === 'number' ? exp * 1000 : 0;
  } catch { return 0; }
}

async function getToken() {
  const now = Date.now();
  if (TOKEN_CACHE.token && TOKEN_CACHE.expiresAt > now + 60_000) {
    return TOKEN_CACHE.token;
  }
  const cfg = getConfig();
  if (!cfg.USER || !cfg.PASS) {
    throw new Error('UNNO_USERNAME/UNNO_PASSWORD nao configurados no ambiente');
  }
  const r = await fetch(cfg.BASE + '/auth/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: cfg.USER, password: cfg.PASS }),
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 500) }; }
  if (!r.ok || !d.access_token) {
    throw new Error(`Falha login Unno (HTTP ${r.status}): ${d.error || d.message || d.raw || 'sem detalhes'}`);
  }
  const realExp = decodeJwtExp(d.access_token);
  const fallbackTtl = now + (3 * 60 * 60 * 1000);
  TOKEN_CACHE = {
    token: d.access_token,
    expiresAt: realExp > 0 ? realExp - 60_000 : fallbackTtl,
  };
  return d.access_token;
}

async function unnoCall(path, method = 'GET', body = null) {
  const token = await getToken();
  const cfg = getConfig();
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Origin': 'https://app.unnotech.com.br',
    },
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const r = await fetch(cfg.BASE + path, opts);
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 2000) }; }
  return { ok: r.ok, status: r.status, data: d };
}

function onlyDigits(s) { return String(s || '').replace(/\D/g, ''); }
function normalizeBirth(s) {
  if (!s) return '';
  const m1 = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m1) return s;
  const m2 = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;
  return s;
}
function normalizeGender(s) {
  const v = String(s || '').toUpperCase();
  if (v.startsWith('F')) return 'FEMALE';
  return 'MALE'; // default
}

// ─── ACTION: autorizarTermo ────────────────────────────────────
// PUT /auth/api/v1/terms/authorize/{uuid} — autoriza termo programaticamente
// (modelo Handbank/UY3 ChallengeInfo). Cliente nao precisa clicar.
// IMPORTANTE: Unno grava ip_address e user_agent na auditoria — fica
// registrado que a LhamasCred autorizou em nome do cliente.
// Pressupoe que parceiro tem procuracao escrita do cliente.
async function autorizarTermo(termUuid) {
  if (!termUuid) return { sucesso: false, error: 'termUuid obrigatorio' };
  const r = await unnoCall(`/auth/api/v1/terms/authorize/${termUuid}`, 'PUT', {});
  // PUT retorna 204 No Content em caso de sucesso
  if (r.status === 204 || r.ok) {
    return { sucesso: true };
  }
  return {
    sucesso: false,
    error: r.data?.error?.message || r.data?.message || `HTTP ${r.status}`,
    _raw: r.data,
  };
}

// ─── Helper: polling de proposta criada apos autorizacao ───────
// Apos auto-autorizar, Unno cria proposta em background (~3-10s).
// Esse polling aguarda a proposta aparecer na listagem por CPF.
// maxMs curto (9s): a resposta TEM que sair antes do corte de ~25s do gateway
// edge (chain: clt-fila espera cliente + este endpoint). Se a proposta nao
// aparecer a tempo, retorna AUTORIZADO_EM_ANALISE e o auto-re-trigger do
// status continua o acompanhamento — nunca responder 504.
async function aguardarPropostaCriada(cpf, maxMs = 9000, intervalMs = 1500) {
  const cpfLimpo = onlyDigits(cpf);
  const inicio = Date.now();
  while (Date.now() - inicio < maxMs) {
    const list = await unnoCall(
      '/proposal/api/v1/proposals?size=20&sort=createdAt,desc&productType=CONSIGNADO_CLT',
      'GET'
    );
    const minhas = (list.data?.content || [])
      .filter(p => onlyDigits(p.customer_document) === cpfLimpo)
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

    if (minhas.length > 0) {
      const p = minhas[0];
      const status = (p.status || '').toLowerCase();
      // Status terminal — pode retornar
      if (status === 'integrated' || status === 'disbursed' ||
          status === 'rejected_risk_analysis_automatic' ||
          status.startsWith('rejected') ||
          status === 'cancelled' || status === 'canceled') {
        return { encontrou: true, terminal: true, proposta: p };
      }
      // Achou mas ainda em analise (waiting_credit_analysis, created, etc)
      // Continua pollando ate maxMs OR retorna em andamento
      if (Date.now() - inicio > maxMs - intervalMs) {
        return { encontrou: true, terminal: false, proposta: p };
      }
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return { encontrou: false, terminal: false, proposta: null };
}

// ─── ACTION: iniciarSimulacao ──────────────────────────────────
// POST /auth/api/v1/terms — cria termo de consentimento + retorna link.
// Cliente recebe link, autoriza, sistema Unno cria proposta + roda
// risk-analysis. Esse passo eh O QUE CRIA a "simulacao" no painel.
//
// Input: { cpf, nome, telefone, email?, dataNascimento, sexo?, provedor? }
// Output: { sucesso, uuid, link, expiraEm, mensagem }
async function iniciarSimulacao({ cpf, nome, telefone, email, dataNascimento, sexo, provedor }) {
  const cpfLimpo = onlyDigits(cpf);
  if (cpfLimpo.length !== 11) return { sucesso: false, error: 'CPF invalido (precisa 11 digitos)' };
  if (!nome?.trim()) return { sucesso: false, error: 'Nome obrigatorio' };
  if (!dataNascimento) return { sucesso: false, error: 'Data nascimento obrigatoria' };
  const tel = onlyDigits(telefone);
  if (tel.length < 10 || tel.length > 11) {
    return { sucesso: false, error: 'Telefone invalido (precisa DDD + 8-9 digitos)' };
  }

  const cfg = getConfig();
  const bankProvider = (provedor || 'qitech').toLowerCase() === 'credspot'
    ? cfg.BANK_PROVIDER_CREDSPOT
    : cfg.BANK_PROVIDER_QITECH;

  const payload = {
    customer_cpf: cpfLimpo,
    customer_phone: tel,
    customer_full_name: nome.trim(),
    customer_email: (email && email.includes('@'))
      ? email
      : `${cpfLimpo}@lead.lhamascred.com.br`,
    customer_birth_date: normalizeBirth(dataNascimento),
    customer_gender: normalizeGender(sexo),
    bank_provider_uuid: bankProvider,
    product_type: 'CONSIGNADO_CLT',
  };

  const r = await unnoCall('/auth/api/v1/terms', 'POST', payload);
  if (!r.ok || !r.data?.uuid) {
    return {
      sucesso: false,
      error: r.data?.error?.message || r.data?.message || `HTTP ${r.status}`,
      _raw: r.data,
    };
  }

  return {
    sucesso: true,
    uuid: r.data.uuid,
    link: r.data.link,
    expiraEm: r.data.expiry_date,
    status: r.data.status, // PENDING
    proposalUuid: r.data.proposal_uuid_ref || null, // null ate cliente autorizar
    mensagem: 'Termo criado — envie o link ao cliente pra autorizar',
  };
}

// ─── ACTION: verificarStatus ──────────────────────────────────
// 1) GET /auth/api/v1/terms/latest/{termUuid} → checa se cliente
//    autorizou (status: PENDING → AGREED)
// 2) Se autorizado: GET /proposal/api/v1/proposals → busca proposta
//    correspondente (pelo CPF) e retorna status (integrated/rejected)
//
// Input: { termUuid, cpf }
// Output: {
//   etapa: 'AGUARDANDO_AUTORIZACAO' | 'AUTORIZADO_EM_ANALISE' | 'APROVADO' | 'RECUSADO' | 'CANCELADO',
//   approved: bool,
//   mensagem: string,
//   link?: string,            // se ainda aguardando autorizacao
//   proposalUuid?: string,    // se ja criada
//   bancoProvedor?: string,
//   motivoRecusa?: string,
//   linkPainel?: string
// }
// Extrai margem/salario da proposta (best-effort — nomes variam; checa tambem
// objetos aninhados comuns). Se nao achar, vem 0 e o _rawProposta permite tunar.
function extrairMargemProposta(p) {
  const out = { disponivel: 0, base: 0, salario: 0 };
  if (!p || typeof p !== 'object') return out;
  const cand = [p, p.worker, p.workerConsultation, p.worker_consultation, p.consultation,
                p.simulation, p.margin, p.margem, p.eligibility, p.details, p.detalhe]
                .filter(o => o && typeof o === 'object');
  const pick = (names) => {
    for (const o of cand) for (const n of names) {
      const v = o[n];
      if (v != null && v !== '' && !isNaN(parseFloat(v))) return parseFloat(v);
    }
    return 0;
  };
  out.disponivel = pick(['available_margin', 'availableMargin', 'ValorMargemDisponivel', 'margin_available', 'margemDisponivel', 'available_balance', 'availableBalance', 'produtoSaldoDisponivel', 'ProdutoSaldoDisponivel']);
  out.base = pick(['base_margin', 'baseMargin', 'margin_base', 'ValorBaseMargem', 'margemBase', 'base_value', 'valorMargemBase']);
  out.salario = pick(['gross_salary', 'grossSalary', 'salary', 'TotalRendimentos', 'salario', 'income', 'totalRendimentos']);
  return out;
}

async function verificarStatus({ termUuid, cpf }) {
  // 1) Status do termo (endpoint correto é /terms/{uuid} — /latest/{uuid} da 404)
  const term = await unnoCall(`/auth/api/v1/terms/${termUuid}`, 'GET');
  if (!term.ok) {
    return {
      etapa: 'ERRO',
      approved: false,
      error: term.data?.message || `Termo nao encontrado (HTTP ${term.status})`,
    };
  }
  const t = term.data;

  // Se ainda PENDING — cliente nao autorizou
  if (t.status !== 'AGREED' || !t.agreed_at) {
    return {
      etapa: 'AGUARDANDO_AUTORIZACAO',
      approved: false,
      mensagem: '📲 Cliente ainda não autorizou. Reenvie o link via WhatsApp.',
      link: t.link,
      expiraEm: t.expiry_date,
    };
  }

  // 2) Cliente autorizou — busca proposta criada
  // Como filtro server-side por CPF nao funciona, listamos as 50 ultimas
  // e filtramos client-side.
  const list = await unnoCall(
    '/proposal/api/v1/proposals?size=50&sort=createdAt,desc&productType=CONSIGNADO_CLT',
    'GET'
  );
  const cpfLimpo = onlyDigits(cpf || t.customer_cpf);
  const propostas = (list.data?.content || [])
    .filter(p => onlyDigits(p.customer_document) === cpfLimpo)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  if (propostas.length === 0) {
    // Cliente autorizou mas Unno ainda nao criou proposta — esta criando.
    // Frontend deles tambem fica em loading aqui (~5-15s).
    return {
      etapa: 'AUTORIZADO_EM_ANALISE',
      approved: false,
      mensagem: '⏳ Cliente autorizou — Unno está criando proposta (aguarde ~10s)',
      link: t.link,
    };
  }

  const p = propostas[0];
  const status = (p.status || '').toLowerCase();
  const mg = extrairMargemProposta(p);
  const linkPainel = `https://app.unnotech.com.br/loans/clt/${p.uuid}`;

  // APROVADOS
  if (status === 'integrated' || status === 'disbursed') {
    return {
      etapa: 'APROVADO',
      approved: true,
      mensagem: status === 'disbursed'
        ? '💰 Aprovada e desembolsada'
        : '✅ Aprovada — pronta pra prosseguir no painel Unno',
      margem: mg,
      proposalUuid: p.uuid,
      bancoProvedor: p.bank_provider_name,
      linkPainel,
      _rawProposta: p,
    };
  }

  // RECUSADOS — extrai motivo do log
  if (status === 'rejected_risk_analysis_automatic' || status.startsWith('rejected')) {
    const logs = p.logs || [];
    const logRej = logs.find(l =>
      (l.action || '').toLowerCase().includes('rejected') ||
      (l.action || '').toLowerCase().includes('erro reportado')
    );
    const motivo = logRej
      ? (logRej.action || '').replace(/^.*?:\s*/, '').substring(0, 200)
      : p.bank_provider_status || 'Recusada pelo motor de risco';
    return {
      etapa: 'RECUSADO',
      approved: false,
      mensagem: `❌ ${motivo}`,
      proposalUuid: p.uuid,
      bancoProvedor: p.bank_provider_name,
      linkPainel: `https://app.unnotech.com.br/loans/clt/${p.uuid}`,
      motivoRecusa: motivo,
    };
  }

  if (status === 'cancelled' || status === 'canceled') {
    return {
      etapa: 'CANCELADO',
      approved: false,
      mensagem: '🚫 Cancelada',
      proposalUuid: p.uuid,
      linkPainel: `https://app.unnotech.com.br/loans/clt/${p.uuid}`,
    };
  }

  // Outros status (em análise/pré-proposta) — a proposta JÁ EXISTE e já traz a
  // MARGEM. Em vez de ficar em loop até timeout, retorna DISPONIVEL com a margem
  // e o link do painel pro parceiro continuar a digitação. A margem é o que
  // importa pro operador; a aprovação final ele acompanha no painel.
  return {
    etapa: 'DISPONIVEL',
    approved: true,
    mensagem: mg.disponivel > 0
      ? `Margem R$ ${mg.disponivel.toFixed(2)} — continue no painel Unno`
      : (mg.base > 0
          ? `Margem base R$ ${mg.base.toFixed(2)} — continue no painel Unno`
          : `Disponível — continue no painel Unno (status: ${p.status})`),
    margem: mg,
    statusProposta: p.status,
    proposalUuid: p.uuid,
    bancoProvedor: p.bank_provider_name,
    linkPainel,
    _rawProposta: p,
  };
}

// ─── ACTION: simulacaoCompleta ─────────────────────────────────
// Fluxo "tudo de uma vez" (modelo Handbank/UY3):
//   1. Cria termo (POST /auth/api/v1/terms)
//   2. Auto-autoriza (PUT /auth/api/v1/terms/authorize/{uuid})
//   3. Aguarda Unno criar proposta (polling 18s)
//   4. Retorna resultado interpretado (APROVADO/RECUSADO/EM_ANALISE)
//
// Cliente NAO precisa clicar em link nenhum. Funciona como Handbank/UY3
// onde o parceiro autoriza tecnicamente em nome do cliente.
async function simulacaoCompleta(params) {
  // 1) Cria termo
  const termo = await iniciarSimulacao(params);
  if (!termo.sucesso) {
    return { ...termo, etapa: 'ERRO_CRIAR_TERMO' };
  }

  // 2) Auto-autoriza imediatamente
  const autz = await autorizarTermo(termo.uuid);
  if (!autz.sucesso) {
    return {
      sucesso: false,
      etapa: 'ERRO_AUTORIZAR',
      error: `Termo criado (${termo.uuid}) mas falhou auto-autz: ${autz.error}`,
      termUuid: termo.uuid,
      link: termo.link, // operador pode usar link manual como fallback
    };
  }

  // 3) Aguarda proposta ser criada e analisada pela Unno
  const aguard = await aguardarPropostaCriada(params.cpf);

  if (!aguard.encontrou) {
    return {
      sucesso: true,
      etapa: 'AUTORIZADO_EM_ANALISE',
      approved: false,
      mensagem: '⏳ Termo autorizado — Unno está criando proposta. Re-tentar em ~30s.',
      termUuid: termo.uuid,
      retryable: true,
    };
  }

  const p = aguard.proposta;
  const status = (p.status || '').toLowerCase();

  // 4) Interpreta resultado
  if (status === 'integrated' || status === 'disbursed') {
    return {
      sucesso: true,
      etapa: 'APROVADO',
      approved: true,
      mensagem: status === 'disbursed'
        ? '💰 Aprovada e desembolsada'
        : '✅ Aprovada na Unno — pronta pra prosseguir',
      termUuid: termo.uuid,
      proposalUuid: p.uuid,
      bancoProvedor: p.bank_provider_name,
      linkPainel: `https://app.unnotech.com.br/loans/clt/${p.uuid}`,
      dadosCliente: {
        nome: p.customer_name,
        cpf: p.customer_document,
      },
    };
  }

  if (status === 'rejected_risk_analysis_automatic' || status.startsWith('rejected')) {
    const logs = p.logs || [];
    const logRej = logs.find(l =>
      (l.action || '').toLowerCase().includes('rejected') ||
      (l.action || '').toLowerCase().includes('erro reportado')
    );
    const motivo = logRej
      ? (logRej.action || '').replace(/^.*?:\s*/, '').substring(0, 200)
      : p.bank_provider_status || 'Recusada pelo motor de risco';
    return {
      sucesso: true,
      etapa: 'RECUSADO',
      approved: false,
      mensagem: `❌ ${motivo}`,
      termUuid: termo.uuid,
      proposalUuid: p.uuid,
      bancoProvedor: p.bank_provider_name,
      linkPainel: `https://app.unnotech.com.br/loans/clt/${p.uuid}`,
      motivoRecusa: motivo,
    };
  }

  if (status === 'cancelled' || status === 'canceled') {
    return {
      sucesso: true,
      etapa: 'CANCELADO',
      approved: false,
      mensagem: '🚫 Cancelada',
      termUuid: termo.uuid,
      proposalUuid: p.uuid,
      linkPainel: `https://app.unnotech.com.br/loans/clt/${p.uuid}`,
    };
  }

  // Proposta criada e analisando — JÁ TEM MARGEM. Retorna DISPONIVEL (mostra a
  // margem) em vez de ficar "em análise" até timeout. Parceiro continua no painel.
  const mg = extrairMargemProposta(p);
  return {
    sucesso: true,
    etapa: 'DISPONIVEL',
    approved: true,
    mensagem: mg.disponivel > 0
      ? `Margem R$ ${mg.disponivel.toFixed(2)} — continue no painel Unno`
      : (mg.base > 0
          ? `Margem base R$ ${mg.base.toFixed(2)} — continue no painel Unno`
          : `Disponível — continue no painel Unno (status: ${p.status})`),
    margem: mg,
    statusProposta: p.status,
    termUuid: termo.uuid,
    proposalUuid: p.uuid,
    bancoProvedor: p.bank_provider_name,
    linkPainel: `https://app.unnotech.com.br/loans/clt/${p.uuid}`,
    _rawProposta: p,
  };
}

// ─── ACTION: cancelarSimulacao ─────────────────────────────────
async function cancelarSimulacao(proposalUuid) {
  if (!proposalUuid) return { sucesso: false, error: 'proposalUuid obrigatorio' };
  const r = await unnoCall(`/proposal/api/v1/proposals/${proposalUuid}/cancel`, 'POST', {});
  return {
    sucesso: r.ok,
    status: r.status,
    error: r.ok ? null : (r.data?.message || `HTTP ${r.status}`),
  };
}

// ─── FLUXO REAL (máquina de passos) — o que o painel usa de verdade ──
// START_DRAFT → TERMS_AND_CONDITIONS → GET_BALANCE (margem). Só precisa
// cpf/telefone/email; nome/nascimento/gênero VÊM do GET_BALANCE.
// POST /proposal/api/v1/process/CONSIGNADO_CLT/{PROVIDER}/steps/{STEP}[/{uuid}]
async function simularStep({ cpf, telefone, email, provider }) {
  const cpfLimpo = onlyDigits(cpf);
  if (cpfLimpo.length !== 11) return { sucesso: false, error: 'CPF invalido (11 digitos)' };
  const prov = (provider || 'CELCOIN').toUpperCase();
  const base = `/proposal/api/v1/process/CONSIGNADO_CLT/${prov}/steps`;
  const passos = {};

  // 1) START_DRAFT — cria a proposta
  const draft = await unnoCall(`${base}/START_DRAFT`, 'POST', {
    cpf: cpfLimpo,
    phone: onlyDigits(telefone || ''),
    email: (email && email.includes('@')) ? email : `${cpfLimpo}@lead.lhamascred.com.br`,
  });
  const proposalUuid = draft.data?.proposal_uuid;
  passos.START_DRAFT = { http: draft.status, status: draft.data?.status };
  if (!draft.ok || !proposalUuid) {
    return { sucesso: false, etapa: 'START_DRAFT', error: draft.data?.message || `HTTP ${draft.status}`, passos, _raw: draft.data };
  }

  // 2) TERMS_AND_CONDITIONS — autoriza o termo (vira AGREED)
  const termo = await unnoCall(`${base}/TERMS_AND_CONDITIONS/${proposalUuid}`, 'POST', {});
  passos.TERMS = { http: termo.status, termStatus: termo.data?.response?.status };

  // 3) GET_BALANCE — a margem
  const bal = await unnoCall(`${base}/GET_BALANCE/${proposalUuid}`, 'POST', {});
  passos.GET_BALANCE = { http: bal.status };
  const link0 = bal.data?.response?.links?.[0];
  const prod0 = link0?.products?.[0];
  const meta = link0?.meta_data || {};
  if (!bal.ok || !link0) {
    return { sucesso: false, etapa: 'GET_BALANCE', proposalUuid, error: bal.data?.message || `HTTP ${bal.status}`, passos, _raw: bal.data };
  }
  const margem = Number(prod0?.available_balance) || 0;
  const balanceCheckId = prod0?.balance_check_id || null;
  const info = {
    proposalUuid,
    margem,
    balanceCheckId,
    empregador: link0?.employer?.name || null,
    empregadorDoc: link0?.employer?.document || null,
    baseMargem: Number(meta.base_margin_value) || 0,
    renda: Number(meta.total_earnings) || 0,
    dataNascimento: meta.birth_date || null,
    genero: meta.gender?.description || null,
    nomeMae: meta.mother_name || null,
    linkPainel: `https://app.unnotech.com.br/loans/clt/${proposalUuid}`,
    passos,
  };

  // Sem margem: nem roda análise
  if (margem <= 0 || !balanceCheckId) {
    return { sucesso: true, etapa: 'SEM_MARGEM', elegivel: false, aprovado: false, ...info };
  }

  // ── Continua a análise de crédito (é o que REALMENTE aprova/reprova) ──
  // 4) SELECT_PRODUCT
  const sel = await unnoCall(`${base}/SELECT_PRODUCT/${proposalUuid}`, 'POST', { balance_check_id: balanceCheckId });
  passos.SELECT_PRODUCT = { http: sel.status, status: sel.data?.status };
  // 5) VALIDATE_CREDIT_RULES_VALORA
  const valora = await unnoCall(`${base}/VALIDATE_CREDIT_RULES_VALORA/${proposalUuid}`, 'POST', {});
  passos.VALORA = { http: valora.status, status: valora.data?.status };
  // 6) VALIDATE_CREDIT_RULES_GUARDIAN — polla até sair de "processing"
  let guardian = null, gstatus = null, pre = {};
  for (let i = 0; i < 6; i++) {
    guardian = await unnoCall(`${base}/VALIDATE_CREDIT_RULES_GUARDIAN/${proposalUuid}`, 'POST', {});
    gstatus = guardian.data?.status;
    pre = guardian.data?.payload?.guardian?.pre_filter_response || {};
    if (gstatus === 'COMPLETED' || gstatus === 'FAILED' || (pre.status && pre.status !== 'processing')) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  passos.GUARDIAN = { http: guardian?.status, status: gstatus, pre: pre.status };
  const currentStep = guardian?.data?.current_step_code;

  // Veredito
  if (pre.status === 'rejected') {
    const motivo = pre.reason_rejected?.message || 'Reprovado na análise de crédito';
    const ehErroInfra = /not found|404|erro ao consultar|workflow|internal|timeout/i.test(motivo);
    return {
      sucesso: true,
      etapa: ehErroInfra ? 'ERRO_ANALISE' : 'REPROVADO',
      elegivel: true, aprovado: false, motivoReprovacao: motivo, ...info,
    };
  }
  if (gstatus === 'COMPLETED' && pre.status && pre.status !== 'rejected') {
    return { sucesso: true, etapa: 'APROVADO_ANALISE', elegivel: true, aprovado: true, currentStep, ...info };
  }
  // Guardian ainda processando / status indefinido
  return { sucesso: true, etapa: 'EM_ANALISE', elegivel: true, aprovado: false, currentStep, ...info };
}

// ══════════════════════════════════════════════════════════════
// HANDLER
// ══════════════════════════════════════════════════════════════
export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  let body;
  try { body = await req.json(); } catch { return jsonError('JSON invalido', 400, req); }
  const action = body.action || 'test';

  try {
    if (action === 'test') {
      // Healthcheck: login + lista partners
      const r = await unnoCall('/auth/api/v1/partners?size=1', 'GET');
      return jsonResp({
        success: r.ok,
        login: 'ok',
        partnersStatus: r.status,
        partnersCount: r.data?.total_elements ?? null,
      }, 200, req);
    }

    if (action === 'iniciarSimulacao') {
      const out = await iniciarSimulacao({
        cpf: body.cpf,
        nome: body.nome || body.name,
        telefone: body.telefone || body.phone,
        email: body.email,
        dataNascimento: body.dataNascimento || body.birth_date,
        sexo: body.sexo || body.gender,
        provedor: body.provedor || body.provider, // 'qitech' | 'credspot' (default qitech)
      });
      return jsonResp(out, 200, req);
    }

    if (action === 'autorizarTermo') {
      const out = await autorizarTermo(body.termUuid || body.uuid);
      return jsonResp(out, 200, req);
    }

    if (action === 'simulacaoCompleta' || action === 'consultarAprovacao') {
      // Fluxo Handbank/UY3-like: cria termo + auto-autz + polling
      const out = await simulacaoCompleta({
        cpf: body.cpf,
        nome: body.nome || body.name,
        telefone: body.telefone || body.phone,
        email: body.email,
        dataNascimento: body.dataNascimento || body.birth_date,
        sexo: body.sexo || body.gender,
        provedor: body.provedor || body.provider,
      });
      return jsonResp(out, 200, req);
    }

    if (action === 'verificarStatus') {
      const out = await verificarStatus({
        termUuid: body.termUuid || body.uuid,
        cpf: body.cpf,
      });
      return jsonResp(out, 200, req);
    }

    if (action === 'cancelarSimulacao') {
      const out = await cancelarSimulacao(body.proposalUuid || body.uuid);
      return jsonResp(out, 200, req);
    }

    if (action === 'listarTabelas') {
      const r = await unnoCall('/proposal/api/v1/tables/clt', 'GET');
      return jsonResp({ success: r.ok, ...r.data }, r.status, req);
    }

    // Fluxo REAL de passos (START_DRAFT → TERMS → GET_BALANCE = margem)
    if (action === 'simularStep') {
      const out = await simularStep({
        cpf: body.cpf,
        telefone: body.telefone || body.phone,
        email: body.email,
        provider: body.provedor || body.provider, // CELCOIN (default) | CREDSPOT | V8 | QITECH
      });
      return jsonResp(out, 200, req);
    }

    // ─── DEBUG TEMP: mostra dado cru do Unno pra entender por que a proposta
    // nao aparece / o termo da 404. body: { cpf, termUuid }
    if (action === 'debug') {
      const cpf = onlyDigits(body.cpf || '');
      const termUuid = body.termUuid || body.uuid || null;
      const out = { cpf, termUuid };
      // 1) Ultimas 20 propostas CLT
      const list = await unnoCall('/proposal/api/v1/proposals?size=20&sort=createdAt,desc&productType=CONSIGNADO_CLT', 'GET');
      out.proposalsStatus = list.status;
      out.proposalsTotal = list.data?.total_elements ?? (list.data?.content?.length ?? null);
      out.proposals = (list.data?.content || []).map((p) => ({
        uuid: p.uuid, doc: p.customer_document, nome: p.customer_full_name,
        status: p.status, created_at: p.created_at, produto: p.product_type, banco: p.bank_provider_name,
      }));
      out.matchCpf = out.proposals.filter((p) => onlyDigits(p.doc || '') === cpf);
      // 2) Termo por 2 caminhos (pra achar o certo)
      if (termUuid) {
        const a = await unnoCall(`/auth/api/v1/terms/latest/${termUuid}`, 'GET');
        const b = await unnoCall(`/auth/api/v1/terms/${termUuid}`, 'GET');
        out.term_latest = { httpStatus: a.status, status: a.data?.status, proposal_ref: a.data?.proposal_uuid_ref, agreed_at: a.data?.agreed_at };
        out.term_byId = { httpStatus: b.status, status: b.data?.status, proposal_ref: b.data?.proposal_uuid_ref, agreed_at: b.data?.agreed_at };
      }
      // 3) Termo mais recente por CPF (talvez o lookup certo seja por cpf)
      if (cpf) {
        const c = await unnoCall(`/auth/api/v1/terms/latest/${cpf}`, 'GET');
        out.term_latest_byCpf = { httpStatus: c.status, uuid: c.data?.uuid, status: c.data?.status, proposal_ref: c.data?.proposal_uuid_ref };
      }
      return jsonResp({ success: true, ...out }, 200, req);
    }

    return jsonError(
      'Action invalida. Validas: test, iniciarSimulacao, verificarStatus, cancelarSimulacao, listarTabelas',
      400, req
    );
  } catch (e) {
    return jsonError('Erro Unno: ' + e.message, 500, req);
  }
}
