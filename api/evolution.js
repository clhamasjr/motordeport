export const config = { runtime: 'edge' };

const EVO_URL = 'https://evo.cbdw.com.br';
const EVO_KEY = '660BEFC543E9-43D5-914A-E4B264E976B9';

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,GET', 'Access-Control-Allow-Headers': 'Content-Type' } });
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  try {
    const body = req.method === 'POST' ? await req.json() : {};
    const action = body.action || new URL(req.url).searchParams.get('action') || '';
    const instance = body.instance || 'CB20';

    const headers = { 'Content-Type': 'application/json', 'apikey': EVO_KEY };

    // === CONNECTION ===
    if (action === 'status') {
      const r = await fetch(`${EVO_URL}/instance/connectionState/${instance}`, { headers });
      const d = await r.json();
      return new Response(JSON.stringify(d), { headers: cors });
    }

    if (action === 'qrcode') {
      const r = await fetch(`${EVO_URL}/instance/connect/${instance}`, { headers });
      const d = await r.json();
      return new Response(JSON.stringify(d), { headers: cors });
    }

    if (action === 'create') {
      const r = await fetch(`${EVO_URL}/instance/create`, {
        method: 'POST', headers,
        body: JSON.stringify({ instanceName: body.name || 'FlowForce', integration: 'WHATSAPP-BAILEYS', qrcode: true })
      });
      const d = await r.json();
      return new Response(JSON.stringify(d), { headers: cors });
    }

    if (action === 'logout') {
      const r = await fetch(`${EVO_URL}/instance/logout/${instance}`, { method: 'DELETE', headers });
      const d = await r.json();
      return new Response(JSON.stringify(d), { headers: cors });
    }

    // === CHATS ===
    if (action === 'chats') {
      const r = await fetch(`${EVO_URL}/chat/findChats/${instance}`, { method: 'POST', headers, body: JSON.stringify({}) });
      const d = await r.json();
      return new Response(JSON.stringify(d), { headers: cors });
    }

    // === MESSAGES ===
    if (action === 'messages') {
      const jid = body.jid || '';
      const r = await fetch(`${EVO_URL}/chat/findMessages/${instance}`, {
        method: 'POST', headers,
        body: JSON.stringify({ where: { key: { remoteJid: jid } }, limit: body.limit || 50 })
      });
      const d = await r.json();
      return new Response(JSON.stringify(d), { headers: cors });
    }

    // === SEND TEXT ===
    if (action === 'send') {
      const number = (body.number || '').replace(/\D/g, '');
      const text = body.text || '';
      if (!number || !text) return new Response(JSON.stringify({ error: 'number e text obrigatórios' }), { status: 400, headers: cors });
      const r = await fetch(`${EVO_URL}/message/sendText/${instance}`, {
        method: 'POST', headers,
        body: JSON.stringify({ number, text })
      });
      const d = await r.json();
      return new Response(JSON.stringify(d), { headers: cors });
    }

    // === SEND BULK (pipeline) ===
    if (action === 'sendBulk') {
      const messages = body.messages || []; // [{number, text}]
      const results = [];
      for (const m of messages) {
        try {
          const r = await fetch(`${EVO_URL}/message/sendText/${instance}`, {
            method: 'POST', headers,
            body: JSON.stringify({ number: (m.number || '').replace(/\D/g, ''), text: m.text })
          });
          const d = await r.json();
          results.push({ number: m.number, ok: r.ok, data: d });
        } catch (e) { results.push({ number: m.number, ok: false, error: e.message }); }
        await new Promise(r => setTimeout(r, 1500)); // rate limit
      }
      return new Response(JSON.stringify({ results }), { headers: cors });
    }

    // === PROFILE PIC ===
    if (action === 'pic') {
      const number = (body.number || '').replace(/\D/g, '');
      const r = await fetch(`${EVO_URL}/chat/fetchProfilePictureUrl/${instance}`, {
        method: 'POST', headers,
        body: JSON.stringify({ number })
      });
      const d = await r.json();
      return new Response(JSON.stringify(d), { headers: cors });
    }

    return new Response(JSON.stringify({ error: 'action inválida', actions: ['status', 'qrcode', 'create', 'logout', 'chats', 'messages', 'send', 'sendBulk', 'pic'] }), { status: 400, headers: cors });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: cors });
  }
}
