// NovaVida — enriquecimento de telefones / dados cadastrais por CPF.
// Endpoints WSDL: GerarTokenJson + NVCHECKJson
// Token tem TTL de 24h, cacheamos por 22h pra ter margem.

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';

const BASE = 'https://wsnv.novavidati.com.br/wslocalizador.asmx';
let tokenCache = { token: null, ts: 0 };
const TOKEN_TTL = 22 * 3600 * 1000;

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
  if (!res.ok) return { ok: false, error: 'NVCheck HTTP ' + res.status, raw: text.substring(0, 300) };
  let data; try { data = JSON.parse(text); } catch { return { ok: false, error: 'session expired (non-JSON response)', raw: text.substring(0, 300) }; }
  return { ok: true, data: data && data.d ? data.d : data };
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

  return j({
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
    fonte: 'novavida'
  }, 200, req);
}
