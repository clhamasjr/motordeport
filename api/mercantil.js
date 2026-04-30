// ══════════════════════════════════════════════════════════════════
// api/mercantil.js — Banco Mercantil — Consignado Privado CLT
// Convênio: MINISTERIO DO TRABALHO E EMPREGO MTE
//
// Stack: API REST (Layer7-API-Gateway), JWT Bearer auth, sessao por usuario
// Base URL: https://api.mercantil.com.br:8443
// Portal: https://meu.bancomercantil.com.br
//
// FLUXO:
//   1. login (TODO: precisa endpoint) → retorna JWT + sessaoId
//   2. iniciarOperacao (POST PropostasProspect/IniciarOperacao) → retorna operacaoId
//   3. simular (TODO: precisa endpoint) → retorna tabelas/parcelas
//   4. enviarProposta (TODO: precisa endpoint) → cria proposta
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';

const BASE = 'https://api.mercantil.com.br:8443';
const SITE_BFF = '/pcb/sitebff/api';

// Constantes do correspondente — extraidas do JWT real
const CORRESPONDENTE_DEFAULT = {
  empresaId: 2,
  cnpjCorrespondente: '41163463000151', // UNICA PROMOTORA LTDA EPP
  correspondenteId: 1029994,
  correspondenteNome: 'UNICA PROMOTORA LTDA EPP',
  cnpjSubstabelecido: '47487633000130', // KJT INTERMEDIACAO DE NEGOCIOS LTDA
  substabelecidoId: 1044252,
  substabelecidoNome: 'KJT INTERMEDIACAO DE NEGOCIOS LTDA',
  usuarioDigitadorId: 'X491911', // LAURA
  usuarioDigitadorNome: 'LAURA RODRIGUES DA SILVA ALVES'
};

// Convenios conhecidos (id + nome)
const CONVENIOS = {
  MTE: { id: 4325761, nome: 'MINISTERIO DO TRABALHO E EMPREGO MTE' }
};

// Cache do token JWT (TTL ~12h padrao). Auto-renova via login quando expira.
let tokenCache = { token: null, sessaoId: null, ts: 0, exp: 0 };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

// Decodifica payload do JWT (base64url -> JSON)
function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const json = (typeof atob !== 'undefined') ? atob(b64) : Buffer.from(b64, 'base64').toString();
    return JSON.parse(json);
  } catch { return null; }
}

// LOGIN AUTOMATICO no Mercantil — usa MERCANTIL_USER + MERCANTIL_PASS das env vars.
// Endpoint: POST /pcb/sitebff/api/Usuarios/Autenticacao
// Senha vai em base64. Response retorna { access_token: JWT } com sessaoId no payload.
async function loginAutomatico() {
  const usuario = process.env.MERCANTIL_USER;
  const senha = process.env.MERCANTIL_PASS;
  if (!usuario || !senha) {
    return { ok: false, error: 'MERCANTIL_USER e MERCANTIL_PASS precisam estar setados nas env vars' };
  }

  // Senha vai base64 encoded
  const senhaB64 = (typeof btoa !== 'undefined') ? btoa(senha) : Buffer.from(senha).toString('base64');

  // dnaBrowser: fingerprint minimo. Mercantil parece nao validar conteudo,
  // so checa se vem string nao-null. Pegamos de env MERCANTIL_DNA_BROWSER ou
  // fallback pra um JSON minimo que costuma passar.
  const dnaBrowser = process.env.MERCANTIL_DNA_BROWSER || JSON.stringify({
    VERSION: '2.1.2',
    MFP: { BR: 'chrome', BV: '147', UA },
    UC: { ASYNC_FP: false, ASYNC_DOM_CHECK: true }
  });

  const payload = {
    loginUsuario: usuario,
    senha: senhaB64,
    agenteUsuario: UA,
    agenteUsuarioData: null,
    dnaBrowser,
    enderecoIp: null,
    reCaptchaToken: null,
    sessaoIdExterna: '',
    urlReferencia: 'https://meu.bancomercantil.com.br/'
  };

  let res, text;
  try {
    res = await fetch(`${BASE}${SITE_BFF}/Usuarios/Autenticacao`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Origin': 'https://meu.bancomercantil.com.br',
        'Referer': 'https://meu.bancomercantil.com.br/',
        'User-Agent': UA,
        'sec-ch-ua': '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"'
      },
      body: JSON.stringify(payload)
    });
    text = await res.text();
  } catch (e) {
    return { ok: false, error: 'Falha de rede no login: ' + e.message };
  }
  if (!res.ok) {
    let erro; try { erro = JSON.parse(text); } catch { erro = { raw: text.substring(0, 500) }; }
    // Loga detalhado pra debug — runtime logs do Vercel mostram
    console.log('[MERCANTIL_LOGIN_FAIL]', {
      status: res.status,
      usuario: usuario.substring(0, 4) + '***',
      senhaLen: senha.length,
      senhaB64Len: senhaB64.length,
      raw: text.substring(0, 500)
    });
    return {
      ok: false,
      error: 'Login Mercantil HTTP ' + res.status + ': ' + (erro?.mensagem || erro?.message || erro?.error || erro?.raw?.substring(0,150) || 'sem detalhes'),
      httpStatus: res.status,
      raw: erro,
      _hint: res.status === 401 ? 'Credenciais rejeitadas — verifique MERCANTIL_USER e MERCANTIL_PASS no Vercel. Tente fazer login manual no portal pra confirmar que estao ativas.'
           : res.status === 403 ? 'Acesso bloqueado — usuario pode estar travado por tentativas erradas. Logue manualmente pra desbloquear.'
           : res.status === 422 ? 'Body invalido — pode ser captcha agora ou campo faltando.'
           : null
    };
  }
  let data; try { data = JSON.parse(text); } catch { return { ok: false, error: 'Response invalido', raw: text.substring(0, 200) }; }

  const accessToken = data.access_token;
  if (!accessToken) return { ok: false, error: 'access_token ausente na response', raw: data };

  const jwtPayload = decodeJwtPayload(accessToken);
  const sessaoId = jwtPayload?.['mb.data']?.usuario?.sessaoId;
  const exp = (jwtPayload?.exp || 0) * 1000;

  if (!sessaoId) return { ok: false, error: 'sessaoId nao encontrado no JWT' };

  // Atualiza cache
  tokenCache = { token: accessToken, sessaoId, ts: Date.now(), exp };
  return { ok: true, token: accessToken, sessaoId, exp };
}

// Pega token valido (cache ou login automatico).
// Fallback final: env MERCANTIL_JWT + MERCANTIL_SESSAO_ID (manual, deprecated).
async function getToken() {
  // 1) Cache valido (com 60s margem antes do exp)
  if (tokenCache.token && tokenCache.exp > Date.now() + 60000) {
    return { ok: true, token: tokenCache.token, sessaoId: tokenCache.sessaoId };
  }
  // 2) Tenta login automatico (preferido)
  const login = await loginAutomatico();
  if (login.ok) return login;
  // 3) Fallback: JWT manual em env (deprecated, mas mantem compatibilidade)
  const envToken = process.env.MERCANTIL_JWT;
  const envSessao = process.env.MERCANTIL_SESSAO_ID;
  if (envToken && envSessao) {
    const payload = decodeJwtPayload(envToken);
    tokenCache = { token: envToken, sessaoId: envSessao, ts: Date.now(), exp: (payload?.exp || 0) * 1000 };
    return { ok: true, token: envToken, sessaoId: envSessao };
  }
  return { ok: false, error: login.error || 'Sem credenciais Mercantil configuradas' };
}

// HTTP helper com auth + headers padrao
async function mbCall(method, path, body, opts = {}) {
  const tk = await getToken();
  if (!tk.ok) return { ok: false, status: 401, data: { error: tk.error } };

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': 'Bearer ' + tk.token,
    'sessaousuarioid': tk.sessaoId,
    // Geolocation (Mercantil exige headers de geo) — usa de Sorocaba/SP por padrao
    'x-lat': process.env.MERCANTIL_LAT || '-23.52723855594553',
    'x-long': process.env.MERCANTIL_LONG || '-47.47438207974168',
    'Origin': 'https://meu.bancomercantil.com.br',
    'Referer': 'https://meu.bancomercantil.com.br/'
  };

  let res, text;
  try {
    res = await fetch(BASE + path, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined
    });
    text = await res.text();
  } catch (e) {
    return { ok: false, status: 0, data: { error: 'Falha de rede: ' + e.message } };
  }
  let d; try { d = JSON.parse(text); } catch { d = { raw: text.substring(0, 500) }; }
  return { ok: res.ok, status: res.status, data: d };
}

const j = (data, status = 200, req = null) => jsonResp(data, status, req);

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  if (req.method !== 'POST') return jsonError('POST only', 405, req);

  let body;
  try { body = await req.json(); } catch { return jsonError('JSON inválido', 400, req); }
  const action = body.action || '';

  // ─── INICIAR OPERAÇÃO ─────────────────────────────────────
  // POST /pcb/sitebff/api/PropostasProspect/IniciarOperacao
  // Confirma se cliente tem vínculo no convenio. Retorna operacaoId pra
  // depois simular tabelas.
  if (action === 'iniciarOperacao') {
    const cpf = String(body.cpf || '').replace(/\D/g, '');
    if (!cpf) return jsonError('cpf obrigatorio', 400, req);
    const convenio = CONVENIOS[body.convenio || 'MTE'] || CONVENIOS.MTE;
    const uf = (body.uf || 'SP').toUpperCase();

    const tk = await getToken();
    if (!tk.ok) return j({ success: false, error: tk.error }, 502, req);

    const payload = {
      empresaId: CORRESPONDENTE_DEFAULT.empresaId,
      cpfCliente: parseInt(cpf),
      cnpjCorrespondente: CORRESPONDENTE_DEFAULT.cnpjCorrespondente,
      correspondenteId: CORRESPONDENTE_DEFAULT.correspondenteId,
      correspondenteNome: CORRESPONDENTE_DEFAULT.correspondenteNome,
      cnpjSubstabelecido: CORRESPONDENTE_DEFAULT.cnpjSubstabelecido,
      substabelecidoId: CORRESPONDENTE_DEFAULT.substabelecidoId,
      substabelecidoNome: CORRESPONDENTE_DEFAULT.substabelecidoNome,
      convenioId: convenio.id,
      convenioNome: convenio.nome,
      modalidadeConvenio: 'ConsignadoPrivado',
      reCaptchaToken: null,
      sessaoId: tk.sessaoId,
      uf,
      usuarioDigitadorId: CORRESPONDENTE_DEFAULT.usuarioDigitadorId,
      usuarioDigitadorNome: CORRESPONDENTE_DEFAULT.usuarioDigitadorNome
    };

    const r = await mbCall('POST', `${SITE_BFF}/PropostasProspect/IniciarOperacao`, payload);
    const d = r.data || {};
    // Estrutura do response (200 OK):
    // { id: UUID, cpf, nomeCliente, modalidadeConvenio, propostaComboId,
    //   tokenBeneficiarioInssValido, tokenValidoConsignadoPrivado }
    const operacaoId = d.id || d.operacaoId || null;
    const tokenValido = d.tokenValidoConsignadoPrivado === true;
    return j({
      success: r.ok,
      httpStatus: r.status,
      cpf,
      convenio: convenio.nome,
      operacaoId,
      temCadastro: r.ok && !!operacaoId,             // Mercantil conhece o cliente
      nomeCliente: d.nomeCliente || null,            // nome retornado pelo banco
      tokenValidoConsignadoPrivado: tokenValido,     // cliente autorizou consulta?
      tokenBeneficiarioInssValido: d.tokenBeneficiarioInssValido === true,
      precisaAutorizacao: r.ok && !tokenValido,      // se conhece mas sem token valido
      semCadastro: !r.ok && r.status === 400,        // 400 = cliente novo / sem ficha
      mensagem: r.ok
        ? (tokenValido ? 'Cliente elegível com autorização válida' : 'Cliente cadastrado — precisa autorizar consulta consignado privado')
        : (r.status === 400 ? 'Cliente sem cadastro prévio no Mercantil' : 'Erro: ' + (d.mensagem || d.erro || r.status)),
      dados: d,
      _payload: payload
    }, 200, req);
  }

  // ─── SOLICITAR AUTORIZACAO DATAPREV — dispara SMS pro cliente com link ──
  // POST /pcb/sitebff/api/AutorizacoesDigitais/IN100ConsultaDesbloqueio
  // Banco envia SMS com link encurtado bml.b.br pro telefone informado.
  // Cliente clica no link, autoriza, e o sistema do Mercantil libera consulta.
  // Response: vazio/200 OK (banco nao retorna o link — nao da pra interceptar).
  if (action === 'solicitarAutorizacao') {
    const propostaProspectId = body.propostaProspectId || body.operacaoId;
    const ddd = parseInt(String(body.ddd || '').replace(/\D/g, '')) || null;
    const numeroCelular = parseInt(String(body.numeroCelular || body.telefone || '').replace(/\D/g, '')) || null;
    if (!propostaProspectId || !ddd || !numeroCelular) {
      return jsonError('propostaProspectId, ddd e numeroCelular obrigatorios', 400, req);
    }
    const payload = {
      ddd,
      numeroCelular,
      propostaProspectId,
      meioComunicacao: body.meioComunicacao || 'Sms'
    };
    const r = await mbCall('POST', `${SITE_BFF}/AutorizacoesDigitais/IN100ConsultaDesbloqueio`, payload);
    // Banco devolve 200 com body vazio (ou "1") quando SMS foi disparado com sucesso
    return j({
      success: r.ok,
      httpStatus: r.status,
      smsEnviado: r.ok,
      mensagem: r.ok
        ? 'SMS enviado pro cliente. Cliente vai receber link bml.b.br pra autorizar.'
        : 'Falha ao disparar SMS: ' + (r.data?.error || r.status),
      _payload: payload,
      _raw: r.data
    }, 200, req);
  }

  // ─── VERIFICAR AUTORIZACAO — re-chama IniciarOperacao pra checar se cliente
  // ja autorizou. Quando autorizou, tokenValidoConsignadoPrivado vira true.
  if (action === 'verificarAutorizacao') {
    const cpf = String(body.cpf || '').replace(/\D/g, '');
    if (!cpf) return jsonError('cpf obrigatorio', 400, req);
    const convenio = CONVENIOS[body.convenio || 'MTE'] || CONVENIOS.MTE;
    const tk = await getToken();
    if (!tk.ok) return j({ success: false, error: tk.error }, 502, req);

    const payload = {
      empresaId: CORRESPONDENTE_DEFAULT.empresaId,
      cpfCliente: parseInt(cpf),
      cnpjCorrespondente: CORRESPONDENTE_DEFAULT.cnpjCorrespondente,
      correspondenteId: CORRESPONDENTE_DEFAULT.correspondenteId,
      correspondenteNome: CORRESPONDENTE_DEFAULT.correspondenteNome,
      cnpjSubstabelecido: CORRESPONDENTE_DEFAULT.cnpjSubstabelecido,
      substabelecidoId: CORRESPONDENTE_DEFAULT.substabelecidoId,
      substabelecidoNome: CORRESPONDENTE_DEFAULT.substabelecidoNome,
      convenioId: convenio.id,
      convenioNome: convenio.nome,
      modalidadeConvenio: 'ConsignadoPrivado',
      reCaptchaToken: null,
      sessaoId: tk.sessaoId,
      uf: (body.uf || 'SP').toUpperCase(),
      usuarioDigitadorId: CORRESPONDENTE_DEFAULT.usuarioDigitadorId,
      usuarioDigitadorNome: CORRESPONDENTE_DEFAULT.usuarioDigitadorNome
    };
    const r = await mbCall('POST', `${SITE_BFF}/PropostasProspect/IniciarOperacao`, payload);
    const d = r.data || {};
    const autorizado = d.tokenValidoConsignadoPrivado === true;
    return j({
      success: r.ok,
      autorizado,
      operacaoId: d.id || null,
      nomeCliente: d.nomeCliente || null,
      mensagem: autorizado
        ? 'Cliente autorizou! Pode prosseguir pra simulacao.'
        : 'Cliente ainda nao autorizou. Aguarde alguns minutos e tente de novo.'
    }, 200, req);
  }

  // ─── LOGIN — forca novo login (renova JWT). Util pra testar credenciais ──
  if (action === 'login') {
    tokenCache = { token: null, sessaoId: null, ts: 0, exp: 0 }; // limpa cache
    const r = await loginAutomatico();
    if (!r.ok) return j({ success: false, error: r.error, raw: r.raw }, 200, req);
    return j({
      success: true,
      sessaoId: r.sessaoId,
      tokenExpEm: new Date(r.exp).toISOString(),
      tokenLength: r.token.length,
      observacao: 'JWT em cache. Use action=iniciarOperacao agora.'
    }, 200, req);
  }

  // ─── TEST: valida JWT/sessao + tenta IniciarOperacao com CPF teste ──
  if (action === 'test') {
    const tk = await getToken();
    if (!tk.ok) return j({ success: false, error: tk.error }, 200, req);
    return j({
      success: true,
      tokenPresente: true,
      sessaoId: tk.sessaoId,
      tokenExpEm: new Date(tokenCache.exp).toISOString(),
      observacao: 'Use action=iniciarOperacao com {cpf} pra testar consulta real'
    }, 200, req);
  }

  return jsonError(`action invalida. Disponiveis: login, iniciarOperacao, solicitarAutorizacao, verificarAutorizacao, test`, 400, req);
}
