-- ════════════════════════════════════════════════════════════════
-- Migration: clt_conversas
-- Projeto: FlowForce → Agente Vendedor CLT (F3)
-- Data: 2026-04-24
-- Aplicar no Supabase rirsmtyuyqxsoxqbgtpu
-- ════════════════════════════════════════════════════════════════

-- Tabela principal: estado da conversa por telefone (B2C)
create table if not exists clt_conversas (
  id uuid primary key default gen_random_uuid(),
  telefone text not null unique,                    -- formato normalizado 5515999999999
  instance text,                                    -- instância Evolution que está atendendo
  nome text,                                        -- nome do cliente (coletado na conversa)
  cpf text,                                         -- 11 dígitos, sem formatação
  data_nascimento date,
  sexo text,                                        -- 'M' | 'F' | null
  email text,

  -- Fase da jornada
  etapa text not null default 'inicio',
  -- valores: inicio | coletando_cpf | aguardando_autorizacao_c6 |
  --          simulando | apresentando_ofertas | coletando_dados |
  --          proposta_criada | link_enviado | fechada_venda |
  --          fechada_sem_venda | pausada_humano

  -- Resultado das simulações (JSONB)
  ofertas jsonb default '[]'::jsonb,
  -- formato: [{banco, valor_liquido, parcelas, valor_parcela, taxa_mensal,
  --           id_simulacao, seguro, meta: {...}}, ...]

  banco_escolhido text,                             -- 'c6' | 'presencabank' | 'joinbank'
  id_simulacao_escolhida text,
  proposta_numero text,                             -- número retornado pelo banco após inclusão
  link_formalizacao text,

  -- Dados acumulados durante a conversa (JSONB livre pra flexibilidade)
  dados jsonb default '{}'::jsonb,
  -- ex: {endereco: {cep, rua, numero, bairro, cidade, uf},
  --      empregador: {cnpj, matricula, cargo, salario},
  --      dados_bancarios: {banco, agencia, conta, digito, tipo_conta},
  --      rg, nome_mae, ...}

  -- Flags operacionais
  ativo boolean default true,                       -- agente ainda deve responder?
  pausada_por_humano boolean default false,
  escalada_para_humano boolean default false,
  motivo_escalada text,

  -- Histórico de mensagens (últimas N, pra contexto do Claude)
  historico jsonb default '[]'::jsonb,
  -- formato: [{role: 'user'|'assistant', content: '...', ts: isoDate}]

  -- Metadados
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_message_at timestamptz default now(),

  -- Origem do lead (pra atribuição de ROI)
  origem text,                                      -- 'trafego_pago' | 'indicacao' | 'organico' | 'dispatch'
  utm_source text,
  utm_campaign text
);

-- Indexes pra consultas comuns
create index if not exists idx_clt_conversas_telefone on clt_conversas(telefone);
create index if not exists idx_clt_conversas_etapa on clt_conversas(etapa);
create index if not exists idx_clt_conversas_ativo on clt_conversas(ativo) where ativo = true;
create index if not exists idx_clt_conversas_last_msg on clt_conversas(last_message_at desc);
create index if not exists idx_clt_conversas_cpf on clt_conversas(cpf) where cpf is not null;

-- Trigger de updated_at
create or replace function clt_conversas_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_clt_conversas_touch on clt_conversas;
create trigger trg_clt_conversas_touch
  before update on clt_conversas
  for each row execute function clt_conversas_touch_updated_at();

-- Tabela auxiliar: log de eventos (debug + auditoria)
create table if not exists clt_conversas_eventos (
  id bigserial primary key,
  conversa_id uuid references clt_conversas(id) on delete cascade,
  telefone text not null,
  tipo text not null,
  -- valores: msg_recebida | msg_enviada | simulacao_rodada | oferta_apresentada |
  --          cpf_coletado | autorizacao_enviada | autorizacao_confirmada |
  --          proposta_incluida | link_gerado | pausada_humano | erro
  detalhes jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_clt_eventos_conversa on clt_conversas_eventos(conversa_id);
create index if not exists idx_clt_eventos_tipo on clt_conversas_eventos(tipo);
create index if not exists idx_clt_eventos_created on clt_conversas_eventos(created_at desc);

-- Comentários (documentação no Supabase)
comment on table clt_conversas is 'Estado persistente das conversas do Agente Vendedor CLT (F3). Uma linha por telefone do cliente.';
comment on column clt_conversas.etapa is 'Fase atual da jornada do cliente: inicio → aguardando_consentimento_lgpd → coletando_cpf → simulando → apresentando_ofertas → coletando_dados → proposta_criada → link_enviado → fechada_*';
comment on column clt_conversas.ofertas is 'Array JSONB com o resultado das simulações nos 3 bancos (C6, PresençaBank, JoinBank CLT), na ordem definida em clt_config.ordem_bancos.';
comment on column clt_conversas.historico is 'Histórico compacto de mensagens recentes (role + content + ts). Usado como contexto do Claude.';

-- ════════════════════════════════════════════════════════════════
-- clt_conversas: campos adicionais pra persona e LGPD
-- ════════════════════════════════════════════════════════════════
alter table clt_conversas
  add column if not exists nome_vendedor text,
  add column if not exists nome_parceiro text,
  add column if not exists disparado_por_user_id uuid,
  add column if not exists consentimento_lgpd boolean default false,
  add column if not exists consentimento_lgpd_at timestamptz,
  add column if not exists consentimento_lgpd_texto text;

-- ════════════════════════════════════════════════════════════════
-- users: campos de persona pra cada atendente
-- ════════════════════════════════════════════════════════════════
alter table users
  add column if not exists nome_vendedor text,
  add column if not exists nome_parceiro text;

comment on column users.nome_vendedor is 'Nome do vendedor que o agente assume ao atender. Ex: "João". Usado como "João da JVR".';
comment on column users.nome_parceiro is 'Nome da empresa/parceiro. Ex: "JVR Financeira". Usado como "João da JVR".';

-- ════════════════════════════════════════════════════════════════
-- clt_config: configurações globais do agente (singleton, id=1)
-- ════════════════════════════════════════════════════════════════
create table if not exists clt_config (
  id integer primary key check (id = 1),
  ordem_bancos text[] not null default array['c6','presencabank','joinbank']::text[],
  -- ordem em que o agente apresenta ofertas ao cliente. Dono edita no dia-a-dia.
  prompt_override text,
  -- se preenchido, substitui totalmente o SYSTEM_PROMPT default do agente. Usa com cuidado.
  modo_insistencia text default 'conciso' check (modo_insistencia in ('conciso','moderado','insistente')),
  -- tom do agente. Default: conciso, não pressiona.
  seguro_c6_default integer default 4 check (seguro_c6_default in (0,2,4,6,9)),
  -- qual plano de seguro do C6 o agente oferta primeiro. 0 = sem seguro.
  max_mensagens_sem_resposta integer default 3,
  -- se o cliente para de responder, quantas msgs de follow-up o agente envia antes de pausar
  horario_atendimento_inicio time default '08:00',
  horario_atendimento_fim time default '22:00',
  timezone text default 'America/Sao_Paulo',
  updated_at timestamptz default now(),
  updated_by text
);

insert into clt_config (id, ordem_bancos)
  values (1, array['c6','presencabank','joinbank']::text[])
  on conflict (id) do nothing;

comment on table clt_config is 'Configuração global do Agente Vendedor CLT (linha única id=1). Dono edita no dashboard.';
comment on column clt_config.ordem_bancos is 'Array com ordem de prioridade de apresentação das ofertas. Ex: [c6, presencabank, joinbank].';
