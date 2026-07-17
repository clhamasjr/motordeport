export const config = { runtime: 'edge' };

// ══════════════════════════════════════════════════════════════════
// api/happy.js — HAPPY (byx capital / Vhagar) — Consignado Privado CLT
//
// Base: prod https://vhagar-backend-prod.byxcapital.com.br
//       homolog https://vhagar-staging.byxcapital.com.br  (HAPPY_BASE_URL)
//
// AUTH: POST /api/v1/consignado-privado/auth {client_id, secret, usuario, senha}
//   → {token_opaco (Bearer), expira_em, rate_limit}. Depois: Authorization:
//   Bearer <token_opaco> em TODO request.
// HEADERS obrigatórios em TODA rota autenticada:
//   cpf-digitador, x-correspondente-banqueiro.
//
// FLUXO (docs byx):
//  4) POST /cliente/consulta-dataprev {nome, telefone, cpf, consultar} →
//     {situacao(APPROVED), url_consulta_autorizacao(link se precisa autorizar),
//      id_cliente, id_simulacao, valores_credito[{min/max_valor, min/max_parcelas,
//      min/max_valor_parcela, max_taxa, base_juros, chave_seguro, status_motor}]}.
//     Se vier url_consulta_autorizacao → cliente autoriza no link → chamar de
//     novo até situacao=APPROVED. Só então simula.
//  5) POST /contrato/simulacao {cliente_id, quantidade_parcelas, valor_solicitado
//     |valor_parcela|taxa|base_juros|chave_seguro} → simulacao detalhada.
//  6) PATCH /cliente {cpf, dados_pessoais, endereco, dados_bancarios}.
//  7) POST /contrato {cpf, id_simulacao} → {url_formalizacao, id_contrato,
//     token_envelope}.  8) POST /contrato/documento (multipart).
//  9) POST /contrato/consultar {cpf|id_contrato|status|...} → contratos[].
//
// Env vars (Vercel): HAPPY_CLIENT_ID, HAPPY_CLIENT_SECRET, HAPPY_USUARIO,
//   HAPPY_SENHA, HAPPY_CPF_DIGITADOR, HAPPY_CORRESPONDENTE_BANQUEIRO,
//   HAPPY_BASE_URL (opcional — default produção).
// ══════════════════════════════════════════════════════════════════

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';

function getConfig() {
  return {
    BASE: (process.env.HAPPY_BASE_URL || 'https://vhagar-backend-prod.byxcapital.com.br').trim().replace(/\/+$/, ''),
    CLIENT_ID: (process.env.HAPPY_CLIENT_ID || '').trim(),
    CLIENT_SECRET: (process.env.HAPPY_CLIENT_SECRET || '').trim(),
    USUARIO: (process.env.HAPPY_USUARIO || '').trim(),
    SENHA: (process.env.HAPPY_SENHA || '').trim(),
    CPF_DIGITADOR: onlyDigits(process.env.HAPPY_CPF_DIGITADOR || ''),
    CORRESPONDENTE: (process.env.HAPPY_CORRESPONDENTE_BANQUEIRO || '').trim(),
  };
}

function onlyDigits(s) { return String(s || '').replace(/\D/g, ''); }
const j = (data, status = 200, req = null) => jsonResp(data, status, req);

// ── Token cache (token_opaco) ──────────────────────────────────
// expira_em vem da API mas formato não é 100% garantido — cacheamos por uma
// janela conservadora (10min) e re-autenticamos no 401 (happyCall).
let _tk = { token: null, exp: 0 };

async function getToken(forcar = false) {
  if (!forcar && _tk.token && Date.now() < _tk.exp) return _tk.token;
  const cfg = getConfig();
  const faltando = [];
  if (!cfg.CLIENT_ID) faltando.push('HAPPY_CLIENT_ID');
  if (!cfg.CLIENT_SECRET) faltando.push('HAPPY_CLIENT_SECRET');
  if (!cfg.USUARIO) faltando.push('HAPPY_USUARIO');
  if (!cfg.SENHA) faltando.push('HAPPY_SENHA');
  if (faltando.length) throw new Error(`Config HAPPY faltando (Vercel env): ${faltando.join(', ')}`);

  const r = await fetch(cfg.BASE + '/api/v1/consignado-privado/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify({ client_id: cfg.CLIENT_ID, secret: cfg.CLIENT_SECRET, usuario: cfg.USUARIO, senha: cfg.SENHA }),
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 400) }; }
  if (!r.ok || !d.token_opaco) {
    throw new Error(`Falha auth HAPPY (HTTP ${r.status}): ${d.detail?.[0]?.msg || d.message || d.raw || 'sem token_opaco'}`);
  }
  // cacheia 10min (ou menos, se expira_em vier como TTL curto em segundos)
  let ttlMs = 10 * 60 * 1000;
  const ex = Number(d.expira_em);
  if (Number.isFinite(ex) && ex > 0 && ex < 86400) ttlMs = Math.min(ttlMs, Math.max(60, ex - 60) * 1000);
  _tk = { token: d.token_opaco, exp: Date.now() + ttlMs };
  return d.token_opaco;
}

// happyCall — Bearer token_opaco + headers obrigatórios (cpf-digitador +
// x-correspondente-banqueiro). Re-autentica UMA vez no 401.
async function happyCall(path, method = 'POST', body = null, _jaRelogou = false) {
  const cfg = getConfig();
  if (!cfg.CPF_DIGITADOR || !cfg.CORRESPONDENTE) {
    return { ok: false, status: 400, data: { error: 'HAPPY_CPF_DIGITADOR / HAPPY_CORRESPONDENTE_BANQUEIRO não configurados (Vercel env)' } };
  }
  const token = await getToken();
  const headers = {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json',
    'accept': 'application/json',
    'cpf-digitador': cfg.CPF_DIGITADOR,
    'x-correspondente-banqueiro': cfg.CORRESPONDENTE,
  };
  const opts = { method, headers };
  if (body !== null && method !== 'GET') opts.body = JSON.stringify(body);
  const r = await fetch(cfg.BASE + path, opts);
  if (r.status === 401 && !_jaRelogou) {
    await getToken(true).catch(() => {});
    return happyCall(path, method, body, true);
  }
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 2000) }; }
  return { ok: r.ok, status: r.status, data: d };
}

// ── Normaliza a consulta DataPrev no formato do motor CLT ──────
// valores_credito[]: min/max_valor (crédito), min/max_valor_parcela (parcela),
// max_taxa, base_juros, chave_seguro, status_motor. Margem = maior parcela;
// crédito disponível = maior valor.
function normalizarConsulta(d, httpStatus) {
  const situacao = String(d?.situacao || '').toUpperCase();
  const autorizada = d?.consulta_autorizada === true || situacao === 'APPROVED';
  const vc = Array.isArray(d?.valores_credito) ? d.valores_credito : [];
  const num = (x) => parseFloat(x ?? 0) || 0;
  const margem = vc.reduce((m, v) => Math.max(m, num(v?.max_valor_parcela)), 0);
  const valorMax = vc.reduce((m, v) => Math.max(m, num(v?.max_valor)), 0);

  const base = {
    idCliente: d?.id_cliente ?? null,
    idSimulacao: d?.id_simulacao ?? null,
    situacaoHappy: d?.situacao || null,
    valoresCredito: vc,
    linkAutorizacao: d?.url_consulta_autorizacao || null,
    margem: { disponivel: margem, valorMax, bruta: valorMax },
    _raw: d,
  };

  // Precisa autorizar a consulta (DataPrev) — link retornado, ainda não aprovada
  if (d?.url_consulta_autorizacao && !autorizada) {
    return {
      ...base, etapa: 'AGUARDA_AUTORIZACAO', approved: false,
      mensagem: '⏳ Aguardando cliente autorizar a consulta DataPrev (link disponível)',
    };
  }
  if (autorizada && margem > 0) {
    return {
      ...base, etapa: 'APROVADO', approved: true,
      mensagem: `Cliente elegível — margem R$ ${margem.toFixed(2)}${valorMax > 0 ? ` · crédito até R$ ${valorMax.toFixed(2)}` : ''}`,
    };
  }
  if (autorizada && margem <= 0) {
    return { ...base, etapa: 'SEM_MARGEM', approved: false, mensagem: d?.message || 'Autorizado, mas sem crédito disponível na HAPPY' };
  }
  // Status intermediário (em processamento)
  if (/process|andamento|pend|analis|aguard/i.test(situacao)) {
    return { ...base, etapa: 'EM_ANALISE', approved: false, mensagem: `⏳ Consulta em processamento na HAPPY (${d?.situacao || 'aguarde'})` };
  }
  return { ...base, etapa: 'SEM_MARGEM', approved: false, mensagem: d?.message || d?.situacao || `Sem retorno da HAPPY (HTTP ${httpStatus})` };
}

// ══════════════════════════════════════════════════════════════
// HANDLER
// ══════════════════════════════════════════════════════════════
export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);
  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  let body;
  try { body = await req.json(); } catch { return jsonError('JSON inválido', 400, req); }
  const action = body.action;

  try {
    // ─── TESTAR AUTENTICAÇÃO ──────────────────────────────────
    if (action === 'testAuth') {
      try {
        const tk = await getToken(true);
        const cfg = getConfig();
        return j({ success: true, mensagem: 'Auth HAPPY OK', tokenPreview: tk.substring(0, 12) + '...', temHeaders: !!(cfg.CPF_DIGITADOR && cfg.CORRESPONDENTE) }, 200, req);
      } catch (e) { return j({ success: false, mensagem: e.message }, 200, req); }
    }

    // ─── CONSULTA DE MARGEM (motor CLT usa esta) ──────────────
    // body: { cpf, nome, telefone, consultar? }
    if (action === 'consultarMargem' || action === 'consultarAprovacao') {
      const cpf = onlyDigits(body.cpf);
      if (cpf.length !== 11) return jsonError('cpf invalido', 400, req);
      const nome = (body.nome || '').trim();
      const telefone = onlyDigits(body.telefone || body.celular);
      if (!nome || telefone.length < 10) {
        return j({ etapa: 'AGUARDA_DADOS', approved: false, mensagem: 'HAPPY exige nome e telefone na consulta — complete os dados do cliente' }, 200, req);
      }
      const r = await happyCall('/api/v1/consignado-privado/cliente/consulta-dataprev', 'POST', {
        nome, telefone, cpf, consultar: body.consultar !== false, // default true (roda a consulta)
      });
      if (!r.ok && !r.data?.situacao) {
        return j({
          etapa: 'ERRO', approved: false, retryable: r.status >= 500 || r.status === 429 || r.status === 408,
          httpStatus: r.status,
          mensagem: r.data?.detail?.[0]?.msg || r.data?.message || r.data?.error || `Erro HAPPY (HTTP ${r.status})`,
          _raw: r.data,
        }, 200, req);
      }
      return j(normalizarConsulta(r.data, r.status), 200, req);
    }

    // ─── SIMULAÇÃO ────────────────────────────────────────────
    // body: { clienteId, parcelas, valorSolicitado?, valorParcela?, taxa?, baseJuros?, chaveSeguro? }
    if (action === 'simular') {
      if (!body.clienteId || !body.parcelas) return jsonError('clienteId e parcelas obrigatorios', 400, req);
      const payload = {
        cliente_id: String(body.clienteId),
        quantidade_parcelas: parseInt(body.parcelas, 10),
      };
      if (body.valorSolicitado != null) payload.valor_solicitado = body.valorSolicitado;
      if (body.valorParcela != null) payload.valor_parcela = body.valorParcela;
      if (body.taxa != null) payload.taxa = body.taxa;
      if (body.baseJuros != null) payload.base_juros = body.baseJuros;
      if (body.chaveSeguro) payload.chave_seguro = body.chaveSeguro;
      const r = await happyCall('/api/v1/consignado-privado/contrato/simulacao', 'POST', payload);
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    // ─── ATUALIZAR CLIENTE (antes de gerar o contrato) ────────
    // body: { cpf, dadosPessoais, endereco, dadosBancarios }
    if (action === 'atualizarCliente') {
      const cpf = onlyDigits(body.cpf);
      if (cpf.length !== 11) return jsonError('cpf invalido', 400, req);
      const payload = { cpf };
      if (body.dadosPessoais) payload.dados_pessoais = body.dadosPessoais;
      if (body.endereco) payload.endereco = body.endereco;
      if (body.dadosBancarios) payload.dados_bancarios = body.dadosBancarios;
      const r = await happyCall('/api/v1/consignado-privado/cliente', 'PATCH', payload);
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    // ─── GERAR LINK DE FORMALIZAÇÃO ───────────────────────────
    // body: { cpf, idSimulacao? } → {url_formalizacao, id_contrato, token_envelope}
    if (action === 'gerarLinkFormalizacao') {
      const cpf = onlyDigits(body.cpf);
      if (cpf.length !== 11) return jsonError('cpf invalido', 400, req);
      const payload = { cpf };
      if (body.idSimulacao != null) payload.id_simulacao = parseInt(body.idSimulacao, 10);
      const r = await happyCall('/api/v1/consignado-privado/contrato', 'POST', payload);
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    // ─── CONSULTAR CONTRATOS ──────────────────────────────────
    // body: { cpf?, idContrato?, status?, tipoProduto? }
    if (action === 'consultarContrato') {
      const payload = {};
      if (body.cpf) payload.cpf = onlyDigits(body.cpf);
      if (body.nome) payload.nome = body.nome;
      if (body.idContrato != null) payload.id_contrato = parseInt(body.idContrato, 10);
      if (body.tipoProduto != null) payload.tipo_produto = body.tipoProduto;
      if (body.status != null) payload.status = body.status;
      const r = await happyCall('/api/v1/consignado-privado/contrato/consultar', 'POST', payload);
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    // ─── RAW (debug) ──────────────────────────────────────────
    if (action === 'rawCall') {
      if (!body.path) return jsonError('path obrigatorio', 400, req);
      const r = await happyCall(body.path, body.method || 'POST', body.body || null);
      return j({ httpStatus: r.status, ok: r.ok, data: r.data }, 200, req);
    }

    return jsonError('action inválida (testAuth, consultarMargem, simular, atualizarCliente, gerarLinkFormalizacao, consultarContrato, rawCall)', 400, req);
  } catch (e) {
    return j({ success: false, error: e.message }, 200, req);
  }
}
