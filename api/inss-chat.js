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

// ── Isolamento por usuario ─────────────────────────────────────────
// Admin/gestor (e chamadas internas via WEBHOOK_SECRET) enxergam tudo.
// Vendedor: SO enxerga conversas da SUA instance (bank_codes.WPP).
// Vendedor sem instance atribuida nao enxerga NADA (seguro por padrao).
function isPriv(user) {
  return !!(user && (user.role === 'admin' || user.role === 'gestor' || user._internal));
}

// Instance Evolution do usuario (bank_codes.WPP). '' = sem instance.
function userInstance(user) {
  const bc = (user && user.bank_codes) || {};
  return bc.WPP || '';
}

// Fallback de envio: instance propria > default global (so pra priv)
function getUserInstance(user) {
  const own = userInstance(user);
  if (own) return own;
  return isPriv(user) ? (process.env.INSS_DEFAULT_INSTANCE || '') : '';
}

// Carrega conversa COM checagem de dono. Vendedor so acessa conversa da
// propria instance. Retorna { ok, conversa } ou { ok:false, forbidden }.
async function loadConversaAutorizada(telefone, user) {
  const numClean = String(telefone || '').replace(/\D/g, '');
  if (!numClean) return { ok: false, error: 'telefone invalido' };
  const { data, error } = await dbSelect('inss_conversas', {
    filters: { telefone: numClean }, single: true
  });
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Conversa nao encontrada' };
  if (!isPriv(user)) {
    const inst = userInstance(user);
    if (!inst || data.instance !== inst) {
      return { ok: false, error: 'Sem permissao para esta conversa', forbidden: true };
    }
  }
  return { ok: true, conversa: data };
}

// Lista conversas com filtros (status). Isolamento aplicado SEMPRE no servidor.
async function listConversas({ status, limit = 100, user }) {
  let filters = {};
  if (status && status !== 'all') filters.status = status;
  if (!isPriv(user)) {
    const inst = userInstance(user);
    // Vendedor sem instance atribuida: lista vazia (nao vaza conversas dos outros)
    if (!inst) return { ok: true, conversas: [], filtroInstance: null, semInstancia: true };
    filters.instance = inst;
  }
  const { data, error } = await dbSelect('inss_conversas', {
    filters,
    order: 'last_msg_at.desc',
    limit
  });
  if (error) return { ok: false, error: error.message || 'Erro ao listar' };
  return { ok: true, conversas: (data || []).map(simplifyConv), filtroInstance: filters.instance || null, isPriv: isPriv(user) };
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

async function getConversa(telefone, user) {
  const r = await loadConversaAutorizada(telefone, user);
  if (!r.ok) return r;
  return { ok: true, conversa: r.conversa };
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
  const numClean = String(telefone).replace(/\D/g, '');
  const ts = new Date().toISOString();
  // Se a conversa ja existe, checa dono ANTES de gravar/enviar.
  let existing = null;
  {
    const { data } = await dbSelect('inss_conversas', { filters: { telefone: numClean }, single: true });
    existing = data || null;
  }
  if (existing && !isPriv(user)) {
    const own = userInstance(user);
    if (!own || existing.instance !== own) {
      return { ok: false, error: 'Sem permissao para esta conversa' };
    }
  }
  // Prioridade pra escolher a instance:
  // 1) instance da propria conversa (criada pelo webhook quando o cliente escreveu)
  // 2) instance explicita do body (so priv pode forcar — vendedor usa a propria)
  // 3) bank_codes.WPP do usuario logado
  // 4) INSS_DEFAULT_INSTANCE (so priv)
  let inst = (existing && existing.instance) || '';
  if (!inst && instance && isPriv(user)) inst = instance;
  if (!inst) inst = getUserInstance(user);
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

async function markRead(telefone, user) {
  const r = await loadConversaAutorizada(telefone, user);
  if (!r.ok) return r;
  await dbUpdate('inss_conversas', { id: r.conversa.id }, { unread_count: 0 });
  return { ok: true };
}

async function setStatus(telefone, status, user) {
  if (!['open', 'pending', 'resolved'].includes(status)) return { ok: false, error: 'status invalido' };
  const r = await loadConversaAutorizada(telefone, user);
  if (!r.ok) return r;
  await dbUpdate('inss_conversas', { id: r.conversa.id }, { status });
  return { ok: true, status };
}

async function setAgenteAtivo(telefone, ativo, user) {
  const r = await loadConversaAutorizada(telefone, user);
  if (!r.ok) return r;
  await dbUpdate('inss_conversas', { id: r.conversa.id }, { agente_ativo: !!ativo });
  return { ok: true, agente_ativo: !!ativo };
}

// Cria conversa nova manualmente (vendedor inicia chat)
async function createConversa({ telefone, nome, instance, user }) {
  const numClean = String(telefone).replace(/\D/g, '');
  if (!numClean || numClean.length < 10) return { ok: false, error: 'telefone invalido' };
  const { data: existing } = await dbSelect('inss_conversas', { filters: { telefone: numClean }, single: true });
  if (existing) {
    // Se ja existe mas e de outra instance, vendedor nao pode "adotar"
    if (!isPriv(user)) {
      const own = userInstance(user);
      if (!own || existing.instance !== own) return { ok: false, error: 'Ja existe conversa deste telefone em outra instance' };
    }
    return { ok: true, conversa: existing, existed: true };
  }
  // Vendedor SEMPRE cria na propria instance; priv pode forcar via body
  const inst = isPriv(user) ? (instance || getUserInstance(user)) : userInstance(user);
  if (!inst) return { ok: false, error: 'Sem instancia WhatsApp atribuida. Peca ao admin para configurar (bank_codes.WPP).' };
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
        limit: body.limit || 100,
        user
      });
      return jsonResp(r, r.ok ? 200 : 500, req);
    }
    if (action === 'getConversa') {
      const r = await getConversa(body.telefone, user);
      return jsonResp(r, r.ok ? 200 : (r.forbidden ? 403 : 404), req);
    }
    if (action === 'sendMessage') {
      const r = await sendMessage({ telefone: body.telefone, content: body.content, instance: body.instance, user });
      return jsonResp(r, r.ok ? 200 : 500, req);
    }
    if (action === 'markRead') {
      const r = await markRead(body.telefone, user);
      return jsonResp(r, r.ok ? 200 : (r.forbidden ? 403 : 404), req);
    }
    if (action === 'setStatus') {
      const r = await setStatus(body.telefone, body.status, user);
      return jsonResp(r, r.ok ? 200 : (r.forbidden ? 403 : 400), req);
    }
    if (action === 'pausarAgente') {
      const r = await setAgenteAtivo(body.telefone, false, user);
      return jsonResp(r, r.ok ? 200 : (r.forbidden ? 403 : 404), req);
    }
    if (action === 'retomarAgente') {
      const r = await setAgenteAtivo(body.telefone, true, user);
      return jsonResp(r, r.ok ? 200 : (r.forbidden ? 403 : 404), req);
    }
    if (action === 'createConversa') {
      const r = await createConversa({ telefone: body.telefone, nome: body.nome, instance: body.instance, user });
      return jsonResp(r, r.ok ? 200 : 400, req);
    }
    // ── Helper interno: appendMessage chamado pelo webhook (api/agent.js) ──
    // So aceita chamada interna (WEBHOOK_SECRET) ou admin — webhook grava
    // mensagens de QUALQUER conversa, vendedor nao pode usar isso.
    if (action === 'appendMessage') {
      if (!isPriv(user)) return jsonError('Sem permissao', 403, req);
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
