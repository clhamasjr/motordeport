export const config = { runtime: 'edge' };

// ════════════════════════════════════════════════════════════════════
// api/finanto-webhook.js
//
// Recebe webhooks da plataforma Ajin/FINANTO e propaga eventos para:
//   1. inss_conversas.proposta_finanto (estado da proposta atualizado)
//   2. inss_conversas_eventos (timeline pro vendedor ver)
//   3. inss_propostas_finanto (tabela espelho opcional)
//   4. WhatsApp via Evolution (Sofia avisa cliente automaticamente)
//
// Webhook types suportados:
//   - credit_transfer.proposal   → portabilidade accepted/rejected pelo
//                                  banco origem (DATAPREV liberou ou não)
//   - loan.status                → mudança de status do contrato Loan
//                                  (assinado, pago, cancelado, etc.)
//   - query_inss_balance.completed → saldo INSS pronto (async in100)
//
// Segurança: query string ?s=<FINANTO_WEBHOOK_SECRET> OU header
// x-webhook-secret. Cadastre essa URL no painel Ajin como:
//   https://flowforce.vercel.app/api/finanto-webhook?s=<secret>
// ════════════════════════════════════════════════════════════════════

import { json as jsonResp, handleOptions } from './_lib/auth.js';
import { dbSelect, dbUpdate, dbInsert, dbUpsert } from './_lib/supabase.js';

const EVO_URL = () => process.env.EVOLUTION_URL;
const EVO_KEY = () => process.env.EVOLUTION_KEY;
const AJIN_BASE = () => (process.env.FINANTO_URL || 'https://api.ajin.io').trim().replace(/\/+$/, '');
const AJIN_KEY = () => (process.env.FINANTO_KEY || '').trim();

// ── Validação do secret do webhook ──────────────────────────────────
function verifySecret(req) {
  const secret = (process.env.FINANTO_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || '').trim();
  if (!secret) return true; // sem secret configurado = aceita tudo (NÃO recomendado em produção)
  const hdr = req.headers.get('x-webhook-secret') || '';
  if (hdr && hdr === secret) return true;
  try {
    const url = new URL(req.url);
    if (url.searchParams.get('s') === secret) return true;
    if (url.searchParams.get('secret') === secret) return true;
  } catch {}
  return false;
}

// ── Helpers ─────────────────────────────────────────────────────────
function onlyDigits(s) { return String(s || '').replace(/\D/g, ''); }
function fmtBRL(v) {
  const n = Number(v) || 0;
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function ajinGet(path) {
  const key = AJIN_KEY();
  if (!key) return { ok: false, error: 'FINANTO_KEY ausente' };
  try {
    const r = await fetch(AJIN_BASE() + path, {
      headers: { 'Accept': 'application/json', 'apikey': key },
    });
    const t = await r.text();
    let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 1500) }; }
    return { ok: r.ok, status: r.status, data: d };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function evoSend(instance, telefone, text) {
  const url = EVO_URL();
  const key = EVO_KEY();
  if (!url || !key || !instance || !telefone) return { ok: false };
  try {
    const r = await fetch(`${url}/message/sendText/${encodeURIComponent(instance)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': key },
      body: JSON.stringify({ number: onlyDigits(telefone), text }),
    });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Localiza conversa pelo simulationId / contractNumber / cpf ──────
// PostgREST aceita filtro por chave JSON (proposta_finanto->>simulationId)
// mas como nem todo proxy passa caractere `>` cru, usamos fallback via REST direto.
async function findConversa({ simulationId, contractNumber, cpf, telefone }) {
  // 1) Por telefone direto (se vier)
  if (telefone) {
    const num = onlyDigits(telefone);
    const { data } = await dbSelect('inss_conversas', { filters: { telefone: num }, single: true });
    if (data) return data;
  }

  // 2) Por simulationId armazenado em proposta_finanto (JSON path)
  if (simulationId) {
    try {
      const supaUrl = process.env.SUPABASE_URL;
      const supaKey = process.env.SUPABASE_SERVICE_KEY;
      if (supaUrl && supaKey) {
        const url = `${supaUrl}/rest/v1/inss_conversas?select=*&proposta_finanto->>simulationId=eq.${encodeURIComponent(simulationId)}&limit=1`;
        const r = await fetch(url, { headers: { 'apikey': supaKey, 'Authorization': `Bearer ${supaKey}`, 'Accept': 'application/json' } });
        if (r.ok) {
          const arr = await r.json();
          if (Array.isArray(arr) && arr.length) return arr[0];
        }
      }
    } catch (e) {
      console.warn('[finanto-webhook] busca JSON falhou, indo pro fallback:', e?.message);
    }
    // Fallback: lista conversas com proposta_finanto preenchida e filtra no JS
    try {
      const { data } = await dbSelect('inss_conversas', {
        filters: {},
        select: 'id,telefone,instance,nome,cpf,proposta_finanto,historico',
        order: 'updated_at.desc',
        limit: 200,
      });
      if (Array.isArray(data)) {
        const hit = data.find((c) => c.proposta_finanto?.simulationId === simulationId);
        if (hit) return hit;
      }
    } catch {}
  }

  // 3) Por CPF
  if (cpf) {
    const cpfClean = onlyDigits(cpf);
    const { data } = await dbSelect('inss_conversas', { filters: { cpf: cpfClean }, single: true });
    if (data) return data;
  }
  return null;
}

// ── Atualiza estado da proposta na conversa ─────────────────────────
async function patchProposta(conversaId, patch) {
  try {
    const { data: c } = await dbSelect('inss_conversas', { filters: { id: conversaId }, single: true });
    if (!c) return;
    const existing = c.proposta_finanto || {};
    await dbUpdate('inss_conversas', { id: conversaId }, {
      proposta_finanto: { ...existing, ...patch, updated_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[finanto-webhook] patchProposta erro:', e?.message);
  }
}

// ── Append mensagem da Sofia na conversa (pra UI ver) ───────────────
async function appendSofiaMsg(telefone, content, instance) {
  try {
    const num = onlyDigits(telefone);
    const { data: c } = await dbSelect('inss_conversas', { filters: { telefone: num }, single: true });
    if (!c) return;
    const hist = Array.isArray(c.historico) ? c.historico : [];
    hist.push({ role: 'sofia', content, ts: new Date().toISOString(), instance: instance || c.instance });
    await dbUpdate('inss_conversas', { id: c.id }, {
      historico: hist,
      last_msg_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[finanto-webhook] appendSofiaMsg erro:', e?.message);
  }
}

// ── Logger de eventos (timeline) ────────────────────────────────────
async function logEvent(telefone, tipo, detalhes) {
  try {
    await dbInsert('inss_conversas_eventos', {
      telefone: onlyDigits(telefone) || '',
      tipo,
      detalhes,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[finanto-webhook] logEvent erro:', e?.message);
  }
}

// ── Espelha estado em inss_propostas_finanto (opcional) ─────────────
async function upsertEspelho({ simulationId, cpf, telefone, nome, status, patch }) {
  if (!simulationId) return;
  try {
    await dbUpsert('inss_propostas_finanto', {
      simulation_id: simulationId,
      cpf: cpf ? onlyDigits(cpf) : null,
      telefone: telefone ? onlyDigits(telefone) : null,
      nome: nome || null,
      status,
      ...(patch || {}),
      updated_at: new Date().toISOString(),
    }, 'simulation_id');
  } catch (e) {
    // Tabela opcional — não falhar webhook se ela não existir
    console.warn('[finanto-webhook] upsertEspelho:', e?.message);
  }
}

// ════════════════════════════════════════════════════════════════════
// HANDLERS POR TIPO DE EVENTO
// ════════════════════════════════════════════════════════════════════

// ── credit_transfer.proposal (Port aceita/rejeitada pelo banco origem) ──
async function handleCreditTransferProposal(payload) {
  const proposalKey = payload.proposalKey || payload.simulationKey || null;
  const proposalStatus = (payload.proposalStatus || '').toLowerCase();
  const data = payload.data || {};
  const simulationId = payload.simulationId || data.simulationId || proposalKey;

  // Localiza conversa
  const conv = await findConversa({ simulationId, cpf: data.cpf });
  if (!conv) {
    await logEvent('', 'finanto_port_sem_conversa', { simulationId, proposalKey, proposalStatus, data });
    return { handled: false, reason: 'conversa nao encontrada', simulationId };
  }

  // Atualiza estado
  const novoStatus = proposalStatus === 'accepted' ? 'port_aceita'
    : proposalStatus === 'rejected' ? 'port_rejeitada'
    : `port_${proposalStatus}`;

  await patchProposta(conv.id, {
    status: novoStatus,
    portStatus: proposalStatus,
    finalDueBalance: data.finalDueBalance,
    portabilityNumber: data.portabilityNumber,
    originalContract: data.originalContract,
    rejectionReason: data.rejectionReason || null,
  });

  await logEvent(conv.telefone, 'finanto_port_' + proposalStatus, {
    simulationId, proposalKey, proposalStatus,
    finalDueBalance: data.finalDueBalance,
    portabilityNumber: data.portabilityNumber,
    rejectionReason: data.rejectionReason,
  });

  await upsertEspelho({
    simulationId,
    cpf: conv.cpf,
    telefone: conv.telefone,
    nome: conv.nome,
    status: novoStatus,
    patch: {
      raw: payload,
    },
  });

  // Avisa cliente via WhatsApp
  let msg = null;
  if (proposalStatus === 'accepted') {
    const saldoTxt = data.finalDueBalance ? `\nSaldo confirmado: *${fmtBRL(data.finalDueBalance)}*` : '';
    msg = `✅ *Saldo da portabilidade liberado!*${saldoTxt}\n\nSua portabilidade foi aprovada pelo banco origem. Já estamos preparando o crédito do troco. Em breve te aviso quando cair! 🎉`;
  } else if (proposalStatus === 'rejected') {
    const motivo = data.rejectionReason ? `\n\nMotivo: ${data.rejectionReason}` : '';
    msg = `Olá! Tivemos um retorno do banco origem sobre a portabilidade.${motivo}\n\nVamos analisar aqui e te chamo já já com uma alternativa.`;
  }

  if (msg && conv.telefone && conv.instance) {
    await evoSend(conv.instance, conv.telefone, msg);
    await appendSofiaMsg(conv.telefone, msg, conv.instance);
  }

  return { handled: true, type: 'credit_transfer.proposal', proposalStatus, simulationId, conversaId: conv.id, msgSent: !!msg };
}

// ── loan.status (mudança de status do contrato Loan) ────────────────
async function handleLoanStatus(payload) {
  const loanId = payload.loanId || payload.id || payload.loan?.id;
  const simulationId = payload.simulationId || payload.simulation?.id || payload.loan?.simulationId;
  const status = (payload.status?.key || payload.status?.name || payload.status || '').toString().toLowerCase();
  const contractNumber = payload.contractNumber || payload.loan?.contractNumber || null;

  const conv = await findConversa({ simulationId, contractNumber });
  if (!conv) {
    await logEvent('', 'finanto_loan_sem_conversa', { loanId, simulationId, status });
    return { handled: false, reason: 'conversa nao encontrada', loanId, simulationId };
  }

  // Mapa status Ajin → status interno e mensagem ao cliente
  const map = {
    signed: { internal: 'assinado', msg: '✍️ Sua proposta foi assinada com sucesso! Agora é só aguardar o pagamento do banco.' },
    paid: { internal: 'pago', msg: '💰 *Seu empréstimo foi pago!* O valor já foi depositado na sua conta. Confira o extrato! 🎉' },
    canceled: { internal: 'cancelado', msg: 'Sua proposta foi cancelada. Se foi um engano ou quiser refazer, me chama!' },
    cancelled: { internal: 'cancelado', msg: 'Sua proposta foi cancelada. Se foi um engano ou quiser refazer, me chama!' },
    pending: { internal: 'pendente', msg: null },
    in_analysis: { internal: 'em_analise', msg: '📋 Sua proposta está em análise pelo banco. Em até 24h te aviso com o retorno.' },
    rejected: { internal: 'rejeitado', msg: 'Tivemos um retorno do banco sobre sua proposta. Vou olhar aqui e te chamo com uma alternativa.' },
    refused: { internal: 'rejeitado', msg: 'Tivemos um retorno do banco sobre sua proposta. Vou olhar aqui e te chamo com uma alternativa.' },
  };
  const m = map[status] || { internal: status || 'desconhecido', msg: null };

  await patchProposta(conv.id, {
    loanId,
    contractNumber,
    status: m.internal,
    loanStatus: status,
  });
  await logEvent(conv.telefone, 'finanto_loan_' + (status || 'update'), { loanId, simulationId, status, contractNumber });
  await upsertEspelho({
    simulationId, cpf: conv.cpf, telefone: conv.telefone, nome: conv.nome,
    status: m.internal,
    patch: { raw: payload },
  });

  if (m.msg && conv.telefone && conv.instance) {
    await evoSend(conv.instance, conv.telefone, m.msg);
    await appendSofiaMsg(conv.telefone, m.msg, conv.instance);
  }

  return { handled: true, type: 'loan.status', status, internal: m.internal, loanId, conversaId: conv.id, msgSent: !!m.msg };
}

// ── query_inss_balance.completed (saldo INSS pronto) ────────────────
async function handleQueryInssBalance(payload) {
  const queryId = payload.id || payload.queryId;
  const cpf = payload.identity || payload.cpf;
  const conv = await findConversa({ cpf });
  if (!conv) {
    await logEvent('', 'finanto_inss_balance_sem_conversa', { queryId, cpf });
    return { handled: false, reason: 'conversa nao encontrada', cpf };
  }
  await patchProposta(conv.id, {
    inssBalanceQueryId: queryId,
    inssBalanceStatus: payload.status || 'completed',
    inssBalanceData: payload,
  });
  await logEvent(conv.telefone, 'finanto_inss_balance', { queryId, status: payload.status });
  return { handled: true, type: 'query_inss_balance.completed', queryId, conversaId: conv.id };
}

// ════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════════════════════════════════
export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  // GET = verificação (ping)
  if (req.method === 'GET') {
    return jsonResp({
      ok: true,
      message: 'FINANTO webhook receiver online',
      hasSecret: !!(process.env.FINANTO_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET),
    }, 200, req);
  }

  if (req.method !== 'POST') {
    return jsonResp({ error: 'POST only' }, 405, req);
  }

  // Valida secret
  if (!verifySecret(req)) {
    console.warn('[finanto-webhook] secret invalido');
    return jsonResp({ error: 'Unauthorized' }, 401, req);
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return jsonResp({ error: 'JSON invalido' }, 400, req);
  }

  // Identifica tipo do webhook (Ajin pode usar diferentes chaves)
  const webhookType =
    payload.webhookType ||
    payload.type ||
    payload.event ||
    payload.eventType ||
    (payload.proposalStatus ? 'credit_transfer.proposal' : null);

  console.log('[finanto-webhook] in', { webhookType, keys: Object.keys(payload).slice(0, 10) });

  try {
    let result;
    if (webhookType === 'credit_transfer.proposal' || payload.proposalStatus) {
      result = await handleCreditTransferProposal(payload);
    } else if (webhookType === 'loan.status' || webhookType?.startsWith('loan.')) {
      result = await handleLoanStatus(payload);
    } else if (webhookType === 'query_inss_balance.completed' || webhookType === 'query_inss_balance') {
      result = await handleQueryInssBalance(payload);
    } else {
      // Desconhecido — loga e segue (não da 500, pra Ajin não reentregar infinito)
      await logEvent('', 'finanto_webhook_desconhecido', { webhookType, payload });
      result = { handled: false, reason: 'webhookType nao reconhecido', webhookType };
    }
    return jsonResp({ ok: true, ...result }, 200, req);
  } catch (e) {
    console.error('[finanto-webhook] erro:', e?.message, e?.stack);
    return jsonResp({ ok: false, error: e.message }, 500, req);
  }
}
