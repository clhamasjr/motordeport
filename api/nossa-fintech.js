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
function getConfig() {
  return {
    BASE: (process.env.NOSSA_FINTECH_BASE_URL || 'https://nossa-fintech-api.spixiiservices.com.br').trim(),
    CPF: (process.env.NOSSA_FINTECH_CPF || '').trim(),
    PROMOT_ID: parseInt(process.env.NOSSA_FINTECH_PROMOT_ID || '0', 10),
    PASSWORD: (process.env.NOSSA_FINTECH_PASSWORD || '').trim(),
    SERVICE_TYPE: (process.env.NOSSA_FINTECH_SERVICE_TYPE || 'QITECH').trim(),
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
async function checkAutorizacao(cpf) {
  const cfg = getConfig();
  const r = await nfCall('/clt-loan/v1/check-authorization', 'POST', {
    document_number: onlyDigits(cpf),
    service_type: cfg.SERVICE_TYPE,
  });
  return r;
}

// ─── ACTION: requestAutorizacao (envia SMS pro cliente) ───────
async function requestAutorizacao({ cpf, nome, telefone }) {
  const cfg = getConfig();
  const tel = splitPhone(telefone);
  if (!tel) return { ok: false, status: 0, data: { error: 'Telefone invalido' } };
  return await nfCall('/clt-loan/v1/request-authorization', 'POST', {
    document_number: onlyDigits(cpf),
    person_name: (nome || '').trim().toUpperCase(),
    ...tel,
    notification_method: 'sms',
    service_type: cfg.SERVICE_TYPE,
  });
}

// ─── ACTION: checkEnrollment (vinculos empregaticios) ─────────
async function checkEnrollment(cpf) {
  const cfg = getConfig();
  return await nfCall('/clt-loan/v1/check-employee-enrollment', 'POST', {
    document_number: onlyDigits(cpf),
    service_type: cfg.SERVICE_TYPE,
  });
}

// ─── ACTION: getMargem (margem do empregador) ─────────────────
async function getMargem({ cpf, employerDocument }) {
  const cfg = getConfig();
  return await nfCall('/clt-loan/v1/get-margin', 'POST', {
    document_number: onlyDigits(cpf),
    employer_document: onlyDigits(employerDocument),
    service_type: cfg.SERVICE_TYPE,
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
async function consultarAprovacao({ cpf, nome, telefone }) {
  const cpfLimpo = onlyDigits(cpf);
  if (cpfLimpo.length !== 11) return { approved: false, etapa: 'ERRO', error: 'CPF invalido' };

  // 1) Verifica status de autorização
  const auth = await checkAutorizacao(cpfLimpo);
  if (!auth.ok) {
    return {
      approved: false,
      etapa: 'ERRO',
      error: auth.data?.message || `HTTP ${auth.status}`,
      _raw: auth.data,
    };
  }

  const status = auth.data?.data?.status;
  const link = auth.data?.data?.authorization_link;

  // 2) NOT_AUTHORIZED — dispara SMS automaticamente se temos telefone+nome
  if (status === 'NOT_AUTHORIZED') {
    if (!telefone || !nome) {
      return {
        approved: false,
        etapa: 'AGUARDA_AUTORIZACAO',
        status,
        mensagem: 'Cliente não autorizou — operador precisa enviar SMS (faltam nome/telefone)',
      };
    }
    const req = await requestAutorizacao({ cpf: cpfLimpo, nome, telefone });
    const reqStatus = req.data?.data?.status;
    const reqLink = req.data?.data?.authorization_link;
    return {
      approved: false,
      etapa: 'AGUARDA_AUTORIZACAO',
      status: reqStatus || 'PENDING',
      mensagem: '📲 SMS enviado pro cliente autorizar consulta',
      linkAutorizacao: reqLink || link,
    };
  }

  // PENDING — cliente recebeu SMS mas ainda nao autorizou
  if (status === 'PENDING') {
    return {
      approved: false,
      etapa: 'AGUARDA_AUTORIZACAO',
      status,
      mensagem: '⏳ Aguardando cliente autorizar pelo SMS',
      linkAutorizacao: link,
    };
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

  // 3) AUTHORIZED — busca vinculos empregaticios
  const enr = await checkEnrollment(cpfLimpo);
  if (!enr.ok) {
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
  const v = vinculos[0];
  const mg = await getMargem({ cpf: cpfLimpo, employerDocument: v.employer_cnpj });
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

  if (margem === 0 && margemUtilizavel === 0) {
    return {
      approved: false,
      etapa: 'SEM_MARGEM',
      mensagem: 'Cliente sem margem disponivel na Nossa Fintech',
      vinculo: v,
    };
  }

  return {
    approved: true,
    etapa: 'APROVADO',
    status: 'AUTHORIZED',
    mensagem: `Cliente elegivel — margem R$ ${margem.toFixed(2)}`,
    marginKey: m.margin_key,
    vinculo: {
      cnpj: m.employer?.document || v.employer_cnpj,
      empregador: m.employer?.name || v.employer_name,
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
      const r = await nfCall('/clt-loan/v1/banking-institutions', 'GET');
      return jsonResp({
        success: r.ok,
        login: 'ok',
        bancarizadoras: r.data?.data ?? null,
        status: r.status,
      }, 200, req);
    }

    if (action === 'consultarAprovacao' || action === 'consultarStatus') {
      const out = await consultarAprovacao({
        cpf: body.cpf,
        nome: body.nome || body.name,
        telefone: body.telefone || body.phone,
      });
      return jsonResp(out, 200, req);
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
