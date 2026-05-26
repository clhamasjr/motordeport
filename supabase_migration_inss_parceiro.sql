-- ══════════════════════════════════════════════════════════════════
-- Migration: INSS Parceiro WhatsApp Bot
-- Adiciona phone_whatsapp em users para identificar parceiros pelo
-- número de WhatsApp na consulta INSS via bot.
--
-- Como aplicar:
-- 1. Acesse https://supabase.com/dashboard/project/rirsmtyuyqxsoxqbgtpu/sql
-- 2. Cole este SQL e clique em RUN
-- ══════════════════════════════════════════════════════════════════

-- 1. Adiciona coluna phone_whatsapp na tabela users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_whatsapp TEXT;

-- 2. Índice para busca rápida por telefone (a query do bot usa esse campo)
CREATE INDEX IF NOT EXISTS idx_users_phone_whatsapp
  ON users (phone_whatsapp)
  WHERE phone_whatsapp IS NOT NULL;

-- 3. Verificação (deve retornar a coluna nova)
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'users'
   AND column_name = 'phone_whatsapp';

-- ══════════════════════════════════════════════════════════════════
-- COMO CADASTRAR O TELEFONE DE UM PARCEIRO (depois de rodar a migration)
-- ══════════════════════════════════════════════════════════════════
-- Formato: somente dígitos, com DDD, SEM o +55.
-- Exemplos:
--   São Paulo (15): 15999990001
--   Outros: 11999990001
--
-- Exemplo prático:
-- UPDATE users
--    SET phone_whatsapp = '15999990001'
--  WHERE username = 'parceiro@email.com.br';
--
-- Verificar parceiros cadastrados com WhatsApp:
-- SELECT name, username, phone_whatsapp
--   FROM users
--  WHERE phone_whatsapp IS NOT NULL
--  ORDER BY name;
