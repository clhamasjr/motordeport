// ══════════════════════════════════════════════════════════════════
// api/fintechdocorban.js — Fintech do Corban (Super Simples)
// Doc oficial: https://docs.fintechdocorban.com.br/
// Swagger: https://api.nossafintech.com.br/swagger/partners/swagger.json
//
// Integrador que da acesso a 2 bancarizadoras CLT:
//  - QI Tech (provider='qi')        → /Api/V1/Qi/*
//  - Celcoin  (provider='celcoin') → /Api/V1/Celcoin/*
//
// AUTH (CORRIGIDO 2026-06-26 — confirmado no Swagger oficial):
//   1) POST /Api/V1/User/Login { login, password } → retorna access_token
//   2) Authorization: Bearer <access_token> em TODAS as requests seguintes
//   (O modelo antigo `Subscription: <api_key>` NUNCA funcionou — 401 sempre,
//    porque a API exige login+senha, nao uma chave avulsa.)
//
// ENV VARS (Vercel):
//   FINTECH_LOGIN_PRD / FINTECH_LOGIN_HML        — email de login do portal
//   FINTECH_PASSWORD_PRD / FINTECH_PASSWORD_HML  — senha do portal
//   FINTECH_AMBIENTE                             — 'PRD' (default) ou 'HML'
//   FINTECH_API_KEY_PRD / FINTECH_API_KEY_HML    — OPCIONAL (gateway APIM);
//       se existir, vai junto como Ocp-Apim-Subscription-Key (belt-and-suspenders)
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
    login: isPrd ? process.env.FINTECH_LOGIN_PRD : process.env.FINTECH_LOGIN_HML,
    password: isPrd ? process.env.FINTECH_PASSWORD_PRD : process.env.FINTECH_PASSWORD_HML,
    apiKey: isPrd ? process.env.FINTECH_API_KEY_PRD : process.env.FINTECH_API_KEY_HML,
    baseUrl: isPrd
      ? 'https://api.fintechdocorban.com.br/super-simples'
      : 'https://api.hml.fintechdocorban.com.br/super-simples'
  };
}

// Cache de token em escopo de modulo (reaproveitado entre invocacoes na mesma
// instancia Edge). Evita logar a cada chamada. TTL conservador de 25min.
let _tokenCache = { token: null, exp: 0, ambiente: null };

// Faz login (POST /Api/V1/User/Login) e devolve access_token (com cache).
// Retorna { token, status, error, raw }.
async function getAccessToken(cfg, force = false) {
  const agora = Date.now();
  if (!force && _tokenCache.token && _tokenCache.exp > agora && _tokenCache.ambiente === cfg.ambiente) {
    return { token: _tokenCache.token, status: 200, fromCache: true };
  }
  if (!cfg.login || !cfg.password) {
    return { token: null, status: 0, error: `FINTECH_LOGIN_${cfg.ambiente}/FINTECH_PASSWORD_${cfg.ambiente} nao configuradas nas env vars do Vercel` };
  }
  try {
    const r = await fetch(cfg.baseUrl + '/Api/V1/User/Login?saveLog=false', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: cfg.login, password: cfg.password })
    });
    const text = await r.text();
    let d; try { d = JSON.parse(text); } catch { d = { raw: text.substring(0, 500) }; }
    if (!r.ok) {
      // 403 = senha expirada (requires_password_update); 401 = credenciais erradas
      return { token: null, status: r.status, error: d?.message || d?.mensagem || `Login HTTP ${r.status}`, raw: d };
    }
    const tok = d.access_token || d.accessToken || d.token || d?.result?.access_token || d?.data?.access_token || null;
    if (!tok) return { token: null, status: r.status, error: 'Login OK mas sem access_token no corpo', raw: d };
    _tokenCache = { token: tok, exp: agora + 25 * 60 * 1000, ambiente: cfg.ambiente };
    return { token: tok, status: r.status, raw: d };
  } catch (e) {
    return { token: null, status: 0, error: e.message };
  }
}

// Helper: faz request autenticado (login→Bearer; relogin automatico em 401).
async function fc(path, method = 'GET', body = null, _retry = true) {
  const cfg = getConfig();
  const auth = await getAccessToken(cfg);
  if (!auth.token) {
    return { ok: false, status: auth.status || 0, data: { error: auth.error || 'Falha no login Fintech do Corban', _raw: auth.raw } };
  }
  const headers = {
    'Authorization': `Bearer ${auth.token}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  };
  // Se houver chave de gateway (APIM), manda junto — alguns ambientes exigem.
  if (cfg.apiKey) headers['Ocp-Apim-Subscription-Key'] = cfg.apiKey;
  const opts = { method, headers };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  try {
    const r = await fetch(cfg.baseUrl + path, opts);
    // Token expirou no meio? Re-loga 1x e tenta de novo.
    if (r.status === 401 && _retry) {
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

    // ─── TEST: valida auth (login → Bearer → endpoint) ────────
    if (action === 'test') {
      const cfg = getConfig();
      // ETAPA 1: login
      const auth = await getAccessToken(cfg, true);
      if (!auth.token) {
        return j({
          success: false,
          etapa: 'login',
          ambiente: cfg.ambiente,
          baseUrl: cfg.baseUrl,
          temLogin: !!cfg.login,
          temSenha: !!cfg.password,
          httpStatus: auth.status,
          mensagem: auth.error || `Login falhou (HTTP ${auth.status})`,
          // dica de diagnostico sem vazar credencial
          _dica: auth.status === 401 ? 'Login/senha incorretos' :
                 auth.status === 403 ? 'Senha expirada — atualize no portal' :
                 (!cfg.login || !cfg.password) ? 'Configure FINTECH_LOGIN_PRD e FINTECH_PASSWORD_PRD no Vercel' : null
        }, 200, req);
      }
      // ETAPA 2: chama um endpoint barato com o Bearer
      const r = await fc('/Api/V1/Bank/Get-All', 'GET');
      return j({
        success: r.ok,
        etapa: r.ok ? 'ok' : 'endpoint',
        ambiente: cfg.ambiente,
        baseUrl: cfg.baseUrl,
        loginOk: true,
        httpStatus: r.status,
        mensagem: r.ok ? 'Login + Bearer OK — API Fintech do Corban autenticada!' : `Login OK, mas endpoint deu HTTP ${r.status}`,
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
        return {
          idTabela: t.idTabela ?? t.IdTabela ?? t.id ?? null,
          idProduto: t.idProduto ?? t.IdProduto ?? t.idTypeOperation ?? null,
          nome,
          isInss: /inss/i.test(nome),
          _raw: t,
        };
      });
      const filtro = String(body.produto || '').toLowerCase().trim();
      if (filtro === 'inss') norm = norm.filter((t) => t.isInss);
      return j({
        success: r.ok,
        httpStatus: r.status,
        total: norm.length,
        tabelasInss: norm.filter((t) => t.isInss).length,
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
    // POST /Api/V1/Qi/Consult-Data-Worker-Simple
    // Precisa cpf + matricula + cnpj empregador (vem de Consult-Employment-Relationship)
    if (action === 'autorizacaoSimples') {
      if (provider !== 'qi') {
        return jsonError('autorizacaoSimples disponivel so pro provider=qi', 400, req);
      }
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

      // 3) Autorizacao simples (so QI tem). Se Celcoin, retorna que precisa link SMS.
      if (provider !== 'qi') {
        return j({
          success: true, provider, cpf,
          disponivel: false, temVinculo: true,
          jaAutorizado: false,
          precisaAutorizacao: true,
          vinculo: { matricula, cnpj, empregador },
          mensagem: 'Vinculo encontrado. Precisa enviar link de autorizacao por SMS pra cliente.'
        }, 200, req);
      }

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
      'action invalida. Disponiveis: test, listarTabelas, consultarSaldoInss, consultarPorCPF, enviarLinkAutorizacao, autorizacaoSimples, consultarVinculos, simular, criarOperacao, cltCheckEligibility, rawCall',
      400, req
    );
  } catch (err) {
    console.error('fintechdocorban.js erro:', err);
    return j({ error: 'Erro interno', message: err.message || String(err) }, 500, req);
  }
}
