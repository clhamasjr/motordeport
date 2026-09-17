// ══════════════════════════════════════════════════════════════════
// api/pref-seed.js — Popula tabelas pref_* a partir de /pref_seed.json
//
// USO:
//   1) Apos atualizar a planilha de prefeituras:
//      python scripts/pref/02_parse.py     (gera scripts/pref/convenios.json)
//      python scripts/pref/05_compact_seed.py  (gera pref_seed.json na raiz)
//      git push
//   2) Apos o deploy completar, dispare 1x:
//      curl -X POST https://motordeport.vercel.app/api/pref-seed \
//           -H "Content-Type: application/json" \
//           -H "x-internal-secret: <WEBHOOK_SECRET>" \
//           -d '{"action":"reseed"}'
//
// O endpoint:
//   - Le pref_seed.json do dominio da API (SEED_BASE_URL, default motordeport.vercel.app)
//   - UPSERT em pref_bancos por slug
//   - UPSERT em pref_convenios por slug
//   - DELETE + INSERT em pref_banco_convenio (relacao limpa toda vez)
//   - Retorna estatisticas
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

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);
  if (req.method !== 'POST') return jsonError('Method Not Allowed', 405, req);

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
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
    const seedUrl = SEED_BASE_URL() + '/pref_seed.json';
    // redirect manual: se o vercel.json voltar a redirecionar *_seed.json, falha aqui com
    // status claro em vez de seguir pro HTML do V2 e quebrar no JSON.parse.
    const r = await fetch(seedUrl, { redirect: 'manual' });
    if (!r.ok) return jsonError(`Falha ao carregar ${seedUrl}: HTTP ${r.status} (3xx = vercel.json esta redirecionando o seed)`, 500, req);
    let seed;
    try { seed = await r.json(); }
    catch (e) { return jsonError(`pref_seed.json invalido em ${seedUrl}: ${e.message}`, 500, req); }
    const stats = { bancos: 0, convenios: 0, banco_convenio: 0 };

    // ── 1) UPSERT bancos ──
    const bancosList = (seed.bancos_unicos || []).map(b => ({
      slug: b.slug, nome: b.nome
    }));
    if (bancosList.length) {
      const url = `${SUPABASE_URL()}/rest/v1/pref_bancos?on_conflict=slug`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY(),
          'Authorization': `Bearer ${SUPABASE_KEY()}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=representation'
        },
        body: JSON.stringify(bancosList)
      });
      if (!resp.ok) {
        const t = await resp.text();
        return jsonError(`Erro upsert bancos: ${t.substring(0,300)}`, 500, req);
      }
      const arr = await resp.json();
      stats.bancos = Array.isArray(arr) ? arr.length : 0;
    }

    // ── 2) UPSERT convenios (em batches porque sao 400+) ──
    const conveniosList = (seed.convenios || []).map(c => ({
      slug: c.slug,
      nome: c.nome,
      uf: c.uf,
      estado_nome: c.estado_nome,
      municipio: c.municipio || null,
      tipo: c.tipo || null,
      sheet_origem: c.sheet,
      atualizado_em: seed.meta?.gerado_em || null
    }));
    const CONV_BATCH = 100;
    for (let i = 0; i < conveniosList.length; i += CONV_BATCH) {
      const batch = conveniosList.slice(i, i + CONV_BATCH);
      const url = `${SUPABASE_URL()}/rest/v1/pref_convenios?on_conflict=slug`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY(),
          'Authorization': `Bearer ${SUPABASE_KEY()}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=representation'
        },
        body: JSON.stringify(batch)
      });
      if (!resp.ok) {
        const t = await resp.text();
        return jsonError(`Erro upsert convenios batch ${i}: ${t.substring(0,300)}`, 500, req);
      }
      const arr = await resp.json();
      stats.convenios += Array.isArray(arr) ? arr.length : 0;
    }

    // ── 3) Mapeia slug -> id ──
    const { data: bancosDb } = await dbQuery('pref_bancos', 'select=id,slug&limit=2000');
    const { data: convDb } = await dbQuery('pref_convenios', 'select=id,slug&limit=2000');
    const bancoIdBySlug = new Map((bancosDb||[]).map(b => [b.slug, b.id]));
    const convIdBySlug = new Map((convDb||[]).map(c => [c.slug, c.id]));

    // ── 4) DELETE banco_convenio em massa ──
    {
      const url = `${SUPABASE_URL()}/rest/v1/pref_banco_convenio?id=gt.0`;
      const resp = await fetch(url, {
        method: 'DELETE',
        headers: { 'apikey': SUPABASE_KEY(), 'Authorization': `Bearer ${SUPABASE_KEY()}` }
      });
      if (!resp.ok) {
        const t = await resp.text();
        return jsonError(`Erro delete banco_convenio: ${t.substring(0,300)}`, 500, req);
      }
    }

    // ── 5) INSERT banco_convenio em batches ──
    const todasRels = [];
    for (const c of seed.convenios || []) {
      const cid = convIdBySlug.get(c.slug);
      if (!cid) continue;
      for (const b of c.bancos || []) {
        const bid = bancoIdBySlug.get(b.slug);
        if (!bid) continue;
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
      const url = `${SUPABASE_URL()}/rest/v1/pref_banco_convenio`;
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
