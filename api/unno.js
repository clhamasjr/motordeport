// ══════════════════════════════════════════════════════════════════
// api/unno.js — Unno Tech: Consignado CLT (consulta de aprovação)
//
// IMPORTANTE: A Unno NAO TEM endpoint de consulta de elegibilidade
// puro. O unico jeito de saber se um CPF eh aprovado eh:
//   1. POST /loan/api/v2/clt/draft     → cria proposta DRAFT
//   2. Sistema deles roda risk-analysis automatico (~3-10s)
//   3. GET /proposal/api/v1/proposals/{uuid} → polling ate status final
//   4. POST /proposal/api/v1/proposals/{uuid}/cancel → cancela SEMPRE
//
// "Proposta-fantasma": criamos, lemos resultado, cancelamos. Cliente
// nunca eh contatado (link de formalizacao so sai depois do select+
// register-worker+...).
//
// Auth: nao tem credencial OAuth2 com permissoes operacionais — usa
// login HUMANO (username+password). Token JWT user-type (TTL ~4h).
// Roadmap: pedir pra Unno credenciais service com `proposal.simulation-
// clt-*` e migrar.
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
// O JWT da Unno traz `exp` no payload — usamos isso pra calcular
// validade real, com 60s de margem. Edge eh stateless entre cold-
// starts mas mantem dentro da mesma instancia (poupa logins).
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
  // Calcula expiracao real do JWT (exp em segundos epoch), com margem de 60s
  const realExp = decodeJwtExp(d.access_token);
  const fallbackTtl = now + (3 * 60 * 60 * 1000); // 3h se nao conseguir decodar
  TOKEN_CACHE = {
    token: d.access_token,
    expiresAt: realExp > 0 ? realExp - 60_000 : fallbackTtl,
  };
  return d.access_token;
}

// ── Helper de chamada autenticada ──────────────────────────────
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

// ── Helpers de formatacao ──────────────────────────────────────
function onlyDigits(s) { return String(s || '').replace(/\D/g, ''); }

function normalizeBirthDate(s) {
  if (!s) return '';
  // Aceita YYYY-MM-DD ou DD/MM/YYYY, retorna sempre YYYY-MM-DD
  const m1 = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m1) return s;
  const m2 = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;
  return s; // deixa Unno reclamar se for invalido
}

// ── Cancelar proposta (cleanup obrigatorio do "fantasma") ──────
async function cancelarProposta(uuid) {
  try {
    const r = await unnoCall(`/proposal/api/v1/proposals/${uuid}/cancel`, 'POST', {});
    return { ok: r.ok, status: r.status };
  } catch (e) {
    // Nao propaga erro de cancelamento — o importante eh o resultado
    // da consulta. Loga so pra eventual auditoria.
    console.error('[unno] erro cancelando proposta', uuid, e.message);
    return { ok: false, error: e.message };
  }
}

// ── Polling de status apos criar draft ─────────────────────────
// Aguarda o risk-analysis terminar. Status terminais que liberam
// a leitura final:
//   APPROVED, REJECTED, IN_FORMALIZATION, FORMALIZED, PAID, DENIED,
//   AWAITING_RISK_ANALYSIS (saiu dos estagios DRAFT/PENDING)
// Status que SEGUEM em risk-analysis:
//   DRAFT, PENDING, IN_RISK_ANALYSIS
async function aguardarRiskAnalysis(uuid, maxMs = 12000, intervalMs = 1000) {
  const inicio = Date.now();
  const inProgress = new Set([
    'DRAFT', 'PENDING', 'IN_RISK_ANALYSIS', 'PROCESSING',
    'AWAITING_RISK_ANALYSIS', 'CREATED'
  ]);
  while (Date.now() - inicio < maxMs) {
    const r = await unnoCall(`/proposal/api/v1/proposals/${uuid}`, 'GET');
    if (r.ok && r.data) {
      const st = (r.data.status || '').toUpperCase();
      if (st && !inProgress.has(st)) {
        return { status: st, proposal: r.data };
      }
    }
    await new Promise(res => setTimeout(res, intervalMs));
  }
  // Timeout: retorna ultimo status conhecido
  const last = await unnoCall(`/proposal/api/v1/proposals/${uuid}`, 'GET');
  return {
    status: (last.data?.status || 'TIMEOUT').toUpperCase(),
    proposal: last.data || null,
    timeout: true
  };
}

// ── Action principal: consulta de aprovação ────────────────────
// Cria proposta-fantasma, le resultado do risk-analysis, cancela.
//
// Input: { cpf, nome, telefone, email?, dataNascimento }
// Output: {
//   approved: boolean,
//   status: 'APPROVED' | 'REJECTED' | 'AWAITING_RISK_ANALYSIS' | ...,
//   reason: string,
//   proposalUuid: string,   // pra debug — proposta ja foi cancelada
//   dadosCliente: { ... },  // o que conseguimos extrair (nome, etc)
//   raw: { ... }            // proposta completa pra inspecao
// }
async function consultarAprovacao({ cpf, nome, telefone, email, dataNascimento }) {
  const cpfLimpo = onlyDigits(cpf);
  if (!cpfLimpo || cpfLimpo.length !== 11) {
    return { approved: false, error: 'CPF invalido (precisa 11 digitos)' };
  }
  if (!nome || !nome.trim()) {
    return { approved: false, error: 'Nome obrigatorio pra Unno (sem nome nao da pra criar draft)' };
  }
  if (!dataNascimento) {
    return { approved: false, error: 'Data de nascimento obrigatoria pra Unno' };
  }

  const payload = {
    cpf: cpfLimpo,
    name: nome.trim(),
    phone: onlyDigits(telefone) || '11900000000', // Unno exige campo, mas valida formato
    email: (email && email.includes('@')) ? email : `${cpfLimpo}@lead.lhamascred.com.br`,
    birth_date: normalizeBirthDate(dataNascimento),
  };

  // 1) Cria proposta DRAFT
  const draft = await unnoCall('/loan/api/v2/clt/draft', 'POST', payload);
  if (!draft.ok) {
    return {
      approved: false,
      error: draft.data?.error?.message || draft.data?.message || `Falha criar draft (HTTP ${draft.status})`,
      _raw: draft.data,
    };
  }
  const uuid = draft.data?.uuid || draft.data?.proposalUuid || draft.data?.id;
  if (!uuid) {
    return {
      approved: false,
      error: 'Unno criou draft mas nao retornou uuid',
      _raw: draft.data,
    };
  }

  let resultado;
  try {
    // 2) Polling do risk-analysis
    const aguard = await aguardarRiskAnalysis(uuid);
    const status = aguard.status;
    const prop = aguard.proposal || {};

    // 3) Interpreta resultado
    const APROVADOS = ['APPROVED', 'IN_FORMALIZATION', 'FORMALIZED', 'PAID', 'AWAITING_FORMALIZATION'];
    const REJEITADOS = ['REJECTED', 'DENIED', 'CANCELLED', 'CANCELED'];

    let approved = false;
    let reason = '';
    if (APROVADOS.includes(status)) {
      approved = true;
      reason = `Cliente aprovado pela Unno (status: ${status})`;
    } else if (REJEITADOS.includes(status)) {
      approved = false;
      reason = prop.rejection_reason || prop.reason || `Recusado pela Unno (status: ${status})`;
    } else {
      // Status intermediario apos timeout — nao deu pra confirmar
      approved = false;
      reason = aguard.timeout
        ? `Risk-analysis ainda rodando apos 12s (status: ${status}) — tente novamente em ~30s`
        : `Status inesperado: ${status}`;
    }

    resultado = {
      approved,
      status,
      reason,
      proposalUuid: uuid,
      dadosCliente: {
        nome: prop.customer_full_name || payload.name,
        cpf: prop.customer_cpf || cpfLimpo,
        empregador: prop.employer_name || prop.company_name || null,
        empregadorCnpj: prop.employer_cnpj || prop.company_cnpj || null,
        margemDisponivel: prop.available_margin || prop.margin || null,
        renda: prop.monthly_income || prop.income || null,
      },
      _raw: prop,
    };
  } catch (e) {
    resultado = { approved: false, error: 'Erro polling risk-analysis: ' + e.message, proposalUuid: uuid };
  } finally {
    // 4) CANCELAMENTO OBRIGATORIO — proposta-fantasma nao pode ficar viva
    await cancelarProposta(uuid);
  }

  return resultado;
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
      // Healthcheck: tenta login e lista partners (endpoint que sabemos retornar 200)
      const r = await unnoCall('/auth/api/v1/partners?size=1', 'GET');
      return jsonResp({
        success: r.ok,
        login: 'ok',
        partnersStatus: r.status,
        partnersCount: r.data?.total_elements ?? null,
      }, 200, req);
    }

    if (action === 'consultarAprovacao') {
      const out = await consultarAprovacao({
        cpf: body.cpf,
        nome: body.nome || body.name,
        telefone: body.telefone || body.phone,
        email: body.email,
        dataNascimento: body.dataNascimento || body.birth_date,
      });
      return jsonResp(out, 200, req);
    }

    if (action === 'listarTabelas') {
      // Util pra ver tabelas CLT disponiveis (taxa, comissao, prazo)
      const r = await unnoCall('/proposal/api/v1/tables/clt', 'GET');
      return jsonResp({ success: r.ok, ...r.data }, r.status, req);
    }

    if (action === 'listarPartners') {
      const r = await unnoCall('/auth/api/v1/partners', 'GET');
      return jsonResp({ success: r.ok, ...r.data }, r.status, req);
    }

    return jsonError(
      'Action invalida. Validas: test, consultarAprovacao, listarTabelas, listarPartners',
      400, req
    );
  } catch (e) {
    return jsonError('Erro Unno: ' + e.message, 500, req);
  }
}
