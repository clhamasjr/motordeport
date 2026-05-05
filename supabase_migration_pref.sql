-- ════════════════════════════════════════════════════════════════
-- Migration: Modulo PREFEITURAS (Convenios + Bancos + Holerite Analise)
-- Projeto: FlowForce
-- Data: 2026-05-05
--
-- Espelha 100% o modulo gov_* mas com prefixo pref_ e adiciona campo
-- `municipio` (planilha PREFEITURAS tem ~600 abas, 1 por municipio/instituto/CB).
--
-- Cria 4 tabelas:
--   pref_bancos              → cadastro modular de bancos PREF (separado de gov/INSS/CLT)
--   pref_convenios           → 1 linha por aba da planilha (municipio/instituto)
--   pref_banco_convenio      → relacao N:N com regras operacionais por banco x convenio
--   pref_holerite_analises   → historico das analises de holerite feitas pelos parceiros
-- ════════════════════════════════════════════════════════════════

-- ── 1) BANCOS PREF (cadastro modular) ──────────────────────────
create table if not exists pref_bancos (
  id          bigserial primary key,
  slug        text unique not null,
  nome        text not null,
  ativo       boolean default true,
  observacoes text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists idx_pref_bancos_slug on pref_bancos(slug);
create index if not exists idx_pref_bancos_ativo on pref_bancos(ativo) where ativo = true;
comment on table pref_bancos is 'Cadastro modular de bancos que operam convenios de PREFEITURA. Separado da tabela gov_bancos por modularidade.';

-- ── 2) CONVENIOS (1 por municipio/instituto/CB) ───────────────
create table if not exists pref_convenios (
  id            bigserial primary key,
  slug          text unique not null,
  nome          text not null,
  uf            text,                     -- ex: 'SP', 'MG', 'RJ'
  estado_nome   text,
  municipio     text,                     -- ex: 'Sorocaba', 'Belo Horizonte', 'Recife'
  tipo          text,                     -- 'prefeitura' | 'instituto_previdencia' | 'cartao_beneficio' | 'outro'
  sheet_origem  text,                     -- nome da aba da planilha (rastreabilidade)
  ativo         boolean default true,
  observacoes   text,
  atualizado_em date,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists idx_pref_convenios_slug on pref_convenios(slug);
create index if not exists idx_pref_convenios_uf on pref_convenios(uf);
create index if not exists idx_pref_convenios_municipio on pref_convenios(municipio);
create index if not exists idx_pref_convenios_ativo on pref_convenios(ativo) where ativo = true;
comment on table pref_convenios is 'Convenios de prefeitura (municipio, instituto previdencia municipal, cartao beneficio). Importado da planilha "PREFEITURAS RESUMO OPERACIONAL".';

-- ── 3) RELACAO BANCO x CONVENIO ───────────────────────────────
create table if not exists pref_banco_convenio (
  id            bigserial primary key,
  banco_id      bigint not null references pref_bancos(id) on delete cascade,
  convenio_id   bigint not null references pref_convenios(id) on delete cascade,

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
create index if not exists idx_pref_bc_convenio on pref_banco_convenio(convenio_id);
create index if not exists idx_pref_bc_banco on pref_banco_convenio(banco_id);
create index if not exists idx_pref_bc_ativo on pref_banco_convenio(suspenso) where suspenso = false;
comment on table pref_banco_convenio is 'Regras operacionais de cada banco em cada convenio de prefeitura.';

-- ── 4) HISTORICO DE ANALISES DE HOLERITE ─────────────────────
create table if not exists pref_holerite_analises (
  id              uuid primary key default gen_random_uuid(),
  user_id         bigint references public.users(id) on delete set null,
  parceiro_nome   text,

  arquivo_nome    text,
  arquivo_tipo    text,
  arquivo_tamanho_bytes integer,

  dados_extraidos jsonb default '{}'::jsonb,

  convenio_sugerido_id bigint references pref_convenios(id),
  convenio_confianca   text,

  bancos_atendem  jsonb default '[]'::jsonb,
  bancos_nao_atendem jsonb default '[]'::jsonb,

  status          text default 'concluido',
  erro_mensagem   text,
  modelo_ia       text,
  duracao_ms      integer,

  created_at      timestamptz default now()
);
create index if not exists idx_pref_holerite_user on pref_holerite_analises(user_id);
create index if not exists idx_pref_holerite_created on pref_holerite_analises(created_at desc);
create index if not exists idx_pref_holerite_convenio on pref_holerite_analises(convenio_sugerido_id);
comment on table pref_holerite_analises is 'Historico das analises de holerite de servidores municipais.';

-- ── Trigger updated_at ────────────────────────────────────────
create or replace function pref_touch_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_pref_bancos_touch on pref_bancos;
create trigger trg_pref_bancos_touch before update on pref_bancos
  for each row execute function pref_touch_updated_at();

drop trigger if exists trg_pref_convenios_touch on pref_convenios;
create trigger trg_pref_convenios_touch before update on pref_convenios
  for each row execute function pref_touch_updated_at();

drop trigger if exists trg_pref_banco_convenio_touch on pref_banco_convenio;
create trigger trg_pref_banco_convenio_touch before update on pref_banco_convenio
  for each row execute function pref_touch_updated_at();
