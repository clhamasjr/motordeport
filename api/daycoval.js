export const config = { runtime: 'edge' };

// ═══════════════════════════════════════════════════════════════
// API DAYCOVAL — Portabilidade + Refin da Port (INSS)
// Padrao segue api/facta.js. Autenticacao: apikey (empresa) + Login-Usuario (per-user).
// Base URL e api-key em env vars; Login-Usuario vem do body (bank_codes.daycoval do user).
// ═══════════════════════════════════════════════════════════════

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';

function getConfig() {
  return {
    BASE: (process.env.DAYCOVAL_BASE_URL || 'https://apigwsandbox.daycoval.com.br/varejo/consignado').trim().replace(/\/+$/, ''),
    API_KEY: (process.env.DAYCOVAL_API_KEY || '').trim()
  };
}

// Helper unico para todas as chamadas. Daycoval e REST/JSON puro — sem proxy, sem OAuth.
async function dayFetch(loginUsuario, method, path, body) {
  const cfg = getConfig();
  if (!cfg.API_KEY) throw new Error('DAYCOVAL_API_KEY nao configurado');
  if (!loginUsuario) throw new Error('Login-Usuario obrigatorio (bank_codes.daycoval do user logado)');

  const headers = {
    'apikey': cfg.API_KEY,
    'Login-Usuario': loginUsuario,
    'Accept': 'application/json'
  };
  const init = { method, headers };
  if (body !== undefined && body !== null && method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const url = cfg.BASE + path;
  console.log('[daycoval]', method, path);
  const r = await fetch(url, init);
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.substring(0, 3000) }; }
  return { ok: r.ok, status: r.status, data };
}

const j = (data, status = 200, req = null) => jsonResp(data, status, req);

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  // Autenticacao FlowForce
  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  try {
    const body = req.method === 'POST' ? await req.json() : {};
    const action = body.action || '';
    const cfg = getConfig();

    // Login-Usuario obrigatorio em 99% das chamadas (exceto diag/test)
    const lu = (body.loginUsuario || '').trim();

    // ════════════════════════════════════════════════
    // DIAGNOSTICO
    // ════════════════════════════════════════════════
    if (action === 'test' || action === 'diag') {
      const d = {
        apiActive: !!cfg.API_KEY,
        base: cfg.BASE,
        hasApiKey: !!cfg.API_KEY,
        apiKeyLen: cfg.API_KEY.length,
        loginUsuarioInformado: !!lu
      };
      // Ping rapido num endpoint de dominio (barato + sem side-effects)
      if (lu) {
        try {
          const r = await dayFetch(lu, 'GET', '/dominio/sexos');
          d.pingStatus = r.status;
          d.pingOk = r.ok;
          d.pingSample = Array.isArray(r.data) ? r.data.slice(0, 2) : r.data;
        } catch (e) {
          d.pingError = e.message;
        }
      }
      return j(d, 200, req);
    }

    // A partir daqui, Login-Usuario e obrigatorio
    if (!lu) return jsonError('loginUsuario obrigatorio (campo bank_codes.daycoval do user logado)', 400, req);

    // ════════════════════════════════════════════════
    // DOMINIOS (listas estaticas — idealmente cachear no frontend)
    // ════════════════════════════════════════════════
    if (action === 'getBancos')          return ret(await dayFetch(lu, 'GET', '/dominio/bancos'), req);
    if (action === 'getContasBancarias') return ret(await dayFetch(lu, 'GET', '/dominio/contas-bancarias'), req);
    if (action === 'getDocumentosId')    return ret(await dayFetch(lu, 'GET', '/dominio/documentos-identificacao'), req);
    if (action === 'getEstadosCivis')    return ret(await dayFetch(lu, 'GET', '/dominio/estados-civis'), req);
    if (action === 'getNacionalidades')  return ret(await dayFetch(lu, 'GET', '/dominio/nacionalidades'), req);
    if (action === 'getNaturezasRel')    return ret(await dayFetch(lu, 'GET', '/dominio/naturezas-relacionamentos'), req);
    if (action === 'getSexos')           return ret(await dayFetch(lu, 'GET', '/dominio/sexos'), req);
    if (action === 'getUFs')             return ret(await dayFetch(lu, 'GET', '/dominio/unidades-federativas'), req);

    // ════════════════════════════════════════════════
    // PORTABILIDADE — SIMULACAO CLIENTE (passos 1-2 do fluxo)
    // ════════════════════════════════════════════════
    if (action === 'getProdutos') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      if (!cpf) return jsonError('cpf obrigatorio', 400, req);
      return ret(await dayFetch(lu, 'GET', `/port/produtos-disponiveis/${encodeURIComponent(cpf)}`), req);
    }

    if (action === 'cadastrarMatricula') {
      // POST /port/produtos-disponiveis — cadastra nova matricula
      const p = {
        Cpf: (body.cpf || '').replace(/\D/g, ''),
        DataNascimento: body.dataNascimento, // ISO yyyy-MM-ddTHH:mm:ss
        Matricula: body.matricula,
        CodEmpregador: body.codEmpregador    // numerico interno do Portal
      };
      if (!p.Cpf || !p.DataNascimento || !p.Matricula || p.CodEmpregador === undefined || p.CodEmpregador === null || p.CodEmpregador === '') {
        return jsonError('cpf, dataNascimento, matricula e codEmpregador obrigatorios', 400, req);
      }
      return ret(await dayFetch(lu, 'POST', '/port/produtos-disponiveis', p), req);
    }

    if (action === 'getEmpregadores') {
      // Lista os empregadores disponiveis para a Promotora
      return ret(await dayFetch(lu, 'GET', '/port/empregadores'), req);
    }

    // ════════════════════════════════════════════════
    // PORTABILIDADE — SIMULACAO CONSIGNADO (passos 3-7)
    // ════════════════════════════════════════════════
    if (action === 'getEmpregadoresConsig') {
      if (!body.codEmpregadorInterno) return jsonError('codEmpregadorInterno obrigatorio', 400, req);
      return ret(await dayFetch(lu, 'GET', `/port/empregadores-consignados/${body.codEmpregadorInterno}`), req);
    }

    if (action === 'getOrgaos') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      if (!cpf || !body.codEmpregadorExterno) return jsonError('cpf e codEmpregadorExterno obrigatorios', 400, req);
      return ret(await dayFetch(lu, 'GET', `/port/orgaos-consignado/${encodeURIComponent(cpf)}/${encodeURIComponent(body.codEmpregadorExterno)}`), req);
    }

    if (action === 'getPrazos') {
      if (!body.codEmpregadorExterno) return jsonError('codEmpregadorExterno obrigatorio', 400, req);
      return ret(await dayFetch(lu, 'GET', `/port/prazos-consignado/${encodeURIComponent(body.codEmpregadorExterno)}/portabilidade`), req);
    }

    if (action === 'getAverbacao') {
      if (!body.codEmpregador) return jsonError('codEmpregador obrigatorio', 400, req);
      return ret(await dayFetch(lu, 'GET', `/port/parametros-averbacao/portabilidade/${body.codEmpregador}`), req);
    }

    if (action === 'simularPort') {
      // Body inteiro no payload — schema Daycoval.Pcd.Varejo.App.Dto.Signature.Consignado.Simulacao.Portabilidade
      // Esperado: { Cpf, Matricula, DataNascimento, Financiamento, PortabilidadeSimulacao, Origem }
      if (!body.payload) return jsonError('payload obrigatorio', 400, req);
      return ret(await dayFetch(lu, 'POST', '/port/simula-proposta-consignado/portabilidade', body.payload), req);
    }

    // ════════════════════════════════════════════════
    // PORTABILIDADE — INCLUIR SIMULACAO (passo 8)
    // ════════════════════════════════════════════════
    if (action === 'incluirSimulacao') {
      // payload e array de PropostaMatriculaOferta
      if (!body.payload) return jsonError('payload (array) obrigatorio', 400, req);
      return ret(await dayFetch(lu, 'POST', '/port/inclui-simulacoes/portabilidade', body.payload), req);
    }

    // ════════════════════════════════════════════════
    // PORTABILIDADE — CONSULTA PROPOSTA + DADOS (passos 9-10)
    // ════════════════════════════════════════════════
    if (action === 'getProposta') {
      if (!body.codProposta) return jsonError('codProposta obrigatorio', 400, req);
      return ret(await dayFetch(lu, 'GET', `/port/proposta/${body.codProposta}`), req);
    }

    if (action === 'putDadosCadastrais') {
      if (!body.codProposta || !body.payload) return jsonError('codProposta e payload obrigatorios', 400, req);
      return ret(await dayFetch(lu, 'PUT', `/port/cliente/pagamento/${body.codProposta}`, body.payload), req);
    }

    if (action === 'putDadosComplementares') {
      if (!body.codProposta || !body.payload) return jsonError('codProposta e payload obrigatorios', 400, req);
      return ret(await dayFetch(lu, 'PUT', `/port/pagamento/resumo/${body.codProposta}`, body.payload), req);
    }

    if (action === 'getEndereco') {
      const cep = (body.cep || '').replace(/\D/g, '');
      if (!cep) return jsonError('cep obrigatorio', 400, req);
      return ret(await dayFetch(lu, 'GET', `/port/endereco/${cep}`), req);
    }

    if (action === 'getAgentes')      return ret(await dayFetch(lu, 'GET', '/port/agentes'), req);
    if (action === 'getSupervisores') return ret(await dayFetch(lu, 'GET', '/port/supervisores'), req);
    if (action === 'getComerciais')   return ret(await dayFetch(lu, 'GET', '/port/comerciais'), req);

    if (action === 'getFiliais') {
      if (!body.codComercial) return jsonError('codComercial obrigatorio', 400, req);
      return ret(await dayFetch(lu, 'GET', `/port/filiais/${encodeURIComponent(body.codComercial)}`), req);
    }

    if (action === 'getLiberacoes') {
      if (!body.codProposta) return jsonError('codProposta obrigatorio', 400, req);
      return ret(await dayFetch(lu, 'GET', `/port/liberacoes/${body.codProposta}`), req);
    }

    if (action === 'getBancoAgencia') {
      if (!body.codBanco || !body.codAgencia) return jsonError('codBanco e codAgencia obrigatorios', 400, req);
      return ret(await dayFetch(lu, 'GET', `/port/banco-agencia/${body.codBanco}/${body.codAgencia}`), req);
    }

    if (action === 'getBeneficios') {
      if (!body.codEmpregador) return jsonError('codEmpregador obrigatorio', 400, req);
      return ret(await dayFetch(lu, 'GET', `/port/beneficios/${body.codEmpregador}`), req);
    }

    // ════════════════════════════════════════════════
    // PORTABILIDADE — INCLUIR PROPOSTA (passo 11)
    // ════════════════════════════════════════════════
    if (action === 'incluirProposta') {
      // Body schema: Daycoval.Pcd.Varejo.App.Dto.Signature.Consignado.IncluirPropostaSignature
      if (!body.payload) return jsonError('payload obrigatorio', 400, req);
      return ret(await dayFetch(lu, 'POST', '/port/inclui-proposta', body.payload), req);
    }

    if (action === 'incluirPropostaRecalculada') {
      if (!body.payload) return jsonError('payload obrigatorio', 400, req);
      return ret(await dayFetch(lu, 'POST', '/port/inclui-proposta/recalculada', body.payload), req);
    }

    // ════════════════════════════════════════════════
    // REFIN DA PORT (passos 12-13)
    // ════════════════════════════════════════════════
    if (action === 'simularRefinPort') {
      if (!body.payload) return jsonError('payload obrigatorio', 400, req);
      return ret(await dayFetch(lu, 'POST', '/refinport/simula-proposta-consignado/refin-portabilidade', body.payload), req);
    }

    if (action === 'incluirRefinPort') {
      if (!body.payload) return jsonError('payload obrigatorio', 400, req);
      return ret(await dayFetch(lu, 'POST', '/refinport/inclui-proposta/refin-portabilidade', body.payload), req);
    }

    // ════════════════════════════════════════════════
    // FORMALIZACAO (passo 14)
    // ════════════════════════════════════════════════
    if (action === 'formalizar') {
      if (!body.codProposta || !body.telefone) return jsonError('codProposta e telefone obrigatorios', 400, req);
      const tel = String(body.telefone).replace(/\D/g, '');
      return ret(await dayFetch(lu, 'POST', '/port/formaliza/proposta', { CodProposta: body.codProposta, Telefone: tel }), req);
    }

    if (action === 'autorizarBeneficio') {
      // Envia SMS para cliente autorizar consulta INSS
      if (!body.payload) return jsonError('payload obrigatorio', 400, req);
      return ret(await dayFetch(lu, 'POST', '/port/formaliza/autoriza-beneficio', body.payload), req);
    }

    // ════════════════════════════════════════════════
    // CONSULTA STATUS
    // ════════════════════════════════════════════════
    if (action === 'statusSimplificado') {
      if (!body.dataInicio || !body.dataFim) return jsonError('dataInicio e dataFim obrigatorios (yyyy-MM-dd, max 15d)', 400, req);
      return ret(await dayFetch(lu, 'GET', `/port/status-proposta/simplificado/${body.dataInicio}/${body.dataFim}`), req);
    }

    if (action === 'statusDetalhado') {
      if (!body.codProposta) return jsonError('codProposta obrigatorio', 400, req);
      return ret(await dayFetch(lu, 'GET', `/port/status-proposta/detalhado/${body.codProposta}`), req);
    }

    if (action === 'statusSimplificadoPaginada') {
      if (!body.payload) return jsonError('payload obrigatorio', 400, req);
      return ret(await dayFetch(lu, 'POST', '/port/status-proposta/simplificadoPaginada', body.payload), req);
    }

    if (action === 'statusDetalhadoPaginada') {
      if (!body.payload) return jsonError('payload obrigatorio', 400, req);
      return ret(await dayFetch(lu, 'POST', '/port/status-proposta/detalhadoPaginada', body.payload), req);
    }

    // ════════════════════════════════════════════════
    // ESTEIRA (admin/gestor usage)
    // ════════════════════════════════════════════════
    if (action === 'esteiraAprovar' || action === 'esteiraPendenciar' || action === 'esteiraReprovar' || action === 'esteiraCancelar') {
      const map = {
        esteiraAprovar: 'aprovar',
        esteiraPendenciar: 'pendenciar',
        esteiraReprovar: 'reprovar',
        esteiraCancelar: 'cancelar'
      };
      if (!body.payload) return jsonError('payload obrigatorio', 400, req);
      return ret(await dayFetch(lu, 'POST', `/port/aciona-esteira-consignado/${map[action]}`, body.payload), req);
    }

    return jsonError(`action invalida: ${action}`, 400, req);
  } catch (err) {
    console.error('[DAYCOVAL] erro interno:', err?.message, err?.stack);
    return j({
      error: 'Erro interno',
      mensagem: err?.message || 'Erro nao especificado',
      stack: (err?.stack || '').substring(0, 500),
      base: getConfig().BASE
    }, 500, req);
  }
}

// Helper: converte resposta do dayFetch em Response do Vercel
function ret(r, req) {
  // Status 200 para erros nao-fatais (deixa o frontend tratar mensagens do banco)
  // Status 500 apenas se Daycoval retornou 5xx (infra)
  const status = r.status >= 500 ? 500 : 200;
  return jsonResp({ ok: r.ok, status: r.status, data: r.data }, status, req);
}
