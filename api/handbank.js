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
//      (cliente abre URL e autoriza antes de simular — portal Hand+
//       autorizacao-clt.handmais.com desde out/2026; o antigo
//       autorizacao-clt.uy3.com.br saiu do ar)
//      -> 201 margem | 400 restricoes/ja tem contrato | 402 bloqueio
//         comercial | 404 sem vinculo na Dataprev | 409 varios vinculos
//   2b) autorizarUY3             -> auto-autoriza (Lhamas como correspondente)
//       via POST /curl.php do Hand+ com hash+cod_verificacao do link
//   3) iniciarConsultaCLT(cpf)   -> apos autorizacao, retorna dados
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

const UA_NAV = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

// Link de autorizacao que a Handbank devolve no 202. Formatos vistos:
//   antigo: https://autorizacao-clt.uy3.com.br/?...            (fora do ar desde out/2026 — 404)
//   novo:   https://autorizacao-clt.handmais.com/<hash>?cod_verificacao=<uuid>
// O portal novo (Hand+) manda `hash` (ultimo segmento do path, 16-128 chars
// [A-Za-z0-9_-]) e `cod_verificacao` (query) junto com o cadastro do cliente.
function parseLinkAutorizacao(link) {
  try {
    const u = new URL(String(link || ''));
    const seg = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    const hash = /^[A-Za-z0-9_-]{16,128}$/.test(seg) ? seg : '';
    const cod = u.searchParams.get('cod_verificacao') || '';
    return { host: u.host, origin: u.origin, hash, cod };
  } catch { return { host: null, origin: null, hash: '', cod: '' }; }
}

// A UY3 devolve mensagens com <br> e tags — vira texto " | " pro card.
function limparHtml(v) {
  return String(v ?? '')
    .replace(/<br\s*\/?>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s*\|(\s*\|)+\s*/g, ' | ')
    .replace(/\s+/g, ' ')
    .replace(/^\s*\|\s*|\s*\|\s*$/g, '')
    .trim();
}

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
      // `mensagem` = link completo (com hash do cliente); `link` = so o cod_verificacao
      const linkAutz = (d.mensagem && typeof d.mensagem === 'string' && d.mensagem.startsWith('http'))
        ? d.mensagem
        : ((typeof d.link === 'string' && d.link.startsWith('http')) ? d.link : null);
      const partes = parseLinkAutorizacao(linkAutz);
      return jsonResp({
        success: true,
        precisaAutorizacao: true,
        linkAutorizacao: linkAutz,
        hashAutorizacao: partes.hash || null,
        codVerificacao: partes.cod || null,
        portalAutorizacao: partes.host || null,
        mensagem: 'Cliente precisa abrir o link de autorização (Hand+/UY3) antes de simular.',
        _httpStatus: httpStatus,
        _raw: d
      }, 200, req);
    }

    // 400 Bad Request: cliente ja tem contrato OU CPF invalido OU outro erro
    if (httpStatus === 400) {
      const msgErr = limparHtml(d.mensagem || d.message || d.error || 'UY3 recusou a consulta (HTTP 400)');
      // "Já possui contrato" SO quando a UY3 diz isso de fato. O regex antigo
      // (/contrato|j[áa].*possui|ativ/) casava "atividade"/"ADMINISTRATIVO" das
      // restrições de convênio e dezenas de clientes viravam "já contratado".
      const ehRestricao = /restri[çc][õo]es encontradas/i.test(msgErr);
      const jaTemContrato = !ehRestricao && /(j[áa]\s+)?possui\s+(um\s+|uma\s+)?(contrato|opera[çc][ãa]o|proposta|empr[ée]stimo)|contrato\s+(ativo|vigente|em\s+andamento)|j[áa]\s+(tem|contratou)/i.test(msgErr);
      const semVinculo = !jaTemContrato && /CPF n[ãa]o encontrado na base|n[ãa]o (foi )?encontrad[oa]? (nenhum )?v[ií]nculo|sem v[ií]nculo/i.test(msgErr);
      return jsonResp({
        success: false,
        autorizado: false,
        bloqueado: true,
        jaTemContrato,
        semVinculo,
        restricoes: ehRestricao,
        mensagem: jaTemContrato
          ? 'Cliente já possui contrato ativo na UY3 — não é possível simular novo.'
          : `UY3 recusou: ${msgErr}`,
        _httpStatus: httpStatus,
        _raw: d
      }, 200, req);
    }

    // 404: Dataprev nao achou vinculo CLT = negativa legitima (nao e erro de API)
    if (httpStatus === 404) {
      const m = limparHtml(d.mensagem || d.message || 'Nenhum vínculo CLT encontrado na Dataprev para este CPF.');
      return jsonResp({
        success: false, autorizado: false, disponivel: false, bloqueado: false,
        semVinculo: true,
        mensagem: m,
        _httpStatus: httpStatus, _raw: d
      }, 200, req);
    }

    // 402 "Por favor entrar em contato com seu gerente comercial (PD)" = LIMITE
    // de consultas da conta Handbank (cota). Visto em 20/10/2026: apareceu de
    // madrugada (19/10 23h→01h) e de novo depois de ~25 consultas seguidas num
    // reprocesso em lote; CPFs já consultados (cache) continuavam respondendo.
    // Nao diz nada sobre o cliente → re-tenta no dia seguinte, nunca "inapto".
    if (httpStatus === 402) {
      const m = limparHtml(d.mensagem || d.message || 'contate o gerente comercial');
      return jsonResp({
        success: false, autorizado: false, disponivel: false, bloqueado: false,
        bloqueioComercial: true,
        cotaEsgotada: true,
        mensagem: `Handbank: limite de consultas atingido (HTTP 402 "${m}") — re-tenta sozinho amanhã cedo`,
        _httpStatus: httpStatus, _raw: d
      }, 200, req);
    }

    // 409: cliente tem MAIS DE UM vinculo — a UY3 devolve a lista com a margem
    // de cada um (em REAIS, diferente do 201 que vem em centavos). Antes isso
    // virava "Handbank HTTP 409" e a margem se perdia.
    if (httpStatus === 409 && Array.isArray(d.mensagem)) {
      const vinculos = d.mensagem.map((v) => ({
        nome: v?.nome || null,
        elegivel: v?.elegivel !== false,
        matricula: v?.matricula || null,
        empregadorCnpj: v?.numeroInscricaoEmpregador || v?.cnpj || null,
        margem: Number(v?.valorMargemDisponivel ?? v?.valor_margem ?? 0) || 0,
      }));
      const elegiveis = vinculos.filter((v) => v.elegivel);
      const melhor = [...(elegiveis.length ? elegiveis : vinculos)].sort((a, b) => b.margem - a.margem)[0] || null;
      const margem = melhor ? melhor.margem : 0;
      return jsonResp({
        success: true,
        autorizado: true,
        disponivel: !!(melhor && melhor.elegivel),
        margem,
        empregadorCnpj: melhor?.empregadorCnpj || null,
        matricula: melhor?.matricula || null,
        empregador: null,
        renda: null,
        vinculos,
        multiplosVinculos: true,
        mensagem: melhor
          ? `${vinculos.length} vínculos — melhor margem R$ ${margem.toFixed(2)} (matrícula ${melhor.matricula || '?'})`
          : 'Vários vínculos, nenhum elegível',
        _httpStatus: httpStatus,
        _raw: d
      }, 200, req);
    }

    // 201 Created: cliente autorizado → retorna margem e dados
    // Estrutura real do response: { cnpj, matricula, valor_margem, mensagem, http_code }
    // IMPORTANTE: a UY3 devolve `valor_margem` em CENTAVOS (ex: 226799 = R$ 2.267,99).
    // Por isso dividimos por 100. Os campos de fallback (d.margem, etc) já vêm em reais.
    const _vmCentavos = (typeof d.valor_margem === 'number' ? d.valor_margem : null);
    const margem = (_vmCentavos != null ? _vmCentavos / 100 : null)
      ?? d.margem ?? d.margemDisponivel ?? d.valor_disponivel ?? d.available_margin ?? null;
    if (httpStatus === 201 || (r.ok && d && Object.keys(d).length > 0)) {
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

    // Outro status (500, etc) — propaga com a mensagem da Handbank quando tem
    const mOutro = typeof d.mensagem === 'string' ? limparHtml(d.mensagem) : (d.error ? String(d.error) : '');
    return jsonResp({
      success: false,
      mensagem: mOutro ? `Handbank HTTP ${httpStatus}: ${mOutro}` : `Handbank HTTP ${httpStatus}`,
      _httpStatus: httpStatus,
      _raw: d
    }, 200, req);
  }

  // ─── AUTO-AUTORIZAR UY3 (sem mandar link pro cliente) ──────────
  // Bate direto no api.uy3.com.br/v1/DataprevEmployee/ChallengeInfo com os
  // dados que ja temos (nome, dataNasc, telefone, geo). Replica o que o
  // portal autorizacao-clt.uy3.com.br faz quando o cliente preenche.
  // Apos sucesso, re-chama iniciarConsultaCLT da Handbank pra puxar dados.
  if (action === 'autorizarUY3' || action === 'autorizarHandmais') {
    const cpf = String(body.cpf || '').replace(/\D/g, '');
    const nome = String(body.nome || '').trim();
    const dataNasc = String(body.dataNascimento || '').trim(); // YYYY-MM-DD
    const telefone = String(body.telefone || '').replace(/\D/g, '');
    if (!cpf || !nome || !dataNasc || !telefone) {
      return jsonError('Faltam: cpf, nome, dataNascimento (YYYY-MM-DD), telefone', 400, req);
    }
    const lat = body.latitude || -23.52757315971176; // Sorocaba/SP default
    const long = body.longitude || -47.47400538521915;

    // ── Portal NOVO (out/2026): autorizacao-clt.handmais.com ──────────
    // O link do 202 vem como https://autorizacao-clt.handmais.com/<hash>?cod_verificacao=<uuid>.
    // A pagina faz: GET api.ipify.org (ip do cliente) → POST /curl.php com
    // {nome_completo, cpf, telefone, data_nascimento, latitude, longitude,
    //  device, cod_verificacao, ip_origem, hash}. Resposta: {mensagem}.
    // O endpoint antigo (api.uy3.com.br ChallengeInfo) hoje responde 400
    // BIGDATA_CPF_SERVICE_UNAVAILABLE pra qualquer dado — por isso o novo
    // fluxo e o padrao e o antigo fica so como fallback.
    const link = String(body.link || body.linkAutorizacao || '');
    const partes = parseLinkAutorizacao(link);
    const hash = String(body.hash || body.hashAutorizacao || partes.hash || '');
    const cod = String(body.codVerificacao || body.cod_verificacao || partes.cod || '');
    const portalNovo = /handmais\.com$/i.test(partes.host || '') || (!!hash && !!cod);
    if (portalNovo) {
      if (!hash || !cod) {
        return jsonResp({
          success: false, portal: 'handmais', _httpStatus: 0,
          mensagem: 'Link de autorização sem hash/cod_verificacao — não dá pra auto-autorizar (use o link manual)'
        }, 200, req);
      }
      const origin = partes.origin || 'https://autorizacao-clt.handmais.com';
      let ip = null;
      try {
        const c1 = new AbortController(); const t1 = setTimeout(() => c1.abort(), 2500);
        const ri = await fetch('https://api.ipify.org?format=json', { signal: c1.signal });
        clearTimeout(t1);
        ip = (await ri.json())?.ip || null;
      } catch { /* segue sem ip */ }
      const payload = {
        nome_completo: nome,
        cpf,
        telefone,
        data_nascimento: dataNasc,
        latitude: lat,
        longitude: long,
        device: UA_NAV,
        cod_verificacao: cod,
        ip_origem: ip || '0.0.0.0',
        hash
      };
      let r, t;
      try {
        const c2 = new AbortController(); const t2 = setTimeout(() => c2.abort(), 15000);
        r = await fetch(origin + '/curl.php', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'accept': 'application/json, text/plain, */*',
            'origin': origin,
            'referer': `${origin}/${hash}?cod_verificacao=${encodeURIComponent(cod)}`,
            'user-agent': UA_NAV,
            'accept-language': 'pt-BR,pt;q=0.9'
          },
          body: JSON.stringify(payload),
          signal: c2.signal
        });
        clearTimeout(t2);
        t = await r.text();
      } catch (e) {
        return jsonResp({
          success: false, portal: 'handmais', _httpStatus: 0,
          mensagem: `Hand+ não respondeu (${e?.name === 'AbortError' ? 'timeout 15s' : (e?.message || 'rede')})`
        }, 200, req);
      }
      let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 500) }; }
      const ehHtml = /^\s*<(!DOCTYPE|html)/i.test(t);
      const msg = limparHtml(d?.mensagem || d?.message || d?.error || (ehHtml ? '' : d?.raw) || '');
      const cf = { server: r.headers.get('server'), ray: r.headers.get('cf-ray'), mitigated: r.headers.get('cf-mitigated') };
      return jsonResp({
        success: r.ok && !ehHtml,
        portal: 'handmais',
        _httpStatus: r.status,
        _raw: d,
        cf,
        telefoneUsado: telefone.replace(/\d(?=\d{4})/g, '*'),
        mensagem: (r.ok && !ehHtml)
          ? (msg || 'Autorização enviada ao Hand+ — re-consulte pra confirmar.')
          : (ehHtml
              ? `Hand+ devolveu página HTML (HTTP ${r.status}${cf.mitigated ? ', Cloudflare ' + cf.mitigated : ''})`
              : (msg || `Hand+ retornou HTTP ${r.status}`))
      }, 200, req);
    }

    // ── Portal ANTIGO: api.uy3.com.br/v1/DataprevEmployee/ChallengeInfo (fallback) ──
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
        'user-agent': UA_NAV
      }
    });
    const t = await r.text();
    let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 500) }; }
    return jsonResp({
      success: r.ok,
      portal: 'uy3',
      _httpStatus: r.status,
      _raw: d,
      mensagem: r.ok
        ? 'Challenge UY3 disparado — agora chame iniciarConsultaCLT pra ver se autorizou.'
        : limparHtml(d.message || d.error || d.mensagem || `UY3 retornou HTTP ${r.status}`)
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

  // ─── SIMULAR DETALHE UY3 (tabelas + valor liberado + parcelas) ──
  // Repete /uy3/simulacao_clt passando valor_solicitado pra forcar o
  // backend a retornar produtos com simulacao. Estrutura exata depende
  // da API Handbank — captura varios formatos possiveis.
  if (action === 'simularDetalheUY3') {
    const cpf = String(body.cpf || '').replace(/\D/g, '');
    if (!cpf || cpf.length !== 11) return jsonError('cpf invalido', 400, req);
    const margem = parseFloat(body.margem || 0);
    // Estima valor solicitado se nao vier: parcela*84*0.7 (proxy de IOF+CET)
    const valorSolicitado = parseFloat(body.valorSolicitado || (margem > 0 ? margem * 84 * 0.7 : 0));
    if (!valorSolicitado || valorSolicitado <= 0) {
      return jsonResp({
        success: false,
        mensagem: 'Sem margem nem valor solicitado pra simular'
      }, 200, req);
    }
    const r = await hbCall('POST', '/uy3/simulacao_clt', {
      banco_consulta: 'uy3',
      id: null,
      valor_solicitado: valorSolicitado,
      cpf,
      produtos: []
    });
    const d = r.data || {};
    const produtos = d.produtos || d.products || d.tabelas || [];
    // Tenta extrair simulacao do primeiro produto (formato desconhecido —
    // captura varios nomes de campo conhecidos)
    let detalhes = null;
    if (Array.isArray(produtos) && produtos.length > 0) {
      const p = produtos[0];
      detalhes = {
        valorLiquido: parseFloat(
          p.valor_liquido || p.valor_desembolso || p.valorLiquido ||
          p.valor_cliente || p.disbursed_amount || p.net_value || 0
        ) || null,
        parcelas: parseInt(
          p.qtd_parcelas || p.numero_parcelas || p.parcelas ||
          p.quantidade_parcelas || p.installments || p.term || 0
        ) || null,
        valorParcela: parseFloat(
          p.valor_parcela || p.valorParcela || p.installment_value || 0
        ) || null,
        taxaMensal: parseFloat(
          p.taxa_mensal || p.taxa || p.monthly_rate || p.rate || 0
        ) || null,
        cetMensal: parseFloat(
          p.cet || p.cet_mensal || p.cetMensal || p.cet_monthly || 0
        ) || null
      };
    }
    return jsonResp({
      success: !!detalhes?.valorLiquido,
      cpf,
      valorSolicitado,
      margemUsada: margem,
      detalhes,
      totalProdutos: produtos.length,
      mensagem: detalhes?.valorLiquido
        ? `Simulação OK — ${detalhes.parcelas}x R$ ${detalhes.valorParcela?.toFixed(2)}`
        : (produtos.length === 0
          ? 'UY3 não retornou produtos — pode precisar de outro endpoint da API. Envie manual da API Handbank pra refinar.'
          : 'UY3 retornou produtos mas em formato desconhecido. Envie manual da API Handbank.'),
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

  return jsonError('Action invalida. Validas: login, status, iniciarConsultaCLT, autorizarUY3 (=autorizarHandmais), verificarAutorizacao, simularDetalheUY3, raw', 400, req);
}
