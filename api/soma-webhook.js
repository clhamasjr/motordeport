export const config = { runtime: 'edge' };

// ══════════════════════════════════════════════════════════════════
// api/soma-webhook.js — Receptor de webhooks da SOMA
//
// A SOMA chama aqui quando o status muda (cliente assinou o aceite, proposta
// integrou/cancelou). Configurado via api/soma.js action registrarWebhook
// (ou no painel) apontando pra {APP_URL}/api/soma-webhook.
//
// Eventos (docs SOMA):
//  CONSULTA_STATUS_ALTERADO → dados{conId, conCpf, conBancarizadora,
//    conStatusNome, conMargemDisponivel, conAssinadoEm, conEmpregador, ...}
//    → quando o cliente assina, RE-DISPARA o processador SOMA daquele CPF
//      (processarSoma re-consulta e agora traz a margem → card vira 'ok').
//  PROPOSTA_STATUS_ALTERADO → dados{proId, proCpf, proStatusNome, ...}
//    → atualiza o card com o status da digitação.
//
// AUTENTICAÇÃO: público (SOMA chama), validado por segredo compartilhado —
// aceita ?s=<SOMA_WEBHOOK_SECRET> na URL OU Authorization: Bearer <secret>.
// Env: SOMA_WEBHOOK_SECRET, WEBHOOK_SECRET (interno p/ re-disparar clt-fila).
// ══════════════════════════════════════════════════════════════════

import { json as jsonResp, jsonError, handleOptions } from './_lib/auth.js';
import { dbSelect, dbUpdate } from './_lib/supabase.js';

const APP_URL = () => process.env.APP_URL || 'https://flowforce.vercel.app';
const onlyDigits = (s) => String(s || '').replace(/\D/g, '');

const slugDaBancarizadora = (b) => (String(b || '').toUpperCase() === 'UY3' ? 'soma_uy3' : 'soma_celcoin');

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  // Validação por segredo compartilhado (query ?s= ou Authorization Bearer)
  const segredo = process.env.SOMA_WEBHOOK_SECRET || '';
  let ok = !segredo; // se não configurou segredo, aceita (não recomendado)
  try {
    const url = new URL(req.url);
    if (segredo && url.searchParams.get('s') === segredo) ok = true;
    const auth = req.headers.get('authorization') || '';
    if (segredo && auth === `Bearer ${segredo}`) ok = true;
    const xk = req.headers.get('x-webhook-secret') || '';
    if (segredo && xk === segredo) ok = true;
  } catch { /* segue */ }
  if (!ok) return jsonError('webhook nao autorizado', 401, req);

  let body;
  try { body = await req.json(); } catch { return jsonResp({ received: true, ignored: 'json invalido' }, 200, req); }

  const tipo = body?.tipo || body?.evento || null;
  const dados = body?.dados || {};
  const internal = process.env.WEBHOOK_SECRET || '';

  try {
    // ─── CONSULTA: cliente assinou / margem mudou ─────────────
    if (tipo === 'CONSULTA_STATUS_ALTERADO' || dados.conCpf) {
      const cpf = onlyDigits(dados.conCpf);
      if (cpf.length !== 11) return jsonResp({ received: true, ignored: 'sem cpf' }, 200, req);
      const slug = slugDaBancarizadora(dados.conBancarizadora);

      // Acha a consulta mais recente desse CPF que tenha o card SOMA
      const { data: filas } = await dbSelect('clt_consultas_fila', {
        filters: { cpf }, order: 'iniciado_em.desc', limit: 5,
      });
      const alvo = (Array.isArray(filas) ? filas : []).find((f) => f.bancos && f.bancos[slug]);
      if (!alvo) return jsonResp({ received: true, ignored: 'fila nao encontrada p/ ' + slug }, 200, req);

      // Re-dispara o processador SOMA — re-consulta e (assinado) traz a margem.
      // Reusa TODA a lógica de processarSoma (card vira ok/aguardando/etc).
      fetch(APP_URL() + '/api/clt-fila', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': internal },
        body: JSON.stringify({ action: 'processar', id: alvo.id, banco: slug, force: true }),
      }).catch(() => {});

      return jsonResp({ received: true, tipo, cpf, slug, filaId: alvo.id, reprocessado: true }, 200, req);
    }

    // ─── PROPOSTA: digitação mudou de status ──────────────────
    if (tipo === 'PROPOSTA_STATUS_ALTERADO' || dados.proId) {
      const cpf = onlyDigits(dados.proCpf);
      const { data: filas } = await dbSelect('clt_consultas_fila', {
        filters: { cpf }, order: 'iniciado_em.desc', limit: 5,
      });
      const alvo = (Array.isArray(filas) ? filas : []).find((f) =>
        f.bancos && (f.bancos.soma_celcoin || f.bancos.soma_uy3));
      if (alvo) {
        const slug = alvo.bancos.soma_uy3 ? 'soma_uy3' : 'soma_celcoin';
        const bancos = { ...(alvo.bancos || {}) };
        bancos[slug] = {
          ...(bancos[slug] || {}),
          proposta: {
            proId: dados.proId, status: dados.proStatusNome,
            linkAssinatura: dados.proLinkAssinatura || null,
            integradaEm: dados.proIntegradaEm || null,
            canceladaEm: dados.proCanceladaEm || null,
            motivoCancelamento: dados.proMotivoCancelamento || null,
          },
          propostaStatus: dados.proStatusNome,
          atualizado_em: new Date().toISOString(),
        };
        await dbUpdate('clt_consultas_fila', { id: alvo.id }, { bancos });
        return jsonResp({ received: true, tipo, cpf, filaId: alvo.id, propostaStatus: dados.proStatusNome }, 200, req);
      }
    }

    return jsonResp({ received: true, tipo: tipo || 'desconhecido', ignored: true }, 200, req);
  } catch (e) {
    // Sempre 200 pro webhook não ficar re-tentando eternamente por erro nosso
    return jsonResp({ received: true, erro: e.message }, 200, req);
  }
}
