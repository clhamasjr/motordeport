// ══════════════════════════════════════════════════════════════════
// api/v8.js — V8 Sistema: Crédito Privado CLT (provedor QI)
// Documentação: docs.v8sistema.com
//
// Fluxo completo:
//  1. Auth OAuth password grant → access_token (24h TTL)
//  2. gerarTermo (POST /private-consignment/consult) → consult_id
//  3. autorizarTermo (POST /private-consignment/consult/{id}/authorize)
//  4. listarConsultas (GET /private-consignment/consult)
//     → status: WAITING_CONSENT → CONSENT_APPROVED → WAITING_CONSULT
//       → WAITING_CREDIT_ANALYSIS → SUCCESS (com availableMarginValue)
//  5. simularConfigs (GET /private-consignment/simulation/configs) → tabelas/taxas
//  6. simular (POST /private-consignment/simulation) → id_simulation
//  7. criarOperacao (POST /private-consignment/operation) → formalization_url
//  8. listarOperacoes / detalhe / cancelar / pendências
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';
import { dbInsert, dbUpdate, dbSelect } from './_lib/supabase.js';

const AUTH_URL = () => process.env.V8_AUTH_URL || 'https://auth.v8sistema.com/oauth/token';
const BFF_BASE = () => process.env.V8_BFF_URL || 'https://bff.v8sistema.com';
const CLIENT_ID = () => process.env.V8_CLIENT_ID || 'DHWogdaYmEI8n5bwwxPDzulMlSK7dwIn';
const AUDIENCE = () => process.env.V8_AUDIENCE; // fornecido por email pela V8 — REQUIRED
const USERNAME = () => process.env.V8_USERNAME;
const PASSWORD = () => process.env.V8_PASSWORD;
const PROVIDER_DEFAULT = 'QI';
const PROVIDERS_DISPONIVEIS = ['QI', 'CELCOIN']; // V8 trabalha com 2 bancarizadoras

// ── Token cache (em memória edge) ────────────────────────────
let TOKEN_CACHE = { token: null, expiresAt: 0 };

async function getToken() {
  const now = Date.now();
  if (TOKEN_CACHE.token && TOKEN_CACHE.expiresAt > now + 60_000) return TOKEN_CACHE.token;

  if (!USERNAME() || !PASSWORD()) throw new Error('V8_USERNAME/V8_PASSWORD nao configurados');
  if (!AUDIENCE()) throw new Error('V8_AUDIENCE nao configurado (solicitar a gerente comercial V8)');

  const body = new URLSearchParams({
    grant_type: 'password',
    username: USERNAME(),
    password: PASSWORD(),
    audience: AUDIENCE(),
    scope: 'offline_access',
    client_id: CLIENT_ID()
  });
  const r = await fetch(AUTH_URL(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 500) }; }
  if (!r.ok || !d.access_token) {
    throw new Error(`Falha auth V8 (HTTP ${r.status}): ${d.error_description || d.error || d.raw || 'sem detalhes'}`);
  }
  const ttlMs = ((d.expires_in || 86400) * 1000) - 60_000;
  TOKEN_CACHE = { token: d.access_token, expiresAt: now + ttlMs };
  return d.access_token;
}

async function v8Call(path, method, body, isJson = true) {
  const token = await getToken();
  const opts = {
    method,
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/json'
    }
  };
  if (isJson) opts.headers['Content-Type'] = 'application/json';
  if (body && method !== 'GET') opts.body = isJson ? JSON.stringify(body) : body;

  const r = await fetch(BFF_BASE() + path, opts);
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 2000) }; }
  return { ok: r.ok, status: r.status, data: d };
}

function normalizeCPF(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits || digits.length > 11 || digits.length < 9) return null;
  return digits.padStart(11, '0');
}

function normalizePhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length < 10) return null;
  // formato BR: DDD (2) + número (8 ou 9)
  return { areaCode: d.substring(0, 2), number: d.substring(2), countryCode: '55', completo: d };
}

const j = (data, status = 200, req = null) => jsonResp(data, status, req);

// ══════════════════════════════════════════════════════════════
// HANDLER
// ══════════════════════════════════════════════════════════════
export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  // Webhooks da V8 não exigem auth do FlowForce (chamadas externas)
  // Tratamento ANTES do requireAuth
  const url = new URL(req.url);
  if (url.pathname.endsWith('/v8') && req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    if (body.type && (body.type.startsWith('private.consignment.') || body.type.startsWith('webhook.'))) {
      return await handleWebhook(body, req);
    }
    // Reprocessa como request normal (precisa auth)
    return await handleAction(body, req);
  }

  return jsonError('Use POST', 405, req);
}

async function handleWebhook(body, req) {
  // Eventos esperados:
  //  - webhook.test / webhook.registered (registro)
  //  - private.consignment.consult.updated (status margem)
  //  - private.consignment.operation.created / .updated (status proposta)
  try {
    const tipo = body.type;
    const ts = body.timestamp || new Date().toISOString();

    if (tipo === 'private.consignment.consult.updated') {
      // Atualiza status na tabela de propostas (se houver registro)
      const consultId = body.consultId;
      if (consultId) {
        await dbUpdate('clt_propostas', { externo_consult_id: consultId }, {
          status_externo: body.status,
          margem_v8: body.availableMarginValue || null,
          webhook_ultimo: body
        }).catch(() => {});
      }
    }
    if (tipo === 'private.consignment.operation.created' || tipo === 'private.consignment.operation.updated') {
      const operationId = body.operationId;
      if (operationId) {
        const patch = {
          status_externo: body.status,
          webhook_ultimo: body,
          updated_at: ts
        };
        if (body.status === 'paid') patch.paid_at = ts;
        await dbUpdate('clt_propostas', { proposta_id_externo: operationId, banco: 'v8' }, patch).catch(() => {});
      }
    }
    return jsonResp({ ok: true, received: tipo }, 200, req);
  } catch (err) {
    console.error('v8 webhook erro:', err);
    return jsonResp({ ok: true, error: err.message }, 200, req); // sempre 2xx pra V8 não retentar
  }
}

async function handleAction(body, req) {
  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  try {
    const action = body.action || '';

    // ─── TEST: valida auth ────────────────────────────────────
    if (action === 'test') {
      try {
        const token = await getToken();
        return j({
          success: true, apiActive: true,
          message: 'V8 autenticado!',
          tokenPreview: token.substring(0, 24) + '...',
          expiresInSeconds: Math.floor((TOKEN_CACHE.expiresAt - Date.now()) / 1000),
          config: {
            authUrl: AUTH_URL(), bff: BFF_BASE(),
            client: CLIENT_ID().substring(0, 12) + '...',
            audienceSet: !!AUDIENCE(),
            user: USERNAME()
          }
        }, 200, req);
      } catch (e) {
        return j({ success: false, apiActive: false, error: e.message }, 200, req);
      }
    }

    // ─── 1) GERAR TERMO ───────────────────────────────────────
    // Suporta provider QI ou CELCOIN (V8 trabalha com ambas bancarizadoras)
    if (action === 'gerarTermo') {
      const cpf = normalizeCPF(body.cpf);
      if (!cpf || !body.nome || !body.dataNascimento || !body.email || !body.telefone || !body.sexo) {
        return jsonError('Obrigatorios: cpf, nome, dataNascimento (YYYY-MM-DD), email, telefone, sexo (M/F)', 400, req);
      }
      const phone = normalizePhone(body.telefone);
      if (!phone) return jsonError('Telefone invalido', 400, req);

      const sexo = String(body.sexo).toUpperCase().startsWith('M') ? 'male' : 'female';
      const provider = body.provider || PROVIDER_DEFAULT;
      if (!PROVIDERS_DISPONIVEIS.includes(provider)) {
        return jsonError(`provider invalido. Validos: ${PROVIDERS_DISPONIVEIS.join(',')}`, 400, req);
      }
      const payload = {
        borrowerDocumentNumber: cpf,
        gender: sexo,
        birthDate: body.dataNascimento,
        signerName: body.nome,
        signerEmail: body.email,
        signerPhone: { phoneNumber: phone.number, countryCode: phone.countryCode, areaCode: phone.areaCode },
        provider
      };
      const r = await v8Call('/private-consignment/consult', 'POST', payload);
      return j({
        success: r.ok, httpStatus: r.status,
        consultId: r.data?.id || null,
        provider,
        _raw: r.data
      }, 200, req);
    }

    // ─── 2) AUTORIZAR TERMO (auto-aprova) ─────────────────────
    if (action === 'autorizarTermo') {
      if (!body.consultId) return jsonError('consultId obrigatorio', 400, req);
      const r = await v8Call(`/private-consignment/consult/${encodeURIComponent(body.consultId)}/authorize`, 'POST', {});
      return j({ success: r.ok, httpStatus: r.status, _raw: r.data }, 200, req);
    }

    // ─── 3) LISTAR CONSULTAS / VERIFICAR STATUS ───────────────
    if (action === 'listarConsultas') {
      const startDate = body.startDate || new Date(Date.now() - 7 * 86400000).toISOString();
      const endDate = body.endDate || new Date().toISOString();
      const limit = body.limit || 50;
      const page = body.page || 1;
      const provider = body.provider || PROVIDER_DEFAULT;
      const search = body.search ? `&search=${encodeURIComponent(body.search)}` : '';
      const status = body.status ? `&status=${encodeURIComponent(body.status)}` : '';
      const path = `/private-consignment/consult?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&limit=${limit}&page=${page}&provider=${provider}${search}${status}`;
      const r = await v8Call(path, 'GET');
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    // ─── consultarStatusPorCPF (helper combinando search) ─────
    if (action === 'consultarPorCPF') {
      const cpf = normalizeCPF(body.cpf);
      if (!cpf) return jsonError('CPF invalido', 400, req);
      const startDate = body.startDate || new Date(Date.now() - 30 * 86400000).toISOString();
      const endDate = body.endDate || new Date().toISOString();
      const r = await v8Call(`/private-consignment/consult?startDate=${startDate}&endDate=${endDate}&limit=10&page=1&provider=${PROVIDER_DEFAULT}&search=${cpf}`, 'GET');
      const items = r.data?.data || [];
      const found = items.find(it => (it.documentNumber || '').replace(/\D/g, '') === cpf);
      return j({
        success: r.ok, httpStatus: r.status, cpf,
        encontrado: !!found,
        consultId: found?.id || null,
        status: found?.status || null,
        availableMarginValue: found?.availableMarginValue || null,
        nome: found?.name || null,
        descricao: found?.description || null,
        _allItems: items
      }, 200, req);
    }

    // ─── 4) SIMULAÇÃO: configs disponíveis ────────────────────
    if (action === 'simularConfigs') {
      const r = await v8Call('/private-consignment/simulation/configs', 'GET');
      return j({ success: r.ok, httpStatus: r.status, configs: r.data?.configs || [] }, 200, req);
    }

    // ─── 5) SIMULAÇÃO ─────────────────────────────────────────
    if (action === 'simular') {
      const obrig = ['consultId', 'configId'];
      const faltam = obrig.filter(k => !body[k]);
      if (faltam.length) return jsonError('Faltam: ' + faltam.join(', '), 400, req);
      const payload = {
        consult_id: body.consultId,
        config_id: body.configId,
        installment_face_value: parseFloat(body.installmentFaceValue || 0),
        disbursed_amount: parseFloat(body.disbursedAmount || 0),
        number_of_installments: parseInt(body.numberOfInstallments || 0),
        provider: body.provider || PROVIDER_DEFAULT
      };
      const r = await v8Call('/private-consignment/simulation', 'POST', payload);
      const d = r.data || {};
      return j({
        success: r.ok, httpStatus: r.status,
        idSimulation: d.id_simulation || null,
        valorParcela: d.installment_value || null,
        qtdParcelas: d.number_of_installments || null,
        valorOperacao: d.operation_amount || null,
        valorIof: d.disbursement_option?.iof_amount || null,
        cet: d.disbursement_option?.cet || null,
        primeiraParcela: d.disbursement_option?.first_due_date || null,
        valorDesembolso: d.disbursement_option?.final_disbursement_amount || d.disbursed_issue_amount || null,
        _raw: d
      }, 200, req);
    }

    // ─── 6) CRIAR OPERAÇÃO (proposta) ─────────────────────────
    if (action === 'criarOperacao') {
      const cpf = normalizeCPF(body.cpf);
      if (!cpf || !body.simulationId || !body.nome) {
        return jsonError('cpf, simulationId e nome obrigatorios', 400, req);
      }
      const phone = normalizePhone(body.telefone);
      if (!phone) return jsonError('Telefone invalido', 400, req);
      const sexo = String(body.sexo || 'M').toUpperCase().startsWith('M') ? 'male' : 'female';
      const ms = body.maritalStatus || 'single'; // single, married, divorced, widowed
      const docType = body.documentType || 'rg'; // rg ou cnh
      const provider = body.provider || PROVIDER_DEFAULT;
      const payload = {
        simulation_id: body.simulationId,
        provider, // QI ou CELCOIN
        borrower: {
          name: body.nome,
          email: body.email,
          phone: { country_code: phone.countryCode, area_code: phone.areaCode, number: phone.number },
          political_exposition: body.pep === true,
          address: {
            street: body.address?.street || '',
            number: String(body.address?.number || ''),
            complement: body.address?.complement || '',
            neighborhood: body.address?.neighborhood || '',
            city: body.address?.city || '',
            state: body.address?.state || '',
            postal_code: (body.address?.postalCode || '').replace(/\D/g, '')
          },
          birth_date: body.dataNascimento,
          mother_name: body.nomeMae || '',
          nationality: body.nationality || 'brazilian',
          document_issuer: body.documentIssuer || '',
          gender: sexo,
          person_type: 'natural',
          marital_status: ms,
          individual_document_number: cpf,
          document_identification_date: body.documentIdentificationDate || '2020-01-01',
          document_identification_type: docType,
          document_identification_number: body.documentIdentificationNumber || '000000',
          bank: {
            transfer_method: 'pix',
            pix_key: body.pixKey || cpf,
            pix_key_type: body.pixKeyType || 'cpf' // cpf | email | phone | random
          }
        }
      };
      const r = await v8Call('/private-consignment/operation', 'POST', payload);
      return j({
        success: r.ok, httpStatus: r.status,
        operationId: r.data?.id || null,
        formalizationUrl: r.data?.formalization_url || null,
        _raw: r.data
      }, 200, req);
    }

    // ─── 7) LISTAR OPERAÇÕES ──────────────────────────────────
    if (action === 'listarOperacoes') {
      const startDate = body.startDate || new Date(Date.now() - 30 * 86400000).toISOString();
      const endDate = body.endDate || new Date().toISOString();
      const limit = body.limit || 50;
      const page = body.page || 1;
      const provider = body.provider || PROVIDER_DEFAULT;
      const path = `/private-consignment/operation?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&limit=${limit}&page=${page}&provider=${provider}`;
      const r = await v8Call(path, 'GET');
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    // ─── 8) DETALHES DA OPERAÇÃO ──────────────────────────────
    if (action === 'detalheOperacao') {
      if (!body.operationId) return jsonError('operationId obrigatorio', 400, req);
      const r = await v8Call(`/private-consignment/operation/${encodeURIComponent(body.operationId)}`, 'GET');
      return j({ success: r.ok, httpStatus: r.status, ...r.data }, 200, req);
    }

    // ─── 9) CANCELAR OPERAÇÃO ─────────────────────────────────
    if (action === 'cancelar') {
      if (!body.operationId || !body.cancelReason) return jsonError('operationId e cancelReason obrigatorios', 400, req);
      const payload = {
        cancel_reason: body.cancelReason,
        cancel_description: body.cancelDescription || '',
        provider: body.provider || PROVIDER_DEFAULT
      };
      const r = await v8Call(`/private-consignment/operation/${encodeURIComponent(body.operationId)}/cancel`, 'POST', payload);
      return j({ success: r.ok, httpStatus: r.status, _raw: r.data }, 200, req);
    }

    // ─── 10) PENDÊNCIA: trocar PIX ────────────────────────────
    if (action === 'pendenciaPix') {
      if (!body.operationId || !body.pixKey) return jsonError('operationId e pixKey obrigatorios', 400, req);
      const payload = {
        bank: {
          transfer_method: 'pix',
          pix_key: body.pixKey,
          pix_key_type: body.pixKeyType || 'cpf'
        }
      };
      const r = await v8Call(`/private-consignment/operation/${encodeURIComponent(body.operationId)}/pendency/payment-data`, 'PATCH', payload);
      return j({ success: r.ok, httpStatus: r.status, _raw: r.data }, 200, req);
    }

    // ─── 11) UPLOAD documento (retorna key pra reapresentar) ─
    if (action === 'uploadDocumento') {
      if (!body.fileBase64 || !body.fileName) return jsonError('fileBase64 e fileName obrigatorios', 400, req);
      // V8 espera multipart/form-data ou JSON com info do arquivo — formato exato pode variar
      // Implementação tentativa baseada na doc:
      const r = await v8Call('/file/upload/private-consignment', 'POST', [{ key: '', file_name: body.fileName }]);
      return j({ success: r.ok, httpStatus: r.status, _raw: r.data, observacao: 'Endpoint pode requerer multipart — testar com upload real' }, 200, req);
    }

    // ─── 12) PENDÊNCIA: reapresentar documentos ───────────────
    if (action === 'pendenciaDocumentos') {
      if (!body.operationId || !body.documents) return jsonError('operationId e documents obrigatorios', 400, req);
      const r = await v8Call(`/private-consignment/operation/${encodeURIComponent(body.operationId)}/pendency/documents`, 'PATCH', { documents: body.documents });
      return j({ success: r.ok, httpStatus: r.status, _raw: r.data }, 200, req);
    }

    // ─── 13) REGISTRAR WEBHOOKS ───────────────────────────────
    if (action === 'registrarWebhooks') {
      const url = body.url || `${process.env.APP_URL || 'https://flowforce.vercel.app'}/api/v8`;
      const r1 = await v8Call('/user/webhook/private-consignment/consult', 'POST', { url });
      const r2 = await v8Call('/user/webhook/private-consignment/operation', 'POST', { url });
      return j({
        success: r1.ok && r2.ok,
        consultWebhook: { ok: r1.ok, status: r1.status, data: r1.data },
        operationWebhook: { ok: r2.ok, status: r2.status, data: r2.data },
        url
      }, 200, req);
    }

    return jsonError(
      'action invalida. Disponiveis: test, gerarTermo, autorizarTermo, listarConsultas, consultarPorCPF, simularConfigs, simular, criarOperacao, listarOperacoes, detalheOperacao, cancelar, pendenciaPix, uploadDocumento, pendenciaDocumentos, registrarWebhooks',
      400, req
    );
  } catch (err) {
    console.error('v8 erro:', err);
    return jsonResp({ error: 'Erro interno', message: err.message }, 500, req);
  }
}
