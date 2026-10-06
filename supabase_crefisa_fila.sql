-- ══════════════════════════════════════════════════════════════════
-- Fila (buffer) de digitação Crefisa Baixa Renda — multi-vendedor
--
-- A Crefisa aceita UM login por vez: existe uma única sessão compartilhada
-- (alimentada pelo robô). Consulta/simulação podem rodar em paralelo nessa
-- sessão, mas DIGITAÇÃO não pode colidir — por isso vai pra esta fila e um
-- worker processa UMA DE CADA VEZ.
--
-- Cada vendedor enfileira a própria proposta e acompanha o status.
-- ══════════════════════════════════════════════════════════════════

create table if not exists crefisa_fila (
  id              uuid primary key default gen_random_uuid(),
  cpf             text not null,
  nome_cliente    text,
  telefone        text,

  -- NA_FILA → PROCESSANDO → DIGITADA | ERRO | CANCELADA
  status          text not null default 'NA_FILA',
  mensagem        text,

  -- quem pediu — define a visibilidade:
  --   operador (vendedor) vê só user_id = ele
  --   gestor vê tudo da loja dele (parceiro_id)
  --   admin vê tudo
  user_id         int,
  vendedor_nome   text,
  parceiro_id     int,          -- a "loja" (users.parceiro_id)

  -- proposta completa pronta pra digitar (mesmo shape da action `digitar`)
  payload         jsonb not null,
  -- retorno da Crefisa
  resultado       jsonb,
  guid            text,

  tentativas      int default 0,
  prioridade      int default 0,       -- maior = passa na frente
  erro_ultimo     text,

  criado_em       timestamptz default now(),
  atualizado_em   timestamptz default now(),
  iniciado_em     timestamptz,
  processado_em   timestamptz
);

create index if not exists crefisa_fila_status_idx   on crefisa_fila (status, prioridade desc, criado_em);
create index if not exists crefisa_fila_user_idx     on crefisa_fila (user_id, criado_em desc);
create index if not exists crefisa_fila_loja_idx     on crefisa_fila (parceiro_id, criado_em desc);
create index if not exists crefisa_fila_cpf_idx      on crefisa_fila (cpf);

alter table crefisa_fila enable row level security;

comment on table crefisa_fila is
  'Buffer serial de digitação Crefisa Baixa Renda. Vários vendedores enfileiram; o worker processa uma de cada vez na sessão única do portal.';

-- ══════════════════════════════════════════════════════════════════
-- Trava de concorrência — garante UMA operação por vez na sessão única
-- ══════════════════════════════════════════════════════════════════
create table if not exists crefisa_lock (
  id          int primary key default 1,
  dono        text,          -- quem segura (ex: 'worker', 'digitacao:<uuid>')
  expira_em   timestamptz,   -- auto-libera se o processo morrer
  atualizado_em timestamptz default now(),
  constraint crefisa_lock_singleton check (id = 1)
);

insert into crefisa_lock (id, dono, expira_em)
values (1, null, null)
on conflict (id) do nothing;

alter table crefisa_lock enable row level security;

comment on table crefisa_lock is
  'Trava da sessão Crefisa: impede duas digitações simultâneas. expira_em auto-libera se o worker cair no meio.';

-- 06/10/2026: visibilidade por loja
alter table crefisa_fila add column if not exists parceiro_id int;
