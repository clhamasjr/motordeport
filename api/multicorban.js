export const config = { runtime: 'edge' };

// ═══ MULTICORBAN PROXY ═══
// Login + consulta CPF + parse HTML → JSON estruturado

const MC_BASE = 'https://app.multicorban.com';
const MC_USER = 'lhamascred';
const MC_PASS = '*Lhamas24';

// Session cache (in-memory, resets on cold start)
let sessionCookie = null;
let sessionExpires = 0;

async function mcLogin() {
  // Check cached session
  if (sessionCookie && Date.now() < sessionExpires) return sessionCookie;

  try {
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    
    // Helper: extract cookies from response (Edge Runtime compatible)
    function extractCookies(res) {
      const raw = res.headers.get('set-cookie') || '';
      // set-cookie can have multiple cookies separated by comma, but dates also have commas
      // Split by comma followed by a space and a word with =
      const parts = raw.split(/,(?=\s*\w+=)/);
      return parts.map(c => c.split(';')[0].trim()).filter(c => c && c.includes('='));
    }

    // Step 1: GET login page to capture initial cookies + CSRF
    const page = await fetch(MC_BASE + '/login', {
      method: 'GET',
      headers: { 'User-Agent': UA },
      redirect: 'manual'
    });
    let cookies = extractCookies(page);
    
    // Check if there's a CSRF token in the HTML
    let csrf = '';
    try {
      const html = await page.text();
      const csrfMatch = html.match(/name=["']_csrf["']\s*value=["']([^"']+)["']/i) 
                      || html.match(/name=["']_token["']\s*value=["']([^"']+)["']/i)
                      || html.match(/csrf[_-]?token["']\s*(?:content|value)=["']([^"']+)["']/i);
      if (csrfMatch) csrf = csrfMatch[1];
    } catch {}

    // Step 2: POST login
    let loginBody = `login=${encodeURIComponent(MC_USER)}&password=${encodeURIComponent(MC_PASS)}`;
    if (csrf) loginBody += `&_csrf=${encodeURIComponent(csrf)}&_token=${encodeURIComponent(csrf)}`;

    const loginRes = await fetch(MC_BASE + '/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': UA,
        'Cookie': cookies.join('; '),
        'Referer': MC_BASE + '/login',
        'Origin': MC_BASE
      },
      body: loginBody,
      redirect: 'manual'
    });

    // Capture session cookies from login response
    const loginCookies = extractCookies(loginRes);
    const allCookies = [...cookies, ...loginCookies];
    
    // If redirected, follow redirect and capture more cookies
    const location = loginRes.headers.get('location');
    if (location) {
      const redirectUrl = location.startsWith('http') ? location : MC_BASE + location;
      const redirectRes = await fetch(redirectUrl, {
        method: 'GET',
        headers: { 'User-Agent': UA, 'Cookie': allCookies.join('; ') },
        redirect: 'manual'
      });
      const redirectCookies = extractCookies(redirectRes);
      allCookies.push(...redirectCookies);
    }

    // Deduplicate cookies (keep last value for each name)
    const cookieMap = {};
    for (const c of allCookies) {
      const [name] = c.split('=');
      cookieMap[name.trim()] = c;
    }
    sessionCookie = Object.values(cookieMap).join('; ');

    // Verify session works by fetching a protected page
    const verify = await fetch(MC_BASE + '/search/form/inss', {
      method: 'GET',
      headers: { 'User-Agent': UA, 'Cookie': sessionCookie },
      redirect: 'manual'
    });
    
    // If redirected to login, auth failed
    const verifyLocation = verify.headers.get('location') || '';
    if (verifyLocation.includes('login')) {
      throw new Error('Sessão inválida — redirecionou pro login');
    }

    // Cache for 25 minutes
    sessionExpires = Date.now() + 25 * 60 * 1000;
    return sessionCookie;
  } catch (e) {
    sessionCookie = null;
    sessionExpires = 0;
    throw new Error('Login Multicorban falhou: ' + e.message);
  }
}

async function mcConsult(cpf) {
  const cookie = await mcLogin();
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  const res = await fetch(MC_BASE + '/search/consult', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
      'Cookie': cookie,
      'Referer': MC_BASE + '/search/form/inss',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': MC_BASE
    },
    body: `methodOperation=dataBase&methodConsult=cpf&versaoTela=v2&dataConsult=${cpf.replace(/\D/g, '')}&dataOrgao=&CPF=&CPFRepresentante=&ddd=&telefone=`
  });

  const text = await res.text();
  
  // Check if redirected to login (session expired)
  if (text.includes('<!DOCTYPE') || text.includes('<html') || text.includes('/login')) {
    // Clear session and retry once
    sessionCookie = null; sessionExpires = 0;
    const newCookie = await mcLogin();
    const res2 = await fetch(MC_BASE + '/search/consult', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': UA,
        'Cookie': newCookie,
        'Referer': MC_BASE + '/search/form/inss',
        'X-Requested-With': 'XMLHttpRequest',
        'Origin': MC_BASE
      },
      body: `methodOperation=dataBase&methodConsult=cpf&versaoTela=v2&dataConsult=${cpf.replace(/\D/g, '')}&dataOrgao=&CPF=&CPFRepresentante=&ddd=&telefone=`
    });
    const text2 = await res2.text();
    if (text2.includes('<!DOCTYPE') || text2.includes('<html')) {
      throw new Error('Multicorban retornou HTML após re-login. Possível bloqueio ou mudança no sistema. Preview: ' + text2.substring(0, 200));
    }
    try {
      const data = JSON.parse(text2);
      if (!data.hash) throw new Error('Resposta sem hash');
      return parseMulticorbanHTML(data.hash);
    } catch (e) {
      throw new Error('Parse falhou após retry: ' + e.message + ' | Preview: ' + text2.substring(0, 200));
    }
  }
  
  // Normal path: parse JSON
  try {
    const data = JSON.parse(text);
    if (!data.hash) throw new Error('Resposta sem campo hash. Keys: ' + Object.keys(data).join(','));
    return parseMulticorbanHTML(data.hash);
  } catch (e) {
    throw new Error('Parse falhou: ' + e.message + ' | Preview: ' + text.substring(0, 200));
  }
}

function parseMulticorbanHTML(html) {
  // Helper: extract value from input by name/id pattern
  const getInput = (pattern) => {
    const regex = new RegExp(`(?:name|id)=["']${pattern}["'][^>]*value=["']([^"']*)["']`, 'i');
    const match = html.match(regex);
    if (match) return match[1].trim();
    // Try reverse order (value before name)
    const regex2 = new RegExp(`value=["']([^"']*)["'][^>]*(?:name|id)=["']${pattern}["']`, 'i');
    const match2 = html.match(regex2);
    return match2 ? match2[1].trim() : '';
  };

  // Helper: extract text content between tags
  const getText = (pattern) => {
    const regex = new RegExp(pattern + '[^>]*>([^<]+)<', 'i');
    const match = html.match(regex);
    return match ? match[1].trim() : '';
  };

  // ═══ DADOS PESSOAIS ═══
  const cpf = getInput('cpf_beneficiario') || getInput('cpf_digitacao');
  const nome = getInput('nome_beneficiario') || getInput('nome_digitacao');
  const rg = getInput('rg_beneficiario') || getInput('identidade_digitacao');
  const nomeMae = getInput('nomeMae_beneficiario') || getInput('nome_mae_digitacao');
  const beneficio = getInput('nb_beneficiario') || getInput('nb_digitacao');
  const valorBeneficio = getInput('valor_beneficio');
  const baseCalculo = getInput('base_calculo_consignavel');
  const parcelasTotal = getInput('valor_parcela_emprestimo');
  const margemTotal = getInput('margem_total');
  const margemParcela = getInput('valor_parcela_margem');

  // Data nascimento, idade, sexo, email, telefone, DDB
  // These are unnamed inputs — extract by position after labels
  const extractAfterLabel = (label) => {
    const regex = new RegExp(label + '[\\s\\S]*?value=["\'](.*?)["\']', 'i');
    const m = html.match(regex);
    return m ? m[1].trim() : '';
  };

  const dtNasc = extractAfterLabel('Data de Nascimento');
  const especie = extractAfterLabel('Descrição da Espécie') || extractAfterLabel('Descri');
  const idade = extractAfterLabel('Idade');
  const sexo = extractAfterLabel('Sexo');
  const email = extractAfterLabel('E-mail');
  const telefone = extractAfterLabel('Telefone/WhatsApp') || extractAfterLabel('Telefone');
  const ddb = extractAfterLabel('DDB');
  const desbloqueio = extractAfterLabel('Elegível para Desbloqueio') || extractAfterLabel('Desbloqueio');

  // ═══ DADOS BANCÁRIOS ═══
  let banco_deposito = '', uf_banco = '', agencia = '', conta = '', tipo_conta = '';
  const bankMatch = html.match(/Dados\s*Bancário[\s\S]*?value=["']([^"']*)["'][\s\S]*?value=["']([^"']*)["'][\s\S]*?value=["']([^"']*)["'][\s\S]*?value=["']([^"']*)["'][\s\S]*?value=["']([^"']*)["']/i);
  if (bankMatch) {
    banco_deposito = bankMatch[1]; uf_banco = bankMatch[2];
    agencia = bankMatch[3]; conta = bankMatch[4]; tipo_conta = bankMatch[5];
  }

  // ═══ DADOS ENDEREÇO ═══
  let uf = '', cidade = '', cep = '', endereco = '';
  const addrMatch = html.match(/Dados\s*do\s*Endereço[\s\S]*?value=["']([^"']*)["'][\s\S]*?value=["']([^"']*)["'][\s\S]*?value=["']([^"']*)["'][\s\S]*?value=["']([^"']*)["']/i);
  if (addrMatch) {
    uf = addrMatch[1]; cidade = addrMatch[2]; cep = addrMatch[3]; endereco = addrMatch[4];
  }

  // ═══ CONTRATOS DE EMPRÉSTIMO ═══
  const contratos = [];
  const contratoRegex = /valor_saldoquitacao_contrato(\d+)["'][^>]*value=["']([^"']*)["']/gi;
  let m;
  while ((m = contratoRegex.exec(html)) !== null) {
    const id = m[1];
    const saldo = m[2];
    contratos.push({
      id,
      saldo_devedor: parseFloat(saldo) || 0,
      parcela: parseFloat(getInput('valor_parcela_contrato' + id)) || 0,
      valor_liquido: getInput('resultadoSimulacao' + id),
      coeficiente: getInput('coeficiente' + id),
      valor_emprestimo: parseFloat(getInput('valor_emprestimo')) || 0
    });
  }

  // ═══ EXTRATO INSS (contratos detalhados da tabela) ═══
  // Parse table rows for detailed contract info
  const contratosDetalhados = [];
  const tableRegex = /<td[^>]*>(\d{5,}(?:-\d)?)<\/td>[\s\S]*?<td[^>]*>(\d+\s*-\s*[^<]+)<\/td>[\s\S]*?<td[^>]*>(Ativo|Suspenso)[^<]*<\/td>/gi;
  while ((m = tableRegex.exec(html)) !== null) {
    contratosDetalhados.push({
      contrato: m[1].trim(),
      banco: m[2].trim(),
      situacao: m[3].trim()
    });
  }

  // ═══ SITUAÇÃO ═══
  const bloqueadoMatch = html.match(/Bloqueado para Empréstimo[\s\S]*?<p[^>]*class=["'][^"']*text-(success|danger|warning)[^"']*["'][^>]*>([^<]+)/i);
  const elegivelMatch = html.match(/Elegível para Empréstimo[\s\S]*?<p[^>]*class=["'][^"']*text-(success|danger|warning)[^"']*["'][^>]*>([^<]+)/i);

  // ═══ CALCULAR OPORTUNIDADES ═══
  const margemDisp = parseFloat(margemTotal) - parseFloat(parcelasTotal) || 0;
  const totalSaldos = contratos.reduce((s, c) => s + c.saldo_devedor, 0);
  const totalParcelas = contratos.reduce((s, c) => s + c.parcela, 0);

  return {
    _source: 'multicorban_api',
    _consultedAt: new Date().toISOString(),

    // Pessoais
    cpf, nome_completo: nome, rg_numero: rg, nome_mae: nomeMae,
    beneficio, data_nascimento: dtNasc, especie, idade, sexo, email, telefone, ddb,
    desbloqueio,

    // Financeiros
    valor_beneficio: parseFloat(valorBeneficio) || 0,
    base_calculo: parseFloat(baseCalculo) || 0,
    parcelas_total: parseFloat(parcelasTotal) || 0,
    margem_total: parseFloat(margemTotal) || 0,
    margem_disponivel: margemDisp,
    margem_parcela: parseFloat(margemParcela) || 0,

    // Bancário
    banco_deposito, uf_banco, agencia, conta, tipo_conta,

    // Endereço
    uf, cidade, cep, endereco,

    // Contratos
    contratos,
    contratos_detalhados: contratosDetalhados,
    total_contratos: contratos.length,
    total_saldo_devedor: totalSaldos,
    total_parcelas_contratos: totalParcelas,

    // Status
    bloqueado: bloqueadoMatch ? bloqueadoMatch[2].trim() : '',
    elegivel: elegivelMatch ? elegivelMatch[2].trim() : '',

    // Oportunidades
    oportunidades: {
      portabilidade: contratos.length > 0,
      emprestimo_novo: margemDisp > 30,
      cartao_beneficio: true,
      margem_emprestimo_estimada: margemDisp > 0 ? Math.round(margemDisp / 0.02299) : 0,
      margem_cartao_estimada: margemDisp > 0 ? Math.round(margemDisp / 0.029214) : 0
    }
  };
}

// ═══ HANDLER ═══
export default async function handler(req) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });

  try {
    const body = await req.json();
    const action = body.action || '';

    if (action === 'consulta' || action === 'search') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      if (!cpf || cpf.length < 11) return new Response(JSON.stringify({ success: false, error: 'CPF inválido' }), { status: 400, headers: cors });

      const data = await mcConsult(cpf);
      return new Response(JSON.stringify({ success: true, ...data }), { headers: cors });
    }

    if (action === 'test') {
      // Clear cache to force fresh login
      sessionCookie = null; sessionExpires = 0;
      try {
        const cookie = await mcLogin();
        return new Response(JSON.stringify({
          active: true,
          authenticated: !!cookie,
          cookieCount: cookie ? cookie.split(';').length : 0,
          cookiePreview: cookie ? cookie.substring(0, 100) + '...' : '',
          user: MC_USER,
          message: 'Multicorban conectado!'
        }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ active: false, error: e.message }), { headers: cors });
      }
    }

    if (action === 'debug') {
      // Debug: show raw response from consult without parsing
      const cpf = (body.cpf || '07518194848').replace(/\D/g, '');
      try {
        const cookie = await mcLogin();
        const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
        const res = await fetch(MC_BASE + '/search/consult', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': UA, 'Cookie': cookie,
            'Referer': MC_BASE + '/search/form/inss',
            'X-Requested-With': 'XMLHttpRequest', 'Origin': MC_BASE
          },
          body: `methodOperation=dataBase&methodConsult=cpf&versaoTela=v2&dataConsult=${cpf}&dataOrgao=&CPF=&CPFRepresentante=&ddd=&telefone=`
        });
        const text = await res.text();
        return new Response(JSON.stringify({
          status: res.status,
          contentType: res.headers.get('content-type'),
          isHTML: text.startsWith('<!') || text.startsWith('<html'),
          isJSON: text.startsWith('{') || text.startsWith('['),
          length: text.length,
          preview: text.substring(0, 500),
          cookieUsed: cookie ? cookie.substring(0, 80) + '...' : 'none'
        }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { headers: cors });
      }
    }

    if (action === 'debugLogin') {
      // Debug: show each step of login process
      const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
      const steps = [];
      
      try {
        // Step 1: GET login page
        const page = await fetch(MC_BASE + '/login', { method: 'GET', headers: { 'User-Agent': UA }, redirect: 'manual' });
        const pageHtml = await page.text();
        const pageCookies = page.headers.get('set-cookie') || '';
        
        // Find form fields
        const formAction = pageHtml.match(/form[^>]*action=["']([^"']+)["']/i);
        const inputNames = [...pageHtml.matchAll(/<input[^>]*name=["']([^"']+)["'][^>]*/gi)].map(m => {
          const type = m[0].match(/type=["']([^"']+)["']/i);
          return m[1] + (type ? ' (' + type[1] + ')' : '');
        });
        const csrfInput = pageHtml.match(/name=["']_?csrf[_-]?token?["'][^>]*value=["']([^"']+)["']/i)
                       || pageHtml.match(/name=["']_token["'][^>]*value=["']([^"']+)["']/i);
        
        steps.push({
          step: '1-GET-login',
          status: page.status,
          cookies: pageCookies.substring(0, 200),
          formAction: formAction ? formAction[1] : 'not found',
          inputNames,
          csrfToken: csrfInput ? csrfInput[1].substring(0, 50) : 'not found',
          htmlSize: pageHtml.length
        });

        // Step 2: POST login
        const cookies = pageCookies.split(/,(?=\s*\w+=)/).map(c => c.split(';')[0].trim()).filter(c => c && c.includes('='));
        let loginBody = `login=${encodeURIComponent(MC_USER)}&password=${encodeURIComponent(MC_PASS)}`;
        if (csrfInput) loginBody += `&_csrf=${encodeURIComponent(csrfInput[1])}&_token=${encodeURIComponent(csrfInput[1])}`;
        
        const postUrl = formAction ? (formAction[1].startsWith('http') ? formAction[1] : MC_BASE + formAction[1]) : MC_BASE + '/login';
        
        const loginRes = await fetch(postUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': UA, 'Cookie': cookies.join('; '),
            'Referer': MC_BASE + '/login', 'Origin': MC_BASE
          },
          body: loginBody,
          redirect: 'manual'
        });
        
        const loginCookies = loginRes.headers.get('set-cookie') || '';
        const loginLocation = loginRes.headers.get('location') || '';
        let loginText = '';
        try { loginText = await loginRes.text(); } catch {}
        
        steps.push({
          step: '2-POST-login',
          status: loginRes.status,
          location: loginLocation,
          newCookies: loginCookies.substring(0, 200),
          bodyUsed: loginBody.replace(MC_PASS, '***'),
          postUrl,
          responsePreview: loginText.substring(0, 300)
        });

        return new Response(JSON.stringify({ steps }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message, steps }), { headers: cors });
      }
    }

    return new Response(JSON.stringify({ error: 'action inválida', valid: ['consulta', 'test', 'debug'] }), { status: 400, headers: cors });

  } catch (err) {
    // If auth error, clear session
    if (err.message.includes('Login') || err.message.includes('401')) {
      sessionCookie = null; sessionExpires = 0;
    }
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: cors });
  }
}
