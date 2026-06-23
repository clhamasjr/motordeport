-- ════════════════════════════════════════════════════════════════════
-- Cadastra "FACTA (Crédito do Trabalhador)" no catalogo clt_bancos.
-- Aciona processarFacta() em api/clt-fila.js → api/facta.js
-- action cltConsultarAprovacao. Roda via facta-proxy (IP fixo).
--
-- Fluxo: gera-token → autoriza-consulta (margem) → solicita-autorizacao
-- (SMS/WhatsApp, vale 30 dias) quando precisa autorizacao do cliente.
--
-- Rodar no SQL editor do Supabase:
--   https://supabase.com/dashboard/project/rirsmtyuyqxsoxqbgtpu/sql
-- ════════════════════════════════════════════════════════════════════

INSERT INTO clt_bancos (slug, nome, api_status, ativo, observacoes, updated_at)
VALUES (
  'facta_clt',
  'FACTA (Crédito do Trabalhador)',
  'com_api',
  true,
  'FACTA Financeira - Credito do Trabalhador (tipo operacao 13 NOVO DIGITAL, averbador 10010). Consulta via /consignado-trabalhador/autoriza-consulta. Autorizacao por SMS/WhatsApp (solicita-autorizacao-consulta), vale 30 dias. EXIGE facta-proxy (IP fixo) no ar. Env: FACTA_AUTH, FACTA_PROXY_URL, FACTA_PROXY_SECRET, CF_ACCESS_*.',
  NOW()
)
ON CONFLICT (slug) DO UPDATE SET
  nome = EXCLUDED.nome,
  api_status = EXCLUDED.api_status,
  ativo = EXCLUDED.ativo,
  observacoes = EXCLUDED.observacoes,
  updated_at = EXCLUDED.updated_at;

SELECT slug, nome, ativo FROM clt_bancos WHERE slug = 'facta_clt';
