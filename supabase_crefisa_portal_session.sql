-- ══════════════════════════════════════════════════════════════════
-- Sessão do portal Crefisa / Gerencial Crédito (2tech)
--
-- O portal exige reCAPTCHA + 2FA no login → o robô não loga sozinho.
-- O dono loga no navegador e cola a sessão 1x (action setPortalSession).
--
-- Precisa das DUAS partes:
--   cookie → telas .asp legadas (ajax_crefisa.asp)
--   bearer → API REST /microservice/crefisa/{cod}/...
--
-- Singleton: uma linha só (id = 1).
-- ══════════════════════════════════════════════════════════════════

create table if not exists crefisa_portal_session (
  id               int primary key default 1,
  bearer           text,          -- JWT do localStorage, sem o prefixo "Bearer "
  cookie           text,          -- header Cookie completo (ASPSESSIONID...)
  versao_sistema   text,          -- header X-Versao-Sistema exigido pela API
  cod_cliente      text,          -- código do cliente no 2tech (ex: 10431)
  vendedor_id      int,
  codigo_parceiro  text,
  codigo_usuario_parceiro text,     -- usuário digitador (GetUsuarios → codigo)
  alerta_enviado   boolean default false,  -- evita repetir aviso de queda no WhatsApp
  atualizado_em    timestamptz default now(),
  constraint crefisa_portal_session_singleton check (id = 1)
);

comment on table crefisa_portal_session is
  'Sessão colada do portal Crefisa (Baixa Renda / Bolsa Família). Expira junto com a sessão do navegador — recolar quando o motor acusar SEM_SESSAO.';

-- 05/10/2026: coluna adicionada depois da 1ª execução
alter table crefisa_portal_session add column if not exists codigo_usuario_parceiro text;
