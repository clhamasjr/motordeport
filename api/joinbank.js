export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';

function getConfig() {
  return {
    URL: process.env.JOINBANK_URL || 'https://integration.ajin.io',
    KEY: process.env.JOINBANK_KEY
  };
}

async function jb(method, path, body) {
  const cfg = getConfig();
  if (!cfg.KEY) throw new Error('JOINBANK_KEY nao configurado');
  const opts = { method, headers: { 'Content-Type': 'application/json', 'apikey': cfg.KEY } };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const r = await fetch(cfg.URL + path, opts);
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 2000) }; }
  return { ok: r.ok, status: r.status, data: d };
}

const j = (data, status = 200, req = null) => jsonResp(data, status, req);

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  try {
    const body = req.method === 'POST' ? await req.json() : {};
    const action = body.action || '';

    if (action === 'listProducts') {
      const r = await jb('POST', '/v3/loan-products/search/basic', { type: { code: { eq: body.type || 20 } }, operation: { code: { eq: body.operation || 1 } } });
      return j({ success: r.ok, ...r.data }, 200, req);
    }

    if (action === 'listRules') {
      const r = await jb('POST', '/v3/loan-product-rules/search/basic', { offset: body.offset || 0, limit: body.limit || 20, operation: { code: { eq: body.operation || 1 } } });
      return j({ success: r.ok, ...r.data }, 200, req);
    }

    if (action === 'in100') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      const ben = (body.beneficio || '').replace(/\D/g, '');
      if (!cpf || !ben) return jsonError('CPF e beneficio obrigatorios', 400, req);
      const r = await jb('POST', '/v3/query-inss-balances/finder', { identity: cpf, benefitNumber: ben, lastHours: body.lastHours || 24, timeout: body.timeout || 120 });
      const d = r.data;
      return j({
        success: r.ok, cpf, beneficio: ben,
        nome: d.name || null, status: d.status || null,
        benefitStatus: d.benefitStatus || d.benefitSituation || null,
        elegivel: d.benefitStatus === 'elegible' || d.benefitSituation === 'active',
        bloqueado: (d.blockType && d.blockType !== 'not_blocked') || false,
        tipoBlock: d.blockType || null, especie: d.assistanceType || null,
        margemEmprestimo: d.consignedCreditBalance || 0,
        margemCartao: d.consignedCardBalance || 0,
        limiteCartao: d.consignedCardLimit || 0,
        limiteCartaoBeneficio: d.benefitCardLimit || 0,
        saldoCartaoBeneficio: d.benefitCardBalance || 0,
        maxSaldo: d.maxTotalBalance || 0,
        saldoUsado: d.usedTotalBalance || 0,
        saldoDisponivel: d.availableTotalBalance || 0,
        contaBanco: d.disbursementBankAccount || null,
        contratosAtivos: d.numberOfActiveReservations || 0,
        contratosSuspensos: d.numberOfSuspendedReservations || 0,
        portabilidades: d.numberOfPortabilities || 0,
        representanteLegal: d.hasLegalRepresentative || false,
        uf: d.state || null, dataNascimento: d.birthDate || null,
        dataConcessao: d.grantDate || null, queryDate: d.queryDate || null,
        _raw: d
      }, 200, req);
    }

    if (action === 'calculate') {
      const payload = { ruleId: body.ruleId, term: body.term, rate: body.rate, installmentValue: body.installmentValue, loanValue: body.loanValue, hasInsurance: body.hasInsurance || false, referenceCode: body.referenceCode || null };
      if (body.originContract) {
        payload.originContract = { lenderCode: body.originContract.lenderCode, contractNumber: body.originContract.contractNumber, term: body.originContract.term, installmentsRemaining: body.originContract.installmentsRemaining, installmentValue: body.originContract.installmentValue, dueBalanceValue: body.originContract.dueBalanceValue };
      }
      const r = await jb('POST', '/v3/loan-inss-simulations/calculation', payload);
      return j({ success: r.ok, ...r.data }, 200, req);
    }

    if (action === 'createProposal') {
      const r = await jb('POST', '/v3/loan-inss-simulations', { borrower: body.borrower, items: body.items, creditBankAccount: body.creditBankAccount || null, step: body.step || { code: 0, name: null }, files: body.files || [], note: body.note || null, brokerId: body.brokerId || null, accessId: body.accessId || null });
      return j({ success: r.ok, simulationId: r.data.id, code: r.data.code, status: r.data.status, ...r.data }, 200, req);
    }

    if (action === 'getAuthTerm') {
      if (!body.simulationId) return jsonError('simulationId obrigatorio', 400, req);
      const r = await jb('GET', `/v3/loan-inss-simulations/${body.simulationId}/auth-term`);
      return j({ success: r.ok, key: r.data.key || null, signed: r.data.status && r.data.status.key === 'signed', content: r.data.content || null, status: r.data.status || null, _raw: r.data }, 200, req);
    }

    if (action === 'signTerm') {
      if (!body.authTermKey) return jsonError('authTermKey obrigatorio', 400, req);
      const r = await jb('PUT', `/v3/signer/${body.authTermKey}/accept`, { position: { latitude: body.latitude || '-235489', longitude: body.longitude || '-466388' } });
      return j({ success: r.ok, signed: r.data.status && r.data.status.key === 'signed', status: r.data.status || null, ...r.data }, 200, req);
    }

    if (action === 'generateContracts') {
      if (!body.simulationId) return jsonError('simulationId obrigatorio', 400, req);
      const r = await jb('POST', `/v3/loan-inss-simulations/${body.simulationId}/actions`, { command: 'create_loans' });
      return j({ success: r.ok, status: r.data.status || null, signature: r.data.signature || null, items: r.data.items || [], ...r.data }, 200, req);
    }

    if (action === 'getLoansBySimulation') {
      if (!body.simulationId) return jsonError('simulationId obrigatorio', 400, req);
      const r = await jb('GET', `/v3/loans/simulation/${body.simulationId}`);
      return j({ success: r.ok, ...r.data }, 200, req);
    }

    if (action === 'getLoan') {
      if (!body.loanId) return jsonError('loanId obrigatorio', 400, req);
      const r = await jb('GET', `/v3/loans/${body.loanId}`);
      return j({ success: r.ok, id: r.data.id, code: r.data.code, product: r.data.product, rule: r.data.rule, borrower: r.data.borrower ? { name: r.data.borrower.name, cpf: r.data.borrower.identity, benefit: r.data.borrower.benefit } : null, status: r.data.status, operationStatus: r.data.operationStatus, proposalStatus: r.data.proposalStatus, contractNumber: r.data.contractNumber, proposalDate: r.data.proposalDate, creditDate: r.data.creditDate, loanValue: r.data.loanValue, netValue: r.data.netValue, installmentValue: r.data.installmentValue, term: r.data.term, rate: r.data.rate, signature: r.data.signature, _raw: r.data }, 200, req);
    }

    if (action === 'recalculate') {
      if (!body.loanId) return jsonError('loanId obrigatorio', 400, req);
      const r = await jb('POST', `/v3/loans/${body.loanId}/recalculation`, { ruleId: body.ruleId, term: body.term, rate: body.rate, installmentValue: body.installmentValue, loanValue: body.loanValue, hasInsurance: body.hasInsurance || false });
      return j({ success: r.ok, ...r.data }, 200, req);
    }

    if (action === 'test') {
      const r = await jb('POST', '/v3/loan-products/search/basic', { type: { code: { eq: 20 } }, operation: { code: { eq: 1 } } });
      return j({ apiActive: r.ok, httpStatus: r.status, productsFound: r.data.items ? r.data.items.length : 0, message: r.ok ? 'API JoinBank ativa!' : 'Erro de autenticacao' }, 200, req);
    }

    // ══════════════════════════════════════════════════════════════
    // CLT — Consignado Privado (providers: QITech 950002, 321 Bank 950703)
    // Docs: https://docs.ukam.io/joinbank/docs/simulation-clt
    // ══════════════════════════════════════════════════════════════

    // Cria simulação CLT (higienização embutida) — retorna simulationId + employmentRelationships
    if (action === 'cltCreateSimulation') {
      const providerCode = body.providerCode || '950002'; // QITech default
      if (!body.borrower) return jsonError('borrower obrigatorio', 400, req);
      const r = await jb('POST', `/v3/loan-private-payroll-simulations/providers/${providerCode}`, {
        borrower: body.borrower,
        creditMethod: body.creditMethod || 0,
        creditBankAccount: body.creditBankAccount || null,
      });
      return j({
        success: r.ok, httpStatus: r.status,
        simulationId: r.data?.id || r.data?.simulationId || null,
        employmentRelationships: r.data?.employmentRelationships || [],
        temVinculo: (r.data?.employmentRelationships || []).length > 0,
        // _raw preservado pra extracao de motivos de rejeicao no clt-fila.
        // (sem isso, mensagens 422/Reprovado caiam no fallback "Falha generica")
        _raw: r.data,
        ...r.data,
      }, 200, req);
    }

    // Calcula parcelas CLT (por valor parcela ou por valor líquido)
    if (action === 'cltCalculate') {
      if (!body.simulationId) return jsonError('simulationId obrigatorio', 400, req);
      const payload = {
        type: body.type || 1, // 1=por parcela, 2=por valor liquido
        identity: (body.identity || body.cpf || '').replace(/\D/g, ''),
        ruleId: body.ruleId,
        term: body.term,
        rate: body.rate,
        installmentValue: body.installmentValue || 0,
        registrationNumber: body.registrationNumber,
        employerDocument: (body.employerDocument || '').replace(/\D/g, ''),
        employerName: body.employerName,
        isInitialCalculation: body.isInitialCalculation !== false,
      };
      const r = await jb('POST', `/v3/loan-private-payroll-simulations/${body.simulationId}/calculation`, payload);
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    // Termo de autorização CLT
    if (action === 'cltAuthTerm') {
      if (!body.simulationId) return jsonError('simulationId obrigatorio', 400, req);
      const r = await jb('GET', `/v3/loan-private-payroll-simulations/${body.simulationId}/auth-term`);
      return j({
        success: r.ok, httpStatus: r.status,
        authTermKey: r.data?.key || null,
        signed: r.data?.status?.key === 'signed',
        status: r.data?.status || null,
        content: r.data?.content || null,
        _raw: r.data,
      }, 200, req);
    }

    // Assina termo CLT (mesmo endpoint do INSS)
    if (action === 'cltSignTerm') {
      if (!body.authTermKey) return jsonError('authTermKey obrigatorio', 400, req);
      const r = await jb('PUT', `/v3/signer/${body.authTermKey}/accept`, {
        position: { latitude: body.latitude || '-235489', longitude: body.longitude || '-466388' },
      });
      return j({
        success: r.ok, httpStatus: r.status,
        signed: r.data?.status?.key === 'signed',
        status: r.data?.status || null, ...r.data,
      }, 200, req);
    }

    // Seleciona condição CLT (item escolhido)
    if (action === 'cltSelectCondition') {
      if (!body.simulationId || !body.items) return jsonError('simulationId e items obrigatorios', 400, req);
      const r = await jb('PUT', `/v3/loan-private-payroll-simulations/${body.simulationId}`, { items: body.items });
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    // Confirma criação do contrato CLT
    if (action === 'cltCreateLoans') {
      if (!body.simulationId) return jsonError('simulationId obrigatorio', 400, req);
      const r = await jb('POST', `/v3/loan-private-payroll-simulations/${body.simulationId}/actions`, { command: 'create_loans' });
      return j({
        success: r.ok, httpStatus: r.status,
        signature: r.data?.signature || null,
        items: r.data?.items || [],
        status: r.data?.status || null,
        ...r.data,
      }, 200, req);
    }

    // ─── CLT CHECK ELIGIBILITY (consolidado) ─────────────────────────
    // Faz os 4 passos em sequencia + retorno limpo, pra clt-oportunidades
    // chamar 1x e ja saber se cliente eh elegivel:
    //   1) cltCreateSimulation
    //   2) cltAuthTerm  (Lhamas como correspondente assina)
    //   3) cltSignTerm
    //   4) cltCreateSimulation novamente (agora vinculos vem populados)
    // Retorna { disponivel, vinculo, simulationId, motivo, _raw }
    if (action === 'cltCheckEligibility') {
      const providerCode = body.providerCode || '950002';
      if (!body.borrower?.identity || !body.borrower?.name || !body.borrower?.birthDate) {
        return j({
          success: false, disponivel: false,
          motivo: 'Faltam dados básicos do cliente (CPF, nome ou data de nascimento)'
        }, 200, req);
      }
      // Passo 1: cria simulacao
      const r1 = await jb('POST', `/v3/loan-private-payroll-simulations/providers/${providerCode}`, {
        borrower: body.borrower, creditMethod: 0, creditBankAccount: null
      });
      const d1 = r1.data || {};
      const simulationId = d1.id || d1.simulationId || null;
      if (!r1.ok || !simulationId) {
        const errs = Array.isArray(d1.errors) ? d1.errors.map(e => e.message || e.title || JSON.stringify(e)).join('; ') : null;
        const motivo = d1.title || d1.detail || d1.message || errs || d1.refusalReason ||
          (r1.status ? `Erro HTTP ${r1.status}` : 'Falha ao criar simulação');
        return j({ success: false, disponivel: false, motivo, _raw: d1 }, 200, req);
      }
      // Passo 2: cltAuthTerm (Lhamas correspondente assina)
      const r2 = await jb('GET', `/v3/loan-private-payroll-simulations/${simulationId}/auth-term`);
      const d2 = r2.data || {};
      const authTermKey = d2.key || null;
      const jaAssinado = d2.status?.key === 'signed';
      // Passo 3: cltSignTerm (se ainda nao assinado)
      if (authTermKey && !jaAssinado) {
        await jb('PUT', `/v3/signer/${authTermKey}/accept`, {
          position: { latitude: '-235489', longitude: '-466388' }
        }).catch(() => {});
      }
      // Passo 4: re-cria simulacao apos assinatura (vinculos populados)
      const r3 = await jb('POST', `/v3/loan-private-payroll-simulations/providers/${providerCode}`, {
        borrower: body.borrower, creditMethod: 0, creditBankAccount: null
      });
      const d3 = r3.data || d1;
      const simulationIdFinal = d3.id || d3.simulationId || simulationId;
      const vinculos = d3.employmentRelationships || [];
      if (!vinculos.length) {
        return j({
          success: true, disponivel: false,
          motivo: 'Sem vínculo CLT elegível pra este banco',
          simulationId: simulationIdFinal,
          _termoAssinado: !!authTermKey
        }, 200, req);
      }
      const v = vinculos[0];
      return j({
        success: true, disponivel: true,
        simulationId: simulationIdFinal,
        vinculo: {
          empregador: v.employerName,
          empregadorCnpj: v.employerDocument,
          matricula: v.registrationNumber,
          renda: v.salary,
          margemDisponivel: v.availableMargin
        },
        _raw: d3
      }, 200, req);
    }

    // Test CLT — tenta criar simulação minima só com CPF pra validar conectividade
    if (action === 'cltTest') {
      const r = await jb('POST', '/v3/loan-products/search/basic', { type: { code: { eq: 21 } }, operation: { code: { eq: 1 } } });
      return j({
        apiActive: r.ok, httpStatus: r.status,
        productsFound: r.data.items ? r.data.items.length : 0,
        message: r.ok ? 'API JoinBank CLT ativa!' : 'Erro de autenticacao',
      }, 200, req);
    }

    return jsonError('action invalida', 400, req);
  } catch (err) {
    return j({ error: 'Erro interno' }, 500, req);
  }
}
