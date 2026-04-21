-- Migration: Códigos de partner por banco (genérico)
-- Roda no SQL Editor do Supabase

-- Limpa colunas antigas se foram criadas na primeira versão
ALTER TABLE users
  DROP COLUMN IF EXISTS facta_vendedor,
  DROP COLUMN IF EXISTS facta_codigo_master,
  DROP COLUMN IF EXISTS facta_gerente_comercial;

-- Coluna JSONB genérica: guarda o código do vendedor em cada banco
-- Exemplo: { "facta": "93596", "qitech": "xyz", "daycoval": "abc", "c6": "123" }
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS bank_codes JSONB DEFAULT '{}'::jsonb;

-- Index pra buscas futuras
CREATE INDEX IF NOT EXISTS idx_users_bank_codes ON users USING GIN (bank_codes);

COMMENT ON COLUMN users.bank_codes IS
  'Códigos de partner/vendedor em cada banco. Ex: {"facta":"93596","qitech":"xyz"}. Master/gerente vem de env vars.';
