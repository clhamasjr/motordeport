-- ════════════════════════════════════════════════════════════════════
-- Tira o MERCANTIL de produção no motor de consulta CLT.
-- Marca ativo=false no catalogo clt_bancos → processarMercantil()
-- detecta via _bancoEmManutencao() e PULA (nao consulta, nao gasta).
--
-- O frontend V2 ja removeu o Mercantil dos cards visiveis (BANCOS_VISIVEIS).
-- Este SQL completa: faz o backend tambem parar de disparar.
--
-- Rodar no SQL editor do Supabase:
--   https://supabase.com/dashboard/project/rirsmtyuyqxsoxqbgtpu/sql
-- ════════════════════════════════════════════════════════════════════

UPDATE clt_bancos
SET ativo = false,
    observacoes = '🔧 Fora de produção (jun/2026) — desativado a pedido.',
    updated_at = NOW()
WHERE slug = 'mercantil';

SELECT slug, nome, ativo FROM clt_bancos WHERE slug = 'mercantil';
