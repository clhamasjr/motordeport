// api/multicorban.js — Proxy Multicorban — FlowForce
// Suporte a multiplos beneficios + parser Bootstrap cards contratos
import { json, jsonError, handleOptions, requireAuth } from './_lib/auth.js';
import { dbInsert } from './_lib/supabase.js';

const BASE = 'https://app.multicorban.com';
let sessionCache = { cookie: null, ts: 0 };
const SESSION_TTL = 25 * 60 * 1000;

function getCredentials() {
  return {
    user: process.env.MULTICORBAN_USER,
    pass: process.env.MULTICORBAN_PASS
  };
}

async function doLogin(user, pass) {
  const body = new URLSearchParams({ login: user, senha: pass });
  const res = await fetch(`${BASE}/access/validateLogin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'Referer': `${BASE}/`, 'Origin': BASE },
    body: body.toString(), redirect: 'manual'
  });
  const cookies = [];
  if (typeof res.headers.getSetCookie === 'function') { cookies.push(...res.headers.getSetCookie()); }
  else { const raw = res.headers.get('set-cookie'); if (raw) cookies.push(...raw.split(/,(?=\s*\w+=)/)); }
  let loginData;
  try { loginData = await res.json(); } catch { loginData = { code: -1, mensagem: 'Failed to parse' }; }
  if (loginData.code !== 0) return { ok: false, error: loginData.mensagem || 'Login failed', data: loginData };
  const cookieStr = cookies.map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
  if (!cookieStr) return { ok: false, error: 'No session cookie', data: loginData };
  return { ok: true, cookie: cookieStr, data: loginData };
}

async function ensureSession() {
  const now = Date.now();
  if (sessionCache.cookie && (now - sessionCache.ts) < SESSION_TTL) return { ok: true, cookie: sessionCache.cookie };
  const creds = getCredentials();
  if (!creds.user || !creds.pass) return { ok: false, error: 'Credenciais Multicorban nao configuradas (env vars)' };
  const result = await doLogin(creds.user, creds.pass);
  if (result.ok) sessionCache = { cookie: result.cookie, ts: now };
  return result;
}

function parseListHTML(html) {
  const lista = [];
  const rowRe = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
  const rows = html.match(rowRe) || [];
  for (const row of rows) {
    if (/<th/i.test(row)) continue;
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells = []; let cm;
    while ((cm = cellRe.exec(row)) !== null) cells.push(cm[1].replace(/<[^>]*>/g, '').trim());
    if (cells.length >= 4) {
      let nb = '', nome = '', valor = '', especie = '', situacao = '', ddb = '';
      for (const cell of cells) {
        if (!nb && /^\d{7,12}$/.test(cell.replace(/\D/g, '')) && cell.replace(/\D/g, '').length >= 7) nb = cell.replace(/\D/g, '');
        if (!nome && cell.length > 5 && /^[A-ZÁÉÍÓÚÃÕÂÊÔÇ\s]+$/i.test(cell)) nome = cell;
        if (!valor && /R\$/.test(cell)) { const vm = cell.match(/R\$\s*([\d.,]+)/); if (vm) valor = vm[1]; }
        if (!especie && /^\d{1,2}$/.test(cell.trim())) especie = cell.trim();
        if (!situacao && /ATIVO|CESSADO|SUSPENSO|INATIVO/i.test(cell)) situacao = cell.trim().toUpperCase();
        if (!ddb && /^\d{2}\/\d{2}\/\d{4}$/.test(cell.trim())) ddb = cell.trim();
      }
      if (nb) lista.push({ nb, nome, valor, especie, situacao, ddb });
    }
  }
  return lista;
}

// Parser do HTML da consulta CLT/FGTS (Multicorban)
function parseCltHTML(html) {
  const result = { nome: null, cpf: null, dataNascimento: null, idade: null, sexo: null,
    nomeMae: null, nomePai: null, rg: null, tituloEleitor: null,
    empresa: { razaoSocial: null, cnpj: null, totalRegistros: null },
    trabalhista: { dataAdmissao: null, dataDesligamento: null, tempoContribuicaoMeses: null,
      situacao: null, renda: null, saldoAproximado: null },
    telefones: []
  };
  if (!html) return result;

  // Nome (id nome_beneficiario)
  let m = html.match(/id="nome_beneficiario"[^>]*>\s*([^<]+?)\s*<\/small>/i);
  if (m) result.nome = m[1].trim();

  // CPF (id cpf_beneficiario)
  m = html.match(/id="cpf_beneficiario"[^>]*>\s*([\d\s]+?)\s*<\/small>/i);
  if (m) result.cpf = m[1].replace(/\s/g, '');

  // Data nascimento (vem em <small class="text-warning">DD/MM/AAAA</small> próximo ao label)
  m = html.match(/Data de Nascimento\s*<\/p>[\s\S]{0,200}?<small[^>]*>\s*(\d{2}\/\d{2}\/\d{4})\s*<\/small>/i);
  if (m) result.dataNascimento = m[1];

  // Idade
  m = html.match(/Idade\s*<\/p>[\s\S]{0,200}?<small[^>]*>\s*(\d+)\s*Anos?\s*<\/small>/i);
  if (m) result.idade = parseInt(m[1]);

  // Sexo
  m = html.match(/SEXO\s*<\/p>[\s\S]{0,200}?<small[^>]*>\s*(Masculino|Feminino|M|F)\s*<\/small>/i);
  if (m) result.sexo = m[1].toUpperCase().startsWith('M') ? 'M' : 'F';

  // Nome da Mãe
  m = html.match(/Nome da M[ãa]e\s*<\/p>[\s\S]{0,200}?<small[^>]*>\s*([^<]+?)\s*<\/small>/i);
  if (m) result.nomeMae = m[1].trim();

  // Nome do Pai
  m = html.match(/Nome do Pai\s*<\/p>[\s\S]{0,200}?<small[^>]*>\s*([^<]+?)\s*<\/small>/i);
  if (m && m[1].trim()) result.nomePai = m[1].trim();

  // Empresa: Razão Social
  m = html.match(/Razao Social\s*<\/p>[\s\S]{0,200}?<small[^>]*>\s*([^<]+?)\s*<\/small>/i);
  if (m) result.empresa.razaoSocial = m[1].trim();

  // Empresa: CNPJ (text-info próximo ao label)
  m = html.match(/CNPJ\s*<\/p>[\s\S]{0,200}?<small[^>]*class="text-info"[^>]*>\s*([\d\s]+?)\s*<\/small>/i);
  if (m) result.empresa.cnpj = m[1].replace(/\s/g, '');

  // Total de Registros (id contador)
  m = html.match(/id="contador"[^>]*>\s*(\d+)\s*<\/small>/i);
  if (m) result.empresa.totalRegistros = parseInt(m[1]);

  // Data Admissão
  m = html.match(/Data da Admiss[ãa]o\s*<\/p>[\s\S]{0,200}?<small[^>]*>\s*(\d{2}\/\d{2}\/\d{4})\s*<\/small>/i);
  if (m) result.trabalhista.dataAdmissao = m[1];

  // Data Desligamento (pode estar vazio)
  m = html.match(/Data do Desligamento\s*<\/p>[\s\S]{0,200}?<small[^>]*>\s*(\d{2}\/\d{2}\/\d{4})\s*<\/small>/i);
  if (m) result.trabalhista.dataDesligamento = m[1];

  // Tempo Contribuição (vem em "small class=mb-0 text-success fw-bold")
  m = html.match(/Tempo de Contribui[çc][ãa]o[\s\S]{0,300}?<small[^>]*text-success[^>]*>\s*(\d+)\s*<\/small>/i);
  if (m) result.trabalhista.tempoContribuicaoMeses = parseInt(m[1]);

  // Renda (id renda)
  m = html.match(/id="renda"[^>]*>[\s\S]{0,300}?R\$\s*([\d.,]+)/i);
  if (m) result.trabalhista.renda = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));

  // Saldo Aproximado
  m = html.match(/Saldo Aproximado\s*<\/p>[\s\S]{0,300}?R\$\s*([\d.,]+)/i);
  if (m) result.trabalhista.saldoAproximado = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));

  // Telefones — pega de href="...phone=55XXXXXXXXX..." (whatsapp) ou de class phone_with_ddd / phone_fixo
  const telSet = new Set();
  // Padrão whatsapp link
  const reWpp = /href="https:\/\/api\.whatsapp\.com\/send[^"]*phone=55(\d+)"/gi;
  let mt;
  while ((mt = reWpp.exec(html)) !== null) telSet.add(mt[1]);
  // Padrão phone_with_ddd inline
  const rePhone = /class="phone_with_ddd[^"]*"[^>]*>\s*([\d]+)\s*<\/a>/gi;
  while ((mt = rePhone.exec(html)) !== null) telSet.add(mt[1].trim());

  for (const t of telSet) {
    const clean = t.replace(/\D/g, '');
    if (clean.length >= 10) {
      result.telefones.push({
        ddd: clean.substring(0, 2),
        numero: clean.substring(2),
        completo: clean,
        whatsapp: true
      });
    }
  }

  return result;
}

async function consultCltFgts(cookie, cpf) {
  const cpfClean = cpf.replace(/\D/g, '').padStart(11, '0');
  const body = new URLSearchParams({
    methodOperation: 'dataBaseFgts',
    methodConsult: 'cpf',
    dataConsult: cpfClean,
    dataOrgao: '',
    CPF: '',
    CPFRepresentante: '',
    ddd: '',
    telefone: ''
  });
  const res = await fetch(`${BASE}/search/consult`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': cookie,
      'Referer': `${BASE}/search/form/geral`,
      'Origin': BASE
    },
    body: body.toString()
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { return { ok: false, error: 'Non-JSON response', raw: text.substring(0, 500) }; }
  if (data.code !== undefined && data.code !== 0) return { ok: false, error: data.mensagem || 'Consulta CLT error', data };
  const html = data.hash || '';
  const parsed = parseCltHTML(html);
  return { ok: true, cpf: cpfClean, parsed, raw_code: data.code };
}

async function consultCPF(cookie, cpf) {
  const cpfClean = cpf.replace(/\D/g, '').padStart(11, '0');
  const body = new URLSearchParams({ methodOperation: 'dataBase', methodConsult: 'cpf', versaoTela: 'v2', dataConsult: cpfClean, dataOrgao: '', CPF: '', CPFRepresentante: '', ddd: '', telefone: '' });
  const res = await fetch(`${BASE}/search/consult`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'Cookie': cookie, 'Referer': `${BASE}/search`, 'Origin': BASE },
    body: body.toString()
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { return { ok: false, error: 'Non-JSON response', raw: text.substring(0, 500) }; }
  if (data.code !== undefined && data.code !== 0) return { ok: false, error: data.mensagem || 'Consulta error', data };
  const html = data.hash || '';
  const hasDetail = /nome_beneficiario|nb_beneficiario|valor_beneficio/i.test(html);
  const hasList = /<tr[\s\S]*?<\/tr>/i.test(html) && !hasDetail;
  if (hasList || (!hasDetail && /<table/i.test(html))) {
    const lista = parseListHTML(html);
    if (lista.length > 0) {
      const ativo = lista.find(l => l.situacao === 'ATIVO') || lista[0];
      if (ativo && ativo.nb) {
        const benefResult = await consultBeneficio(cookie, ativo.nb);
        if (benefResult.ok) return { ok: true, cpf: cpfClean, parsed: benefResult.parsed, lista, auto_selected: ativo.nb, raw_code: data.code };
      }
      return { ok: true, cpf: cpfClean, parsed: { beneficiario: { cpf: cpfClean, nome: lista[0].nome || '' }, beneficio: {}, margem: {}, contratos: [], cartoes: [], telefones: [], endereco: {}, banco: {} }, lista, raw_code: data.code };
    }
    return { ok: false, error: 'Multiplos beneficios — use consulta por beneficio', raw: html.substring(0, 1000) };
  }
  const parsed = parseConsultHTML(html);
  return { ok: true, cpf: cpfClean, parsed, raw_code: data.code };
}

function parseConsultHTML(html) {
  const result = { beneficiario: {}, beneficio: {}, margem: {}, contratos: [], cartoes: [], telefones: [], endereco: {}, banco: {} };
  if (!html) return result;
  const ei = (id) => { const re = new RegExp(`id="\\s*${id}"[^>]*value="\\s*([^"]*)"`, `i`); const m = html.match(re); return m ? m[1].trim() : null; };
  let m;
  result.beneficiario.cpf = ei('cpf_beneficiario');
  result.beneficiario.nome = ei('nome_beneficiario');
  result.beneficiario.rg = ei('rg_beneficiario');
  result.beneficiario.nome_mae = ei('nomeMae_beneficiario');
  result.beneficiario.nb = ei('nb_beneficiario');
  m = html.match(/Data de Nascimento<\/small>\s*<input[^>]*value="\s*([^"]+)"/i); if (m) result.beneficiario.data_nascimento = m[1].trim();
  m = html.match(/Idade<\/small>\s*(?:<[^>]*>)*\s*<input[^>]*value="\s*([^"]+)"/i); if (m) result.beneficiario.idade = m[1].trim();
  result.beneficio.valor = ei('valor_beneficio');
  result.beneficio.base_calculo = ei('base_calculo_consignavel');
  m = html.match(/Situa[çc]\u00e3o:\s*<\/small>\s*<small[^>]*>\s*(\w+)/i); if (m) result.beneficio.situacao = m[1].trim();
  m = html.match(/Descri[çc]\u00e3o da Esp\u00e9cie<\/small>\s*<input[^>]*value="\s*([^"]+)"/i); if (m) result.beneficio.especie = m[1].trim();
  m = html.match(/Data do extrato:\s*<\/small>\s*<small[^>]*>\s*([^<]+)/i); if (m) result.beneficio.data_extrato = m[1].trim();
  m = html.match(/DDB<\/small>\s*<input[^>]*value="\s*([^"]+)"/i); if (m) result.beneficio.ddb = m[1].trim();
  m = html.match(/Desbloqueio<\/small>\s*(?:<[^>]*>)*\s*<input[^>]*value="\s*([^"]+)"/i); if (m) result.beneficio.desbloqueio = m[1].trim();
  result.margem.parcelas = ei('valor_parcela_emprestimo');
  result.margem.total = ei('margem_total');
  m = html.match(/Margem:\s*<\/small>\s*<small[^>]*>\s*R\$\s*([\d.,]+)/i); if (m) result.margem.disponivel = m[1].trim();
  m = html.match(/valor_parcela_rmc[^>]*>\s*R\$\s*([\d.,]+)/i); if (m) result.margem.rmc = m[1].trim();
  m = html.match(/valor_parcela_rcc[^>]*>\s*R\$\s*([\d.,]+)/i); if (m) result.margem.rcc = m[1].trim();

  // ═══ CONTRATOS — Bootstrap card extraction (Multicorban v2) ═══
  // Aumentamos a janela e tentamos varios delimitadores de card para pegar TODOS os contratos.
  // Multicorban as vezes usa "card mb-4", "card mt-4", "card shadow", "card p-3", etc.
  const contratoSection = html.indexOf('id="navs-tab-contrato"');
  result._debug = { contratoSection, cardsFound: 0, cardsPushed: 0, cardsSkipped: 0, skippedReasons: [] };
  if (contratoSection >= 0) {
    // Pega tudo a partir da secao de contratos ate o proximo <div id="navs-tab-..."> ou ate 300k
    let endIdx = html.indexOf('id="navs-tab-', contratoSection + 30);
    if (endIdx < 0 || endIdx - contratoSection > 300000) endIdx = contratoSection + 300000;
    const cBlock = html.substring(contratoSection, endIdx);
    result._debug.blockSize = cBlock.length;
    // Split mais agressivo: qualquer "card" seguido de espaco e outra classe Bootstrap tipica
    const cards = cBlock.split(/\bcard\s+(?:mb-\d+|mt-\d+|shadow|p-\d+|border\b)/);
    result._debug.cardsFound = cards.length - 1;
    for (let i = 1; i < cards.length; i++) {
      const card = cards[i];

      // ── getField robusto: busca valor apos label em multiplos formatos HTML ──
      const getField = (label) => {
        let fm;
        // 1) <small>Label</small> ... <p>Value</p>
        fm = card.match(new RegExp(label + '<\\/small>[\\s\\S]*?<p[^>]*>\\s*([\\s\\S]*?)<\\/p>', 'i'));
        if (fm) return fm[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        // 2) <small>Label</small> ... <input value="...">
        fm = card.match(new RegExp(label + '<\\/small>[\\s\\S]*?<input[^>]*value="\\s*([^"]*)"', 'i'));
        if (fm) return fm[1].trim();
        // 3) <small>Label</small> ... <span>Value</span>
        fm = card.match(new RegExp(label + '<\\/small>[\\s\\S]*?<span[^>]*>\\s*([\\s\\S]*?)<\\/span>', 'i'));
        if (fm) return fm[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        // 4) <small>Label</small> ... <strong>Value</strong>
        fm = card.match(new RegExp(label + '<\\/small>[\\s\\S]*?<strong[^>]*>\\s*([\\s\\S]*?)<\\/strong>', 'i'));
        if (fm) return fm[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        // 5) <small>Label</small> ... <div>Value</div> (collapse panels)
        fm = card.match(new RegExp(label + '<\\/small>[\\s\\S]*?<div[^>]*>\\s*([^<]+)', 'i'));
        if (fm && fm[1].trim().length > 0 && fm[1].trim().length < 100) return fm[1].trim();
        // 6) <td>Label</td><td>Value</td> (table rows)
        fm = card.match(new RegExp(label + '<\\/td>\\s*<td[^>]*>\\s*([^<]+)', 'i'));
        if (fm) return fm[1].trim();
        // 7) Label:</small> or Label:</strong> followed by value
        fm = card.match(new RegExp(label + ':?\\s*<\\/(?:small|strong|b|label)>[\\s\\S]*?(?:R\\$\\s*)?([\\d][\\d.,]*)', 'i'));
        if (fm) return fm[1].trim();
        return '';
      };

      let contrato = getField('Contrato');
      // Fallbacks extras para pegar numero do contrato:
      if (!contrato) {
        // name="numero_contrato_..." ou similar
        let fm = card.match(/name="[^"]*(?:numero|num)_contrato[^"]*"[^>]*value="([^"]+)"/i);
        if (fm) contrato = fm[1].trim();
      }
      if (!contrato) {
        // id="contrato_XXXXX"
        let fm = card.match(/id="contrato_(\d+)"/i);
        if (fm) contrato = fm[1];
      }
      if (!contrato) {
        // Qualquer input com name contendo "contrato" (exceto saldoquitacao_contratoXXX)
        let fm = card.match(/name="(?!.*saldo)(?!.*valor)[^"]*contrato[^"]*"[^>]*value="([^"]+)"/i);
        if (fm && /\d{5,}/.test(fm[1])) contrato = fm[1].trim();
      }
      const taxa = getField('Taxa');
      const valor = getField('Valor');
      const parcela = getField('Parcela');
      const prazos = getField('Prazos');
      const dataAverb = getField('Data Averba');

      // Bank code from icon OR alt attribute (<img alt="935 - Facta"> etc) OR texto
      let banco_codigo = '';
      const iconM = card.match(/icones\/(\d{3})\.png/);
      if (iconM) banco_codigo = iconM[1];
      if (!banco_codigo) { const altM = card.match(/alt="\s*(\d{3})\s*[-–]/i); if (altM) banco_codigo = altM[1]; }
      if (!banco_codigo) { const btm = card.match(/(\d{3})\s*-\s*[A-Z]/); if (btm) banco_codigo = btm[1]; }
      // Fallback: 2 digitos seguidos de "-BANCO"
      if (!banco_codigo) { const btm2 = card.match(/>\s*(\d{2,3})\s*[-–]\s*[A-Za-z]{2,}/); if (btm2) banco_codigo = String(btm2[1]).padStart(3,'0'); }

      // ── Nome do banco (pra normalizacao de codigos aglutinados) ──
      let banco_nome = '';
      const nm1 = card.match(/icones\/\d{3}\.png[^>]*alt="([^"]+)"/i);
      if (nm1) banco_nome = nm1[1];
      if (!banco_nome) { const nm2 = card.match(/alt="\s*\d{2,3}\s*[-–]\s*([^"]+)"/i); if (nm2) banco_nome = nm2[1]; }
      if (!banco_nome) { const nm3 = card.match(/\b\d{2,3}\s*[-–]\s*([A-Za-zÀ-ú][A-Za-zÀ-ú .]{1,30})/); if (nm3) banco_nome = nm3[1].trim(); }

      // ── Normalizacao de codigos aglutinados ──
      // 029 = Itau BMG = Itau Consignado (mesma coisa).
      // 341 = Itau Unibanco (banco de varejo, NAO e consignado) — NAO normaliza.
      // Caso conhecido de inconsistencia: Multicorban as vezes reporta "041-Itau BMG"
      // mas 041 oficial e Banrisul. So normalizamos quando cod=041 E nome tem "itau".
      if (banco_codigo === '041' && banco_nome && /itau/i.test(banco_nome)) {
        banco_codigo = '029';
      }

      // Parse prazo: "90 / 96"
      let prazo_rest = '', prazo_total = '';
      if (prazos) { const pm = prazos.match(/(\d+)\s*\/\s*(\d+)/); if (pm) { prazo_rest = pm[1]; prazo_total = pm[2]; } }

      // Parse valor averbado
      let valorAverb = ''; if (valor) { const vm = valor.match(/R\$\s*([\d.,]+)/); if (vm) valorAverb = vm[1]; }

      // ── Saldo Devedor — extração específica para Multicorban v2 ──
      // HTML real: Saldo Devedor <input onkeyup="somaValorLiquidoContratos(ID)"
      //            name="valor_saldoquitacao_contratoID" value="1.002,59">
      let saldo = '';

      // Estrategia 1 (PRINCIPAL): Encontrar "Saldo Devedor" e pegar o value="" do <input> mais proximo
      {
        const saldoIdx = card.search(/[Ss]aldo\s*[Dd]evedor/);
        if (saldoIdx >= 0) {
          const afterSaldo = card.substring(saldoIdx, saldoIdx + 600);
          // Pegar especificamente o atributo value="..." do input (NAO o onkeyup)
          const inputM = afterSaldo.match(/<input[^>]*\bvalue="([^"]+)"/i);
          if (inputM) {
            const val = inputM[1].trim();
            // Validar que parece um valor monetario (tem virgula ou ponto, formato X.XXX,XX)
            if (/^\d[\d.,]*\d$/.test(val) && val.includes(',')) {
              saldo = val;
            }
          }
          // Fallback: buscar R$ depois de Saldo Devedor
          if (!saldo) {
            const rmM = afterSaldo.match(/R\$\s*([\d.,]+)/);
            if (rmM) saldo = rmM[1];
          }
        }
      }

      // Estrategia 2: buscar input com name contendo "saldoquitacao"
      if (!saldo) {
        const sqM = card.match(/name="[^"]*saldoquitacao[^"]*"[^>]*value="([^"]+)"/i);
        if (sqM) saldo = sqM[1];
        // Tambem tentar com value antes do name
        if (!saldo) {
          const sqM2 = card.match(/value="([^"]+)"[^>]*name="[^"]*saldoquitacao[^"]*"/i);
          if (sqM2 && /^\d[\d.,]*\d$/.test(sqM2[1])) saldo = sqM2[1];
        }
      }

      // Estrategia 3: getField padrao (caso o formato mude no futuro)
      if (!saldo) {
        const saldoDev = getField('Saldo Devedor');
        if (saldoDev) { const sm = saldoDev.match(/(\d[\d.,]*\d)/); if (sm && sm[1].includes(',')) saldo = sm[1]; }
      }

      // Estrategia 4: busca "Saldo" em qualquer formato alternativo
      if (!saldo) {
        const altLabels = ['Vlr\\.?\\s*Saldo', 'Sld\\.?\\s*Devedor', 'Saldo\\s*Dev\\.?'];
        for (const alt of altLabels) {
          if (saldo) break;
          const altM = card.match(new RegExp(alt + '[\\s\\S]*?<input[^>]*value="([^"]+)"', 'i'));
          if (altM && /^\d[\d.,]*\d$/.test(altM[1]) && altM[1].includes(',')) saldo = altM[1];
        }
      }

      // Fallback final: valor averbado (melhor que nada)
      if (!saldo && valor) { const vm = valor.match(/R\$\s*([\d.,]+)/); if (vm) saldo = vm[1]; }

      // Parse parcela
      let parcelaClean = ''; if (parcela) { const pm2 = parcela.match(/R\$\s*([\d.,]+)/); if (pm2) parcelaClean = pm2[1]; }

      if (contrato) {
        result.contratos.push({ contrato: contrato.replace(/[^0-9A-Za-z]/g, ''), banco_codigo, banco_nome, parcela: parcelaClean, saldo, valor_averbado: valorAverb, taxa: taxa.trim(), prazo: prazo_rest, prazo_original: prazo_total, data_averbacao: dataAverb });
        result._debug.cardsPushed++;
      } else {
        result._debug.cardsSkipped++;
        // Registra motivo pra diagnostico
        if (result._debug.skippedReasons.length < 5) {
          const snippet = card.substring(0, 300).replace(/\s+/g, ' ').trim();
          result._debug.skippedReasons.push({ idx: i, cardSnippet: snippet, hasBanco: !!banco_codigo, hasParcela: !!parcelaClean, hasSaldo: !!saldo });
        }
      }
    }
  }
  // Fallback ADITIVO: tenta pegar contratos que o split nao capturou
  // Busca TODO <input name="numero_contrato_X" value="..."> no HTML como fonte autoritaria
  {
    const seen = new Set(result.contratos.map(c => c.contrato));
    const globalContratos = new Set();
    const cre = /name="[^"]*(?:numero|num)_contrato[^"]*"[^>]*value="([^"]+)"/gi;
    let gm;
    while ((gm = cre.exec(html)) !== null) {
      const cNum = String(gm[1]).replace(/[^0-9A-Za-z]/g, '');
      if (cNum && !seen.has(cNum)) globalContratos.add(cNum);
    }
    result._debug.globalContratosEncontrados = globalContratos.size;
    // Se o HTML tem contratos que o parser de cards nao pegou, adiciona como "dados parciais"
    for (const cNum of globalContratos) {
      result.contratos.push({ contrato: cNum, banco_codigo: '', parcela: '', saldo: '', valor_averbado: '', taxa: '', prazo: '', prazo_original: '', data_averbacao: '', _parcial: true });
    }
  }
  // Fallback legado: se ainda nao achou nada
  if (!result.contratos.length) {
    const cnRe = /Contrato<\/small>\s*<p[^>]*>\s*([\d\w]+)/gi; let cn;
    while ((cn = cnRe.exec(html)) !== null) result.contratos.push({ contrato: cn[1].trim() });
  }

  // Cartoes RMC/RCC
  const cartRe = /Cart[aã]o \((RM[C]|RCC)\)/gi;
  let cartMatch;
  while ((cartMatch = cartRe.exec(html)) !== null) {
    const tipo = cartMatch[1];
    const afterCart = html.substring(cartMatch.index, cartMatch.index + 2000);
    let margem = '', limite = '', banco = '';
    const mrgM = afterCart.match(/Margem<\/small>\s*<p[^>]*>\s*R\$\s*([\d.,]+)/i); if (mrgM) margem = mrgM[1];
    const limM = afterCart.match(/Limite Cart[aã]o<\/small>\s*<p[^>]*>\s*R\$\s*([\d.,]+)/i); if (limM) limite = limM[1];
    const liqM = afterCart.match(/Valor L[ií]quido<\/small>\s*<p[^>]*>\s*R\$\s*([\d.,]+)/i); if (liqM && !limite) limite = liqM[1];
    const bancoM = afterCart.match(/Banco<\/small>\s*<p[^>]*>\s*([^<]+)/i); if (bancoM) banco = bancoM[1].trim();
    result.cartoes.push({ tipo, banco, margem: margem || '0,00', limite: limite || '0,00' });
  }

  // Telefones
  const telRe = /phone=55(\d+)"/gi; let tl;
  while ((tl = telRe.exec(html)) !== null) { if (!result.telefones.includes(tl[1])) result.telefones.push(tl[1]); }
  const fxRe = /class="phone_fixo"[^>]*>\s*(\d+)/gi; let fx;
  while ((fx = fxRe.exec(html)) !== null) { if (!result.telefones.includes(fx[1])) result.telefones.push(fx[1]); }

  // Endereco
  m = html.match(/UF<\/small>\s*<input[^>]*value="\s*([^"]+)"/i); if (m) result.endereco.uf = m[1].trim();
  m = html.match(/Munic[ií]pio<\/small>\s*<input[^>]*value="\s*([^"]+)"/i); if (m) result.endereco.municipio = m[1].trim();
  m = html.match(/CEP<\/small>\s*<input[^>]*value="\s*([^"]+)"/i); if (m) result.endereco.cep = m[1].trim();
  m = html.match(/Endere[çc]o<\/small>\s*<input[^>]*value="\s*([^"]+)"/i); if (m) result.endereco.endereco = m[1].trim();

  // Banco pagador
  m = html.match(/Banco<\/small>\s*<input[^>]*value="\s*([^"]+)"/i); if (m) result.banco.nome = m[1].trim();
  m = html.match(/Agencia<\/small>\s*<input[^>]*value="\s*([^"]+)"/i); if (m) result.banco.agencia = m[1].trim();
  m = html.match(/Conta<\/small>\s*<input[^>]*value="\s*([^"]+)"/i); if (m) result.banco.conta = m[1].trim();
  m = html.match(/Tipo de Conta<\/small>\s*<input[^>]*value="\s*([^"]+)"/i); if (m) result.banco.tipo = m[1].trim();
  return result;
}

async function consultBeneficio(cookie, beneficio) {
  const nbClean = beneficio.replace(/\D/g, '');
  const body = new URLSearchParams({ methodOperation: 'dataBase', methodConsult: 'beneficio', versaoTela: 'v2', dataConsult: nbClean, dataOrgao: '', CPF: '', CPFRepresentante: '', ddd: '', telefone: '' });
  const res = await fetch(`${BASE}/search/consult`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'Cookie': cookie, 'Referer': `${BASE}/search`, 'Origin': BASE },
    body: body.toString()
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { return { ok: false, error: 'Non-JSON response', raw: text.substring(0, 500) }; }
  if (data.code !== undefined && data.code !== 0) return { ok: false, error: data.mensagem || 'Consulta error', data };
  const html = data.hash || '';
  const parsed = parseConsultHTML(html);
  return { ok: true, beneficio: nbClean, parsed, raw_code: data.code };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);
  if (req.method !== 'POST') return jsonError('POST only', 405, req);

  // Verificar autenticacao
  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  let body;
  try { body = await req.json(); } catch { return jsonError('Invalid JSON body', 400, req); }
  const { action, cpf, beneficio } = body;

  try {
    if (action === 'login') {
      const creds = getCredentials();
      const result = await doLogin(creds.user, creds.pass);
      if (result.ok) { sessionCache = { cookie: result.cookie, ts: Date.now() }; return json({ ok: true, mensagem: 'Sessao ativa', data: result.data }, 200, req); }
      return json({ ok: false, error: result.error }, 401, req);
    }

    if (action === 'consult_cpf') {
      if (!cpf) return jsonError('CPF obrigatorio', 400, req);
      const session = await ensureSession(); if (!session.ok) return json({ ok: false, error: 'Login failed: ' + session.error }, 401, req);
      let result = await consultCPF(session.cookie, cpf);
      if (!result.ok && (result.error || '').includes('session')) {
        sessionCache = { cookie: null, ts: 0 };
        const retry = await ensureSession();
        if (retry.ok) { result = await consultCPF(retry.cookie, cpf); }
      }
      // Salvar no historico
      if (result.ok) {
        dbInsert('consultas', { user_id: user.id, tipo: 'cpf', cpf: cpf.replace(/\D/g, ''), nome: result.parsed?.beneficiario?.nome, resultado: result.parsed, fonte: 'multicorban' }).catch(() => {});
      }
      return json(result, result.ok ? 200 : 400, req);
    }

    // ── CLT/FGTS — consulta dados pessoais + empresa + telefones por CPF ──
    if (action === 'consult_clt') {
      if (!cpf) return jsonError('CPF obrigatorio', 400, req);
      const session = await ensureSession();
      if (!session.ok) return json({ ok: false, error: 'Login failed: ' + session.error }, 401, req);
      let result = await consultCltFgts(session.cookie, cpf);
      if (!result.ok && (result.error || '').includes('session')) {
        sessionCache = { cookie: null, ts: 0 };
        const retry = await ensureSession();
        if (retry.ok) result = await consultCltFgts(retry.cookie, cpf);
      }
      if (result.ok) {
        dbInsert('consultas', {
          user_id: user.id, tipo: 'clt_fgts',
          cpf: cpf.replace(/\D/g, ''),
          nome: result.parsed?.nome,
          resultado: result.parsed, fonte: 'multicorban_clt'
        }).catch(() => {});
      }
      return json(result, result.ok ? 200 : 400, req);
    }

    if (action === 'consult_beneficio') {
      if (!beneficio) return jsonError('Beneficio obrigatorio', 400, req);
      const session = await ensureSession(); if (!session.ok) return json({ ok: false, error: 'Login failed: ' + session.error }, 401, req);
      const result = await consultBeneficio(session.cookie, beneficio);
      if (result.ok) {
        dbInsert('consultas', { user_id: user.id, tipo: 'beneficio', beneficio: beneficio.replace(/\D/g, ''), nome: result.parsed?.beneficiario?.nome, resultado: result.parsed, fonte: 'multicorban' }).catch(() => {});
      }
      return json(result, result.ok ? 200 : 400, req);
    }

    // Debug: retorna HTML bruto da secao de contratos pra diagnostico
    if (action === 'debug_saldo') {
      if (!beneficio && !cpf) return jsonError('CPF ou beneficio obrigatorio', 400, req);
      const session = await ensureSession(); if (!session.ok) return json({ ok: false, error: 'Login failed' }, 401, req);
      let result;
      if (beneficio) { result = await consultBeneficio(session.cookie, beneficio); }
      else {
        const cpfClean = cpf.replace(/\D/g, '').padStart(11, '0');
        const formBody = new URLSearchParams({ methodOperation: 'dataBase', methodConsult: 'cpf', versaoTela: 'v2', dataConsult: cpfClean, dataOrgao: '', CPF: '', CPFRepresentante: '', ddd: '', telefone: '' });
        const res = await fetch(`${BASE}/search/consult`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'Cookie': session.cookie, 'Referer': `${BASE}/search`, 'Origin': BASE }, body: formBody.toString() });
        const text = await res.text();
        let data; try { data = JSON.parse(text); } catch { return json({ raw_error: text.substring(0, 1000) }, 200, req); }
        const html = data.hash || '';
        // Extrair trecho de contratos
        const idx = html.indexOf('id="navs-tab-contrato"');
        const contratoHTML = idx >= 0 ? html.substring(idx, idx + 10000) : 'SECAO_CONTRATOS_NAO_ENCONTRADA';
        // Buscar qualquer ocorrencia de "Saldo" no HTML inteiro
        const saldoMatches = [];
        const saldoRe = /[Ss]aldo[\s\S]{0,200}/gi;
        let sm;
        while ((sm = saldoRe.exec(html)) !== null && saldoMatches.length < 10) {
          saldoMatches.push({ pos: sm.index, trecho: sm[0].substring(0, 200).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() });
        }
        return json({ ok: true, debug: true, html_length: html.length, contrato_section_found: idx >= 0, contrato_html_sample: contratoHTML.substring(0, 5000), saldo_ocorrencias: saldoMatches, parsed: parseConsultHTML(html) }, 200, req);
      }
      // Se consultou por beneficio, fazer o mesmo debug
      if (result && result.ok) {
        return json({ ok: true, debug: true, parsed: result.parsed, contratos_encontrados: result.parsed?.contratos?.length || 0, contratos: result.parsed?.contratos || [] }, 200, req);
      }
      return json(result || { error: 'Sem resultado' }, 200, req);
    }

    if (action === 'raw') {
      const { endpoint, params } = body; if (!endpoint) return jsonError('endpoint obrigatorio', 400, req);
      const session = await ensureSession(); if (!session.ok) return json({ ok: false, error: 'Login failed' }, 401, req);
      const formBody = new URLSearchParams(params || {});
      const res = await fetch(`${BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'Cookie': session.cookie, 'Referer': `${BASE}/search`, 'Origin': BASE },
        body: formBody.toString()
      });
      const text = await res.text();
      try { return json(JSON.parse(text), 200, req); } catch { return json({ raw: text.substring(0, 5000) }, 200, req); }
    }

    return jsonError('action invalida', 400, req);
  } catch (e) {
    return json({ error: 'Erro interno' }, 500, req);
  }
}

export const config = { runtime: 'edge' };
