// ══════════════════════════════════════════════════════════════════
// api/clt-cron-reconsulta.js
// CRON — re-consulta o HISTÓRICO de CPFs CLT pra manter os dados frescos
// (margem/elegibilidade) pras análises.
//
// Estratégia segura:
//  - Fonte: clt_clientes (CPFs únicos já consultados + dados salvos),
//    ordenado por ultima_consulta_at ASC (re-consulta os mais "velhos"
//    primeiro). O proprio refresh atualiza ultima_consulta_at → cursor
//    natural de paginação entre execuções.
//  - Preserva o VENDEDOR dono (busca a última consulta do CPF em
//    clt_consultas_fila e re-atribui via comoUserId — mantém o isolamento
//    multi-tenant: cada vendedor continua vendo só as suas).
//  - SEM SMS em massa: dispara só os bancos que NÃO mandam SMS pro cliente
//    no fluxo de consulta. Exclui fintech_celcoin e facta_clt (SMS) e
//    mercantil (fora de operação).
//  - Processa em LOTES (limit por execução) pra não estourar timeout Edge.
//
// Agendado pra 26/06 07h BRT (10h UTC) — ver vercel.json. Roda em janela
// de ~2h pra cobrir volume (varias execucoes consomem o cursor).
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions } from './_lib/auth.js';
import { dbSelect, dbUpdate } from './_lib/supabase.js';

const APP_URL = () => process.env.APP_URL || 'https://flowforce.vercel.app';

// Bancos que NÃO disparam SMS/WhatsApp pro cliente no fluxo de consulta
// (auto-autz, autz simples, enriquecimento ou bloqueio passivo).
const BANCOS_RECONSULTA = [
  'multicorban',        // enriquecimento (nome/telefone)
  'fintech_qi',         // autz simples (sem SMS)
  'handbank',           // auto-autz UY3 ChallengeInfo
  'c6',                 // bloqueado passivo (selfie só com clique)
  'unno',               // cria termo + auto-autz
  'nossa_fintech',      // auto-autz geolocation
  'nossa_fintech_uy3',  // auto-autz geolocation
  'presencabank',       // enriquecimento + margem
];

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  // Auth: CRON_SECRET (Vercel cron) OU x-internal-secret
  const cronSecret = process.env.CRON_SECRET;
  const cronAuth = req.headers.get('authorization') || '';
  const internalSecret = req.headers.get('x-internal-secret') || '';
  const webhookSecret = process.env.WEBHOOK_SECRET || '';
  const isVercelCron = cronSecret && cronAuth === `Bearer ${cronSecret}`;
  const isInternal = webhookSecret && internalSecret === webhookSecret;
  if (!isVercelCron && !isInternal) {
    return jsonError('Não autorizado (cron)', 401, req);
  }

  // Limite por execução (lote). Default 60 — seguro pro timeout Edge.
  let limit = 60;
  try {
    const u = new URL(req.url);
    const l = parseInt(u.searchParams.get('limit') || '60', 10);
    if (l > 0 && l <= 200) limit = l;
  } catch { /* default */ }

  // Pega os CPFs menos recentemente re-consultados (cursor = ultima_consulta_at)
  const { data: clientes } = await dbSelect('clt_clientes', {
    order: 'ultima_consulta_at.asc',
    limit,
  }).catch(() => ({ data: [] }));

  if (!Array.isArray(clientes) || clientes.length === 0) {
    return jsonResp({ success: true, disparados: 0, mensagem: 'Sem CPFs no histórico pra re-consultar' }, 200, req);
  }

  const baseUrl = APP_URL();
  let disparados = 0, semDono = 0, erros = 0;

  for (const c of clientes) {
    const cpf = String(c.cpf || '').replace(/\D/g, '');
    if (cpf.length !== 11) continue;

    // Dono original: última consulta do CPF (preserva vendedor pro isolamento)
    let comoUserId = null, comoUserNome = null, comoParceiroId = null;
    try {
      const { data: ult } = await dbSelect('clt_consultas_fila', {
        filters: { cpf }, order: 'iniciado_em.desc', limit: 1,
      });
      const u0 = Array.isArray(ult) ? ult[0] : null;
      if (u0) {
        comoUserId = u0.criada_por_user_id ?? null;
        comoParceiroId = u0.parceiro_id ?? null;
        // limpa prefixo "Reconsulta/Higienização Lote · " pra não acumular
        comoUserNome = (u0.criada_por_nome || '').replace(/^(Reconsulta|Higienização) Lote · /,'') || null;
      }
    } catch { /* segue sem dono */ }
    if (!comoUserId) semDono++;

    // Re-dispara consulta (fire-and-forget, interna). origem=lote, bancos sem-SMS.
    try {
      fetch(baseUrl + '/api/clt-fila', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': webhookSecret },
        body: JSON.stringify({
          action: 'criar',
          cpf,
          origem: 'lote',
          bancos: BANCOS_RECONSULTA,
          // pre-popula dados já conhecidos (evita re-pedir / destrava bancos)
          nome: c.nome || undefined,
          dataNascimento: c.data_nascimento || undefined,
          sexo: c.sexo || undefined,
          telefone: Array.isArray(c.telefones) && c.telefones[0]?.completo ? c.telefones[0].completo : undefined,
          // preserva o vendedor dono
          comoUserId, comoUserNome, comoParceiroId,
        }),
      }).catch(() => {});
      disparados++;
    } catch { erros++; }

    // Avança o cursor (atualiza ultima_consulta_at) pra próxima execução
    // pegar os próximos. Feito mesmo se o disparo falhar (não trava o lote).
    try {
      await dbUpdate('clt_clientes', { cpf }, { ultima_consulta_at: new Date().toISOString() });
    } catch { /* nao quebra */ }
  }

  return jsonResp({
    success: true,
    disparados,
    semDono,          // quantos não tinham vendedor (re-atribuídos a Sistema)
    erros,
    lote: limit,
    mensagem: `Re-consulta disparada pra ${disparados} CPF(s) do histórico (bancos sem-SMS).`,
  }, 200, req);
}
