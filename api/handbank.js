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

// ─── HTTP CALL com retry em 401/403 OU resposta HTML (sessao expirada PHP) ──
// IMPORTANTE: a Handbank/PHP retorna 200 OK + pagina de login HTML quando o
// PHPSESSID expirou, em vez de 401/403. Detectamos isso e re-logamos.
async function hbCall(method, path, body) {
  let tk = await getCookie();
  if (!tk.ok) return { ok: false, status: 0, data: { error: tk.error } };

  const buildOpts = (cookie) => {
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'accept': 'application/json, text/plain, */*',
        'x-requested-with': 'XMLHttpRequest', // força resposta JSON em frameworks PHP
        'cookie': cookie,
        'origin': BASE,
        'referer': BASE + '/consulta/index'
      }
    };
    if (body && method !== 'GET') opts.body = JSON.stringify(body);
    return opts;
  };

  let r = await fetch(BASE + path, buildOpts(tk.cookie));
  let t = await r.text();
  // Detecta sessao PHP expirada: 200 + HTML (pagina de login) em vez de JSON
  const isHtml = t.startsWith('<!DOCTYPE') || t.startsWith('<html') || t.includes('<title>Handbank</title>');
  const sessaoExpirada = (r.status === 401 || r.status === 403) || (r.ok && isHtml);

  if (sessaoExpirada) {
    cookieCache = { cookie: null, ts: 0, exp: 0 };
    const novo = await loginAutomatico();
    if (!novo.ok) {
      return { ok: false, status: r.status, data: { error: novo.error || 'Re-login falhou' } };
    }
    r = await fetch(BASE + path, buildOpts(novo.cookie));
    t = await r.text();
  }

  let d; try { d = JSON.parse(t); } catch {
    // Se mesmo apos re-login veio HTML, retorna erro claro em vez de raw confuso
    if (t.startsWith('<!DOCTYPE') || t.startsWith('<html')) {
      d = { error: 'Handbank retornou HTML em vez de JSON (sessao ainda invalida apos re-login)' };
    } else {
      d = { raw: t.substring(0, 500) };
    }
  }
  return { ok: r.ok && !d.error, status: r.status, data: d };
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
  //
  // Cenarios (mapeados via status code):
  //   202 Accepted     -> {mensagem: URL, http_code: 202}      cliente precisa autorizar
  //   201 Created      -> {mensagem: ..., margem/produtos...}   cliente autorizado (com dados)
  //   400 Bad Request  -> {mensagem: erro}                       cliente ja tem contrato OU outro erro
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
    const httpStatus = r.status;

    // 202 Accepted: precisa autorizacao
    if (httpStatus === 202) {
      const linkAutz = (d.mensagem && typeof d.mensagem === 'string' && d.mensagem.startsWith('http'))
        ? d.mensagem : null;
      return jsonResp({
        success: true,
        precisaAutorizacao: true,
        linkAutorizacao: linkAutz,
        mensagem: 'Cliente precisa abrir o link de autorização UY3 antes de simular.',
        _httpStatus: httpStatus,
        _raw: d
      }, 200, req);
    }

    // 400 Bad Request: cliente ja tem contrato OU CPF invalido OU outro erro
    if (httpStatus === 400) {
      const msgErr = d.mensagem || d.message || d.error || 'Cliente já possui contrato ativo na UY3 ou outro impedimento';
      const jaTemContrato = /contrato|j[áa].*possui|ativ/i.test(String(msgErr));
      return jsonResp({
        success: false,
        autorizado: false,
        bloqueado: true,
        jaTemContrato,
        mensagem: jaTemContrato
          ? 'Cliente já possui contrato ativo na UY3 — não é possível simular novo.'
          : `UY3 recusou: ${msgErr}`,
        _httpStatus: httpStatus,
        _raw: d
      }, 200, req);
    }

    // 201 Created: cliente autorizado → retorna margem e dados
    // Estrutura real do response: { cnpj, matricula, valor_margem, mensagem, http_code }
    if (httpStatus === 201 || (r.ok && d && Object.keys(d).length > 0)) {
      const margem = (typeof d.valor_margem === 'number' ? d.valor_margem : null)
        ?? d.margem ?? d.margemDisponivel ?? d.valor_disponivel ?? d.available_margin ?? null;
      const empregadorCnpj = d.cnpj || d.empregador_cnpj || null;
      const matricula = d.matricula || null;
      const empregadorNome = d.empregador || d.employer_name || d.razao_social || null;
      const renda = d.renda || d.salario || d.salary || null;
      const produtos = d.produtos || d.products || [];
      return jsonResp({
        success: true,
        autorizado: true,
        disponivel: true,
        margem,
        empregadorCnpj,
        matricula,
        empregador: empregadorNome,
        renda,
        produtos,
        mensagem: (margem != null && margem > 0)
          ? `Cliente elegível — margem R$ ${Number(margem).toFixed(2)}`
          : (margem === 0 ? 'Cliente elegível mas sem margem disponível' : 'Cliente autorizado — sem dados de margem'),
        _httpStatus: httpStatus,
        _raw: d,
        ...d
      }, 200, req);
    }

    // Outro status (500, etc) — propaga
    return jsonResp({
      success: false,
      mensagem: `Handbank HTTP ${httpStatus}`,
      _httpStatus: httpStatus,
      _raw: d
    }, 200, req);
  }

  // ─── AUTO-AUTORIZAR UY3 (sem mandar link pro cliente) ──────────
  // Bate direto no api.uy3.com.br/v1/DataprevEmployee/ChallengeInfo com os
  // dados que ja temos (nome, dataNasc, telefone, geo). Replica o que o
  // portal autorizacao-clt.uy3.com.br faz quando o cliente preenche.
  // Apos sucesso, re-chama iniciarConsultaCLT da Handbank pra puxar dados.
  if (action === 'autorizarUY3') {
    const cpf = String(body.cpf || '').replace(/\D/g, '');
    const nome = String(body.nome || '').trim();
    const dataNasc = String(body.dataNascimento || '').trim(); // YYYY-MM-DD
    const telefone = String(body.telefone || '').replace(/\D/g, '');
    if (!cpf || !nome || !dataNasc || !telefone) {
      return jsonError('Faltam: cpf, nome, dataNascimento (YYYY-MM-DD), telefone', 400, req);
    }
    const lat = body.latitude || -23.52757315971176; // Sorocaba/SP default
    const long = body.longitude || -47.47400538521915;
    const params = new URLSearchParams({
      phoneNumber: telefone,
      registrationNumber: cpf,
      name: nome,
      birthDate: dataNasc,
      latitude: String(lat),
      longitude: String(long)
    });
    const url = `https://api.uy3.com.br/v1/DataprevEmployee/ChallengeInfo?${params}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'origin': 'https://autorizacao-clt.uy3.com.br',
        'referer': 'https://autorizacao-clt.uy3.com.br/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'
      }
    });
    const t = await r.text();
    let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 500) }; }
    return jsonResp({
      success: r.ok,
      _httpStatus: r.status,
      _raw: d,
      mensagem: r.ok
        ? 'Challenge UY3 disparado — agora chame iniciarConsultaCLT pra ver se autorizou.'
        : (d.error || d.message || `UY3 retornou HTTP ${r.status}`)
    }, 200, req);
  }

  // ─── VERIFICAR AUTORIZACAO ─────────────────────────────────────
  // Mesmo endpoint do iniciarConsultaCLT. Se cliente AINDA NAO autorizou,
  // continua retornando 202 + URL. Se autorizou, retorna dados de margem
  // (em algum formato a descobrir). Esta action interpreta a resposta:
  //   - autorizado=false  -> ainda precisa cliente abrir o link UY3
  //   - autorizado=true   -> retorna dados crus pra mapearmos
  if (action === 'verificarAutorizacao') {
    const cpf = String(body.cpf || '').replace(/\D/g, '');
    if (!cpf || cpf.length !== 11) return jsonError('cpf invalido', 400, req);
    const r = await hbCall('POST', '/uy3/simulacao_clt', {
      banco_consulta: 'uy3', id: null, valor_solicitado: null, cpf, produtos: []
    });
    const d = r.data || {};
    const aindaPrecisaAutz = !!(r.status === 202 && typeof d.mensagem === 'string' && d.mensagem.startsWith('http'));
    if (aindaPrecisaAutz) {
      return jsonResp({
        success: true,
        autorizado: false,
        linkAutorizacao: d.mensagem,
        mensagem: 'Cliente ainda não autorizou a consulta no UY3.',
        _httpStatus: r.status,
        _raw: d
      }, 200, req);
    }
    return jsonResp({
      success: r.ok,
      autorizado: r.ok,
      mensagem: r.ok ? 'Cliente autorizou! Verifique campos retornados.' : (d.error || d.mensagem || 'Erro consultando Handbank'),
      _httpStatus: r.status,
      _raw: d,
      ...d
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

  return jsonError('Action invalida. Validas: login, status, iniciarConsultaCLT, autorizarUY3, verificarAutorizacao, raw', 400, req);
}
