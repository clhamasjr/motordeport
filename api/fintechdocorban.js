// ══════════════════════════════════════════════════════════════════
// api/fintechdocorban.js — Fintech do Corban (Super Simples)
// Doc oficial: https://docs.fintechdocorban.com.br/
// Swagger: https://api.nossafintech.com.br/swagger/partners/swagger.json
//
// Integrador que da acesso a 2 bancarizadoras CLT:
//  - QI Tech (provider='qi')        → /Api/V1/Qi/*
//  - Celcoin  (provider='celcoin') → /Api/V1/Celcoin/*
//
// AUTH (HIBRIDO — cobre os dois sinais que temos):
//   - Header `Subscription: <api_key>` (confirmado no portal deles: "Envie a
//     chave no cabecalho Subscription") — chave de gateway/APIM.
//   - E, SE login/senha estiverem configurados, faz POST /Api/V1/User/Login
//     {login,password} -> access_token e manda tambem `Authorization: Bearer`.
//   Mandar os dois e seguro: API so-Subscription ignora o Bearer; API que exige
//   token de app pega o Bearer. Token tem cache (25min) + relogin em 401.
//
// ENV VARS (Vercel):
//   FINTECH_API_KEY_PRD / FINTECH_API_KEY_HML        — chave Subscription
//   FINTECH_LOGIN_PRD / FINTECH_LOGIN_HML            — email do portal (Bearer)
//   FINTECH_PASSWORD_PRD / FINTECH_PASSWORD_HML      — senha do portal (Bearer)
//   FINTECH_AMBIENTE                                 — 'PRD' (default) ou 'HML'
//
// FLUXO CLT (mesma sequencia pros 2 providers):
//   1. consultarPorCPF        → GET .../Get-All-Consult-Data-Worker-By-Cpf/{cpf}
//      Se ja existe autorizacao ativa, retorna dados + margem. Senao precisa autorizar.
//   2. enviarLinkAutorizacao  → POST .../Send-Link-Authorization-Private-Credit
//      Manda SMS pro cliente autorizar. Cliente faz selfie/aceita no portal.
//   3. autorizacaoSimples     → POST .../Consult-Data-Worker-Simple (so Qi)
//      Alternativa SEM link: corban autoriza pelo cliente (modelo correspondente).
//      Precisa de matricula + cnpj empregador.
//   4. consultarVinculos      → POST .../Consult-Employment-Relationship
//      Retorna vinculos empregaticios elegiveis.
//   5. simular                → POST .../Simulation-Debt-Consigned-Private
//      Gera tabelas com valor liberado + parcelas + taxa.
//   6. criarOperacao          → POST /Api/V1/Operation/Online-Hiring-Private-Credit
//      Cria proposta + retorna URL de formalizacao pro cliente.
//
// Action consolidada `cltCheckEligibility` faz 1+3+4 em sequencia.
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';

function getConfig() {
  const ambiente = (process.env.FINTECH_AMBIENTE || 'PRD').toUpperCase();
  const isPrd = ambiente !== 'HML';
  return {
    ambiente,
    isPrd,
    apiKey: isPrd ? process.env.FINTECH_API_KEY_PRD : process.env.FINTECH_API_KEY_HML,
    login: isPrd ? process.env.FINTECH_LOGIN_PRD : process.env.FINTECH_LOGIN_HML,
    password: isPrd ? process.env.FINTECH_PASSWORD_PRD : process.env.FINTECH_PASSWORD_HML,
    baseUrl: isPrd
      ? 'https://api.fintechdocorban.com.br/super-simples'
      : 'https://api.hml.fintechdocorban.com.br/super-simples'
  };
}

// Cache de token de login (escopo de modulo, reaproveitado entre invocacoes
// na mesma instancia Edge). TTL conservador de 25min.
let _tokenCache = { token: null, exp: 0, ambiente: null };

// Faz login (POST /Api/V1/User/Login) -> access_token. So roda se login/senha
// estiverem configurados. Retorna { token, status, error, raw }.
async function getAccessToken(cfg, force = false) {
  if (!cfg.login || !cfg.password) return { token: null, status: 0, error: 'login/senha nao configurados' };
  const agora = Date.now();
  if (!force && _tokenCache.token && _tokenCache.exp > agora && _tokenCache.ambiente === cfg.ambiente) {
    return { token: _tokenCache.token, status: 200, fromCache: true };
  }
  try {
    // O gateway (Azure APIM) exige a chave Subscription em TODAS as chamadas,
    // INCLUSIVE no login (senao: 401 "missing subscription key").
    const loginHeaders = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
    if (cfg.apiKey) loginHeaders['Subscription'] = cfg.apiKey;
    const r = await fetch(cfg.baseUrl + '/Api/V1/User/Login?saveLog=false', {
      method: 'POST',
      headers: loginHeaders,
      body: JSON.stringify({ login: cfg.login, password: cfg.password })
    });
    const text = await r.text();
    let d; try { d = JSON.parse(text); } catch { d = { raw: text.substring(0, 500) }; }
    if (!r.ok) return { token: null, status: r.status, error: d?.message || d?.mensagem || `Login HTTP ${r.status}`, raw: d };
    const tok = d.access_token || d.accessToken || d.token || d?.result?.access_token || d?.data?.access_token || null;
    if (!tok) return { token: null, status: r.status, error: 'Login OK mas sem access_token', raw: d };
    _tokenCache = { token: tok, exp: agora + 25 * 60 * 1000, ambiente: cfg.ambiente };
    return { token: tok, status: r.status, raw: d };
  } catch (e) {
    return { token: null, status: 0, error: e.message };
  }
}

// Helper: faz request autenticado HIBRIDO (Subscription + Bearer se houver).
async function fc(path, method = 'GET', body = null, _retry = true) {
  const cfg = getConfig();
  if (!cfg.apiKey && !(cfg.login && cfg.password)) {
    return { ok: false, status: 0, data: { error: `Configure FINTECH_API_KEY_${cfg.ambiente} (ou FINTECH_LOGIN_${cfg.ambiente}+FINTECH_PASSWORD_${cfg.ambiente}) no Vercel` } };
  }
  const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers['Subscription'] = cfg.apiKey; // gateway (portal confirma)
  // Bearer via login (se configurado). Falha de login nao bloqueia — segue so com Subscription.
  const auth = await getAccessToken(cfg);
  if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
  const opts = { method, headers };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  try {
    const r = await fetch(cfg.baseUrl + path, opts);
    // 401 com Bearer ativo? token pode ter expirado — re-loga 1x e tenta de novo.
    if (r.status === 401 && _retry && cfg.login && cfg.password) {
      await getAccessToken(cfg, true);
      return fc(path, method, body, false);
    }
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text.substring(0, 1000) }; }
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: e.message } };
  }
}

// Resolve prefixo do provider
function pathPrefix(provider) {
  const p = String(provider || 'qi').toLowerCase();
  if (p === 'celcoin') return '/Api/V1/Celcoin';
  return '/Api/V1/Qi'; // default
}

const j = (data, status = 200, req = null) => jsonResp(data, status, req);

// ══════════════════════════════════════════════════════════════════
// NEMESYS — API interna do PORTAL (fintechdocorban.nossafintech.com.br).
// É onde a simulação de CLT-Celcoin realmente funciona (a API de parceiro
// super-simples devolve "Bancarizadora não suportada"). Auth por login do
// portal (JWE Bearer, expira 12h). Credenciais em env (NUNCA hardcode):
//   FINTECH_PORTAL_LOGIN / FINTECH_PORTAL_PASSWORD  (+ FINTECH_PORTAL_URL opc.)
// Fluxo: Login -> worker-data (margem/workerId) -> comission-table -> simulation
// ══════════════════════════════════════════════════════════════════
const NEMESYS_BASE = (process.env.FINTECH_PORTAL_URL || 'https://fintechdocorban.nossafintech.com.br').replace(/\/$/, '');

// Cabeçalhos de navegador (Chrome) — o WAF Azure do portal exige a "cara" de
// browser (sec-ch-ua / sec-fetch-*) senão barra com 403 mesmo com IP ok.
const SEC_HEADERS = {
  'sec-ch-ua': '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'priority': 'u=1, i',
};

let _nemToken = { token: null, exp: 0 };

// Fetch pro portal que, se houver proxy do escritório configurado
// (FINTECH_PROXY_URL/SECRET — ou reaproveita FACTA_PROXY_URL/SECRET), roteia
// por lá (IP residencial) pra furar o 403 do WAF Azure em IP de data-center.
// Sem proxy, faz fetch direto (comportamento normal). Retorna {status, text}.
async function nemFetch(fullUrl, { method = 'GET', headers = {}, body = null } = {}) {
  const proxyUrl = process.env.FINTECH_PROXY_URL || process.env.FACTA_PROXY_URL;
  const proxySecret = process.env.FINTECH_PROXY_SECRET || process.env.FACTA_PROXY_SECRET;
  if (proxyUrl && proxySecret) {
    const u = new URL(fullUrl);
    const r = await fetch(proxyUrl.replace(/\/$/, '') + '/relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-proxy-key': proxySecret },
      body: JSON.stringify({
        method,
        path: u.pathname + u.search,
        baseUrl: u.origin,
        headers,
        contentType: headers['Content-Type'] || null,
        body: body || null,
      }),
    });
    return { status: r.status, ok: r.ok, text: await r.text() };
  }
  const r = await fetch(fullUrl, { method, headers, body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
  return { status: r.status, ok: r.ok, text: await r.text() };
}

async function nemesysLogin(force = false) {
  // Usa credenciais dedicadas do portal; se não houver, reaproveita as da API
  // de parceiro (FINTECH_LOGIN_PRD/PASSWORD_PRD) — funciona se forem as mesmas.
  const login = process.env.FINTECH_PORTAL_LOGIN || process.env.FINTECH_LOGIN_PRD;
  const password = process.env.FINTECH_PORTAL_PASSWORD || process.env.FINTECH_PASSWORD_PRD;
  if (!login || !password) return { token: null, error: 'Configure FINTECH_PORTAL_LOGIN e FINTECH_PORTAL_PASSWORD no Vercel' };
  const agora = Date.now();
  if (!force && _nemToken.token && _nemToken.exp > agora) return { token: _nemToken.token, fromCache: true };
  try {
    // O portal pode barrar request "pelado" com 403 (WAF). Mandamos com cara de
    // navegador. O cookie app_token (opcional) vem de env, nunca hardcode.
    const appToken = process.env.FINTECH_PORTAL_APP_TOKEN || '';
    const r = await nemFetch(NEMESYS_BASE + '/api/Api/V1/User/Login?saveLog=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Origin': NEMESYS_BASE,
        'Referer': NEMESYS_BASE + '/session/login',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
        ...SEC_HEADERS,
        ...(appToken ? { 'Cookie': `app_token=${appToken}` } : {}),
      },
      body: { Login: login, Password: password, UrlFront: NEMESYS_BASE, OrigemFront: 1 },
    });
    const text = r.text;
    let d; try { d = JSON.parse(text); } catch { d = {}; }
    const tok = d.access_token || String(d.token_bearer || '').replace(/^Bearer\s+/i, '') || null;
    if (!r.ok || !tok) return { token: null, status: r.status, error: d.message || d.mensagem || `login portal HTTP ${r.status}` };
    const ttl = parseInt(d.expires_in) || 43200; // seg (12h)
    _nemToken = { token: tok, exp: agora + Math.max(60, ttl - 600) * 1000 }; // -10min de margem
    return { token: tok };
  } catch (e) { return { token: null, error: e.message }; }
}

// Request autenticado na nemesys. Re-loga 1x em 401.
async function nem(path, method = 'GET', body = null, _retry = true) {
  const auth = await nemesysLogin();
  if (!auth.token) return { ok: false, status: 0, data: { error: auth.error } };
  try {
    const appToken = process.env.FINTECH_PORTAL_APP_TOKEN || '';
    const r = await nemFetch(NEMESYS_BASE + path, {
      method,
      headers: {
        'Authorization': 'Bearer ' + auth.token,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Origin': NEMESYS_BASE,
        'Referer': NEMESYS_BASE + '/home/overview',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
        ...SEC_HEADERS,
        ...(appToken ? { 'Cookie': `app_token=${appToken}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body || null,
    });
    if (r.status === 401 && _retry) { await nemesysLogin(true); return nem(path, method, body, false); }
    const text = r.text;
    let d; try { d = JSON.parse(text); } catch { d = { raw: (text || '').slice(0, 800) }; }
    return { ok: r.ok, status: r.status, data: d };
  } catch (e) { return { ok: false, status: 0, data: { error: e.message } }; }
}

// ══════════════════════════════════════════════════════════════════
// HANDLER
// ══════════════════════════════════════════════════════════════════
export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  try {
    const body = req.method === 'POST' ? await req.json() : {};
    const action = body.action || '';
    const provider = (body.provider || 'qi').toLowerCase();
    const prefix = pathPrefix(provider);

    // ─── DEBUG: baixa o swagger deles pelo backend (Vercel alcança o host) e
    // extrai o schema exato do(s) endpoint(s) de simulação CLT/Celcoin. TEMP.
    if (action === 'swaggerDump') {
      const specUrl = body.specUrl || 'https://api.nossafintech.com.br/swagger/partners/swagger.json';
      let spec;
      try {
        const r = await fetch(specUrl, { headers: { Accept: 'application/json' } });
        spec = await r.json();
      } catch (e) {
        return j({ success: false, erro: 'fetch swagger falhou: ' + e.message, specUrl }, 200, req);
      }
      const paths = spec.paths || {};
      const comps = (spec.components && spec.components.schemas) || spec.definitions || {};
      // resolve $ref -> objeto de schema (1 nível, o suficiente pra ver os campos)
      const resolveRef = (ref) => {
        if (!ref) return null;
        const nome = ref.split('/').pop();
        return comps[nome] || null;
      };
      const descrever = (schema, prof = 0) => {
        if (!schema || prof > 2) return schema && (schema.type || (schema.$ref ? '$ref:' + schema.$ref.split('/').pop() : 'obj'));
        if (schema.$ref) return descrever(resolveRef(schema.$ref), prof + 1);
        if (schema.type === 'array') return [descrever(schema.items, prof + 1)];
        if (schema.properties) {
          const o = {};
          for (const [k, v] of Object.entries(schema.properties)) {
            o[k] = (v.$ref || v.type === 'object' || v.type === 'array') ? descrever(v, prof + 1) : (v.type + (v.format ? `(${v.format})` : '') + (v.enum ? ' enum:' + JSON.stringify(v.enum) : ''));
          }
          return { _required: schema.required || undefined, ...o };
        }
        return schema.type || 'obj';
      };
      // filtra rotas de interesse (Simulation / CLT / Celcoin / Private)
      const rx = new RegExp(body.filtro || 'simulation|celcoin|clt|private|worker', 'i');
      const achados = {};
      for (const [p, defs] of Object.entries(paths)) {
        if (!rx.test(p)) continue;
        for (const [metodo, def] of Object.entries(defs)) {
          if (typeof def !== 'object') continue;
          const key = `${metodo.toUpperCase()} ${p}`;
          const rb = def.requestBody?.content?.['application/json']?.schema
                  || def.requestBody?.content?.['application/*+json']?.schema
                  || (def.parameters && def.parameters.find(x => x.in === 'body')?.schema);
          achados[key] = {
            summary: def.summary || undefined,
            query: (def.parameters || []).filter(x => x.in === 'query').map(x => `${x.name}${x.required ? '*' : ''}:${x.schema?.type || x.type || '?'}`),
            body: rb ? descrever(rb) : undefined,
          };
        }
      }
      return j({ success: true, totalPaths: Object.keys(paths).length, achados }, 200, req);
    }

    // ─── TEST: valida auth (Subscription + login Bearer + endpoint) ──
    if (action === 'test') {
      const cfg = getConfig();
      if (!cfg.apiKey && !(cfg.login && cfg.password)) {
        return j({
          success: false,
          mensagem: `Configure FINTECH_API_KEY_${cfg.ambiente} ou FINTECH_LOGIN_${cfg.ambiente}+FINTECH_PASSWORD_${cfg.ambiente}`,
          ambiente: cfg.ambiente
        }, 200, req);
      }
      // ETAPA 1: login (se configurado) — reporta sem vazar credencial
      let loginInfo = { configurado: !!(cfg.login && cfg.password), ok: false, httpStatus: null, erro: null };
      if (cfg.login && cfg.password) {
        const auth = await getAccessToken(cfg, true);
        loginInfo.ok = !!auth.token;
        loginInfo.httpStatus = auth.status;
        loginInfo.erro = auth.token ? null : (auth.error || null);
      }
      // ETAPA 2: pinga endpoint barato com os headers hibridos
      const r = await fc('/Api/V1/Bank/Get-All', 'GET');
      return j({
        success: r.ok,
        ambiente: cfg.ambiente,
        baseUrl: cfg.baseUrl,
        temSubscriptionKey: !!cfg.apiKey,
        login: loginInfo,
        httpStatus: r.status,
        mensagem: r.ok ? 'API Fintech do Corban autenticada com sucesso' : `Endpoint HTTP ${r.status}`,
        amostra: Array.isArray(r.data) ? r.data.slice(0, 3) : r.data
      }, 200, req);
    }

    // ─── DIAG HEADERS: testa qual nome de header autentica ────
    // 401 com corpo vazio sugere gateway (Azure APIM) — header pode ser
    // 'Ocp-Apim-Subscription-Key' em vez de 'Subscription'. Testa varios.
    if (action === 'testHeaders') {
      const cfg = getConfig();
      if (!cfg.apiKey) return j({ success: false, mensagem: 'chave nao configurada' }, 200, req);
      const variacoes = [
        'Subscription',
        'Ocp-Apim-Subscription-Key',
        'subscription',
        'api-token',
        'Api-Token',
        'X-Subscription-Key',
        'X-Api-Key',
      ];
      const url = cfg.baseUrl + '/Api/V1/Bank/Get-All';
      const resultados = [];
      for (const hname of variacoes) {
        try {
          const r = await fetch(url, { method: 'GET', headers: { [hname]: cfg.apiKey, 'Accept': 'application/json' } });
          resultados.push({ header: hname, status: r.status, ok: r.ok });
        } catch (e) { resultados.push({ header: hname, erro: e.message }); }
      }
      // Tambem testa Authorization: Bearer
      try {
        const r = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Accept': 'application/json' } });
        resultados.push({ header: 'Authorization: Bearer', status: r.status, ok: r.ok });
      } catch (e) { resultados.push({ header: 'Authorization: Bearer', erro: e.message }); }
      const vencedor = resultados.find(x => x.ok);
      return j({
        success: !!vencedor,
        vencedor: vencedor?.header || null,
        keyLen: cfg.apiKey.length, // confirma que a chave nao ta vazia/curta
        resultados,
      }, 200, req);
    }

    // ─── LISTAR TABELAS DE COMISSÃO (as "regras": produto/taxa/prazo) ──
    // GET /Api/V1/CommissionTableCorban/Get-All-To-Partner
    // Endpoint GENÉRICO (nao depende de provider). Tabelas de INSS tem "INSS"
    // no nome. Use ?produto=inss pra filtrar so as tabelas INSS.
    if (action === 'listarTabelas') {
      const r = await fc('/Api/V1/CommissionTableCorban/Get-All-To-Partner', 'GET');
      const d = r.data || {};
      const arr = Array.isArray(d) ? d : (d.result || d.data || d.objResult || []);
      const lista = Array.isArray(arr) ? arr : [];
      const nomeDe = (t) => String(t.nome || t.name || t.descricao || t.description || t.Descricao || '');
      let norm = lista.map((t) => {
        const nome = nomeDe(t);
        const produto = String(t.NomeProduto || t.nomeProduto || '');
        return {
          idTabela: t.idTabela ?? t.IdTabela ?? t.id ?? null,
          idProduto: t.idProduto ?? t.IdProduto ?? t.idTypeOperation ?? null,
          nome,
          isInss: /inss/i.test(nome),
          isFgts: /fgts|saque/i.test(nome + ' ' + produto),
          _raw: t,
        };
      });
      const filtro = String(body.produto || '').toLowerCase().trim();
      if (filtro === 'inss') norm = norm.filter((t) => t.isInss);
      if (filtro === 'fgts') norm = norm.filter((t) => t.isFgts);
      return j({
        success: r.ok,
        httpStatus: r.status,
        total: norm.length,
        tabelasInss: norm.filter((t) => t.isInss).length,
        tabelasFgts: norm.filter((t) => t.isFgts).length,
        tabelas: norm,
        _raw: d,
      }, 200, req);
    }

    // ─── CONSULTAR SALDO/MARGEM DO BENEFICIÁRIO INSS ──────────
    // GET /Api/V1/Operation/Check-Available-Balance?cpf=&typeQuery=
    // typeQuery: 1=QISCD, 2=QIDTVM, 3=J17, 4=BMP. Retorna status pending/completed.
    if (action === 'consultarSaldoInss') {
      const cpf = String(body.cpf || '').replace(/\D/g, '');
      if (cpf.length !== 11) return jsonError('cpf invalido (11 digitos)', 400, req);
      const typeQuery = parseInt(body.typeQuery || 1);
      const r = await fc(`/Api/V1/Operation/Check-Available-Balance?cpf=${cpf}&typeQuery=${typeQuery}`, 'GET');
      const d = r.data || {};
      const dados = d.result || d.data || d.objResult || d;
      return j({
        success: r.ok,
        httpStatus: r.status,
        cpf,
        statusConsulta: (dados && dados.status) || d.status || null,
        dados,
        _raw: d,
      }, 200, req);
    }

    // ─── FGTS: CONSULTAR SALDO NAS BANCARIZADORAS (QI SCD + J17) ──
    // GET /Api/V1/Operation/Check-Available-Balance?cpf=&typeQuery=
    // typeQuery: 1=QISCD, 2=QIDTVM, 3=J17, 4=BMP.
    // O cliente PRECISA ter liberado a instituicao no app FGTS da Caixa
    // (menu Autorizacoes) — sem isso a consulta volta pending/negada.
    // Consulta QI SCD (1) e J17 (3) em paralelo e retorna por instituicao.
    if (action === 'fgtsConsultarSaldo') {
      const cpf = String(body.cpf || '').replace(/\D/g, '');
      if (cpf.length !== 11) return jsonError('cpf invalido (11 digitos)', 400, req);
      // typeQueries customizavel; default QI SCD + J17 (as duas que operamos)
      const tipos = Array.isArray(body.typeQueries) && body.typeQueries.length
        ? body.typeQueries.map(Number)
        : [1, 3];
      const NOMES = { 1: 'QI Sociedade de Crédito Direto', 2: 'QI DTVM', 3: 'J17 SCD', 4: 'BMP' };
      const consultas = await Promise.all(tipos.map(async (tq) => {
        const r = await fc(`/Api/V1/Operation/Check-Available-Balance?cpf=${cpf}&typeQuery=${tq}`, 'GET');
        const d = r.data || {};
        const dados = d.result || d.data || d.objResult || d;
        return {
          typeQuery: tq,
          instituicao: NOMES[tq] || `typeQuery ${tq}`,
          ok: r.ok,
          httpStatus: r.status,
          statusConsulta: (dados && dados.status) || d.status || null,
          dados,
          _raw: d,
        };
      }));
      return j({
        success: consultas.some((c) => c.ok),
        cpf,
        consultas,
      }, 200, req);
    }

    // ─── CONSULTAR POR CPF (lista dados se ja autorizado) ─────
    // GET /Api/V1/{Qi|Celcoin}/Get-All-Consult-Data-Worker-By-Cpf/{cpf}
    if (action === 'consultarPorCPF') {
      const cpf = String(body.cpf || '').replace(/\D/g, '');
      if (!cpf || cpf.length !== 11) return jsonError('cpf invalido (11 digitos)', 400, req);
      const r = await fc(`${prefix}/Get-All-Consult-Data-Worker-By-Cpf/${cpf}`, 'GET');
      // Estrutura: { result/data, success, message } — extracao defensiva
      const d = r.data || {};
      const dados = d.result || d.data || d.objResult || d;
      const lista = Array.isArray(dados) ? dados : (Array.isArray(dados?.items) ? dados.items : []);
      const primeiro = lista[0] || (typeof dados === 'object' && !Array.isArray(dados) ? dados : null);
      return j({
        success: r.ok,
        httpStatus: r.status,
        cpf,
        provider,
        encontrado: !!primeiro,
        registros: lista.length,
        dados: primeiro,
        _raw: d
      }, 200, req);
    }

    // ─── ENVIAR LINK DE AUTORIZAÇÃO VIA SMS ───────────────────
    // POST /Api/V1/{Qi|Celcoin}/Send-Link-Authorization-Private-Credit
    if (action === 'enviarLinkAutorizacao') {
      const cpf = String(body.cpf || body.cpfFuncionario || '').replace(/\D/g, '');
      if (!cpf || cpf.length !== 11) return jsonError('cpf invalido', 400, req);
      const payload = {
        cpfFuncionario: cpf,
        cpfAssinante: cpf, // mesmo cpf assina (modelo simples)
        nomeAssinante: body.nome || '',
        emailAssinante: body.email || `${cpf}@lead.lhamascred.com.br`,
        numeroAssinante: String(body.telefone || '').replace(/\D/g, ''),
        currentUrl: body.currentUrl || (process.env.APP_URL || 'https://flowforce.vercel.app')
      };
      const r = await fc(`${prefix}/Send-Link-Authorization-Private-Credit`, 'POST', payload);
      return j({
        success: r.ok,
        httpStatus: r.status,
        provider,
        mensagem: r.data?.message || r.data?.mensagem || (r.ok ? 'Link enviado por SMS' : 'Falha ao enviar'),
        _raw: r.data
      }, 200, req);
    }

    // ─── AUTORIZAÇÃO SIMPLES (corban autoriza — sem SMS) ──────
    // POST /Api/V1/{Qi|Celcoin}/Consult-Data-Worker-Simple
    // Vale pros dois providers (QI e Celcoin). Precisa cpf + matricula + cnpj.
    if (action === 'autorizacaoSimples') {
      const cpf = String(body.cpf || '').replace(/\D/g, '');
      const matricula = String(body.matricula || body.registrationNumber || '').trim();
      const cnpj = String(body.cnpj || body.employerDocument || '').replace(/\D/g, '');
      if (!cpf || !matricula || !cnpj) {
        return jsonError('cpf, matricula e cnpj sao obrigatorios', 400, req);
      }
      const payload = {
        document_number: cpf,
        registration_number: matricula,
        employer_document_number: cnpj
      };
      const r = await fc(`${prefix}/Consult-Data-Worker-Simple`, 'POST', payload);
      return j({ success: r.ok, httpStatus: r.status, provider, _raw: r.data }, 200, req);
    }

    // ─── CONSULTAR VÍNCULOS EMPREGATÍCIOS ─────────────────────
    // POST /Api/V1/{Qi|Celcoin}/Consult-Employment-Relationship
    // Body: { documentos: [cpf1, cpf2, ...] }
    if (action === 'consultarVinculos') {
      const cpf = String(body.cpf || '').replace(/\D/g, '');
      if (!cpf) return jsonError('cpf obrigatorio', 400, req);
      const r = await fc(`${prefix}/Consult-Employment-Relationship`, 'POST', {
        documentos: [cpf]
      });
      const d = r.data || {};
      const lista = d.result || d.data || d.objResult || (Array.isArray(d) ? d : []);
      return j({
        success: r.ok,
        httpStatus: r.status,
        provider,
        cpf,
        vinculos: Array.isArray(lista) ? lista : [lista].filter(Boolean),
        _raw: d
      }, 200, req);
    }

    // ─── SIMULAR (gera tabelas) ───────────────────────────────
    // POST /Api/V1/{Qi|Celcoin}/Simulation-Debt-Consigned-Private (Qi)
    //       /Api/V1/Celcoin/Simulation-CLT-Celcoin (Celcoin — endpoint diferente!)
    if (action === 'simular') {
      const cpf = String(body.cpf || body.cpfCliente || '').replace(/\D/g, '');
      const workerId = parseInt(body.workerId || 0);
      const dataNasc = body.dataNascimento || body.birthDate || '';
      const genero = String(body.genero || body.sexo || 'M').toUpperCase().charAt(0);
      const tabela = parseInt(body.tabela || body.idCommissionTable || 0);
      const idTipoOperacao = parseInt(body.idTipoOperacao || 1); // 1 = novo (assumido)
      if (!cpf || !workerId || !dataNasc) {
        return jsonError('cpf, workerId e dataNascimento sao obrigatorios', 400, req);
      }
      const payload = {
        data: body.data || {}, // dados livres adicionais
        cpfCliente: cpf,
        workerId,
        dataNascimento: dataNasc,
        genero,
        tabela,
        idTipoOperacao
      };
      // Celcoin tem endpoint proprio (sem 'Debt')
      const endpoint = provider === 'celcoin'
        ? `/Api/V1/Celcoin/Simulation-CLT-Celcoin`
        : `/Api/V1/Qi/Simulation-Debt-Consigned-Private`;
      const qs = tabela ? `?idCommissionTable=${tabela}` : '';
      const r = await fc(endpoint + qs, 'POST', payload);
      return j({
        success: r.ok,
        httpStatus: r.status,
        provider,
        _raw: r.data
      }, 200, req);
    }

    // ─── SIMULAR AUTO: busca tabelas + simula sozinho ────────────
    // Não precisa passar id de tabela: busca as tabelas de comissão, filtra as
    // de CLT/Crédito do Trabalhador e simula em cada uma. Retorna o cru de cada
    // simulação (pra a gente montar o parser + ligar no botão da tela).
    // ─── SIMULAÇÃO VIA PORTAL (NEMESYS) — a que FUNCIONA pro Celcoin CLT ──
    // Login portal -> worker-data (margem+workerId) -> tabela -> simulation.
    // body: { cpf, parcelas(18/24), comSeguro?, installmentValue?/valorParcela? }
    if (action === 'cltSimularPortal') {
      const cpf = String(body.cpf || '').replace(/\D/g, '');
      if (cpf.length !== 11) return jsonError('cpf inválido', 400, req);
      const operationType = parseInt(body.operationType || 96); // 96 = CLT-CELCOIN
      const termMonths = parseInt(body.parcelas || body.termMonths || 18);
      const comSeguro = body.comSeguro !== false; // default: tabela com seguro (1019)

      // 1) Dados do trabalhador (margem + workerId + elegibilidade)
      const wr = await nem(`/api/nemesys/clt/worker-data?cpf=${cpf}&operationType=${operationType}&queryMode=1`);
      const worker = Array.isArray(wr.data?.items) ? wr.data.items[0] : null;
      if (!wr.ok || !worker) {
        return j({ success: false, etapa: 'worker-data', status: wr.status, erro: wr.data?.error, _raw: wr.data }, 200, req);
      }
      const margin = Number(worker.valorMargemDisponivel) || 0;
      if (!worker.elegivel || margin <= 0) {
        return j({
          success: false, elegivel: !!worker.elegivel,
          motivo: worker.motivoIneligibilidade || (margin <= 0 ? 'Sem margem disponível' : 'Inelegível'),
          cliente: { nome: worker.nome, empregador: worker.nomeEmpregador, margem: margin },
        }, 200, req);
      }

      // 2) Tabela de comissão (escolhe com/sem seguro)
      const tr = await nem(`/api/nemesys/fgts/operation/${operationType}/comission-table`);
      const tabelas = Array.isArray(tr.data) ? tr.data : [];
      const tab = tabelas.find((t) => (comSeguro ? t.GeraSeguro : !t.GeraSeguro)) || tabelas[0];
      if (!tab) return j({ success: false, etapa: 'tabelas', _raw: tr.data }, 200, req);

      // 3) Simulação
      const gender = /fem/i.test(String(worker.genero)) ? 'female' : 'male';
      const birthDate = String(worker.dataNascimento || '').slice(0, 10);
      const installmentValue = parseFloat(body.installmentValue || body.valorParcela || margin) || margin;
      const payload = {
        operationType, cpf, workerId: worker.id, birthDate, gender,
        commissionTableId: tab.Id, termMonths, installmentValue, margin,
      };
      const sr = await nem('/api/nemesys/clt/simulation', 'POST', payload);
      const sum = sr.data?.summary || null;
      return j({
        success: sr.ok && !!sum,
        status: sr.status,
        cliente: { nome: worker.nome, empregador: worker.nomeEmpregador, margem: margin },
        tabela: { id: tab.Id, nome: tab.Description, taxaMensal: tab.InterestRate, seguro: !!tab.GeraSeguro },
        resultado: sum ? {
          valorLiberado: sum.disbursedAmount,
          valorFinanciado: sum.financedAmount,
          parcela: sum.installmentValue,
          parcelas: sum.termMonths,
          primeiroVencimento: sum.firstDueDate,
          cetMensal: sum.cetMonthly,
          cetAnual: sum.cetAnnual,
          simulationId: sr.data?.simulationId,
        } : null,
        erro: sum ? null : (sr.data?.Message || sr.data?.message || (Array.isArray(sr.data) ? sr.data.join(' | ') : null)),
        _payloadEnviado: payload,
        _raw: sr.data,
      }, 200, req);
    }

    if (action === 'cltSimularAuto') {
      const cpf = String(body.cpf || body.cpfCliente || '').replace(/\D/g, '');
      if (cpf.length !== 11) return jsonError('cpf invalido (11 digitos)', 400, req);
      const idTipoOperacao = parseInt(body.idTipoOperacao || 1);

      // Resolve workerId/dataNasc/genero: usa o que veio no body, senão BUSCA
      // pelo CPF (Get-All-Consult-Data-Worker) — assim basta passar o CPF.
      let workerId = parseInt(body.workerId || 0);
      let dataNasc = body.dataNascimento || body.birthDate || '';
      let genero = body.genero ? String(body.genero).toUpperCase().charAt(0) : '';
      if (!workerId || !dataNasc || !genero) {
        const wr = await fc(`${prefix}/Get-All-Consult-Data-Worker-By-Cpf/${cpf}`, 'GET');
        const wd = wr.data?.result || wr.data?.data || wr.data || {};
        const lst = Array.isArray(wd) ? wd : (Array.isArray(wd?.items) ? wd.items : []);
        const w = lst[0] || (typeof wd === 'object' && !Array.isArray(wd) ? wd : {});
        if (!workerId) workerId = parseInt(w.Id || w.EmpregadoId || w.IdCadastro || w.id || 0);
        if (!dataNasc) dataNasc = String(w.DataNascimento || w.dataNascimento || '').slice(0, 10);
        if (!genero) genero = /fem/i.test(String(w.GeneroDescricao || '')) ? 'F' : 'M';
      }
      if (!workerId || !dataNasc) {
        return jsonError('Não consegui obter workerId/dataNascimento pelo CPF — cliente precisa estar consultado/autorizado no Fintech do Corban primeiro', 400, req);
      }
      // Valor: a simulação EXIGE valor da parcela OU de desembolso.
      const valorParcela = parseFloat(body.valorParcela || 0) || 0;
      const valorDesembolso = parseFloat(body.valorDesembolso || body.valorLiberado || 0) || 0;
      const parcelas = parseInt(body.parcelas || body.quantidadeParcelas || body.numberOfInstallments || 12);
      // Monta os campos de valor + prazo (tenta nomes PT/EN variados — API mista).
      const vFields = {
        parcelas, quantidadeParcelas: parcelas, numberOfInstallments: parcelas, prazo: parcelas, qtdeParcelas: parcelas,
      };
      if (valorParcela > 0) {
        Object.assign(vFields, { valorParcela, valor_parcela: valorParcela, installmentFaceValue: valorParcela });
      } else if (valorDesembolso > 0) {
        Object.assign(vFields, { valorDesembolso, valor_desembolso: valorDesembolso, valorLiquido: valorDesembolso, disbursedAmount: valorDesembolso, valorSolicitado: valorDesembolso });
      }

      // 1) Tabelas de comissão
      const tabR = await fc('/Api/V1/CommissionTableCorban/Get-All-To-Partner', 'GET');
      const td = tabR.data || {};
      const arr = Array.isArray(td) ? td : (td.result || td.data || td.objResult || []);
      const lista = Array.isArray(arr) ? arr : [];
      const norm = lista.map((t) => ({
        idTabela: t.IdTabela ?? t.idTabela ?? t.id ?? t.Id ?? null,
        idProduto: t.IdProduto ?? t.idProduto ?? null,
        nome: String(t.NomeTabela || t.nome || t.name || ''),
        produto: String(t.NomeProduto || ''),
        maxParcelas: t.MaximoParcelas ?? null,
      })).filter((t) => t.idTabela != null);
      // Dedup por idTabela + filtra CLT/trabalhador/consignado (exclui FGTS/SAQUE/INSS).
      const vistos = new Set();
      const unicas = norm.filter((t) => (vistos.has(t.idTabela) ? false : vistos.add(t.idTabela)));
      const ehCLT = (t) => /clt|trabalhad|consignad|privad/i.test(t.nome + ' ' + t.produto)
        && !/fgts|saque/i.test(t.nome + ' ' + t.produto);
      let candidatas = unicas.filter(ehCLT);
      const semTabelaCLT = candidatas.length === 0;
      if (semTabelaCLT) candidatas = unicas; // fallback: simula nas primeiras pra debug
      candidatas = candidatas.slice(0, 3);

      // 2) Simula em cada tabela candidata.
      // Endpoints CONFIRMADOS na varredura de 06/07: só estas rotas existem
      // (as outras davam 404). O Celcoin ainda responde 409 "Bancarizadora não
      // suportada / Erro de Configuração" = habilitação pendente do lado da
      // Fintech do Corban (chamado aberto). Quando liberarem, esta rota resolve.
      // body.endpoint força outra rota pra debug.
      const candidatosEndpoint = body.endpoint
        ? [body.endpoint]
        : (provider === 'celcoin'
            ? ['/Api/V1/Celcoin/Simulation-CLT-Celcoin']
            : ['/Api/V1/Qi/Simulation-Debt-Consigned-Private']);
      const simulacoes = [];
      for (const t of candidatas) {
        const payload = {
          data: { ...vFields }, cpfCliente: cpf, workerId, dataNascimento: dataNasc, genero,
          tabela: parseInt(t.idTabela) || t.idTabela, idTipoOperacao, ...vFields,
        };
        for (const endpoint of candidatosEndpoint) {
          const sr = await fc(endpoint + `?idCommissionTable=${t.idTabela}`, 'POST', payload);
          simulacoes.push({ idTabela: t.idTabela, nome: t.nome, endpoint, ok: sr.ok, status: sr.status, _raw: sr.data });
          if (sr.ok) break; // achou o endpoint certo pra essa tabela
        }
        // só expõe o payload uma vez (é igual pra todas)
        if (simulacoes.length && !simulacoes[0]._payloadEnviado) simulacoes[0]._payloadEnviado = payload;
      }
      return j({
        success: true, provider, totalTabelas: unicas.length,
        semTabelaCLT,                                  // true = nenhuma tabela CLT achada
        valorEnviado: { valorParcela, valorDesembolso },
        candidatas, simulacoes,
        // Lista compacta de TODAS as tabelas (id + nome + produto) pra identificar as de CLT
        _todasTabelas: unicas.map((t) => ({ id: t.idTabela, produto: t.produto, nome: t.nome })),
      }, 200, req);
    }

    // ─── CRIAR OPERAÇÃO / CONTRATAÇÃO ─────────────────────────
    // POST /Api/V1/Operation/Online-Hiring-Private-Credit
    if (action === 'criarOperacao') {
      const r = await fc('/Api/V1/Operation/Online-Hiring-Private-Credit', 'POST', body.payload || body);
      return j({
        success: r.ok,
        httpStatus: r.status,
        provider,
        propostaId: r.data?.id || r.data?.operationId || r.data?.idOperacao || null,
        linkFormalizacao: r.data?.linkFormalizacao || r.data?.url || r.data?.formalization_url || null,
        _raw: r.data
      }, 200, req);
    }

    // ─── ELEGIBILIDADE CONSOLIDADA (consulta + vinculos + autorizacao) ─
    // Sequencia: 1) consultarPorCPF (ja autorizado?) 2) se nao, consultarVinculos
    // 3) com matricula+cnpj, faz autorizacaoSimples (so QI) 4) consulta de novo
    if (action === 'cltCheckEligibility') {
      const cpf = String(body.cpf || '').replace(/\D/g, '');
      if (!cpf || cpf.length !== 11) return jsonError('cpf invalido', 400, req);

      // 1) Ja temos dados?
      let r1 = await fc(`${prefix}/Get-All-Consult-Data-Worker-By-Cpf/${cpf}`, 'GET');
      let d1 = r1.data?.result || r1.data?.data || r1.data || {};
      let lista1 = Array.isArray(d1) ? d1 : (Array.isArray(d1?.items) ? d1.items : []);

      if (lista1.length > 0) {
        // Ja autorizado — retorna direto
        const primeiro = lista1[0];
        return j({
          success: true,
          provider,
          disponivel: true,
          temVinculo: true,
          cpf,
          jaAutorizado: true,
          dadosWorker: primeiro,
          _raw: { consultarPorCPF: d1 }
        }, 200, req);
      }

      // 2) Consulta vinculos
      const r2 = await fc(`${prefix}/Consult-Employment-Relationship`, 'POST', { documentos: [cpf] });
      const d2 = r2.data?.result || r2.data?.data || r2.data || {};
      const vinculos = Array.isArray(d2) ? d2 : (Array.isArray(d2?.items) ? d2.items : [d2].filter(v => v && typeof v === 'object'));

      if (!r2.ok || vinculos.length === 0) {
        return j({
          success: false,
          provider, cpf,
          disponivel: false,
          temVinculo: false,
          mensagem: 'Sem vinculos CLT elegiveis na Fintech do Corban',
          _raw: { vinculos: d2 }
        }, 200, req);
      }

      const v = vinculos[0];
      const matricula = v.registrationNumber || v.matricula || v.registration_number;
      const cnpj = v.employerDocument || v.cnpj || v.employer_document_number;
      const empregador = v.employerName || v.empregador || v.razao_social;

      // 3) Autorizacao simples (corban autoriza pelo cliente — SEM SMS).
      // Vale pros DOIS providers (QI e Celcoin); o `prefix` já resolve a rota.
      const r3 = await fc(`${prefix}/Consult-Data-Worker-Simple`, 'POST', {
        document_number: cpf,
        registration_number: matricula,
        employer_document_number: cnpj
      });
      const d3 = r3.data || {};

      // 4) Re-consulta dados — agora deve estar populado
      const r4 = await fc(`${prefix}/Get-All-Consult-Data-Worker-By-Cpf/${cpf}`, 'GET');
      const d4 = r4.data?.result || r4.data?.data || r4.data || {};
      const lista4 = Array.isArray(d4) ? d4 : (Array.isArray(d4?.items) ? d4.items : []);
      const primeiro4 = lista4[0] || (typeof d4 === 'object' && !Array.isArray(d4) ? d4 : null);

      return j({
        success: r3.ok && lista4.length > 0,
        provider, cpf,
        disponivel: !!primeiro4,
        temVinculo: true,
        jaAutorizado: false,
        autorizadoAgora: r3.ok,
        vinculo: { matricula, cnpj, empregador },
        dadosWorker: primeiro4,
        _raw: { autorizacao: d3, consultaFinal: d4 }
      }, 200, req);
    }

    // ─── RAW: chamada generica pra explorar API ───────────────
    if (action === 'rawCall') {
      if (!body.path) return jsonError('path obrigatorio', 400, req);
      const r = await fc(body.path, body.method || 'GET', body.body || null);
      return j({ httpStatus: r.status, ok: r.ok, data: r.data }, 200, req);
    }

    return jsonError(
      'action invalida. Disponiveis: test, listarTabelas, consultarSaldoInss, fgtsConsultarSaldo, consultarPorCPF, enviarLinkAutorizacao, autorizacaoSimples, consultarVinculos, simular, criarOperacao, cltCheckEligibility, rawCall',
      400, req
    );
  } catch (err) {
    console.error('fintechdocorban.js erro:', err);
    return j({ error: 'Erro interno', message: err.message || String(err) }, 500, req);
  }
}
