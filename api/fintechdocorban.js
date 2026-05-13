// ══════════════════════════════════════════════════════════════════
// api/fintechdocorban.js — Fintech do Corban (Super Simples)
// Doc oficial: https://docs.fintechdocorban.com.br/
// Swagger: https://api.nossafintech.com.br/swagger/partners/swagger.json
//
// Integrador que da acesso a 2 bancarizadoras CLT:
//  - QI Tech (provider='qi')        → /Api/V1/Qi/*
//  - Celcoin  (provider='celcoin') → /Api/V1/Celcoin/*
//
// AUTH:
//   Header `Subscription: <api_key>` em TODAS as requests.
//   Sem Bearer/Login (a API key sozinha autoriza).
//
// ENV VARS (Vercel):
//   FINTECH_API_KEY_PRD  — chave de producao
//   FINTECH_API_KEY_HML  — chave de homologacao
//   FINTECH_AMBIENTE     — 'PRD' (default) ou 'HML'
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
    baseUrl: isPrd
      ? 'https://api.fintechdocorban.com.br/super-simples'
      : 'https://api.hml.fintechdocorban.com.br/super-simples'
  };
}

// Helper: faz request autenticado
async function fc(path, method = 'GET', body = null) {
  const cfg = getConfig();
  if (!cfg.apiKey) {
    return { ok: false, status: 0, data: { error: `FINTECH_API_KEY_${cfg.ambiente} nao configurada nas env vars do Vercel` } };
  }
  const opts = {
    method,
    headers: {
      'Subscription': cfg.apiKey,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  try {
    const r = await fetch(cfg.baseUrl + path, opts);
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

    // ─── TEST: valida auth ────────────────────────────────────
    if (action === 'test') {
      const cfg = getConfig();
      if (!cfg.apiKey) {
        return j({
          success: false,
          mensagem: `FINTECH_API_KEY_${cfg.ambiente} nao configurada`,
          ambiente: cfg.ambiente
        }, 200, req);
      }
      // Pinga um endpoint barato — Get-All bancos (FGTS) — só pra validar key
      const r = await fc('/Api/V1/Bank/Get-All', 'GET');
      return j({
        success: r.ok,
        ambiente: cfg.ambiente,
        baseUrl: cfg.baseUrl,
        httpStatus: r.status,
        mensagem: r.ok ? 'API Fintech do Corban autenticada com sucesso' : `HTTP ${r.status}`,
        amostra: Array.isArray(r.data) ? r.data.slice(0, 3) : r.data
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
      'action invalida. Disponiveis: test, consultarPorCPF, enviarLinkAutorizacao, autorizacaoSimples, consultarVinculos, simular, criarOperacao, cltCheckEligibility, rawCall',
      400, req
    );
  } catch (err) {
    console.error('fintechdocorban.js erro:', err);
    return j({ error: 'Erro interno', message: err.message || String(err) }, 500, req);
  }
}
