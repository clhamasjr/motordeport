// ═══════════════════════════════════════════════════════════════
// FACTA Proxy — Relay transparente
// Roda no escritorio (IP autorizado na FACTA), repassa requisicoes
// vindas do Vercel. Autenticado via header X-Proxy-Key.
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const app = express();

app.use(express.json({ limit: '10mb' }));

const SECRET = process.env.FACTA_PROXY_SECRET || '';
const FACTA_BASE = process.env.FACTA_BASE_URL || 'https://webservice-homol.facta.com.br';
const PORT = process.env.PORT || 3456;

if (!SECRET) {
  console.error('❌ FACTA_PROXY_SECRET nao configurado. Abortando.');
  process.exit(1);
}

// Health check (sem auth)
app.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), service: 'facta-proxy' });
});

// Testa egress (mostra IP publico de saida — para validar com a FACTA)
app.get('/ip', async (req, res) => {
  try {
    const r = await fetch('https://api.ipify.org?format=json');
    const d = await r.json();
    res.json({ outboundIp: d.ip, base: FACTA_BASE });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Relay principal — so aceita paths que comecam com "/" e vao pra FACTA
app.post('/relay', async (req, res) => {
  // Auth via secret compartilhado
  if (req.headers['x-proxy-key'] !== SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { method = 'GET', path = '', headers = {}, body = null, contentType = null } = req.body || {};

  if (!path || !path.startsWith('/')) {
    return res.status(400).json({ error: 'path invalido' });
  }

  const targetUrl = FACTA_BASE + path;
  const fwdHeaders = { ...headers };
  if (contentType) fwdHeaders['Content-Type'] = contentType;
  // Nao repassa hop-by-hop
  delete fwdHeaders.Host;
  delete fwdHeaders.host;
  delete fwdHeaders['content-length'];

  const opts = { method, headers: fwdHeaders };
  if (body !== null && body !== undefined && method !== 'GET') {
    opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  try {
    const started = Date.now();
    const r = await fetch(targetUrl, opts);
    const text = await r.text();
    const ms = Date.now() - started;
    console.log(`[${new Date().toISOString()}] ${method} ${path} -> ${r.status} (${ms}ms)`);
    res.status(r.status);
    const ct = r.headers.get('content-type');
    if (ct) res.set('Content-Type', ct);
    res.send(text);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] ${method} ${path} FAIL:`, e.message);
    res.status(502).json({ error: 'upstream_error', detail: e.message });
  }
});

app.listen(PORT, () => {
  console.log('═══════════════════════════════════════════════');
  console.log(`✅ FACTA Proxy rodando em http://localhost:${PORT}`);
  console.log(`   FACTA_BASE: ${FACTA_BASE}`);
  console.log(`   SECRET: ${SECRET.substring(0, 4)}*** (${SECRET.length} chars)`);
  console.log('   Health: GET /health');
  console.log('   IP check: GET /ip');
  console.log('   Relay: POST /relay (X-Proxy-Key required)');
  console.log('═══════════════════════════════════════════════');
});
