// ══════════════════════════════════════════════════════════════════
// api/pref-seed.js — Popula tabelas pref_* a partir de /pref_seed.json
//
// USO:
//   1) Apos atualizar a planilha de prefeituras (ver scripts/pref/RUNBOOK_ATUALIZAR_CATALOGO_PREFEITURAS.md):
//      python scripts/pref/02_parse.py -> 03_clean_lev.py -> 05_compact_seed.py (gera pref_seed.json na raiz)
//      commit + push (dono)
//   2) Apos o deploy completar, com sessao admin/gestor (ou x-internal-secret):
//      POST /api/pref-seed {"action":"diagnostico"}                 -> o que esta protegido / editado na tela
//      POST /api/pref-seed {"action":"reseed"}                      -> modo CONSERVADOR
//      POST /api/pref-seed {"action":"reseed","modo":"planilha"}    -> modo PLANILHA MANDA
//
// Modos do reseed (relacoes banco x convenio) — mesmo desenho do api/gov-seed.js:
//   - conservador (default): apaga so as relacoes com editado_manual = false/null e recria a partir do
//     seed, pulando pares editado_manual = true (cadastros manuais feitos na tela pelo admin —
//     feat a124100 — ficam intactos).
//   - planilha: para cada convenio presente no seed, apaga todas as relacoes EXCETO as editadas de
//     verdade na tela depois de `preservar_desde` (default 2026-05-06, dia seguinte a carga inicial;
//     criterio: editado_manual = true E updated_at > preservar_desde) e recria a partir do seed com
//     editado_manual = false (assim o modo conservador volta a funcionar nas proximas rodadas).
//     Convenios que nao estao no seed: por padrao nao sao tocados; com `excluir_fora_da_planilha: true`
//     sao EXCLUIDOS (relacoes somem em cascata; analises de holerite que apontavam pra eles ficam sem
//     convenio sugerido). Decisao do dono em 17/09/2026 (federal/governos): a planilha e a lista completa.
//
// Em ambos os modos:
//   - Le pref_seed.json do dominio da API (SEED_BASE_URL, default motordeport.vercel.app). NAO usa
//     origin/host da request: desde a desativacao do V1 o vercel.json redireciona tudo exceto /api/ e
//     *_seed.json pra flowforce.tec.br (VPS, sem o arquivo) e a chamada chega via rewrite do V2.
//   - INSERT so dos bancos/convenios NOVOS (nome/UF/municipio/tipo existentes podem ter sido corrigidos
//     na UI ou classificados pelo Postgres — nao sao sobrescritos)
//   - PATCH atualizado_em nos convenios que ja existiam (data do seed)
//
// ANTES (ate 17/09/2026) este endpoint fazia UPSERT de tudo + DELETE de TODAS as relacoes: apagava os
// bancos cadastrados manualmente na tela e sobrescrevia o `tipo` classificado no banco por 'pendente'.
//
// Auth: x-internal-secret OU role admin/gestor.
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth, requireRole } from './_lib/auth.js';
import { dbQuery } from './_lib/supabase.js';

// Base onde pref_seed.json e servido como estatico. NAO usa origin/host da request:
// desde a desativacao do V1 o vercel.json redireciona tudo exceto /api/ e *_seed.json
// pra flowforce.tec.br (VPS, sem o arquivo) e a chamada chega via rewrite do V2 —
// esses headers apontam pro lugar errado. Mesmo padrao do api/fed-seed.js.
const SEED_BASE_URL = () => (process.env.SEED_BASE_URL || 'https://motordeport.vercel.app').replace(/\/$/, '');
const SUPABASE_URL = () => process.env.SUPABASE_URL;
const SUPABASE_KEY = () => process.env.SUPABASE_SERVICE_KEY;
const PRESERVAR_DESDE_DEFAULT = '2026-05-06';

function sbHeaders(prefer) {
  const h = {
    'apikey': SUPABASE_KEY(),
    'Authorization': `Bearer ${SUPABASE_KEY()}`,
    'Content-Type': 'application/json',
  };
  if (prefer) h['Prefer'] = prefer;
  return h;
}

async function sbFetch(pathAndQuery, method, body, prefer) {
  const resp = await fetch(`${SUPABASE_URL()}/rest/v1/${pathAndQuery}`, {
    method, headers: sbHeaders(prefer), body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`${method} ${pathAndQuery.split('?')[0]}: HTTP ${resp.status} ${t.substring(0, 300)}`);
  }
  if (prefer && prefer.includes('return=representation')) return await resp.json();
  return null;
}

const isoDateOk = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

// Tipo do convenio para os NOVOS (os existentes ja foram classificados no Postgres por
// pref_classify_tipo() na carga inicial e podem ter sido corrigidos na tela — nao mexemos).
// O parser manda 'pendente'; aqui classificamos pelo nome da aba/convenio, mesma regra da UI:
//   cartao_beneficio: CB / CART. BENF / CARTAO BENEFICIO
//   instituto_previdencia: PREV / IPAM / IPSEM / IPREM / INST / INSTITUTO / RPPS
//   prefeitura: o resto
function classificarTipo(c) {
  const s = `${c.sheet || ''} ${c.nome || ''}`.toUpperCase();
  if (/\bCB\b|CART\.?\s*BEN|CART[ÃA]O\s+BENEF|CARTAO\s+CONSIGNA|CART[ÃA]O\s+CONSIGNA/.test(s)) return 'cartao_beneficio';
  if (/PREV\b|\bIPAM\b|\bIPSEM\b|\bIPREM\b|\bIPM\b|\bINST\b|INSTITUTO|\bRPPS\b|PREVID/.test(s)) return 'instituto_previdencia';
  return 'prefeitura';
}

// ── Diagnostico: o que esta protegido e o que foi editado na tela ──────────
async function diagnostico(body, req) {
  const desde = isoDateOk(body.preservar_desde) ? body.preservar_desde : PRESERVAR_DESDE_DEFAULT;
  const count = async (filtro) => {
    const { data, error } = await dbQuery('pref_banco_convenio', `${filtro}select=id&limit=20000`);
    if (error) throw new Error(error.substring(0, 300));
    return (data || []).length;
  };
  const total = await count('');
  const protegidas = await count('editado_manual=eq.true&');
  const livres = await count('editado_manual=eq.false&');
  const nulas = await count('editado_manual=is.null&');
  const { data: editadas, error } = await dbQuery(
    'pref_banco_convenio',
    `editado_manual=eq.true&updated_at=gt.${desde}&select=id,updated_at,created_at,suspenso,taxa_minima_port,margem_utilizavel,criado_por_admin,pref_bancos(slug,nome),pref_convenios(slug,nome,uf,municipio)&order=updated_at.desc&limit=5000`
  );
  if (error) throw new Error(error.substring(0, 300));
  // convenios que existem no banco mas nao estao na planilha (seed) atual
  let foraDaPlanilha = [], seedGeradoEm = null;
  try {
    const rs = await fetch(SEED_BASE_URL() + '/pref_seed.json', { redirect: 'manual' });
    if (rs.ok) {
      const sd = await rs.json(); seedGeradoEm = sd.meta?.gerado_em || null;
      const seedSlugs = new Set((sd.convenios || []).map(c => c.slug));
      const { data: todos } = await dbQuery('pref_convenios', 'select=id,slug,nome,uf,municipio,tipo,ativo&limit=5000');
      const { data: rels } = await dbQuery('pref_banco_convenio', 'select=convenio_id&limit=20000');
      const qtd = new Map(); for (const r of rels || []) qtd.set(r.convenio_id, (qtd.get(r.convenio_id) || 0) + 1);
      foraDaPlanilha = (todos || []).filter(c => !seedSlugs.has(c.slug))
        .map(c => ({ id: c.id, slug: c.slug, nome: c.nome, uf: c.uf, municipio: c.municipio, tipo: c.tipo, ativo: c.ativo, relacoes: qtd.get(c.id) || 0 }));
    }
  } catch {}
  // pref_convenios / pref_bancos podem nao ter a coluna editado_manual — nao e erro
  let convEditados = [], bancosEditados = [];
  try { const r1 = await dbQuery('pref_convenios', 'editado_manual=eq.true&select=id,slug,nome,uf&limit=5000'); convEditados = r1.data || []; } catch {}
  try { const r2 = await dbQuery('pref_bancos', 'editado_manual=eq.true&select=id,slug,nome&limit=5000'); bancosEditados = r2.data || []; } catch {}
  return jsonResp({
    ok: true,
    preservar_desde: desde,
    relacoes: { total, protegidas, livres, nulas, editadas_na_tela_depois: (editadas || []).length },
    editadas_na_tela: (editadas || []).map(r => ({
      id: r.id, banco: r.pref_bancos?.slug, convenio: r.pref_convenios?.slug, uf: r.pref_convenios?.uf,
      municipio: r.pref_convenios?.municipio, criado_por_admin: r.criado_por_admin,
      suspenso: r.suspenso, taxa_minima_port: r.taxa_minima_port, margem_utilizavel: r.margem_utilizavel,
      criado_em: r.created_at, editado_em: r.updated_at,
    })),
    seed_gerado_em: seedGeradoEm,
    convenios_fora_da_planilha: foraDaPlanilha,
    convenios_editados: convEditados.map(c => c.slug),
    bancos_editados: bancosEditados.map(b => b.slug),
    explicacao: 'No modo "planilha" so ficam preservadas as relacoes com editado_manual=true E updated_at > preservar_desde ' +
      '(cadastros/edicoes feitos na tela depois da carga inicial); o resto e recriado pelo seed. ' +
      'Com excluir_fora_da_planilha=true os convenios listados em convenios_fora_da_planilha sao apagados.',
  }, 200, req);
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);
  if (req.method !== 'POST') return jsonError('Method Not Allowed', 405, req);

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  // Permite admin/gestor OU chamada interna
  if (!auth._internal) {
    const roleErr = requireRole(auth, ['admin','gestor']);
    if (roleErr) return roleErr;
  }

  let body = {};
  try { body = await req.json(); } catch {}

  if (body.action === 'diagnostico') {
    try { return await diagnostico(body, req); }
    catch (e) { return jsonError(`Falha no diagnostico: ${e.message}`, 500, req); }
  }
  if (body.action !== 'reseed') {
    return jsonError("action invalida. Use 'reseed' (modo 'conservador' ou 'planilha') ou 'diagnostico'.", 400, req);
  }
  const modoPlanilha = body.modo === 'planilha';
  const preservarDesde = isoDateOk(body.preservar_desde) ? body.preservar_desde : PRESERVAR_DESDE_DEFAULT;
  const excluirFora = modoPlanilha && body.excluir_fora_da_planilha === true;

  const t0 = Date.now();
  try {
    // ── 1) Carrega o JSON publico ──
    const seedUrl = SEED_BASE_URL() + '/pref_seed.json';
    // redirect manual: se o vercel.json voltar a redirecionar *_seed.json, falha aqui com
    // status claro em vez de seguir pro HTML do V2 e quebrar no JSON.parse.
    const r = await fetch(seedUrl, { redirect: 'manual' });
    if (!r.ok) return jsonError(`Falha ao carregar ${seedUrl}: HTTP ${r.status} (3xx = vercel.json esta redirecionando o seed)`, 500, req);
    let seed;
    try { seed = await r.json(); }
    catch (e) { return jsonError(`pref_seed.json invalido em ${seedUrl}: ${e.message}`, 500, req); }
    const stats = { modo: modoPlanilha ? 'planilha' : 'conservador', bancos: 0, convenios: 0, convenios_atualizados: 0,
                    convenios_excluidos: 0, relacoes_apagadas: 0, relacoes_preservadas: 0, banco_convenio: 0 };

    // ── 2) Bancos: pega os ja existentes e SO insere os novos (preserva edits) ──
    const { data: bancosExistentes } = await dbQuery('pref_bancos', 'select=slug&limit=2000');
    const bancosExistentesSlugs = new Set((bancosExistentes||[]).map(b=>b.slug));
    const bancosNovos = (seed.bancos_unicos || []).filter(b => !bancosExistentesSlugs.has(b.slug)).map(b => ({
      slug: b.slug, nome: b.nome
    }));
    if (bancosNovos.length) {
      const arr = await sbFetch('pref_bancos', 'POST', bancosNovos, 'return=representation');
      stats.bancos = Array.isArray(arr) ? arr.length : 0;
      stats.bancos_novos_slugs = bancosNovos.map(b => b.slug);
    }

    // ── 3) Convenios: pega os ja existentes e SO insere os novos ──
    const { data: convExistentes } = await dbQuery('pref_convenios', 'select=slug&limit=5000');
    const convExistentesSlugs = new Set((convExistentes||[]).map(c=>c.slug));
    const conveniosNovos = (seed.convenios || []).filter(c => !convExistentesSlugs.has(c.slug)).map(c => ({
      slug: c.slug, nome: c.nome, uf: c.uf, estado_nome: c.estado_nome,
      municipio: c.municipio || null,
      tipo: (c.tipo && c.tipo !== 'pendente') ? c.tipo : classificarTipo(c),
      sheet_origem: c.sheet, atualizado_em: seed.meta?.gerado_em || null
    }));
    const CONV_BATCH = 100;
    for (let i = 0; i < conveniosNovos.length; i += CONV_BATCH) {
      const arr = await sbFetch('pref_convenios', 'POST', conveniosNovos.slice(i, i + CONV_BATCH), 'return=representation');
      stats.convenios += Array.isArray(arr) ? arr.length : 0;
    }
    if (conveniosNovos.length) stats.convenios_novos_slugs = conveniosNovos.map(c => c.slug);

    // ── 3b) Convenios que JA existiam: so carimba atualizado_em (nao mexe em nome/UF/municipio/tipo,
    //        que podem ter sido corrigidos na UI). E o que vira "atualizado em" no catalogo.
    if (seed.meta?.gerado_em) {
      const slugsExistentes = (seed.convenios || []).map(c => c.slug).filter(sl => convExistentesSlugs.has(sl));
      const SL_BATCH = 40;
      for (let i = 0; i < slugsExistentes.length; i += SL_BATCH) {
        const lote = slugsExistentes.slice(i, i + SL_BATCH).map(sl => `"${sl}"`).join(',');
        await sbFetch(`pref_convenios?slug=in.(${encodeURIComponent(lote)})`, 'PATCH',
          { atualizado_em: seed.meta.gerado_em }, 'return=minimal');
        stats.convenios_atualizados += slugsExistentes.slice(i, i + SL_BATCH).length;
      }
    }

    // ── 3c) (modo planilha + excluir_fora_da_planilha) EXCLUI convenios que nao estao no seed ──
    //        Relacoes somem em cascata (FK on delete cascade). pref_holerite_analises.convenio_sugerido_id
    //        aponta pra pref_convenios sem cascade: zera antes pra nao violar a FK.
    if (excluirFora) {
      const seedSlugs = new Set((seed.convenios || []).map(c => c.slug));
      const { data: todosConv } = await dbQuery('pref_convenios', 'select=id,slug&limit=5000');
      const foraIds = (todosConv || []).filter(c => !seedSlugs.has(c.slug)).map(c => c.id);
      if (foraIds.length) {
        const ID_BATCH = 50;
        stats.convenios_excluidos_slugs = [];
        for (let i = 0; i < foraIds.length; i += ID_BATCH) {
          const ids = foraIds.slice(i, i + ID_BATCH).join(',');
          await sbFetch(`pref_holerite_analises?convenio_sugerido_id=in.(${ids})`, 'PATCH', { convenio_sugerido_id: null }, 'return=minimal');
          const exc = await sbFetch(`pref_convenios?id=in.(${ids})&select=id,slug`, 'DELETE', undefined, 'return=representation');
          stats.convenios_excluidos += Array.isArray(exc) ? exc.length : 0;
          stats.convenios_excluidos_slugs.push(...(exc || []).map(c => c.slug));
        }
      }
    }

    // ── 4) Mapeia slug -> id de bancos e convenios ──
    const { data: bancosDb } = await dbQuery('pref_bancos', 'select=id,slug&limit=2000');
    const { data: convDb } = await dbQuery('pref_convenios', 'select=id,slug&limit=5000');
    const bancoIdBySlug = new Map((bancosDb||[]).map(b => [b.slug, b.id]));
    const convIdBySlug = new Map((convDb||[]).map(c => [c.slug, c.id]));
    const convIdsNoSeed = (seed.convenios || []).map(c => convIdBySlug.get(c.slug)).filter(Boolean);

    // ── 5) Quais pares ficam PRESERVADOS (nao apagar, nao reinserir) ──
    //   conservador: todo par editado_manual = true
    //   planilha:    so pares editado_manual = true E editados na tela depois de preservarDesde
    const filtroPreservar = modoPlanilha
      ? `editado_manual=eq.true&updated_at=gt.${preservarDesde}`
      : 'editado_manual=eq.true';
    const { data: protegidosRaw, error: eP } = await dbQuery('pref_banco_convenio', `${filtroPreservar}&select=id,banco_id,convenio_id&limit=20000`);
    if (eP) throw new Error(`select protegidos: ${eP.substring(0, 300)}`);
    const protegidos = new Set((protegidosRaw||[]).map(r => `${r.banco_id}-${r.convenio_id}`));
    stats.relacoes_preservadas = protegidos.size;

    // ── 6) DELETE das relacoes que serao recriadas pelo seed ──
    if (modoPlanilha) {
      // so convenios presentes no seed; tudo que nao esta preservado
      const ID_BATCH = 30;
      for (let i = 0; i < convIdsNoSeed.length; i += ID_BATCH) {
        const ids = convIdsNoSeed.slice(i, i + ID_BATCH).join(',');
        const apagadas = await sbFetch(
          `pref_banco_convenio?convenio_id=in.(${ids})&or=(editado_manual.is.null,editado_manual.eq.false,updated_at.lte.${preservarDesde})&select=id`,
          'DELETE', undefined, 'return=representation');
        stats.relacoes_apagadas += Array.isArray(apagadas) ? apagadas.length : 0;
      }
    } else {
      // conservador: apaga o que NAO foi editado manualmente (false OU null)
      const apagadas = await sbFetch(
        'pref_banco_convenio?or=(editado_manual.is.null,editado_manual.eq.false)&select=id',
        'DELETE', undefined, 'return=representation');
      stats.relacoes_apagadas = Array.isArray(apagadas) ? apagadas.length : 0;
    }

    // ── 7) INSERT banco_convenio em batches de 50 (PULA pares preservados) ──
    const todasRels = [];
    const vistos = new Set();   // a planilha pode repetir o mesmo banco no mesmo convenio (unique banco_id+convenio_id)
    for (const c of seed.convenios || []) {
      const cid = convIdBySlug.get(c.slug);
      if (!cid) continue;
      for (const b of c.bancos || []) {
        const bid = bancoIdBySlug.get(b.slug);
        if (!bid) continue;
        if (protegidos.has(`${bid}-${cid}`)) continue;
        if (vistos.has(`${bid}-${cid}`)) { stats.pares_duplicados_no_seed = (stats.pares_duplicados_no_seed || 0) + 1; continue; }
        vistos.add(`${bid}-${cid}`);
        const ops = b.operacoes || {};
        const a = b.atributos || {};
        todasRels.push({
          banco_id: bid,
          convenio_id: cid,
          opera_novo: !!ops.novo,
          opera_refin: !!ops.refin,
          opera_port: !!ops.port,
          opera_cartao: !!ops.cartao,
          suspenso: !!b.suspenso,
          margem_utilizavel: b.margem_utilizavel,
          idade_min: b.idade_min,
          idade_max: b.idade_max,
          taxa_minima_port: b.taxa_minima_port,
          data_corte: a.data_corte || null,
          valor_minimo: a.valor_minimo || null,
          qtd_contratos: a.qtd_contratos || null,
          atributos: a,
          atributos_brutos: b.atributos_brutos || [],
          editado_manual: false,   // veio da planilha: o proximo reseed pode substituir
        });
      }
    }
    const BATCH = 50;
    for (let i = 0; i < todasRels.length; i += BATCH) {
      const batch = todasRels.slice(i, i + BATCH);
      await sbFetch('pref_banco_convenio', 'POST', batch, 'return=minimal');
      stats.banco_convenio += batch.length;
    }

    return jsonResp({
      ok: true,
      stats,
      preservar_desde: modoPlanilha ? preservarDesde : null,
      duracao_ms: Date.now() - t0,
      seed_meta: seed.meta,
    }, 200, req);
  } catch (e) {
    return jsonError(`Falha no reseed: ${e.message}`, 500, req);
  }
}
