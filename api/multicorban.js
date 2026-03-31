// ══════════════════════════════════════════════════════════════════════
// api/multicorban.js — Proxy Multicorban (app.multicorban.com)
// FlowForce — LhamasCred
// Login via AJAX + Cookie session + Consulta CPF + HTML→JSON parse
// ══════════════════════════════════════════════════════════════════════

const BASE = 'https://app.multicorban.com';

// ── Session cache (in-memory, per cold-start) ──────────────────────
let sessionCache = { cookie: null, ts: 0 };
const SESSION_TTL = 25 * 60 * 1000; // 25 min

// ── CORS headers ───────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ── Login — get PHPSESSID cookie ───────────────────────────────────
async function doLogin(user, pass) {
  const body = new URLSearchParams({ login: user, senha: pass });
  const res = await fetch(`${BASE}/access/validateLogin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': `${BASE}/`,
      'Origin': BASE,
    },
    body: body.toString(),
    redirect: 'manual',
  });

  // Extract Set-Cookie(s) — edge runtime returns them in headers
  const cookies = [];
  // getSetCookie available in newer runtimes; fallback to getAll
  if (typeof res.headers.getSetCookie === 'function') {
    cookies.push(...res.headers.getSetCookie());
  } else {
    // Vercel edge: headers.get('set-cookie') may concat with ', '
    const raw = res.headers.get('set-cookie');
    if (raw) cookies.push(...raw.split(/,(?=\s*\w+=)/));
  }

  let loginData;
  try {
    loginData = await res.json();
  } catch {
    loginData = { code: -1, mensagem: 'Failed to parse login response' };
  }

  if (loginData.code !== 0) {
    return { ok: false, error: loginData.mensagem || 'Login failed', data: loginData };
  }

  // Build cookie string for subsequent requests
  const cookieParts = cookies.map(c => c.split(';')[0].trim()).filter(Boolean);
  const cookieStr = cookieParts.join('; ');

  if (!cookieStr) {
    return { ok: false, error: 'No session cookie returned', data: loginData };
  }

  return { ok: true, cookie: cookieStr, data: loginData };
}

// ── Ensure active session ──────────────────────────────────────────
async function ensureSession(user, pass) {
  const now = Date.now();
  if (sessionCache.cookie && (now - sessionCache.ts) < SESSION_TTL) {
    return { ok: true, cookie: sessionCache.cookie };
  }
  const result = await doLogin(user, pass);
  if (result.ok) {
    sessionCache = { cookie: result.cookie, ts: now };
  }
  return result;
}

// ── Consulta CPF ───────────────────────────────────────────────────
async function consultCPF(cookie, cpf) {
  // Multicorban expects CPF with 11 digits (leading zeros)
  const cpfClean = cpf.replace(/\D/g, '').padStart(11, '0');

  const body = new URLSearchParams({
    methodOperation: 'dataBase',
    methodConsult: 'cpf',
    versaoTela: 'v2',
    dataConsult: cpfClean,
    dataOrgao: '',
    CPF: '',
    CPFRepresentante: '',
    ddd: '',
    telefone: '',
  });

  const res = await fetch(`${BASE}/search/consult`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': cookie,
      'Referer': `${BASE}/search`,
      'Origin': BASE,
    },
    body: body.toString(),
  });

  const text = await res.text();

  // Try JSON parse first
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Non-JSON response', raw: text.substring(0, 500) };
  }

  // code !== 0 means error (session expired, CPF not found, etc.)
  if (data.code !== undefined && data.code !== 0) {
    return { ok: false, error: data.mensagem || 'Consulta error', data };
  }

  // Parse the HTML hash to extract structured data
  const html = data.hash || '';
  const parsed = parseConsultHTML(html);

  return { ok: true, cpf: cpfClean, parsed, raw_code: data.code };
}

// ── HTML Parser — extract structured data from consult response ────
function parseConsultHTML(html) {
  const result = {
    beneficiario: {},
    beneficio: {},
    margem: {},
    contratos: [],
    cartoes: [],
    telefones: [],
    endereco: {},
    banco: {},
  };

  if (!html) return result;

  // Helper: extract value from hidden input or text near a label
  const extractInput = (id) => {
    const re = new RegExp(`id="\\s*${id}"[^>]*value="\\s*([^"]*)"`, 'i');
    const m = html.match(re);
    return m ? m[1].trim() : null;
  };

  const extractText = (pattern) => {
    const re = new RegExp(pattern, 'i');
    const m = html.match(re);
    return m ? m[1].trim() : null;
  };

  // ── Beneficiário
  result.beneficiario.cpf = extractInput('cpf_beneficiario');
  result.beneficiario.nome = extractInput('nome_beneficiario');
  result.beneficiario.rg = extractInput('rg_beneficiario');
  result.beneficiario.nome_mae = extractInput('nomeMae_beneficiario');
  result.beneficiario.nb = extractInput('nb_beneficiario');

  // Data nascimento — search in the value fields
  const nascRe = /Data de Nascimento<\/small>\s*<input[^>]*value="\s*([^"]+)"/i;
  const nascM = html.match(nascRe);
  if (nascM) result.beneficiario.data_nascimento = nascM[1].trim();

  // Idade
  const idadeRe = /Idade<\/small>\s*(?:<[^>]*>)*\s*<input[^>]*value="\s*([^"]+)"/i;
  const idadeM = html.match(idadeRe);
  if (idadeM) result.beneficiario.idade = idadeM[1].trim();

  // ── Benefício
  result.beneficio.valor = extractInput('valor_beneficio');
  result.beneficio.base_calculo = extractInput('base_calculo_consignavel');

  // Situação
  const sitRe = /Situa[çc]\u00e3o:\s*<\/small>\s*<small[^>]*>\s*(\w+)/i;
  const sitM = html.match(sitRe);
  if (sitM) result.beneficio.situacao = sitM[1].trim();

  // Espécie
  const especieRe = /Descri[çc]\u00e3o da Esp\u00e9cie<\/small>\s*<input[^>]*value="\s*([^"]+)"/i;
  const especieM = html.match(especieRe);
  if (especieM) result.beneficio.especie = especieM[1].trim();

  // Data extrato
  const extratoRe = /Data do extrato:\s*<\/small>\s*<small[^>]*>\s*([^<]+)/i;
  const extratoM = html.match(extratoRe);
  if (extratoM) result.beneficio.data_extrato = extratoM[1].trim();

  // DDB
  const ddbRe = /DDB<\/small>\s*<input[^>]*value="\s*([^"]+)"/i;
  const ddbM = html.match(ddbRe);
  if (ddbM) result.beneficio.ddb = ddbM[1].trim();

  // Desbloqueio
  const desbRe = /Desbloqueio<\/small>\s*(?:<[^>]*>)*\s*<input[^>]*value="\s*([^"]+)"/i;
  const desbM = html.match(desbRe);
  if (desbM) result.beneficio.desbloqueio = desbM[1].trim();

  // ── Margem
  result.margem.parcelas = extractInput('valor_parcela_emprestimo');
  result.margem.total = extractInput('margem_total');

  // Margem disponível empréstimo
  const margemRe = /Margem:\s*<\/small>\s*<small[^>]*>\s*R\$\s*([\d.,]+)/i;
  const margemM = html.match(margemRe);
  if (margemM) result.margem.disponivel = margemM[1].trim();

  // RMC / RCC
  const rmcRe = /valor_parcela_rmc[^>]*>\s*R\$\s*([\d.,]+)/i;
  const rmcM = html.match(rmcRe);
  if (rmcM) result.margem.rmc = rmcM[1].trim();

  const rccRe = /valor_parcela_rcc[^>]*>\s*R\$\s*([\d.,]+)/i;
  const rccM = html.match(rccRe);
  if (rccM) result.margem.rcc = rccM[1].trim();

  // ── Contratos de Empréstimo — parse from the contratos section
  // Pattern: Contrato number, Banco, Taxa, Valor, Parcela, Prazos, Data Averbação
  const contratoRe = /class="[^"]*contratos[^"]*"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi;
  // Simpler: look for collapse sections with data-id-contrato
  const collapseRe = /data-id-contrato="\s*(\d+)"/gi;
  let cm;
  while ((cm = collapseRe.exec(html)) !== null) {
    // Each contrato has nearby info - simplified extraction
    result.contratos.push({ id: cm[1] });
  }

  // Detailed contract extraction from table rows (PDF section has cleaner data)
  // Look for contrato number pattern: 10+ digits in contrato context
  const contratoNumRe = /Contrato<\/small>\s*<p[^>]*>\s*([\d]+)/gi;
  let cnm;
  const contratoNums = [];
  while ((cnm = contratoNumRe.exec(html)) !== null) {
    contratoNums.push(cnm[1].trim());
  }
  if (contratoNums.length > 0) {
    result.contratos = contratoNums.map(n => ({ contrato: n }));
  }

  // ── Cartões — look for Cartão (RMC) and Cartão (RCC) sections
  const cartaoRe = /Cart[aã]o \((RM[C]|RCC)\)[\s\S]*?Banco<\/small>\s*<p[^>]*>\s*([^<]+)[\s\S]*?Margem<\/small>\s*<p[^>]*>\s*R\$\s*([\d.,]+)[\s\S]*?Limite Cart[aã]o<\/small>\s*<p[^>]*>\s*R\$\s*([\d.,]+)/gi;
  let cartM;
  while ((cartM = cartaoRe.exec(html)) !== null) {
    result.cartoes.push({
      tipo: cartM[1],
      banco: cartM[2].trim(),
      margem: cartM[3].trim(),
      limite: cartM[4].trim(),
    });
  }

  // ── Telefones
  const telRe = /phone=55(\d+)"/gi;
  let telM;
  while ((telM = telRe.exec(html)) !== null) {
    if (!result.telefones.includes(telM[1])) {
      result.telefones.push(telM[1]);
    }
  }
  // Fixed phones
  const fixRe = /class="phone_fixo"[^>]*>\s*(\d+)/gi;
  let fixM;
  while ((fixM = fixRe.exec(html)) !== null) {
    if (!result.telefones.includes(fixM[1])) {
      result.telefones.push(fixM[1]);
    }
  }

  // ── Endereço
  const ufRe = /UF<\/small>\s*<input[^>]*value="\s*([^"]+)"/i;
  const ufM = html.match(ufRe);
  if (ufM) result.endereco.uf = ufM[1].trim();

  const munRe = /Munic[ií]pio<\/small>\s*<input[^>]*value="\s*([^"]+)"/i;
  const munM = html.match(munRe);
  if (munM) result.endereco.municipio = munM[1].trim();

  const cepRe = /CEP<\/small>\s*<input[^>]*value="\s*([^"]+)"/i;
  const cepM = html.match(cepRe);
  if (cepM) result.endereco.cep = cepM[1].trim();

  const endRe = /Endere[çc]o<\/small>\s*<input[^>]*value="\s*([^"]+)"/i;
  const endM = html.match(endRe);
  if (endM) result.endereco.endereco = endM[1].trim();

  // ── Banco pagador
  const bancoRe = /Banco<\/small>\s*<input[^>]*value="\s*([^"]+)"/i;
  const bancoM = html.match(bancoRe);
  if (bancoM) result.banco.nome = bancoM[1].trim();

  const agRe = /Agencia<\/small>\s*<input[^>]*value="\s*([^"]+)"/i;
  const agM = html.match(agRe);
  if (agM) result.banco.agencia = agM[1].trim();

  const contaRe = /Conta<\/small>\s*<input[^>]*value="\s*([^"]+)"/i;
  const contaM = html.match(contaRe);
  if (contaM) result.banco.conta = contaM[1].trim();

  const tipoRe = /Tipo de Conta<\/small>\s*<input[^>]*value="\s*([^"]+)"/i;
  const tipoM = html.match(tipoRe);
  if (tipoM) result.banco.tipo = tipoM[1].trim();

  return result;
}

// ── Consulta por Benefício ─────────────────────────────────────────
async function consultBeneficio(cookie, beneficio) {
  const nbClean = beneficio.replace(/\D/g, '');
  const body = new URLSearchParams({
    methodOperation: 'dataBase',
    methodConsult: 'beneficio',
    versaoTela: 'v2',
    dataConsult: nbClean,
    dataOrgao: '',
    CPF: '',
    CPFRepresentante: '',
    ddd: '',
    telefone: '',
  });

  const res = await fetch(`${BASE}/search/consult`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': cookie,
      'Referer': `${BASE}/search`,
      'Origin': BASE,
    },
    body: body.toString(),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Non-JSON response', raw: text.substring(0, 500) };
  }

  if (data.code !== undefined && data.code !== 0) {
    return { ok: false, error: data.mensagem || 'Consulta error', data };
  }

  const html = data.hash || '';
  const parsed = parseConsultHTML(html);
  return { ok: true, beneficio: nbClean, parsed, raw_code: data.code };
}

// ── Main handler ───────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'POST only' }, 405);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { action, user, pass, cpf, beneficio } = body;

  // Credentials — use provided or fallback to defaults
  const loginUser = user || 'lhamascred';
  const loginPass = pass || '*Lhamas24';

  try {
    // ── Action: login — just test login, return session status
    if (action === 'login') {
      const result = await doLogin(loginUser, loginPass);
      if (result.ok) {
        sessionCache = { cookie: result.cookie, ts: Date.now() };
        return json({ ok: true, mensagem: 'Sessão ativa', data: result.data });
      }
      return json({ ok: false, error: result.error }, 401);
    }

    // ── Action: consult_cpf — login + consulta CPF
    if (action === 'consult_cpf') {
      if (!cpf) return json({ error: 'CPF obrigatório' }, 400);

      const session = await ensureSession(loginUser, loginPass);
      if (!session.ok) {
        return json({ ok: false, error: 'Login failed: ' + session.error }, 401);
      }

      const result = await consultCPF(session.cookie, cpf);

      // If session expired, retry once
      if (!result.ok && (result.error || '').includes('session')) {
        sessionCache = { cookie: null, ts: 0 };
        const retry = await ensureSession(loginUser, loginPass);
        if (retry.ok) {
          const result2 = await consultCPF(retry.cookie, cpf);
          return json(result2, result2.ok ? 200 : 400);
        }
      }

      return json(result, result.ok ? 200 : 400);
    }

    // ── Action: consult_beneficio — login + consulta NB
    if (action === 'consult_beneficio') {
      if (!beneficio) return json({ error: 'Benefício obrigatório' }, 400);

      const session = await ensureSession(loginUser, loginPass);
      if (!session.ok) {
        return json({ ok: false, error: 'Login failed: ' + session.error }, 401);
      }

      const result = await consultBeneficio(session.cookie, beneficio);
      return json(result, result.ok ? 200 : 400);
    }

    // ── Action: raw — pass-through any endpoint (advanced)
    if (action === 'raw') {
      const { endpoint, params } = body;
      if (!endpoint) return json({ error: 'endpoint obrigatório' }, 400);

      const session = await ensureSession(loginUser, loginPass);
      if (!session.ok) {
        return json({ ok: false, error: 'Login failed' }, 401);
      }

      const formBody = new URLSearchParams(params || {});
      const res = await fetch(`${BASE}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'Cookie': session.cookie,
          'Referer': `${BASE}/search`,
          'Origin': BASE,
        },
        body: formBody.toString(),
      });

      const text = await res.text();
      try {
        return json(JSON.parse(text));
      } catch {
        return json({ raw: text.substring(0, 5000) });
      }
    }

    return json({
      error: 'action inválida',
      actions: ['login', 'consult_cpf', 'consult_beneficio', 'raw'],
    }, 400);

  } catch (e) {
    return json({ error: e.message, stack: e.stack?.substring(0, 300) }, 500);
  }
}

export const config = { runtime: 'edge' };
