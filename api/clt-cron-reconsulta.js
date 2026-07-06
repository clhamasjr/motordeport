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

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';
import { dbSelect, dbUpdate, dbQuery } from './_lib/supabase.js';

const APP_URL = () => process.env.APP_URL || 'https://flowforce.vercel.app';

// Teto de segurança de encadeamentos (anti-loop). 1000 passes × 60 = 60k CPFs.
const MAX_PASS = 1000;

// Bancos que NÃO disparam SMS/WhatsApp pro cliente no fluxo de consulta
// (auto-autz, autz simples, enriquecimento ou bloqueio passivo).
const BANCOS_RECONSULTA = [
  'multicorban',        // enriquecimento (nome/telefone)
  'fintech_qi',         // autz simples (sem SMS)
  'fintech_celcoin',    // autz simples (sem SMS) — igual o QI
  'v8_qi',              // V8 nova API — consent + auto-autz (sem SMS)
  'v8_celcoin',         // idem
  'handbank',           // auto-autz UY3 ChallengeInfo
  'c6',                 // bloqueado passivo (selfie só com clique)
  'unno',               // cria termo + auto-autz
  'nossa_fintech',      // auto-autz geolocation
  'nossa_fintech_uy3',  // auto-autz geolocation
  'presencabank',       // enriquecimento + margem
];

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  // Auth: CRON_SECRET (Vercel cron) OU x-internal-secret OU admin/gestor logado
  // (o admin pode disparar a higienização da carteira manualmente).
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

  // Limite por execução (lote). Default 60 — seguro pro timeout Edge.
  // Cada execução processa `limit` CPFs e, se ainda sobrou histórico, chama
  // a SI MESMA (auto-encadeamento) pro próximo lote — até esvaziar TODOS.
  let limit = 60, pass = 1;
  try {
    const u = new URL(req.url);
    const l = parseInt(u.searchParams.get('limit') || '60', 10);
    if (l > 0 && l <= 200) limit = l;
    const p = parseInt(u.searchParams.get('pass') || '1', 10);
    if (p > 0) pass = p;
  } catch { /* default */ }

  const baseUrlEarly = APP_URL();
  const secretEarly = process.env.WEBHOOK_SECRET || '';

  // CUTOFF FIXO da rodada = início do dia atual (UTC). Tudo que JÁ foi
  // reconsultado hoje fica com ultima_consulta_at >= cutoff e sai do conjunto.
  // Garante: (a) terminação (cada CPF processado some do filtro), (b) que o
  // auto-encadeamento E as execuções agendadas de retomada usem o MESMO corte,
  // sem reprocessar ninguém. CPFs nunca consultados (null) entram primeiro.
  const _now = new Date();
  const cutoff = new Date(Date.UTC(_now.getUTCFullYear(), _now.getUTCMonth(), _now.getUTCDate())).toISOString();

  // ── ETAPA 1: dispara filas em STANDBY ────────────────────────
  // Consultas feitas pelos operadores antes de 26/06 ficaram paradas
  // (status_geral='standby'). Agora dispara os bancos de cada uma.
  let standbyDisparadas = 0, standbyCheio = false;
  try {
    const { data: standbyFilas } = await dbSelect('clt_consultas_fila', {
      filters: { status_geral: 'standby' }, order: 'iniciado_em.asc', limit,
    });
    if (Array.isArray(standbyFilas) && standbyFilas.length >= limit) standbyCheio = true;
    for (const f of (standbyFilas || [])) {
      const bancos = Object.keys(f.bancos || {});
      if (bancos.length === 0) continue;
      // Marca como processando ANTES (evita re-disparo se cron rodar de novo)
      await dbUpdate('clt_consultas_fila', { id: f.id }, { status_geral: 'processando' }).catch(() => {});
      for (const banco of bancos) {
        fetch(baseUrlEarly + '/api/clt-fila', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-secret': secretEarly },
          body: JSON.stringify({ action: 'processar', id: f.id, banco }),
        }).catch(() => {});
      }
      standbyDisparadas++;
    }
  } catch { /* segue pra re-consulta do historico */ }

  // Pega os CPFs ainda NÃO reconsultados nesta rodada (ultima_consulta_at <
  // cutoff OU nunca consultado), os mais antigos/nulos primeiro. dbQuery
  // permite o filtro `lt` + `is.null` que o dbSelect (só `eq`) não cobre.
  const filtro =
    `select=*` +
    `&or=(ultima_consulta_at.lt.${encodeURIComponent(cutoff)},ultima_consulta_at.is.null)` +
    `&order=ultima_consulta_at.asc.nullsfirst` +
    `&limit=${limit}`;
  const { data: clientes } = await dbQuery('clt_clientes', filtro).catch(() => ({ data: [] }));

  if (!Array.isArray(clientes) || clientes.length === 0) {
    // Histórico esgotado. Mas se ainda há standby (lote veio cheio), encadeia
    // pra drenar o resto das filas paradas antes de encerrar.
    let encadeouStandby = false;
    if (standbyCheio && pass < MAX_PASS) {
      fetch(baseUrlEarly + `/api/clt-cron-reconsulta?limit=${limit}&pass=${pass + 1}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': secretEarly },
      }).catch(() => {});
      encadeouStandby = true;
    }
    return jsonResp({
      success: true, pass, standbyDisparadas, disparados: 0,
      concluido: !encadeouStandby,
      encadeou: encadeouStandby,
      mensagem: encadeouStandby
        ? `Pass ${pass} — histórico vazio, mas ainda há standby. Encadeando (pass ${pass + 1}).`
        : `Rodada concluída — sem mais CPFs pra reconsultar (pass ${pass}).`,
    }, 200, req);
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

  // ── AUTO-ENCADEAMENTO ────────────────────────────────────────
  // Se o lote veio CHEIO (== limit), provavelmente ainda há histórico →
  // dispara o PRÓXIMO lote chamando a si mesmo (fire-and-forget). O cutoff
  // fixo garante que não reprocessa quem já rodou; o teto MAX_PASS evita loop.
  // Se veio incompleto, esvaziou → para (a cadeia termina sozinha).
  let encadeou = false;
  if ((clientes.length >= limit || standbyCheio) && pass < MAX_PASS) {
    fetch(baseUrl + `/api/clt-cron-reconsulta?limit=${limit}&pass=${pass + 1}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': webhookSecret },
    }).catch(() => {});
    encadeou = true;
  }

  return jsonResp({
    success: true,
    pass,               // numero do lote nesta cadeia
    standbyDisparadas,  // filas que estavam paradas (modo standby) e foram disparadas
    disparados,         // re-consultas do historico disparadas neste lote
    semDono,            // quantos não tinham vendedor (re-atribuídos a Sistema)
    erros,
    lote: limit,
    encadeou,           // true = chamou o proximo lote; false = ultima rodada
    cutoff,
    mensagem: `Pass ${pass} — Standby: ${standbyDisparadas} disparada(s). Histórico: ${disparados} re-consulta(s).` +
      (encadeou ? ` Encadeando próximo lote (pass ${pass + 1}).` : ` Fim da cadeia.`),
  }, 200, req);
}
