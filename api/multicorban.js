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
    // Step 1: Get login page to capture CSRF/cookies
    const loginPage = await fetch(MC_BASE + '/login', {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      redirect: 'manual'
    });
    let cookies = (loginPage.headers.get('set-cookie') || '').split(',').map(c => c.split(';')[0].trim()).filter(c => c).join('; ');

    // Step 2: POST login
    const loginRes = await fetch(MC_BASE + '/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': cookies,
        'Referer': MC_BASE + '/login'
      },
      body: `login=${encodeURIComponent(MC_USER)}&password=${encodeURIComponent(MC_PASS)}`,
      redirect: 'manual'
    });

    // Capture session cookies
    const setCookies = loginRes.headers.getAll ? loginRes.headers.getAll('set-cookie') : [loginRes.headers.get('set-cookie') || ''];
    const allCookies = setCookies.flatMap(c => c.split(',').map(x => x.split(';')[0].trim())).filter(c => c && c.includes('='));

    if (allCookies.length) {
      sessionCookie = [...new Set([...cookies.split('; '), ...allCookies])].filter(c => c).join('; ');
    } else {
      sessionCookie = cookies;
    }

    // Cache for 30 minutes
    sessionExpires = Date.now() + 30 * 60 * 1000;
    return sessionCookie;
  } catch (e) {
    throw new Error('Login Multicorban falhou: ' + e.message);
  }
}

async function mcConsult(cpf) {
  const cookie = await mcLogin();

  const res = await fetch(MC_BASE + '/search/consult', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Cookie': cookie,
      'Referer': MC_BASE + '/search/form/inss',
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: `methodOperation=dataBase&methodConsult=cpf&versaoTela=v2&dataConsult=${cpf.replace(/\D/g, '')}&dataOrgao=&CPF=&CPFRepresentante=&ddd=&telefone=`
  });

  const data = await res.json();
  if (!data.hash) throw new Error('Resposta vazia do Multicorban');

  return parseMulticorbanHTML(data.hash);
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
      try {
        const cookie = await mcLogin();
        return new Response(JSON.stringify({
          active: true,
          authenticated: !!cookie,
          user: MC_USER,
          message: 'Multicorban conectado!'
        }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ active: false, error: e.message }), { headers: cors });
      }
    }

    return new Response(JSON.stringify({ error: 'action inválida', valid: ['consulta', 'test'] }), { status: 400, headers: cors });

  } catch (err) {
    // If auth error, clear session
    if (err.message.includes('Login') || err.message.includes('401')) {
      sessionCookie = null; sessionExpires = 0;
    }
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: cors });
  }
}
