// /api/sofia-cron-followups — endpoint chamado pelo Vercel Cron a cada 30 min
// Dispara follow-up automático em conversas INSS inativas (Sofia ainda atende, sem resposta há 4h+).
// Vercel Cron faz GET; nós validamos via x-vercel-cron-signature ou query secret.

export const config = { runtime: 'edge' };

export default async function handler(req) {
  try {
    // Vercel Cron envia GET com header authorization: Bearer <CRON_SECRET configurado em env>
    const cronSecret = process.env.CRON_SECRET || process.env.WEBHOOK_SECRET || '';
    const auth = req.headers.get('authorization') || '';
    const url = new URL(req.url);
    const querySecret = url.searchParams.get('s') || '';
    const isVercelCron = req.headers.get('user-agent')?.includes('vercel-cron') || false;
    // Aceita: 1) chamada do Vercel Cron, 2) bearer com secret, 3) ?s=secret
    const isAuthed = isVercelCron
      || (cronSecret && (auth === `Bearer ${cronSecret}` || querySecret === cronSecret));
    if (!isAuthed) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    const horas = parseInt(url.searchParams.get('horas') || '4', 10);
    const max = parseInt(url.searchParams.get('max') || '20', 10);

    // Chama internamente a action idleFollowup do /api/agent
    const appUrl = process.env.APP_URL || 'https://flowforce.vercel.app';
    const r = await fetch(appUrl + '/api/agent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': cronSecret
      },
      body: JSON.stringify({ action: 'idleFollowup', horas, max })
    });
    const data = await r.json();
    return new Response(JSON.stringify({
      ok: true,
      ranAt: new Date().toISOString(),
      horas,
      max,
      result: data
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
