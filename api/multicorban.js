export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }

  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  try {
    const body = await req.json();
    const beneficio = body.beneficio;
    if (!beneficio) return new Response(JSON.stringify({ error: 'Benefício obrigatório' }), { status: 400, headers: cors });

    const res = await fetch('https://api.multicorban.com/offline', {
      method: 'POST',
      headers: {
        'Authorization': '7ab2aedde1d41a07b52d763e7b351c6a',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ beneficio: String(beneficio).trim() })
    });

    if (!res.ok) {
      const errText = await res.text();
      return new Response(JSON.stringify({ error: `Multicorban ${res.status}`, detail: errText.substring(0, 300) }), { status: res.status, headers: cors });
    }

    const data = await res.json();
    return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: cors });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: cors });
  }
}
