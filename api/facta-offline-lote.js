export const config = { runtime: 'edge' };

// ══════════════════════════════════════════════════════════════════
// api/facta-offline-lote.js
// HIGIENIZAÇÃO FACTA CLT EM LOTE via BASE OFFLINE (cltoff, sem SMS)
//
// Funil de 2 passos (pedido do Carlos):
//   1) OFFLINE EM MASSA (sem sensibilizar o cliente) → 3 baldes:
//      com_margem / sem_margem / sem_historico
//   2) Só pros COM MARGEM → dispararAutorizacao (SMS via facta_clt online)
//      → cliente autoriza → margem fresca → digitar.
//
// Reusa o motor clt_consultas_fila (1 linha/CPF, resultado no jsonb
// bancos.facta_clt_offline com campo `bucket` pra contagem PostgREST).
// A FACTA offline exige 3s entre chamadas → worker SERIAL auto-encadeado.
//
// Actions:
//   criar               {cpfs:[...]}              → cria lote + inicia worker
//   processar           {lote}                    → worker serial (interno/manual)
//   status              {lote}                    → contagem por balde (+auto-kick)
//   listar              {lote, bucket, limit, offset}
//   dispararAutorizacao {lote, max} | {ids:[...]} → SMS pros com_margem
// ══════════════════════════════════════════════════════════════════

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';
import { dbSelect, dbInsert, dbUpdate, dbQuery } from './_lib/supabase.js';

const APP_URL = () => process.env.APP_URL || 'https://flowforce.vercel.app';
const SB_URL = () => process.env.SUPABASE_URL;
const SB_KEY = () => process.env.SUPABASE_SERVICE_KEY;

const BANCO = 'facta_clt_offline';
const CPFS_MAX_LOTE = 10000;   // teto por lote (3s/CPF ≈ 1.200/h)
const POR_PASSADA = 4;         // CPFs por invocacao do worker (4 × ~3.2s < limite edge)
const ESPACO_MS = 3200;        // intervalo entre chamadas (FACTA exige 3s)

function normalizeCPF(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d || d.length > 11 || d.length < 9) return null;
  return d.padStart(11, '0');
}

// Chama outra edge function interna (mesmo padrao do clt-fila)
async function callApi(path, payload, authHeader, internalSecret, timeoutMs = 18000) {
  const headers = { 'Content-Type': 'application/json' };
  if (internalSecret) headers['x-internal-secret'] = internalSecret;
  if (authHeader) headers['Authorization'] = authHeader;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(APP_URL() + path, {
      method: 'POST', headers, body: JSON.stringify(payload), signal: ctrl.signal,
    });
    const t = await r.text();
    let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 500) }; }
    return { ok: r.ok, status: r.status, data: d };
  } catch (e) {
    return { ok: false, status: e.name === 'AbortError' ? 408 : 0, data: { error: e.message } };
  } finally { clearTimeout(timer); }
}

// Conta linhas do lote num filtro PostgREST (Prefer: count=exact, sem baixar dados)
// marker null = conta GLOBAL (qualquer lote/origem)
async function contar(marker, extraFilter) {
  let url = `${SB_URL()}/rest/v1/clt_consultas_fila?select=id&limit=1`;
  if (marker) url += `&criada_por_nome=eq.${encodeURIComponent(marker)}`;
  if (extraFilter) url += `&${extraFilter}`;
  const r = await fetch(url, {
    headers: {
      'apikey': SB_KEY(), 'Authorization': `Bearer ${SB_KEY()}`,
      'Prefer': 'count=exact',
    },
  });
  const range = r.headers.get('content-range') || '';
  const total = parseInt(range.split('/')[1] || '0', 10);
  return isNaN(total) ? 0 : total;
}

const fPendentes = `bancos->${BANCO}->>status=eq.pending`;
const fProcessando = `bancos->${BANCO}->>status=eq.processando`;
const fBucket = (b) => `bancos->${BANCO}->>bucket=eq.${b}`;

// Dispara o worker em background (fire-and-forget, mesmo padrao do criar do clt-fila)
// marker = string (lote especifico) ou null (drainer GLOBAL: qualquer pendente)
function kickWorker(marker, secret) {
  fetch(APP_URL() + '/api/facta-offline-lote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret || '' },
    body: JSON.stringify(marker ? { action: 'processar', lote: marker } : { action: 'processar', global: true }),
  }).catch((e) => console.error('[facta-offline-lote] kick:', e.message));
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);
  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  const secret = process.env.WEBHOOK_SECRET || '';
  const auth = req.headers.get('Authorization') || null;

  try {
    const body = req.method === 'POST' ? await req.json() : {};
    const action = body.action || '';

    // ─── CRIAR LOTE ────────────────────────────────────────────
    if (action === 'criar') {
      const brutos = Array.isArray(body.cpfs) ? body.cpfs : [];
      if (brutos.length === 0) return jsonError('cpfs (array) obrigatorio', 400, req);
      if (brutos.length > CPFS_MAX_LOTE) return jsonError(`Maximo ${CPFS_MAX_LOTE} CPFs por lote`, 400, req);

      const vistos = new Set();
      const cpfs = [];
      let invalidos = 0;
      for (const b of brutos) {
        const c = normalizeCPF(b);
        if (!c) { invalidos++; continue; }
        if (vistos.has(c)) continue;
        vistos.add(c);
        cpfs.push(c);
      }
      if (cpfs.length === 0) return jsonError('Nenhum CPF valido na lista', 400, req);

      const loteId = (crypto.randomUUID() || '').split('-')[0];
      const nomeOperador = user?.nome || user?.username || 'Sistema';
      const marker = `Lote Offline ${loteId} · ${nomeOperador}`;
      const agora = new Date().toISOString();

      // Bulk insert em chunks de 500
      let inseridos = 0;
      for (let i = 0; i < cpfs.length; i += 500) {
        const chunk = cpfs.slice(i, i + 500).map((cpf) => ({
          cpf,
          incluir_c6: false,
          status_geral: 'processando',
          bancos: { [BANCO]: { status: 'pending', bucket: 'aguardando' } },
          iniciado_em: agora,
          criada_por_user_id: user?.id || null,
          criada_por_nome: marker,
          parceiro_id: user?.parceiro_id || null,
        }));
        const { error } = await dbInsert('clt_consultas_fila', chunk);
        if (error) return jsonError('Erro inserindo lote: ' + String(error).substring(0, 300), 500, req);
        inseridos += chunk.length;
      }

      kickWorker(marker, secret);

      const estimativaMin = Math.ceil((cpfs.length * ESPACO_MS) / 60000);
      return jsonResp({
        success: true, lote: marker, loteId,
        total: inseridos, invalidos, duplicados: brutos.length - invalidos - inseridos,
        estimativa: `~${estimativaMin} min (FACTA exige 3s por CPF)`,
        mensagem: `Lote criado com ${inseridos} CPFs — processamento serial iniciado.`,
      }, 200, req);
    }

    // ─── WORKER SERIAL (auto-encadeado) ───────────────────────
    // Com `lote`: drena so os CPFs daquele lote. Com `global:true`: drena
    // QUALQUER card facta_clt_offline pendente (usado pela reconsulta em
    // massa do clt-cron-reconsulta — o criar deixa o card pending e o
    // drainer global processa em serie respeitando os 3s da FACTA).
    if (action === 'processar') {
      const marker = body.lote || null;
      const isGlobal = body.global === true;
      if (!marker && !isGlobal) return jsonError('lote ou global obrigatorio', 400, req);

      const filtroMarker = marker ? `criada_por_nome=eq.${encodeURIComponent(marker)}&` : '';
      const { data: pend } = await dbQuery('clt_consultas_fila',
        `${filtroMarker}${fPendentes}`
        + `&select=id,cpf&order=iniciado_em.asc&limit=${POR_PASSADA}`);
      const rows = Array.isArray(pend) ? pend : [];

      let feitos = 0;
      for (const row of rows) {
        const inicio = Date.now();
        await callApi('/api/clt-fila', {
          action: 'processar', id: row.id, banco: BANCO, force: true,
        }, auth, secret, 15000);
        feitos++;
        // espacamento de 3s entre INICIOS de chamada (exigencia FACTA)
        const gasto = Date.now() - inicio;
        if (feitos < rows.length || rows.length === POR_PASSADA) {
          const espera = Math.max(0, ESPACO_MS - gasto);
          if (espera > 0) await new Promise((r) => setTimeout(r, espera));
        }
      }

      const restantes = await contar(marker, fPendentes);
      if (restantes > 0) kickWorker(marker, secret); // auto-encadeia (lote ou global)

      return jsonResp({ success: true, lote: marker, global: isGlobal, processadosNestaPassada: feitos, restantes }, 200, req);
    }

    // ─── STATUS (contagem por balde + auto-kick se travou) ────
    if (action === 'status') {
      const marker = body.lote;
      if (!marker) return jsonError('lote obrigatorio', 400, req);

      const [total, pendentes, processando, comMargem, semMargem, semHistorico, erro] = await Promise.all([
        contar(marker, null),
        contar(marker, fPendentes),
        contar(marker, fProcessando),
        contar(marker, fBucket('com_margem')),
        contar(marker, fBucket('sem_margem')),
        contar(marker, fBucket('sem_historico')),
        contar(marker, fBucket('erro')),
      ]);
      const concluidos = comMargem + semMargem + semHistorico + erro;

      // AUTO-KICK: se ha pendentes mas nada foi tocado ha 30s+, re-dispara o
      // worker (a cadeia fire-and-forget pode ter morrido num deploy/timeout).
      let rekick = false;
      if (pendentes > 0) {
        const { data: ult } = await dbQuery('clt_consultas_fila',
          `criada_por_nome=eq.${encodeURIComponent(marker)}`
          + `&select=bancos&order=iniciado_em.desc&limit=50`);
        const agora = Date.now();
        const tocadoRecente = (Array.isArray(ult) ? ult : []).some((r) => {
          const at = r?.bancos?.[BANCO]?.atualizado_em;
          return at && (agora - new Date(at).getTime()) < 30000;
        });
        if (!tocadoRecente) { kickWorker(marker, secret); rekick = true; }
      }

      return jsonResp({
        success: true, lote: marker, total,
        pendentes, processando,
        concluidos,
        baldes: { com_margem: comMargem, sem_margem: semMargem, sem_historico: semHistorico, erro },
        progresso: total > 0 ? Math.round((concluidos / total) * 100) + '%' : '0%',
        rekick,
      }, 200, req);
    }

    // ─── LISTAR um balde (pra export/selecao) ─────────────────
    if (action === 'listar') {
      const marker = body.lote;
      const bucket = body.bucket || 'com_margem';
      if (!marker) return jsonError('lote obrigatorio', 400, req);
      const limit = Math.min(parseInt(body.limit || 100, 10), 500);
      const offset = parseInt(body.offset || 0, 10);

      const { data, error } = await dbQuery('clt_consultas_fila',
        `criada_por_nome=eq.${encodeURIComponent(marker)}&${fBucket(bucket)}`
        + `&select=id,cpf,cliente,off:bancos->${BANCO}`
        + `&order=iniciado_em.asc&limit=${limit}&offset=${offset}`);
      if (error) return jsonError('Erro listando: ' + String(error).substring(0, 200), 500, req);

      const rows = (Array.isArray(data) ? data : []).map((r) => ({
        id: r.id, cpf: r.cpf,
        nome: r.cliente?.nome || null,
        temTelefone: !!(r.cliente?.telefones?.length),
        margem: r.off?.dados?.margemDisponivel ?? null,
        empregador: r.off?.dados?.empregador ?? null,
        atualizadoNaFacta: r.off?.dados?.atualizadoNaFacta ?? null,
        mensagem: r.off?.mensagem || null,
      }));
      return jsonResp({ success: true, lote: marker, bucket, count: rows.length, offset, rows }, 200, req);
    }

    // ─── PASSO 2: DISPARAR AUTORIZAÇÃO (SMS) pros com_margem ──
    // Enriquece nome/telefone (clt_clientes → CAGED) e dispara o fluxo
    // ONLINE (facta_clt), que manda o SMS de autorizacao pro cliente.
    // Processa ate `max` por chamada (SMS + aguardarCliente custam tempo);
    // re-chame ate `restantes` zerar.
    if (action === 'dispararAutorizacao') {
      const marker = body.lote;
      const ids = Array.isArray(body.ids) ? body.ids : null;
      const max = Math.min(parseInt(body.max || 5, 10), 8);
      if (!marker && !ids) return jsonError('lote ou ids obrigatorio', 400, req);

      let alvos = [];
      if (ids) {
        for (const id of ids.slice(0, max)) {
          const { data: r } = await dbSelect('clt_consultas_fila', { filters: { id }, single: true });
          if (r) alvos.push(r);
        }
      } else {
        // com_margem que ainda NAO tem o card online (facta_clt) disparado
        const { data } = await dbQuery('clt_consultas_fila',
          `criada_por_nome=eq.${encodeURIComponent(marker)}&${fBucket('com_margem')}`
          + `&bancos->facta_clt=is.null`
          + `&select=id,cpf,cliente&order=iniciado_em.asc&limit=${max}`);
        alvos = Array.isArray(data) ? data : [];
      }

      const resultados = [];
      for (const row of alvos) {
        const cli = row.cliente || {};
        let nome = cli.nome || null;
        let telefones = Array.isArray(cli.telefones) ? cli.telefones : [];

        // Enriquecimento: clt_clientes → CAGED (telefone e o critico pro SMS)
        if (!nome || telefones.length === 0) {
          try {
            const { data: salvo } = await dbSelect('clt_clientes', { filters: { cpf: row.cpf }, single: true });
            if (salvo) {
              if (!nome && salvo.nome) nome = salvo.nome;
              if (telefones.length === 0 && Array.isArray(salvo.telefones)) telefones = salvo.telefones;
            }
          } catch { /* segue */ }
        }
        if (!nome || telefones.length === 0) {
          try {
            const { data: caged } = await dbSelect('clt_base_funcionarios', { filters: { cpf: row.cpf }, single: true });
            if (caged) {
              if (!nome && caged.nome) nome = caged.nome;
              if (telefones.length === 0 && caged.ddd && caged.telefone) {
                telefones = [{ ddd: caged.ddd, numero: caged.telefone, completo: caged.ddd + caged.telefone, whatsapp: true, fonte: 'caged_2024' }];
              }
            }
          } catch { /* segue */ }
        }

        if (!nome || telefones.length === 0) {
          resultados.push({ cpf: row.cpf, ok: false, motivo: 'sem_nome_ou_telefone' });
          continue;
        }

        // Persiste enriquecimento no cliente da fila (processarFacta le de la)
        const clienteMerged = { ...cli };
        if (!clienteMerged.nome) clienteMerged.nome = nome;
        if (!clienteMerged.telefones?.length) clienteMerged.telefones = telefones;
        await dbUpdate('clt_consultas_fila', { id: row.id }, { cliente: clienteMerged, status_geral: 'processando' });

        // Dispara o fluxo ONLINE (SMS de autorizacao) — card facta_clt no mesmo registro
        const r = await callApi('/api/clt-fila', {
          action: 'processar', id: row.id, banco: 'facta_clt', force: true,
        }, auth, secret, 20000);

        // Le o resultado do card pra reportar
        const { data: depois } = await dbSelect('clt_consultas_fila', { filters: { id: row.id }, single: true });
        const card = depois?.bancos?.facta_clt || {};
        resultados.push({
          cpf: row.cpf, ok: r.ok,
          status: card.status || null,
          mensagem: card.mensagem || null,
        });

        await new Promise((res) => setTimeout(res, 1000)); // espaca os SMS
      }

      let restantes = null;
      if (marker) {
        restantes = await contar(marker, `${fBucket('com_margem')}&bancos->facta_clt=is.null`);
      }

      return jsonResp({
        success: true, lote: marker || null,
        disparados: resultados.filter((r) => r.ok).length,
        semTelefone: resultados.filter((r) => r.motivo === 'sem_nome_ou_telefone').length,
        restantes, resultados,
      }, 200, req);
    }

    return jsonError('Action invalida. Validas: criar, processar, status, listar, dispararAutorizacao', 400, req);
  } catch (e) {
    return jsonError('Erro lote offline: ' + e.message, 500, req);
  }
}
