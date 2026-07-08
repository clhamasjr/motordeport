// ═══════════════════════════════════════════════════════════════
// FACTA Proxy — Relay transparente
// Roda no escritorio (IP autorizado na FACTA), repassa requisicoes
// vindas do Vercel. Autenticado via header X-Proxy-Key.
// ═══════════════════════════════════════════════════════════════

// Carrega .env (sem dependencia externa)
const fs = require('fs');
const path = require('path');
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
      if (m && !process.env[m[1]]) {
        let v = m[2];
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        process.env[m[1]] = v;
      }
    });
    console.log('[env] .env carregado');
  }
} catch (e) { console.warn('[env] erro ao carregar .env:', e.message); }

const express = require('express');
const app = express();

app.use(express.json({ limit: '10mb' }));

const SECRET = process.env.FACTA_PROXY_SECRET || '';
const FACTA_BASE = process.env.FACTA_BASE_URL || 'https://webservice-homol.facta.com.br';
const PORT = process.env.PORT || 3456;

// Bases permitidas pro relay (o cliente pode pedir outra base via body.baseUrl).
// Serve pra rotear tanto FACTA quanto o portal Fintech do Corban (nemesys),
// que bloqueia IP de data-center do Vercel — daqui sai com IP residencial.
const ALLOWED_BASES = [
  'https://webservice.facta.com.br',
  'https://webservice-homol.facta.com.br',
  'https://fintechdocorban.nossafintech.com.br',
  FACTA_BASE,
];

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

  const { method = 'GET', path = '', headers = {}, body = null, contentType = null, baseUrl = null } = req.body || {};

  if (!path || !path.startsWith('/')) {
    return res.status(400).json({ error: 'path invalido' });
  }

  // Base do alvo: default FACTA; se o cliente pedir outra, só aceita se estiver
  // na allowlist (evita virar proxy aberto).
  let base = FACTA_BASE;
  if (baseUrl) {
    const b = String(baseUrl).replace(/\/$/, '');
    if (ALLOWED_BASES.some((a) => b === a.replace(/\/$/, ''))) base = b;
    else return res.status(400).json({ error: 'baseUrl nao permitida' });
  }

  const targetUrl = base + path;
  const fwdHeaders = { ...headers };
  if (contentType) fwdHeaders['Content-Type'] = contentType;
  // Headers COMPLETOS de navegador Chrome pra passar bot-management do Cloudflare
  if (!fwdHeaders['User-Agent'] && !fwdHeaders['user-agent']) {
    fwdHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }
  if (!fwdHeaders['Accept']) fwdHeaders['Accept'] = 'application/json, text/plain, */*';
  if (!fwdHeaders['Accept-Language']) fwdHeaders['Accept-Language'] = 'pt-BR,pt;q=0.9,en;q=0.8';
  if (!fwdHeaders['Accept-Encoding']) fwdHeaders['Accept-Encoding'] = 'gzip, deflate, br';
  // Client-hints (o principal sinal "sou Chrome de verdade" que o CF checa)
  if (!fwdHeaders['sec-ch-ua']) fwdHeaders['sec-ch-ua'] = '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"';
  if (!fwdHeaders['sec-ch-ua-mobile']) fwdHeaders['sec-ch-ua-mobile'] = '?0';
  if (!fwdHeaders['sec-ch-ua-platform']) fwdHeaders['sec-ch-ua-platform'] = '"Windows"';
  if (!fwdHeaders['sec-fetch-dest']) fwdHeaders['sec-fetch-dest'] = 'empty';
  if (!fwdHeaders['sec-fetch-mode']) fwdHeaders['sec-fetch-mode'] = 'cors';
  if (!fwdHeaders['sec-fetch-site']) fwdHeaders['sec-fetch-site'] = 'same-origin';
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
    // Repassa headers de diagnostico do Cloudflare da FACTA (pra sabermos o tipo de bloqueio)
    res.set('x-upstream-cf-ray', r.headers.get('cf-ray') || '');
    res.set('x-upstream-cf-mitigated', r.headers.get('cf-mitigated') || '');
    res.set('x-upstream-server', r.headers.get('server') || '');
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
