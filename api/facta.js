export const config = { runtime: 'edge' };

// ═══════════════════════════════════════════════════════════════
// API FACTA — Proxy Completo v2.0
// ═══════════════════════════════════════════════════════════════

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';

function getConfig() {
  return {
    BASE: (process.env.FACTA_BASE_URL || 'https://webservice-homol.facta.com.br').trim().replace(/\/+$/, ''),
    AUTH: (process.env.FACTA_AUTH || '').trim(),
    // ── BASE OFFLINE CLT (host + credencial DEDICADOS, separados do webservice)
    // Consulta margem/elegibilidade CLT do HISTORICO da FACTA, SEM autorizacao
    // do cliente (sem SMS). 1 CPF/req, intervalo obrigatorio de 3s. So retorna
    // CPF que ja passou por consulta na FACTA antes. Manual v3.0 BASE OFFLINE CLT.
    CLTOFF_BASE: (process.env.FACTA_CLTOFF_BASE_URL || 'https://cltoff.facta.com.br').trim().replace(/\/+$/, ''),
    CLTOFF_AUTH: (process.env.FACTA_CLTOFF_AUTH || '').trim(), // "Basic base64(usuario:senha)" dedicado do cltoff
    LOGIN_CERT: (process.env.FACTA_LOGIN_CERT || '93596').trim(),
    PROXY_URL: (process.env.FACTA_PROXY_URL || '').trim().replace(/\/+$/, ''),
    PROXY_SECRET: (process.env.FACTA_PROXY_SECRET || '').trim(),
    CF_ACCESS_CLIENT_ID: (process.env.CF_ACCESS_CLIENT_ID || '').trim(),
    CF_ACCESS_CLIENT_SECRET: (process.env.CF_ACCESS_CLIENT_SECRET || '').trim(),
    // Padroes da empresa — aplicados a TODA proposta (vendedor e por partner)
    CODIGO_MASTER: (process.env.FACTA_CODIGO_MASTER || '').trim(),
    GERENTE_COMERCIAL: (process.env.FACTA_GERENTE_COMERCIAL || '').trim()
  };
}

// Helper: chama FACTA direto ou via proxy do escritorio (IP autorizado)
// Quando FACTA_PROXY_URL e FACTA_PROXY_SECRET estao setados, repassa pelo proxy.
async function factaFetch(path, { method = 'GET', headers = {}, body = null, contentType = null, baseUrl = null } = {}) {
  const cfg = getConfig();
  if (cfg.PROXY_URL && cfg.PROXY_SECRET) {
    // Rota via proxy do escritorio. baseUrl opcional (ex: cltoff.facta.com.br
    // pra base offline) — precisa estar na allowlist do proxy; sem baseUrl usa FACTA_BASE.
    const payload = { method, path, headers, body, contentType };
    if (baseUrl) payload.baseUrl = baseUrl;
    const fullUrl = cfg.PROXY_URL + '/relay';
    console.log('[factaFetch] via PROXY:', method, path, '->', fullUrl);
    const reqHeaders = {
      'Content-Type': 'application/json',
      'X-Proxy-Key': cfg.PROXY_SECRET,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    };
    // Cloudflare Access Service Token (autentica requisicao Vercel->Proxy no Zero Trust)
    if (cfg.CF_ACCESS_CLIENT_ID && cfg.CF_ACCESS_CLIENT_SECRET) {
      reqHeaders['CF-Access-Client-Id'] = cfg.CF_ACCESS_CLIENT_ID;
      reqHeaders['CF-Access-Client-Secret'] = cfg.CF_ACCESS_CLIENT_SECRET;
    }
    const r = await fetch(fullUrl, {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify(payload)
    });
    console.log('[factaFetch] PROXY resp status:', r.status, 'content-type:', r.headers.get('content-type'));
    return r;
  }
  // Chamada direta (funciona apenas se o IP do Vercel estiver autorizado na FACTA)
  const fwd = { method, headers: { ...headers } };
  if (contentType) fwd.headers['Content-Type'] = contentType;
  if (body !== null && method !== 'GET') fwd.body = typeof body === 'string' ? body : JSON.stringify(body);
  const directBase = baseUrl || cfg.BASE;
  console.log('[factaFetch] DIRETO:', method, directBase + path);
  return fetch(directBase + path, fwd);
}

// Token cache
let _tk = { token: null, exp: 0 };
let _tkOff = { token: null, exp: 0 }; // token da BASE OFFLINE (host cltoff, vale 1h)

async function getToken() {
  if (_tk.token && Date.now() < _tk.exp) return _tk.token;
  const cfg = getConfig();
  if (!cfg.AUTH) throw new Error('FACTA_AUTH nao configurado');
  const r = await factaFetch('/gera-token', { headers: { 'Authorization': cfg.AUTH } });
  const rawText = await r.text();
  let d;
  try { d = JSON.parse(rawText); }
  catch (e) {
    throw new Error('getToken: resposta nao-JSON (status=' + r.status + '): ' + rawText.substring(0, 400));
  }
  if (d.erro === false && d.token) {
    _tk = { token: d.token, exp: Date.now() + 50 * 60 * 1000 };
    return d.token;
  }
  throw new Error(d.mensagem || 'Erro ao gerar token FACTA');
}

// Token da BASE OFFLINE — host e credencial DEDICADOS (cltoff.facta.com.br).
// Basic base64(usuario:senha) -> JWT valido 1h. Cacheia 55min. Roteia pelo
// mesmo proxy do escritorio (IP autorizado) via baseUrl=CLTOFF_BASE.
async function getTokenOffline() {
  if (_tkOff.token && Date.now() < _tkOff.exp) return _tkOff.token;
  const cfg = getConfig();
  if (!cfg.CLTOFF_AUTH) throw new Error('FACTA_CLTOFF_AUTH nao configurado (base offline)');
  const r = await factaFetch('/gera-token', { headers: { 'Authorization': cfg.CLTOFF_AUTH }, baseUrl: cfg.CLTOFF_BASE });
  const rawText = await r.text();
  let d;
  try { d = JSON.parse(rawText); }
  catch (e) {
    throw new Error('getTokenOffline: resposta nao-JSON (status=' + r.status + '): ' + rawText.substring(0, 400));
  }
  if (d.erro === false && d.token) {
    _tkOff = { token: d.token, exp: Date.now() + 55 * 60 * 1000 };
    return d.token;
  }
  throw new Error(d.mensagem || 'Erro ao gerar token FACTA offline');
}

async function fGet(path, params) {
  const token = await getToken();
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const r = await factaFetch(path + qs, { headers: { 'Authorization': 'Bearer ' + token } });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 3000) }; }
  return { ok: r.ok, status: r.status, data: d };
}

async function fPost(path, fields) {
  const token = await getToken();
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null && v !== '') params.append(k, String(v));
  }
  const r = await factaFetch(path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token },
    contentType: 'application/x-www-form-urlencoded',
    body: params.toString()
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 3000) }; }
  return { ok: r.ok, status: r.status, data: d };
}

async function fPostJson(path, body) {
  const token = await getToken();
  const r = await factaFetch(path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token },
    contentType: 'application/json',
    body: JSON.stringify(body)
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 3000) }; }
  return { ok: r.ok, status: r.status, data: d };
}

const j = (data, status = 200, req = null) => jsonResp(data, status, req);

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  // Verificar autenticacao
  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  try {
    const body = req.method === 'POST' ? await req.json() : {};
    const action = body.action || '';
    const cfg = getConfig();

    if (action === 'test') {
      try {
        const token = await getToken();
        return j({ apiActive: true, message: 'API FACTA ativa!', tokenPreview: token.substring(0, 20) + '...' }, 200, req);
      } catch (e) {
        return j({ apiActive: false, message: e.message }, 200, req);
      }
    }

    // ─── CLT: CONSULTA DE APROVAÇÃO (Crédito do Trabalhador) ──────
    // Fluxo (manual v2.0 Consulta Dados CLT):
    //   1) GET /consignado-trabalhador/autoriza-consulta?cpf= → margem se autorizado
    //   2) Se "Token expirado/necessario autorizacao" → POST /solicita-autorizacao-consulta
    //      (SMS/WhatsApp pro cliente; autz vale 30 dias)
    //   3) "virada de folha" → indisponivel temporario (base offline e outro fluxo)
    // Modelo Mercantil/Nossa Fintech (precisa cliente autorizar via SMS).
    if (action === 'cltConsultarAprovacao') {
      const cpf = String(body.cpf || '').replace(/\D/g, '');
      if (!cpf || cpf.length !== 11) return jsonError('cpf invalido', 400, req);

      // 1) Tenta consultar dados (se ja autorizado, retorna margem)
      const cons = await fGet('/consignado-trabalhador/autoriza-consulta', { cpf });
      const cd = cons.data || {};

      // Sucesso: dados do trabalhador com margem
      if (cd.erro === false && cd.dados_trabalhador?.dados?.length > 0) {
        const t = cd.dados_trabalhador.dados[0];
        const margem = parseFloat(t.valorMargemDisponivel || 0) || 0;
        const elegivel = String(t.elegivel).toUpperCase() === 'SIM' || t.elegivel === true || t.elegivel === '1';
        return j({
          etapa: elegivel && margem > 0 ? 'APROVADO' : 'SEM_MARGEM',
          approved: elegivel && margem > 0,
          mensagem: elegivel && margem > 0
            ? `Cliente elegivel — margem R$ ${margem.toFixed(2)}`
            : (elegivel ? 'Elegivel mas sem margem disponivel' : 'Cliente nao elegivel'),
          dadosCliente: {
            nome: t.nome, dataNascimento: t.dataNascimento,
            sexo: String(t.sexo_descricao).toUpperCase().startsWith('F') ? 'F' : 'M',
            nomeMae: t.nomeMae, profissao: t.cbo_descricao,
          },
          vinculo: {
            matricula: t.matricula,
            cnpj: t.numeroInscricaoEmpregador,
            empregador: t.nomeEmpregador,
            dataAdmissao: t.dataAdmissao,
            cnae: t.cnae_descricao,
          },
          margem: {
            disponivel: margem,
            base: parseFloat(t.valorBaseMargem || 0) || 0,
            vencimentos: parseFloat(t.valorTotalVencimentos || 0) || 0,
          },
          _raw: cd,
        }, 200, req);
      }

      const msg = String(cd.mensagem || '').toLowerCase();

      // Virada de folha — usar base offline (fluxo separado, manual v3.0)
      if (msg.includes('virada de folha') || msg.includes('offline')) {
        return j({
          etapa: 'INDISPONIVEL',
          approved: false,
          mensagem: '⏱ FACTA indisponivel (virada de folha). Tente mais tarde.',
          _raw: cd,
        }, 200, req);
      }

      // Precisa autorização — dispara SMS se temos nome+celular
      if (msg.includes('autoriza') || msg.includes('expirado') || cons.status === 401) {
        const nome = String(body.nome || '').trim();
        const celular = String(body.telefone || body.celular || '').replace(/\D/g, '');
        if (!nome || celular.length < 10) {
          return j({
            etapa: 'AGUARDA_AUTORIZACAO',
            approved: false,
            mensagem: 'Cliente precisa autorizar consulta FACTA. Faltam nome/telefone pra disparar SMS.',
            _raw: cd,
          }, 200, req);
        }
        // Formata celular (00) 00000-0000
        const ddd = celular.substring(0, 2);
        const num = celular.substring(2);
        const celFmt = `(${ddd}) ${num.length === 9 ? num.substring(0,5)+'-'+num.substring(5) : num.substring(0,4)+'-'+num.substring(4)}`;
        const sol = await fPost('/solicita-autorizacao-consulta', {
          averbador: '10010',
          nome,
          cpf,
          celular: celFmt,
          tipo_envio: (body.tipoEnvio || 'WHATSAPP').toUpperCase(),
          matricula: body.matricula || undefined,
        });
        const sd = sol.data || {};
        // "Token válido. Não necessita de autorização." = já autorizado, re-consulta
        if (sd.erro === false && /n[aã]o necessita/i.test(sd.mensagem || '')) {
          // Re-tenta consulta imediatamente
          const reCons = await fGet('/consignado-trabalhador/autoriza-consulta', { cpf });
          const rd = reCons.data || {};
          if (rd.erro === false && rd.dados_trabalhador?.dados?.length > 0) {
            const t = rd.dados_trabalhador.dados[0];
            const margem = parseFloat(t.valorMargemDisponivel || 0) || 0;
            return j({
              etapa: margem > 0 ? 'APROVADO' : 'SEM_MARGEM',
              approved: margem > 0,
              mensagem: margem > 0 ? `Cliente elegivel — margem R$ ${margem.toFixed(2)}` : 'Sem margem',
              dadosCliente: { nome: t.nome, dataNascimento: t.dataNascimento, nomeMae: t.nomeMae },
              vinculo: { matricula: t.matricula, cnpj: t.numeroInscricaoEmpregador, empregador: t.nomeEmpregador, dataAdmissao: t.dataAdmissao },
              margem: { disponivel: margem, base: parseFloat(t.valorBaseMargem || 0) || 0 },
              _raw: rd,
            }, 200, req);
          }
        }
        return j({
          etapa: 'AGUARDA_AUTORIZACAO',
          approved: false,
          mensagem: sd.erro === false
            ? '📲 SMS/WhatsApp enviado pro cliente autorizar consulta FACTA (vale 30 dias)'
            : (sd.mensagem || 'Falha ao solicitar autorizacao'),
          _raw: sd,
        }, 200, req);
      }

      // Outro erro
      return j({
        etapa: 'ERRO',
        approved: false,
        mensagem: cd.mensagem || `Erro consulta FACTA (HTTP ${cons.status})`,
        _raw: cd,
      }, 200, req);
    }

    // ─── CLT: CONSULTA BASE OFFLINE (Credito do Trabalhador) ─────
    // Host dedicado cltoff.facta.com.br, credencial propria, SEM autorizacao
    // do cliente (le do historico da FACTA). 1 CPF/req, intervalo de 3s.
    // So retorna CPF que JA foi consultado na FACTA antes; senao "Nenhum dado".
    // Serve pra RE-HIGIENIZAR carteira em massa sem gastar SMS. Normaliza a
    // saida no MESMO formato da cltConsultarAprovacao (o motor reaproveita).
    if (action === 'cltConsultarOffline') {
      const cpf = String(body.cpf || '').replace(/\D/g, '');
      if (!cpf || cpf.length !== 11) return jsonError('cpf invalido', 400, req);
      const cfg = getConfig();

      let token;
      try { token = await getTokenOffline(); }
      catch (e) { return j({ etapa: 'ERRO', approved: false, disponivel: false, retryable: true, mensagem: e.message }, 200, req); }

      const r = await factaFetch('/clt/base-offline?cpf=' + cpf, {
        headers: { 'Authorization': 'Bearer ' + token },
        baseUrl: cfg.CLTOFF_BASE,
      });
      const t = await r.text();
      let d; try { d = JSON.parse(t); } catch { d = { erro: true, mensagem: t.substring(0, 300) }; }
      const msg = String(d.mensagem || '').toLowerCase();

      // Rate limit da FACTA (intervalo de 3s) — retryable
      if (msg.includes('volte em 3') || (msg.includes('indispon') && msg.includes('offline'))) {
        return j({ etapa: 'RATE_LIMIT', approved: false, disponivel: false, retryable: true, mensagem: d.mensagem || 'Base offline: aguarde 3s' }, 200, req);
      }
      // CPF nunca consultado na FACTA — NAO e erro, e "sem historico"
      if (msg.includes('nenhum dado')) {
        return j({ etapa: 'SEM_HISTORICO', approved: false, disponivel: false, mensagem: 'Sem histórico na base offline (CPF nunca consultado na FACTA) — só a consulta online resolve.', _raw: d }, 200, req);
      }

      const arr = Array.isArray(d.dados) ? d.dados : [];
      if (d.erro === false && arr.length > 0) {
        const w = arr[0];
        const margem = parseFloat(w.valorMargemDisponivel || 0) || 0;
        const elegivel = String(w.elegivel).toUpperCase() === 'SIM' || w.elegivel === true || w.elegivel === '1';
        return j({
          etapa: elegivel && margem > 0 ? 'APROVADO' : 'SEM_MARGEM',
          approved: elegivel && margem > 0,
          fonte: 'offline',
          mensagem: elegivel && margem > 0
            ? `Cliente elegivel (base offline) — margem R$ ${margem.toFixed(2)}${w.updated_at ? ` · atualizado ${w.updated_at}` : ''}`
            : (elegivel ? 'Elegivel mas sem margem disponivel (base offline)' : (w.motivoInelegibilidade_descricao || 'Cliente nao elegivel (base offline)')),
          dadosCliente: {
            nome: w.nome, dataNascimento: w.dataNascimento,
            sexo: String(w.sexo_descricao).toUpperCase().startsWith('F') ? 'F' : 'M',
            nomeMae: w.nomeMae, profissao: w.cbo_descricao,
          },
          vinculo: {
            matricula: w.matricula,
            cnpj: w.numeroInscricaoEmpregador,
            empregador: w.nomeEmpregador,
            dataAdmissao: w.dataAdmissao,
            cnae: w.cnae_descricao,
          },
          margem: {
            disponivel: margem,
            base: parseFloat(w.valorBaseMargem || 0) || 0,
            vencimentos: parseFloat(w.valorTotalVencimentos || 0) || 0,
          },
          // frescor do dado offline (pode estar defasado — usar p/ priorizacao)
          frescor: { created_at: w.created_at, updated_at: w.updated_at },
          alertas: w.possuiAlertas || null,
          _raw: d,
        }, 200, req);
      }

      // Erro generico
      return j({ etapa: 'ERRO', approved: false, disponivel: false, retryable: true, mensagem: d.mensagem || `Erro base offline (HTTP ${r.status})`, _raw: d }, 200, req);
    }

    // Diagnostico: mostra env vars + faz ping direto no proxy
    if (action === 'diag') {
      const cfg = getConfig();
      const d = {
        hasProxyUrl: !!cfg.PROXY_URL,
        proxyUrl: cfg.PROXY_URL,
        hasProxySecret: !!cfg.PROXY_SECRET,
        proxySecretLen: cfg.PROXY_SECRET.length,
        hasCfAccessId: !!cfg.CF_ACCESS_CLIENT_ID,
        cfAccessIdPreview: cfg.CF_ACCESS_CLIENT_ID ? cfg.CF_ACCESS_CLIENT_ID.substring(0, 15) + '...' : null,
        hasCfAccessSecret: !!cfg.CF_ACCESS_CLIENT_SECRET,
        cfAccessSecretLen: cfg.CF_ACCESS_CLIENT_SECRET.length,
        factaBase: cfg.BASE,
        hasFactaAuth: !!cfg.AUTH
      };
      // Teste: GET /health do proxy direto (sem relay)
      try {
        const healthUrl = cfg.PROXY_URL + '/health';
        const h = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' };
        if (cfg.CF_ACCESS_CLIENT_ID && cfg.CF_ACCESS_CLIENT_SECRET) {
          h['CF-Access-Client-Id'] = cfg.CF_ACCESS_CLIENT_ID;
          h['CF-Access-Client-Secret'] = cfg.CF_ACCESS_CLIENT_SECRET;
        }
        const r = await fetch(healthUrl, { headers: h });
        const text = await r.text();
        d.healthStatus = r.status;
        d.healthContentType = r.headers.get('content-type');
        d.healthCfRay = r.headers.get('cf-ray');
        d.healthBody = text.substring(0, 500);
      } catch (e) { d.healthError = e.message; }
      return j(d, 200, req);
    }

    // IP de saida do proxy do escritorio (o que a FACTA "ve"). Compara com
    // o IP autorizado no painel FACTA — se mudou, e por isso que da challenge.
    if (action === 'proxyIp') {
      const cfg = getConfig();
      const out = { proxyUrl: cfg.PROXY_URL };
      try {
        const h = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' };
        if (cfg.CF_ACCESS_CLIENT_ID && cfg.CF_ACCESS_CLIENT_SECRET) {
          h['CF-Access-Client-Id'] = cfg.CF_ACCESS_CLIENT_ID;
          h['CF-Access-Client-Secret'] = cfg.CF_ACCESS_CLIENT_SECRET;
        }
        const r = await fetch(cfg.PROXY_URL + '/ip', { headers: h });
        out.status = r.status;
        out.body = (await r.text()).substring(0, 300);
      } catch (e) { out.error = e.message; }
      // Tambem faz o gera-token cru pra ver headers do Cloudflare (cf-ray etc.)
      try {
        const tr = await factaFetch('/gera-token', { headers: { 'Authorization': cfg.AUTH } });
        out.tokenStatus = tr.status;
        // headers repassados pelo proxy (x-upstream-*) = os do Cloudflare da FACTA
        out.upstreamCfRay = tr.headers.get('x-upstream-cf-ray') || null;
        out.upstreamCfMitigated = tr.headers.get('x-upstream-cf-mitigated') || null;
        out.upstreamServer = tr.headers.get('x-upstream-server') || null;
        const tb = await tr.text();
        // Extrai o IP que a FACTA/Cloudflare enxergou (esta na pagina de bloqueio)
        const ipm = tb.match(/id="cf-footer-ip"[^>]*>\s*([0-9a-fA-F:.]+)\s*</);
        out.blockedIpSeenByFacta = ipm ? ipm[1] : null;
        out.tokenBody = tb.substring(0, 120);
      } catch (e) { out.tokenError = e.message; }
      return j(out, 200, req);
    }

    if (action === 'simular') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      if (!cpf) return jsonError('CPF obrigatorio', 400, req);
      const p = { produto: 'D', tipo_operacao: body.tipo_operacao || 13, averbador: body.averbador || 3, convenio: body.convenio || 3, opcao_valor: body.opcao_valor || 1, cpf, data_nascimento: body.data_nascimento || '' };
      if (body.valor) p.valor = body.valor;
      if (body.valor_parcela) p.valor_parcela = body.valor_parcela;
      if (body.prazo) p.prazo = body.prazo;
      if (body.valor_renda) p.valor_renda = body.valor_renda;
      if (body.prazo_restante) p.prazo_restante = body.prazo_restante;
      if (body.saldo_devedor) p.saldo_devedor = body.saldo_devedor;
      if (body.valor_parcela_original) p.valor_parcela_original = body.valor_parcela_original;
      if (body.prazo_original) p.prazo_original = body.prazo_original;
      if (body.contratos_refin) p.contratos_refin = body.contratos_refin;
      if (body.vendedor) p.vendedor = body.vendedor;
      const r = await fGet('/proposta/operacoes-disponiveis', p);
      const d = r.data;
      const resp = { success: d.erro === false, erro: d.erro, mensagem: d.mensagem || null };
      if (d.tabelas_portabilidade) { resp.tabelas_portabilidade = d.tabelas_portabilidade; resp.tabelas_refin_portabilidade = d.tabelas_refin_portabilidade || []; }
      else { resp.tabelas = d.tabelas || []; }
      return j(resp, 200, req);
    }

    if (action === 'contratosRefin') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      if (!cpf) return jsonError('CPF obrigatorio', 400, req);
      const r = await fGet('/proposta/contratos-refinanciamento', { cpf, tipo_operacao: body.tipo_operacao || 14, averbador: 3, convenio: 3 });
      return j({ success: r.data.erro === false, ...r.data }, 200, req);
    }

    if (action === 'etapa1') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      if (!cpf) return jsonError('CPF obrigatorio', 400, req);
      const fields = { produto: 'D', tipo_operacao: body.tipo_operacao || 13, averbador: body.averbador || 3, convenio: body.convenio || 3, cpf, data_nascimento: body.data_nascimento, login_certificado: body.login_certificado || cfg.LOGIN_CERT, codigo_tabela: body.codigo_tabela, prazo: body.prazo, valor_operacao: body.valor_operacao, valor_parcela: body.valor_parcela, coeficiente: body.coeficiente };
      // Vendedor: por partner (frontend envia baseado no user logado)
      if (body.vendedor) fields.vendedor = body.vendedor;
      // Codigo master e gerente: padrao da empresa (env vars) — so usa do body se explicitamente passado
      fields.codigo_master = body.codigo_master || cfg.CODIGO_MASTER || '';
      fields.gerente_comercial = body.gerente_comercial || cfg.GERENTE_COMERCIAL || '';
      if (!fields.codigo_master) delete fields.codigo_master;
      if (!fields.gerente_comercial) delete fields.gerente_comercial;
      if (body.cpf_representante) fields.cpf_representante = body.cpf_representante;
      if (body.nome_representante) fields.nome_representante = body.nome_representante;
      if (body.contratos_refin) fields.contratos_refin = body.contratos_refin;
      if (body.saldo_devedor) fields.saldo_devedor = body.saldo_devedor;
      if (body.prazo_original) fields.prazo_original = body.prazo_original;
      if (body.valor_renda) fields.valor_renda = body.valor_renda;
      const r = await fPost('/proposta/etapa1-simulador', fields);
      return j({ success: r.data.erro === false, ...r.data }, 200, req);
    }

    if (action === 'etapa1RefinPort') {
      if (!body.id_simulador) return jsonError('id_simulador obrigatorio', 400, req);
      const fields = { id_simulador: body.id_simulador, banco_compra: body.banco_compra, contrato_compra: body.contrato_compra, prazo_restante: body.prazo_restante, saldo_devedor: body.saldo_devedor, valor_parcela_original: body.valor_parcela_original, prazo: body.prazo, codigo_tabela: body.codigo_tabela, coeficiente: body.coeficiente, valor_operacao: body.valor_operacao, valor_parcela: body.valor_parcela };
      if (body.vendedor) fields.vendedor = body.vendedor;
      const r = await fPost('/proposta/etapa1-refin-portabilidade', fields);
      return j({ success: r.data.erro === false, ...r.data }, 200, req);
    }

    if (action === 'etapa2') {
      if (!body.id_simulador) return jsonError('id_simulador obrigatorio', 400, req);
      const fields = {};
      for (const [k, v] of Object.entries(body)) { if (k !== 'action' && v !== undefined && v !== null) fields[k] = v; }
      if (fields.cpf) fields.cpf = String(fields.cpf).replace(/\D/g, '');
      const r = await fPost('/proposta/etapa2-dados-pessoais', fields);
      return j({ success: r.data.erro === false, ...r.data }, 200, req);
    }

    if (action === 'etapa3') {
      if (!body.codigo_cliente || !body.id_simulador) return jsonError('codigo_cliente e id_simulador obrigatorios', 400, req);
      const fields = { codigo_cliente: body.codigo_cliente, id_simulador: body.id_simulador };
      if (body.tipo_formalizacao) fields.tipo_formalizacao = body.tipo_formalizacao;
      const r = await fPost('/proposta/etapa3-proposta-cadastro', fields);
      return j({ success: r.data.erro === false, ...r.data }, 200, req);
    }

    if (action === 'enviarLink') {
      if (!body.codigo_af) return jsonError('codigo_af obrigatorio', 400, req);
      const r = await fPost('/proposta/envio-link', { codigo_af: body.codigo_af, tipo_envio: body.tipo_envio || 'whatsapp' });
      return j({ success: r.data.erro === false, ...r.data }, 200, req);
    }

    if (action === 'andamentoPropostas') {
      const p = {};
      const keys = ['af', 'data_ini', 'data_fim', 'data_alteracao_ini', 'data_alteracao_fim', 'convenio', 'averbador', 'cpf', 'pagina', 'quantidade', 'consulta_sub', 'codigo_sub'];
      for (const k of keys) { if (body[k] !== undefined && body[k] !== '') p[k] = body[k]; }
      const r = await fGet('/proposta/andamento-propostas', p);
      return j({ success: r.data.erro === false, ...r.data }, 200, req);
    }

    if (action === 'propostasAtualizadas') {
      const p = {};
      if (body.data_alteracao) p.data_alteracao = body.data_alteracao;
      if (body.consulta_sub) p.consulta_sub = body.consulta_sub;
      if (body.codigo_sub) p.codigo_sub = body.codigo_sub;
      const r = await fGet('/proposta/propostas-atualizadas', p);
      return j({ success: r.data.erro === false, ...r.data }, 200, req);
    }

    if (action === 'consultaOcorrencias') {
      if (!body.af) return jsonError('af obrigatorio', 400, req);
      const r = await fGet('/proposta/consulta-ocorrencias', { af: body.af });
      return j({ success: r.data.erro === false, ...r.data }, 200, req);
    }

    if (action === 'consultaCliente') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      if (!cpf) return jsonError('CPF obrigatorio', 400, req);
      const r = await fGet('/proposta/consulta-cliente', { cpf });
      return j({ success: r.data.erro === false, ...r.data }, 200, req);
    }

    if (action === 'cancelarProposta') {
      if (!body.codigo_af) return jsonError('codigo_af obrigatorio', 400, req);
      const r = await fPostJson('/cancelamento-contrato/solicitacao', { codigo_af: body.codigo_af });
      return j({ success: r.data.erro === false, ...r.data }, 200, req);
    }

    if (action === 'tabelasCoeficientes') {
      if (!body.averbador || !body.tipo_operacao) return jsonError('averbador e tipo_operacao obrigatorios', 400, req);
      const p = { averbador: body.averbador, tipo_operacao: body.tipo_operacao };
      if (body.tabela) p.tabela = body.tabela;
      if (body.prazo) p.prazo = body.prazo;
      if (body.data) p.data = body.data;
      const r = await fGet('/comercial/tabelas-coeficientes', p);
      return j({ success: r.data.erro === false, ...r.data }, 200, req);
    }

    if (action === 'combo') {
      const combo = body.combo || '';
      const valid = ['produto', 'banco', 'tipo-operacao', 'orgao-emissor', 'averbador', 'convenio', 'paises', 'estado', 'cidade', 'estado-civil', 'tipo-beneficio', 'valor-patrimonial', 'tipo-documento', 'tipo-chave-pix', 'gerente-comercial'];
      if (!valid.includes(combo)) return j({ error: 'combo invalido', valid }, 400, req);
      const r = await fGet('/proposta-combos/' + combo, body.params || {});
      return j({ success: r.data.erro === false, ...r.data }, 200, req);
    }

    if (action === 'simulacaoRapida') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      if (!cpf || !body.data_nascimento) return jsonError('CPF e data_nascimento obrigatorios', 400, req);
      const tipoOp = body.tipo_operacao || 13;
      const p = { produto: 'D', tipo_operacao: tipoOp, averbador: 3, convenio: 3, cpf, data_nascimento: body.data_nascimento };
      if ([13, 27, 35, 37].includes(Number(tipoOp))) {
        p.opcao_valor = body.opcao_valor || 1;
        if (body.valor) p.valor = body.valor;
        if (body.valor_parcela) p.valor_parcela = body.valor_parcela;
        if (body.prazo) p.prazo = body.prazo;
      } else if ([14, 49].includes(Number(tipoOp))) {
        p.opcao_valor = 2; p.valor_parcela = body.valor_parcela; p.valor_renda = body.valor_renda; p.contratos_refin = body.contratos_refin; if (body.prazo) p.prazo = body.prazo;
      } else if (Number(tipoOp) === 33) {
        p.opcao_valor = 1; p.valor = body.valor; p.valor_renda = body.valor_renda;
      } else if (String(tipoOp) === '003500') {
        p.opcao_valor = 2; p.valor_parcela = body.valor_parcela; p.prazo = body.prazo; p.prazo_restante = body.prazo_restante; p.saldo_devedor = body.saldo_devedor; p.valor_parcela_original = body.valor_parcela_original; if (body.prazo_original) p.prazo_original = body.prazo_original;
      }
      const r = await fGet('/proposta/operacoes-disponiveis', p);
      const d = r.data;
      return j({ success: d.erro === false, tipo_operacao: tipoOp, tabelas: d.tabelas || undefined, tabelas_portabilidade: d.tabelas_portabilidade || undefined, tabelas_refin_portabilidade: d.tabelas_refin_portabilidade || undefined, mensagem: d.mensagem || null }, 200, req);
    }

    // ═══════════════════════════════════════════════════════════
    // FGTS — ANTECIPAÇÃO SAQUE-ANIVERSÁRIO
    // FACTA expõe FGTS num namespace próprio (/fgts/*). Os paths exatos
    // vêm no manual "FGTS v11.0" (PDF do portal). Aqui usamos os nomes
    // mais prováveis + fallback; use rawCall pra sondar/ajustar ao vivo.
    // Pré-requisito do cliente: saque-aniversário ativo + FACTA autorizada
    // no app FGTS da Caixa.
    // ═══════════════════════════════════════════════════════════

    // Consulta o saldo/base FGTS do cliente. Tenta /fgts/saldo e, se a FACTA
    // devolver erro de rota, cai pra /fgts/consulta-saldo.
    if (action === 'fgtsSaldo') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      if (!cpf) return jsonError('CPF obrigatorio', 400, req);
      let r = await fGet('/fgts/saldo', { cpf });
      const rotaRuim = (x) => x.status === 404 || /rota|endpoint|n[aã]o encontrad|not found/i.test(String(x.data?.mensagem || x.data?.raw || ''));
      if (!r.ok && rotaRuim(r)) {
        r = await fGet('/fgts/consulta-saldo', { cpf });
      }
      const d = r.data || {};
      // Normaliza os nomes mais comuns que a FACTA usa
      const saldo = d.saldo_total ?? d.saldoTotal ?? d.valor_liberado ?? d.saldo ?? null;
      const periodos = d.periodos || d.periods || d.retornoSaldo || d.parcelas || [];
      return j({
        success: d.erro === false && r.ok,
        erro: d.erro,
        mensagem: d.mensagem || null,
        cpf,
        saldoTotal: saldo,
        periodos,
        _raw: d,
      }, 200, req);
    }

    // Tabelas FGTS ativas (produto FGTS)
    if (action === 'fgtsTabelas') {
      let r = await fGet('/fgts/tabelas', {});
      const rotaRuim = (x) => x.status === 404 || /rota|endpoint|n[aã]o encontrad|not found/i.test(String(x.data?.mensagem || x.data?.raw || ''));
      if (!r.ok && rotaRuim(r)) r = await fGet('/fgts/consulta-tabelas', {});
      const d = r.data || {};
      return j({ success: d.erro === false && r.ok, tabelas: d.tabelas || d.tabelas_fgts || [], mensagem: d.mensagem || null, _raw: d }, 200, req);
    }

    // Simulador FGTS — valor liberado (líquido). Precisa cpf + data_nascimento.
    if (action === 'fgtsSimular') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      if (!cpf || !body.data_nascimento) return jsonError('cpf e data_nascimento obrigatorios', 400, req);
      const p = { cpf, data_nascimento: body.data_nascimento };
      if (body.codigo_tabela) p.codigo_tabela = body.codigo_tabela;
      if (body.taxa) p.taxa = body.taxa;
      if (body.parcelas) p.parcelas = body.parcelas;
      let r = await fGet('/fgts/simulador', p);
      const rotaRuim = (x) => x.status === 404 || /rota|endpoint|n[aã]o encontrad|not found/i.test(String(x.data?.mensagem || x.data?.raw || ''));
      if (!r.ok && rotaRuim(r)) r = await fGet('/fgts/simulacao', p);
      const d = r.data || {};
      const liquido = d.valor_liquido ?? d.valorLiquido ?? d.valor_liberado ?? d.valorLiberado ?? null;
      return j({
        success: d.erro === false && r.ok,
        erro: d.erro,
        mensagem: d.mensagem || null,
        valorLiquido: liquido,
        _raw: d,
      }, 200, req);
    }

    // Sondagem genérica (probe) — pra achar/validar o path FGTS certo ao vivo,
    // sem precisar de novo deploy. Ex: { action:'rawCall', method:'GET', path:'/fgts/saldo', params:{cpf} }
    if (action === 'rawCall') {
      if (!body.path) return jsonError('path obrigatorio', 400, req);
      const method = (body.method || 'GET').toUpperCase();
      let r;
      if (method === 'GET') r = await fGet(body.path, body.params || {});
      else if (body.json) r = await fPostJson(body.path, body.body || {});
      else r = await fPost(body.path, body.fields || body.body || {});
      return j({ httpStatus: r.status, ok: r.ok, data: r.data }, 200, req);
    }

    return jsonError('action invalida', 400, req);
  } catch (err) {
    console.error('[FACTA] erro interno:', err?.message, err?.stack);
    return j({
      error: 'Erro interno',
      mensagem: err?.message || 'Erro nao especificado',
      stack: (err?.stack || '').substring(0, 500),
      proxyUsed: !!(getConfig().PROXY_URL && getConfig().PROXY_SECRET),
      proxyUrl: getConfig().PROXY_URL || null,
      factaBase: getConfig().BASE
    }, 500, req);
  }
}
