// NovaVida — enriquecimento de telefones / dados cadastrais por CPF.
// Endpoints WSDL: GerarTokenJson + NVCHECKJson
// Token tem TTL de 24h, cacheamos por 22h pra ter margem.
//
// CACHE DE CONSULTA: 30 dias por CPF (dados cadastrais quase nunca mudam).
// Pra forçar nova consulta, mande {forceRefresh: true} no body.

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';
import { dbSelect, dbUpsert } from './_lib/supabase.js';

const BASE = 'https://wsnv.novavidati.com.br/wslocalizador.asmx';
let tokenCache = { token: null, ts: 0 };
const TOKEN_TTL = 22 * 3600 * 1000;
const CACHE_TTL_DIAS = 30; // 30 dias - cadastrais quase nunca mudam

function getCreds() {
  return {
    usuario: process.env.NOVAVIDA_USER || '',
    senha: process.env.NOVAVIDA_PASS || '',
    cliente: process.env.NOVAVIDA_CLIENTE || ''
  };
}

// .asmx as vezes embrulha tudo em "{\"d\":...}". Outras vezes devolve string pura entre aspas.
function _stripAspas(s) { return String(s || '').replace(/^"+|"+$/g, '').trim(); }

async function gerarToken() {
  if (tokenCache.token && Date.now() - tokenCache.ts < TOKEN_TTL) {
    return { ok: true, token: tokenCache.token, cached: true };
  }
  const creds = getCreds();
  if (!creds.usuario || !creds.senha || !creds.cliente) {
    return { ok: false, error: 'Credenciais NovaVida nao configuradas (NOVAVIDA_USER / NOVAVIDA_PASS / NOVAVIDA_CLIENTE)' };
  }
  let res, text;
  try {
    res = await fetch(BASE + '/GerarTokenJson', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ credencial: creds })
    });
    text = await res.text();
  } catch (e) {
    return { ok: false, error: 'Falha de rede no GerarToken: ' + e.message };
  }
  if (!res.ok) return { ok: false, error: 'GerarToken HTTP ' + res.status, raw: text.substring(0, 200) };
  // Extrai token: pode vir como JSON {d:"..."} ou string pura
  let token = '';
  try {
    const data = JSON.parse(text);
    if (typeof data === 'string') token = data;
    else token = data.d || data.token || data.Token || '';
  } catch {
    token = _stripAspas(text);
  }
  token = _stripAspas(token);
  if (!token || token.length < 8) return { ok: false, error: 'Token vazio na resposta', raw: text.substring(0, 200) };
  tokenCache = { token, ts: Date.now() };
  return { ok: true, token };
}

async function nvCheck(token, documento) {
  let res, text;
  try {
    res = await fetch(BASE + '/NVCHECKJson', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Token': token },
      body: JSON.stringify({ nvcheck: { Documento: documento } })
    });
    text = await res.text();
  } catch (e) {
    return { ok: false, error: 'Falha de rede no NVCheck: ' + e.message };
  }
  // LOG TEMPORARIO: response cru pra debugar parsing (remover depois)
  console.log('[NVCHECK_RAW]', { status: res.status, len: text.length, preview: text.substring(0, 1500) });
  if (!res.ok) return { ok: false, error: 'NVCheck HTTP ' + res.status, raw: text.substring(0, 300) };
  let data; try { data = JSON.parse(text); } catch { return { ok: false, error: 'session expired (non-JSON response)', raw: text.substring(0, 300) }; }
  return { ok: true, data: data && data.d ? data.d : data, _rawText: text };
}

function mapTelefones(consulta) {
  const arr = consulta.TELEFONES || [];
  return arr.map(t => {
    const tipo = String(t.TIPO_TELEFONE || '').toUpperCase();
    const isMovel = tipo.includes('MOVEL') || tipo.includes('MÓVEL') || tipo.includes('CELULAR') || tipo.startsWith('M');
    const procon = String(t.PROCON || '').toUpperCase();
    const blockProcon = procon === 'S' || procon === 'SIM' || procon === 'YES';
    return {
      ddd: String(t.DDD || '').replace(/\D/g, ''),
      telefone: String(t.TELEFONE || '').replace(/\D/g, ''),
      tipo: t.TIPO_TELEFONE || '',
      operadora: t.OPERADORA || '',
      assinante: t.ASSINANTE || '',
      flhot: t.FLHOT || '',
      procon: t.PROCON || '',
      // whatsapp = movel + nao bloqueado por PROCON
      whatsapp: isMovel && !blockProcon
    };
  }).filter(t => t.ddd && t.telefone && t.telefone.length >= 8);
}

const j = (data, status = 200, req = null) => jsonResp(data, status, req);

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);
  const user = await requireAuth(req);
  if (user instanceof Response) return user;
  if (req.method !== 'POST') return jsonError('POST only', 405, req);

  let body;
  try { body = await req.json(); } catch { return jsonError('Invalid JSON body', 400, req); }
  const cpf = String(body.cpf || '').replace(/\D/g, '');
  if (!cpf || cpf.length < 9) return jsonError('CPF invalido', 400, req);
  const docPad = cpf.padStart(11, '0');
  const forceRefresh = body.forceRefresh === true;

  // ─── CACHE 30D ─────────────────────────────────────────────
  // NovaVida cobra por consulta. Dados cadastrais (telefone/endereco/email)
  // quase nunca mudam em 30 dias. Cache em consultas_cache (fonte='novavida').
  // Pra forcar nova consulta: body.forceRefresh = true
  if (!forceRefresh) {
    try {
      const { data: cacheRow } = await dbSelect('consultas_cache', {
        filters: { fonte: 'novavida', chave: docPad },
        single: true
      });
      if (cacheRow && cacheRow.expira_em && new Date(cacheRow.expira_em) > new Date()) {
        // Cache valido — retorna direto + incrementa hits
        try {
          await dbUpsert('consultas_cache', {
            fonte: 'novavida',
            chave: docPad,
            response: cacheRow.response,
            consultado_em: cacheRow.consultado_em,
            expira_em: cacheRow.expira_em,
            hits: (cacheRow.hits || 0) + 1
          }, 'fonte,chave');
        } catch { /* nao quebra fluxo se update falhar */ }
        return j({ ...cacheRow.response, _cache: { hit: true, consultadoEm: cacheRow.consultado_em } }, 200, req);
      }
    } catch { /* cache miss ou erro - segue pra consulta real */ }
  }

  // 1) Token (com cache de 22h)
  let tk = await gerarToken();
  if (!tk.ok) return j({ success: false, error: tk.error, raw: tk.raw }, 502, req);

  // 2) Consulta NVCheck (com retry de 1 tentativa se sessao expirou)
  let r = await nvCheck(tk.token, docPad);
  if (!r.ok && (String(r.error || '').includes('session') || String(r.error || '').includes('401') || String(r.error || '').includes('403'))) {
    tokenCache = { token: null, ts: 0 };
    tk = await gerarToken();
    if (tk.ok) r = await nvCheck(tk.token, docPad);
  }
  if (!r.ok) return j({ success: false, error: r.error, raw: r.raw }, 502, req);

  // Estrutura: r.data.CONSULTA.{CADASTRAIS, TELEFONES, ENDERECOS, EMAILS, OBITO, ...}
  const consulta = r.data?.CONSULTA || r.data || {};
  const cad = consulta.CADASTRAIS || {};
  const telefones = mapTelefones(consulta);
  const totalEncontrados = telefones.length;
  const totalValidos = telefones.filter(t => t.whatsapp).length;
  const obito = !!(consulta.OBITO && String(consulta.OBITO.FLOBITO || '').toUpperCase() === 'S');

  const responseData = {
    success: telefones.length > 0,
    cpf: docPad,
    nome: cad.NOME || '',
    nascimento: cad.NASC || '',
    idade: cad.IDADE || '',
    telefones,
    totalEncontrados,
    totalValidos,
    enderecos: (consulta.ENDERECOS || []).map(e => ({
      tipo: e.TIPO || '', logradouro: e.LOGRADOURO || '', numero: e.NUMERO || '',
      complemento: e.COMPLEMENTO || '', bairro: e.BAIRRO || '',
      cidade: e.CIDADE || '', uf: e.UF || '', cep: e.CEP || ''
    })),
    emails: (consulta.EMAILS || []).map(e => e.EMAIL || '').filter(Boolean),
    obito,
    fonte: 'novavida',
    // DEBUG: mantem o response cru pra inspecao em consultas_cache.response
    _debugRaw: r.data,
    _debugRawText: typeof r._rawText === 'string' ? r._rawText.substring(0, 4000) : null
  };

  // ─── Salva no cache (30 dias TTL) ──────────────────────────
  // Salva mesmo quando vem vazio — evita gastar nova consulta no
  // mesmo CPF "fantasma" pelos proximos 30 dias
  try {
    const expiraEm = new Date(Date.now() + CACHE_TTL_DIAS * 24 * 3600 * 1000).toISOString();
    await dbUpsert('consultas_cache', {
      fonte: 'novavida',
      chave: docPad,
      response: responseData,
      consultado_em: new Date().toISOString(),
      expira_em: expiraEm,
      hits: 0
    }, 'fonte,chave');
  } catch { /* nao quebra fluxo se cache falhar */ }

  return j({ ...responseData, _cache: { hit: false, ttlDias: CACHE_TTL_DIAS } }, 200, req);
}
