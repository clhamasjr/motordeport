// ══════════════════════════════════════════════════════════════════
// api/unno.js — Unno Tech: Consignado CLT (CONSULTA DE STATUS)
//
// ESTRATEGIA: O motor NAO CRIA proposta na Unno. Operador cria
// manualmente no painel app.unnotech.com.br (formulario "Nova
// Simulacao"). Aqui apenas LEMOS as propostas existentes e mostramos
// o status atual de cada CPF no card V2.
//
// Por que essa estrategia:
//   - Endpoint de criar proposta (/loan/api/v2/clt/draft) achado no
//     bundle JS retorna 404 no gateway publico — nao esta exposto.
//   - O fluxo deles exige autorizacao do cliente via link DataPrev/MTE
//     (nao da pra "consultar silenciosamente").
//   - Listar propostas (/proposal/api/v1/proposals?productType=
//     CONSIGNADO_CLT) funciona com nosso token e retorna status real.
//
// Status Unno mapeados (a partir das 44 propostas atuais da LhamasCred):
//   integrated                       → APROVADA (motor de risco passou)
//   disbursed                        → DESEMBOLSADA (contrato pago)
//   rejected_risk_analysis_automatic → RECUSADA (motor recusou)
//   cancelled                        → CANCELADA
//   <outros>                         → EM ANALISE (qualquer status nao
//                                       terminal — provavelmente em
//                                       andamento)
//
// Auth: login HUMANO (username+password) ate Unno disponibilizar
// credenciais OAuth2 service. JWT user-type, TTL ~4h.
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';

// ── Config ─────────────────────────────────────────────────────
function getConfig() {
  return {
    BASE: (process.env.UNNO_BASE_URL || 'https://gtw.unnotech.com.br').trim(),
    USER: (process.env.UNNO_USERNAME || '').trim(),
    PASS: (process.env.UNNO_PASSWORD || '').trim(),
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
    },
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const r = await fetch(cfg.BASE + path, opts);
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 2000) }; }
  return { ok: r.ok, status: r.status, data: d };
}

function onlyDigits(s) { return String(s || '').replace(/\D/g, ''); }

// ── Cache da lista de propostas (~30s) ─────────────────────────
// Edge function tem TTL curto, mas dentro da mesma instancia poupa
// chamadas repetidas pra Unno quando varios CPFs sao consultados
// sequencialmente. 30s eh suficiente: se operador criou simulacao
// nova, ele clica "re-tentar" e cache invalida.
let PROPOSALS_CACHE = { data: null, fetchedAt: 0 };
const PROPOSALS_TTL_MS = 30 * 1000;

async function listarPropostasCltCache() {
  const now = Date.now();
  if (PROPOSALS_CACHE.data && (now - PROPOSALS_CACHE.fetchedAt) < PROPOSALS_TTL_MS) {
    return PROPOSALS_CACHE.data;
  }
  // Filtro server-side por CPF nao funciona (Unno ignora silenciosamente
  // qualquer parametro de filtro alem de productType). Buscamos as 100
  // ultimas propostas CLT e filtramos client-side por customer_document.
  // Limite atual da conta: 44 propostas — entao size=100 cobre tudo.
  const r = await unnoCall(
    '/proposal/api/v1/proposals?size=100&sort=createdAt,desc&productType=CONSIGNADO_CLT',
    'GET'
  );
  if (!r.ok) {
    throw new Error(`Falha listar propostas Unno (HTTP ${r.status}): ${r.data?.error || r.data?.message || 'sem detalhes'}`);
  }
  PROPOSALS_CACHE = {
    data: r.data?.content || [],
    fetchedAt: now,
  };
  return PROPOSALS_CACHE.data;
}

// ── Mapeamento de status Unno → estado do card no motor V2 ─────
function interpretarStatus(prop) {
  const status = (prop.status || '').toLowerCase();
  const bpStatus = prop.bank_provider_status || '';

  // Terminais aprovados
  if (status === 'integrated' || status === 'disbursed') {
    return {
      approved: true,
      mensagem: status === 'disbursed'
        ? '💰 Aprovada e desembolsada na Unno'
        : '✅ Aprovada na Unno — pronta pra prosseguir no painel',
    };
  }

  // Terminais rejeitados
  if (status === 'rejected_risk_analysis_automatic' || status.startsWith('rejected')) {
    // Tenta extrair motivo dos logs (geralmente o ultimo log REJECTED tem motivo)
    const logs = prop.logs || [];
    const logRejeicao = logs.find(l =>
      (l.action || '').toLowerCase().includes('rejected') ||
      (l.action || '').toLowerCase().includes('erro reportado')
    );
    const motivo = logRejeicao
      ? (logRejeicao.action || '').replace(/^.*?:\s*/, '').substring(0, 150)
      : bpStatus || 'Recusada pelo motor de risco da Unno';
    return {
      approved: false,
      mensagem: `❌ ${motivo}`,
    };
  }

  // Cancelada
  if (status === 'cancelled' || status === 'canceled') {
    return {
      approved: false,
      mensagem: '🚫 Proposta cancelada na Unno',
    };
  }

  // Em andamento (qualquer status nao terminal — provavelmente analisando)
  return {
    approved: false,
    emAndamento: true,
    mensagem: `⏳ Em análise na Unno (status: ${prop.status || 'desconhecido'})`,
  };
}

// ── Action principal: consultar status de um CPF ───────────────
// Output: {
//   encontrado: bool,           // se achamos proposta pra esse CPF
//   approved: bool,             // se aprovada
//   emAndamento: bool,          // se ainda processando (operador deve aguardar)
//   mensagem: string,           // texto pra mostrar no card
//   status: string,             // status Unno raw
//   proposalUuid: string,       // pra debug
//   dadosCliente: {...},        // info extraida da proposta
//   linkPainel: string          // link direto pra abrir no painel Unno
// }
async function consultarStatusCpf(cpf) {
  const cpfLimpo = onlyDigits(cpf);
  if (!cpfLimpo || cpfLimpo.length !== 11) {
    return { encontrado: false, approved: false, error: 'CPF invalido' };
  }

  const propostas = await listarPropostasCltCache();
  // Filtra todas as propostas desse CPF — pode ter mais de uma
  // (canceladas + nova). Pega a MAIS RECENTE.
  const minhas = propostas
    .filter(p => onlyDigits(p.customer_document) === cpfLimpo)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  if (minhas.length === 0) {
    return {
      encontrado: false,
      approved: false,
      mensagem: 'Sem simulação na Unno pra esse CPF. Operador precisa criar no painel.',
      linkPainel: 'https://app.unnotech.com.br/loans/clt/simulations',
    };
  }

  const prop = minhas[0];
  const interpret = interpretarStatus(prop);

  return {
    encontrado: true,
    approved: interpret.approved,
    emAndamento: !!interpret.emAndamento,
    mensagem: interpret.mensagem,
    status: prop.status,
    proposalUuid: prop.uuid,
    bancoProvedor: prop.bank_provider_name,
    bancoProvedorStatus: prop.bank_provider_status,
    dadosCliente: {
      nome: prop.customer_name,
      cpf: prop.customer_document,
    },
    linkPainel: `https://app.unnotech.com.br/loans/clt/${prop.uuid}`,
    totalPropostasCpf: minhas.length, // se >1, tem historico (canceladas + ativa)
  };
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
      // Healthcheck: login + count de propostas CLT
      const propostas = await listarPropostasCltCache().catch(e => ({ _err: e.message }));
      const count = Array.isArray(propostas) ? propostas.length : null;
      return jsonResp({
        success: count !== null,
        login: 'ok',
        totalPropostas: count,
        erro: propostas?._err || null,
      }, 200, req);
    }

    if (action === 'consultarAprovacao' || action === 'consultarStatus') {
      // Mantemos 'consultarAprovacao' por compat com clt-fila.js
      const out = await consultarStatusCpf(body.cpf);
      return jsonResp(out, 200, req);
    }

    if (action === 'invalidarCache') {
      // Pra quando operador acabou de criar uma simulacao no painel
      // e quer ver no V2 sem esperar os 30s do TTL.
      PROPOSALS_CACHE = { data: null, fetchedAt: 0 };
      return jsonResp({ success: true, mensagem: 'Cache invalidado' }, 200, req);
    }

    if (action === 'listarTabelas') {
      const r = await unnoCall('/proposal/api/v1/tables/clt', 'GET');
      return jsonResp({ success: r.ok, ...r.data }, r.status, req);
    }

    return jsonError(
      'Action invalida. Validas: test, consultarStatus (alias consultarAprovacao), invalidarCache, listarTabelas',
      400, req
    );
  } catch (e) {
    return jsonError('Erro Unno: ' + e.message, 500, req);
  }
}
