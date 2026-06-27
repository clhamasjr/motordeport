// ══════════════════════════════════════════════════════════════════
// api/healthcheck-cron.js
// CRON — monitora a saúde das CONSULTAS (CLT e INSS) 24h.
//
// Roda a cada 5min (Vercel Cron). Pra cada módulo:
//   1. Bate nos endpoints dos bancos via {action:'test'} (chamada interna)
//   2. Decide se o módulo está OK ou DOWN (banco crítico responde?)
//   3. Compara com o último estado salvo em `healthcheck_estado`
//   4. SÓ na MUDANÇA (ok→down ou down→ok) dispara WhatsApp pro dono
//   5. Atualiza o estado
//
// Não spamma: avisa só na transição. Mensagem de "voltou" inclui o
// tempo que ficou fora.
//
// Env necessárias:
//   WEBHOOK_SECRET            — pra autenticar chamada interna aos bancos
//   CRON_SECRET               — header do Vercel Cron
//   EVOLUTION_URL / EVOLUTION_KEY
//   HEALTHCHECK_ALERT_NUMBER  — número que recebe o alerta (só dígitos)
//   HEALTHCHECK_INSTANCE      — instância Evolution (default: CLT)
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions } from './_lib/auth.js';
import { dbSelect, dbUpsert } from './_lib/supabase.js';

const EVO_URL = () => process.env.EVOLUTION_URL;
const EVO_KEY = () => process.env.EVOLUTION_KEY;
const INSTANCE = () => process.env.HEALTHCHECK_INSTANCE || process.env.CLT_EVOLUTION_INSTANCE || 'lhamas-clt';
const ALERT_NUMBER = () => (process.env.HEALTHCHECK_ALERT_NUMBER || '').replace(/\D/g, '');

// ── Módulos monitorados ────────────────────────────────────────────
// critico = se ESTE banco cair, o módulo é considerado fora do ar.
// Os demais são informativos (entram no detalhe, mas não derrubam sozinhos).
const MODULOS = [
  {
    key: 'consulta_inss',
    label: 'Consulta INSS',
    bancos: [
      { ep: 'multicorban', action: 'test', critico: true },
      { ep: 'facta', action: 'test', critico: false },
    ],
  },
  {
    key: 'consulta_clt',
    label: 'Consulta CLT',
    bancos: [
      { ep: 'c6', action: 'test', critico: true },
      { ep: 'presencabank', action: 'test', critico: false },
      { ep: 'v8', action: 'test', critico: false },
      { ep: 'handbank', action: 'status', critico: false },
      { ep: 'mercantil', action: 'test', critico: false },
    ],
  },
];

// ── Ping interno num banco ──────────────────────────────────────────
async function pingBanco(origin, ep, action, secret) {
  try {
    const r = await fetch(`${origin}/api/${ep}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': secret,
      },
      body: JSON.stringify({ action }),
      signal: AbortSignal.timeout(8000),
    });
    let d = {};
    try { d = await r.json(); } catch {}
    const negou = !r.ok || d?.error || d?.success === false || d?.ok === false;
    return { ep, ok: !negou, msg: negou ? String(d?.error || `HTTP ${r.status}`) : null };
  } catch (e) {
    return { ep, ok: false, msg: e?.name === 'TimeoutError' ? 'timeout' : (e?.message || 'erro') };
  }
}

// ── WhatsApp ────────────────────────────────────────────────────────
async function sendWhats(text) {
  const num = ALERT_NUMBER();
  if (!num || !EVO_URL() || !EVO_KEY()) return false;
  try {
    const r = await fetch(`${EVO_URL()}/message/sendText/${INSTANCE()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVO_KEY() },
      body: JSON.stringify({ number: num, text }),
      signal: AbortSignal.timeout(8000),
    });
    return r.ok;
  } catch { return false; }
}

function fmtHora() {
  return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
}

function fmtDuracao(desdeIso) {
  if (!desdeIso) return '';
  const ms = Date.now() - new Date(desdeIso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  return `${h}h${String(min % 60).padStart(2, '0')}`;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  // Auth: Vercel cron (CRON_SECRET) OU chamada interna (WEBHOOK_SECRET)
  const cronSecret = process.env.CRON_SECRET;
  const webhookSecret = process.env.WEBHOOK_SECRET || '';
  const auth = req.headers.get('authorization') || '';
  const internal = req.headers.get('x-internal-secret') || '';
  const isVercelCron = cronSecret && auth === `Bearer ${cronSecret}`;
  const isInternal = webhookSecret && internal === webhookSecret;
  if (!isVercelCron && !isInternal) {
    return jsonError('Unauthorized — cron only', 401, req);
  }

  if (!webhookSecret) {
    return jsonError('WEBHOOK_SECRET ausente — cron não consegue chamar os bancos', 500, req);
  }

  const origin = new URL(req.url).origin;
  const nowIso = new Date().toISOString();
  const resultado = [];

  for (const mod of MODULOS) {
    // pinga todos os bancos do módulo em paralelo
    const pings = await Promise.all(
      mod.bancos.map((b) => pingBanco(origin, b.ep, b.action, webhookSecret)),
    );
    const byEp = Object.fromEntries(pings.map((p) => [p.ep, p]));
    const critico = mod.bancos.find((b) => b.critico);
    const criticoPing = critico ? byEp[critico.ep] : null;

    // módulo down se o crítico falhou; senão ok
    const statusAtual = criticoPing && !criticoPing.ok ? 'down' : 'ok';
    const caidos = pings.filter((p) => !p.ok);
    const detalhe = caidos.length
      ? caidos.map((p) => `${p.ep}: ${p.msg}`).join(' · ')
      : 'todos respondendo';

    // estado anterior
    let anterior = null;
    try {
      anterior = await dbSelect('healthcheck_estado', { filters: { modulo: mod.key }, single: true });
    } catch {}
    const statusAntes = anterior?.status || null;
    const mudou = statusAntes !== null && statusAntes !== statusAtual;
    // 'desde' = quando o status atual começou (mantém se não mudou)
    const desde = mudou || !anterior ? nowIso : anterior.desde;

    // alerta só na transição
    if (mudou) {
      if (statusAtual === 'down') {
        await sendWhats(`🔴 *FlowForce* — ${mod.label} CAIU\n${detalhe}\n🕐 ${fmtHora()}`);
      } else {
        const fora = fmtDuracao(anterior?.desde);
        await sendWhats(`🟢 *FlowForce* — ${mod.label} VOLTOU${fora ? `\nFicou fora por ${fora}` : ''}\n🕐 ${fmtHora()}`);
      }
    }

    try {
      await dbUpsert('healthcheck_estado', {
        modulo: mod.key,
        label: mod.label,
        status: statusAtual,
        detalhe,
        desde,
        ultimo_check: nowIso,
      }, 'modulo');
    } catch {}

    resultado.push({ modulo: mod.key, status: statusAtual, mudou, detalhe });
  }

  return jsonResp({ ok: true, verificadoEm: nowIso, modulos: resultado }, 200, req);
}
