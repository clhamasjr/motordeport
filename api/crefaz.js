export const config = { runtime: 'edge' };

// ═══════════════════════════════════════════════════════════════
// API CREFAZ ON — Credito Pessoal Energia / Debito em Conta / Boleto
// Padrao segue api/daycoval.js. Auth: OAuth2 (login/senha/apiKey -> Bearer 3h)
// Doc: https://documenter.getpostman.com/view/22853636/2s847ESZqa
//
// Env vars necessarias:
//  CREFAZ_ENV          = stag | prod
//  CREFAZ_BASE_STAG    = https://app2-crefaz-api-external-stag.azurewebsites.net/api
//  CREFAZ_BASE_PROD    = https://api-externo.crefazon.com.br/api
//  CREFAZ_API_KEY_STAG = uuid stag
//  CREFAZ_API_KEY_PROD = uuid prod
//  CREFAZ_LOGIN        = CCxxxxxxxx (codigo parceiro)
//  CREFAZ_SENHA        = senha
//
// Webhook Crefaz: ver api/crefaz-webhook.js
// ═══════════════════════════════════════════════════════════════

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';

// ── Config / env ──────────────────────────────────────────────
function getConfig() {
  const env = (process.env.CREFAZ_ENV || 'stag').toLowerCase();
  const isProd = env === 'prod';
  return {
    env,
    isProd,
    BASE: (isProd
      ? (process.env.CREFAZ_BASE_PROD || 'https://api-externo.crefazon.com.br/api')
      : (process.env.CREFAZ_BASE_STAG || 'https://app2-crefaz-api-external-stag.azurewebsites.net/api')
    ).trim().replace(/\/+$/, ''),
    API_KEY: (isProd
      ? (process.env.CREFAZ_API_KEY_PROD || '')
      : (process.env.CREFAZ_API_KEY_STAG || '')
    ).trim(),
    LOGIN: (process.env.CREFAZ_LOGIN || '').trim(),
    SENHA: (process.env.CREFAZ_SENHA || '').trim(),
  };
}

// ── Token cache (in-memory, dura enquanto a edge function viver) ─────
// Crefaz token expira em 3h. Cacheamos pra evitar login a cada chamada.
let _tokenCache = { token: null, expires: 0, env: null };

async function loginCrefaz() {
  const cfg = getConfig();
  if (!cfg.LOGIN) throw new Error('CREFAZ_LOGIN nao configurado');
  if (!cfg.SENHA) throw new Error('CREFAZ_SENHA nao configurada');
  if (!cfg.API_KEY) throw new Error(`CREFAZ_API_KEY_${cfg.env.toUpperCase()} nao configurada`);

  const url = cfg.BASE + '/Usuario/login';
  console.log('[crefaz] login', cfg.env, cfg.LOGIN);

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    body: JSON.stringify({ login: cfg.LOGIN, senha: cfg.SENHA, apiKey: cfg.API_KEY }),
  });

  const txt = await r.text();
  let data;
  try { data = JSON.parse(txt); } catch { data = { raw: txt.substring(0, 1500) }; }

  if (!r.ok || !data?.success || !data?.data?.token) {
    const errs = data?.errors?.join('; ') || data?.raw || `HTTP ${r.status}`;
    throw new Error(`Crefaz login falhou: ${errs}`);
  }

  return {
    token: data.data.token,
    // Crefaz devolve "expires" ISO; convertemos pra ms epoch, com margem de 5min
    expires: new Date(data.data.expires).getTime() - 5 * 60 * 1000,
    userId: data.data.userId,
    nome: data.data.nome,
    login: data.data.login,
  };
}

async function getToken() {
  const cfg = getConfig();
  // Invalida cache se mudou ambiente
  if (_tokenCache.env !== cfg.env) _tokenCache = { token: null, expires: 0, env: null };

  if (_tokenCache.token && Date.now() < _tokenCache.expires) return _tokenCache.token;

  const fresh = await loginCrefaz();
  _tokenCache = { token: fresh.token, expires: fresh.expires, env: cfg.env };
  return fresh.token;
}

// ── Wrapper de fetch autenticado ──────────────────────────────
async function crefazFetch(method, path, body = null, { auth = true, retryOn401 = true } = {}) {
  const cfg = getConfig();
  const url = cfg.BASE + path;

  const headers = {
    'accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };
  if (auth) headers['Authorization'] = `Bearer ${await getToken()}`;

  const init = { method, headers };
  if (body !== null && method !== 'GET') init.body = typeof body === 'string' ? body : JSON.stringify(body);

  console.log('[crefaz]', method, path);
  let r = await fetch(url, init);

  // Token expirou? Renova e tenta uma vez.
  if (r.status === 401 && auth && retryOn401) {
    console.log('[crefaz] 401 -> renovando token');
    _tokenCache = { token: null, expires: 0, env: null };
    headers['Authorization'] = `Bearer ${await getToken()}`;
    r = await fetch(url, init);
  }

  const txt = await r.text();
  let data;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = { raw: txt.substring(0, 3000) }; }
  return { ok: r.ok, status: r.status, data };
}

// ── Cache simples pra contextos (tabelas auxiliares quase estaticas) ──
let _ctxCache = { data: null, expires: 0, env: null };
const CTX_TTL_MS = 60 * 60 * 1000; // 1h

const j = (data, status = 200, req = null) => jsonResp(data, status, req);

// ═══════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ═══════════════════════════════════════════════════════════════
export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  try {
    const body = req.method === 'POST' ? await req.json() : {};
    const action = (body.action || '').trim();
    const cfg = getConfig();

    // ═══════ DIAGNOSTICO ═══════
    if (action === 'test' || action === 'diag') {
      return j({
        ok: true,
        env: cfg.env,
        base: cfg.BASE,
        hasApiKey: !!cfg.API_KEY,
        hasLogin: !!cfg.LOGIN,
        hasSenha: !!cfg.SENHA,
        tokenCached: !!(_tokenCache.token && Date.now() < _tokenCache.expires),
      }, 200, req);
    }

    // ═══════ LOGIN FORÇADO (debug) ═══════
    if (action === 'login') {
      _tokenCache = { token: null, expires: 0, env: null };
      const t = await loginCrefaz();
      _tokenCache = { token: t.token, expires: t.expires, env: cfg.env };
      return j({ ok: true, env: cfg.env, userId: t.userId, nome: t.nome, login: t.login, expiresAt: new Date(t.expires).toISOString() }, 200, req);
    }

    // ═══════ CONTEXTOS (tabelas auxiliares) ═══════
    // Agrega: ocupacao + grau-instrucao + proposta + paises numa unica chamada
    if (action === 'contextos') {
      if (_ctxCache.data && _ctxCache.env === cfg.env && Date.now() < _ctxCache.expires) {
        return j({ ok: true, cached: true, data: _ctxCache.data }, 200, req);
      }
      const [ocup, grau, prop, pais] = await Promise.all([
        crefazFetch('GET', '/Contexto/ocupacao'),
        crefazFetch('GET', '/Contexto/grau-instrucao'),
        crefazFetch('GET', '/Contexto/proposta'),
        crefazFetch('GET', '/Endereco/Pais'),
      ]);
      const merged = {
        ocupacao: ocup.data?.data || [],
        grauInstrucao: grau.data?.data || [],
        proposta: prop.data?.data || {},
        paises: pais.data?.data || [],
      };
      _ctxCache = { data: merged, expires: Date.now() + CTX_TTL_MS, env: cfg.env };
      return j({ ok: true, cached: false, data: merged }, 200, req);
    }

    // ═══════ CIDADES por UF+nome (busca) ═══════
    if (action === 'buscarCidade') {
      const { uf, nomeCidade } = body;
      if (!uf || !nomeCidade) return jsonError('uf e nomeCidade obrigatorios', 400, req);
      const r = await crefazFetch('POST', '/Endereco/Cidade', { uf, nomeCidade });
      return j({ ok: r.ok, status: r.status, data: r.data }, 200, req);
    }

    // ═══════ PRODUTOS por REGIAO (via codigo IBGE) ═══════
    if (action === 'produtosRegiao') {
      const ibge = (body.ibge || body.codigoIBGE || '').toString();
      if (!ibge) return jsonError('ibge (codigo IBGE da cidade) obrigatorio', 400, req);
      const r = await crefazFetch('GET', `/Proposta/produtos-regiao/${encodeURIComponent(ibge)}`);
      return j({ ok: r.ok, status: r.status, data: r.data }, 200, req);
    }

    // ═══════ ANTI-DUPLICIDADE: ja existe proposta em andamento pro CPF? ═══════
    if (action === 'verificarProposta') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      const loginVendedor = body.loginVendedor || cfg.LOGIN;
      if (!cpf) return jsonError('cpf obrigatorio', 400, req);
      const qs = `cpf=${encodeURIComponent(cpf)}&loginVendedor=${encodeURIComponent(loginVendedor)}`;
      const r = await crefazFetch('POST', `/Proposta/proposta-em-andamento?${qs}`);
      return j({ ok: r.ok, status: r.status, data: r.data }, 200, req);
    }

    // ═══════ CRIAR PROPOSTA (dados minimos) ═══════
    if (action === 'criarProposta') {
      const { nome, cpf, nascimento, telefone, ocupacaoId, cep, cidadeId, bairro, logradouro, urlNotificacaoParceiro } = body;
      const required = { nome, cpf, nascimento, telefone, ocupacaoId, cep, cidadeId, bairro, logradouro };
      const faltam = Object.keys(required).filter(k => required[k] === undefined || required[k] === null || required[k] === '');
      if (faltam.length) return jsonError(`Campos obrigatorios faltando: ${faltam.join(', ')}`, 400, req);

      const payload = {
        nome,
        cpf: cpf.toString().replace(/\D/g, ''),
        nascimento,
        telefone: telefone.toString().replace(/\D/g, ''),
        ocupacaoId: Number(ocupacaoId),
        cep: cep.toString().replace(/\D/g, ''),
        cidadeId: Number(cidadeId),
        bairro,
        logradouro,
        urlNotificacaoParceiro: urlNotificacaoParceiro || '',
      };
      const r = await crefazFetch('POST', '/Proposta', payload);
      return j({ ok: r.ok, status: r.status, data: r.data }, 200, req);
    }

    // ═══════ OFERTA: produtos+convenios+tabelas disponiveis pra essa proposta ═══════
    if (action === 'consultarOferta') {
      const id = body.propostaId;
      if (!id) return jsonError('propostaId obrigatorio', 400, req);
      const r = await crefazFetch('GET', `/Proposta/oferta-produto/${encodeURIComponent(id)}`);
      return j({ ok: r.ok, status: r.status, data: r.data }, 200, req);
    }

    // ═══════ CALCULAR VENCIMENTO ═══════
    if (action === 'calcularVencimento') {
      const { propostaId, produtoId, convenioId, rota, leitura, vencimento, tabelaJurosId } = body;
      if (!propostaId || !produtoId || !convenioId || !tabelaJurosId) {
        return jsonError('propostaId, produtoId, convenioId, tabelaJurosId obrigatorios', 400, req);
      }
      const r = await crefazFetch('POST', '/Proposta/calculo-vencimento', {
        propostaId: Number(propostaId),
        produtoId: Number(produtoId),
        convenioId: Number(convenioId),
        rota: rota ?? null,
        leitura: leitura ?? null,
        vencimento: vencimento ?? null,
        tabelaJurosId: Number(tabelaJurosId),
      });
      return j({ ok: r.ok, status: r.status, data: r.data }, 200, req);
    }

    // ═══════ CONSULTAR VALOR LIMITE (max solicitavel + parcela max) ═══════
    if (action === 'consultarLimite') {
      const { propostaId, produtoId, convenioId, tabelaJurosId, vencimento, renda, recalculo } = body;
      if (!propostaId) return jsonError('propostaId obrigatorio', 400, req);
      const r = await crefazFetch('POST', `/Proposta/consulta-valor-limite/${encodeURIComponent(propostaId)}`, {
        produtoId: Number(produtoId),
        convenioId: Number(convenioId),
        tabelaJurosId: Number(tabelaJurosId),
        vencimento,
        renda: Number(renda),
        recalculo: recalculo ?? null,
      });
      return j({ ok: r.ok, status: r.status, data: r.data }, 200, req);
    }

    // ═══════ SIMULACAO (matriz prazo x parcela) ═══════
    if (action === 'simular') {
      const { propostaId, produtoId, convenioId, tabelaJurosId, valor, tipoCalculo, vencimento, renda, recalculo } = body;
      if (!propostaId) return jsonError('propostaId obrigatorio', 400, req);
      const r = await crefazFetch('POST', `/Proposta/simulacao-valor/${encodeURIComponent(propostaId)}`, {
        produtoId: Number(produtoId),
        convenioId: Number(convenioId),
        tabelaJurosId: Number(tabelaJurosId),
        valor: Number(valor),
        tipoCalculo: tipoCalculo ?? 0, // 0=Valor Solicitado, 1=Valor da Parcela
        vencimento,
        renda: Number(renda),
        recalculo: recalculo ?? null,
      });
      return j({ ok: r.ok, status: r.status, data: r.data }, 200, req);
    }

    // ═══════ ESCOLHER OFERTA (depois da simulacao) ═══════
    if (action === 'escolherOferta') {
      const { propostaId, ofertaId, convenioId, tabelaJurosId, produtoId, plano, prestacao, renda, diaRecebimento, tipoRenda, vencimento, valor, tipoCalculo, adicionais, contratosRefin } = body;
      if (!propostaId) return jsonError('propostaId obrigatorio', 400, req);
      const r = await crefazFetch('PUT', `/Proposta/oferta-produto/${encodeURIComponent(propostaId)}`, {
        id: ofertaId,
        convenioId: Number(convenioId),
        tabelaJurosId: Number(tabelaJurosId),
        produtoId: Number(produtoId),
        plano: Number(plano),
        prestacao: Number(prestacao),
        renda: Number(renda),
        diaRecebimento: Number(diaRecebimento || 5),
        tipoRenda: tipoRenda ?? 0,
        vencimento,
        valor: Number(valor),
        tipoCalculo: tipoCalculo ?? 0,
        adicionais: adicionais || [],
        contratosRefin: contratosRefin || [],
      });
      return j({ ok: r.ok, status: r.status, data: r.data }, 200, req);
    }

    // ═══════ LISTAR DOCUMENTOS OBRIGATORIOS ═══════
    if (action === 'listarAnexos') {
      const { propostaId, tipoModalidade, tipoRenda } = body;
      if (!propostaId) return jsonError('propostaId obrigatorio', 400, req);
      const r = await crefazFetch('POST', '/Proposta/tipo-anexos', {
        propostaId: Number(propostaId),
        tipoModalidade: tipoModalidade ?? 2, // 0=Ambos 1=Fisico 2=Digital
        tipoRenda: tipoRenda ?? 0,           // 0=Presumida 1=Manual
      });
      return j({ ok: r.ok, status: r.status, data: r.data }, 200, req);
    }

    // ═══════ UPLOAD DOCUMENTO (base64) ═══════
    if (action === 'uploadDoc') {
      const { propostaId, documentoId, conteudo } = body;
      if (!propostaId || !documentoId || !conteudo) {
        return jsonError('propostaId, documentoId, conteudo (data URL base64) obrigatorios', 400, req);
      }
      // Normaliza pro formato esperado: data:image/jpeg;base64,XXXX
      const conteudoFinal = conteudo.startsWith('data:') ? conteudo : `data:image/jpeg;base64,${conteudo}`;
      const r = await crefazFetch('PUT', `/Proposta/${encodeURIComponent(propostaId)}/imagem`, {
        documentoId: Number(documentoId),
        conteudo: conteudoFinal,
      });
      return j({ ok: r.ok, status: r.status, data: r.data }, 200, req);
    }

    // ═══════ COMPLETAR CADASTRO (PUT /Proposta/{id}) ═══════
    if (action === 'completarCadastro') {
      const { propostaId, cliente, contatos, endereco, bancario, profissional, unidade, operacao } = body;
      if (!propostaId) return jsonError('propostaId obrigatorio', 400, req);
      const payload = {
        id: Number(propostaId),
        cliente: cliente || {},
        contatos: contatos || { contato: {}, referencia: [] },
        endereco: endereco || {},
        bancario: bancario || {},
        profissional: profissional || {},
        unidade: unidade || {
          nomeVendedor: user.nome_vendedor || cfg.LOGIN,
          cpfVendedor: '',
          celularVendedor: '',
        },
        operacao: operacao || {},
      };
      const r = await crefazFetch('PUT', `/Proposta/${encodeURIComponent(propostaId)}`, payload);
      return j({ ok: r.ok, status: r.status, data: r.data }, 200, req);
    }

    // ═══════ CONSULTAR PROPOSTA COMPLETA ═══════
    if (action === 'consultarProposta') {
      const id = body.propostaId;
      if (!id) return jsonError('propostaId obrigatorio', 400, req);
      const r = await crefazFetch('GET', `/Proposta/${encodeURIComponent(id)}`);
      return j({ ok: r.ok, status: r.status, data: r.data }, 200, req);
    }

    return jsonError(`action desconhecida: "${action}". Use test, login, contextos, buscarCidade, produtosRegiao, verificarProposta, criarProposta, consultarOferta, calcularVencimento, consultarLimite, simular, escolherOferta, listarAnexos, uploadDoc, completarCadastro, consultarProposta`, 400, req);
  } catch (err) {
    console.error('[crefaz] erro', err);
    return jsonError(err?.message || 'Erro interno Crefaz', 500, req);
  }
}
