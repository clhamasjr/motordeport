export const config = { runtime: 'edge' };

// ══════════════════════════════════════════════════════════════════
// api/datafast.js — Consulta Saque Complementar via Dataconsulta
// Suporta consulta individual e em lote (batch de CPFs)
// Bancos: BMG, DAYCOVAL, C6, FACTA, SAFRA, ITAU, BRADESCO, etc.
// ══════════════════════════════════════════════════════════════════

import { json, jsonError, handleOptions, requireAuth } from './_lib/auth.js';

const BASE = 'https://api.dataconsulta.com.br';

function getApiKey() {
  return process.env.DATACONSULTA_KEY;
}

function getDefaultCreds() {
  // Credenciais BMG default (podem ser sobrescritas pelo request)
  return {
    user: process.env.DATAFAST_BMG_USER || '',
    pass: process.env.DATAFAST_BMG_PASS || ''
  };
}

// Login no banco via Dataconsulta
async function doLogin(cred) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('DATACONSULTA_KEY nao configurado');

  const res = await fetch(`${BASE}/v1/bmg/saquecartao/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Api-Key': apiKey },
    body: JSON.stringify({ login: cred.user, senha: cred.pass })
  });
  const data = await res.json();
  let token = data.token || data.accessToken || data.access_token || '';

  // Tentar formato alternativo
  if (!res.ok && !token) {
    const res2 = await fetch(`${BASE}/v1/bmg/saquecartao/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({ usuario: cred.user, senha: cred.pass })
    });
    const data2 = await res2.json();
    token = data2.token || data2.accessToken || '';
    if (!res2.ok && !token) throw new Error('Login falhou: ' + (res.status));
  }

  return { token, cookie: res.headers.get('set-cookie')?.split(';')[0] || '' };
}

// Consultar saque de um CPF
async function consultarCPF(auth, cpf, matricula) {
  const apiKey = getApiKey();
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Api-Key': apiKey };
  if (auth.token) headers['Authorization'] = 'Bearer ' + auth.token;
  if (auth.cookie) headers['Cookie'] = auth.cookie;

  const res = await fetch(`${BASE}/v1/bmg/saquecartao`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ convenio: '1581', cpf, matricula: matricula || '', valorParcela: 0, dadosCadastrais: true })
  });
  return await res.json();
}

// Logout
async function doLogout(auth) {
  try {
    const headers = { 'Content-Type': 'application/json', 'X-Api-Key': getApiKey() };
    if (auth.token) headers['Authorization'] = 'Bearer ' + auth.token;
    await fetch(`${BASE}/v1/bmg/saquecartao/logout`, { method: 'POST', headers, body: '{}' });
  } catch {}
}

// Extrai limite de saque do retorno
function extrairLimite(data) {
  if (!data) return null;
  const campos = [
    'sc_limite_saque_disponivel', 'limiteSaque', 'limite_saque', 'valorSaque',
    'valor_saque', 'limiteDisponivel', 'limite_disponivel', 'saldoDisponivel',
    'saldo_disponivel', 'valorDisponivel', 'valor_disponivel', 'vlrLimiteSaque',
    'limiteSaqueDisponivel', 'limiteSaqueTotal'
  ];
  for (const c of campos) {
    if (data[c] !== undefined && data[c] !== null && data[c] !== '') {
      const v = parseFloat(String(data[c]).replace(',', '.'));
      if (!isNaN(v) && v > 0) return v;
    }
  }
  // Busca recursiva 1 nivel
  for (const key of Object.keys(data)) {
    if (typeof data[key] === 'object' && data[key] !== null && !Array.isArray(data[key])) {
      for (const c of campos) {
        if (data[key][c] !== undefined && data[key][c] !== null) {
          const v = parseFloat(String(data[key][c]).replace(',', '.'));
          if (!isNaN(v) && v > 0) return v;
        }
      }
    }
  }
  return null;
}

// Extrair dados completos de cartoes
function extrairCartoes(data) {
  if (!data) return [];
  const cartoes = data.cartoes || data.Cartoes || [];
  return cartoes.map(c => ({
    banco: c.banco || c.Banco || '',
    produto: c.produto || c.Produto || '',
    matricula: c.matricula || c.Matricula || '',
    statusCartao: c.statusCartao || c.StatusCartao || '',
    limiteCartao: parseFloat(String(c.limiteCartao || c.LimiteCartao || 0).replace(',', '.')) || 0,
    limiteSaqueTotal: parseFloat(String(c.limiteSaqueTotal || c.sc_limite_saque_total || 0).replace(',', '.')) || 0,
    limiteSaqueDisp: parseFloat(String(c.limiteSaqueDisponivel || c.sc_limite_saque_disponivel || 0).replace(',', '.')) || 0,
    minimoSaque: parseFloat(String(c.minimoSaque || c.sc_valor_minimo_saque || 0).replace(',', '.')) || 0,
    limiteUtilizado: parseFloat(String(c.limiteUtilizado || 0).replace(',', '.')) || 0,
    saldoDevedor: parseFloat(String(c.saldoDevedor || 0).replace(',', '.')) || 0,
    margem: parseFloat(String(c.margem || 0).replace(',', '.')) || 0,
    observacao: c.observacao || ''
  }));
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);
  if (req.method !== 'POST') return jsonError('POST only', 405, req);

  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  let body;
  try { body = await req.json(); } catch { return jsonError('Invalid JSON', 400, req); }

  const action = body.action || 'batch';

  try {
    // Credenciais: usa as do body ou as default do env
    const cred = body.cred || getDefaultCreds();
    if (!cred.user || !cred.pass) return jsonError('Credenciais do banco obrigatorias (cred.user + cred.pass) ou DATAFAST_BMG_USER/PASS env vars', 400, req);

    // ── CONSULTA INDIVIDUAL ──────────────────────────────
    if (action === 'single') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      if (!cpf) return jsonError('CPF obrigatorio', 400, req);

      const auth = await doLogin(cred);
      const data = await consultarCPF(auth, cpf, body.matricula);
      doLogout(auth);

      const cartoes = extrairCartoes(data);
      const limite = extrairLimite(data);
      const melhorCartao = cartoes.sort((a, b) => b.limiteSaqueDisp - a.limiteSaqueDisp)[0] || null;

      return json({
        ok: true, cpf,
        nome: data?.dadoCadastral?.nome || data?.nome || '',
        limite,
        cartoes,
        melhorSaque: melhorCartao?.limiteSaqueDisp || 0,
        telefones: data?.telefones || [],
        dados: data?.dadoCadastral || {}
      }, 200, req);
    }

    // ── CONSULTA EM LOTE ─────────────────────────────────
    if (action === 'batch' || !action || action === 'consultar') {
      const cpfs = (body.cpfs || []).map(c => String(c).replace(/\D/g, '').padStart(11, '0'));
      if (!cpfs.length) return jsonError('cpfs obrigatorio (array)', 400, req);
      if (cpfs.length > 50) return jsonError('Maximo 50 CPFs por lote', 400, req);

      const auth = await doLogin(cred);
      const resultados = [];

      for (const cpf of cpfs) {
        try {
          const data = await consultarCPF(auth, cpf, '');
          const cartoes = extrairCartoes(data);
          const limite = extrairLimite(data);
          const melhorCartao = cartoes.sort((a, b) => b.limiteSaqueDisp - a.limiteSaqueDisp)[0] || null;

          resultados.push({
            cpf, ok: true,
            limite,
            melhorSaque: melhorCartao?.limiteSaqueDisp || 0,
            cartoes: cartoes.length,
            cartoesDetalhes: cartoes,
            nome: data?.dadoCadastral?.nome || ''
          });
        } catch (e) {
          resultados.push({ cpf, ok: false, limite: null, error: 'Erro na consulta' });
        }
      }

      doLogout(auth);

      const comLimite = resultados.filter(r => r.limite && r.limite > 0);
      return json({
        ok: true,
        total: cpfs.length,
        comLimite: comLimite.length,
        semLimite: cpfs.length - comLimite.length - resultados.filter(r => !r.ok).length,
        erros: resultados.filter(r => !r.ok).length,
        totalLimite: comLimite.reduce((s, r) => s + (r.limite || 0), 0),
        resultados
      }, 200, req);
    }

    // ── TEST ──────────────────────────────────────────────
    if (action === 'test') {
      try {
        const auth = await doLogin(cred);
        doLogout(auth);
        return json({ ok: true, message: 'Dataconsulta conectada!' }, 200, req);
      } catch (e) {
        return json({ ok: false, message: 'Erro: ' + e.message }, 200, req);
      }
    }

    return jsonError('action invalida. Use: single, batch, test', 400, req);
  } catch (e) {
    return json({ error: 'Erro interno' }, 500, req);
  }
}
