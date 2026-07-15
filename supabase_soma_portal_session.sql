-- ══════════════════════════════════════════════════════════════════
-- Migration: sessão do portal SOMA (robô de auto-aceite)
-- Rodar no Supabase SQL Editor do projeto do FlowForce.
--
-- Guarda a sessão logada do operador (1 linha, id=1) usada pra confirmar
-- o aceite via API (Bearer + token + refresh-token). Bootstrapada 1x via
-- action setPortalSession; renovada sozinha a cada resposta da SOMA.
-- ══════════════════════════════════════════════════════════════════

create table if not exists soma_portal_session (
  id            int primary key default 1,
  bearer        text,
  token         text,
  refresh_token text,
  atualizado_em timestamptz default now(),
  constraint soma_portal_session_singleton check (id = 1)
);
