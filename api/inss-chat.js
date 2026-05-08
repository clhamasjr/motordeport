// /api/inss-chat — gestao de conversas WhatsApp INSS via Supabase + Evolution direto
// Espelho do modelo CLT: sem Chatwoot. Webhook Evolution grava mensagens em inss_conversas,
// vendedor lista/responde via UI. Sofia (api/agent.js) usa as mesmas tabelas pra contexto.

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';
import { dbSelect, dbInsert, dbUpdate, dbUpsert, dbQuery } from './_lib/supabase.js';

const EVO_URL = () => process.env.EVOLUTION_URL;
const EVO_KEY = () => process.env.EVOLUTION_KEY;

async function evoSend(instance, telefone, text) {
  const url = EVO_URL();
  const key = EVO_KEY();
  if (!url || !key) return { ok: false, error: 'Evolution nao configurada' };
  // Endpoint Evolution: /message/sendText/{instance}
  try {
    const r = await fetch(`${url}/message/sendText/${encodeURIComponent(instance)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': key },
      body: JSON.stringify({ number: telefone, text })
    });
    const txt = await r.text();
    let d; try { d = JSON.parse(txt); } catch { d = { raw: txt.substring(0, 300) }; }
    if (!r.ok) return { ok: false, status: r.status, error: d.message || d.error || 'Erro Evolution', data: d };
    return { ok: true, data: d };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Pega 1 instancia Evolution INSS associada ao usuario (do bank_codes.WPP ou da config geral)
async function getUserInstance(user) {
  const bc = user.bank_codes || {};
  if (bc.WPP) return bc.WPP;
  // Fallback: qualquer instancia INSS configurada globalmente
  return process.env.INSS_DEFAULT_INSTANCE || '';
}

// Lista conversas com filtros (status, instance, scope)
async function listConversas({ status, instance, limit = 100, scope = 'mine', user }) {
  let filters = {};
  if (status && status !== 'all') filters.status = status;
  // Admin e gestor sempre enxergam TODAS as conversas, sem filtro de instance.
  // Vendedor: filtra pela instance ativa do chat (se houver).
  const isPriv = user && (user.role === 'admin' || user.role === 'gestor');
  if (scope === 'mine' && instance && !isPriv) filters.instance = instance;
  const { data, error } = await dbSelect('inss_conversas', {
    filters,
    order: 'last_msg_at.desc',
    limit
  });
  if (error) return { ok: false, error: error.message || 'Erro ao listar' };
  return { ok: true, conversas: (data || []).map(simplifyConv), filtroInstance: filters.instance || null, scope, isPriv };
}

function simplifyConv(c) {
  const hist = Array.isArray(c.historico) ? c.historico : [];
  const last = hist.length ? hist[hist.length - 1] : null;
  return {
    id: c.id,
    telefone: c.telefone,
    instance: c.instance,
    nome: c.nome,
    cpf: c.cpf,
    status: c.status,
    agente_ativo: !!c.agente_ativo,
    unread: c.unread_count || 0,
    last_msg_at: c.last_msg_at,
    last_msg_preview: last ? String(last.content || '').substring(0, 80) : '',
    last_msg_role: last ? last.role : null
  };
}

async function getConversa(telefone) {
  const { data, error } = await dbSelect('inss_conversas', {
    filters: { telefone }, single: true
  });
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Conversa nao encontrada' };
  return { ok: true, conversa: data };
}

async function appendMessage(telefone, msg) {
  // msg = { role: 'me'|'cliente'|'sofia', content, ts, tipo? }
  const { data: existing } = await dbSelect('inss_conversas', {
    filters: { telefone }, single: true
  });
  const now = new Date().toISOString();
  if (!existing) {
    const created = await dbInsert('inss_conversas', {
      telefone,
      instance: msg.instance || '',
      nome: msg.nome || '',
      historico: [msg],
      status: 'open',
      agente_ativo: false,
      unread_count: msg.role === 'cliente' ? 1 : 0,
      last_msg_at: now,
      created_at: now,
      updated_at: now
    });
    return { ok: true, conversa: created.data };
  }
  const hist = Array.isArray(existing.historico) ? existing.historico : [];
  hist.push(msg);
  const patch = {
    historico: hist,
    last_msg_at: now,
    updated_at: now
  };
  if (msg.role === 'cliente') patch.unread_count = (existing.unread_count || 0) + 1;
  if (msg.nome && !existing.nome) patch.nome = msg.nome;
  if (msg.cpf && !existing.cpf) patch.cpf = msg.cpf;
  await dbUpdate('inss_conversas', { id: existing.id }, patch);
  return { ok: true, conversa: { ...existing, ...patch } };
}

async function sendMessage({ telefone, content, instance, user }) {
  if (!telefone || !content) return { ok: false, error: 'telefone e content obrigatorios' };
  // Grava na conversa (role=me) ANTES de tentar enviar — assim mesmo se Evolution falhar, fica histórico.
  const numClean = String(telefone).replace(/\D/g, '');
  const ts = new Date().toISOString();
  // Prioridade pra escolher a instance:
  // 1) explicitamente passada no body
  // 2) instance ja gravada na propria conversa (criada pelo webhook quando o cliente escreveu)
  // 3) bank_codes.WPP do usuario logado
  // 4) INSS_DEFAULT_INSTANCE
  let inst = instance || '';
  if (!inst) {
    try {
      const { data: existing } = await dbSelect('inss_conversas', { filters: { telefone: numClean }, single: true });
      if (existing && existing.instance) inst = existing.instance;
    } catch {}
  }
  if (!inst) inst = await getUserInstance(user);
  await appendMessage(numClean, { role: 'me', content, ts, instance: inst, sender: user.username || user.user || '' });
  // Envia via Evolution
  if (!inst) return { ok: false, error: 'Sem instancia Evolution. Conecte WhatsApp em Admin -> Conexoes.' };
  const r = await evoSend(inst, numClean, content);
  if (!r.ok) {
    await dbInsert('inss_conversas_eventos', {
      telefone: numClean, tipo: 'envio_falhou', detalhes: { error: r.error, status: r.status }
    }).catch(() => {});
    return { ok: false, error: r.error, queued: true };
  }
  return { ok: true, delivered: true };
}

async function markRead(telefone) {
  const numClean = String(telefone).replace(/\D/g, '');
  const { data: existing } = await dbSelect('inss_conversas', { filters: { telefone: numClean }, single: true });
  if (!existing) return { ok: false, error: 'nao encontrada' };
  await dbUpdate('inss_conversas', { id: existing.id }, { unread_count: 0 });
  return { ok: true };
}

async function setStatus(telefone, status) {
  if (!['open', 'pending', 'resolved'].includes(status)) return { ok: false, error: 'status invalido' };
  const numClean = String(telefone).replace(/\D/g, '');
  const { data: existing } = await dbSelect('inss_conversas', { filters: { telefone: numClean }, single: true });
  if (!existing) return { ok: false, error: 'nao encontrada' };
  await dbUpdate('inss_conversas', { id: existing.id }, { status });
  return { ok: true, status };
}

async function setAgenteAtivo(telefone, ativo) {
  const numClean = String(telefone).replace(/\D/g, '');
  const { data: existing } = await dbSelect('inss_conversas', { filters: { telefone: numClean }, single: true });
  if (!existing) return { ok: false, error: 'nao encontrada' };
  await dbUpdate('inss_conversas', { id: existing.id }, { agente_ativo: !!ativo });
  return { ok: true, agente_ativo: !!ativo };
}

// Cria conversa nova manualmente (vendedor inicia chat)
async function createConversa({ telefone, nome, instance, user }) {
  const numClean = String(telefone).replace(/\D/g, '');
  if (!numClean || numClean.length < 10) return { ok: false, error: 'telefone invalido' };
  const { data: existing } = await dbSelect('inss_conversas', { filters: { telefone: numClean }, single: true });
  if (existing) return { ok: true, conversa: existing, existed: true };
  const inst = instance || (await getUserInstance(user));
  const now = new Date().toISOString();
  const created = await dbInsert('inss_conversas', {
    telefone: numClean, nome: nome || '', instance: inst,
    historico: [], status: 'open', agente_ativo: false,
    unread_count: 0, last_msg_at: now, created_at: now, updated_at: now
  });
  return { ok: true, conversa: created.data };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);
  const user = await requireAuth(req);
  if (user instanceof Response) return user;
  if (req.method !== 'POST') return jsonError('POST only', 405, req);

  let body;
  try { body = await req.json(); } catch { return jsonError('Invalid JSON', 400, req); }
  const action = body.action;

  try {
    if (action === 'listConversas') {
      const r = await listConversas({
        status: body.status,
        instance: body.instance || (await getUserInstance(user)),
        scope: body.scope || 'mine',
        limit: body.limit || 100,
        user
      });
      return jsonResp(r, r.ok ? 200 : 500, req);
    }
    if (action === 'getConversa') {
      const r = await getConversa(String(body.telefone || '').replace(/\D/g, ''));
      return jsonResp(r, r.ok ? 200 : 404, req);
    }
    if (action === 'sendMessage') {
      const r = await sendMessage({ telefone: body.telefone, content: body.content, instance: body.instance, user });
      return jsonResp(r, r.ok ? 200 : 500, req);
    }
    if (action === 'markRead') {
      const r = await markRead(body.telefone);
      return jsonResp(r, r.ok ? 200 : 404, req);
    }
    if (action === 'setStatus') {
      const r = await setStatus(body.telefone, body.status);
      return jsonResp(r, r.ok ? 200 : 400, req);
    }
    if (action === 'pausarAgente') {
      const r = await setAgenteAtivo(body.telefone, false);
      return jsonResp(r, r.ok ? 200 : 404, req);
    }
    if (action === 'retomarAgente') {
      const r = await setAgenteAtivo(body.telefone, true);
      return jsonResp(r, r.ok ? 200 : 404, req);
    }
    if (action === 'createConversa') {
      const r = await createConversa({ telefone: body.telefone, nome: body.nome, instance: body.instance, user });
      return jsonResp(r, r.ok ? 200 : 400, req);
    }
    // ── Helper interno: appendMessage chamado pelo webhook (api/agent.js) ──
    if (action === 'appendMessage') {
      const r = await appendMessage(
        String(body.telefone || '').replace(/\D/g, ''),
        body.msg || {}
      );
      return jsonResp(r, r.ok ? 200 : 500, req);
    }
    return jsonError('action invalida', 400, req);
  } catch (e) {
    return jsonResp({ ok: false, error: e.message }, 500, req);
  }
}
