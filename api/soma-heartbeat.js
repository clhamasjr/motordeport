export const config = { runtime: 'edge' };

// ══════════════════════════════════════════════════════════════════
// api/soma-heartbeat.js — MANTÉM A SESSÃO DO PORTAL SOMA VIVA
//
// A sessão do portal SOMA (soma_portal_session) não tem refresh-token → o
// access-token dura ~15min e morre se ficar parada. Este cron "cutuca" a
// sessão a cada 10min (chama testPortal → portalCall → a SOMA renova o
// access-token no header da resposta), mantendo-a viva INDEFINIDAMENTE
// enquanto o operador bootstrapou 1x (grampo → setPortalSession).
//
// NÃO REVIVE sessão já morta (sem refresh-token não dá) — só evita que morra.
// Se estava morta, o retorno mostra loginPortal:'expirada' → recolar 1x.
//
// Cron: */10 * * * * (vercel.json). Auth: CRON_SECRET / x-internal-secret / admin.
// ══════════════════════════════════════════════════════════════════

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';

const APP_URL = () => process.env.APP_URL || 'https://flowforce.vercel.app';

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  const cronSecret = process.env.CRON_SECRET;
  const cronAuth = req.headers.get('authorization') || '';
  const internalSecret = req.headers.get('x-internal-secret') || '';
  const webhookSecret = process.env.WEBHOOK_SECRET || '';
  const isVercelCron = cronSecret && cronAuth === `Bearer ${cronSecret}`;
  const isInternal = webhookSecret && internalSecret === webhookSecret;
  let isAdmin = false;
  if (!isVercelCron && !isInternal) {
    const u = await requireAuth(req).catch(() => null);
    isAdmin = !!(u && !(u instanceof Response) && (u.role === 'admin' || u.role === 'gestor' || u._internal));
  }
  if (!isVercelCron && !isInternal && !isAdmin) return jsonError('Não autorizado (cron)', 401, req);

  // Renova a sessão: testPortal chama portalCall(validar-hash dummy), e a SOMA
  // devolve o access-token novo no header — portalCall salva (keep-alive).
  let r;
  try {
    r = await fetch(APP_URL() + '/api/soma', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': webhookSecret },
      body: JSON.stringify({ action: 'testPortal' }),
    }).then((x) => x.json());
  } catch (e) {
    return jsonResp({ success: false, erro: e.message }, 200, req);
  }

  const viva = r?.loginPortal === 'ok';
  return jsonResp({
    success: true,
    sessaoViva: viva,
    loginPortal: r?.loginPortal || null,
    mensagem: viva ? 'Sessão SOMA renovada (heartbeat) ✅' : (r?.mensagem || 'Sessão SOMA não está viva — recolar (grampo)'),
  }, 200, req);
}
