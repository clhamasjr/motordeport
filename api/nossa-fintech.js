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
async function checkEnrollment(cpf, serviceType, maxTentativas = 3, intervalMs = 2000) {
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

// ─── ACTION: simularEmprestimo (simulate-loan) ────────────────
// Doc: POST /clt-loan/v1/simulate-loan {margin_key, simulation_type
// (Payment|Liquid), employer_document, requested_amount, cod_tabela,
// service_type} → schedule[] + simulation_key.
async function simularEmprestimo({ marginKey, employerDocument, codTabela, requestedAmount, installmentValue, simulationType, serviceType }) {
  const cfg = getConfig();
  const body = {
    margin_key: marginKey,
    employer_document: onlyDigits(employerDocument || ''),
    cod_tabela: codTabela,
    simulation_type: simulationType || (installmentValue ? 'Payment' : 'Liquid'),
    service_type: serviceType || cfg.SERVICE_TYPE,
  };
  if (installmentValue) body.installment_value = installmentValue;
  if (requestedAmount) body.requested_amount = requestedAmount;
  return await nfCall('/clt-loan/v1/simulate-loan', 'POST', body);
}

// ─── ACTION: submeterProposta (submit-proposal = digitação) ───
// Doc: POST /clt-loan/v1/submit-proposal {simulation_key, service_type,
// client{...}}. Em homolog o cliente é JOÃO SILVA — dados podem ser dummy.
async function submeterProposta({ simulationKey, cpf, dados, telefone, serviceType }) {
  const cfg = getConfig();
  const d = dados || {};
  const tel = onlyDigits(telefone || d.telefone || '11999999999');
  const client = {
    document_number: onlyDigits(cpf || ''),
    person_name: d.person_name || d.nome || 'JOAO SILVA',
    mother_name: d.mother_name || d.nomeMae || 'MARIA SILVA',
    birth_date: d.birth_date || d.dataNascimento || '1990-01-01',
    profession: d.profession || d.profissao || 'Analista',
    nationality: d.nationality || 'Brasileira',
    marital_status: d.marital_status || 'single',
    gender: d.gender || (d.sexo === 'F' ? 'FEMALE' : 'MALE'),
    email: d.email || `${onlyDigits(cpf || '')}@lead.lhamascred.com.br`,
    country_code: d.country_code || '55',
    area_code: (tel.length >= 10 ? tel.slice(0, 2) : '11'),
    phone_number: (tel.length >= 10 ? tel.slice(2) : tel),
    postal_code: d.postal_code || '18010000',
    street: d.street || 'Rua Teste',
    number: d.number || '100',
    neighborhood: d.neighborhood || 'Centro',
    city: d.city || 'Sorocaba',
    state: d.state || 'SP',
    bank_account: d.bank_account || { pix_key: onlyDigits(cpf || ''), pix_key_type: 'CPF' },
    ...(d.clientExtra || {}),
  };
  return await nfCall('/clt-loan/v1/submit-proposal', 'POST', {
    simulation_key: simulationKey,
    service_type: serviceType || cfg.SERVICE_TYPE,
    client,
  });
}

// ─── ACTION: detalhes da operação (acompanhar até Desembolsado) ─
async function getOperationDetails(debtKey) {
  const cfg = getConfig();
  return await nfCall(`/clt-loan/v1/get-operation-details/${debtKey}?service_type=${encodeURIComponent(cfg.SERVICE_TYPE)}`, 'GET');
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
async function consultarAprovacao({ cpf, nome, telefone, serviceType, autoAutorizar = true, forcar = false }) {
  const cpfLimpo = onlyDigits(cpf);
  if (cpfLimpo.length !== 11) return { approved: false, etapa: 'ERRO', error: 'CPF invalido' };

  const cfg = getConfig();
  const provider = (serviceType || cfg.SERVICE_TYPE).toUpperCase();

  // 0) Bancarizadora habilitada na conta? (QITECH sempre; UY3 só em prod).
  // Se nao habilitada, marca como indisponivel (nao erro) — degrada gracioso
  // pra a homolog (so QITECH) e contas sem UY3.
  // `forcar:true` PULA esse gate — pra testar UY3 direto quando a conta
  // diz que tem UY3 mas /banking-institutions nao lista (quirk da Spixii).
  const habilitadas = forcar ? [] : await bancarizadorasHabilitadas();
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

  // 3) AUTHORIZED — busca vinculos empregaticios (async, com retry).
  // Esse passo pode demorar do lado da Spixii. Se ainda estiver "em
  // processamento" depois das tentativas rapidas, NAO estoura timeout/erro —
  // retorna PROCESSANDO_VINCULOS (retry-able), e a re-checagem (status/operador)
  // pega quando ficar pronto. Evita o "Timeout 18s — banco lento".
  const enr = await checkEnrollment(cpfLimpo, provider);
  if (!enr.ok || enr.data?.success !== true) {
    const msgEnr = String(enr.data?.message || '').toLowerCase();
    if (msgEnr.includes('processamento') || msgEnr.includes('aguarde')) {
      return {
        approved: false,
        etapa: 'PROCESSANDO_VINCULOS',
        status: 'PROCESSING',
        mensagem: '⏳ Consultando vínculos na Nossa Fintech — aguarde, re-checando...',
      };
    }
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

    // ─── DIAGNÓSTICO: roda o fluxo inteiro e mostra o cru de cada etapa ──
    // Investigação completa pra UM cpf: login → bancarizadoras → check-auth →
    // (request-auth) → (authorize) → enrollment → get-margin. Mostra status +
    // dados crus de cada passo, e detecta dado demo (EMPRESA XYZ).
    if (action === 'diagnostico') {
      const cpf = onlyDigits(body.cpf);
      const provider = (body.serviceType || body.service_type || getConfig().SERVICE_TYPE).toUpperCase();
      if (cpf.length !== 11) return jsonError('cpf invalido (11 digitos)', 400, req);
      const passos = {};

      // 1) bancarizadoras habilitadas
      const bi = await nfCall('/clt-loan/v1/banking-institutions', 'GET');
      passos['1_bancarizadoras'] = { status: bi.status, habilitadas: bi.data?.data ?? bi.data };

      // 2) check-authorization
      const ca = await checkAutorizacao(cpf, provider);
      passos['2_check_auth'] = { status: ca.status, data: ca.data };
      const statusAutz = ca.data?.data?.status || (ca.data?.success ? 'OK' : 'NOT_AUTHORIZED');

      // 3) enrollment (vínculos)
      const enr = await checkEnrollment(cpf, provider);
      passos['3_enrollment'] = { status: enr.status, success: enr.data?.success, message: enr.data?.message, vinculos: enr.data?.data };

      // 4) get-margin (primeiro vínculo, se houver)
      const vincs = Array.isArray(enr.data?.data) ? enr.data.data : [];
      if (vincs.length > 0) {
        const v0 = vincs[0];
        const mg = await getMargem({ cpf, employerDocument: v0.employer_cnpj, registration: v0.work_registration, serviceType: provider });
        const m = mg.data?.data || {};
        passos['4_margem'] = {
          status: mg.status,
          available_balance: m.available_balance,
          base_margin_value: m.base_margin_value,
          empregador: m.employer?.name,
          can_continue: m.can_continue,
          restrictions: m.restrictions,
          ehDemo: /empresa\s*xyz/i.test(String(m.employer?.name || '')),
          _raw: mg.data,
        };
      }

      return jsonResp({
        success: true,
        cpf, provider,
        statusAutorizacao: statusAutz,
        passos,
        veredito: passos['4_margem']
          ? (passos['4_margem'].ehDemo ? 'CONTA EM DEMO (EMPRESA XYZ) — pedir ativação real à Spixii'
             : passos['4_margem'].available_balance != null ? 'DADOS REAIS retornando' : 'sem margem')
          : 'não chegou na margem (ver passos)',
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
        forcar: body.forcar === true, // pula gate de bancarizadora (teste UY3)
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

    // Passos individuais (pra iterar a certificação)
    if (action === 'simular') {
      const r = await simularEmprestimo({
        marginKey: body.marginKey || body.margin_key,
        employerDocument: body.employerDocument || body.employer_document,
        codTabela: body.codTabela || body.cod_tabela,
        requestedAmount: body.requestedAmount || body.requested_amount || body.valor,
        installmentValue: body.installmentValue || body.installment_value,
        simulationType: body.simulationType,
      });
      return jsonResp({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }
    if (action === 'digitar' || action === 'submeter') {
      const r = await submeterProposta({
        simulationKey: body.simulationKey || body.simulation_key,
        cpf: body.cpf, dados: body.dados, telefone: body.telefone,
      });
      return jsonResp({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }
    if (action === 'statusOperacao') {
      const r = await getOperationDetails(body.debtKey || body.debt_key);
      return jsonResp({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    // ─── CERTIFICAÇÃO HOMOLOG (o que a Spixii pediu p/ liberar produção) ──
    // Roda o fluxo INTEIRO via API e loga cada passo. modo:'cancelar' faz
    // criar→cancelar; modo:'desembolsar' (default) segue até o fim.
    if (action === 'certificar') {
      const cfg = getConfig();
      const sType = cfg.SERVICE_TYPE;
      const cpf = onlyDigits(body.cpf || '');
      const nome = body.nome || 'JOAO SILVA';
      const telefone = onlyDigits(body.telefone || '11999999999');
      const valor = parseFloat(body.valor || 300) || 300;
      const modo = body.modo || 'desembolsar';
      const passos = [];
      const add = (p, r, extra) => { passos.push({ passo: p, http: r?.status, ok: r?.ok, ...(extra || {}), _raw: r?.data }); return r; };

      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

      // 1) Bancarizadora
      add('banking-institutions', await nfCall('/clt-loan/v1/banking-institutions', 'GET'));

      // 2) Autorização — trata 404 "não encontrada" como NÃO autorizado.
      let ca = add('check-authorization', await checkAutorizacao(cpf, sType));
      let status = ca.data?.data?.status || (ca.status === 404 ? 'NOT_AUTHORIZED' : null);
      let link = ca.data?.data?.authorization_link;
      if (status !== 'AUTHORIZED') {
        const rq = add('request-authorization', await requestAutorizacao({ cpf, nome, telefone, serviceType: sType }));
        link = rq.data?.data?.authorization_link || link;
        const uuid = extrairUuidLink(link);
        if (uuid) add('authorize', await autorizarConsulta(uuid));
        // re-checa até virar AUTHORIZED (homolog costuma confirmar na hora)
        for (let i = 0; i < 3; i++) {
          const rc = add(`check-authorization#${i + 2}`, await checkAutorizacao(cpf, sType));
          status = rc.data?.data?.status || status;
          if (status === 'AUTHORIZED') break;
          await sleep(1500);
        }
      }

      // 3) Enrollment → vínculo (matrícula + CNPJ empregador)
      const enr = add('check-employee-enrollment', await checkEnrollment(cpf, sType));
      const vincs = Array.isArray(enr.data?.data) ? enr.data.data : [];
      const v = vincs.find((x) => x && (x.eligible !== false)) || vincs[0] || {};

      // 4) Margem
      const mg = add('get-margin', await getMargem({ cpf, employerDocument: v.employer_cnpj, registration: v.work_registration, serviceType: sType }));
      const m = mg.data?.data || {};
      const marginKey = m.margin_key;
      const employerDoc = m.employer?.document || v.employer_cnpj;
      // dados do cliente vindos da margem (homolog: JOÃO SILVA) p/ o submit
      const dadosCliente = {
        nome: m.person_name || m.name || nome,
        nomeMae: m.mother_name,
        dataNascimento: m.birth_date,
        sexo: m.gender?.code === 2 || m.gender?.code === '2' ? 'F' : 'M',
        telefone,
      };

      // 5) Rebates → cod_tabela (escolhe a tabela cuja faixa cobre o valor)
      const rb = add('list-rebates', await listarRebates(marginKey));
      const tabelas = Array.isArray(rb.data?.data) ? rb.data.data : (Array.isArray(rb.data) ? rb.data : []);
      const tab = tabelas.find((t) => valor >= parseFloat(t.start || 0) && valor <= parseFloat(t.end || 1e9)) || tabelas[0] || {};
      const codTabela = tab.cod_tabela || tab.rebate_code || tab.code || tab.id;

      // 6) Simular (só se temos margin_key — senão a API 400 e não adianta)
      let simKey = null;
      if (marginKey) {
        const sim = add('simulate-loan', await simularEmprestimo({ marginKey, employerDocument: employerDoc, codTabela, requestedAmount: valor, serviceType: sType }));
        simKey = sim.data?.data?.simulation_key || sim.data?.simulation_key || sim.data?.data?.key;
      } else {
        add('simulate-loan', { ok: false, status: 0, data: { skipped: 'sem margin_key (etapa anterior falhou)' } });
      }

      // PREP: para aqui e devolve o necessário p/ digitar em chamada
      // separada (evita 504 — submit real é lento e não cabe na mesma request).
      if (modo === 'prep') {
        return jsonResp({ success: true, modo, marginKey, employerDoc, codTabela, simKey, cliente: dadosCliente, passos }, 200, req);
      }

      // 7) Submeter (digitar)
      let debtKey = null;
      if (simKey) {
        const sub = add('submit-proposal', await submeterProposta({ simulationKey: simKey, cpf, dados: dadosCliente, telefone, serviceType: sType }));
        debtKey = sub.data?.data?.debt_key || sub.data?.debt_key || sub.data?.data?.num_contrato;
      } else {
        add('submit-proposal', { ok: false, status: 0, data: { skipped: 'sem simulation_key' } });
      }
      // 8) Cancelar OU acompanhar até desembolsado
      if (modo === 'cancelar') {
        if (debtKey) add('cancel-proposal', await cancelarProposta(debtKey));
      } else if (debtKey) {
        for (let i = 0; i < 4; i++) {
          const op = add(`get-operation-details#${i + 1}`, await getOperationDetails(debtKey));
          const st = String(op.data?.data?.status || op.data?.status || '').toLowerCase();
          if (/desembol|disburs|paid|integrat|finaliz/.test(st) || /reject|cancel|erro/.test(st)) break;
          await sleep(2000);
        }
      }
      return jsonResp({ success: true, modo, marginKey, employerDoc, codTabela, simKey, debtKey, passos }, 200, req);
    }

    return jsonError(
      'Action invalida. Validas: test, consultarAprovacao, enviarSms, cancelarProposta, listarRebates, simular, digitar, statusOperacao, certificar',
      400, req
    );
  } catch (e) {
    return jsonError('Erro Nossa Fintech: ' + e.message, 500, req);
  }
}
