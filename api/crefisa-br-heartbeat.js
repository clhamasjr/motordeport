export const config = { runtime: 'edge' };

// ══════════════════════════════════════════════════════════════════
// api/crefisa-br-heartbeat.js — MANTÉM A SESSÃO DO PORTAL CREFISA VIVA
//
// O portal 2tech derruba a sessão por INATIVIDADE (IIS/ASP timeout, visto
// ao vivo: default.asp?EX=S depois de uns minutos parado). Este cron
// "cutuca" a sessão a cada 10min com uma consulta leve, de modo que ela
// só morra no vencimento absoluto do portal — e não por ficar parada.
//
// NÃO revive sessão morta: o login tem reCAPTCHA + 2FA, então quando cai
// de vez o dono precisa recolar 1x em /baixa-renda/sessao. Quando isso
// acontece, avisa no WhatsApp (uma vez por queda, sem spam).
//
// Cron: */10 * * * * (vercel.json). Auth: CRON_SECRET / x-internal-secret / admin.
// Env: APP_URL, WEBHOOK_SECRET, CREFISA_BR_ALERTA_WHATSAPP (telefone do dono).
// ══════════════════════════════════════════════════════════════════

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';
import { dbSelect, dbUpsert } from './_lib/supabase.js';

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

  // Cutuca a sessão — statusPortalSession faz uma consulta leve no portal,
  // o que por si só zera o contador de inatividade do IIS.
  let r;
  try {
    r = await fetch(APP_URL() + '/api/crefisa-br', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': webhookSecret },
      body: JSON.stringify({ action: 'statusPortalSession' }),
    }).then((x) => x.json());
  } catch (e) {
    return jsonResp({ success: false, erro: e.message }, 200, req);
  }

  // "operante" = bearer E cookie vivos. O cookie morre antes do bearer, então
  // o alerta tem que olhar os dois — senão a esteira para em silêncio.
  const operante = !!r?.operante;

  // Avisa no WhatsApp na TRANSIÇÃO operante → caída (não repete a cada 10min)
  let avisou = false;
  const { data: sess } = await dbSelect('crefisa_portal_session', { filters: { id: 1 }, single: true });
  const jaAvisado = !!sess?.alerta_enviado;

  if (!operante && !jaAvisado && sess) {
    const telefone = (process.env.CREFISA_BR_ALERTA_WHATSAPP || '').trim();
    if (telefone) {
      // mensagem precisa dependendo do que caiu
      const detalhe = r?.cookieVivo === false && r?.bearerVivo
        ? 'O cookie expirou (a esteira/ajax pararam; a digitação REST ainda roda).'
        : 'A sessão expirou.';
      await fetch(APP_URL() + '/api/evolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': webhookSecret },
        body: JSON.stringify({
          action: 'send',
          number: telefone,
          text: `⚠️ FlowForce — sessão Crefisa (Baixa Renda) precisa renovar.\n\n${detalhe}\n\nO robô deve logar e re-empurrar a sessão (bearer + cookie fresco) pra voltar a operar 100%.`,
        }),
      }).catch(() => {});
      avisou = true;
    }
    await dbUpsert('crefisa_portal_session', { ...sess, alerta_enviado: true }, 'id').catch(() => {});
  }

  // Voltou a ficar operante → rearma o alerta pra próxima queda
  if (operante && jaAvisado && sess) {
    await dbUpsert('crefisa_portal_session', { ...sess, alerta_enviado: false }, 'id').catch(() => {});
  }

  return jsonResp({
    success: true,
    operante,
    bearerVivo: r?.bearerVivo ?? null,
    cookieVivo: r?.cookieVivo ?? null,
    avisouWhatsapp: avisou,
    mensagem: operante
      ? 'Sessão Crefisa operante (heartbeat) ✅'
      : (r?.mensagem || 'Sessão Crefisa precisa renovar — robô deve re-empurrar'),
  }, 200, req);
}
