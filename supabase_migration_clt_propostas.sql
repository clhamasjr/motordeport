-- ════════════════════════════════════════════════════════════════
-- Migration: clt_propostas (esteira unificada CLT - 4 bancos)
-- Aplicar no Supabase do FlowForce
-- ════════════════════════════════════════════════════════════════

-- Tabela ÚNICA pra propostas de qualquer banco CLT.
-- Discriminada pelo campo `banco`. Permite ver toda a esteira num só lugar.
create table if not exists clt_propostas (
  id uuid primary key default gen_random_uuid(),

  -- Banco e identificadores externos
  banco text not null check (banco in ('c6','presencabank','joinbank','v8')),
  proposta_id_externo text,                 -- ID da proposta/operação no banco
  externo_simulation_id text,               -- ID da simulação que originou
  externo_consult_id text,                  -- (V8) consult_id do termo

  -- Cliente
  cpf text not null,
  nome text,
  telefone text,
  email text,
  data_nascimento date,
  nome_mae text,

  -- Empregador
  empregador_cnpj text,
  empregador_nome text,
  matricula text,
  renda numeric(12,2),

  -- Valores da proposta
  valor_solicitado numeric(12,2),
  valor_liquido numeric(12,2),               -- o que cliente recebe na conta
  valor_parcela numeric(12,2),
  qtd_parcelas integer,
  taxa_mensal numeric(8,4),
  cet_mensal numeric(8,4),
  margem_v8 text,                            -- snapshot da margem V8 retornada
  iof numeric(12,2),

  -- Status e formalização
  status_externo text,                       -- status reportado pelo banco
  -- valores variam por banco. V8: formalization, analysis, processing, paid, canceled, etc.
  -- C6: situacao do loan_track. PB: status da operação. JB: status do loan.
  status_interno text default 'criada' check (status_interno in (
    'criada',           -- proposta criada, aguardando ação
    'aguardando_assinatura', -- link enviado, esperando cliente assinar
    'em_analise',       -- assinada, banco analisando
    'aprovada',         -- banco aprovou
    'paga',             -- crédito caiu na conta
    'pendente',         -- precisa resolver pendência
    'rejeitada',        -- banco recusou
    'cancelada'         -- cancelada manualmente ou pelo banco
  )),
  link_formalizacao text,
  contract_number text,                      -- número do contrato (V8 retorna no list)

  -- Histórico de webhooks/callbacks
  webhook_ultimo jsonb,                      -- payload do último webhook recebido
  history jsonb default '[]'::jsonb,         -- array com mudanças de status

  -- Atribuição
  criada_por_user_id integer,                -- user que criou (FK lógico em users)
  conversa_id uuid,                          -- FK lógico em clt_conversas (se veio do agente)
  origem text,                               -- 'consulta_unitaria' | 'higienizacao_lote' | 'agente_whatsapp' | 'manual'
  vendedor_nome text,
  parceiro_nome text,

  -- Timestamps
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  paid_at timestamptz,
  canceled_at timestamptz
);

-- Indexes
create index if not exists idx_clt_propostas_banco on clt_propostas(banco);
create index if not exists idx_clt_propostas_cpf on clt_propostas(cpf);
create index if not exists idx_clt_propostas_status_int on clt_propostas(status_interno);
create index if not exists idx_clt_propostas_status_ext on clt_propostas(status_externo);
create index if not exists idx_clt_propostas_created on clt_propostas(created_at desc);
create index if not exists idx_clt_propostas_user on clt_propostas(criada_por_user_id);
create index if not exists idx_clt_propostas_externo on clt_propostas(banco, proposta_id_externo);

-- Trigger updated_at
create or replace function clt_propostas_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_clt_propostas_touch on clt_propostas;
create trigger trg_clt_propostas_touch
  before update on clt_propostas
  for each row execute function clt_propostas_touch_updated_at();

-- Trigger histórico (registra cada mudança de status)
create or replace function clt_propostas_track_status()
returns trigger as $$
begin
  if (old.status_externo is distinct from new.status_externo)
     or (old.status_interno is distinct from new.status_interno) then
    new.history = coalesce(old.history, '[]'::jsonb) || jsonb_build_object(
      'ts', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'from_externo', old.status_externo,
      'to_externo', new.status_externo,
      'from_interno', old.status_interno,
      'to_interno', new.status_interno
    );
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_clt_propostas_status on clt_propostas;
create trigger trg_clt_propostas_status
  before update on clt_propostas
  for each row execute function clt_propostas_track_status();

-- Comentários
comment on table clt_propostas is 'Esteira unificada de propostas CLT (4 bancos: C6/PresencaBank/JoinBank/V8). Cada linha = 1 proposta criada em algum banco.';
comment on column clt_propostas.banco is 'Banco: c6, presencabank, joinbank, v8';
comment on column clt_propostas.proposta_id_externo is 'ID da proposta/operação no sistema do banco (V8: operationId, C6: proposalNumber, etc)';
comment on column clt_propostas.status_interno is 'Status normalizado interno (criada -> aguardando_assinatura -> em_analise -> aprovada -> paga | rejeitada | cancelada)';
comment on column clt_propostas.status_externo is 'Status original retornado pelo banco (varia por integração)';
comment on column clt_propostas.history is 'Histórico de mudanças de status (preenchido por trigger)';

-- View consolidada: resumo da esteira pra dashboard
create or replace view clt_esteira_resumo as
select
  banco,
  status_interno,
  count(*) as total,
  sum(valor_liquido) as soma_valor_liquido,
  avg(valor_liquido) as media_valor_liquido,
  max(created_at) as mais_recente
from clt_propostas
group by banco, status_interno
order by banco, status_interno;

comment on view clt_esteira_resumo is 'Visão agregada da esteira CLT por banco e status';
