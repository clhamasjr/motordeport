// ══════════════════════════════════════════════════════════════════
// api/clt-config-webhook.js
// Admin endpoint — configura webhook do Evolution em TODAS as
// instancias que tenham 'clt' no nome (case-insensitive).
//
// Roda 1x quando criar instancia nova ou trocar URL do agente.
// Aponta o webhook pra /api/agente-clt habilitando event MESSAGES_UPSERT.
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';

const EVO_URL = () => process.env.EVOLUTION_URL;
const EVO_KEY = () => process.env.EVOLUTION_KEY;
const APP_URL = () => process.env.APP_URL || 'https://flowforce.vercel.app';

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);
  const user = await requireAuth(req);
  if (user instanceof Response) return user;
  if (req.method !== 'POST') return jsonError('POST only', 405, req);

  const evoUrl = EVO_URL();
  const evoKey = EVO_KEY();
  if (!evoUrl || !evoKey) return jsonError('EVOLUTION_URL/KEY nao configurado', 500, req);

  try {
    // 1) Lista instancias
    const r1 = await fetch(evoUrl + '/instance/fetchInstances', { headers: { apikey: evoKey } });
    const inst = await r1.json();
    if (!Array.isArray(inst)) {
      return jsonResp({ success: false, error: 'fetchInstances retornou formato invalido', raw: inst }, 502, req);
    }

    const targetUrl = APP_URL() + '/api/agente-clt';
    const cltInstancias = inst.filter(i => /clt/i.test(i.name || i.instanceName || ''));

    if (cltInstancias.length === 0) {
      return jsonResp({
        success: false,
        error: 'Nenhuma instancia com "clt" no nome encontrada.',
        totalInstancias: inst.length,
        nomes: inst.map(i => i.name || i.instanceName).filter(Boolean)
      }, 200, req);
    }

    const resultados = [];
    for (const i of cltInstancias) {
      const nome = i.name || i.instanceName;
      const status = i.connectionStatus || i.state || 'unknown';

      // Le webhook atual
      let webhookAtual = null;
      try {
        const w = await fetch(evoUrl + '/webhook/find/' + nome, { headers: { apikey: evoKey } });
        webhookAtual = await w.json();
      } catch { /* ignora */ }

      // Seta webhook (URL = nosso agente CLT, evento MESSAGES_UPSERT)
      const sR = await fetch(evoUrl + '/webhook/set/' + nome, {
        method: 'POST',
        headers: { apikey: evoKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhook: {
            enabled: true,
            url: targetUrl,
            events: ['MESSAGES_UPSERT']
          }
        })
      });
      const sD = await sR.json().catch(() => ({}));

      resultados.push({
        instancia: nome,
        status,
        webhook_anterior: {
          url: webhookAtual?.url,
          enabled: webhookAtual?.enabled,
          events: webhookAtual?.events
        },
        webhook_novo: {
          url: targetUrl,
          enabled: true,
          events: ['MESSAGES_UPSERT']
        },
        configurado: sR.ok,
        httpStatus: sR.status,
        resposta: sR.ok ? 'OK' : sD
      });
    }

    return jsonResp({
      success: true,
      totalInstancias: inst.length,
      cltInstanciasEncontradas: cltInstancias.length,
      targetUrl,
      resultados
    }, 200, req);
  } catch (e) {
    return jsonResp({ success: false, error: e.message, stack: e.stack?.substring(0, 500) }, 500, req);
  }
}
