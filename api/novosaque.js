// ══════════════════════════════════════════════════════════════════
// api/novosaque.js — NovoSaque (antecipação saque-aniversário FGTS)
// Doc: https://developers.novosaque.com.br/
//
// Auth: header  X-Api-Key: <chave>   (env NOVOSAQUE_API_KEY)
// Base: NOVOSAQUE_BASE_URL (default sandbox https://api.novosaque.dev.br)
//
// Fluxo FGTS (product = FGTS):
//   1. fgtsSimular   → GET  /partners-api/contracts/FGTS/simulation?document={cpf}
//                      inicia a transação (check-balance → simulation) e
//                      retorna { contract: <transaction_id> }.
//   2. fgtsContrato  → GET  /partners-api/contracts/FGTS/contract/{transaction_id}
//                      status do fluxo + resultados da simulação (líquido,
//                      parcelas, contract_link de assinatura).  A consulta é
//                      assíncrona — dá pra fazer polling neste endpoint.
//   3. fgtsResimular → PUT  /partners-api/contracts/FGTS/simulation/{transaction_id}
//   4. fgtsFormalizar→ POST /partners-api/contracts/FGTS/contract/{transaction_id}/formalization
//
// Pré-requisito do cliente: saque-aniversário ativo + NovoSaque autorizada
// no app FGTS da Caixa (senão a etapa check-balance falha).
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';

function getConfig() {
  return {
    apiKey: (process.env.NOVOSAQUE_API_KEY || '').trim(),
    baseUrl: (process.env.NOVOSAQUE_BASE_URL || 'https://api.novosaque.dev.br').trim().replace(/\/+$/, ''),
  };
}

// Helper de request autenticado (X-Api-Key). Retorna { ok, status, data }.
async function ns(path, { method = 'GET', body = null } = {}) {
  const cfg = getConfig();
  if (!cfg.apiKey) {
    return { ok: false, status: 0, data: { success: false, error: 'NOVOSAQUE_API_KEY nao configurada no Vercel' } };
  }
  const headers = { 'Accept': 'application/json', 'X-Api-Key': cfg.apiKey };
  const opts = { method, headers };
  if (body && method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  try {
    const r = await fetch(cfg.baseUrl + path, opts);
    const t = await r.text();
    let d; try { d = t ? JSON.parse(t) : {}; } catch { d = { raw: t.substring(0, 2000) }; }
    return { ok: r.ok, status: r.status, data: d };
  } catch (e) {
    return { ok: false, status: 0, data: { success: false, error: e.message } };
  }
}

const j = (data, status = 200, req = null) => jsonResp(data, status, req);

// Extrai o resultado de simulação (líquido/parcelas) de onde estiver disponível
// no contrato — os campos aparecem em lugares diferentes conforme a etapa.
function extrairSimulacao(contract) {
  if (!contract || typeof contract !== 'object') return null;
  const csr = contract.contract_simulation_results;
  const sr0 = Array.isArray(contract.simulation_results) ? contract.simulation_results[0] : null;
  const fonte = (csr && (csr.net_value_credit != null || csr.disbursed_amount != null)) ? csr : sr0;
  if (!fonte) return null;
  return {
    simulationId: fonte.simulation_id || null,
    tabela: fonte.table_name || null,
    liquido: fonte.net_value_credit ?? fonte.disbursed_amount ?? null,
    valorFinanciado: fonte.financed_amount ?? fonte.total_loan_amount ?? null,
    parcelas: fonte.installments ?? null,
    saldoDevedor: fonte.outstanding_balance ?? null,
    taxaMensal: fonte.interest_rate_monthly ?? null,
    cetMensal: fonte.cet_monthly_rate ?? null,
    iof: fonte.total_iof ?? null,
  };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  try {
    const body = req.method === 'POST' ? await req.json() : {};
    const action = body.action || '';
    const product = (body.product || 'FGTS').toUpperCase();

    // ─── TEST / DIAG ──────────────────────────────────────────
    if (action === 'test' || action === 'diag') {
      const cfg = getConfig();
      return j({
        success: !!cfg.apiKey,
        baseUrl: cfg.baseUrl,
        hasKey: !!cfg.apiKey,
        keyLen: cfg.apiKey.length,
        mensagem: cfg.apiKey ? 'NovoSaque configurada' : 'Configure NOVOSAQUE_API_KEY no Vercel',
      }, 200, req);
    }

    // ─── 1) INICIAR SIMULAÇÃO FGTS ────────────────────────────
    // GET /partners-api/contracts/{product}/simulation?document={cpf}
    if (action === 'fgtsSimular' || action === 'iniciarSimulacao') {
      const cpf = String(body.cpf || body.document || '').replace(/\D/g, '');
      if (cpf.length !== 11) return jsonError('cpf invalido (11 digitos)', 400, req);
      const r = await ns(`/partners-api/contracts/${product}/simulation?document=${cpf}`);
      const d = r.data || {};
      return j({
        success: !!d.success && r.ok,
        httpStatus: r.status,
        transactionId: d.contract || d.transaction_id || null,
        erro: d.success === false ? (d.error || null) : null,
        invalidFields: d.invalid_fields || null,
        _raw: d,
      }, 200, req);
    }

    // ─── 2) BUSCAR CONTRATO / STATUS DO FLUXO ─────────────────
    // GET /partners-api/contracts/{product}/contract/{transaction_id}
    if (action === 'fgtsContrato' || action === 'buscarContrato') {
      const tid = body.transactionId || body.transaction_id;
      if (!tid) return jsonError('transactionId obrigatorio', 400, req);
      const r = await ns(`/partners-api/contracts/${product}/contract/${encodeURIComponent(tid)}`);
      const d = r.data || {};
      const c = d.contract || {};
      const sim = extrairSimulacao(c);
      const stage = c.stage || null;
      const summary = c.summary_status || c.status_description || null;
      const temLiquido = sim && (sim.liquido ?? 0) > 0;
      // Oferta pronta = líquido calculado disponível
      const ofertaPronta = temLiquido || /offer available|oferta dispon/i.test(String(summary || ''));
      // "Offer unavailable" / sem oferta = TERMINAL (não adianta seguir consultando).
      // O balance check pode ter passado, mas não há saldo/oferta pra antecipar.
      const semOferta = !temLiquido && /unavailable|indispon|sem oferta|n[aã]o dispon/i.test(String(summary || ''));
      const erroDuro = /error|falha|reprov|reject|denied/i.test(String(summary || '')) || d.success === false;
      const falhou = semOferta || erroDuro;
      return j({
        success: !!d.success && r.ok,
        httpStatus: r.status,
        transactionId: c.transaction_id || tid,
        stage,
        summaryStatus: summary,
        ofertaPronta,
        semOferta,
        falhou,
        balanceOk: c.balance_check_result?.success ?? null,
        contractLink: c.contract_link || null,
        contractNumber: c.contract_number || null,
        simulacao: sim,
        customerData: c.customer_data || null,
        _raw: d,
      }, 200, req);
    }

    // ─── 3) RE-SIMULAÇÃO (ajusta parâmetros) ──────────────────
    // PUT /partners-api/contracts/{product}/simulation/{transaction_id}
    if (action === 'fgtsResimular' || action === 'resimular') {
      const tid = body.transactionId || body.transaction_id;
      if (!tid) return jsonError('transactionId obrigatorio', 400, req);
      const payload = {};
      for (const k of ['card_kind', 'liquid_amount', 'installment_value', 'total_amount_owed', 'installments', 'interest_rate']) {
        if (body[k] !== undefined) payload[k] = body[k];
      }
      const r = await ns(`/partners-api/contracts/${product}/simulation/${encodeURIComponent(tid)}`, { method: 'PUT', body: payload });
      const d = r.data || {};
      return j({ success: !!d.success && r.ok, httpStatus: r.status, transactionId: d.transaction_id || tid, erro: d.error || null, _raw: d }, 200, req);
    }

    // ─── 4) INICIAR FORMALIZAÇÃO ──────────────────────────────
    // POST /partners-api/contracts/{product}/contract/{transaction_id}/formalization
    if (action === 'fgtsFormalizar' || action === 'formalizar') {
      const tid = body.transactionId || body.transaction_id;
      if (!tid || !body.simulationId || !body.customerData) {
        return jsonError('transactionId, simulationId e customerData obrigatorios', 400, req);
      }
      const payload = {
        transaction_id: tid,
        simulation_id: body.simulationId,
        customer_data: body.customerData,
      };
      const r = await ns(`/partners-api/contracts/${product}/contract/${encodeURIComponent(tid)}/formalization`, { method: 'POST', body: payload });
      const d = r.data || {};
      return j({ success: !!d.success && r.ok, httpStatus: r.status, mensagem: d.message || null, erro: d.error || null, _raw: d }, 200, req);
    }

    // ─── RAW (probe genérico) ─────────────────────────────────
    if (action === 'rawCall') {
      if (!body.path) return jsonError('path obrigatorio', 400, req);
      const r = await ns(body.path, { method: (body.method || 'GET').toUpperCase(), body: body.body || null });
      return j({ httpStatus: r.status, ok: r.ok, data: r.data }, 200, req);
    }

    return jsonError('action invalida. Disponiveis: test, fgtsSimular, fgtsContrato, fgtsResimular, fgtsFormalizar, rawCall', 400, req);
  } catch (err) {
    console.error('[novosaque] erro:', err?.message);
    return jsonResp({ error: 'Erro interno', message: err?.message || String(err) }, 500, req);
  }
}
