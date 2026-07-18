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
//    no fluxo de consulta. Exclui facta_clt (SMS), mercantil (fora de
//    operação), fintech_qi/celcoin (suspensos até confirmar se disparam SMS)
//    e multicorban (scrape com sessão CSRF frágil — não aguenta massa).
//  - Processa em LOTES pequenos com espaçamento (rate limits: PresençaBank
//    30 req/min; FACTA offline 3s — este roda no worker serial próprio).
//
// RECORRENTE: toda segunda 07h BRT (10h UTC, '0 10 * * 1' no vercel.json).
// 1 tick só — o auto-encadeamento drena a base inteira sozinho. No fim da
// cadeia dispara o RESUMO WhatsApp (oportunidades da rodada) via Evolution.
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';
import { dbSelect, dbUpdate, dbQuery } from './_lib/supabase.js';

const APP_URL = () => process.env.APP_URL || 'https://flowforce.vercel.app';

// Teto de segurança de encadeamentos (anti-loop). 2000 passes × 8 = 16k CPFs.
const MAX_PASS = 2000;

// Espaço entre disparos de CPFs dentro do pass (protege PresençaBank 30/min
// e suaviza o burst nas demais bancarizadoras).
const ESPACO_DISPARO_MS = 1600;

// Bancos que NÃO disparam SMS/WhatsApp pro cliente no fluxo de consulta
// (auto-autz, termo próprio ou bloqueio passivo).
const BANCOS_RECONSULTA = [
  'v8_qi',              // V8 nova API — consent + auto-autz (sem SMS)
  'v8_celcoin',         // idem
  'handbank',           // auto-autz UY3 ChallengeInfo
  'c6',                 // bloqueado passivo (selfie só com clique)
  'unno',               // termo vinculado + auto-autz (fluxo novo 13/07)
  'nossa_fintech',      // auto-autz geolocation (PRODUÇÃO desde 13/07)
  'nossa_fintech_uy3',  // auto-autz geolocation
  'presencabank',       // termo próprio auto-assinado
  'facta_clt_offline',  // base offline (sem SMS) — processada pelo worker SERIAL
  'soma_celcoin',       // SOMA — WhatsApp cortado, aceite via robô/sessão (sem SMS)
  'soma_uy3',           // idem
  'happy_clt',          // HAPPY (byx) — DataPrev auto, sem SMS ao cliente
];

// ── RESUMO DA RODADA (WhatsApp via Evolution) ─────────────────────
// Chamado no fim da cadeia com ?resumo=1. Hops 1-2 só esperam ~20s cada
// (bancos assíncronos assentando) e re-encadeiam; hop 3 computa e envia.
// Envs: EVOLUTION_URL/EVOLUTION_KEY + RECONSULTA_ALERT_NUMBER (fallback
// HEALTHCHECK_ALERT_NUMBER) + HEALTHCHECK_INSTANCE.
async function enviarResumoRodada(req, hop, cutoff) {
  const baseUrl = APP_URL();
  const secret = process.env.WEBHOOK_SECRET || '';

  if (hop < 3) {
    await new Promise((r) => setTimeout(r, 20000)); // deixa os bancos assentarem
    fetch(baseUrl + `/api/clt-cron-reconsulta?resumo=${hop + 1}&cutoff=${encodeURIComponent(cutoff || '')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
    }).catch(() => {});
    return jsonResp({ success: true, resumoHop: hop, mensagem: `Aguardando bancos assentarem (hop ${hop}/3)` }, 200, req);
  }

  // hop 3: computa as oportunidades da rodada (linhas da reconsulta de hoje)
  const desde = cutoff || new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();
  let selectCols = 'cpf,cliente,bancos,novo_apto,novo_apto_bancos';
  let rows = [];
  for (let page = 0; page < 4; page++) { // até 2000 linhas (paginado)
    const qs = (cols) =>
      `iniciado_em=gte.${encodeURIComponent(desde)}&criada_por_nome=like.Reconsulta*`
      + `&select=${cols}&order=iniciado_em.asc&limit=500&offset=${page * 500}`;
    let { data } = await dbQuery('clt_consultas_fila', qs(selectCols)).catch(() => ({ data: null }));
    // Migration ainda nao rodou (colunas novo_apto* inexistentes) → cai pro basico
    if (!Array.isArray(data) && selectCols.includes('novo_apto')) {
      selectCols = 'cpf,cliente,bancos';
      const retry = await dbQuery('clt_consultas_fila', qs(selectCols)).catch(() => ({ data: null }));
      data = retry.data;
    }
    if (!Array.isArray(data) || data.length === 0) break;
    rows = rows.concat(data);
    if (data.length < 500) break;
  }

  // agrega: aptos (margem>0 em algum banco), novos (novo_apto), top 5
  const porCpf = new Map();
  for (const r of rows) {
    let melhorMargem = 0, melhorBanco = null;
    for (const [slug, st] of Object.entries(r.bancos || {})) {
      if (slug === 'multicorban') continue;
      if (st?.status === 'ok' && st?.disponivel === true) {
        let m = parseFloat(st.dados?.margemDisponivel ?? st.dados?.valorLiquido ?? 0) || 0;
        if (st.dados?.margemDisponivel != null && m > 20000) m = m / 100;
        if (m > melhorMargem) { melhorMargem = m; melhorBanco = slug; }
      }
    }
    const atual = porCpf.get(r.cpf);
    if (!atual || melhorMargem > atual.melhorMargem) {
      porCpf.set(r.cpf, {
        nome: r.cliente?.nome || null, melhorMargem, melhorBanco,
        novo: r.novo_apto === true,
      });
    }
  }
  const clientes = Array.from(porCpf.values());
  const aptos = clientes.filter((c) => c.melhorMargem > 0);
  const novos = aptos.filter((c) => c.novo);
  const top5 = [...aptos].sort((a, b) => b.melhorMargem - a.melhorMargem).slice(0, 5);
  const somaMargem = aptos.reduce((s, c) => s + c.melhorMargem, 0);

  const fmt = (v) => 'R$ ' + v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const linhasTop = top5.map((c, i) =>
    `${i + 1}. ${(c.nome || 'sem nome').split(' ').slice(0, 2).join(' ')} — ${fmt(c.melhorMargem)} (${c.melhorBanco})`).join('\n');
  const texto =
    `🔄 *Reconsulta CLT concluída*\n\n` +
    `📊 ${porCpf.size} clientes reconsultados\n` +
    `✅ ${aptos.length} com margem (soma ${fmt(somaMargem)})\n` +
    (novos.length ? `🆕 ${novos.length} oportunidade(s) NOVA(s)!\n` : '') +
    (linhasTop ? `\n🏆 *Top 5:*\n${linhasTop}\n` : '') +
    `\n👉 Pipeline: https://flowforce.tec.br/clt/aptos`;

  // Envia via Evolution (mesmo padrão do healthcheck)
  const evoUrl = process.env.EVOLUTION_URL, evoKey = process.env.EVOLUTION_KEY;
  const numero = (process.env.RECONSULTA_ALERT_NUMBER || process.env.HEALTHCHECK_ALERT_NUMBER || '').replace(/\D/g, '');
  const instancia = process.env.HEALTHCHECK_INSTANCE || 'lhamas-clt';
  let enviado = false;
  if (numero && evoUrl && evoKey) {
    try {
      const r = await fetch(`${evoUrl}/message/sendText/${instancia}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': evoKey },
        body: JSON.stringify({ number: numero, text: texto }),
        signal: AbortSignal.timeout(8000),
      });
      enviado = r.ok;
    } catch { /* segue */ }
  }

  return jsonResp({
    success: true, resumoHop: hop, enviado,
    total: porCpf.size, aptos: aptos.length, novos: novos.length, somaMargem,
  }, 200, req);
}

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

  // Limite por execução (lote). Default 8 — com espaçamento de 1,6s entre
  // disparos, cada pass leva ~14s (seguro pro timeout Edge de ~25s) e o
  // throughput fica dentro do rate limit do PresençaBank.
  // Cada execução processa `limit` CPFs e, se ainda sobrou histórico, chama
  // a SI MESMA (auto-encadeamento) pro próximo lote — até esvaziar TODOS.
  let limit = 8, pass = 1, resumoHop = 0, cutoffParam = null, bancosOverride = null;
  try {
    const u = new URL(req.url);
    const l = parseInt(u.searchParams.get('limit') || '8', 10);
    if (l > 0 && l <= 200) limit = l;
    const p = parseInt(u.searchParams.get('pass') || '1', 10);
    if (p > 0) pass = p;
    resumoHop = parseInt(u.searchParams.get('resumo') || '0', 10) || 0;
    cutoffParam = u.searchParams.get('cutoff') || null;
    // ?bancos=v8_qi,v8_celcoin → reconsulta a base SÓ nesses bancos (varredura
    // pontual de um banco que voltou). Sem o param, roda BANCOS_RECONSULTA
    // (rodada semanal completa — comportamento inalterado). O 'criar' filtra
    // downstream por TODOS_BANCOS_CLT, então aqui basta sanitizar o formato.
    const bp = (u.searchParams.get('bancos') || '').trim();
    if (bp) {
      const arr = bp.split(',').map((s) => s.trim()).filter((s) => /^[a-z0-9_]+$/.test(s));
      if (arr.length) bancosOverride = arr;
    }
  } catch { /* default */ }
  // Lista de bancos desta rodada + querystring pra propagar no auto-encadeamento
  const bancosDaRodada = bancosOverride || BANCOS_RECONSULTA;
  const bancosQS = bancosOverride ? `&bancos=${encodeURIComponent(bancosOverride.join(','))}` : '';

  // ── MODO RESUMO (fim da cadeia): espera os bancos assentarem e manda o
  // resumo das oportunidades da rodada pro WhatsApp (Evolution).
  if (resumoHop > 0) {
    return await enviarResumoRodada(req, resumoHop, cutoffParam);
  }

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
  if (!bancosOverride) try {
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
      fetch(baseUrlEarly + `/api/clt-cron-reconsulta?limit=${limit}&pass=${pass + 1}${bancosQS}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': secretEarly },
      }).catch(() => {});
      encadeouStandby = true;
    }
    // Fim da cadeia (histórico vazio): agenda o resumo WhatsApp da rodada.
    if (!encadeouStandby && pass > 1) {
      fetch(baseUrlEarly + `/api/clt-cron-reconsulta?resumo=1&cutoff=${encodeURIComponent(cutoff)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': secretEarly },
      }).catch(() => {});
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
          bancos: bancosDaRodada,
          semMulticorban: true, // massa NAO passa no scrape do Multicorban (CSRF frágil)
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

    // Espaça os disparos — rate limit PresençaBank (30 req/min) e suaviza
    // o burst nas demais bancarizadoras.
    await new Promise((r) => setTimeout(r, ESPACO_DISPARO_MS));
  }

  // ── AUTO-ENCADEAMENTO ────────────────────────────────────────
  // Se o lote veio CHEIO (== limit), provavelmente ainda há histórico →
  // dispara o PRÓXIMO lote chamando a si mesmo (fire-and-forget). O cutoff
  // fixo garante que não reprocessa quem já rodou; o teto MAX_PASS evita loop.
  // Se veio incompleto, esvaziou → para (a cadeia termina sozinha).
  let encadeou = false;
  if ((clientes.length >= limit || standbyCheio) && pass < MAX_PASS) {
    fetch(baseUrl + `/api/clt-cron-reconsulta?limit=${limit}&pass=${pass + 1}${bancosQS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': webhookSecret },
    }).catch(() => {});
    encadeou = true;
  } else {
    // Fim da cadeia (lote incompleto = base drenada): agenda o resumo WhatsApp.
    fetch(baseUrl + `/api/clt-cron-reconsulta?resumo=1&cutoff=${encodeURIComponent(cutoff)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': webhookSecret },
    }).catch(() => {});
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
