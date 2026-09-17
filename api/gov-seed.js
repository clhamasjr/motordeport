// ══════════════════════════════════════════════════════════════════
// api/gov-seed.js — Popula tabelas gov_* a partir de /gov_seed.json
//
// USO:
//   1) Apos atualizar a planilha de governos:
//      python scripts/gov/02_parse.py     (gera scripts/gov/convenios.json)
//      python scripts/gov/05_compact_seed.py  (gera public/gov_seed.json)
//      git push
//   2) Apos o deploy completar, dispare 1x:
//      curl -X POST https://motordeport.vercel.app/api/gov-seed \
//           -H "Content-Type: application/json" \
//           -H "x-internal-secret: <WEBHOOK_SECRET>" \
//           -d '{"action":"reseed"}'
//
// O endpoint:
//   - Le gov_seed.json do dominio da API (SEED_BASE_URL, default motordeport.vercel.app)
//   - INSERT so dos bancos/convenios NOVOS (nome/UF existentes podem ter sido corrigidos na UI)
//   - PATCH atualizado_em nos convenios que ja existiam (data do seed)
//   - DELETE + INSERT em gov_banco_convenio, preservando pares editado_manual=true
//   - Retorna estatisticas
//
// Auth: x-internal-secret OU role admin/gestor.
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth, requireRole } from './_lib/auth.js';
import { dbInsert, dbDelete, dbQuery, dbUpsert } from './_lib/supabase.js';

// Base onde gov_seed.json e servido como estatico. NAO usa origin/host da request:
// desde a desativacao do V1 o vercel.json redireciona tudo exceto /api/ e *_seed.json
// pra flowforce.tec.br (VPS, sem o arquivo) e a chamada chega via rewrite do V2 —
// esses headers apontam pro lugar errado. Mesmo padrao do api/fed-seed.js.
const SEED_BASE_URL = () => (process.env.SEED_BASE_URL || 'https://motordeport.vercel.app').replace(/\/$/, '');
const SUPABASE_URL = () => process.env.SUPABASE_URL;
const SUPABASE_KEY = () => process.env.SUPABASE_SERVICE_KEY;

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

  if (body.action !== 'reseed') {
    return jsonError("action invalida. Use 'reseed'.", 400, req);
  }

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
    const stats = { bancos: 0, convenios: 0, convenios_atualizados: 0, banco_convenio: 0 };

    // ── 2) Bancos: pega os ja existentes e SO insere os novos (preserva edits) ──
    const { data: bancosExistentes } = await dbQuery('gov_bancos', 'select=slug&limit=1000');
    const bancosExistentesSlugs = new Set((bancosExistentes||[]).map(b=>b.slug));
    const bancosNovos = (seed.bancos_unicos || []).filter(b => !bancosExistentesSlugs.has(b.slug)).map(b => ({
      slug: b.slug, nome: b.nome
    }));
    if (bancosNovos.length) {
      const url = `${SUPABASE_URL()}/rest/v1/gov_bancos`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY(),
          'Authorization': `Bearer ${SUPABASE_KEY()}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(bancosNovos)
      });
      if (!resp.ok) {
        const t = await resp.text();
        return jsonError(`Erro insert bancos novos: ${t.substring(0,300)}`, 500, req);
      }
      const arr = await resp.json();
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
      const url = `${SUPABASE_URL()}/rest/v1/gov_convenios`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY(),
          'Authorization': `Bearer ${SUPABASE_KEY()}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(conveniosNovos)
      });
      if (!resp.ok) {
        const t = await resp.text();
        return jsonError(`Erro insert convenios novos: ${t.substring(0,300)}`, 500, req);
      }
      const arr = await resp.json();
      stats.convenios = Array.isArray(arr) ? arr.length : 0;
    }

    // ── 3b) Convenios que JA existiam: so carimba atualizado_em (nao mexe em nome/UF,
    //        que podem ter sido corrigidos na UI). E o que vira "atualizado em" no catalogo.
    if (seed.meta?.gerado_em) {
      const slugsExistentes = (seed.convenios || []).map(c => c.slug).filter(sl => convExistentesSlugs.has(sl));
      const SL_BATCH = 40;
      for (let i = 0; i < slugsExistentes.length; i += SL_BATCH) {
        const lote = slugsExistentes.slice(i, i + SL_BATCH).map(sl => `"${sl}"`).join(',');
        const url = `${SUPABASE_URL()}/rest/v1/gov_convenios?slug=in.(${encodeURIComponent(lote)})`;
        const resp = await fetch(url, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_KEY(),
            'Authorization': `Bearer ${SUPABASE_KEY()}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ atualizado_em: seed.meta.gerado_em })
        });
        if (!resp.ok) {
          const t = await resp.text();
          return jsonError(`Erro ao carimbar atualizado_em dos convenios: ${t.substring(0,300)}`, 500, req);
        }
        stats.convenios_atualizados = (stats.convenios_atualizados || 0) + slugsExistentes.slice(i, i + SL_BATCH).length;
      }
    }

    // ── 4) Mapeia slug -> id de bancos e convenios ──
    const { data: bancosDb } = await dbQuery('gov_bancos', 'select=id,slug&limit=1000');
    const { data: convDb } = await dbQuery('gov_convenios', 'select=id,slug&limit=1000');
    const bancoIdBySlug = new Map((bancosDb||[]).map(b => [b.slug, b.id]));
    const convIdBySlug = new Map((convDb||[]).map(c => [c.slug, c.id]));

    // ── 5) DELETE banco_convenio que NAO foi editado manualmente ──
    // (preserva edicoes manuais e estado canonico atual)
    {
      const url = `${SUPABASE_URL()}/rest/v1/gov_banco_convenio?editado_manual=eq.false`;
      const resp = await fetch(url, {
        method: 'DELETE',
        headers: { 'apikey': SUPABASE_KEY(), 'Authorization': `Bearer ${SUPABASE_KEY()}` }
      });
      if (!resp.ok) {
        const t = await resp.text();
        return jsonError(`Erro delete banco_convenio: ${t.substring(0,300)}`, 500, req);
      }
    }

    // ── 5b) Pega lista de pares (banco_id, convenio_id) ja protegidos ──
    const { data: protegidosRaw } = await dbQuery('gov_banco_convenio', 'editado_manual=eq.true&select=banco_id,convenio_id');
    const protegidos = new Set((protegidosRaw||[]).map(r => `${r.banco_id}-${r.convenio_id}`));

    // ── 6) INSERT banco_convenio em batches de 50 (PULA pares protegidos) ──
    const todasRels = [];
    for (const c of seed.convenios || []) {
      const cid = convIdBySlug.get(c.slug);
      if (!cid) continue;
      for (const b of c.bancos || []) {
        const bid = bancoIdBySlug.get(b.slug);
        if (!bid) continue;
        // PROTEGE: se par ja existe e foi editado manualmente, pula
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
        });
      }
    }
    const BATCH = 50;
    for (let i = 0; i < todasRels.length; i += BATCH) {
      const batch = todasRels.slice(i, i + BATCH);
      const url = `${SUPABASE_URL()}/rest/v1/gov_banco_convenio`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY(),
          'Authorization': `Bearer ${SUPABASE_KEY()}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(batch)
      });
      if (!resp.ok) {
        const t = await resp.text();
        return jsonError(`Erro insert banco_convenio batch ${i}: ${t.substring(0,300)}`, 500, req);
      }
      stats.banco_convenio += batch.length;
    }

    return jsonResp({
      ok: true,
      stats,
      duracao_ms: Date.now() - t0,
      seed_meta: seed.meta,
    }, 200, req);
  } catch (e) {
    return jsonError(`Falha no reseed: ${e.message}`, 500, req);
  }
}
