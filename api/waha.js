export const config = { runtime: 'edge' };

// ══════════════════════════════════════════════════════════════════
// api/waha.js — Backend WhatsApp via WAHA (WhatsApp HTTP API Core)
// Docs: https://waha.devlike.pro/docs/overview/introduction/
// Substitui api/evolution.js mantendo a mesma interface p/ o frontend
// ══════════════════════════════════════════════════════════════════

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';
import { dbSelect, dbInsert, dbUpdate, dbQuery } from './_lib/supabase.js';

function getConfig() {
  return {
    URL: (process.env.WAHA_URL || 'https://waha.cbdw.com.br').replace(/\/+$/, ''),
    KEY: process.env.WAHA_KEY || ''
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

// Chamada HTTP à WAHA com timeout
async function waha(method, path, body, timeoutMs = 15000) {
  const cfg = getConfig();
  if (!cfg.URL) throw new Error('WAHA_URL nao configurado');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  if (cfg.KEY) headers['X-Api-Key'] = cfg.KEY;
  const opts = { method, headers, signal: ctrl.signal };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  try {
    const r = await fetch(cfg.URL + path, opts);
    clearTimeout(timer);
    const t = await r.text();
    let d; try { d = JSON.parse(t); } catch { d = t ? { raw: t.substring(0, 1000) } : {}; }
    return { ok: r.ok, status: r.status, data: d };
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') return { ok: false, status: 408, data: { error: 'Timeout: WAHA nao respondeu em ' + (timeoutMs/1000) + 's' } };
    throw e;
  }
}

// Helper: converte numero para chatId WAHA (@c.us)
function toChatId(num) {
  const clean = String(num).replace(/\D/g, '');
  if (!clean) return '';
  return clean.includes('@') ? clean : clean + '@c.us';
}

// Helper: normaliza session info (WAHA usa "status": WORKING/STARTING/SCAN_QR_CODE/STOPPED/FAILED)
function normalizeStatus(wahaStatus) {
  const s = String(wahaStatus || '').toUpperCase();
  if (s === 'WORKING') return 'open';
  if (s === 'SCAN_QR_CODE') return 'connecting';
  if (s === 'STARTING') return 'connecting';
  if (s === 'STOPPED') return 'close';
  if (s === 'FAILED') return 'close';
  return String(wahaStatus || 'unknown').toLowerCase();
}

// Upsert chat in Supabase
async function upsertChat(session, chatId, updates) {
  const phone = chatId.replace(/@(c\.us|s\.whatsapp\.net|g\.us)$/, '');
  const existing = await dbSelect('wpp_chats', { filters: { instance: session, jid: chatId }, single: true });
  if (existing.data) {
    await dbUpdate('wpp_chats', { id: existing.data.id }, { ...updates, last_message_at: new Date().toISOString() });
    return existing.data.id;
  }
  const { data } = await dbInsert('wpp_chats', {
    instance: session, jid: chatId, phone,
    name: updates.name || phone,
    last_message: updates.last_message || '',
    last_message_at: new Date().toISOString(),
    unread_count: updates.unread_count || 0,
    status: 'aberto'
  });
  return data?.id;
}

const j = (data, status = 200, req = null) => jsonResp(data, status, req);

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  // Webhook endpoint (sem auth)
  if (req.method === 'POST') {
    const url = new URL(req.url);
    if (url.searchParams.get('webhook') === '1') {
      try {
        const body = await req.json();
        const event = body.event || '';
        const session = body.session || '';
        const payload = body.payload || {};
        // TODO: processar eventos (message, message.any, session.status, etc)
        console.log('[WAHA Webhook]', event, session, JSON.stringify(payload).substring(0, 200));
        return j({ ok: true }, 200, req);
      } catch { return j({ ok: false }, 200, req); }
    }
  }

  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  try {
    const body = req.method === 'POST' ? await req.json() : {};
    const action = body.action || '';
    const session = body.instance || body.session || '';

    // ── Session management ─────────────────────────────────
    if (action === 'list') {
      const r = await waha('GET', '/api/sessions');
      const arr = Array.isArray(r.data) ? r.data : [];
      // Normaliza p/ formato do Evolution (instanceName, connectionStatus)
      const mapped = arr.map(s => ({
        name: s.name,
        instanceName: s.name,
        instance: { instanceName: s.name, state: normalizeStatus(s.status) },
        connectionStatus: normalizeStatus(s.status),
        status: s.status,
        me: s.me || null,
        engine: s.engine || null
      }));
      return j(mapped, 200, req);
    }

    if (action === 'create') {
      const name = body.name || '';
      if (!name) return jsonError('Nome obrigatorio', 400, req);
      // Cria sessão (WAHA Core cria com POST /api/sessions)
      const webhookUrl = (process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : '') + '/api/waha?webhook=1';
      const cfg = {
        name,
        start: true,
        config: {
          webhooks: webhookUrl.startsWith('https://') ? [{
            url: webhookUrl,
            events: ['message', 'message.any', 'session.status']
          }] : []
        }
      };
      const r = await waha('POST', '/api/sessions', cfg, 20000);
      if (!r.ok) return j({ success: false, error: r.data?.message || 'Falha ao criar sessao', detail: r.data }, 200, req);

      // Aguarda um pouco e tenta buscar o QR
      await new Promise(res => setTimeout(res, 1500));
      let qrBase64 = null;
      try {
        const qr = await waha('GET', `/api/${name}/auth/qr?format=image`, null, 10000);
        if (qr.ok && qr.data?.data) qrBase64 = 'data:image/png;base64,' + qr.data.data;
        else if (qr.ok && qr.data?.mimetype) qrBase64 = `data:${qr.data.mimetype};base64,${qr.data.data}`;
      } catch {}

      return j({ success: true, name, qrcode: qrBase64, instance: { instanceName: name }, session: r.data }, 200, req);
    }

    if (action === 'delete') {
      if (!session) return jsonError('instance obrigatorio', 400, req);
      const force = body.force || false;

      // Primeiro tenta stop, depois logout, depois delete
      try { await waha('POST', `/api/sessions/${session}/stop`, {}, 3000); } catch {}
      if (force) { try { await waha('POST', `/api/sessions/${session}/logout`, {}, 3000); } catch {} }
      const r = await waha('DELETE', `/api/sessions/${session}`, null, 5000);
      if (r.ok) return j({ ok: true, method: force ? 'force' : 'direct' }, 200, req);
      return j({ ok: false, error: r.data?.message || 'Delete failed', status: r.status, canLocalRemove: true }, 200, req);
    }

    if (action === 'status') {
      if (!session) return jsonError('instance obrigatorio', 400, req);
      const r = await waha('GET', `/api/sessions/${session}`);
      const s = r.data || {};
      return j({
        instance: { state: normalizeStatus(s.status), instanceName: session },
        state: normalizeStatus(s.status),
        status: s.status,
        me: s.me
      }, 200, req);
    }

    if (action === 'connect') {
      if (!session) return jsonError('instance obrigatorio', 400, req);
      // No WAHA o QR é obtido com GET /api/{session}/auth/qr
      try { await waha('POST', `/api/sessions/${session}/start`, {}, 5000); } catch {}
      await new Promise(res => setTimeout(res, 1000));
      const qr = await waha('GET', `/api/${session}/auth/qr?format=image`, null, 10000);
      let qrBase64 = null;
      if (qr.ok && qr.data?.data) {
        const mime = qr.data.mimetype || 'image/png';
        qrBase64 = `data:${mime};base64,${qr.data.data}`;
      }
      return j({ qrcode: qrBase64, base64: qrBase64 }, 200, req);
    }

    if (action === 'restart') {
      if (!session) return jsonError('instance obrigatorio', 400, req);
      const r = await waha('POST', `/api/sessions/${session}/restart`, {}, 10000);
      return j({ ok: r.ok, data: r.data }, r.ok ? 200 : 500, req);
    }

    if (action === 'logout') {
      if (!session) return jsonError('instance obrigatorio', 400, req);
      const r = await waha('POST', `/api/sessions/${session}/logout`, {}, 5000);
      return j({ ok: r.ok, data: r.data }, 200, req);
    }

    // ── Messaging ──────────────────────────────────────────
    if (action === 'send') {
      if (!session) return jsonError('instance obrigatorio', 400, req);
      const number = body.number || '';
      const text = body.text || body.content || '';
      if (!number || !text) return jsonError('number e text obrigatorios', 400, req);

      // Verifica status antes
      let statusR = await waha('GET', `/api/sessions/${session}`, null, 3000);
      const state = normalizeStatus(statusR.data?.status);
      if (state !== 'open') return j({ ok: false, error: 'Sessao nao conectada', state, status: 503 }, 200, req);

      const chatId = toChatId(number);
      const r = await waha('POST', '/api/sendText', { session, chatId, text }, 10000);
      return j({ ok: r.ok, delivered: r.ok, status: r.status, data: r.data }, 200, req);
    }

    if (action === 'sendAsync') {
      if (!session) return jsonError('instance obrigatorio', 400, req);
      const number = body.number || '';
      const text = body.text || body.content || '';
      if (!number || !text) return jsonError('number e text obrigatorios', 400, req);

      const chatId = toChatId(number);
      // Fire-and-forget: não aguarda resposta
      try {
        waha('POST', '/api/sendText', { session, chatId, text }, 3000).catch(() => {});
      } catch {}
      return j({ ok: true, queued: true }, 200, req);
    }

    if (action === 'debugSend') {
      if (!session) return jsonError('instance obrigatorio', 400, req);
      const number = body.number || '';
      const text = body.text || 'teste';
      const chatId = toChatId(number);
      const results = [];
      // WAHA tem basicamente um formato só: sendText
      try {
        const r = await waha('POST', '/api/sendText', { session, chatId, text }, 5000);
        results.push({ format: 'sendText {session,chatId,text}', ok: r.ok, status: r.status, data: r.data });
      } catch (e) { results.push({ format: 'sendText', error: e.message }); }
      // Status
      let sessionStatus = null;
      try {
        const s = await waha('GET', `/api/sessions/${session}`, null, 3000);
        sessionStatus = s.data?.status;
      } catch {}
      return j({ results, sessionStatus, chatId }, 200, req);
    }

    // ── Chats & Messages ──────────────────────────────────
    if (action === 'chats' || action === 'findChats') {
      if (!session) return jsonError('instance obrigatorio', 400, req);
      const limit = body.limit || 50;
      const r = await waha('GET', `/api/${session}/chats?limit=${limit}`);
      const chats = Array.isArray(r.data) ? r.data : [];
      // Normaliza
      const mapped = chats.map(c => ({
        id: c.id,
        jid: c.id,
        name: c.name || c.id.replace(/@c\.us$/, ''),
        lastMessage: c.lastMessage?.body || '',
        lastMsgTimestamp: c.lastMessage?.timestamp || c.timestamp || 0,
        unreadMessages: c.unreadCount || 0
      }));
      return j(mapped, 200, req);
    }

    if (action === 'messages' || action === 'findMessages') {
      if (!session) return jsonError('instance obrigatorio', 400, req);
      const chatId = toChatId(body.jid || body.number || body.chatId || '');
      const limit = body.limit || 50;
      if (!chatId) return jsonError('jid/number obrigatorio', 400, req);
      const r = await waha('GET', `/api/${session}/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}&downloadMedia=false`);
      const msgs = Array.isArray(r.data) ? r.data : [];
      const mapped = msgs.map(m => ({
        id: m.id,
        from: m.from,
        to: m.to,
        body: m.body || '',
        fromMe: !!m.fromMe,
        timestamp: m.timestamp,
        type: m.type || 'chat',
        ack: m.ack
      }));
      return j(mapped, 200, req);
    }

    // ── Webhook management ───────────────────────────────
    if (action === 'diagnose') {
      if (!session) return jsonError('instance obrigatorio', 400, req);
      const result = { instance: session, engine: 'WAHA' };
      try {
        const s = await waha('GET', `/api/sessions/${session}`, null, 5000);
        result.session = s.data;
        result.connectionState = normalizeStatus(s.data?.status);
        result.webhooks = s.data?.config?.webhooks || [];
        result.webhookUrl = result.webhooks[0]?.url || null;
      } catch (e) { result.error = e.message; }
      return j(result, 200, req);
    }

    if (action === 'setWebhook') {
      if (!session) return jsonError('instance obrigatorio', 400, req);
      const webhookUrl = body.url || ((process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : '') + '/api/waha?webhook=1');
      // WAHA Core: precisa recriar a sessão com o webhook atualizado
      // Primeiro pega config atual
      const s = await waha('GET', `/api/sessions/${session}`);
      const curCfg = s.data?.config || {};
      curCfg.webhooks = [{ url: webhookUrl, events: ['message', 'message.any', 'session.status'] }];
      const r = await waha('PUT', `/api/sessions/${session}`, { config: curCfg }, 10000);
      return j({ ok: r.ok, data: r.data, webhookUrl }, 200, req);
    }

    // ── Chatwoot integration (mantém compat) ─────────────
    if (action === 'setupChatwoot') {
      if (!session) return jsonError('instance obrigatorio', 400, req);
      const cwCfg = getCwConfig();
      if (!cwCfg.url || !cwCfg.token) return jsonError('Chatwoot nao configurado', 400, req);
      const existingR = await cwApi('GET', '/inboxes');
      const existing = existingR?.data?.payload || [];
      const found = existing.find(i => (i.name || '').toLowerCase().includes(session.toLowerCase()));
      if (found) return j({ ok: true, inbox: found, message: 'Inbox ja existe' }, 200, req);
      const inboxR = await cwApi('POST', '/inboxes', {
        name: 'WhatsApp ' + session,
        channel: { type: 'api', webhook_url: '' }
      });
      if (!inboxR || !inboxR.ok) return j({ ok: false, error: 'Erro ao criar inbox' }, 500, req);
      return j({ ok: true, inbox: inboxR.data, message: 'Inbox Chatwoot criada (webhook manual)' }, 200, req);
    }

    return jsonError('action invalida: ' + action, 400, req);
  } catch (e) {
    return j({ error: e.message || 'Erro interno' }, 500, req);
  }
}
