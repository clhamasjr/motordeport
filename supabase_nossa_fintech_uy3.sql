-- ════════════════════════════════════════════════════════════════════
-- Cadastra "A NOSSA FINTECH (UY3)" no catalogo clt_bancos.
-- A Nossa Fintech tem 2 bancarizadoras: QITECH (slug nossa_fintech, ja
-- cadastrado) e UY3 (este). Cada uma vira 1 card na consulta CLT.
--
-- Em homolog a UY3 vem desabilitada (banking-institutions = ['QITECH']),
-- entao o card aparece como "em manutenção". Em producao (conta com UY3
-- habilitada) funciona normal.
--
-- Rodar no SQL editor do Supabase:
--   https://supabase.com/dashboard/project/rirsmtyuyqxsoxqbgtpu/sql
-- ════════════════════════════════════════════════════════════════════

INSERT INTO clt_bancos (slug, nome, api_status, ativo, observacoes, updated_at)
VALUES (
  'nossa_fintech_uy3',
  'A NOSSA FINTECH (UY3)',
  'com_api',
  true,
  'Spixii services — bancarizadora UY3. Mesmo fluxo do nossa_fintech (QITECH): check-auth → auto-autz (geolocation) → enrollment → get-margin. So funciona se UY3 estiver habilitada na conta (banking-institutions).',
  NOW()
)
ON CONFLICT (slug) DO UPDATE SET
  nome = EXCLUDED.nome,
  api_status = EXCLUDED.api_status,
  ativo = EXCLUDED.ativo,
  observacoes = EXCLUDED.observacoes,
  updated_at = EXCLUDED.updated_at;

SELECT slug, nome, ativo FROM clt_bancos WHERE slug LIKE 'nossa_fintech%';
