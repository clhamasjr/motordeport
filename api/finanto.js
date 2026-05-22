export const config = { runtime: 'edge' };

// ═══════════════════════════════════════════════════════════════
// API FINANTO — Proxy Completo (plataforma Ajin v3)
// ═══════════════════════════════════════════════════════════════
// FINANTO é uma loja/parceiro na plataforma Ajin (mesma backend do JoinBank
// /QualiBanking, mas com API key/credenciais próprias).
//
// Env vars (Vercel):
//   FINANTO_URL    -> https://api.ajin.io        (produção, default)
//                  -> https://integration.ajin.io (homologação)
//   FINANTO_KEY    -> apikey fornecida pela FINANTO
//   FINANTO_DRIVE_URL (opcional) -> default https://api-drive.ajin.io
//
// Padrão de autenticação Ajin: header `apikey: <chave>`
// ═══════════════════════════════════════════════════════════════

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';

function getConfig() {
  return {
    URL: (process.env.FINANTO_URL || 'https://api.ajin.io').trim().replace(/\/+$/, ''),
    KEY: (process.env.FINANTO_KEY || '').trim(),
    DRIVE_URL: (process.env.FINANTO_DRIVE_URL || 'https://api-drive.ajin.io').trim().replace(/\/+$/, ''),
  };
}

// Cliente HTTP genérico Ajin (base /v3 já embutido nos paths chamados)
async function fa(method, path, body) {
  const cfg = getConfig();
  if (!cfg.KEY) throw new Error('FINANTO_KEY nao configurado');
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'apikey': cfg.KEY,
    },
  };
  if (body !== undefined && body !== null && method !== 'GET') {
    opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const r = await fetch(cfg.URL + path, opts);
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 3000) }; }
  return { ok: r.ok, status: r.status, data: d };
}

// Cliente HTTP do Ajin Drive (upload de arquivos)
async function fad(method, path, body) {
  const cfg = getConfig();
  if (!cfg.KEY) throw new Error('FINANTO_KEY nao configurado');
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'apikey': cfg.KEY,
    },
  };
  if (body !== undefined && body !== null && method !== 'GET') {
    opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const r = await fetch(cfg.DRIVE_URL + path, opts);
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 3000) }; }
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
    const cfg = getConfig();

    // ═══════════════════════════════════════════════════════════
    // SAÚDE / DIAGNÓSTICO
    // ═══════════════════════════════════════════════════════════

    if (action === 'test' || action === 'about') {
      const r = await fa('GET', '/v3/about');
      return j({
        apiActive: r.ok,
        httpStatus: r.status,
        message: r.ok ? 'API FINANTO/Ajin ativa!' : 'Erro de autenticacao ou conexao',
        baseUrl: cfg.URL,
        ...r.data,
      }, 200, req);
    }

    if (action === 'diag') {
      return j({
        baseUrl: cfg.URL,
        driveUrl: cfg.DRIVE_URL,
        hasKey: !!cfg.KEY,
        keyPreview: cfg.KEY ? (cfg.KEY.substring(0, 6) + '...' + cfg.KEY.substring(cfg.KEY.length - 4)) : null,
        keyLen: cfg.KEY.length,
      }, 200, req);
    }

    // ═══════════════════════════════════════════════════════════
    // CATÁLOGO DE PRODUTOS E REGRAS
    // ═══════════════════════════════════════════════════════════
    // type codes: 20=INSS, 40=FGTS, 41=FGTS Pagamento, 50=Consignado Privado
    // operation codes: 1=Novo, 2=Refin, 3=Portabilidade, 4=Port+Refin,
    //                  5=Refin da Portabilidade, 6=Margem Complementar

    if (action === 'listProducts') {
      const filter = { type: { code: { eq: body.type ?? 20 } } };
      if (body.operation !== undefined) filter.operation = { code: { eq: body.operation } };
      const r = await fa('POST', '/v3/loan-products/search/basic', filter);
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    if (action === 'listRules') {
      const payload = {
        offset: body.offset ?? 0,
        limit: body.limit ?? 20,
      };
      if (body.type !== undefined) payload.type = { code: { eq: body.type } };
      if (body.operation !== undefined) payload.operation = { code: { eq: body.operation } };
      if (body.productId) payload.productId = { eq: body.productId };
      const r = await fa('POST', '/v3/loan-product-rules/search/basic', payload);
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    if (action === 'getRule') {
      if (!body.ruleId) return jsonError('ruleId obrigatorio', 400, req);
      const r = await fa('GET', `/v3/loan-product-rules/${body.ruleId}`);
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    // ═══════════════════════════════════════════════════════════
    // INSS — SIMULAÇÕES (operations 1, 2, 3, 4, 5, 6)
    // ═══════════════════════════════════════════════════════════

    // Lista contratos refinanciáveis (para operação 3 portabilidade / 5 refin port)
    if (action === 'contratosRefinanciaveis' || action === 'refinanceableContracts') {
      const cpf = (body.cpf || body.identity || '').replace(/\D/g, '');
      const ben = (body.beneficio || body.benefitNumber || '').replace(/\D/g, '');
      if (!cpf) return jsonError('cpf obrigatorio', 400, req);
      const payload = { identity: cpf };
      if (ben) payload.benefitNumber = ben;
      if (body.operation !== undefined) payload.operation = { code: body.operation };
      const r = await fa('POST', '/v3/loan-inss-simulations/refinanceable-contracts', payload);
      return j({ success: r.ok, httpStatus: r.status, items: r.data?.items || r.data || [], ...r.data }, 200, req);
    }

    // Calcula simulação (rate, term, valor parcela, etc.)
    if (action === 'calculate' || action === 'simular') {
      const payload = {
        ruleId: body.ruleId,
        term: body.term,
        rate: body.rate,
        installmentValue: body.installmentValue,
        loanValue: body.loanValue,
        hasInsurance: body.hasInsurance || false,
        referenceCode: body.referenceCode || null,
      };
      if (body.originContract) {
        payload.originContract = {
          lenderCode: body.originContract.lenderCode,
          contractNumber: body.originContract.contractNumber,
          term: body.originContract.term,
          installmentsRemaining: body.originContract.installmentsRemaining,
          installmentValue: body.originContract.installmentValue,
          dueBalanceValue: body.originContract.dueBalanceValue,
        };
      }
      const r = await fa('POST', '/v3/loan-inss-simulations/calculation', payload);
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    // Cria simulação (proposta em rascunho)
    if (action === 'createProposal' || action === 'criarSimulacao') {
      if (!body.borrower) return jsonError('borrower obrigatorio', 400, req);
      const payload = {
        borrower: body.borrower,
        items: body.items || [],
        creditBankAccount: body.creditBankAccount || null,
        step: body.step || { code: 0, name: null },
        files: body.files || [],
        note: body.note || null,
        brokerId: body.brokerId || null,
        accessId: body.accessId || null,
      };
      const r = await fa('POST', '/v3/loan-inss-simulations', payload);
      return j({
        success: r.ok, httpStatus: r.status,
        simulationId: r.data?.id || null,
        code: r.data?.code || null,
        status: r.data?.status || null,
        ...r.data,
      }, 200, req);
    }

    // Busca simulação por ID
    if (action === 'getSimulation') {
      if (!body.simulationId) return jsonError('simulationId obrigatorio', 400, req);
      const r = await fa('GET', `/v3/loan-inss-simulations/${body.simulationId}`);
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    // Atualiza simulação (anexar files, items, etc.)
    if (action === 'updateSimulation') {
      if (!body.simulationId) return jsonError('simulationId obrigatorio', 400, req);
      const payload = {};
      for (const k of ['borrower', 'items', 'creditBankAccount', 'step', 'files', 'note', 'brokerId']) {
        if (body[k] !== undefined) payload[k] = body[k];
      }
      const r = await fa('PUT', `/v3/loan-inss-simulations/${body.simulationId}`, payload);
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    // Duplica simulação
    if (action === 'copySimulation') {
      if (!body.simulationId) return jsonError('simulationId obrigatorio', 400, req);
      const r = await fa('POST', `/v3/loan-inss-simulations/${body.simulationId}/copy`, body.payload || {});
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    // ═══════════════════════════════════════════════════════════
    // TERMO DE AUTORIZAÇÃO INSS/DATAPREV (opt-in)
    // ═══════════════════════════════════════════════════════════

    if (action === 'getAuthTerm') {
      if (!body.simulationId) return jsonError('simulationId obrigatorio', 400, req);
      const r = await fa('GET', `/v3/loan-inss-simulations/${body.simulationId}/auth-term`);
      return j({
        success: r.ok, httpStatus: r.status,
        authTermKey: r.data?.key || null,
        signed: r.data?.status?.key === 'signed',
        status: r.data?.status || null,
        content: r.data?.content || null,
        _raw: r.data,
      }, 200, req);
    }

    if (action === 'signTerm') {
      if (!body.authTermKey) return jsonError('authTermKey obrigatorio', 400, req);
      const payload = {
        position: {
          latitude: body.latitude || '-235489',
          longitude: body.longitude || '-466388',
        },
      };
      const r = await fa('PUT', `/v3/signer/${body.authTermKey}/accept`, payload);
      return j({
        success: r.ok, httpStatus: r.status,
        signed: r.data?.status?.key === 'signed',
        status: r.data?.status || null,
        ...r.data,
      }, 200, req);
    }

    // ═══════════════════════════════════════════════════════════
    // CONSULTA SALDO INSS (DATAPREV)
    // ═══════════════════════════════════════════════════════════

    // Disparo assíncrono (recomendado em produção)
    if (action === 'in100' || action === 'queryBalance') {
      const cpf = (body.cpf || body.identity || '').replace(/\D/g, '');
      const ben = (body.beneficio || body.benefitNumber || '').replace(/\D/g, '');
      if (!cpf || !ben) return jsonError('CPF e beneficio obrigatorios', 400, req);
      const payload = {
        identity: cpf,
        benefitNumber: ben,
        lastDays: body.lastDays ?? 0,
        attempts: body.attempts ?? 3,
      };
      if (body.lastHours !== undefined) payload.lastHours = body.lastHours;
      if (body.timeout !== undefined) payload.timeout = body.timeout;
      const r = await fa('POST', '/v3/query-inss-balances/finder', payload);
      return j({
        success: r.ok, httpStatus: r.status,
        queryId: r.data?.id || null,
        status: r.data?.status || null,
        queryDate: r.data?.queryDate || null,
        ...r.data,
      }, 200, req);
    }

    // Disparo síncrono (espera saldo voltar)
    if (action === 'in100Sync' || action === 'queryBalanceSync') {
      const cpf = (body.cpf || body.identity || '').replace(/\D/g, '');
      const ben = (body.beneficio || body.benefitNumber || '').replace(/\D/g, '');
      if (!cpf || !ben) return jsonError('CPF e beneficio obrigatorios', 400, req);
      const payload = {
        identity: cpf,
        benefitNumber: ben,
        lastDays: body.lastDays ?? 0,
        attempts: body.attempts ?? 3,
      };
      const r = await fa('POST', '/v3/query-inss-balances/finder/await', payload);
      const d = r.data || {};
      return j({
        success: r.ok, httpStatus: r.status,
        cpf, beneficio: ben,
        nome: d.name || null,
        status: d.status || null,
        benefitStatus: d.benefitStatus || d.benefitSituation || null,
        elegivel: d.benefitStatus === 'elegible' || d.benefitSituation === 'active',
        bloqueado: (d.blockType && d.blockType !== 'not_blocked') || false,
        tipoBlock: d.blockType || null,
        especie: d.assistanceType || null,
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
        uf: d.state || null,
        dataNascimento: d.birthDate || null,
        dataConcessao: d.grantDate || null,
        queryDate: d.queryDate || null,
        _raw: d,
      }, 200, req);
    }

    // Consulta saldo INSS por ID (resultado de disparo assíncrono)
    if (action === 'getBalance') {
      if (!body.queryId) return jsonError('queryId obrigatorio', 400, req);
      const r = await fa('GET', `/v3/query-inss-balances/${body.queryId}`);
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    // ═══════════════════════════════════════════════════════════
    // LOANS (PROPOSTAS DIGITADAS)
    // ═══════════════════════════════════════════════════════════

    // Gera contratos (cria Loans a partir da simulação aceita)
    if (action === 'generateContracts' || action === 'createLoans') {
      if (!body.simulationId) return jsonError('simulationId obrigatorio', 400, req);
      const r = await fa('POST', `/v3/loan-inss-simulations/${body.simulationId}/actions`, { command: 'create_loans' });
      return j({
        success: r.ok, httpStatus: r.status,
        status: r.data?.status || null,
        signature: r.data?.signature || null,
        items: r.data?.items || [],
        ...r.data,
      }, 200, req);
    }

    if (action === 'getLoansBySimulation') {
      if (!body.simulationId) return jsonError('simulationId obrigatorio', 400, req);
      const r = await fa('GET', `/v3/loans/simulation/${body.simulationId}`);
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    if (action === 'getLoan') {
      if (!body.loanId) return jsonError('loanId obrigatorio', 400, req);
      const r = await fa('GET', `/v3/loans/${body.loanId}`);
      const d = r.data || {};
      return j({
        success: r.ok, httpStatus: r.status,
        id: d.id, code: d.code,
        product: d.product, rule: d.rule,
        borrower: d.borrower ? { name: d.borrower.name, cpf: d.borrower.identity, benefit: d.borrower.benefit } : null,
        status: d.status, operationStatus: d.operationStatus, proposalStatus: d.proposalStatus,
        contractNumber: d.contractNumber, proposalDate: d.proposalDate, creditDate: d.creditDate,
        loanValue: d.loanValue, netValue: d.netValue, installmentValue: d.installmentValue,
        term: d.term, rate: d.rate, signature: d.signature,
        _raw: d,
      }, 200, req);
    }

    if (action === 'getLoanByContract') {
      if (!body.contractNumber) return jsonError('contractNumber obrigatorio', 400, req);
      const r = await fa('GET', `/v3/loans/contract-number/${body.contractNumber}`);
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    if (action === 'searchLoans') {
      // Filtros suportados: { simulationId: { eq: "..." } }, { referenceCode: { eq: "..." } },
      //                    { searchText, filters, offset, limit, scrollId }
      const payload = {};
      for (const k of ['simulationId', 'referenceCode', 'searchText', 'filters', 'offset', 'limit', 'scrollId']) {
        if (body[k] !== undefined) payload[k] = body[k];
      }
      const r = await fa('POST', '/v3/loans/search', payload);
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    // Recalcula loan (quando saldo INSS volta diferente do esperado, ajusta valores)
    if (action === 'recalculate' || action === 'recalcular') {
      if (!body.loanId) return jsonError('loanId obrigatorio', 400, req);
      const payload = {
        ruleId: body.ruleId,
        hasInsurance: body.hasInsurance || false,
      };
      if (body.refinance) payload.refinance = body.refinance;
      if (body.term !== undefined) payload.term = body.term;
      if (body.rate !== undefined) payload.rate = body.rate;
      if (body.installmentValue !== undefined) payload.installmentValue = body.installmentValue;
      if (body.loanValue !== undefined) payload.loanValue = body.loanValue;
      const r = await fa('POST', `/v3/loans/${body.loanId}/recalculation`, payload);
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    // Aceita loan (após recalculo bater com expectativa)
    if (action === 'acceptLoan' || action === 'aceitar') {
      if (!body.loanId) return jsonError('loanId obrigatorio', 400, req);
      const r = await fa('POST', `/v3/loans/${body.loanId}/accept`, body.payload || {});
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    // Reformaliza loan (refaz contrato/assinatura)
    if (action === 'reformalize' || action === 'reformalizar') {
      if (!body.loanId) return jsonError('loanId obrigatorio', 400, req);
      const payload = {
        ruleId: body.ruleId,
        hasInsurance: body.hasInsurance || false,
        reformalize: true,
      };
      if (body.refinance) payload.refinance = body.refinance;
      if (body.term !== undefined) payload.term = body.term;
      if (body.rate !== undefined) payload.rate = body.rate;
      if (body.installmentValue !== undefined) payload.installmentValue = body.installmentValue;
      if (body.loanValue !== undefined) payload.loanValue = body.loanValue;
      const r = await fa('POST', `/v3/loans/${body.loanId}/reformalize`, payload);
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    // Análise de crédito
    if (action === 'getCreditAnalysis') {
      if (!body.creditAnalysisId) return jsonError('creditAnalysisId obrigatorio', 400, req);
      const r = await fa('GET', `/v3/credit-analysis/${body.creditAnalysisId}`);
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    // ═══════════════════════════════════════════════════════════
    // FGTS — SAQUE-ANIVERSÁRIO ANTECIPADO
    // ═══════════════════════════════════════════════════════════

    if (action === 'fgtsCreateSimulation') {
      if (!body.borrower) return jsonError('borrower obrigatorio', 400, req);
      const payload = {
        borrower: body.borrower,
        items: body.items || [],
        creditBankAccount: body.creditBankAccount || null,
        step: body.step || { code: 0, name: null },
        files: body.files || [],
        note: body.note || null,
        brokerId: body.brokerId || null,
      };
      const r = await fa('POST', '/v3/loan-fgts-simulations', payload);
      return j({
        success: r.ok, httpStatus: r.status,
        simulationId: r.data?.id || null,
        status: r.data?.status || null,
        ...r.data,
      }, 200, req);
    }

    if (action === 'fgtsGetSimulation') {
      if (!body.simulationId) return jsonError('simulationId obrigatorio', 400, req);
      const r = await fa('GET', `/v3/loan-fgts-simulations/${body.simulationId}`);
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    if (action === 'fgtsActions' || action === 'fgtsCreateLoans') {
      if (!body.simulationId) return jsonError('simulationId obrigatorio', 400, req);
      const command = body.command || 'create_loans';
      const r = await fa('POST', `/v3/loan-fgts-simulations/${body.simulationId}/actions`, { command });
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    if (action === 'fgtsCopy') {
      if (!body.simulationId) return jsonError('simulationId obrigatorio', 400, req);
      const r = await fa('POST', `/v3/loan-fgts-simulations/${body.simulationId}/copy`, body.payload || {});
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    // ═══════════════════════════════════════════════════════════
    // CONSIGNADO PRIVADO (CLT) — providers: QITech 950002, 321Bank 950703
    // ═══════════════════════════════════════════════════════════

    if (action === 'cltCreateSimulation') {
      const providerCode = body.providerCode || '950002';
      if (!body.borrower) return jsonError('borrower obrigatorio', 400, req);
      const r = await fa('POST', `/v3/loan-private-payroll-simulations/providers/${providerCode}`, {
        borrower: body.borrower,
        creditMethod: body.creditMethod ?? 0,
        creditBankAccount: body.creditBankAccount || null,
      });
      return j({
        success: r.ok, httpStatus: r.status,
        simulationId: r.data?.id || r.data?.simulationId || null,
        employmentRelationships: r.data?.employmentRelationships || [],
        temVinculo: (r.data?.employmentRelationships || []).length > 0,
        _raw: r.data,
        ...r.data,
      }, 200, req);
    }

    if (action === 'cltAuthTerm') {
      if (!body.simulationId) return jsonError('simulationId obrigatorio', 400, req);
      const r = await fa('GET', `/v3/loan-private-payroll-simulations/${body.simulationId}/auth-term`);
      return j({
        success: r.ok, httpStatus: r.status,
        authTermKey: r.data?.key || null,
        signed: r.data?.status?.key === 'signed',
        status: r.data?.status || null,
        content: r.data?.content || null,
        _raw: r.data,
      }, 200, req);
    }

    if (action === 'cltSignTerm') {
      if (!body.authTermKey) return jsonError('authTermKey obrigatorio', 400, req);
      const r = await fa('PUT', `/v3/signer/${body.authTermKey}/accept`, {
        position: { latitude: body.latitude || '-235489', longitude: body.longitude || '-466388' },
      });
      return j({
        success: r.ok, httpStatus: r.status,
        signed: r.data?.status?.key === 'signed',
        status: r.data?.status || null,
        ...r.data,
      }, 200, req);
    }

    if (action === 'cltCalculate') {
      if (!body.simulationId) return jsonError('simulationId obrigatorio', 400, req);
      const payload = {
        type: body.type ?? 1,
        identity: (body.identity || body.cpf || '').replace(/\D/g, ''),
        ruleId: body.ruleId,
        term: body.term,
        rate: body.rate,
        installmentValue: body.installmentValue ?? 0,
        registrationNumber: body.registrationNumber,
        employerDocument: (body.employerDocument || '').replace(/\D/g, ''),
        employerName: body.employerName,
        isInitialCalculation: body.isInitialCalculation !== false,
      };
      const r = await fa('POST', `/v3/loan-private-payroll-simulations/${body.simulationId}/calculation`, payload);
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    if (action === 'cltSelectCondition') {
      if (!body.simulationId || !body.items) return jsonError('simulationId e items obrigatorios', 400, req);
      const r = await fa('PUT', `/v3/loan-private-payroll-simulations/${body.simulationId}`, { items: body.items });
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    if (action === 'cltCreateLoans') {
      if (!body.simulationId) return jsonError('simulationId obrigatorio', 400, req);
      const r = await fa('POST', `/v3/loan-private-payroll-simulations/${body.simulationId}/actions`, { command: 'create_loans' });
      return j({
        success: r.ok, httpStatus: r.status,
        signature: r.data?.signature || null,
        items: r.data?.items || [],
        status: r.data?.status || null,
        ...r.data,
      }, 200, req);
    }

    // Fluxo consolidado (4 passos em 1) — mesmo padrão do joinbank.js
    if (action === 'cltCheckEligibility') {
      const providerCode = body.providerCode || '950002';
      if (!body.borrower?.identity || !body.borrower?.name || !body.borrower?.birthDate) {
        return j({
          success: false, disponivel: false,
          motivo: 'Faltam dados básicos do cliente (CPF, nome ou data de nascimento)',
        }, 200, req);
      }
      // Passo 1: cria simulacao
      const r1 = await fa('POST', `/v3/loan-private-payroll-simulations/providers/${providerCode}`, {
        borrower: body.borrower, creditMethod: 0, creditBankAccount: null,
      });
      const d1 = r1.data || {};
      const simulationId = d1.id || d1.simulationId || null;
      if (!r1.ok || !simulationId) {
        const errs = Array.isArray(d1.errors) ? d1.errors.map(e => e.message || e.title || JSON.stringify(e)).join('; ') : null;
        const motivo = d1.title || d1.detail || d1.message || errs || d1.refusalReason ||
          (r1.status ? `Erro HTTP ${r1.status}` : 'Falha ao criar simulacao');
        return j({ success: false, disponivel: false, motivo, _raw: d1 }, 200, req);
      }
      // Passo 2: auth-term
      const r2 = await fa('GET', `/v3/loan-private-payroll-simulations/${simulationId}/auth-term`);
      const d2 = r2.data || {};
      const authTermKey = d2.key || null;
      const jaAssinado = d2.status?.key === 'signed';
      // Passo 3: sign-term (se ainda não assinado)
      if (authTermKey && !jaAssinado) {
        await fa('PUT', `/v3/signer/${authTermKey}/accept`, {
          position: { latitude: '-235489', longitude: '-466388' },
        }).catch(() => {});
      }
      // Passo 4: re-cria simulacao apos assinatura (vinculos populados)
      const r3 = await fa('POST', `/v3/loan-private-payroll-simulations/providers/${providerCode}`, {
        borrower: body.borrower, creditMethod: 0, creditBankAccount: null,
      });
      const d3 = r3.data || d1;
      const simulationIdFinal = d3.id || d3.simulationId || simulationId;
      const vinculos = d3.employmentRelationships || [];
      if (!vinculos.length) {
        return j({
          success: true, disponivel: false,
          motivo: 'Sem vinculo CLT elegivel pra este banco',
          simulationId: simulationIdFinal,
          _termoAssinado: !!authTermKey,
        }, 200, req);
      }
      const v = vinculos[0];
      const margemReal = parseFloat(
        v.availableMargin || v.available_margin || v.availableMarginValue ||
        v.margin || v.marginValue || v.marginAvailable || v.margem || 0,
      ) || 0;
      return j({
        success: true, disponivel: true,
        simulationId: simulationIdFinal,
        vinculo: {
          empregador: v.employerName,
          empregadorCnpj: v.employerDocument,
          matricula: v.registrationNumber,
          renda: v.salary,
          margemDisponivel: margemReal,
        },
        _raw: d3,
      }, 200, req);
    }

    // ═══════════════════════════════════════════════════════════
    // DRIVE (UPLOAD DE ARQUIVOS) — usado pra anexar docs na simulação
    // ═══════════════════════════════════════════════════════════

    if (action === 'driveUploadByUrl') {
      if (!body.url) return jsonError('url obrigatoria', 400, req);
      const r = await fad('POST', '/v3/files/upload-by-url', { url: body.url });
      return j({
        success: r.ok, httpStatus: r.status,
        fileId: r.data?.id || null,
        ...r.data,
      }, 200, req);
    }

    if (action === 'driveGetFile') {
      if (!body.fileId) return jsonError('fileId obrigatorio', 400, req);
      const r = await fad('GET', `/v3/files/${body.fileId}`);
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    // ═══════════════════════════════════════════════════════════
    // ADMINISTRAÇÃO (accounts, partners, stores, brokers, users)
    // ═══════════════════════════════════════════════════════════

    if (action === 'listBrokers') {
      const qs = body.searchText ? `?searchText=${encodeURIComponent(body.searchText)}` : '';
      const r = await fa('GET', `/v3/brokers${qs}`);
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    if (action === 'listAccounts') {
      const qs = body.searchText ? `?searchText=${encodeURIComponent(body.searchText)}` : '';
      const r = await fa('GET', `/v3/accounts${qs}`);
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    if (action === 'listPartners') {
      const qs = body.searchText ? `?searchText=${encodeURIComponent(body.searchText)}` : '';
      const r = await fa('GET', `/v3/partners${qs}`);
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    if (action === 'listStores') {
      const qs = body.searchText ? `?searchText=${encodeURIComponent(body.searchText)}` : '';
      const r = await fa('GET', `/v3/stores${qs}`);
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    // ═══════════════════════════════════════════════════════════
    // ESCAPE HATCH — chamada genérica (debug/exploração)
    // ═══════════════════════════════════════════════════════════

    if (action === 'rawCall') {
      if (!body.method || !body.path) return jsonError('method e path obrigatorios', 400, req);
      const r = await fa(body.method.toUpperCase(), body.path, body.payload);
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    return jsonError('action invalida', 400, req);
  } catch (err) {
    console.error('[FINANTO] erro interno:', err?.message, err?.stack);
    return j({
      error: 'Erro interno',
      mensagem: err?.message || 'Erro nao especificado',
      stack: (err?.stack || '').substring(0, 500),
    }, 500, req);
  }
}
