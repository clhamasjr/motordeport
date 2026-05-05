-- ════════════════════════════════════════════════════════════════
-- Migration: Modulo GOVERNOS (Convenios + Bancos + Holerite Analise)
-- Projeto: FlowForce
-- Data: 2026-05-04
-- Aplicar no Supabase rirsmtyuyqxsoxqbgtpu (projeto motordeport)
--
-- Cria 4 tabelas, todas isoladas com prefixo gov_:
--   gov_bancos              → cadastro modular de bancos GOV (separado dos bancos INSS/CLT)
--   gov_convenios           → 1 linha por aba da planilha (orgao/estado)
--   gov_banco_convenio      → relacao N:N com regras operacionais por banco x convenio
--   gov_holerite_analises   → historico das analises de holerite feitas pelos parceiros
-- ════════════════════════════════════════════════════════════════

-- ── 1) BANCOS GOV (cadastro modular, separado dos bancos INSS/CLT) ──
create table if not exists gov_bancos (
  id          bigserial primary key,
  slug        text unique not null,
  nome        text not null,
  ativo       boolean default true,
  observacoes text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists idx_gov_bancos_slug on gov_bancos(slug);
create index if not exists idx_gov_bancos_ativo on gov_bancos(ativo) where ativo = true;
comment on table gov_bancos is 'Cadastro modular de bancos que operam convenios de governo. Separado da tabela de bancos INSS/CLT por decisao de modularidade.';

-- ── 2) CONVENIOS (1 por orgao/estado) ────────────────────────────────
create table if not exists gov_convenios (
  id            bigserial primary key,
  slug          text unique not null,
  nome          text not null,
  uf            text,                     -- ex: 'AC', 'SP', 'DF'
  estado_nome   text,
  sheet_origem  text,                     -- nome da aba da planilha origem (rastreabilidade)
  ativo         boolean default true,
  observacoes   text,
  atualizado_em date,                     -- vem da aba BASE da planilha
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists idx_gov_convenios_slug on gov_convenios(slug);
create index if not exists idx_gov_convenios_uf on gov_convenios(uf);
create index if not exists idx_gov_convenios_ativo on gov_convenios(ativo) where ativo = true;
comment on table gov_convenios is 'Convenios de governo (estado, tribunal, prefeitura, autarquia). Importado da planilha "GOVERNOS RESUMO OPERACIONAL".';

-- ── 3) RELACAO BANCO x CONVENIO (com regras operacionais) ────────────
create table if not exists gov_banco_convenio (
  id            bigserial primary key,
  banco_id      bigint not null references gov_bancos(id) on delete cascade,
  convenio_id   bigint not null references gov_convenios(id) on delete cascade,

  -- ── Operacoes que o banco realiza neste convenio ──
  opera_novo    boolean default false,
  opera_refin   boolean default false,
  opera_port    boolean default false,
  opera_cartao  boolean default false,

  -- ── Regras canonicas (parsedas — usadas no cruzamento com holerite) ──
  suspenso          boolean default false,    -- banco esta suspenso neste convenio
  margem_utilizavel numeric(5,4),             -- ex: 0.3500
  idade_min         smallint,                 -- ex: 21
  idade_max         smallint,                 -- ex: 75
  taxa_minima_port  numeric(6,4),             -- ex: 0.0185 (mensal)
  data_corte        text,                     -- ex: 'Dia 02', 'Dia 15'
  valor_minimo      text,                     -- texto livre (varia muito)
  qtd_contratos     text,                     -- texto livre

  -- ── Atributos completos (texto bruto da planilha — pra renderizar tudo) ──
  atributos     jsonb default '{}'::jsonb,
  -- formato: {slug_canonico: 'texto bruto da celula'}
  -- ex: {operacoes: 'Novo / Refin / Port', margem_utilizavel: '0.35', taxa_minima: '0.019', ...}

  atributos_brutos jsonb default '[]'::jsonb,
  -- formato: [{label, valor, secao}]
  -- ex: [{label:'Margem Utilizavel', valor:'0.35', secao:'principal'}, ...]

  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),

  unique (banco_id, convenio_id)
);
create index if not exists idx_gov_bc_convenio on gov_banco_convenio(convenio_id);
create index if not exists idx_gov_bc_banco on gov_banco_convenio(banco_id);
create index if not exists idx_gov_bc_ativo on gov_banco_convenio(suspenso) where suspenso = false;
comment on table gov_banco_convenio is 'Regras operacionais de cada banco em cada convenio. Cruza com dados do holerite pra ver quais bancos atendem o cliente.';

-- ── 4) HISTORICO DE ANALISES DE HOLERITE ─────────────────────────────
create table if not exists gov_holerite_analises (
  id              uuid primary key default gen_random_uuid(),
  user_id         bigint references public.users(id) on delete set null,  -- quem subiu (nullable pra suportar admin/sistema)
  parceiro_nome   text,                       -- snapshot do nome do parceiro

  -- ── Arquivo enviado ──
  arquivo_nome    text,
  arquivo_tipo    text,                       -- 'application/pdf' | 'image/jpeg' | etc
  arquivo_tamanho_bytes integer,

  -- ── Dados extraidos pela IA do holerite ──
  dados_extraidos jsonb default '{}'::jsonb,
  -- formato: {
  --   nome, cpf, matricula, orgao, cargo,
  --   data_nascimento, idade,
  --   salario_bruto, salario_liquido,
  --   margem_consignavel_disponivel, margem_cartao_disponivel,
  --   descontos: [{descricao, valor}],
  --   competencia: '2026-04', mes_referencia
  -- }

  convenio_sugerido_id bigint references gov_convenios(id),
  convenio_confianca   text,                  -- 'alta' | 'media' | 'baixa'

  -- ── Resultado do cruzamento: bancos que atendem ──
  bancos_atendem  jsonb default '[]'::jsonb,
  -- formato: [{banco_id, banco_nome, motivo_atende, observacoes, regras_relevantes}]

  bancos_nao_atendem jsonb default '[]'::jsonb,
  -- formato: [{banco_id, banco_nome, motivo_nao_atende}]

  -- ── Metadata ──
  status          text default 'concluido',   -- 'processando' | 'concluido' | 'erro'
  erro_mensagem   text,
  modelo_ia       text,                       -- 'claude-sonnet-4-5-20250929'
  duracao_ms      integer,

  created_at      timestamptz default now()
);
create index if not exists idx_gov_holerite_user on gov_holerite_analises(user_id);
create index if not exists idx_gov_holerite_created on gov_holerite_analises(created_at desc);
create index if not exists idx_gov_holerite_convenio on gov_holerite_analises(convenio_sugerido_id);
comment on table gov_holerite_analises is 'Historico das analises de holerite feitas pelos parceiros. Auditoria + recorrencia (mesmo cliente).';

-- ── Trigger pra updated_at ───────────────────────────────────────────
create or replace function gov_touch_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_gov_bancos_touch on gov_bancos;
create trigger trg_gov_bancos_touch before update on gov_bancos
  for each row execute function gov_touch_updated_at();

drop trigger if exists trg_gov_convenios_touch on gov_convenios;
create trigger trg_gov_convenios_touch before update on gov_convenios
  for each row execute function gov_touch_updated_at();

drop trigger if exists trg_gov_banco_convenio_touch on gov_banco_convenio;
create trigger trg_gov_banco_convenio_touch before update on gov_banco_convenio
  for each row execute function gov_touch_updated_at();
