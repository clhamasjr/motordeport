-- ══════════════════════════════════════════════════════════════════
-- Follow-up da Esteira de Análise — Crefisa Baixa Renda
--
-- Depois que a proposta é digitada (crefisa_fila.status = DIGITADA, com guid),
-- ela entra na esteira da Crefisa e muda de situação até pagar ou cair.
-- O motor confere periodicamente, detecta mudança de situação, registra o
-- histórico e avisa quem precisa agir (vendedor na pendência dele, gestor/
-- admin quando trava).
--
-- Duas peças:
--   crefisa_fila (+colunas)      → situação atual de cada proposta na esteira
--   crefisa_esteira_evento       → histórico de transições (e dedupe de aviso)
-- ══════════════════════════════════════════════════════════════════

-- Situação atual da proposta na esteira, guardada junto do item da fila
alter table crefisa_fila add column if not exists esteira_situacao      text;
alter table crefisa_fila add column if not exists esteira_situacao_em    timestamptz;
alter table crefisa_fila add column if not exists esteira_pendencia      text;   -- motivo, quando pendente
alter table crefisa_fila add column if not exists esteira_contrato       text;   -- nº do contrato na Crefisa
alter table crefisa_fila add column if not exists esteira_finalizada     boolean default false; -- paga ou cancelada = para de conferir
alter table crefisa_fila add column if not exists esteira_conferida_em   timestamptz;

create index if not exists crefisa_fila_esteira_idx
  on crefisa_fila (esteira_finalizada, esteira_conferida_em)
  where status = 'DIGITADA';

-- Histórico de transições na esteira (uma linha por mudança de situação)
create table if not exists crefisa_esteira_evento (
  id              uuid primary key default gen_random_uuid(),
  fila_id         uuid references crefisa_fila(id),
  cpf             text,
  contrato        text,
  situacao_de     text,
  situacao_para   text,
  pendencia       text,
  -- a quem o aviso foi (ou seria) mandado — evita reenviar o mesmo
  avisou_vendedor boolean default false,
  avisou_gestor   boolean default false,
  criado_em       timestamptz default now()
);

create index if not exists crefisa_esteira_evento_fila_idx on crefisa_esteira_evento (fila_id, criado_em desc);

alter table crefisa_esteira_evento enable row level security;

comment on table crefisa_esteira_evento is
  'Histórico de mudanças de situação na Esteira de Análise da Crefisa (Baixa Renda). Base do follow-up: cada transição gera um evento e, quando relevante, um aviso no WhatsApp.';
