-- ════════════════════════════════════════════════════════════════════
-- Cadastra "A NOSSA FINTECH" no catalogo clt_bancos.
-- Aciona o processador processarNossaFintech() em api/clt-fila.js
-- que chama api/nossa-fintech.js (Spixii services, provedor QITECH).
--
-- Fluxo: check-authorization → request-authorization (SMS auto) → cliente
-- autoriza → check-employee-enrollment → get-margin → resultado no card.
--
-- Rodar no SQL editor do Supabase:
--   https://supabase.com/dashboard/project/rirsmtyuyqxsoxqbgtpu/sql
-- ════════════════════════════════════════════════════════════════════

INSERT INTO clt_bancos (slug, nome, api_status, ativo, observacoes, updated_at)
VALUES (
  'nossa_fintech',
  'A NOSSA FINTECH',
  'com_api',
  true,
  'Spixii services — provedor QITECH. Fluxo Mercantil-like: dispara SMS pro cliente autorizar consulta DataPrev. Endpoints: /clt-loan/v1/check-authorization, request-authorization, check-employee-enrollment, get-margin. Env vars: NOSSA_FINTECH_CPF, NOSSA_FINTECH_PROMOT_ID, NOSSA_FINTECH_PASSWORD.',
  NOW()
)
ON CONFLICT (slug) DO UPDATE SET
  nome = EXCLUDED.nome,
  api_status = EXCLUDED.api_status,
  ativo = EXCLUDED.ativo,
  observacoes = EXCLUDED.observacoes,
  updated_at = EXCLUDED.updated_at;

SELECT slug, nome, api_status, ativo FROM clt_bancos WHERE slug = 'nossa_fintech';
