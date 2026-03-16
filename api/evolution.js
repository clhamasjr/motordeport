export const config = { runtime: 'edge' };

const EVO_URL = 'https://evo.cbdw.com.br';
const EVO_KEY = '17441d2e2da8e81a3b0499cfe6a22d14';

const H = { 'Content-Type': 'application/json', 'apikey': EVO_KEY };

async function evo(method, path, body) {
  const opts = { method, headers: { ...H } };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const r = await fetch(EVO_URL + path, opts);
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 500) }; }
  return { ok: r.ok, status: r.status, data: d };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,GET', 'Access-Control-Allow-Headers': 'Content-Type' } });
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  try {
    const body = req.method === 'POST' ? await req.json() : {};
    const action = body.action || '';
    const inst = body.instance || '';

    // List all instances
    if (action === 'list') {
      const r = await evo('GET', '/instance/fetchInstances');
      return new Response(JSON.stringify(r.data), { headers: cors });
    }

    // Create instance
    if (action === 'create') {
      const name = body.name || '';
      if (!name) return new Response(JSON.stringify({ error: 'Nome obrigatório' }), { status: 400, headers: cors });
      const r = await evo('POST', '/instance/create', {
        instanceName: name,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
        rejectCall: false,
        groupsIgnore: true
      });
      return new Response(JSON.stringify(r.data), { headers: cors });
    }

    // Delete instance
    if (action === 'delete') {
      if (!inst) return new Response(JSON.stringify({ error: 'instance obrigatório' }), { status: 400, headers: cors });
      const r = await evo('DELETE', '/instance/delete/' + inst);
      return new Response(JSON.stringify(r.data), { headers: cors });
    }

    // Connection state
    if (action === 'status') {
      if (!inst) return new Response(JSON.stringify({ error: 'instance obrigatório' }), { status: 400, headers: cors });
      const r = await evo('GET', '/instance/connectionState/' + inst);
      return new Response(JSON.stringify(r.data), { headers: cors });
    }

    // Connect (get QR)
    if (action === 'connect') {
      if (!inst) return new Response(JSON.stringify({ error: 'instance obrigatório' }), { status: 400, headers: cors });
      const r = await evo('GET', '/instance/connect/' + inst);
      return new Response(JSON.stringify(r.data), { headers: cors });
    }

    // Restart
    if (action === 'restart') {
      if (!inst) return new Response(JSON.stringify({ error: 'instance obrigatório' }), { status: 400, headers: cors });
      const r = await evo('PUT', '/instance/restart/' + inst);
      return new Response(JSON.stringify(r.data), { headers: cors });
    }

    // Logout (disconnect WhatsApp)
    if (action === 'logout') {
      if (!inst) return new Response(JSON.stringify({ error: 'instance obrigatório' }), { status: 400, headers: cors });
      const r = await evo('DELETE', '/instance/logout/' + inst);
      return new Response(JSON.stringify(r.data), { headers: cors });
    }

    // Fetch chats
    if (action === 'chats') {
      const r = await evo('POST', '/chat/findChats/' + inst, {});
      return new Response(JSON.stringify(r.data), { headers: cors });
    }

    // Fetch messages
    if (action === 'messages') {
      const r = await evo('POST', '/chat/findMessages/' + inst, {
        where: { key: { remoteJid: body.jid || '' } },
        limit: body.limit || 50
      });
      return new Response(JSON.stringify(r.data), { headers: cors });
    }

    // Send text
    if (action === 'send') {
      const number = (body.number || '').replace(/\D/g, '');
      const text = body.text || '';
      if (!number || !text) return new Response(JSON.stringify({ error: 'number e text obrigatórios' }), { status: 400, headers: cors });
      const r = await evo('POST', '/message/sendText/' + inst, { number, text });
      return new Response(JSON.stringify(r.data), { headers: cors });
    }

    // Send bulk
    if (action === 'sendBulk') {
      const messages = body.messages || [];
      const results = [];
      for (const m of messages) {
        try {
          const r = await evo('POST', '/message/sendText/' + inst, {
            number: (m.number || '').replace(/\D/g, ''),
            text: m.text
          });
          results.push({ number: m.number, ok: r.ok, data: r.data });
        } catch (e) { results.push({ number: m.number, ok: false, error: e.message }); }
        await new Promise(r => setTimeout(r, 1500));
      }
      return new Response(JSON.stringify({ results }), { headers: cors });
    }

    return new Response(JSON.stringify({ error: 'action inválida' }), { status: 400, headers: cors });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: cors });
  }
}
