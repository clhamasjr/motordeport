// ══════════════════════════════════════════════════════════════════
// api/gov-seed.js — Popula tabelas gov_* a partir de /gov_seed.json
//
// USO:
//   1) Apos atualizar a planilha de governos (ver scripts/gov/RUNBOOK_ATUALIZAR_CATALOGO_GOVERNOS.md):
//      python scripts/gov/02_parse.py -> 03_clean_lev.py -> 05_compact_seed.py (gera gov_seed.json na raiz)
//      commit + push (dono)
//   2) Apos o deploy completar, com sessao admin/gestor (ou x-internal-secret):
//      POST /api/gov-seed {"action":"diagnostico"}                 -> o que esta protegido / editado na tela
//      POST /api/gov-seed {"action":"reseed"}                      -> modo CONSERVADOR (padrao antigo)
//      POST /api/gov-seed {"action":"reseed","modo":"planilha"}    -> modo PLANILHA MANDA
//
// Modos do reseed (relacoes banco x convenio):
//   - conservador (default): apaga so as relacoes com editado_manual = false/null e recria a partir do
//     seed, pulando pares editado_manual = true. ATENCAO: em 05/05/2026 TODAS as relacoes existentes
//     foram marcadas editado_manual = true ("estado canonico") — nesse modo a planilha nova so ADICIONA
//     pares que ainda nao existem; regras/taxas/LEV das existentes NAO mudam.
//   - planilha: para cada convenio presente no seed, apaga todas as relacoes EXCETO as editadas de
//     verdade na tela depois de `preservar_desde` (default 2026-05-06, dia seguinte a marcacao em massa;
//     criterio: editado_manual = true E updated_at > preservar_desde) e recria a partir do seed com
//     editado_manual = false (assim o modo conservador volta a funcionar nas proximas rodadas).
//     Convenios que nao estao no seed nao sao tocados.
//
// Em ambos os modos:
//   - Le gov_seed.json do dominio da API (SEED_BASE_URL, default motordeport.vercel.app). NAO usa
//     origin/host da request: desde a desativacao do V1 o vercel.json redireciona tudo exceto /api/ e
//     *_seed.json pra flowforce.tec.br (VPS, sem o arquivo) e a chamada chega via rewrite do V2.
//   - INSERT so dos bancos/convenios NOVOS (nome/UF existentes podem ter sido corrigidos na UI)
//   - PATCH atualizado_em nos convenios que ja existiam (data do seed)
//
// Auth: x-internal-secret OU role admin/gestor.
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth, requireRole } from './_lib/auth.js';
import { dbQuery } from './_lib/supabase.js';

// Base onde gov_seed.json e servido como estatico. NAO usa origin/host da request:
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

// ── Diagnostico: o que esta protegido e o que foi editado na tela ──────────
async function diagnostico(body, req) {
  const desde = isoDateOk(body.preservar_desde) ? body.preservar_desde : PRESERVAR_DESDE_DEFAULT;
  const count = async (filtro) => {
    const { data, error } = await dbQuery('gov_banco_convenio', `${filtro}select=id&limit=10000`);
    if (error) throw new Error(error.substring(0, 300));
    return (data || []).length;
  };
  const total = await count('');
  const protegidas = await count('editado_manual=eq.true&');
  const livres = await count('editado_manual=eq.false&');
  const nulas = await count('editado_manual=is.null&');
  const { data: editadas, error } = await dbQuery(
    'gov_banco_convenio',
    `editado_manual=eq.true&updated_at=gt.${desde}&select=id,updated_at,created_at,suspenso,taxa_minima_port,margem_utilizavel,gov_bancos(slug,nome),gov_convenios(slug,nome,uf)&order=updated_at.desc&limit=2000`
  );
  if (error) throw new Error(error.substring(0, 300));
  const { data: convEditados } = await dbQuery('gov_convenios', 'editado_manual=eq.true&select=id,slug,nome,uf&limit=2000');
  const { data: bancosEditados } = await dbQuery('gov_bancos', 'editado_manual=eq.true&select=id,slug,nome&limit=2000');
  return jsonResp({
    ok: true,
    preservar_desde: desde,
    relacoes: { total, protegidas, livres, nulas, editadas_na_tela_depois: (editadas || []).length },
    editadas_na_tela: (editadas || []).map(r => ({
      id: r.id, banco: r.gov_bancos?.slug, convenio: r.gov_convenios?.slug, uf: r.gov_convenios?.uf,
      suspenso: r.suspenso, taxa_minima_port: r.taxa_minima_port, margem_utilizavel: r.margem_utilizavel,
      criado_em: r.created_at, editado_em: r.updated_at,
    })),
    convenios_editados: (convEditados || []).map(c => c.slug),
    bancos_editados: (bancosEditados || []).map(b => b.slug),
    explicacao: 'Em 05/05/2026 todas as relacoes foram marcadas editado_manual=true. No modo "planilha" so ficam ' +
      'preservadas as relacoes com editado_manual=true E updated_at > preservar_desde; o resto e recriado pelo seed.',
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

  const t0 = Date.now();
  try {
    // ── 1) Carrega o JSON publico (na raiz do dominio, junto do index.html) ──
    const seedUrl = SEED_BASE_URL() + '/gov_seed.json';
    // redirect manual: se o vercel.json voltar a redirecionar *_seed.json, falha aqui com
    // status claro em vez de seguir pro HTML do V2 e quebrar no JSON.parse.
    const r = await fetch(seedUrl, { redirect: 'manual' });
    if (!r.ok) return jsonError(`Falha ao carregar ${seedUrl}: HTTP ${r.status} (3xx = vercel.json esta redirecionando o seed)`, 500, req);
    let seed;
    try { seed = await r.json(); }
    catch (e) { return jsonError(`gov_seed.json invalido em ${seedUrl}: ${e.message}`, 500, req); }
    const stats = { modo: modoPlanilha ? 'planilha' : 'conservador', bancos: 0, convenios: 0, convenios_atualizados: 0,
                    relacoes_apagadas: 0, relacoes_preservadas: 0, banco_convenio: 0 };

    // ── 2) Bancos: pega os ja existentes e SO insere os novos (preserva edits) ──
    const { data: bancosExistentes } = await dbQuery('gov_bancos', 'select=slug&limit=1000');
    const bancosExistentesSlugs = new Set((bancosExistentes||[]).map(b=>b.slug));
    const bancosNovos = (seed.bancos_unicos || []).filter(b => !bancosExistentesSlugs.has(b.slug)).map(b => ({
      slug: b.slug, nome: b.nome
    }));
    if (bancosNovos.length) {
      const arr = await sbFetch('gov_bancos', 'POST', bancosNovos, 'return=representation');
      stats.bancos = Array.isArray(arr) ? arr.length : 0;
    }

    // ── 3) Convenios: pega os ja existentes e SO insere os novos ──
    const { data: convExistentes } = await dbQuery('gov_convenios', 'select=slug&limit=1000');
    const convExistentesSlugs = new Set((convExistentes||[]).map(c=>c.slug));
    const conveniosNovos = (seed.convenios || []).filter(c => !convExistentesSlugs.has(c.slug)).map(c => ({
      slug: c.slug, nome: c.nome, uf: c.uf, estado_nome: c.estado_nome,
      sheet_origem: c.sheet, atualizado_em: seed.meta?.gerado_em || null
    }));
    if (conveniosNovos.length) {
      const arr = await sbFetch('gov_convenios', 'POST', conveniosNovos, 'return=representation');
      stats.convenios = Array.isArray(arr) ? arr.length : 0;
    }

    // ── 3b) Convenios que JA existiam: so carimba atualizado_em (nao mexe em nome/UF,
    //        que podem ter sido corrigidos na UI). E o que vira "atualizado em" no catalogo.
    if (seed.meta?.gerado_em) {
      const slugsExistentes = (seed.convenios || []).map(c => c.slug).filter(sl => convExistentesSlugs.has(sl));
      const SL_BATCH = 40;
      for (let i = 0; i < slugsExistentes.length; i += SL_BATCH) {
        const lote = slugsExistentes.slice(i, i + SL_BATCH).map(sl => `"${sl}"`).join(',');
        await sbFetch(`gov_convenios?slug=in.(${encodeURIComponent(lote)})`, 'PATCH',
          { atualizado_em: seed.meta.gerado_em }, 'return=minimal');
        stats.convenios_atualizados += slugsExistentes.slice(i, i + SL_BATCH).length;
      }
    }

    // ── 4) Mapeia slug -> id de bancos e convenios ──
    const { data: bancosDb } = await dbQuery('gov_bancos', 'select=id,slug&limit=1000');
    const { data: convDb } = await dbQuery('gov_convenios', 'select=id,slug&limit=1000');
    const bancoIdBySlug = new Map((bancosDb||[]).map(b => [b.slug, b.id]));
    const convIdBySlug = new Map((convDb||[]).map(c => [c.slug, c.id]));
    const convIdsNoSeed = (seed.convenios || []).map(c => convIdBySlug.get(c.slug)).filter(Boolean);

    // ── 5) Quais pares ficam PRESERVADOS (nao apagar, nao reinserir) ──
    //   conservador: todo par editado_manual = true
    //   planilha:    so pares editado_manual = true E editados na tela depois de preservarDesde
    const filtroPreservar = modoPlanilha
      ? `editado_manual=eq.true&updated_at=gt.${preservarDesde}`
      : 'editado_manual=eq.true';
    const { data: protegidosRaw, error: eP } = await dbQuery('gov_banco_convenio', `${filtroPreservar}&select=id,banco_id,convenio_id&limit=10000`);
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
          `gov_banco_convenio?convenio_id=in.(${ids})&or=(editado_manual.is.null,editado_manual.eq.false,updated_at.lte.${preservarDesde})&select=id`,
          'DELETE', undefined, 'return=representation');
        stats.relacoes_apagadas += Array.isArray(apagadas) ? apagadas.length : 0;
      }
    } else {
      // conservador: apaga o que NAO foi editado manualmente (false OU null)
      const apagadas = await sbFetch(
        'gov_banco_convenio?or=(editado_manual.is.null,editado_manual.eq.false)&select=id',
        'DELETE', undefined, 'return=representation');
      stats.relacoes_apagadas = Array.isArray(apagadas) ? apagadas.length : 0;
    }

    // ── 7) INSERT banco_convenio em batches de 50 (PULA pares preservados) ──
    const todasRels = [];
    for (const c of seed.convenios || []) {
      const cid = convIdBySlug.get(c.slug);
      if (!cid) continue;
      for (const b of c.bancos || []) {
        const bid = bancoIdBySlug.get(b.slug);
        if (!bid) continue;
        if (protegidos.has(`${bid}-${cid}`)) continue;
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
      await sbFetch('gov_banco_convenio', 'POST', batch, 'return=minimal');
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
