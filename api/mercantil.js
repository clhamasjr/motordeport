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

// Cache do token JWT (TTL ~12h padrao)
let tokenCache = { token: null, sessaoId: null, ts: 0, exp: 0 };

// TODO: implementar quando soubermos endpoint de LOGIN
// Por enquanto, aceita JWT pre-gerado via env MERCANTIL_JWT (manual)
async function getToken() {
  // 1) Token do cache (se nao expirou)
  if (tokenCache.token && tokenCache.exp > Date.now() + 60000) {
    return { ok: true, token: tokenCache.token, sessaoId: tokenCache.sessaoId };
  }
  // 2) JWT pre-gerado em env (fallback temporario)
  const envToken = process.env.MERCANTIL_JWT;
  const envSessao = process.env.MERCANTIL_SESSAO_ID;
  if (envToken && envSessao) {
    // Decodifica payload pra pegar exp
    try {
      const parts = envToken.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      tokenCache = {
        token: envToken,
        sessaoId: envSessao,
        ts: Date.now(),
        exp: (payload.exp || 0) * 1000
      };
      return { ok: true, token: envToken, sessaoId: envSessao };
    } catch { /* invalido */ }
  }
  return { ok: false, error: 'JWT nao configurado. Setar MERCANTIL_JWT + MERCANTIL_SESSAO_ID nas env vars (TODO: implementar login automatico)' };
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

  return jsonError(`action invalida. Disponiveis: iniciarOperacao, test`, 400, req);
}
