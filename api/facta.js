export const config = { runtime: 'edge' };

// ═══════════════════════════════════════════════════════════════
// API FACTA — Proxy Completo v2.0
// ═══════════════════════════════════════════════════════════════

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';

function getConfig() {
  return {
    BASE: (process.env.FACTA_BASE_URL || 'https://webservice-homol.facta.com.br').trim().replace(/\/+$/, ''),
    AUTH: (process.env.FACTA_AUTH || '').trim(),
    LOGIN_CERT: (process.env.FACTA_LOGIN_CERT || '93596').trim(),
    PROXY_URL: (process.env.FACTA_PROXY_URL || '').trim().replace(/\/+$/, ''),
    PROXY_SECRET: (process.env.FACTA_PROXY_SECRET || '').trim(),
    CF_ACCESS_CLIENT_ID: (process.env.CF_ACCESS_CLIENT_ID || '').trim(),
    CF_ACCESS_CLIENT_SECRET: (process.env.CF_ACCESS_CLIENT_SECRET || '').trim()
  };
}

// Helper: chama FACTA direto ou via proxy do escritorio (IP autorizado)
// Quando FACTA_PROXY_URL e FACTA_PROXY_SECRET estao setados, repassa pelo proxy.
async function factaFetch(path, { method = 'GET', headers = {}, body = null, contentType = null } = {}) {
  const cfg = getConfig();
  if (cfg.PROXY_URL && cfg.PROXY_SECRET) {
    // Rota via proxy do escritorio
    const payload = { method, path, headers, body, contentType };
    const fullUrl = cfg.PROXY_URL + '/relay';
    console.log('[factaFetch] via PROXY:', method, path, '->', fullUrl);
    const reqHeaders = {
      'Content-Type': 'application/json',
      'X-Proxy-Key': cfg.PROXY_SECRET,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    };
    // Cloudflare Access Service Token (autentica requisicao Vercel->Proxy no Zero Trust)
    if (cfg.CF_ACCESS_CLIENT_ID && cfg.CF_ACCESS_CLIENT_SECRET) {
      reqHeaders['CF-Access-Client-Id'] = cfg.CF_ACCESS_CLIENT_ID;
      reqHeaders['CF-Access-Client-Secret'] = cfg.CF_ACCESS_CLIENT_SECRET;
    }
    const r = await fetch(fullUrl, {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify(payload)
    });
    console.log('[factaFetch] PROXY resp status:', r.status, 'content-type:', r.headers.get('content-type'));
    return r;
  }
  // Chamada direta (funciona apenas se o IP do Vercel estiver autorizado na FACTA)
  const fwd = { method, headers: { ...headers } };
  if (contentType) fwd.headers['Content-Type'] = contentType;
  if (body !== null && method !== 'GET') fwd.body = typeof body === 'string' ? body : JSON.stringify(body);
  console.log('[factaFetch] DIRETO:', method, cfg.BASE + path);
  return fetch(cfg.BASE + path, fwd);
}

// Token cache
let _tk = { token: null, exp: 0 };

async function getToken() {
  if (_tk.token && Date.now() < _tk.exp) return _tk.token;
  const cfg = getConfig();
  if (!cfg.AUTH) throw new Error('FACTA_AUTH nao configurado');
  const r = await factaFetch('/gera-token', { headers: { 'Authorization': cfg.AUTH } });
  const rawText = await r.text();
  let d;
  try { d = JSON.parse(rawText); }
  catch (e) {
    throw new Error('getToken: resposta nao-JSON (status=' + r.status + '): ' + rawText.substring(0, 400));
  }
  if (d.erro === false && d.token) {
    _tk = { token: d.token, exp: Date.now() + 50 * 60 * 1000 };
    return d.token;
  }
  throw new Error(d.mensagem || 'Erro ao gerar token FACTA');
}

async function fGet(path, params) {
  const token = await getToken();
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const r = await factaFetch(path + qs, { headers: { 'Authorization': 'Bearer ' + token } });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 3000) }; }
  return { ok: r.ok, status: r.status, data: d };
}

async function fPost(path, fields) {
  const token = await getToken();
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null && v !== '') params.append(k, String(v));
  }
  const r = await factaFetch(path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token },
    contentType: 'application/x-www-form-urlencoded',
    body: params.toString()
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 3000) }; }
  return { ok: r.ok, status: r.status, data: d };
}

async function fPostJson(path, body) {
  const token = await getToken();
  const r = await factaFetch(path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token },
    contentType: 'application/json',
    body: JSON.stringify(body)
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 3000) }; }
  return { ok: r.ok, status: r.status, data: d };
}

const j = (data, status = 200, req = null) => jsonResp(data, status, req);

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  // Verificar autenticacao
  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  try {
    const body = req.method === 'POST' ? await req.json() : {};
    const action = body.action || '';
    const cfg = getConfig();

    if (action === 'test') {
      try {
        const token = await getToken();
        return j({ apiActive: true, message: 'API FACTA ativa!', tokenPreview: token.substring(0, 20) + '...' }, 200, req);
      } catch (e) {
        return j({ apiActive: false, message: e.message }, 200, req);
      }
    }

    if (action === 'simular') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      if (!cpf) return jsonError('CPF obrigatorio', 400, req);
      const p = { produto: 'D', tipo_operacao: body.tipo_operacao || 13, averbador: body.averbador || 3, convenio: body.convenio || 3, opcao_valor: body.opcao_valor || 1, cpf, data_nascimento: body.data_nascimento || '' };
      if (body.valor) p.valor = body.valor;
      if (body.valor_parcela) p.valor_parcela = body.valor_parcela;
      if (body.prazo) p.prazo = body.prazo;
      if (body.valor_renda) p.valor_renda = body.valor_renda;
      if (body.prazo_restante) p.prazo_restante = body.prazo_restante;
      if (body.saldo_devedor) p.saldo_devedor = body.saldo_devedor;
      if (body.valor_parcela_original) p.valor_parcela_original = body.valor_parcela_original;
      if (body.prazo_original) p.prazo_original = body.prazo_original;
      if (body.contratos_refin) p.contratos_refin = body.contratos_refin;
      if (body.vendedor) p.vendedor = body.vendedor;
      const r = await fGet('/proposta/operacoes-disponiveis', p);
      const d = r.data;
      const resp = { success: d.erro === false, erro: d.erro, mensagem: d.mensagem || null };
      if (d.tabelas_portabilidade) { resp.tabelas_portabilidade = d.tabelas_portabilidade; resp.tabelas_refin_portabilidade = d.tabelas_refin_portabilidade || []; }
      else { resp.tabelas = d.tabelas || []; }
      return j(resp, 200, req);
    }

    if (action === 'contratosRefin') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      if (!cpf) return jsonError('CPF obrigatorio', 400, req);
      const r = await fGet('/proposta/contratos-refinanciamento', { cpf, tipo_operacao: body.tipo_operacao || 14, averbador: 3, convenio: 3 });
      return j({ success: r.data.erro === false, ...r.data }, 200, req);
    }

    if (action === 'etapa1') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      if (!cpf) return jsonError('CPF obrigatorio', 400, req);
      const fields = { produto: 'D', tipo_operacao: body.tipo_operacao || 13, averbador: body.averbador || 3, convenio: body.convenio || 3, cpf, data_nascimento: body.data_nascimento, login_certificado: body.login_certificado || cfg.LOGIN_CERT, codigo_tabela: body.codigo_tabela, prazo: body.prazo, valor_operacao: body.valor_operacao, valor_parcela: body.valor_parcela, coeficiente: body.coeficiente };
      if (body.vendedor) fields.vendedor = body.vendedor;
      if (body.codigo_master) fields.codigo_master = body.codigo_master;
      if (body.gerente_comercial) fields.gerente_comercial = body.gerente_comercial;
      if (body.cpf_representante) fields.cpf_representante = body.cpf_representante;
      if (body.nome_representante) fields.nome_representante = body.nome_representante;
      if (body.contratos_refin) fields.contratos_refin = body.contratos_refin;
      if (body.saldo_devedor) fields.saldo_devedor = body.saldo_devedor;
      if (body.prazo_original) fields.prazo_original = body.prazo_original;
      if (body.valor_renda) fields.valor_renda = body.valor_renda;
      const r = await fPost('/proposta/etapa1-simulador', fields);
      return j({ success: r.data.erro === false, ...r.data }, 200, req);
    }

    if (action === 'etapa1RefinPort') {
      if (!body.id_simulador) return jsonError('id_simulador obrigatorio', 400, req);
      const fields = { id_simulador: body.id_simulador, banco_compra: body.banco_compra, contrato_compra: body.contrato_compra, prazo_restante: body.prazo_restante, saldo_devedor: body.saldo_devedor, valor_parcela_original: body.valor_parcela_original, prazo: body.prazo, codigo_tabela: body.codigo_tabela, coeficiente: body.coeficiente, valor_operacao: body.valor_operacao, valor_parcela: body.valor_parcela };
      if (body.vendedor) fields.vendedor = body.vendedor;
      const r = await fPost('/proposta/etapa1-refin-portabilidade', fields);
      return j({ success: r.data.erro === false, ...r.data }, 200, req);
    }

    if (action === 'etapa2') {
      if (!body.id_simulador) return jsonError('id_simulador obrigatorio', 400, req);
      const fields = {};
      for (const [k, v] of Object.entries(body)) { if (k !== 'action' && v !== undefined && v !== null) fields[k] = v; }
      if (fields.cpf) fields.cpf = String(fields.cpf).replace(/\D/g, '');
      const r = await fPost('/proposta/etapa2-dados-pessoais', fields);
      return j({ success: r.data.erro === false, ...r.data }, 200, req);
    }

    if (action === 'etapa3') {
      if (!body.codigo_cliente || !body.id_simulador) return jsonError('codigo_cliente e id_simulador obrigatorios', 400, req);
      const fields = { codigo_cliente: body.codigo_cliente, id_simulador: body.id_simulador };
      if (body.tipo_formalizacao) fields.tipo_formalizacao = body.tipo_formalizacao;
      const r = await fPost('/proposta/etapa3-proposta-cadastro', fields);
      return j({ success: r.data.erro === false, ...r.data }, 200, req);
    }

    if (action === 'enviarLink') {
      if (!body.codigo_af) return jsonError('codigo_af obrigatorio', 400, req);
      const r = await fPost('/proposta/envio-link', { codigo_af: body.codigo_af, tipo_envio: body.tipo_envio || 'whatsapp' });
      return j({ success: r.data.erro === false, ...r.data }, 200, req);
    }

    if (action === 'andamentoPropostas') {
      const p = {};
      const keys = ['af', 'data_ini', 'data_fim', 'data_alteracao_ini', 'data_alteracao_fim', 'convenio', 'averbador', 'cpf', 'pagina', 'quantidade', 'consulta_sub', 'codigo_sub'];
      for (const k of keys) { if (body[k] !== undefined && body[k] !== '') p[k] = body[k]; }
      const r = await fGet('/proposta/andamento-propostas', p);
      return j({ success: r.data.erro === false, ...r.data }, 200, req);
    }

    if (action === 'propostasAtualizadas') {
      const p = {};
      if (body.data_alteracao) p.data_alteracao = body.data_alteracao;
      if (body.consulta_sub) p.consulta_sub = body.consulta_sub;
      if (body.codigo_sub) p.codigo_sub = body.codigo_sub;
      const r = await fGet('/proposta/propostas-atualizadas', p);
      return j({ success: r.data.erro === false, ...r.data }, 200, req);
    }

    if (action === 'consultaOcorrencias') {
      if (!body.af) return jsonError('af obrigatorio', 400, req);
      const r = await fGet('/proposta/consulta-ocorrencias', { af: body.af });
      return j({ success: r.data.erro === false, ...r.data }, 200, req);
    }

    if (action === 'consultaCliente') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      if (!cpf) return jsonError('CPF obrigatorio', 400, req);
      const r = await fGet('/proposta/consulta-cliente', { cpf });
      return j({ success: r.data.erro === false, ...r.data }, 200, req);
    }

    if (action === 'cancelarProposta') {
      if (!body.codigo_af) return jsonError('codigo_af obrigatorio', 400, req);
      const r = await fPostJson('/cancelamento-contrato/solicitacao', { codigo_af: body.codigo_af });
      return j({ success: r.data.erro === false, ...r.data }, 200, req);
    }

    if (action === 'tabelasCoeficientes') {
      if (!body.averbador || !body.tipo_operacao) return jsonError('averbador e tipo_operacao obrigatorios', 400, req);
      const p = { averbador: body.averbador, tipo_operacao: body.tipo_operacao };
      if (body.tabela) p.tabela = body.tabela;
      if (body.prazo) p.prazo = body.prazo;
      if (body.data) p.data = body.data;
      const r = await fGet('/comercial/tabelas-coeficientes', p);
      return j({ success: r.data.erro === false, ...r.data }, 200, req);
    }

    if (action === 'combo') {
      const combo = body.combo || '';
      const valid = ['produto', 'banco', 'tipo-operacao', 'orgao-emissor', 'averbador', 'convenio', 'paises', 'estado', 'cidade', 'estado-civil', 'tipo-beneficio', 'valor-patrimonial', 'tipo-documento', 'tipo-chave-pix', 'gerente-comercial'];
      if (!valid.includes(combo)) return j({ error: 'combo invalido', valid }, 400, req);
      const r = await fGet('/proposta-combos/' + combo, body.params || {});
      return j({ success: r.data.erro === false, ...r.data }, 200, req);
    }

    if (action === 'simulacaoRapida') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      if (!cpf || !body.data_nascimento) return jsonError('CPF e data_nascimento obrigatorios', 400, req);
      const tipoOp = body.tipo_operacao || 13;
      const p = { produto: 'D', tipo_operacao: tipoOp, averbador: 3, convenio: 3, cpf, data_nascimento: body.data_nascimento };
      if ([13, 27, 35, 37].includes(Number(tipoOp))) {
        p.opcao_valor = body.opcao_valor || 1;
        if (body.valor) p.valor = body.valor;
        if (body.valor_parcela) p.valor_parcela = body.valor_parcela;
        if (body.prazo) p.prazo = body.prazo;
      } else if ([14, 49].includes(Number(tipoOp))) {
        p.opcao_valor = 2; p.valor_parcela = body.valor_parcela; p.valor_renda = body.valor_renda; p.contratos_refin = body.contratos_refin; if (body.prazo) p.prazo = body.prazo;
      } else if (Number(tipoOp) === 33) {
        p.opcao_valor = 1; p.valor = body.valor; p.valor_renda = body.valor_renda;
      } else if (String(tipoOp) === '003500') {
        p.opcao_valor = 2; p.valor_parcela = body.valor_parcela; p.prazo = body.prazo; p.prazo_restante = body.prazo_restante; p.saldo_devedor = body.saldo_devedor; p.valor_parcela_original = body.valor_parcela_original; if (body.prazo_original) p.prazo_original = body.prazo_original;
      }
      const r = await fGet('/proposta/operacoes-disponiveis', p);
      const d = r.data;
      return j({ success: d.erro === false, tipo_operacao: tipoOp, tabelas: d.tabelas || undefined, tabelas_portabilidade: d.tabelas_portabilidade || undefined, tabelas_refin_portabilidade: d.tabelas_refin_portabilidade || undefined, mensagem: d.mensagem || null }, 200, req);
    }

    return jsonError('action invalida', 400, req);
  } catch (err) {
    console.error('[FACTA] erro interno:', err?.message, err?.stack);
    return j({
      error: 'Erro interno',
      mensagem: err?.message || 'Erro nao especificado',
      stack: (err?.stack || '').substring(0, 500),
      proxyUsed: !!(getConfig().PROXY_URL && getConfig().PROXY_SECRET),
      proxyUrl: getConfig().PROXY_URL || null,
      factaBase: getConfig().BASE
    }, 500, req);
  }
}
