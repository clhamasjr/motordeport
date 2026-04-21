-- Migration: Adiciona campos de atribuicao FACTA por usuario
-- Roda no SQL Editor do Supabase

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS facta_vendedor TEXT,
  ADD COLUMN IF NOT EXISTS facta_codigo_master TEXT,
  ADD COLUMN IF NOT EXISTS facta_gerente_comercial TEXT;

-- Indexar facta_vendedor pra facilitar queries
CREATE INDEX IF NOT EXISTS idx_users_facta_vendedor ON users(facta_vendedor) WHERE facta_vendedor IS NOT NULL;

COMMENT ON COLUMN users.facta_vendedor IS 'Codigo de vendedor na FACTA (usado na etapa1 pra atribuir a proposta)';
COMMENT ON COLUMN users.facta_codigo_master IS 'Codigo master FACTA (opcional)';
COMMENT ON COLUMN users.facta_gerente_comercial IS 'Codigo gerente comercial FACTA (opcional)';
