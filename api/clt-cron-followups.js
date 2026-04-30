// ══════════════════════════════════════════════════════════════════
// api/clt-cron-followups.js
// CRON — processa follow-ups agendados do agente CLT.
//
// Roda a cada 5min (Vercel Cron). Pega clt_followups com:
//   status = 'pendente' AND agendado_para <= NOW()
// Pra cada um:
//   1. Dispara mensagem WhatsApp via Evolution
//   2. Re-injeta o contexto na conversa pra Claude reagir bem se cliente responder
//   3. Marca como 'enviado' (ou 'falha' se Evolution rejeitar)
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions } from './_lib/auth.js';
import { dbSelect, dbUpdate } from './_lib/supabase.js';

const EVO_URL = () => process.env.EVOLUTION_URL;
const EVO_KEY = () => process.env.EVOLUTION_KEY;
const CLT_INSTANCE = () => process.env.CLT_EVOLUTION_INSTANCE || 'lhamas-clt';

async function sendMsg(instance, number, text) {
  try {
    const r = await fetch(EVO_URL() + '/message/sendText/' + instance, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVO_KEY() },
      body: JSON.stringify({ number, text })
    });
    return r.ok;
  } catch { return false; }
}

function montarMensagemFollowup(fu) {
  // Mensagem baseada no contexto que foi salvo no momento do agendamento
  const ctx = (fu.contexto || '').toLowerCase();
  if (ctx.includes('pensar') || ctx.includes('decidir')) {
    return `Oi! 👋 Tudo bem? Tô passando aqui pra saber se você teve tempo de pensar sobre aquela proposta. Posso te ajudar com alguma dúvida pra fechar?`;
  }
  if (ctx.includes('horario') || ctx.includes('hora') || ctx.includes('ligo') || ctx.includes('chamar')) {
    return `Oi! 👋 Voltei pra falar com você como combinamos. Posso continuar daquele ponto que paramos?`;
  }
  // Default genérico
  return `Oi! 👋 Tudo bem? Voltei pra continuar nosso papo sobre o crédito. Tem alguma dúvida que posso esclarecer?`;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  // Cron: aceita CRON_SECRET (Vercel cron header) OU x-internal-secret
  const cronSecret = process.env.CRON_SECRET;
  const cronAuth = req.headers.get('authorization') || '';
  const internalSecret = req.headers.get('x-internal-secret') || '';
  const expectedInternal = process.env.WEBHOOK_SECRET || '';
  const isVercelCron = cronSecret && cronAuth === `Bearer ${cronSecret}`;
  const isInternal = expectedInternal && internalSecret === expectedInternal;
  if (!isVercelCron && !isInternal) {
    return jsonError('Unauthorized — cron only', 401, req);
  }

  try {
    // Busca followups pendentes que já passaram da hora
    const { data: pendentes } = await dbSelect('clt_followups', {
      filters: { status: 'pendente' }, order: 'agendado_para.asc', limit: 20
    });
    const agora = new Date();
    const aProcessar = (pendentes || []).filter(f => new Date(f.agendado_para) <= agora);

    const resultados = [];
    for (const fu of aProcessar) {
      const msg = montarMensagemFollowup(fu);
      const sent = await sendMsg(CLT_INSTANCE(), fu.telefone, msg);
      if (sent) {
        await dbUpdate('clt_followups', { id: fu.id }, {
          status: 'enviado',
          enviado_em: new Date().toISOString(),
          mensagem_enviada: msg,
          tentativas: (fu.tentativas || 0) + 1
        });
        resultados.push({ id: fu.id, telefone: fu.telefone, ok: true });
      } else {
        const novasTent = (fu.tentativas || 0) + 1;
        await dbUpdate('clt_followups', { id: fu.id }, {
          status: novasTent >= 3 ? 'falha' : 'pendente',
          tentativas: novasTent,
          erro: 'sendMsg retornou false'
        });
        resultados.push({ id: fu.id, telefone: fu.telefone, ok: false, tentativas: novasTent });
      }
    }

    return jsonResp({
      success: true,
      total: aProcessar.length,
      processados: resultados.length,
      enviados: resultados.filter(r => r.ok).length,
      falhas: resultados.filter(r => !r.ok).length,
      resultados
    }, 200, req);
  } catch (e) {
    return jsonResp({ success: false, error: e.message }, 500, req);
  }
}
