// ══════════════════════════════════════════════════════════════════
// api/clt-cron-retry.js
// ROTINA AUTOMÁTICA DE RE-TENTATIVA da carteira (sem operador clicar).
//
// Varre as consultas recentes (últimas 6h) e, pra cada uma que tenha banco
// em 'falha' RE-TENTÁVEL (timeout / banco lento) com tentativas < 2, chama a
// action 'status' do clt-fila — que JÁ contém a lógica de auto-retry (re-dispara
// o banco e incrementa o contador). Assim a higienização em massa se cura
// sozinha, igual a consulta aberta na tela.
//
// Roda a cada 15min (vercel.json). É barato: só "cutuca" filas com falha
// pendente; filas já resolvidas (ou com tentativas esgotadas) são ignoradas,
// e nada além de 6h é tocado (depois disso, considera-se estabilizado).
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';
import { dbQuery } from './_lib/supabase.js';

const APP_URL = () => process.env.APP_URL || 'https://flowforce.vercel.app';
const MAX_AUTO_RETRY = 2;

function temRetryPendente(bancos) {
  return Object.values(bancos || {}).some(
    (b) => b && b.status === 'falha' && b.retryable === true && (b.tentativas || 0) < MAX_AUTO_RETRY
  );
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  // Auth: CRON_SECRET (Vercel cron) OU x-internal-secret OU admin/gestor logado
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
  if (!isVercelCron && !isInternal && !isAdmin) {
    return jsonError('Não autorizado (cron)', 401, req);
  }

  // Janela: consultas das últimas 6h, fora de standby.
  const desde = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const q =
    `select=id,bancos,status_geral,iniciado_em` +
    `&iniciado_em=gte.${encodeURIComponent(desde)}` +
    `&status_geral=neq.standby` +
    `&order=iniciado_em.desc&limit=300`;
  const { data: filas } = await dbQuery('clt_consultas_fila', q).catch(() => ({ data: [] }));

  if (!Array.isArray(filas) || filas.length === 0) {
    return jsonResp({ success: true, filasCutucadas: 0, mensagem: 'Nenhuma consulta recente pra re-tentar' }, 200, req);
  }

  const baseUrl = APP_URL();
  let filasCutucadas = 0;
  for (const f of filas) {
    if (!temRetryPendente(f.bancos)) continue;
    // "Cutuca" o status — ele dispara o auto-retry interno (re-dispara o banco
    // que falhou e incrementa tentativas). Fire-and-forget.
    fetch(baseUrl + '/api/clt-fila', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': webhookSecret },
      body: JSON.stringify({ action: 'status', id: f.id }),
    }).catch(() => {});
    filasCutucadas++;
  }

  return jsonResp({
    success: true,
    filasAnalisadas: filas.length,
    filasCutucadas,
    janela: '6h',
    mensagem: `${filasCutucadas} consulta(s) com falha re-tentável foram re-disparadas.`,
  }, 200, req);
}
