-- ════════════════════════════════════════════════════════════════════
-- Healthcheck — estado dos módulos monitorados (consulta CLT/INSS)
--
-- Guarda o último status conhecido de cada módulo pra o cron
-- (api/healthcheck-cron.js) detectar TRANSIÇÕES e só alertar na mudança.
-- ════════════════════════════════════════════════════════════════════

create table if not exists healthcheck_estado (
  modulo       text primary key,            -- ex: 'consulta_clt', 'consulta_inss'
  label        text,                        -- ex: 'Consulta CLT'
  status       text not null,               -- 'ok' | 'down'
  detalhe      text,                        -- bancos que falharam / 'todos respondendo'
  desde        timestamptz not null default now(),  -- quando o status atual começou
  ultimo_check timestamptz not null default now()   -- última verificação do cron
);

comment on table healthcheck_estado is
  'Estado de saúde dos módulos de consulta — base do alerta WhatsApp do healthcheck-cron.';
