-- ════════════════════════════════════════════════════════════════════
-- Cadastra o banco Unno (Consignado CLT via QITech/ITAPEMA) no
-- catalogo clt_bancos. Aciona o processador processarUnno() em
-- api/clt-fila.js que faz "proposta-fantasma": cria DRAFT, le risk-
-- analysis, cancela. NAO contata cliente, NAO cria contrato firme.
--
-- Rodar uma vez no SQL editor do Supabase:
--   https://supabase.com/dashboard/project/rirsmtyuyqxsoxqbgtpu/sql
-- ════════════════════════════════════════════════════════════════════

INSERT INTO clt_bancos (slug, nome, api_status, ativo, observacoes, updated_at)
VALUES (
  'unno',
  'Unno (ITAPEMA/QITech)',
  'com_api',
  true,
  'Consulta de aprovação via proposta-fantasma (cria DRAFT + cancela). Login humano via env UNNO_USERNAME/UNNO_PASSWORD. Roadmap: pedir credenciais service com permissoes proposal.simulation-clt-* e migrar.',
  NOW()
)
ON CONFLICT (slug) DO UPDATE SET
  nome = EXCLUDED.nome,
  api_status = EXCLUDED.api_status,
  ativo = EXCLUDED.ativo,
  observacoes = EXCLUDED.observacoes,
  updated_at = EXCLUDED.updated_at;

-- Verifica que entrou
SELECT slug, nome, api_status, ativo FROM clt_bancos WHERE slug = 'unno';
