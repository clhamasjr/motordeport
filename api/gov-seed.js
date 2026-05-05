// ══════════════════════════════════════════════════════════════════
// api/gov-seed.js — Popula tabelas gov_* a partir de /gov_seed.json
//
// USO:
//   1) Apos atualizar a planilha de governos:
//      python scripts/gov/02_parse.py     (gera scripts/gov/convenios.json)
//      python scripts/gov/05_compact_seed.py  (gera public/gov_seed.json)
//      git push
//   2) Apos o deploy completar, dispare 1x:
//      curl -X POST https://flowforce.vercel.app/api/gov-seed \
//           -H "Content-Type: application/json" \
//           -H "x-internal-secret: <WEBHOOK_SECRET>" \
//           -d '{"action":"reseed"}'
//
// O endpoint:
//   - Le /gov_seed.json (publico no proprio dominio)
//   - UPSERT em gov_bancos por slug
//   - UPSERT em gov_convenios por slug
//   - DELETE + INSERT em gov_banco_convenio (relacao limpa toda vez)
//   - Retorna estatisticas
//
// Auth: x-internal-secret OU role admin/gestor.
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth, requireRole } from './_lib/auth.js';
import { dbInsert, dbDelete, dbQuery, dbUpsert } from './_lib/supabase.js';

const APP_URL = () => process.env.APP_URL || 'https://flowforce.vercel.app';
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
    const baseUrl = req.headers.get('origin') || (`https://${req.headers.get('host')}`) || APP_URL();
    const seedUrl = baseUrl.replace(/\/$/, '') + '/gov_seed.json';
    const r = await fetch(seedUrl);
    if (!r.ok) return jsonError(`Falha ao carregar ${seedUrl}: HTTP ${r.status}`, 500, req);
    const seed = await r.json();
    const stats = { bancos: 0, convenios: 0, banco_convenio: 0 };

    // ── 2) UPSERT bancos ──
    // dbUpsert atualiza ou insere. Faz em batch de 50 (PostgREST aceita).
    const bancosList = (seed.bancos_unicos || []).map(b => ({
      slug: b.slug, nome: b.nome
    }));
    if (bancosList.length) {
      // PostgREST upsert array
      const url = `${SUPABASE_URL()}/rest/v1/gov_bancos?on_conflict=slug`;
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

    // ── 3) UPSERT convenios ──
    const conveniosList = (seed.convenios || []).map(c => ({
      slug: c.slug, nome: c.nome, uf: c.uf, estado_nome: c.estado_nome,
      sheet_origem: c.sheet, atualizado_em: seed.meta?.gerado_em || null
    }));
    if (conveniosList.length) {
      const url = `${SUPABASE_URL()}/rest/v1/gov_convenios?on_conflict=slug`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY(),
          'Authorization': `Bearer ${SUPABASE_KEY()}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=representation'
        },
        body: JSON.stringify(conveniosList)
      });
      if (!resp.ok) {
        const t = await resp.text();
        return jsonError(`Erro upsert convenios: ${t.substring(0,300)}`, 500, req);
      }
      const arr = await resp.json();
      stats.convenios = Array.isArray(arr) ? arr.length : 0;
    }

    // ── 4) Mapeia slug -> id de bancos e convenios ──
    const { data: bancosDb } = await dbQuery('gov_bancos', 'select=id,slug&limit=1000');
    const { data: convDb } = await dbQuery('gov_convenios', 'select=id,slug&limit=1000');
    const bancoIdBySlug = new Map((bancosDb||[]).map(b => [b.slug, b.id]));
    const convIdBySlug = new Map((convDb||[]).map(c => [c.slug, c.id]));

    // ── 5) DELETE banco_convenio em massa ──
    {
      const url = `${SUPABASE_URL()}/rest/v1/gov_banco_convenio?id=gt.0`;
      const resp = await fetch(url, {
        method: 'DELETE',
        headers: { 'apikey': SUPABASE_KEY(), 'Authorization': `Bearer ${SUPABASE_KEY()}` }
      });
      if (!resp.ok) {
        const t = await resp.text();
        return jsonError(`Erro delete banco_convenio: ${t.substring(0,300)}`, 500, req);
      }
    }

    // ── 6) INSERT banco_convenio em batches de 50 ──
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
