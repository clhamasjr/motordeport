// ══════════════════════════════════════════════════════════════════
// api/handbank.js
// Integracao com Handbank (https://app.handbank.com.br) — orquestrador
// que faz consultas em multiplos bancos. Atualmente usa UY3 pra CLT.
//
// AUTH: session-based via cookie PHPSESSID. POST /usuario/login com
// {login, senha} retorna Set-Cookie. Cookie dura ~12h. Cache em memoria
// + tabela clt_handbank_session (singleton id=1) pra reuso entre
// invocacoes do Edge Function.
//
// FLUXO CLT/UY3:
//   1) login                     -> PHPSESSID
//   2) iniciarConsultaCLT(cpf)   -> 202 + URL de autorizacao
//      (cliente abre URL e autoriza no UY3 antes de simular)
//   3) statusConsulta(cpf)       -> apos autorizacao, retorna dados
//
// ENV VARS:
//   HANDBANK_USER  — email login (ex: carlos@lhamascred.com.br)
//   HANDBANK_PASS  — senha
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';
import { dbSelect, dbUpsert } from './_lib/supabase.js';

const BASE = 'https://app.handbank.com.br';
const HB_USER = () => process.env.HANDBANK_USER;
const HB_PASS = () => process.env.HANDBANK_PASS;

// Cache em memoria do Edge (warm) — evita login a cada request
let cookieCache = { cookie: null, ts: 0, exp: 0 };

// ─── LOGIN AUTOMATICO ─────────────────────────────────────────────
// POST /usuario/login retorna 200 + Set-Cookie: PHPSESSID=xxx; path=/
async function loginAutomatico() {
  const user = HB_USER();
  const pass = HB_PASS();
  if (!user || !pass) return { ok: false, error: 'HANDBANK_USER/PASS nao configurados nas env vars do Vercel' };

  const r = await fetch(BASE + '/usuario/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'accept': 'application/json, text/plain, */*',
      'origin': BASE,
      'referer': BASE + '/'
    },
    body: JSON.stringify({ login: user, senha: pass })
  });
  const setCookie = r.headers.get('set-cookie') || '';
  const m = setCookie.match(/PHPSESSID=([^;]+)/);
  if (!r.ok || !m) {
    const txt = await r.text().catch(() => '');
    return { ok: false, error: `Login Handbank HTTP ${r.status}`, raw: txt.substring(0, 300) };
  }
  const cookie = `PHPSESSID=${m[1]}`;
  // PHPSESSID padrao PHP dura 24min sem atividade — vamos assumir 12h conservador
  const exp = Date.now() + 12 * 60 * 60 * 1000;
  cookieCache = { cookie, ts: Date.now(), exp };
  // Persiste em singleton id=1 pra reuso entre Edge instances
  try {
    await dbUpsert('clt_handbank_session', {
      id: 1,
      cookie,
      email: user,
      exp: new Date(exp).toISOString(),
      atualizado_em: new Date().toISOString()
    }, 'id');
  } catch { /* ignora — cache em memoria ja serve */ }
  return { ok: true, cookie };
}

// ─── GET COOKIE (cache → tabela → login) ──────────────────────────
async function getCookie() {
  // 1) Cache valido
  if (cookieCache.cookie && cookieCache.exp > Date.now() + 60000) {
    return { ok: true, cookie: cookieCache.cookie };
  }
  // 2) Tabela singleton id=1
  try {
    const { data: sess } = await dbSelect('clt_handbank_session', { filters: { id: 1 }, single: true });
    if (sess?.cookie && sess?.exp) {
      const expMs = new Date(sess.exp).getTime();
      if (expMs > Date.now() + 60000) {
        cookieCache = { cookie: sess.cookie, ts: Date.now(), exp: expMs };
        return { ok: true, cookie: sess.cookie };
      }
    }
  } catch { /* segue */ }
  // 3) Login automatico
  return await loginAutomatico();
}

// ─── HTTP CALL com retry em 401/403 (cookie expirou no meio) ──────
async function hbCall(method, path, body) {
  let tk = await getCookie();
  if (!tk.ok) return { ok: false, status: 0, data: { error: tk.error } };

  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'accept': 'application/json, text/plain, */*',
      'cookie': tk.cookie,
      'origin': BASE,
      'referer': BASE + '/consulta/index'
    }
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  let r = await fetch(BASE + path, opts);
  // Sessao expirou no meio do request — tenta re-login uma vez
  if (r.status === 401 || r.status === 403) {
    cookieCache = { cookie: null, ts: 0, exp: 0 };
    tk = await loginAutomatico();
    if (!tk.ok) return { ok: false, status: r.status, data: { error: tk.error } };
    opts.headers.cookie = tk.cookie;
    r = await fetch(BASE + path, opts);
  }
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 500) }; }
  return { ok: r.ok, status: r.status, data: d };
}

// ─── HANDLER ──────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);
  const user = await requireAuth(req);
  if (user instanceof Response) return user;
  if (req.method !== 'POST') return jsonError('POST only', 405, req);

  let body;
  try { body = await req.json(); } catch { body = {}; }
  const action = body.action || '';

  // ─── LOGIN: forca novo login (renova cookie) ───
  if (action === 'login') {
    cookieCache = { cookie: null, ts: 0, exp: 0 };
    const r = await loginAutomatico();
    return jsonResp(r, 200, req);
  }

  // ─── STATUS: diagnostico do cookie atual ───
  if (action === 'status') {
    let cookieValido = false, expMs = null, origem = 'nenhum';
    if (cookieCache.cookie && cookieCache.exp > Date.now() + 60000) {
      cookieValido = true; expMs = cookieCache.exp; origem = 'cache_memoria';
    }
    try {
      const { data: sess } = await dbSelect('clt_handbank_session', { filters: { id: 1 }, single: true });
      if (sess?.cookie && sess?.exp) {
        const e = new Date(sess.exp).getTime();
        if (e > Date.now() + 60000 && (!expMs || e > expMs)) {
          cookieValido = true; expMs = e; origem = 'tabela_supabase';
        }
      }
    } catch {}
    return jsonResp({
      success: true,
      cookieValido,
      expEm: expMs ? new Date(expMs).toISOString() : null,
      origem,
      envConfigurado: !!(HB_USER() && HB_PASS())
    }, 200, req);
  }

  // ─── INICIAR CONSULTA CLT (UY3) ───────────────────────────────
  // POST /uy3/simulacao_clt body: {banco_consulta:"uy3",id:null,
  //   valor_solicitado:null,cpf,produtos:[]}
  // Resposta 202: {mensagem:"https://autorizacao-clt.uy3.com.br/Info.html",
  //   http_code:202} — cliente precisa autorizar antes de prosseguir
  if (action === 'iniciarConsultaCLT' || action === 'iniciarOperacao') {
    const cpf = String(body.cpf || '').replace(/\D/g, '');
    if (!cpf || cpf.length !== 11) return jsonError('cpf invalido', 400, req);
    const r = await hbCall('POST', '/uy3/simulacao_clt', {
      banco_consulta: 'uy3',
      id: null,
      valor_solicitado: null,
      cpf,
      produtos: []
    });
    const d = r.data || {};
    // 202 + mensagem com URL = precisa autorizacao do cliente
    const linkAutz = (d.mensagem && typeof d.mensagem === 'string' && d.mensagem.startsWith('http'))
      ? d.mensagem : null;
    if (linkAutz) {
      return jsonResp({
        success: true,
        precisaAutorizacao: true,
        linkAutorizacao: linkAutz,
        mensagem: `Cliente precisa abrir o link de autorização UY3 antes de simular.`,
        _httpStatus: r.status,
        _raw: d
      }, 200, req);
    }
    // Resposta direta (sem precisar autorizar) — propaga como veio
    return jsonResp({
      success: r.ok,
      _httpStatus: r.status,
      ...d,
      _raw: d
    }, 200, req);
  }

  // ─── CONSULTAR (proxy generico pra capturar mais endpoints) ───
  // Util enquanto exploramos: passa method+path+body livre.
  // Ex: action:'raw', method:'POST', path:'/uy3/qualquer', payload:{...}
  if (action === 'raw') {
    const method = (body.method || 'POST').toUpperCase();
    const path = body.path || '';
    if (!path.startsWith('/')) return jsonError('path deve comecar com /', 400, req);
    const r = await hbCall(method, path, body.payload || null);
    return jsonResp({ success: r.ok, httpStatus: r.status, data: r.data }, 200, req);
  }

  return jsonError('Action invalida. Validas: login, status, iniciarConsultaCLT, raw', 400, req);
}
