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

function getConfig() {
  return {
    BASE: (process.env.SOMA_BASE_URL || 'https://api.somabp2.com.br').trim().replace(/\/+$/, ''),
    CLIENT_ID: (process.env.SOMA_CLIENT_ID || '').trim(),
    CLIENT_SECRET: (process.env.SOMA_CLIENT_SECRET || '').trim(),
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

async function somaCall(path, method = 'GET', body = null) {
  const token = await getToken();
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

async function confirmarAceite(hashTermo) {
  // Fluxo do portal (2 passos, AMBOS com Bearer do parceiro — rotas
  // produtos/privados/consultas/* são escopo do parceiro; "Link aceite via
  // API" habilitado na conta):
  //   1) validar-hash {conHashTermo}  2) confirmar-aceite {conHashTermo, dispositivoUsuario}
  const val = await somaCall('/produtos/privados/consultas/validar-hash', 'POST', { conHashTermo: hashTermo });
  const conf = await somaCall('/produtos/privados/consultas/confirmar-aceite', 'POST', {
    conHashTermo: hashTermo,
    dispositivoUsuario: {
      plataforma: 'Backend',
      sistemaOperacional: 'Server',
      navegador: 'LhamasCred',
      modeloDispositivo: 'LhamasCred Backend',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      geolocalizacao: { latitude: '-23.5015', longitude: '-47.4526' }, // Sorocaba/SP
    },
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
    ? c.motivosMapeados.map((m) => (typeof m === 'string' ? m : m?.mensagem || m?.motivo || JSON.stringify(m))).join('; ')
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

      // AUTO-AUTORIZAÇÃO (procuração): confirma o aceite server-side + re-consulta.
      // DEFAULT DESLIGADO (14/07/2026): os endpoints de aceite da SOMA
      // (produtos/privados/consultas/{validar-hash,confirmar-aceite}) são do
      // PORTAL LOGADO — rejeitam o token de integração externa com "Token não
      // fornecido". Precisa a SOMA habilitar "aceite via API" (flag
      // parLinkAceiteViaApi) pra conta; quando habilitarem, é só passar
      // autoAutorizar:true (ou virar o default). Enquanto isso: link pro cliente.
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

    // ─── AUTORIZAR (confirmar aceite manualmente por hash ou link) ──
    if (action === 'autorizar') {
      const hash = extrairHashLink(body.link || body.hashTermo || body.conHashTermo);
      if (!hash) return jsonError('link ou hashTermo obrigatorio (uuid)', 400, req);
      const aut = await confirmarAceite(hash);
      return j({ success: aut.ok, httpStatus: aut.status, ...aut.data }, 200, req);
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

    return jsonError('Action invalida. Validas: test, consultarMargem, simular, salvarCliente, cadastrarProposta, consultarProposta, cancelarProposta, rawCall', 400, req);
  } catch (e) {
    return jsonError('Erro SOMA: ' + e.message, 500, req);
  }
}
