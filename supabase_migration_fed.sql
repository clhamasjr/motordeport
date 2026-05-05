-- ════════════════════════════════════════════════════════════════
-- Migration: Modulo FEDERAIS (Convenios + Bancos + Holerite Analise)
-- Projeto: FlowForce
-- Data: 2026-05-05
--
-- Espelha 100% os modulos gov_* e pref_* mas com prefixo fed_ e
-- adiciona campos `categoria` (civil|militar) e `orgao`.
--
-- Convenios federais:
--   CIVIS:    SIAPE (4 sub-convenios: Novo/Refin, Port, Cartao, CB), SERPRO
--   MILITAR:  Forcas Armadas, Aeronautica, Exercito, Marinha
--
-- Cria 4 tabelas:
--   fed_bancos              → cadastro modular de bancos FEDERAIS
--   fed_convenios           → 1 linha por convenio (SIAPE/SERPRO/EXERCITO/etc)
--   fed_banco_convenio      → relacao N:N com regras operacionais
--   fed_holerite_analises   → historico das analises de holerite/contracheque
-- ════════════════════════════════════════════════════════════════

-- ── 1) BANCOS FED (cadastro modular) ──────────────────────────
create table if not exists fed_bancos (
  id          bigserial primary key,
  slug        text unique not null,
  nome        text not null,
  ativo       boolean default true,
  observacoes text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists idx_fed_bancos_slug on fed_bancos(slug);
create index if not exists idx_fed_bancos_ativo on fed_bancos(ativo) where ativo = true;
comment on table fed_bancos is 'Cadastro modular de bancos que operam convenios FEDERAIS (SIAPE/SERPRO/militar). Separado de gov_bancos/pref_bancos por modularidade.';

-- ── 2) CONVENIOS (1 por convenio federal) ─────────────────────
create table if not exists fed_convenios (
  id            bigserial primary key,
  slug          text unique not null,
  nome          text not null,
  categoria     text,                     -- 'civil' | 'militar'
  orgao         text,                     -- ex: 'SIAPE', 'SERPRO', 'EXERCITO', 'MARINHA', 'AERONAUTICA'
  operacao_tipo text,                     -- 'completo' | 'novo_refin' | 'portabilidade' | 'cartao_consignado' | 'cartao_beneficio'
  sheet_origem  text,                     -- nome da aba da planilha origem (rastreabilidade)
  ativo         boolean default true,
  observacoes   text,
  atualizado_em date,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists idx_fed_convenios_slug on fed_convenios(slug);
create index if not exists idx_fed_convenios_categoria on fed_convenios(categoria);
create index if not exists idx_fed_convenios_orgao on fed_convenios(orgao);
create index if not exists idx_fed_convenios_ativo on fed_convenios(ativo) where ativo = true;
comment on table fed_convenios is 'Convenios federais (SIAPE civis, SERPRO, militares: Marinha/Exercito/Aeronautica). Importado da planilha "FEDERAIS RESUMO OPERACIONAL".';

-- ── 3) RELACAO BANCO x CONVENIO ───────────────────────────────
create table if not exists fed_banco_convenio (
  id            bigserial primary key,
  banco_id      bigint not null references fed_bancos(id) on delete cascade,
  convenio_id   bigint not null references fed_convenios(id) on delete cascade,

  -- ── Operacoes ──
  opera_novo    boolean default false,
  opera_refin   boolean default false,
  opera_port    boolean default false,
  opera_cartao  boolean default false,

  -- ── Regras canonicas (parsedas — usadas no cruzamento com holerite) ──
  suspenso          boolean default false,
  margem_utilizavel numeric(5,4),
  idade_min         smallint,
  idade_max         smallint,
  taxa_minima_port  numeric(6,4),
  data_corte        text,
  valor_minimo      text,
  qtd_contratos     text,

  -- ── Atributos completos ──
  atributos     jsonb default '{}'::jsonb,
  atributos_brutos jsonb default '[]'::jsonb,

  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),

  unique (banco_id, convenio_id)
);
create index if not exists idx_fed_bc_convenio on fed_banco_convenio(convenio_id);
create index if not exists idx_fed_bc_banco on fed_banco_convenio(banco_id);
create index if not exists idx_fed_bc_ativo on fed_banco_convenio(suspenso) where suspenso = false;
comment on table fed_banco_convenio is 'Regras operacionais de cada banco em cada convenio federal.';

-- ── 4) HISTORICO DE ANALISES DE HOLERITE/CONTRACHEQUE ─────────
create table if not exists fed_holerite_analises (
  id              uuid primary key default gen_random_uuid(),
  user_id         bigint references public.users(id) on delete set null,
  parceiro_nome   text,

  arquivo_nome    text,
  arquivo_tipo    text,
  arquivo_tamanho_bytes integer,

  dados_extraidos jsonb default '{}'::jsonb,

  convenio_sugerido_id bigint references fed_convenios(id),
  convenio_confianca   text,

  bancos_atendem  jsonb default '[]'::jsonb,
  bancos_nao_atendem jsonb default '[]'::jsonb,

  status          text default 'concluido',
  erro_mensagem   text,
  modelo_ia       text,
  duracao_ms      integer,

  created_at      timestamptz default now()
);
create index if not exists idx_fed_holerite_user on fed_holerite_analises(user_id);
create index if not exists idx_fed_holerite_created on fed_holerite_analises(created_at desc);
create index if not exists idx_fed_holerite_convenio on fed_holerite_analises(convenio_sugerido_id);
comment on table fed_holerite_analises is 'Historico das analises de contracheque de servidores federais civis e militares.';

-- ── Trigger updated_at ────────────────────────────────────────
create or replace function fed_touch_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_fed_bancos_touch on fed_bancos;
create trigger trg_fed_bancos_touch before update on fed_bancos
  for each row execute function fed_touch_updated_at();

drop trigger if exists trg_fed_convenios_touch on fed_convenios;
create trigger trg_fed_convenios_touch before update on fed_convenios
  for each row execute function fed_touch_updated_at();

drop trigger if exists trg_fed_banco_convenio_touch on fed_banco_convenio;
create trigger trg_fed_banco_convenio_touch before update on fed_banco_convenio
  for each row execute function fed_touch_updated_at();
