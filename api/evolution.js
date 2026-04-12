export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';
import { dbSelect, dbInsert, dbUpdate, dbQuery } from './_lib/supabase.js';

function getConfig() {
  return {
    URL: process.env.EVOLUTION_URL,
    KEY: process.env.EVOLUTION_KEY
  };
}

function getCwConfig() {
  return {
    url: (process.env.CHATWOOT_URL || '').replace(/\/+$/, ''),
    token: process.env.CHATWOOT_TOKEN || '',
    accountId: process.env.CHATWOOT_ACCOUNT_ID || '1'
  };
}

async function cwApi(method, path, body) {
  const cfg = getCwConfig();
  if (!cfg.url || !cfg.token) return null;
  const opts = { method, headers: { 'Content-Type': 'application/json', 'api_access_token': cfg.token } };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  try {
    const r = await fetch(`${cfg.url}/api/v1/accounts/${cfg.accountId}${path}`, opts);
    const t = await r.text();
    let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 1000) }; }
    return { ok: r.ok, data: d };
  } catch { return null; }
}

async function evo(method, path, body) {
  const cfg = getConfig();
  if (!cfg.URL || !cfg.KEY) throw new Error('EVOLUTION_URL/KEY nao configurados');
  const opts = { method, headers: { 'Content-Type': 'application/json', 'apikey': cfg.KEY } };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const r = await fetch(cfg.URL + path, opts);
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 1000) }; }
  return { ok: r.ok, status: r.status, data: d };
}

// Upsert chat in Supabase (create or update)
async function upsertChat(instance, jid, updates) {
  const phone = jid.replace('@s.whatsapp.net', '');
  const existing = await dbSelect('wpp_chats', { filters: { instance, jid }, single: true });

  if (existing.data) {
    await dbUpdate('wpp_chats', { id: existing.data.id }, {
      ...updates,
      last_message_at: new Date().toISOString()
    });
    return existing.data.id;
  } else {
    const { data } = await dbInsert('wpp_chats', {
      instance,
      jid,
      phone,
      name: updates.name || phone,
      last_message: updates.last_message || '',
      last_message_at: new Date().toISOString(),
      unread_count: updates.unread_count || 0,
      status: 'aberto'
    });
    return data?.id;
  }
}

const j = (data, status = 200, req = null) => jsonResp(data, status, req);

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  try {
    const body = req.method === 'POST' ? await req.json() : {};
    const action = body.action || '';
    const inst = body.instance || '';

    // ── Instance management ─────────────────────────────────
    if (action === 'list') {
      const r = await evo('GET', '/instance/fetchInstances');
      return j(r.data, 200, req);
    }

    if (action === 'create') {
      const name = body.name || '';
      if (!name) return jsonError('Nome obrigatorio', 400, req);
      const r = await evo('POST', '/instance/create', { instanceName: name, integration: 'WHATSAPP-BAILEYS', qrcode: true, rejectCall: false, groupsIgnore: true, alwaysOnline: false, readMessages: false, readStatus: false, syncFullHistory: false });
      const d = r.data;
      let qrBase64 = null;
      if (d) {
        if (d.qrcode && d.qrcode.base64) qrBase64 = d.qrcode.base64;
        else if (d.base64) qrBase64 = d.base64;
        else if (Array.isArray(d) && d[0] && d[0].qrcode) qrBase64 = d[0].qrcode.base64;
      }

      // ── Auto-create Chatwoot inbox for this instance ──
      let cwInbox = null;
      try {
        const cwCfg = getCwConfig();
        if (cwCfg.url && cwCfg.token) {
          // Create API inbox in Chatwoot
          const inboxR = await cwApi('POST', '/inboxes', {
            name: 'WhatsApp ' + name,
            channel: { type: 'api', webhook_url: '' }
          });
          if (inboxR && inboxR.ok && inboxR.data) {
            cwInbox = inboxR.data;
            // Set Evolution webhook to forward messages to our API
            const webhookUrl = (process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : '') + '/api/evolution';
            if (webhookUrl.startsWith('https://')) {
              await evo('POST', '/webhook/set/' + name, {
                webhook: { url: webhookUrl, events: ['MESSAGES_UPSERT'], webhook_by_events: false }
              });
            }
          }
        }
      } catch (e) { /* Chatwoot integration optional */ }

      return j({ success: r.ok, name, qrcode: qrBase64, instance: d.instance || d, hash: d.hash || null, chatwootInbox: cwInbox?.id || null }, 200, req);
    }

    if (action === 'delete') {
      if (!inst) return jsonError('instance obrigatorio', 400, req);
      const r = await evo('DELETE', '/instance/delete/' + inst);
      return j(r.data, 200, req);
    }

    // ── SETUP CHATWOOT: create inbox for existing instance ──
    if (action === 'setupChatwoot') {
      if (!inst) return jsonError('instance obrigatorio', 400, req);
      const cwCfg = getCwConfig();
      if (!cwCfg.url || !cwCfg.token) return jsonError('Chatwoot nao configurado (env vars)', 400, req);

      // Check if inbox already exists
      const existingR = await cwApi('GET', '/inboxes');
      const existing = existingR?.data?.payload || [];
      const found = existing.find(i => (i.name || '').toLowerCase().includes(inst.toLowerCase()));
      if (found) return j({ ok: true, inbox: found, message: 'Inbox ja existe' }, 200, req);

      // Create API inbox
      const inboxR = await cwApi('POST', '/inboxes', {
        name: 'WhatsApp ' + inst,
        channel: { type: 'api', webhook_url: '' }
      });
      if (!inboxR || !inboxR.ok) return j({ ok: false, error: 'Erro ao criar inbox', detail: inboxR?.data }, 500, req);

      // Set Evolution webhook
      const webhookUrl = (process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : '') + '/api/evolution';
      if (webhookUrl.startsWith('https://')) {
        await evo('POST', '/webhook/set/' + inst, {
          webhook: { url: webhookUrl, events: ['MESSAGES_UPSERT'], webhook_by_events: false }
        });
      }

      return j({ ok: true, inbox: inboxR.data, message: 'Inbox criada com sucesso' }, 200, req);
    }

    if (action === 'status') {
      if (!inst) return jsonError('instance obrigatorio', 400, req);
      const r = await evo('GET', '/instance/connectionState/' + inst);
      return j(r.data, 200, req);
    }

    if (action === 'connect') {
      if (!inst) return jsonError('instance obrigatorio', 400, req);
      const r = await evo('GET', '/instance/connect/' + inst);
      const d = r.data;
      let qrBase64 = null;
      if (d) {
        if (d.base64) qrBase64 = d.base64;
        else if (d.qrcode && d.qrcode.base64) qrBase64 = d.qrcode.base64;
        else if (d.code) qrBase64 = d.code;
      }
      return j({ ...d, qrcode: qrBase64 }, 200, req);
    }

    if (action === 'restart') {
      if (!inst) return jsonError('instance obrigatorio', 400, req);
      const r = await evo('PUT', '/instance/restart/' + inst);
      return j(r.data, 200, req);
    }

    if (action === 'logout') {
      if (!inst) return jsonError('instance obrigatorio', 400, req);
      const r = await evo('DELETE', '/instance/logout/' + inst);
      return j(r.data, 200, req);
    }

    // ── CHATS: load from Supabase (our own database) ────────
    if (action === 'chats') {
      if (!inst) return jsonError('instance obrigatorio', 400, req);

      const { data: chats } = await dbQuery('wpp_chats',
        `select=*&instance=eq.${encodeURIComponent(inst)}&order=last_message_at.desc&limit=100`
      );

      // Transform to frontend format
      const result = (chats || []).map(c => ({
        id: c.jid,
        name: c.name || c.phone || c.jid.replace('@s.whatsapp.net', ''),
        lastMsgTimestamp: c.last_message_at ? Math.floor(new Date(c.last_message_at).getTime() / 1000) : 0,
        unreadMessages: c.unread_count || 0,
        lastMessage: c.last_message || '',
        status: c.status,
        cpf: c.cpf || '',
        tags: c.tags || [],
        notes: c.notes || '',
        _dbId: c.id
      }));

      return j(result, 200, req);
    }

    // ── MESSAGES: load from Evolution API ────────────────────
    if (action === 'messages') {
      const jid = body.jid || '';
      const r = await evo('POST', '/chat/findMessages/' + inst, {
        where: { key: { remoteJid: jid } },
        limit: body.limit || 50
      });
      let msgs = r.data;

      // Handle paginated response format
      if (!Array.isArray(msgs)) {
        if (msgs && msgs.records) msgs = msgs.records;
        else if (msgs && msgs.messages) msgs = msgs.messages;
        else msgs = [];
      }

      // Mark as read in our DB
      if (jid && inst) {
        const { data: chat } = await dbSelect('wpp_chats', { filters: { instance: inst, jid }, single: true });
        if (chat) await dbUpdate('wpp_chats', { id: chat.id }, { unread_count: 0 });
      }

      return j(msgs, 200, req);
    }

    // ── SEND: send via Evolution + save chat in Supabase ────
    if (action === 'send') {
      const number = (body.number || '').replace(/\D/g, '');
      const text = body.text || '';
      if (!number || !text) return jsonError('number e text obrigatorios', 400, req);

      const r = await evo('POST', '/message/sendText/' + inst, { number, text });

      // Save/update chat in Supabase (non-blocking)
      const jid = number + '@s.whatsapp.net';
      upsertChat(inst, jid, {
        name: body.contactName || number,
        last_message: text.substring(0, 200),
        unread_count: 0
      }).catch(() => {});

      return j(r.data, 200, req);
    }

    // ── SEND BULK ───────────────────────────────────────────
    if (action === 'sendBulk') {
      const messages = body.messages || [];
      const results = [];
      for (const m of messages) {
        const num = (m.number || '').replace(/\D/g, '');
        try {
          const r = await evo('POST', '/message/sendText/' + inst, { number: num, text: m.text });
          results.push({ number: m.number, ok: r.ok, data: r.data });
          // Save chat
          await upsertChat(inst, num + '@s.whatsapp.net', {
            name: m.contactName || num,
            last_message: (m.text || '').substring(0, 200)
          });
        } catch (e) { results.push({ number: m.number, ok: false, error: 'Erro no envio' }); }
        await new Promise(r => setTimeout(r, 1500));
      }
      return j({ results }, 200, req);
    }

    // ── UPDATE CHAT: update chat metadata in Supabase ───────
    if (action === 'updateChat') {
      const jid = body.jid || '';
      if (!jid || !inst) return jsonError('jid e instance obrigatorios', 400, req);

      const { data: chat } = await dbSelect('wpp_chats', { filters: { instance: inst, jid }, single: true });
      if (!chat) return jsonError('Chat nao encontrado', 404, req);

      const updates = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.status !== undefined) updates.status = body.status;
      if (body.cpf !== undefined) updates.cpf = body.cpf;
      if (body.tags !== undefined) updates.tags = body.tags;
      if (body.notes !== undefined) updates.notes = body.notes;
      if (body.assigned_to !== undefined) updates.assigned_to = body.assigned_to;

      if (Object.keys(updates).length === 0) return jsonError('Nada pra atualizar', 400, req);

      await dbUpdate('wpp_chats', { id: chat.id }, updates);
      return j({ ok: true }, 200, req);
    }

    // ── WEBHOOK: Evolution sends incoming messages here ──────
    if (action === 'webhook') {
      const event = body.event || '';
      const data = body.data || {};

      if (event === 'messages.upsert') {
        const msg = data.message || data;
        const key = msg.key || {};
        const jid = key.remoteJid || '';
        const instance = data.instance || inst;

        if (jid && !jid.includes('@g.us') && !key.fromMe) {
          const text = msg.message?.conversation
            || msg.message?.extendedTextMessage?.text
            || msg.message?.imageMessage ? '📷 Imagem'
            : msg.message?.audioMessage ? '🎤 Audio'
            : msg.message?.videoMessage ? '🎥 Video'
            : msg.message?.documentMessage ? '📎 Documento'
            : '';
          const name = msg.pushName || key.remoteJid?.replace('@s.whatsapp.net', '') || '';

          // Get current unread count and increment
          const { data: existing } = await dbSelect('wpp_chats', { filters: { instance, jid }, single: true });
          const newUnread = (existing?.unread_count || 0) + 1;

          await upsertChat(instance, jid, {
            name: name || existing?.name || '',
            last_message: (typeof text === 'string' ? text : '').substring(0, 200),
            unread_count: newUnread
          });
        }
      }

      return j({ ok: true }, 200, req);
    }

    return jsonError('action invalida', 400, req);
  } catch (err) {
    return j({ error: 'Erro interno' }, 500, req);
  }
}
