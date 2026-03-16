export const config = { runtime: 'edge' };

const API_KEY = 'dak_8a4b38fd181b6784a6718bc2bf5fbb62_4d066b97';
const BASE = 'https://api.dataconsulta.com.br';

// Endpoint mapping per bank
const ENDPOINTS = {
  BMG:      { login: '/v1/bmg/saquecartao/login', query: '/v1/bmg/saquecartao', logout: '/v1/bmg/saquecartao/logout' },
  DAYCOVAL: { login: '/v1/bmg/saquecartao/login', query: '/v1/bmg/saquecartao', logout: '/v1/bmg/saquecartao/logout' },
  C6:       { login: '/v1/bmg/saquecartao/login', query: '/v1/bmg/saquecartao', logout: '/v1/bmg/saquecartao/logout' },
  FACTA:    { login: '/v1/bmg/saquecartao/login', query: '/v1/bmg/saquecartao', logout: '/v1/bmg/saquecartao/logout' },
  SAFRA:    { login: '/v1/bmg/saquecartao/login', query: '/v1/bmg/saquecartao', logout: '/v1/bmg/saquecartao/logout' },
  ITAU:     { login: '/v1/bmg/saquecartao/login', query: '/v1/bmg/saquecartao', logout: '/v1/bmg/saquecartao/logout' },
  BRADESCO: { login: '/v1/bmg/saquecartao/login', query: '/v1/bmg/saquecartao', logout: '/v1/bmg/saquecartao/logout' },
  BRB:      { login: '/v1/bmg/saquecartao/login', query: '/v1/bmg/saquecartao', logout: '/v1/bmg/saquecartao/logout' },
  BSEGURO:  { login: '/v1/bmg/saquecartao/login', query: '/v1/bmg/saquecartao', logout: '/v1/bmg/saquecartao/logout' }
};

async function consultarBanco(banco, cred, cpf, matricula) {
  const ep = ENDPOINTS[banco];
  if (!ep || !cred || !cred.user || !cred.pass) return { ok: false, banco, error: 'Sem credenciais' };

  try {
    // Login with bank credentials
    const lr = await fetch(BASE + ep.login, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Api-Key': API_KEY },
      body: JSON.stringify({ login: cred.user, senha: cred.pass })
    });
    const lt = await lr.text();
    let ld = {}; try { ld = JSON.parse(lt); } catch {}
    let token = ld.token || ld.accessToken || ld.access_token || '';

    // Try alternative login format
    if (!lr.ok && !token) {
      const lr2 = await fetch(BASE + ep.login, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Api-Key': API_KEY },
        body: JSON.stringify({ usuario: cred.user, senha: cred.pass })
      });
      const lt2 = await lr2.text();
      try { ld = JSON.parse(lt2); } catch {}
      token = ld.token || ld.accessToken || '';
      if (!lr2.ok && !token) return { ok: false, banco, error: 'Login ' + lr.status + '/' + lr2.status, debug: lt.substring(0, 150) };
    }

    // Query
    let qh = { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Api-Key': API_KEY };
    if (token) qh['Authorization'] = 'Bearer ' + token;
    const cookie = lr.headers.get('set-cookie');
    if (cookie) qh['Cookie'] = cookie.split(';')[0];

    const qr = await fetch(BASE + ep.query, {
      method: 'POST', headers: qh,
      body: JSON.stringify({ convenio: '1581', cpf, matricula: matricula || '', valorParcela: 0, dadosCadastrais: true })
    });
    const qt = await qr.text();
    let qd = {}; try { qd = JSON.parse(qt); } catch {}

    // Logout
    fetch(BASE + ep.logout, { method: 'POST', headers: qh, body: '{}' }).catch(() => {});

    if (!qr.ok) return { ok: false, banco, error: 'Query ' + qr.status, debug: qt.substring(0, 200) };

    return { ok: true, banco, cartoes: qd.cartoes || [], telefones: qd.telefones || [], dados: qd.dadoCadastral || {} };
  } catch (e) { return { ok: false, banco, error: e.message }; }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  try {
    const body = await req.json();
    const cpf = (body.cpf || '').replace(/\D/g, '');
    const matricula = body.matricula || '';
    const bankCreds = body.creds || {}; // {BMG: {user, pass}, DAYCOVAL: {user, pass}}
    if (!cpf) return new Response(JSON.stringify({ error: 'CPF obrigatório' }), { status: 400, headers: cors });

    // Only query banks that have credentials
    const banksToQuery = Object.keys(bankCreds).filter(b => bankCreds[b] && bankCreds[b].user && bankCreds[b].pass && ENDPOINTS[b]);
    if (!banksToQuery.length) return new Response(JSON.stringify({ error: 'Nenhum banco configurado' }), { status: 400, headers: cors });

    const results = await Promise.all(banksToQuery.map(b => consultarBanco(b, bankCreds[b], cpf, matricula)));

    let allCartoes = [], telefones = [], dados = {}, fontes = [], errors = [];
    for (const r of results) {
      if (r.ok) {
        fontes.push(r.banco);
        for (const c of r.cartoes) { c._fonte = r.banco; if (!allCartoes.find(x => x.banco === c.banco && x.matricula === c.matricula)) allCartoes.push(c); }
        for (const t of r.telefones) { if (!telefones.find(x => x.ddd === t.ddd && x.telefone === t.telefone)) telefones.push(t); }
        if (r.dados && r.dados.nome) dados = r.dados;
      } else { errors.push(r.banco + ': ' + r.error + (r.debug ? ' | ' + r.debug : '')); }
    }

    return new Response(JSON.stringify({
      success: fontes.length > 0, cpf, nome: dados.nome || '', fontes,
      cartoes: allCartoes.map(c => ({
        banco: c.banco || '', fonte: c._fonte || '', margem: c.margem || 0,
        limiteCartao: c.limiteCartao || 0, limiteSaqueTotal: c.limiteSaqueTotal || 0,
        limiteSaqueDisp: c.limiteSaqueDisponivel || 0, minimoSaque: c.minimoSaque || 0,
        limiteUtilizado: c.limiteUtilizado || 0, saldoDevedor: c.saldoDevedor || 0,
        statusCartao: c.statusCartao || '', produto: c.produto || '',
        matricula: c.matricula || '', observacao: c.observacao || ''
      })),
      telefones, dados, errors: errors.length ? errors : undefined
    }), { status: 200, headers: cors });
  } catch (err) { return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: cors }); }
}
