// ══════════════════════════════════════════════════════════════════
// api/nossa-fintech.js — "A NOSSA FINTECH" (Spixii) Consignado CLT
//
// Provedor: QITECH (vem do GET /banking-institutions — pra Lhamas a
// unica bancarizadora disponivel eh QITECH).
//
// Fluxo de consulta de aprovacao (modelo Mercantil — exige SMS pro
// cliente autorizar consulta DataPrev):
//   1. check-authorization → se AUTHORIZED, pula pro 4
//   2. Se NOT_AUTHORIZED → request-authorization (envia SMS automatico)
//      → card vira BLOQUEADO com precisaAutorizacao+autorizacao_link
//   3. Cliente recebe SMS, autoriza no link, operador clica re-tentar
//   4. check-employee-enrollment → lista de vinculos (work_registration,
//      employer_cnpj, employer_name)
//   5. get-margin (pra cada vinculo) → margem disponivel + dados cliente
//      (nome, dataNasc, sexo, nomeMae, admissao, funcao)
//   6. Retorna ok com margem
//
// Auth: POST /auth/login com {cpf, promot_id, password} → JWT.
// JWT sem `exp` documentado (usamos fallback 4h conservador).
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';

// ── Config ─────────────────────────────────────────────────────
// URL de PRODUÇÃO (doc oficial nossa-fintech-doc.spixiiservices.com.br/docs):
//   https://nossa-fintech-api.spixiiservices.com.br  ← é a produção mesmo.
// (NÃO é teste — a doc só documenta esse endpoint como produção.)
function getConfig() {
  return {
    BASE: (process.env.NOSSA_FINTECH_BASE_URL || 'https://nossa-fintech-api.spixiiservices.com.br').trim(),
    CPF: (process.env.NOSSA_FINTECH_CPF || '').trim(),
    PROMOT_ID: parseInt(process.env.NOSSA_FINTECH_PROMOT_ID || '0', 10),
    PASSWORD: (process.env.NOSSA_FINTECH_PASSWORD || '').trim(),
    SERVICE_TYPE: (process.env.NOSSA_FINTECH_SERVICE_TYPE || 'QITECH').trim(),
    // Geolocalizacao da matriz (Sorocaba/SP) — exigida no authorize.
    // Auto-autz roda "em nome do cliente" (procuracao), igual Handbank/UY3
    // ChallengeInfo. Geo identifica a origem da autorizacao na auditoria.
    LAT: parseFloat(process.env.NOSSA_FINTECH_LAT || '-23.5015'),
    LON: parseFloat(process.env.NOSSA_FINTECH_LON || '-47.4526'),
  };
}

// ── Token cache (JWT, TTL conservador 3.5h) ────────────────────
// Doc nao especifica exp do token — usamos fallback. Se a Nossa Fintech
// confirmar exp via header ou response field, atualizar.
let TOKEN_CACHE = { token: null, expiresAt: 0 };

function decodeJwtExp(token) {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return 0;
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4) payload += '=';
    const json = atob(payload);
    const { exp } = JSON.parse(json);
    return typeof exp === 'number' ? exp * 1000 : 0;
  } catch { return 0; }
}

async function getToken() {
  const now = Date.now();
  if (TOKEN_CACHE.token && TOKEN_CACHE.expiresAt > now + 60_000) {
    return TOKEN_CACHE.token;
  }
  const cfg = getConfig();
  if (!cfg.CPF || !cfg.PASSWORD || !cfg.PROMOT_ID) {
    throw new Error('NOSSA_FINTECH_CPF/PROMOT_ID/PASSWORD nao configurados no ambiente');
  }
  const r = await fetch(cfg.BASE + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cpf: cfg.CPF, promot_id: cfg.PROMOT_ID, password: cfg.PASSWORD }),
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 500) }; }
  if (!r.ok || !d.access_token) {
    throw new Error(`Falha login Nossa Fintech (HTTP ${r.status}): ${d.message || d.error || d.raw || 'sem detalhes'}`);
  }
  const realExp = decodeJwtExp(d.access_token);
  const fallbackTtl = now + (3.5 * 60 * 60 * 1000); // 3.5h conservador
  TOKEN_CACHE = {
    token: d.access_token,
    expiresAt: realExp > 0 ? realExp - 60_000 : fallbackTtl,
  };
  return d.access_token;
}

async function nfCall(path, method = 'GET', body = null) {
  const token = await getToken();
  const cfg = getConfig();
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const r = await fetch(cfg.BASE + path, opts);
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 2000) }; }
  return { ok: r.ok, status: r.status, data: d };
}

function onlyDigits(s) { return String(s || '').replace(/\D/g, ''); }

// Quebra telefone brasileiro em area_code + phone_number (formato Nossa Fintech)
function splitPhone(telefone) {
  const d = onlyDigits(telefone);
  if (d.length < 10 || d.length > 13) return null;
  // Remove +55 / 55 se vier com pais
  let local = d;
  if (local.length === 12 || local.length === 13) {
    if (local.startsWith('55')) local = local.substring(2);
  }
  if (local.length < 10 || local.length > 11) return null;
  return {
    country_code: '55',
    area_code: local.substring(0, 2),
    phone_number: local.substring(2),
  };
}

// ─── ACTION: checkAutorizacao ─────────────────────────────────
async function checkAutorizacao(cpf, serviceType) {
  const cfg = getConfig();
  const r = await nfCall('/clt-loan/v1/check-authorization', 'POST', {
    document_number: onlyDigits(cpf),
    service_type: serviceType || cfg.SERVICE_TYPE,
  });
  return r;
}

// Lista as bancarizadoras habilitadas na conta (QITECH, UY3, ...)
async function bancarizadorasHabilitadas() {
  const r = await nfCall('/clt-loan/v1/banking-institutions', 'GET');
  return Array.isArray(r.data?.data) ? r.data.data : [];
}

// ─── ACTION: requestAutorizacao (envia SMS pro cliente) ───────
async function requestAutorizacao({ cpf, nome, telefone, serviceType }) {
  const cfg = getConfig();
  const tel = splitPhone(telefone);
  if (!tel) return { ok: false, status: 0, data: { error: 'Telefone invalido' } };
  return await nfCall('/clt-loan/v1/request-authorization', 'POST', {
    document_number: onlyDigits(cpf),
    person_name: (nome || '').trim().toUpperCase(),
    ...tel,
    notification_method: 'sms',
    service_type: serviceType || cfg.SERVICE_TYPE,
  });
}

// Extrai o uuid do agreement/termo a partir do authorization_link
// Ex: https://.../clt/termo/{uuid}  ou  .../clt/agreement/{uuid}
function extrairUuidLink(link) {
  if (!link) return null;
  const m = String(link).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0] : null;
}

// ─── ACTION: autorizarConsulta (AUTO-AUTZ, modelo Handbank/UY3) ─
// POST /clt-loan/v1/authorize/{uuid} — autoriza a consulta DataPrev
// programaticamente, sem o cliente clicar no link do SMS. Endpoint
// REAL capturado do trafego do painel (nao adivinhado). Exige
// geolocation no body: {"geolocation":{"latitude","longitude"}}.
// Pressupoe procuracao do cliente (igual ChallengeInfo do Handbank).
async function autorizarConsulta(uuid) {
  if (!uuid) return { ok: false, status: 0, data: { error: 'uuid obrigatorio' } };
  const cfg = getConfig();
  return await nfCall(`/clt-loan/v1/authorize/${uuid}`, 'POST', {
    geolocation: { latitude: cfg.LAT, longitude: cfg.LON },
  });
}

// ─── ACTION: checkEnrollment (vinculos empregaticios) ─────────
// IMPORTANTE: virou ASSINCRONO. 1a chamada retorna success:false com
// "Consulta de vínculos em processamento. Aguarde". Precisa retry ate
// retornar success:true com a lista de vinculos.
async function checkEnrollment(cpf, serviceType, maxTentativas = 5, intervalMs = 3000) {
  const cfg = getConfig();
  let ultima;
  for (let i = 0; i < maxTentativas; i++) {
    ultima = await nfCall('/clt-loan/v1/check-employee-enrollment', 'POST', {
      document_number: onlyDigits(cpf),
      service_type: serviceType || cfg.SERVICE_TYPE,
    });
    if (ultima.ok && ultima.data?.success === true) return ultima;
    // Se a mensagem nao for "em processamento", para (erro real)
    const msg = (ultima.data?.message || '').toLowerCase();
    if (!msg.includes('processamento') && !msg.includes('aguarde')) return ultima;
    if (i < maxTentativas - 1) await new Promise(r => setTimeout(r, intervalMs));
  }
  return ultima;
}

// ─── ACTION: getMargem (margem do empregador) ─────────────────
// IMPORTANTE: agora EXIGE `employee_registration` (matricula vinda do
// check-employee-enrollment via work_registration). A doc publica NAO
// mostra esse campo — descoberto testando a API ao vivo (2026-05-27).
async function getMargem({ cpf, employerDocument, registration, serviceType }) {
  const cfg = getConfig();
  return await nfCall('/clt-loan/v1/get-margin', 'POST', {
    document_number: onlyDigits(cpf),
    employer_document: onlyDigits(employerDocument),
    employee_registration: registration, // matricula (work_registration)
    service_type: serviceType || cfg.SERVICE_TYPE,
  });
}

// ─── ACTION: listarRebates (tabelas de taxa) ──────────────────
async function listarRebates(marginKey) {
  const cfg = getConfig();
  const qs = `?service_type=${encodeURIComponent(cfg.SERVICE_TYPE)}&margin_key=${encodeURIComponent(marginKey)}`;
  return await nfCall('/clt-loan/v1/list-rebates' + qs, 'GET');
}

// ─── ACTION: cancelarProposta ─────────────────────────────────
async function cancelarProposta(debtKey) {
  const cfg = getConfig();
  return await nfCall('/clt-loan/v1/cancel-proposal', 'POST', {
    debt_key: debtKey,
    service_type: cfg.SERVICE_TYPE,
  });
}

// ─── ACTION PRINCIPAL: consultarAprovacao ─────────────────────
// Fluxo end-to-end pro motor de consulta CLT:
//   1. check-authorization → status do consentimento
//   2. Se NOT_AUTHORIZED, dispara SMS (request-authorization)
//   3. Se AUTHORIZED → check-employee-enrollment → get-margin
//
// Output unificado pro card V2:
//   {
//     approved: bool,
//     status: 'AUTHORIZED' | 'PENDING' | 'NOT_AUTHORIZED' | ...,
//     etapa: 'APROVADO' | 'AGUARDA_AUTORIZACAO' | 'SEM_VINCULO' | 'SEM_MARGEM' | 'ERRO',
//     mensagem: string,
//     linkAutorizacao?: string,
//     marginKey?: string,
//     dadosCliente?: {...},
//     vinculo?: {...},
//   }
async function consultarAprovacao({ cpf, nome, telefone, serviceType, autoAutorizar = true }) {
  const cpfLimpo = onlyDigits(cpf);
  if (cpfLimpo.length !== 11) return { approved: false, etapa: 'ERRO', error: 'CPF invalido' };

  const cfg = getConfig();
  const provider = (serviceType || cfg.SERVICE_TYPE).toUpperCase();

  // 0) Bancarizadora habilitada na conta? (QITECH sempre; UY3 só em prod).
  // Se nao habilitada, marca como indisponivel (nao erro) — degrada gracioso
  // pra a homolog (so QITECH) e contas sem UY3.
  const habilitadas = await bancarizadorasHabilitadas();
  if (habilitadas.length && !habilitadas.includes(provider)) {
    return {
      approved: false,
      etapa: 'INDISPONIVEL',
      status: 'NOT_ENABLED',
      mensagem: `Bancarizadora ${provider} não habilitada nesta conta`,
    };
  }

  // 1) Verifica status de autorização
  // A API retorna success:false / HTTP 4xx quando CPF NUNCA teve autorização
  // registrada — semanticamente isso eh "NOT_AUTHORIZED, cria + auto-autz".
  // Outros erros (5xx, mensagem diferente) cai em ERRO real.
  const auth = await checkAutorizacao(cpfLimpo, provider);
  const apiSucesso = auth.ok && auth.data?.success === true;

  let status, link;
  if (apiSucesso) {
    status = auth.data?.data?.status;
    link = auth.data?.data?.authorization_link;
  } else {
    const msg = (auth.data?.message || '').toLowerCase();
    const isNotFound =
      msg.includes('não encontrada') || msg.includes('nao encontrada') ||
      msg.includes('not found') || msg.includes('autorização não') ||
      msg.includes('sem autorização');
    if (!isNotFound) {
      return {
        approved: false,
        etapa: 'ERRO',
        error: auth.data?.message || `HTTP ${auth.status}`,
        _raw: auth.data,
      };
    }
    status = 'NOT_AUTHORIZED';
    link = null;
  }

  // 2) NOT_AUTHORIZED — cria autorização (request-authorization).
  // Isso retorna o link com o uuid do agreement. Em seguida, se
  // autoAutorizar=true, AUTO-AUTORIZA (modelo Handbank/UY3). Senão,
  // fica aguardando o cliente clicar no SMS (modelo Mercantil).
  if (status === 'NOT_AUTHORIZED') {
    if (!telefone || !nome) {
      return {
        approved: false,
        etapa: 'AGUARDA_AUTORIZACAO',
        status,
        mensagem: 'Cliente não autorizou — faltam nome/telefone pra disparar autorização',
      };
    }
    const req = await requestAutorizacao({ cpf: cpfLimpo, nome, telefone, serviceType: provider });
    link = req.data?.data?.authorization_link || link;
    status = req.data?.data?.status || 'PENDING';
  }

  // 3) PENDING — tenta AUTO-AUTORIZAR (bate no /authorize/{uuid}).
  // Se conseguir, status vira AUTHORIZED e segue pra margem.
  // Se nao (ou autoAutorizar=false), retorna aguardando cliente.
  if (status === 'PENDING') {
    const uuid = extrairUuidLink(link);
    if (autoAutorizar && uuid) {
      await autorizarConsulta(uuid);
      // Re-checa status apos auto-autz
      const recheck = await checkAutorizacao(cpfLimpo, provider);
      status = recheck.data?.data?.status || status;
      link = recheck.data?.data?.authorization_link || link;
    }
    if (status !== 'AUTHORIZED') {
      return {
        approved: false,
        etapa: 'AGUARDA_AUTORIZACAO',
        status,
        mensagem: autoAutorizar
          ? '⏳ Autorização disparada — aguardando confirmação DataPrev'
          : '⏳ Aguardando cliente autorizar pelo SMS',
        linkAutorizacao: link,
      };
    }
  }

  if (status !== 'AUTHORIZED') {
    return {
      approved: false,
      etapa: 'ERRO',
      status,
      mensagem: `Status inesperado: ${status}`,
      _raw: auth.data,
    };
  }

  // 3) AUTHORIZED — busca vinculos empregaticios (async, com retry)
  const enr = await checkEnrollment(cpfLimpo, provider);
  if (!enr.ok || enr.data?.success !== true) {
    return {
      approved: false,
      etapa: 'ERRO',
      error: enr.data?.message || `Falha enrollment (HTTP ${enr.status})`,
    };
  }
  const vinculos = enr.data?.data || [];
  if (!Array.isArray(vinculos) || vinculos.length === 0) {
    return {
      approved: false,
      etapa: 'SEM_VINCULO',
      mensagem: 'Cliente sem vinculo CLT elegivel na Nossa Fintech',
    };
  }

  // 4) Pega margem do primeiro vinculo (geralmente o ativo)
  // get-margin EXIGE a matricula (work_registration) via employee_registration
  const v = vinculos[0];
  const mg = await getMargem({
    cpf: cpfLimpo,
    employerDocument: v.employer_cnpj,
    registration: v.work_registration,
    serviceType: provider,
  });
  if (!mg.ok) {
    return {
      approved: false,
      etapa: 'ERRO',
      error: mg.data?.message || `Falha margem (HTTP ${mg.status})`,
      vinculo: v,
    };
  }
  const m = mg.data?.data || {};
  const margem = parseFloat(m.available_balance || 0) || 0;
  const margemUtilizavel = parseFloat(m.utilizable_balance || 0) || 0;

  // Campo novo: can_continue indica se a Nossa Fintech permite seguir.
  // restrictions traz motivos quando bloqueado.
  const restricoes = Array.isArray(m.restrictions) ? m.restrictions : [];
  if (m.can_continue === false) {
    return {
      approved: false,
      etapa: 'SEM_MARGEM',
      mensagem: restricoes.length
        ? `Bloqueado: ${restricoes.map(r => (typeof r === 'string' ? r : (r.message || r.description || JSON.stringify(r)))).join('; ').substring(0, 200)}`
        : 'Cliente nao pode prosseguir na Nossa Fintech (can_continue=false)',
      vinculo: v,
    };
  }

  if (margem === 0 && margemUtilizavel === 0) {
    return {
      approved: false,
      etapa: 'SEM_MARGEM',
      mensagem: 'Cliente sem margem disponivel na Nossa Fintech',
      vinculo: v,
    };
  }

  // GUARD ANTI-DEMO: a conta Spixii ainda devolve dados FICTÍCIOS em alguns
  // casos ("EMPRESA XYZ LTDA", margem R$ 500). Isso é mock do lado deles
  // (conta não ativada pra dados reais) — NÃO mostrar como lead real, senão
  // o operador persegue um cliente que não existe. Marca indisponível com
  // aviso claro. Quando a Spixii ativar dados reais, some sozinho.
  const empNome = String(m.employer?.name || v.employer_name || '');
  if (/empresa\s*xyz/i.test(empNome)) {
    return {
      approved: false,
      etapa: 'INDISPONIVEL',
      status: 'DADOS_DEMO',
      mensagem: 'Conta A NOSSA FINTECH retornando dados de demonstração (EMPRESA XYZ) — pedir ativação de dados reais à Spixii',
      vinculo: v,
    };
  }

  return {
    approved: true,
    etapa: 'APROVADO',
    status: 'AUTHORIZED',
    mensagem: `Cliente elegivel — margem R$ ${margem.toFixed(2)}`,
    marginKey: m.margin_key,
    selectedFundId: m.selected_fund_id ?? null,
    vinculo: {
      cnpj: m.employer?.document || v.employer_cnpj,
      empregador: m.employer?.name || v.employer_name,
      cnae: m.employer?.cnae || null,
      matricula: v.work_registration,
      dataAdmissao: m.admission_date,
    },
    dadosCliente: {
      nome: m.name,
      dataNascimento: m.birth_date,
      sexo: m.gender?.code === 1 ? 'M' : (m.gender?.code === 2 ? 'F' : null),
      nomeMae: m.mother_name,
      profissao: m.job_code?.description,
      categoria: m.worker_category_code,
    },
    margem: {
      disponivel: margem,
      utilizavel: margemUtilizavel,
      base: parseFloat(m.base_margin_value || 0) || 0,
      salarioBruto: m.total_gross_salary != null ? parseFloat(m.total_gross_salary) : null,
    },
  };
}

// ══════════════════════════════════════════════════════════════
// HANDLER
// ══════════════════════════════════════════════════════════════
export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  let body;
  try { body = await req.json(); } catch { return jsonError('JSON invalido', 400, req); }
  const action = body.action || 'test';

  try {
    if (action === 'test') {
      const cfg = getConfig();
      const base = {
        baseUrl: cfg.BASE,
        envBaseUrl: process.env.NOSSA_FINTECH_BASE_URL || '(usando default)',
        temCpf: !!cfg.CPF, temPromotId: !!cfg.PROMOT_ID, temPassword: !!cfg.PASSWORD,
      };
      let r;
      try {
        r = await nfCall('/clt-loan/v1/banking-institutions', 'GET');
      } catch (e) {
        // Login/chamada falhou — reporta config + erro (não estoura 500)
        return jsonResp({
          success: false, login: 'falhou', ...base,
          erro: e.message || String(e),
          _dica: /credenc|401/i.test(e.message || '')
            ? 'Login recusado — confira NOSSA_FINTECH_CPF/PROMOT_ID/PASSWORD.'
            : null,
        }, 200, req);
      }
      return jsonResp({
        success: r.ok, login: 'ok', ...base,
        bancarizadoras: r.data?.data ?? null,               // mostra se UY3 aparece
        status: r.status,
      }, 200, req);
    }

    if (action === 'consultarAprovacao' || action === 'consultarStatus') {
      const out = await consultarAprovacao({
        cpf: body.cpf,
        nome: body.nome || body.name,
        telefone: body.telefone || body.phone,
        serviceType: body.serviceType || body.service_type, // QITECH | UY3
        // autoAutorizar default true (modelo Handbank/UY3). Passar false
        // pra forcar fluxo SMS (cliente clica) se precisar.
        autoAutorizar: body.autoAutorizar !== false,
      });
      return jsonResp(out, 200, req);
    }

    if (action === 'autorizarConsulta') {
      // Auto-autz manual: passa uuid (ou link) do agreement
      const uuid = body.uuid || extrairUuidLink(body.link);
      const r = await autorizarConsulta(uuid);
      return jsonResp({ success: r.ok, uuid, ...r.data }, r.status, req);
    }

    if (action === 'enviarSms') {
      // Pra operador re-enviar SMS manualmente do card
      const r = await requestAutorizacao({
        cpf: body.cpf,
        nome: body.nome,
        telefone: body.telefone,
      });
      return jsonResp({ success: r.ok, ...r.data }, 200, req);
    }

    if (action === 'cancelarProposta') {
      const r = await cancelarProposta(body.debtKey || body.debt_key);
      return jsonResp({ success: r.ok, ...r.data }, 200, req);
    }

    if (action === 'listarRebates') {
      const r = await listarRebates(body.marginKey || body.margin_key);
      return jsonResp({ success: r.ok, ...r.data }, 200, req);
    }

    return jsonError(
      'Action invalida. Validas: test, consultarAprovacao, enviarSms, cancelarProposta, listarRebates',
      400, req
    );
  } catch (e) {
    return jsonError('Erro Nossa Fintech: ' + e.message, 500, req);
  }
}
