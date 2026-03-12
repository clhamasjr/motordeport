export const config = { runtime: 'edge' };

const API_KEY = '29956blw5ek9xne3';
const BASE = 'https://api.dataconsulta.com.br';
const USER = 'fabricio.bomfim';
const PASS = 'fabricio@26';

async function tryAuth(path, cpf, mat, headers, label) {
  try {
    const r = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', ...headers },
      body: JSON.stringify({ convenio: '1581', cpf, matricula: mat || '', valorParcela: 0, dadosCadastrais: true })
    });
    const t = await r.text();
    let d = null; try { d = JSON.parse(t); } catch {}
    return { ok: r.ok, status: r.status, label, data: d, raw: t.substring(0, 500) };
  } catch (e) { return { ok: false, status: 0, label, error: e.message }; }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  try {
    const body = await req.json();
    const cpf = (body.cpf || '').replace(/\D/g, '');
    const mat = body.matricula || '';
    if (!cpf) return new Response(JSON.stringify({ error: 'CPF obrigatório' }), { status: 400, headers: cors });

    const path = '/v1/bmg/saquecartao';
    const basic = btoa(USER + ':' + PASS);

    // Try 5 direct auth methods
    const methods = [
      [{ 'X-Api-Key': API_KEY }, 'ApiKey'],
      [{ 'X-Api-Key': API_KEY, 'Authorization': 'Bearer ' + API_KEY }, 'ApiKey+BearerKey'],
      [{ 'X-Api-Key': API_KEY, 'Authorization': 'Basic ' + basic }, 'ApiKey+Basic'],
      [{ 'Authorization': 'Bearer ' + API_KEY }, 'BearerKey'],
      [{ 'Authorization': 'Basic ' + basic }, 'Basic'],
    ];

    let attempts = [];
    for (const [h, l] of methods) {
      const r = await tryAuth(path, cpf, mat, h, l);
      attempts.push(r);
      if (r.ok && r.data) {
        const d = r.data;
        return new Response(JSON.stringify({
          success: true, authMethod: l, cpf,
          nome: (d.dadoCadastral || {}).nome || '',
          fontes: ['BMG'],
          cartoes: (d.cartoes || []).map(c => ({
            banco: c.banco || '', margem: c.margem || 0, limiteCartao: c.limiteCartao || 0,
            limiteSaqueTotal: c.limiteSaqueTotal || 0, limiteSaqueDisp: c.limiteSaqueDisponivel || 0,
            minimoSaque: c.minimoSaque || 0, limiteUtilizado: c.limiteUtilizado || 0,
            saldoDevedor: c.saldoDevedor || 0, statusCartao: c.statusCartao || '',
            produto: c.produto || '', matricula: c.matricula || '', observacao: c.observacao || ''
          })),
          telefones: d.telefones || [], dados: d.dadoCadastral || {}, enderecos: d.enderecos || []
        }), { status: 200, headers: cors });
      }
    }

    // Try login flow
    let loginDebug = {};
    try {
      // Login with credentials in body
      const lr = await fetch(BASE + path + '/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY },
        body: JSON.stringify({ usuario: USER, senha: PASS })
      });
      const lt = await lr.text();
      loginDebug.body_auth = { status: lr.status, response: lt.substring(0, 400) };

      let ld = {}; try { ld = JSON.parse(lt); } catch {}
      const token = ld.token || ld.accessToken || ld.access_token;
      const cookie = lr.headers.get('set-cookie');

      if (token || lr.ok) {
        let h2 = { 'X-Api-Key': API_KEY };
        if (token) h2['Authorization'] = 'Bearer ' + token;
        if (cookie) h2['Cookie'] = cookie.split(';')[0];

        const r = await tryAuth(path, cpf, mat, h2, 'LoginToken');
        attempts.push(r);
        if (r.ok && r.data) {
          fetch(BASE + path + '/logout', { method: 'POST', headers: h2, body: '{}' }).catch(() => {});
          const d = r.data;
          return new Response(JSON.stringify({
            success: true, authMethod: 'LoginToken', cpf,
            nome: (d.dadoCadastral || {}).nome || '', fontes: ['BMG'],
            cartoes: (d.cartoes || []).map(c => ({
              banco: c.banco || '', margem: c.margem || 0, limiteCartao: c.limiteCartao || 0,
              limiteSaqueTotal: c.limiteSaqueTotal || 0, limiteSaqueDisp: c.limiteSaqueDisponivel || 0,
              minimoSaque: c.minimoSaque || 0, limiteUtilizado: c.limiteUtilizado || 0,
              saldoDevedor: c.saldoDevedor || 0, statusCartao: c.statusCartao || '',
              produto: c.produto || '', matricula: c.matricula || '', observacao: c.observacao || ''
            })),
            telefones: d.telefones || [], dados: d.dadoCadastral || {}
          }), { status: 200, headers: cors });
        }
      }

      // Also try login with empty body + basic auth header
      const lr2 = await fetch(BASE + path + '/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY, 'Authorization': 'Basic ' + basic },
        body: '{}'
      });
      const lt2 = await lr2.text();
      loginDebug.basic_auth = { status: lr2.status, response: lt2.substring(0, 400) };
      let ld2 = {}; try { ld2 = JSON.parse(lt2); } catch {}
      const token2 = ld2.token || ld2.accessToken;

      if (token2 || lr2.ok) {
        let h3 = { 'X-Api-Key': API_KEY };
        if (token2) h3['Authorization'] = 'Bearer ' + token2;
        const cookie2 = lr2.headers.get('set-cookie');
        if (cookie2) h3['Cookie'] = cookie2.split(';')[0];

        const r = await tryAuth(path, cpf, mat, h3, 'LoginBasic');
        attempts.push(r);
        if (r.ok && r.data) {
          const d = r.data;
          return new Response(JSON.stringify({
            success: true, authMethod: 'LoginBasic', cpf,
            nome: (d.dadoCadastral || {}).nome || '', fontes: ['BMG'],
            cartoes: (d.cartoes || []).map(c => ({
              banco: c.banco || '', margem: c.margem || 0, limiteCartao: c.limiteCartao || 0,
              limiteSaqueTotal: c.limiteSaqueTotal || 0, limiteSaqueDisp: c.limiteSaqueDisponivel || 0,
              minimoSaque: c.minimoSaque || 0, limiteUtilizado: c.limiteUtilizado || 0,
              saldoDevedor: c.saldoDevedor || 0, statusCartao: c.statusCartao || '',
              produto: c.produto || '', matricula: c.matricula || '', observacao: c.observacao || ''
            })),
            telefones: d.telefones || [], dados: d.dadoCadastral || {}
          }), { status: 200, headers: cors });
        }
      }
    } catch (e) { loginDebug.error = e.message; }

    // Nothing worked
    return new Response(JSON.stringify({
      success: false,
      error: 'Nenhum método de autenticação funcionou',
      debug: {
        login: loginDebug,
        attempts: attempts.map(a => ({ method: a.label, status: a.status, response: (a.raw || a.error || '').substring(0, 300) }))
      }
    }), { status: 200, headers: cors });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: cors });
  }
}
