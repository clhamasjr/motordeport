export const config = { runtime: 'edge' };

// ══════════════════════════════════════════════════════════════════
// api/soma.js — SOMA (api.somabp2.com.br) — Consignado Privado CLT
//
// Bancarizadoras: UY3 e CELCOIN (informada no corpo, rotas V2 unificadas).
// Auth: OAuth2 client_credentials → POST /auth/oauth/token
//   {grantType:'client_credentials', clientId (soma_live_*), clientSecret
//   (soma_sk_*)} → {accessToken (Bearer JWT, 30min), accessExpiraEm}.
//
// Fluxo V2 (docs api.somabp2.com.br/docs):
//   1) POST /v2/privado/externo/consultas/   {bancarizadora, cpf, nome,
//      celular, dataNascimento?} → conId + margem + conLinkAssinatura
//   2) POST /v2/privado/externo/simulacoes/  {bancarizadora, consultaId,
//      tipoCalculo (VALOR_PARCELA|VALOR_LIQUIDO|VALOR_BRUTO), valor, parcelas?}
//   3) POST /v2/externo/clientes/            {cliente, endereco?, contaBancaria?}
//   4) POST /v2/privado/externo/propostas/   {bancarizadora, clienteId,
//      consultaId, simulacaoId, contaBancariaId} → proId + proLinkAssinatura
//      Cancelar: POST /v2/privado/externo/propostas/cancelar
//      Status:   GET  /v2/privado/externo/propostas/{propostaId}
//
// Webhooks (painel): CONSULTA_STATUS_ALTERADO / PROPOSTA_STATUS_ALTERADO —
// a consulta pode ser ASSÍNCRONA (status muda depois). Env vars (Vercel):
// SOMA_CLIENT_ID, SOMA_CLIENT_SECRET, SOMA_BASE_URL (opcional).
// ══════════════════════════════════════════════════════════════════

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';
import { dbSelect, dbUpsert } from './_lib/supabase.js';

function getConfig() {
  return {
    BASE: (process.env.SOMA_BASE_URL || 'https://api.somabp2.com.br').trim().replace(/\/+$/, ''),
    CLIENT_ID: (process.env.SOMA_CLIENT_ID || '').trim(),
    CLIENT_SECRET: (process.env.SOMA_CLIENT_SECRET || '').trim(),
    // Login DO PORTAL (operador) — pra confirmar o aceite (rotas internas
    // produtos/privados/consultas/* usam o token do portal, não o de integração).
    // Mesmo padrão do Fintech do Corban (login → token). Token vem no HEADER
    // 'access-token' da resposta. Login: POST auth/login {usuario:CPF, senha}.
    PORTAL_USUARIO: (process.env.SOMA_PORTAL_USUARIO || '').trim(),
    PORTAL_SENHA: (process.env.SOMA_PORTAL_SENHA || '').trim(),
    PORTAL_SLUG: (process.env.SOMA_PORTAL_SLUG || 'default').trim(),
  };
}

const onlyDigits = (s) => String(s || '').replace(/\D/g, '');
const j = (data, status = 200, req = null) => jsonResp(data, status, req);

// ── Token cache (Bearer 30min → cacheia 25min) ─────────────────
let _tk = { token: null, exp: 0 };

async function getToken() {
  if (_tk.token && Date.now() < _tk.exp) return _tk.token;
  const cfg = getConfig();
  if (!cfg.CLIENT_ID || !cfg.CLIENT_SECRET) {
    throw new Error('SOMA_CLIENT_ID/SOMA_CLIENT_SECRET nao configurados (Vercel env)');
  }
  const r = await fetch(cfg.BASE + '/auth/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grantType: 'client_credentials',
      clientId: cfg.CLIENT_ID,
      clientSecret: cfg.CLIENT_SECRET,
    }),
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 300) }; }
  if (!r.ok || !d.accessToken) {
    throw new Error(`Falha auth SOMA (HTTP ${r.status}): ${d.message || d.error || d.raw || 'sem detalhes'}`);
  }
  _tk = { token: d.accessToken, exp: Date.now() + 25 * 60 * 1000 };
  return d.accessToken;
}

// somaCall — usa o token de INTEGRAÇÃO (OAuth) por padrão. tokenOverride
// permite passar o token do PORTAL (pro fluxo de aceite).
async function somaCall(path, method = 'GET', body = null, tokenOverride = null) {
  const token = tokenOverride || await getToken();
  const cfg = getConfig();
  const opts = {
    method,
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
  };
  if (body !== null && method !== 'GET') opts.body = JSON.stringify(body);
  const r = await fetch(cfg.BASE + path, opts);
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 2000) }; }
  return { ok: r.ok, status: r.status, data: d };
}

// ── LOGIN DO PORTAL (auto) — receita capturada 15/07 ──────────
// POST auth/login {usuario, senha, slug:'default'} + header 'token' (id de
// sessão). Retorna access-token/refresh-token/token nos HEADERS. Salva tudo
// na sessão (soma_portal_session) — o robô loga sozinho e se auto-cura.
function genSessionToken() {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = ''; for (let i = 0; i < 25; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}
async function loginPortalESalvar() {
  const cfg = getConfig();
  if (!cfg.PORTAL_USUARIO || !cfg.PORTAL_SENHA) {
    throw new Error('SOMA_PORTAL_USUARIO/SOMA_PORTAL_SENHA nao configurados (login do portal)');
  }
  const sess = await getPortalSession();
  const tokenHdr = (sess && sess.token) || genSessionToken();
  const r = await fetch(cfg.BASE + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'accept': 'application/json, text/plain, */*', 'token': tokenHdr },
    body: JSON.stringify({ usuario: cfg.PORTAL_USUARIO, senha: cfg.PORTAL_SENHA, slug: cfg.PORTAL_SLUG }),
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 300) }; }
  if (!r.ok) throw new Error(`login portal SOMA (HTTP ${r.status}): ${d.message || d.error || d.raw || ''}`);
  // MFA/2FA: a SOMA responde 200 com {tipo:'MFA_REQUERIDO'} → login não termina
  // server-side (precisa de código). Não dá pra automatizar — use setPortalSession.
  if (d && (d.tipo === 'MFA_REQUERIDO' || d.mfaToken)) {
    throw new Error('SOMA exige 2FA (MFA_REQUERIDO) — login automático impossível. Cole a sessão via setPortalSession.');
  }
  // access-token pode vir no HEADER (padrão SOMA) ou no corpo
  const bearer = r.headers.get('access-token') || d.accessToken || d.access_token || d.token || d.data?.accessToken;
  const refresh = r.headers.get('refresh-token') || d.refreshToken || d.refresh_token || null;
  const tk = r.headers.get('token') || tokenHdr;
  if (!bearer) throw new Error(`login sem access-token — 2FA? resp: ${JSON.stringify(d).substring(0, 200)}`);
  await savePortalSession({ bearer, token: tk, refresh_token: refresh });
  return bearer;
}

// ── AUTO-AUTORIZAÇÃO (procuração — modelo Handbank/UY3/Nossa Fintech) ──
// A SOMA não expõe endpoint de autz no swagger público, MAS o botão
// "Confirmar aceite" da página sistema.somabp2.com.br/privado/aceite-margem
// dispara POST produtos/privados/consultas/confirmar-aceite {conHashTermo,
// dispositivoUsuario} — endpoint PÚBLICO (autoriza pelo hash, sem login).
// O hash é o uuid do conLinkAssinatura. Chamamos server-side (procuração
// escrita do cliente, igual ChallengeInfo do Handbank).
function extrairHashLink(link) {
  const m = String(link || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0] : null;
}

// ── SESSÃO DO PORTAL (bootstrapada + auto-renovada) ────────────
// As rotas de aceite (produtos/privados/consultas/*) exigem 3 headers da
// SESSÃO LOGADA do operador: Authorization: Bearer <JWT>, token: <sessão>,
// refresh-token: <hex>. Capturado do portal (15/07). O JWT dura ~15min, MAS
// a SOMA renova o access-token no HEADER de TODA resposta — então basta
// bootstrapar 1x (operador loga no navegador, cola os 3 via action
// setPortalSession) e cada chamada mantém a sessão viva. Guardado na tabela
// soma_portal_session (migration supabase_soma_portal_session.sql).
let _sessMem = null; // cache em memória por invocação
async function getPortalSession() {
  if (_sessMem) return _sessMem;
  const { data } = await dbSelect('soma_portal_session', { filters: { id: 1 }, single: true });
  _sessMem = data || null;
  return _sessMem;
}
async function savePortalSession(patch) {
  const atual = (await getPortalSession()) || {};
  const merged = { id: 1, ...atual, ...patch, atualizado_em: new Date().toISOString() };
  _sessMem = merged;
  await dbUpsert('soma_portal_session', merged, 'id').catch(() => {});
  return merged;
}

// Chamada às rotas do portal com os 3 headers da sessão + auto-renovação.
// Captura access-token/refresh-token/token novos que a SOMA devolver no
// header da resposta e atualiza a sessão (keep-alive).
async function portalCall(path, method = 'POST', body = null) {
  const cfg = getConfig();
  const sess = await getPortalSession();
  // Sem sessão salva → NÃO tenta logar sozinho. O login da SOMA exige MFA (2FA)
  // + um header 'token' emitido pelo site — impossível de fazer server-side
  // (dá 403 "Token inválido" e ainda arrisca bloquear a conta por tentativa).
  // A sessão tem que ser BOOTSTRAPADA 1x pelo operador (login normal no
  // navegador → grampo captura os 3 headers → setPortalSession). Ver README.
  if (!sess || !sess.bearer) {
    return { ok: false, status: 401, _semSessao: true, data: { error: 'Sessão SOMA não configurada. A SOMA exige 2FA no login — o robô não loga sozinho. Faça login no portal e rode o snippet de captura (setPortalSession) 1x.' } };
  }
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + sess.bearer,
    'accept': 'application/json, text/plain, */*',
  };
  if (sess.token) headers['token'] = sess.token;
  if (sess.refresh_token) headers['refresh-token'] = sess.refresh_token;
  const r = await fetch(cfg.BASE + path, {
    method, headers, ...(body !== null && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
  });

  // 401 = sessão morreu. Não re-loga (MFA). Sinaliza pra recolar a sessão.
  if (r.status === 401) {
    return { ok: false, status: 401, _semSessao: true, data: { error: 'Sessão SOMA expirada — recole a sessão (login no navegador + snippet setPortalSession).' } };
  }

  // keep-alive: SOMA renova os tokens nos headers da resposta
  const novoBearer = r.headers.get('access-token');
  const novoRefresh = r.headers.get('refresh-token');
  const novoToken = r.headers.get('token');
  const upd = {};
  if (novoBearer && novoBearer !== sess.bearer) upd.bearer = novoBearer;
  if (novoRefresh && novoRefresh !== sess.refresh_token) upd.refresh_token = novoRefresh;
  if (novoToken && novoToken !== sess.token) upd.token = novoToken;
  if (Object.keys(upd).length) await savePortalSession(upd);
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 800) }; }
  return { ok: r.ok, status: r.status, data: d };
}

// Monta o dispositivoUsuario igual ao portal real (schema capturado 15/07),
// com geolocalização REALISTA (Sorocaba/SP, precisão ~160m + leve jitter —
// precisão de 20m cheirava a robô). Aceita override {lat,lng,precisao}.
function montarDispositivo(geo) {
  const jitter = () => (Math.random() - 0.5) * 0.0025;
  const g = geo || {};
  return {
    agenteUsuario: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    fusoHorario: 'America/Sao_Paulo',
    geolocalizacao: {
      ok: true,
      lat: typeof g.lat === 'number' ? g.lat : -23.52813 + jitter(),
      lng: typeof g.lng === 'number' ? g.lng : -47.47399 + jitter(),
      precisao: typeof g.precisao === 'number' ? g.precisao : 130 + Math.floor(Math.random() * 90),
      marcaTempo: Date.now(),
    },
    idioma: 'pt-BR',
    modeloDispositivo: null,
    plataforma: 'Windows',
  };
}

async function confirmarAceite(hashTermo, geo = null) {
  // 2 passos com a sessão do portal (Bearer + token + refresh-token):
  //   1) validar-hash {conHashTermo}  2) confirmar-aceite {conHashTermo, dispositivoUsuario}
  const val = await portalCall('/produtos/privados/consultas/validar-hash', 'POST', { conHashTermo: hashTermo });
  if (val._semSessao) return { ok: false, status: 401, data: val.data, _semSessao: true };
  if (!val.ok) return { ok: false, status: val.status, data: val.data, _etapa: 'validar-hash' };
  const conf = await portalCall('/produtos/privados/consultas/confirmar-aceite', 'POST', {
    conHashTermo: hashTermo,
    dispositivoUsuario: montarDispositivo(geo), // schema REAL do portal (15/07)
  });
  return { ok: conf.ok, status: conf.status, data: conf.data, _validarHash: { status: val.status, ok: val.ok } };
}

// ── Normaliza a consulta de margem no formato do motor CLT ─────
// Campos da SOMA: conId, conStatusId/Nome, conMargemDisponivel, conMargemBruta,
// conSalarioBruto/Liquido, conLinkAssinatura, conAssinadoEm, conMatricula,
// conCnpj, conEmpregador, conAdmissao, conMensagem, motivosMapeados, simulacoes.
function normalizarConsulta(c, httpStatus) {
  const margem = parseFloat(c?.conMargemDisponivel ?? 0) || 0;
  const statusNome = String(c?.conStatusNome || '').toLowerCase();
  const motivos = Array.isArray(c?.motivosMapeados)
    ? c.motivosMapeados.map((m) => (typeof m === 'string' ? m : (m?.mtcNome || m?.mensagem || m?.motivo || m?.nome || JSON.stringify(m)))).join('; ')
    : null;

  const base = {
    consultaId: c?.conId || null,
    bancarizadora: c?.conBancarizadora || null,
    statusSoma: c?.conStatusNome || null,
    vinculo: {
      matricula: c?.conMatricula || null,
      cnpj: c?.conCnpj || null,
      empregador: c?.conEmpregador || null,
      dataAdmissao: c?.conAdmissao || null,
    },
    margem: {
      disponivel: margem,
      bruta: parseFloat(c?.conMargemBruta ?? 0) || 0,
      salarioBruto: parseFloat(c?.conSalarioBruto ?? 0) || 0,
      salarioLiquido: parseFloat(c?.conSalarioLiquido ?? 0) || 0,
    },
    linkAssinatura: c?.conLinkAssinatura || null,
    assinadoEm: c?.conAssinadoEm || null,
    simulacoes: c?.simulacoes || [],
    _raw: c,
  };

  // NÃO ELEGÍVEL: a SOMA pode devolver MARGEM mas o cliente não ser elegível
  // (empregador sem convênio, restrição, CBO, etc.). NÃO pode virar APROVADO —
  // mostra a margem MAS com status NÃO ELEGÍVEL (não operável). Detecção robusta
  // no conStatusNome + motivosMapeados + conMensagem ("não elegível"/"inelegível").
  const textoElig = `${c?.conStatusNome || ''} ${motivos || ''} ${c?.conMensagem || ''}`;
  const naoElegivel = /(?:n[aã]o[\s-]*|in)eleg[ií]ve?l/i.test(textoElig);
  if (naoElegivel) {
    return {
      ...base, etapa: 'NAO_ELEGIVEL', approved: false, naoElegivel: true,
      mensagem: `NÃO ELEGÍVEL${margem > 0 ? ` · margem R$ ${margem.toFixed(2)} (não operável)` : ''}${motivos ? ' · ' + motivos : (c?.conMensagem ? ' · ' + c.conMensagem : '')}`,
    };
  }

  if (margem > 0) {
    return { ...base, etapa: 'APROVADO', approved: true, mensagem: `Cliente elegível — margem R$ ${margem.toFixed(2)}` };
  }
  // Precisa assinatura do cliente (link gerado, ainda nao assinado)
  if (c?.conLinkAssinatura && !c?.conAssinadoEm) {
    return {
      ...base, etapa: 'AGUARDA_AUTORIZACAO', approved: false,
      mensagem: '⏳ Aguardando cliente assinar a autorização (link disponível)',
    };
  }
  // Status em processamento (consulta assíncrona — webhook muda depois)
  if (/process|pendente|aguard|andamento|criad/.test(statusNome)) {
    return {
      ...base, etapa: 'EM_ANALISE', approved: false,
      mensagem: `⏳ Consulta em processamento na SOMA (${c?.conStatusNome || 'aguarde'})`,
    };
  }
  // Recusa/sem margem com motivo real
  return {
    ...base, etapa: 'SEM_MARGEM', approved: false,
    mensagem: motivos || c?.conMensagem || c?.conStatusNome || `Sem margem disponível (HTTP ${httpStatus})`,
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
      try {
        const token = await getToken();
        return j({ success: true, apiActive: true, mensagem: 'SOMA autenticada (OAuth2 ok)', tokenPreview: token.substring(0, 12) + '...' }, 200, req);
      } catch (e) {
        return j({ success: false, apiActive: false, mensagem: e.message }, 200, req);
      }
    }

    // ─── CONSULTA DE MARGEM (motor CLT usa esta) ──────────────
    // body: { cpf, nome, telefone, dataNascimento?, bancarizadora? }
    if (action === 'consultarMargem' || action === 'consultarAprovacao') {
      const cpf = onlyDigits(body.cpf);
      if (cpf.length !== 11) return jsonError('cpf invalido', 400, req);
      const nome = (body.nome || '').trim();
      const celular = onlyDigits(body.telefone || body.celular);
      if (!nome || celular.length < 10) {
        return j({
          etapa: 'AGUARDA_DADOS', approved: false,
          mensagem: 'SOMA exige nome e celular na consulta — complete os dados do cliente',
        }, 200, req);
      }
      const bancarizadora = (body.bancarizadora || 'CELCOIN').toUpperCase();
      const payload = { bancarizadora, cpf, nome, celular };
      if (body.dataNascimento) payload.dataNascimento = body.dataNascimento;

      const r = await somaCall('/v2/privado/externo/consultas/', 'POST', payload);
      if (!r.ok) {
        return j({
          etapa: 'ERRO', approved: false, retryable: r.status >= 500 || r.status === 429,
          httpStatus: r.status,
          mensagem: r.data?.message || r.data?.error || `Erro SOMA (HTTP ${r.status})`,
          _raw: r.data,
        }, 200, req);
      }
      let norm = normalizarConsulta(r.data, r.status);

      // AUTO-AUTORIZAÇÃO: DESLIGADA por default. O login do portal tem 2FA →
      // robô server-side inviável (precisaria do código OTP toda hora). Fluxo
      // padrão = LINK (o operador/cliente clica e aceita). Só tenta auto se
      // explicitamente autoAutorizar:true (ex: se um dia rolar usuário API sem 2FA).
      const autoAutorizar = body.autoAutorizar === true;
      if (autoAutorizar && norm.etapa === 'AGUARDA_AUTORIZACAO' && norm.linkAssinatura) {
        const hash = extrairHashLink(norm.linkAssinatura);
        if (hash) {
          const aut = await confirmarAceite(hash);
          norm._autoAutz = { ok: aut.ok, status: aut.status, msg: aut.data?.message || null };
          if (aut.ok) {
            // Re-consulta (agora autorizado → deve vir a margem)
            const r2 = await somaCall('/v2/privado/externo/consultas/', 'POST', payload);
            if (r2.ok) { norm = normalizarConsulta(r2.data, r2.status); norm._reconsultado = true; }
          }
        }
      }
      return j(norm, 200, req);
    }

    // ─── TESTAR A SESSÃO DO PORTAL (colada via setPortalSession) ──
    // A SOMA exige 2FA no login → o robô NÃO loga sozinho. Este teste só
    // confere se a sessão colada ainda está viva (não faz login).
    if (action === 'testPortal') {
      const s = await getPortalSession();
      if (!s || !s.bearer) {
        return j({ success: false, loginPortal: 'sem-sessao', mensagem: 'Sessão não colada. A SOMA tem 2FA — faça login no navegador e rode o snippet de captura (setPortalSession) 1x.' }, 200, req);
      }
      const teste = await portalCall('/produtos/privados/consultas/validar-hash', 'POST', { conHashTermo: '00000000-0000-0000-0000-000000000000' });
      const viva = teste.status !== 401 && !teste._semSessao;
      return j({
        success: viva, loginPortal: viva ? 'ok' : 'expirada',
        mensagem: viva ? 'Sessão colada está VIVA ✅ — robô de aceite ativo' : 'Sessão expirada — recole (login + snippet).',
        atualizado_em: s.atualizado_em, testeStatus: teste.status,
      }, 200, req);
    }

    // ─── AUTORIZAR (confirmar aceite manualmente por hash ou link) ──
    if (action === 'autorizar') {
      const hash = extrairHashLink(body.link || body.hashTermo || body.conHashTermo);
      if (!hash) return jsonError('link ou hashTermo obrigatorio (uuid)', 400, req);
      const geo = (body.lat || body.lng || body.precisao) ? { lat: body.lat, lng: body.lng, precisao: body.precisao } : null;
      const aut = await confirmarAceite(hash, geo);
      return j({ success: aut.ok, httpStatus: aut.status, ...aut.data }, 200, req);
    }

    // ─── BOOTSTRAP DA SESSÃO DO PORTAL (login 1x no navegador) ──
    // Operador loga no portal, copia os 3 tokens (do "Copiar como fetch") e
    // manda aqui UMA vez. A partir daí o robô mantém vivo sozinho (renova a
    // cada resposta). body: { bearer, token, refreshToken }
    if (action === 'setPortalSession') {
      const bearer = String(body.bearer || body.authorization || '').replace(/^Bearer\s+/i, '').trim();
      const token = String(body.token || '').trim();
      const refreshToken = String(body.refreshToken || body['refresh-token'] || '').trim();
      if (!bearer) return jsonError('bearer obrigatorio (o JWT do Authorization, sem "Bearer ")', 400, req);
      await savePortalSession({ bearer, token: token || null, refresh_token: refreshToken || null });
      return j({ success: true, mensagem: 'Sessão do portal SOMA salva — robô de aceite ativo', temToken: !!token, temRefresh: !!refreshToken }, 200, req);
    }

    // ─── STATUS DA SESSÃO (sem expor os tokens) ────────────────
    if (action === 'statusPortalSession') {
      const s = await getPortalSession();
      if (!s || !s.bearer) return j({ success: true, configurada: false, mensagem: 'Sessão não configurada — rode setPortalSession' }, 200, req);
      // testa a sessão num endpoint leve (validar-hash com hash fake → se a
      // sessão vale, volta erro de negócio; se morreu, volta 401)
      const teste = await portalCall('/produtos/privados/consultas/validar-hash', 'POST', { conHashTermo: '00000000-0000-0000-0000-000000000000' });
      const viva = teste.status !== 401;
      return j({
        success: true, configurada: true, viva,
        atualizado_em: s.atualizado_em,
        bearerPreview: (s.bearer || '').substring(0, 10) + '...',
        temToken: !!s.token, temRefresh: !!s.refresh_token,
        testeStatus: teste.status,
        mensagem: viva ? 'Sessão viva ✅' : 'Sessão expirada — re-bootstrap (login de novo)',
      }, 200, req);
    }

    // ─── SIMULAÇÃO ────────────────────────────────────────────
    // body: { consultaId, bancarizadora, valor, tipoCalculo?, parcelas?, comSeguro? }
    if (action === 'simular') {
      if (!body.consultaId || !body.valor) return jsonError('consultaId e valor obrigatorios', 400, req);
      const r = await somaCall('/v2/privado/externo/simulacoes/', 'POST', {
        bancarizadora: (body.bancarizadora || 'CELCOIN').toUpperCase(),
        consultaId: body.consultaId,
        tipoCalculo: body.tipoCalculo || 'VALOR_LIQUIDO',
        valor: parseFloat(body.valor),
        ...(body.parcelas ? { parcelas: parseInt(body.parcelas, 10) } : {}),
        ...(body.comSeguro !== undefined ? { comSeguro: !!body.comSeguro } : {}),
        ...(body.ppagamento ? { ppagamento: body.ppagamento } : {}),
      });
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    // (WhatsApp da SOMA REMOVIDO a pedido — não há mais action enviarLinkAceite.
    //  Aceite é dado pelo robô via sessão do portal; sem envio ao cliente.)

    // ─── REGISTRAR WEBHOOK (aponta a SOMA pro nosso receptor) ──
    if (action === 'registrarWebhook') {
      const appUrl = (process.env.APP_URL || 'https://flowforce.vercel.app').replace(/\/+$/, '');
      const segredo = process.env.SOMA_WEBHOOK_SECRET || '';
      const url = `${appUrl}/api/soma-webhook${segredo ? `?s=${encodeURIComponent(segredo)}` : ''}`;
      const r = await somaCall('/integracao/externo/webhook', 'POST', {
        url,
        authTipo: segredo ? 'bearer' : 'none',
        ...(segredo ? { authToken: segredo } : {}),
        eventos: ['CONSULTA_STATUS_ALTERADO', 'PROPOSTA_STATUS_ALTERADO'],
        ativo: true,
      });
      return j({ success: r.ok, httpStatus: r.status, urlRegistrada: url, ...r.data }, 200, req);
    }

    // ─── CLIENTE (cliente + endereco + conta de uma vez) ──────
    if (action === 'salvarCliente') {
      if (!body.cliente) return jsonError('cliente (objeto) obrigatorio', 400, req);
      const r = await somaCall('/v2/externo/clientes/', 'POST', {
        cliente: body.cliente,
        ...(body.endereco ? { endereco: body.endereco } : {}),
        ...(body.contaBancaria ? { contaBancaria: body.contaBancaria } : {}),
      });
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    // ─── PROPOSTA (digitação) ─────────────────────────────────
    if (action === 'cadastrarProposta') {
      const need = ['clienteId', 'consultaId', 'simulacaoId', 'contaBancariaId'];
      for (const k of need) if (!body[k]) return jsonError(`${k} obrigatorio`, 400, req);
      const r = await somaCall('/v2/privado/externo/propostas/', 'POST', {
        bancarizadora: (body.bancarizadora || 'CELCOIN').toUpperCase(),
        clienteId: body.clienteId,
        consultaId: body.consultaId,
        simulacaoId: body.simulacaoId,
        contaBancariaId: body.contaBancariaId,
      });
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    if (action === 'consultarProposta') {
      if (!body.propostaId) return jsonError('propostaId obrigatorio', 400, req);
      const r = await somaCall(`/v2/privado/externo/propostas/${encodeURIComponent(body.propostaId)}`, 'GET');
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    if (action === 'cancelarProposta') {
      // payload flexivel — campos exatos a confirmar ao vivo (propostaId + bancarizadora)
      const r = await somaCall('/v2/privado/externo/propostas/cancelar', 'POST', {
        ...(body.propostaId ? { propostaId: body.propostaId } : {}),
        ...(body.bancarizadora ? { bancarizadora: String(body.bancarizadora).toUpperCase() } : {}),
        ...(body.motivo ? { motivo: body.motivo } : {}),
      });
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    // ─── DEBUG: chamada crua (iterar payloads sem deploy) ─────
    if (action === 'rawCall') {
      if (!body.path || !String(body.path).startsWith('/')) return jsonError('path obrigatorio (comeca com /)', 400, req);
      const r = await somaCall(body.path, body.method || 'GET', body.payload ?? null);
      return j({ success: r.ok, httpStatus: r.status, data: r.data }, 200, req);
    }

    return jsonError('Action invalida. Validas: test, testPortal, consultarMargem, autorizar, registrarWebhook, simular, salvarCliente, cadastrarProposta, consultarProposta, cancelarProposta, rawCall', 400, req);
  } catch (e) {
    return jsonError('Erro SOMA: ' + e.message, 500, req);
  }
}
