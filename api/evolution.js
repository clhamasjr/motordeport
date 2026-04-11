export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';

function getConfig() {
  return {
    URL: process.env.EVOLUTION_URL,
    KEY: process.env.EVOLUTION_KEY
  };
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

const j = (data, status = 200, req = null) => jsonResp(data, status, req);

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  try {
    const body = req.method === 'POST' ? await req.json() : {};
    const action = body.action || '';
    const inst = body.instance || '';

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
      return j({ success: r.ok, name, qrcode: qrBase64, instance: d.instance || d, hash: d.hash || null }, 200, req);
    }

    if (action === 'delete') {
      if (!inst) return jsonError('instance obrigatorio', 400, req);
      const r = await evo('DELETE', '/instance/delete/' + inst);
      return j(r.data, 200, req);
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

    if (action === 'chats') {
      // Try multiple Evolution API endpoints/formats
      let chats = [];

      // 1. POST /chat/findChats (v2 standard)
      const r1 = await evo('POST', '/chat/findChats/' + inst, {});
      if (Array.isArray(r1.data) && r1.data.length > 0) {
        chats = r1.data;
      }

      // 2. Fallback: GET /chat/findChats
      if (!chats.length) {
        const r2 = await evo('GET', '/chat/findChats/' + inst);
        if (Array.isArray(r2.data) && r2.data.length > 0) chats = r2.data;
      }

      // 3. Fallback: POST with where clause (some v2 versions need this)
      if (!chats.length) {
        const r3 = await evo('POST', '/chat/findChats/' + inst, { where: {} });
        if (Array.isArray(r3.data) && r3.data.length > 0) chats = r3.data;
      }

      // 4. Fallback: try /chat/findContacts to get at least contacts
      if (!chats.length) {
        const r4 = await evo('POST', '/chat/findContacts/' + inst, {});
        if (Array.isArray(r4.data) && r4.data.length > 0) {
          chats = r4.data.filter(c => c.id && !c.id.includes('@g.us')).map(c => ({
            id: c.id || c.remoteJid || '',
            name: c.pushName || c.name || c.verifiedName || '',
            lastMsgTimestamp: 0,
            unreadMessages: 0,
            _fromContacts: true
          }));
        }
      }

      return j(chats, 200, req);
    }

    if (action === 'messages') {
      // Try POST then GET for messages
      const r = await evo('POST', '/chat/findMessages/' + inst, { where: { key: { remoteJid: body.jid || '' } }, limit: body.limit || 50 });
      let msgs = r.data;

      // Fallback: some v2 versions use different structure
      if (!Array.isArray(msgs) || msgs.length === 0) {
        if (msgs && msgs.messages) msgs = msgs.messages;
        else if (msgs && msgs.records) msgs = msgs.records;
      }

      // Fallback: try GET endpoint
      if (!Array.isArray(msgs) || msgs.length === 0) {
        const r2 = await evo('GET', '/chat/findMessages/' + inst + '?where[key][remoteJid]=' + encodeURIComponent(body.jid || '') + '&limit=' + (body.limit || 50));
        if (Array.isArray(r2.data)) msgs = r2.data;
        else if (r2.data && r2.data.messages) msgs = r2.data.messages;
      }

      return j(msgs, 200, req);
    }

    if (action === 'send') {
      const number = (body.number || '').replace(/\D/g, '');
      const text = body.text || '';
      if (!number || !text) return jsonError('number e text obrigatorios', 400, req);
      const r = await evo('POST', '/message/sendText/' + inst, { number, text });
      return j(r.data, 200, req);
    }

    if (action === 'sendBulk') {
      const messages = body.messages || [];
      const results = [];
      for (const m of messages) {
        try {
          const r = await evo('POST', '/message/sendText/' + inst, { number: (m.number || '').replace(/\D/g, ''), text: m.text });
          results.push({ number: m.number, ok: r.ok, data: r.data });
        } catch (e) { results.push({ number: m.number, ok: false, error: 'Erro no envio' }); }
        await new Promise(r => setTimeout(r, 1500));
      }
      return j({ results }, 200, req);
    }

    return jsonError('action invalida', 400, req);
  } catch (err) {
    return j({ error: 'Erro interno' }, 500, req);
  }
}
