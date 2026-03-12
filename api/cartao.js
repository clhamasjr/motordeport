export const config = { runtime: 'edge' };

const API_KEY = '29956blw5ek9xne3';
const BASE = 'https://api.dataconsulta.com.br';

// All card-related endpoints to try
const ENDPOINTS = [
  { path: '/v1/bmg/saquecartao', name: 'BMG' },
  { path: '/v1/bmgconsig/saquecartao', name: 'BMG Consig' },
];

async function queryEndpoint(endpoint, cpf, matricula) {
  try {
    // Login
    const loginRes = await fetch(`${BASE}${endpoint.path}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY },
      body: JSON.stringify({})
    });

    let headers = { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY };
    const setCookie = loginRes.headers.get('set-cookie');
    if (setCookie) headers['Cookie'] = setCookie.split(';')[0];

    let loginData = null;
    try { loginData = await loginRes.json(); } catch {}
    if (loginData && loginData.token) headers['Authorization'] = `Bearer ${loginData.token}`;

    // Query
    const res = await fetch(`${BASE}${endpoint.path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        convenio: 'INSS',
        cpf: cpf,
        matricula: matricula || '',
        valorParcela: 0,
        dadosCadastrais: true
      })
    });

    // Logout (fire and forget)
    fetch(`${BASE}${endpoint.path}/logout`, {
      method: 'POST', headers, body: JSON.stringify({})
    }).catch(() => {});

    if (!res.ok) return { ok: false, status: res.status, endpoint: endpoint.name };

    const data = await res.json();
    return {
      ok: true,
      endpoint: endpoint.name,
      cartoes: data.cartoes || [],
      telefones: data.telefones || [],
      dados: data.dadoCadastral || {},
      enderecos: data.enderecos || [],
      raw: data
    };
  } catch (e) {
    return { ok: false, error: e.message, endpoint: endpoint.name };
  }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }

  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  try {
    const body = await req.json();
    const cpf = (body.cpf || '').replace(/\D/g, '');
    const matricula = body.matricula || '';
    if (!cpf) return new Response(JSON.stringify({ error: 'CPF obrigatório' }), { status: 400, headers: cors });

    // Query all endpoints in parallel
    const results = await Promise.all(
      ENDPOINTS.map(ep => queryEndpoint(ep, cpf, matricula))
    );

    // Merge results
    let allCartoes = [];
    let telefones = [];
    let dados = {};
    let enderecos = [];
    let fontes = [];
    let errors = [];

    for (const r of results) {
      if (r.ok) {
        fontes.push(r.endpoint);
        // Add cards (avoid duplicates by contract/banco)
        for (const c of r.cartoes) {
          if (!allCartoes.find(x => x.banco === c.banco && x.matricula === c.matricula)) {
            allCartoes.push(c);
          }
        }
        // Merge telefones
        for (const t of r.telefones) {
          if (!telefones.find(x => x.ddd === t.ddd && x.telefone === t.telefone)) {
            telefones.push(t);
          }
        }
        // Best dados
        if (r.dados && r.dados.nome) dados = r.dados;
        if (r.enderecos && r.enderecos.length) enderecos = r.enderecos;
      } else {
        errors.push(`${r.endpoint}: ${r.status || r.error || 'falha'}`);
      }
    }

    if (!allCartoes.length && !fontes.length) {
      return new Response(JSON.stringify({
        error: 'Nenhum resultado',
        detail: errors.join('; ')
      }), { status: 404, headers: cors });
    }

    return new Response(JSON.stringify({
      success: true,
      cpf,
      nome: dados.nome || '',
      fontes,
      cartoes: allCartoes.map(c => ({
        banco: c.banco || '',
        margem: c.margem || 0,
        limiteCartao: c.limiteCartao || 0,
        limiteSaqueTotal: c.limiteSaqueTotal || 0,
        limiteSaqueDisp: c.limiteSaqueDisponivel || 0,
        minimoSaque: c.minimoSaque || 0,
        limiteUtilizado: c.limiteUtilizado || 0,
        saldoDevedor: c.saldoDevedor || 0,
        valorSeguro: c.valorSeguro || 0,
        statusCartao: c.statusCartao || '',
        produto: c.produto || '',
        matricula: c.matricula || '',
        observacao: c.observacao || ''
      })),
      telefones,
      dados,
      enderecos,
      errors: errors.length ? errors : undefined
    }), { status: 200, headers: cors });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: cors });
  }
}