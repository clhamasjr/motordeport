export const config = { runtime: 'edge' };

// ═══ CREDENTIALS (update when confirmed) ═══
const JB_URL = 'https://integration.ajin.io';
const JB_KEY = 'a8UhKEOC85SS+dMTWkWwKfl7mAYde9hR2UJ/p52yAYOt0Urx4vpFqmsXWGQNHPyj';

const H = { 'Content-Type': 'application/json', 'apikey': JB_KEY };

async function jb(method, path, body) {
  const opts = { method, headers: { ...H } };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const r = await fetch(JB_URL + path, opts);
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 2000) }; }
  return { ok: r.ok, status: r.status, data: d };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,GET', 'Access-Control-Allow-Headers': 'Content-Type' } });
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  try {
    const body = req.method === 'POST' ? await req.json() : {};
    const action = body.action || '';

    // ═══ PRODUCTS & RULES ═══

    // List products by type and operation
    // body: { type: 20, operation: 1 }
    if (action === 'listProducts') {
      const r = await jb('POST', '/v3/loan-products/search/basic', {
        type: { code: { eq: body.type || 20 } },
        operation: { code: { eq: body.operation || 1 } }
      });
      return new Response(JSON.stringify({ success: r.ok, ...r.data }), { headers: cors });
    }

    // List rules/tables by operation
    // body: { operation: 1 }
    if (action === 'listRules') {
      const r = await jb('POST', '/v3/loan-product-rules/search/basic', {
        offset: body.offset || 0,
        limit: body.limit || 20,
        operation: { code: { eq: body.operation || 1 } }
      });
      return new Response(JSON.stringify({ success: r.ok, ...r.data }), { headers: cors });
    }

    // ═══ IN100 ═══

    // Query IN100 (DATAPREV)
    // body: { cpf, beneficio, lastHours?, timeout? }
    if (action === 'in100') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      const ben = (body.beneficio || '').replace(/\D/g, '');
      if (!cpf || !ben) return new Response(JSON.stringify({ error: 'CPF e benefício obrigatórios' }), { status: 400, headers: cors });
      const r = await jb('POST', '/v3/query-inss-balances/finder', {
        identity: cpf,
        benefitNumber: ben,
        lastHours: body.lastHours || 24,
        timeout: body.timeout || 120
      });
      // Normalize response
      const d = r.data;
      return new Response(JSON.stringify({
        success: r.ok,
        cpf,
        beneficio: ben,
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
        _raw: d
      }), { headers: cors });
    }

    // ═══ SIMULATION / CALCULATION ═══

    // Calculate (preview before creating)
    // body: { ruleId, term, rate, installmentValue, loanValue, hasInsurance, originContract? }
    if (action === 'calculate') {
      const payload = {
        ruleId: body.ruleId,
        term: body.term,
        rate: body.rate,
        installmentValue: body.installmentValue,
        loanValue: body.loanValue,
        hasInsurance: body.hasInsurance || false,
        referenceCode: body.referenceCode || null
      };
      // Add originContract for portability operations
      if (body.originContract) {
        payload.originContract = {
          lenderCode: body.originContract.lenderCode,
          contractNumber: body.originContract.contractNumber,
          term: body.originContract.term,
          installmentsRemaining: body.originContract.installmentsRemaining,
          installmentValue: body.originContract.installmentValue,
          dueBalanceValue: body.originContract.dueBalanceValue
        };
      }
      const r = await jb('POST', '/v3/loan-inss-simulations/calculation', payload);
      return new Response(JSON.stringify({ success: r.ok, ...r.data }), { headers: cors });
    }

    // ═══ CREATE PROPOSAL ═══

    // Create simulation/proposal
    // body: { borrower, items, creditBankAccount, files, step }
    if (action === 'createProposal') {
      const r = await jb('POST', '/v3/loan-inss-simulations', {
        borrower: body.borrower,
        items: body.items,
        creditBankAccount: body.creditBankAccount || null,
        step: body.step || { code: 0, name: null },
        files: body.files || [],
        note: body.note || null,
        brokerId: body.brokerId || null,
        accessId: body.accessId || null
      });
      return new Response(JSON.stringify({ success: r.ok, simulationId: r.data.id, code: r.data.code, status: r.data.status, ...r.data }), { headers: cors });
    }

    // ═══ AUTH TERM & SIGNING ═══

    // Get auth term
    // body: { simulationId }
    if (action === 'getAuthTerm') {
      if (!body.simulationId) return new Response(JSON.stringify({ error: 'simulationId obrigatório' }), { status: 400, headers: cors });
      const r = await jb('GET', `/v3/loan-inss-simulations/${body.simulationId}/auth-term`);
      return new Response(JSON.stringify({
        success: r.ok,
        key: r.data.key || null,
        signed: r.data.status && r.data.status.key === 'signed',
        content: r.data.content || null,
        status: r.data.status || null,
        _raw: r.data
      }), { headers: cors });
    }

    // Sign auth term
    // body: { authTermKey, latitude?, longitude? }
    if (action === 'signTerm') {
      if (!body.authTermKey) return new Response(JSON.stringify({ error: 'authTermKey obrigatório' }), { status: 400, headers: cors });
      const r = await jb('PUT', `/v3/signer/${body.authTermKey}/accept`, {
        position: {
          latitude: body.latitude || '-235489',
          longitude: body.longitude || '-466388'
        }
      });
      return new Response(JSON.stringify({
        success: r.ok,
        signed: r.data.status && r.data.status.key === 'signed',
        status: r.data.status || null,
        ...r.data
      }), { headers: cors });
    }

    // ═══ GENERATE CONTRACTS ═══

    // Generate loans from simulation
    // body: { simulationId }
    if (action === 'generateContracts') {
      if (!body.simulationId) return new Response(JSON.stringify({ error: 'simulationId obrigatório' }), { status: 400, headers: cors });
      const r = await jb('POST', `/v3/loan-inss-simulations/${body.simulationId}/actions`, {
        command: 'create_loans'
      });
      return new Response(JSON.stringify({
        success: r.ok,
        status: r.data.status || null,
        signature: r.data.signature || null,
        items: r.data.items || [],
        ...r.data
      }), { headers: cors });
    }

    // ═══ LOAN TRACKING (ESTEIRA) ═══

    // Get loans by simulation ID
    // body: { simulationId }
    if (action === 'getLoansBySimulation') {
      if (!body.simulationId) return new Response(JSON.stringify({ error: 'simulationId obrigatório' }), { status: 400, headers: cors });
      const r = await jb('GET', `/v3/loans/simulation/${body.simulationId}`);
      return new Response(JSON.stringify({ success: r.ok, ...r.data }), { headers: cors });
    }

    // Get loan details by ID
    // body: { loanId }
    if (action === 'getLoan') {
      if (!body.loanId) return new Response(JSON.stringify({ error: 'loanId obrigatório' }), { status: 400, headers: cors });
      const r = await jb('GET', `/v3/loans/${body.loanId}`);
      return new Response(JSON.stringify({
        success: r.ok,
        id: r.data.id,
        code: r.data.code,
        product: r.data.product,
        rule: r.data.rule,
        borrower: r.data.borrower ? { name: r.data.borrower.name, cpf: r.data.borrower.identity, benefit: r.data.borrower.benefit } : null,
        status: r.data.status,
        operationStatus: r.data.operationStatus,
        proposalStatus: r.data.proposalStatus,
        contractNumber: r.data.contractNumber,
        proposalDate: r.data.proposalDate,
        creditDate: r.data.creditDate,
        loanValue: r.data.loanValue,
        netValue: r.data.netValue,
        installmentValue: r.data.installmentValue,
        term: r.data.term,
        rate: r.data.rate,
        signature: r.data.signature,
        _raw: r.data
      }), { headers: cors });
    }

    // Recalculate loan (approval)
    // body: { loanId, ruleId, term, rate, installmentValue, loanValue }
    if (action === 'recalculate') {
      if (!body.loanId) return new Response(JSON.stringify({ error: 'loanId obrigatório' }), { status: 400, headers: cors });
      const r = await jb('POST', `/v3/loans/${body.loanId}/recalculation`, {
        ruleId: body.ruleId,
        term: body.term,
        rate: body.rate,
        installmentValue: body.installmentValue,
        loanValue: body.loanValue,
        hasInsurance: body.hasInsurance || false
      });
      return new Response(JSON.stringify({ success: r.ok, ...r.data }), { headers: cors });
    }

    // ═══ FILES (for document upload) ═══

    // Upload file
    // This would need multipart handling - placeholder for now
    if (action === 'uploadFile') {
      return new Response(JSON.stringify({ error: 'Upload de arquivos requer implementação multipart - use o painel Quali para upload' }), { status: 501, headers: cors });
    }

    // ═══ ABOUT / TEST ═══

    if (action === 'test') {
      const r = await jb('POST', '/v3/loan-products/search/basic', {
        type: { code: { eq: 20 } },
        operation: { code: { eq: 1 } }
      });
      return new Response(JSON.stringify({
        apiActive: r.ok,
        httpStatus: r.status,
        productsFound: r.data.items ? r.data.items.length : 0,
        message: r.ok ? 'API JoinBank ativa!' : 'Erro de autenticação - verificar API Key',
        _raw: r.data
      }), { headers: cors });
    }

    return new Response(JSON.stringify({ error: 'action inválida', validActions: [
      'test', 'listProducts', 'listRules', 'in100', 'calculate',
      'createProposal', 'getAuthTerm', 'signTerm', 'generateContracts',
      'getLoansBySimulation', 'getLoan', 'recalculate'
    ] }), { status: 400, headers: cors });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, stack: err.stack?.substring(0, 500) }), { status: 500, headers: cors });
  }
}
