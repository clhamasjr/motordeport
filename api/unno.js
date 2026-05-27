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
async function aguardarPropostaCriada(cpf, maxMs = 22000, intervalMs = 1500) {
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
async function verificarStatus({ termUuid, cpf }) {
  // 1) Status do termo
  const term = await unnoCall(`/auth/api/v1/terms/latest/${termUuid}`, 'GET');
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

  // APROVADOS
  if (status === 'integrated' || status === 'disbursed') {
    return {
      etapa: 'APROVADO',
      approved: true,
      mensagem: status === 'disbursed'
        ? '💰 Aprovada e desembolsada'
        : '✅ Aprovada — pronta pra prosseguir no painel Unno',
      proposalUuid: p.uuid,
      bancoProvedor: p.bank_provider_name,
      linkPainel: `https://app.unnotech.com.br/loans/clt/${p.uuid}`,
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

  // Outros status — em análise ainda
  return {
    etapa: 'AUTORIZADO_EM_ANALISE',
    approved: false,
    mensagem: `⏳ Em análise (status: ${p.status})`,
    proposalUuid: p.uuid,
    bancoProvedor: p.bank_provider_name,
    linkPainel: `https://app.unnotech.com.br/loans/clt/${p.uuid}`,
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

  // Em análise — proposta criada mas motor ainda processando
  return {
    sucesso: true,
    etapa: 'EM_ANALISE',
    approved: false,
    mensagem: `⏳ Em análise (status: ${p.status})`,
    termUuid: termo.uuid,
    proposalUuid: p.uuid,
    bancoProvedor: p.bank_provider_name,
    linkPainel: `https://app.unnotech.com.br/loans/clt/${p.uuid}`,
    retryable: true,
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

    return jsonError(
      'Action invalida. Validas: test, iniciarSimulacao, verificarStatus, cancelarSimulacao, listarTabelas',
      400, req
    );
  } catch (e) {
    return jsonError('Erro Unno: ' + e.message, 500, req);
  }
}
