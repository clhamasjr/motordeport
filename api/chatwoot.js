export const config = { runtime: 'edge' };

// ══════════════════════════════════════════════════════════════════
// api/chatwoot.js — Proxy para Chatwoot API
// Integra o chat do FlowForce com Chatwoot instalado na VPS
// ══════════════════════════════════════════════════════════════════

import { json, jsonError, handleOptions, requireAuth } from './_lib/auth.js';

function getCfg() {
  return {
    url: (process.env.CHATWOOT_URL || '').replace(/\/+$/, ''),
    token: process.env.CHATWOOT_TOKEN || '',
    accountId: process.env.CHATWOOT_ACCOUNT_ID || '1'
  };
}

async function cw(method, path, body) {
  const cfg = getCfg();
  if (!cfg.url || !cfg.token) throw new Error('CHATWOOT_URL/TOKEN nao configurados');
  const url = `${cfg.url}/api/v1/accounts/${cfg.accountId}${path}`;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'api_access_token': cfg.token
    }
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 2000) }; }
  return { ok: r.ok, status: r.status, data: d };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  let body;
  try { body = req.method === 'POST' ? await req.json() : {}; } catch { body = {}; }
  const action = body.action || '';

  try {
    // ── CONVERSATIONS: listar conversas ─────────────────────
    if (action === 'conversations') {
      const status = body.status || 'open'; // open, resolved, pending, snoozed
      const page = body.page || 1;
      const assignee = body.assignee || ''; // me, unassigned, all
      const qs = `?status=${status}&page=${page}${assignee ? '&assignee_type=' + assignee : ''}`;
      const r = await cw('GET', '/conversations' + qs);
      return json(r.data, 200, req);
    }

    // ── CONVERSATION DETAIL ─────────────────────────────────
    if (action === 'conversation') {
      const id = body.id;
      if (!id) return jsonError('id obrigatorio', 400, req);
      const r = await cw('GET', '/conversations/' + id);
      return json(r.data, 200, req);
    }

    // ── MESSAGES: buscar mensagens de uma conversa ──────────
    if (action === 'messages') {
      const id = body.id;
      if (!id) return jsonError('id obrigatorio', 400, req);
      const r = await cw('GET', '/conversations/' + id + '/messages');
      return json(r.data, 200, req);
    }

    // ── SEND: enviar mensagem ───────────────────────────────
    if (action === 'send') {
      const id = body.id;
      const content = body.content || body.text || '';
      if (!id) return jsonError('id (conversation_id) obrigatorio', 400, req);
      if (!content) return jsonError('content obrigatorio', 400, req);
      const r = await cw('POST', '/conversations/' + id + '/messages', {
        content,
        message_type: 'outgoing',
        private: false
      });
      return json(r.data, 200, req);
    }

    // ── NEW CONVERSATION: criar nova conversa ───────────────
    if (action === 'new') {
      const phone = (body.phone || '').replace(/\D/g, '');
      if (!phone) return jsonError('phone obrigatorio', 400, req);
      const inboxId = body.inbox_id || body.inboxId;
      if (!inboxId) return jsonError('inbox_id obrigatorio', 400, req);

      // 1. Buscar ou criar contato
      let contactId = null;
      const searchR = await cw('GET', '/contacts/search?q=' + phone + '&page=1');
      if (searchR.data && searchR.data.payload && searchR.data.payload.length > 0) {
        contactId = searchR.data.payload[0].id;
      } else {
        // Criar contato
        const createR = await cw('POST', '/contacts', {
          name: body.name || phone,
          phone_number: '+' + phone,
          identifier: phone
        });
        contactId = createR.data?.id || createR.data?.payload?.contact?.id;
      }
      if (!contactId) return jsonError('Erro ao criar contato', 500, req);

      // 2. Criar conversa
      const convR = await cw('POST', '/conversations', {
        contact_id: contactId,
        inbox_id: Number(inboxId),
        message: { content: body.message || '' }
      });
      return json(convR.data, 200, req);
    }

    // ── TOGGLE STATUS: abrir/resolver conversa ──────────────
    if (action === 'toggleStatus') {
      const id = body.id;
      const status = body.status || 'resolved'; // open, resolved, pending
      if (!id) return jsonError('id obrigatorio', 400, req);
      const r = await cw('POST', '/conversations/' + id + '/toggle_status', { status });
      return json(r.data, 200, req);
    }

    // ── ASSIGN: atribuir conversa a um agente ───────────────
    if (action === 'assign') {
      const id = body.id;
      const agentId = body.agent_id;
      if (!id) return jsonError('id obrigatorio', 400, req);
      const r = await cw('POST', '/conversations/' + id + '/assignments', {
        assignee_id: agentId || null
      });
      return json(r.data, 200, req);
    }

    // ── ADD LABEL ───────────────────────────────────────────
    if (action === 'label') {
      const id = body.id;
      const labels = body.labels || [];
      if (!id) return jsonError('id obrigatorio', 400, req);
      const r = await cw('GET', '/conversations/' + id + '/labels');
      const current = r.data?.payload || [];
      const merged = [...new Set([...current, ...labels])];
      const r2 = await cw('POST', '/conversations/' + id + '/labels', { labels: merged });
      return json(r2.data, 200, req);
    }

    // ── CONTACTS: buscar contatos ───────────────────────────
    if (action === 'contacts') {
      const q = body.q || '';
      const page = body.page || 1;
      const r = q
        ? await cw('GET', '/contacts/search?q=' + encodeURIComponent(q) + '&page=' + page)
        : await cw('GET', '/contacts?page=' + page);
      return json(r.data, 200, req);
    }

    // ── INBOXES: listar caixas de entrada ───────────────────
    if (action === 'inboxes') {
      const r = await cw('GET', '/inboxes');
      return json(r.data, 200, req);
    }

    // ── AGENTS: listar agentes ──────────────────────────────
    if (action === 'agents') {
      const r = await cw('GET', '/agents');
      return json(r.data, 200, req);
    }

    // ── SEARCH: buscar conversas ────────────────────────────
    if (action === 'search') {
      const q = body.q || '';
      if (!q) return jsonError('q obrigatorio', 400, req);
      const r = await cw('GET', '/conversations/filter?q=' + encodeURIComponent(q));
      return json(r.data, 200, req);
    }

    // ── COUNTS: contadores por status ───────────────────────
    if (action === 'counts') {
      const open = await cw('GET', '/conversations?status=open&page=1');
      const pending = await cw('GET', '/conversations?status=pending&page=1');
      const resolved = await cw('GET', '/conversations?status=resolved&page=1');
      return json({
        open: open.data?.data?.meta?.all_count || 0,
        pending: pending.data?.data?.meta?.all_count || 0,
        resolved: resolved.data?.data?.meta?.all_count || 0
      }, 200, req);
    }

    return jsonError('action invalida', 400, req);
  } catch (e) {
    return json({ error: e.message || 'Erro interno' }, 500, req);
  }
}
