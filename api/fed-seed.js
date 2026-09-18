// ══════════════════════════════════════════════════════════════════
// api/fed-seed.js — Popula tabelas fed_* a partir de /fed_seed.json
//
// USO:
//   1) Apos atualizar a planilha de federais:
//      python scripts/fed/02_parse.py     (gera scripts/fed/convenios.json)
//      python scripts/fed/05_compact_seed.py  (gera fed_seed.json na raiz)
//      git push
//   2) Apos o deploy completar, dispare 1x (secret interno OU sessao admin/gestor):
//      curl -X POST https://motordeport.vercel.app/api/fed-seed \
//           -H "Content-Type: application/json" \
//           -H "x-internal-secret: <WEBHOOK_SECRET>" \
//           -d '{"action":"reseed"}'
//      Ou, logado como admin no V2 (flowforce.tec.br), no console do navegador:
//      fetch('/api/fed-seed',{method:'POST',headers:{'Content-Type':'application/json',
//        Authorization:'Bearer '+localStorage.ff_token},body:'{"action":"reseed"}'}).then(r=>r.json()).then(console.log)
//
// O endpoint:
//   - Le fed_seed.json do dominio da API (SEED_BASE_URL, default motordeport.vercel.app).
//     NAO usa origin/host da request: desde a desativacao do V1 (vercel.json
//     redireciona tudo exceto /api/ pra flowforce.tec.br, que roda na VPS e nao
//     tem o arquivo) a chamada chega via rewrite do V2 e esses headers apontam
//     pro lugar errado. O vercel.json libera *_seed.json do redirect.
//   - UPSERT em fed_bancos por slug
//   - UPSERT em fed_convenios por slug
//   - DELETE + INSERT em fed_banco_convenio (relacao limpa toda vez)
//   - Retorna estatisticas
// ══════════════════════════════════════════════════════════════════

// ── Acoes ─────────────────────────────────────────────────────────
//   {"action":"diagnostico"}  → compara o banco com o seed e lista bancos/convenios
//                               FORA da planilha (o que a exclusao apagaria). Nao altera nada.
//   {"action":"reseed"}       → UPSERT bancos/convenios + DELETE/INSERT das relacoes (planilha manda).
//   {"action":"reseed","excluir_fora_da_planilha":true}
//                             → idem e, no fim, EXCLUI bancos e convenios que nao estao no seed
//                               (decisao do dono 17/09/2026: a planilha de setembro e a lista completa).
//                               Convenios excluidos levam as relacoes em cascata; analises de holerite
//                               que apontavam pra eles ficam sem convenio sugerido (FK sem cascade).
//                               Trava: se o seed vier com <5 bancos ou 0 convenios, a exclusao e PULADA.
// Mesmo nome de opcao do api/gov-seed.js pra manter os runbooks iguais.
export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth, requireRole } from './_lib/auth.js';
import { dbQuery } from './_lib/supabase.js';

// Base onde fed_seed.json e servido como estatico (ver comentario no topo).
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

  if (body.action === 'diagnostico') {
    try { return await diagnostico(req); }
    catch (e) { return jsonError(`Falha no diagnostico: ${e.message}`, 500, req); }
  }
  if (body.action !== 'reseed') {
    return jsonError("action invalida. Use 'reseed' (opcional: excluir_fora_da_planilha: true) ou 'diagnostico'.", 400, req);
  }
  const excluirFora = body.excluir_fora_da_planilha === true;

  const t0 = Date.now();
  try {
    const seed = await carregarSeed();
    const stats = { bancos: 0, convenios: 0, banco_convenio: 0,
                    excluir_fora_da_planilha: excluirFora, bancos_excluidos: 0, convenios_excluidos: 0, analises_desvinculadas: 0 };

    // ── 1) UPSERT bancos ──
    const bancosList = (seed.bancos_unicos || []).map(b => ({
      slug: b.slug, nome: b.nome
    }));
    if (bancosList.length) {
      const url = `${SUPABASE_URL()}/rest/v1/fed_bancos?on_conflict=slug`;
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

    // ── 2) UPSERT convenios (sao poucos — ~8) ──
    const conveniosList = (seed.convenios || []).map(c => ({
      slug: c.slug,
      nome: c.nome,
      categoria: c.categoria || null,
      orgao: c.orgao || null,
      operacao_tipo: c.operacao_tipo || null,
      sheet_origem: c.sheet,
      atualizado_em: seed.meta?.gerado_em || null
    }));
    if (conveniosList.length) {
      const url = `${SUPABASE_URL()}/rest/v1/fed_convenios?on_conflict=slug`;
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

    // ── 3) Mapeia slug -> id ──
    const { data: bancosDb } = await dbQuery('fed_bancos', 'select=id,slug&limit=2000');
    const { data: convDb } = await dbQuery('fed_convenios', 'select=id,slug&limit=2000');
    const bancoIdBySlug = new Map((bancosDb||[]).map(b => [b.slug, b.id]));
    const convIdBySlug = new Map((convDb||[]).map(c => [c.slug, c.id]));

    // ── 4) DELETE banco_convenio em massa ──
    {
      const url = `${SUPABASE_URL()}/rest/v1/fed_banco_convenio?id=gt.0`;
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
      const url = `${SUPABASE_URL()}/rest/v1/fed_banco_convenio`;
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

    // ── 6) (opcional) EXCLUI o que nao esta na planilha ──
    if (excluirFora) await excluirForaDaPlanilha(seed, stats);

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

// ══════════════════════════════════════════════════════════════════
// Helpers — seed, diagnostico e exclusao do que esta fora da planilha
// ══════════════════════════════════════════════════════════════════
const SB_HEADERS = (extra = {}) => ({
  'apikey': SUPABASE_KEY(),
  'Authorization': `Bearer ${SUPABASE_KEY()}`,
  'Content-Type': 'application/json',
  ...extra,
});

// Le fed_seed.json do dominio da API. redirect manual: se o vercel.json voltar a
// redirecionar *_seed.json, falha com status claro em vez de engolir o HTML do V2.
async function carregarSeed() {
  const seedUrl = SEED_BASE_URL() + '/fed_seed.json';
  const r = await fetch(seedUrl, { redirect: 'manual' });
  if (!r.ok) throw new Error(`Falha ao carregar ${seedUrl}: HTTP ${r.status} (3xx = vercel.json esta redirecionando o seed)`);
  try { return await r.json(); }
  catch (e) { throw new Error(`fed_seed.json invalido em ${seedUrl}: ${e.message}`); }
}

// Compara o banco com o seed. Retorna o que existe no Supabase mas NAO esta na planilha.
async function calcularForaDaPlanilha(seed) {
  const seedBancos = new Set((seed.bancos_unicos || []).map(b => b.slug));
  const seedConv = new Set((seed.convenios || []).map(c => c.slug));
  const { data: bancosDb, error: e1 } = await dbQuery('fed_bancos', 'select=id,slug,nome&limit=2000');
  if (e1) throw new Error(`Falha ao ler fed_bancos: ${e1}`);
  const { data: convDb, error: e2 } = await dbQuery('fed_convenios', 'select=id,slug,nome&limit=2000');
  if (e2) throw new Error(`Falha ao ler fed_convenios: ${e2}`);
  return {
    bancos: (bancosDb || []).filter(b => !seedBancos.has(b.slug)),
    convenios: (convDb || []).filter(c => !seedConv.has(c.slug)),
    // trava: seed vazio/quebrado nunca pode apagar o catalogo inteiro
    seguro: seedBancos.size >= 5 && seedConv.size >= 1,
    totais_db: { bancos: (bancosDb || []).length, convenios: (convDb || []).length },
    totais_seed: { bancos: seedBancos.size, convenios: seedConv.size },
  };
}

async function diagnostico(req) {
  const seed = await carregarSeed();
  const fora = await calcularForaDaPlanilha(seed);
  return jsonResp({
    ok: true,
    seed_meta: seed.meta,
    totais_db: fora.totais_db,
    totais_seed: fora.totais_seed,
    fora_da_planilha: { bancos: fora.bancos, convenios: fora.convenios },
    exclusao_permitida: fora.seguro,
    como_excluir: 'POST {"action":"reseed","excluir_fora_da_planilha":true}',
  }, 200, req);
}

// Exclui bancos e convenios que nao estao no seed. Roda DEPOIS das relacoes serem
// recriadas (assim o que esta fora da planilha ja nao tem relacao nenhuma).
async function excluirForaDaPlanilha(seed, stats) {
  const fora = await calcularForaDaPlanilha(seed);
  stats.fora_da_planilha_bancos = fora.bancos.map(b => b.slug);
  stats.fora_da_planilha_convenios = fora.convenios.map(c => c.slug);
  if (!fora.seguro) {
    stats.exclusao = `PULADA: seed com ${fora.totais_seed.bancos} bancos / ${fora.totais_seed.convenios} convenios (trava de seguranca)`;
    return;
  }
  const H = SB_HEADERS({ 'Prefer': 'return=representation' });
  const lerQtd = async (resp, oque) => {
    if (!resp.ok) throw new Error(`Erro ao ${oque}: ${(await resp.text()).substring(0, 300)}`);
    const arr = await resp.json();
    return Array.isArray(arr) ? arr.length : 0;
  };
  if (fora.convenios.length) {
    const ids = fora.convenios.map(c => c.id).join(',');
    // 1) solta as analises de holerite que apontavam pra esses convenios (FK sem cascade)
    stats.analises_desvinculadas = await lerQtd(await fetch(
      `${SUPABASE_URL()}/rest/v1/fed_holerite_analises?convenio_sugerido_id=in.(${ids})`,
      { method: 'PATCH', headers: H, body: JSON.stringify({ convenio_sugerido_id: null }) }), 'desvincular analises');
    // 2) exclui os convenios (relacoes somem em cascata)
    stats.convenios_excluidos = await lerQtd(await fetch(
      `${SUPABASE_URL()}/rest/v1/fed_convenios?id=in.(${ids})`, { method: 'DELETE', headers: H }), 'excluir convenios');
  }
  if (fora.bancos.length) {
    const ids = fora.bancos.map(b => b.id).join(',');
    stats.bancos_excluidos = await lerQtd(await fetch(
      `${SUPABASE_URL()}/rest/v1/fed_bancos?id=in.(${ids})`, { method: 'DELETE', headers: H }), 'excluir bancos');
  }
  stats.exclusao = 'OK';
}
