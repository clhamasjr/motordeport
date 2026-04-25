-- ════════════════════════════════════════════════════════════════
-- Migration: clt_autorizacoes_lgpd
-- Padrão unificado de autorização LGPD/DataPrev pra bancos CLT
-- (C6 já usa, FACTA e PAN serão integrados conforme docs chegarem)
-- ════════════════════════════════════════════════════════════════

create table if not exists clt_autorizacoes_lgpd (
  id uuid primary key default gen_random_uuid(),

  banco text not null check (banco in ('c6','facta','pan','presencabank','joinbank','v8')),
  cpf text not null,

  status text not null default 'pending' check (status in (
    'pending',          -- link gerado, aguardando cliente fazer selfie
    'authorized',       -- cliente autorizou, banco confirmou
    'denied',           -- cliente recusou ou banco negou
    'expired'           -- link expirou (30 dias C6)
  )),

  link_selfie text,
  link_expira_em date,

  -- Dados usados pra gerar (referência)
  nome text,
  telefone text,
  data_nascimento date,
  dados_gerar jsonb,

  -- Timestamps
  gerado_em timestamptz default now(),
  autorizado_em timestamptz,
  recusado_em timestamptz,
  expirado_em timestamptz,
  enviado_whatsapp_em timestamptz,

  -- Quem gerou (atribuição)
  gerado_por_user_id integer,
  conversa_id uuid,

  -- Resposta crua do banco (debug)
  _raw_response jsonb,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique (banco, cpf)
);

create index if not exists idx_clt_autz_banco on clt_autorizacoes_lgpd(banco);
create index if not exists idx_clt_autz_cpf on clt_autorizacoes_lgpd(cpf);
create index if not exists idx_clt_autz_status on clt_autorizacoes_lgpd(status);
create index if not exists idx_clt_autz_pending on clt_autorizacoes_lgpd(banco, status) where status = 'pending';
create index if not exists idx_clt_autz_user on clt_autorizacoes_lgpd(gerado_por_user_id);

create or replace function clt_autz_touch()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_clt_autz_touch on clt_autorizacoes_lgpd;
create trigger trg_clt_autz_touch
  before update on clt_autorizacoes_lgpd
  for each row execute function clt_autz_touch();

comment on table clt_autorizacoes_lgpd is 'Registro unificado de autorizações LGPD/DataPrev por banco. Banco + CPF é unique — uma autorização por par.';
comment on column clt_autorizacoes_lgpd.status is 'pending: link gerado / authorized: cliente autorizou / denied: recusado / expired: link expirou';
