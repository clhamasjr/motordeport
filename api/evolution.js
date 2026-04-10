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
      const r = await evo('POST', '/chat/findChats/' + inst, {});
      return j(r.data, 200, req);
    }

    if (action === 'messages') {
      const r = await evo('POST', '/chat/findMessages/' + inst, { where: { key: { remoteJid: body.jid || '' } }, limit: body.limit || 50 });
      return j(r.data, 200, req);
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
