-- ══════════════════════════════════════════════════════════════════
-- Migration: Pipeline de Oportunidades (reconsulta recorrente)
-- Rodar no Supabase SQL Editor do projeto do FlowForce.
--
-- 1) clt_margem_snapshot: último estado de margem por CPF×banco.
--    Permite detectar "cliente GANHOU margem" na reconsulta (badge NOVO).
-- 2) Colunas novas em clt_consultas_fila: flag de oportunidade nova +
--    status de trabalho do pipeline (trabalhado/descartado).
-- ══════════════════════════════════════════════════════════════════

create table if not exists clt_margem_snapshot (
  cpf            text not null,
  banco          text not null,
  margem         numeric default 0,
  disponivel     boolean default false,
  consultado_em  timestamptz default now(),
  primary key (cpf, banco)
);

alter table clt_consultas_fila add column if not exists novo_apto boolean default false;
alter table clt_consultas_fila add column if not exists novo_apto_em timestamptz;
alter table clt_consultas_fila add column if not exists novo_apto_bancos jsonb;
alter table clt_consultas_fila add column if not exists pipeline_status text;
alter table clt_consultas_fila add column if not exists trabalhado_por text;
alter table clt_consultas_fila add column if not exists trabalhado_em timestamptz;

create index if not exists idx_fila_novo_apto
  on clt_consultas_fila (novo_apto) where novo_apto = true;
