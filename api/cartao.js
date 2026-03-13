export const config = { runtime: 'edge' };

const API_KEY = 'dak_8a4b38fd181b6784a6718bc2bf5fbb62_4d066b97';
const BASE = 'https://api.dataconsulta.com.br';

const BANCOS = {
  BMG: {
    login: '/v1/bmg/saquecartao/login',
    query: '/v1/bmg/saquecartao',
    logout: '/v1/bmg/saquecartao/logout',
    user: 'sp.56863.34921564876',
    pass: 'Fabri15*/4'
  },
  DAYCOVAL: {
    login: '/v1/bmg/saquecartao/login',
    query: '/v1/bmg/saquecartao',
    logout: '/v1/bmg/saquecartao/logout',
    user: 'DCE-LHAMASCRE0046',
    pass: 'MelhorMelhor26@'
  }
};

async function consultarBanco(banco, cpf, matricula) {
  const cfg = BANCOS[banco];
  if (!cfg) return { ok: false, banco, error: 'Banco nao configurado' };
  try {
    // Login
    const lr = await fetch(BASE + cfg.login, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Api-Key': API_KEY },
      body: JSON.stringify({ login: cfg.user, senha: cfg.pass })
    });
    const lt = await lr.text();
    let ld = {}; try { ld = JSON.parse(lt); } catch {}
    let token = ld.token || ld.accessToken || ld.access_token || '';

    if (!lr.ok && !token) {
      // Try usuario/senha format
      const lr2 = await fetch(BASE + cfg.login, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Api-Key': API_KEY },
        body: JSON.stringify({ usuario: cfg.user, senha: cfg.pass })
      });
      const lt2 = await lr2.text();
      try { ld = JSON.parse(lt2); } catch {}
      token = ld.token || ld.accessToken || '';
      if (!lr2.ok && !token) return { ok: false, banco, error: 'Login ' + lr.status + '/' + lr2.status, debug: lt.substring(0, 200) + ' | ' + lt2.substring(0, 200) };
    }

    // Query
    let qh = { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Api-Key': API_KEY };
    if (token) qh['Authorization'] = 'Bearer ' + token;
    const cookie = lr.headers.get('set-cookie');
    if (cookie) qh['Cookie'] = cookie.split(';')[0];

    const qr = await fetch(BASE + cfg.query, {
      method: 'POST', headers: qh,
      body: JSON.stringify({ convenio: '1581', cpf, matricula: matricula || '', valorParcela: 0, dadosCadastrais: true })
    });
    const qt = await qr.text();
    let qd = {}; try { qd = JSON.parse(qt); } catch {}

    // Logout
    fetch(BASE + cfg.logout, { method: 'POST', headers: qh, body: '{}' }).catch(() => {});

    if (!qr.ok) return { ok: false, banco, error: 'Query ' + qr.status, debug: qt.substring(0, 300) };

    return { ok: true, banco, cartoes: qd.cartoes || [], telefones: qd.telefones || [], dados: qd.dadoCadastral || {}, enderecos: qd.enderecos || [] };
  } catch (e) { return { ok: false, banco, error: e.message }; }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    const body = await req.json();
    const cpf = (body.cpf || '').replace(/\D/g, '');
    const matricula = body.matricula || '';
    const bancos = body.bancos || ['BMG', 'DAYCOVAL'];
    if (!cpf) return new Response(JSON.stringify({ error: 'CPF obrigatorio' }), { status: 400, headers: cors });

    const results = await Promise.all(bancos.filter(b => BANCOS[b]).map(b => consultarBanco(b, cpf, matricula)));

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
      success: fontes.length > 0,
      cpf, nome: dados.nome || '', fontes,
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
