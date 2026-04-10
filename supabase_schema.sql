-- ══════════════════════════════════════════════════════════════════
-- FlowForce — Supabase Database Schema
-- Execute no SQL Editor do Supabase (supabase.com > SQL Editor)
-- ══════════════════════════════════════════════════════════════════

-- ╔═══════════════════════════════════════╗
-- ║  1. USUARIOS E SESSOES               ║
-- ╚═══════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS users (
  id          BIGSERIAL PRIMARY KEY,
  username    TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  password_hash TEXT NOT NULL,       -- HMAC-SHA256 com salt
  salt        TEXT NOT NULL,          -- salt unico por usuario
  role        TEXT NOT NULL DEFAULT 'operador'
              CHECK (role IN ('admin', 'gestor', 'operador')),
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- ╔═══════════════════════════════════════╗
-- ║  2. CONSULTAS (HISTORICO)             ║
-- ╚═══════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS consultas (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id),
  tipo        TEXT NOT NULL CHECK (tipo IN ('cpf', 'beneficio', 'in100', 'cartao', 'raw')),
  cpf         TEXT,
  beneficio   TEXT,
  nome        TEXT,
  resultado   JSONB,                  -- resposta completa da API
  fonte       TEXT,                    -- 'multicorban', 'joinbank', 'facta', 'dataconsulta'
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_consultas_cpf ON consultas(cpf);
CREATE INDEX idx_consultas_user ON consultas(user_id);
CREATE INDEX idx_consultas_created ON consultas(created_at DESC);

-- ╔═══════════════════════════════════════╗
-- ║  3. DIGITACAO (ESTEIRA)               ║
-- ╚═══════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS digitacao (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT REFERENCES users(id),
  cpf             TEXT NOT NULL,
  nome            TEXT,
  beneficio       TEXT,
  tipo            TEXT NOT NULL CHECK (tipo IN (
                    'portabilidade', 'emprestimo_novo', 'refinanciamento',
                    'cartao_beneficio', 'margem_complementar', 'saque_rmc'
                  )),
  banco           TEXT NOT NULL,       -- 'FACTA', 'JOINBANK', 'MANUAL'
  status          TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN (
                    'pendente', 'simulando', 'em_digitacao', 'aguardando_docs',
                    'enviada', 'em_analise', 'aprovada', 'formalizada',
                    'paga', 'cancelada', 'recusada'
                  )),
  -- Dados do contrato original (para port/refin)
  contrato_origem TEXT,
  banco_origem    TEXT,
  parcela_origem  DECIMAL(12,2),
  saldo_devedor   DECIMAL(12,2),
  taxa_origem     DECIMAL(6,4),
  prazo_restante  INT,
  -- Dados da proposta nova
  valor_operacao  DECIMAL(12,2),
  valor_parcela   DECIMAL(12,2),
  taxa_nova       DECIMAL(6,4),
  prazo_novo      INT,
  valor_troco     DECIMAL(12,2),       -- portabilidade
  codigo_tabela   TEXT,
  -- IDs externos
  codigo_af       TEXT,                 -- FACTA AF code
  id_simulador    TEXT,                 -- FACTA simulador
  simulation_id   TEXT,                 -- JoinBank simulation ID
  loan_id         TEXT,                 -- JoinBank loan ID
  url_formalizacao TEXT,
  -- Dados pessoais coletados
  dados_pessoais  JSONB,
  dados_simulacao JSONB,
  -- Tracking
  observacoes     TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_digitacao_cpf ON digitacao(cpf);
CREATE INDEX idx_digitacao_user ON digitacao(user_id);
CREATE INDEX idx_digitacao_status ON digitacao(status);
CREATE INDEX idx_digitacao_created ON digitacao(created_at DESC);

-- ╔═══════════════════════════════════════╗
-- ║  4. BASES IMPORTADAS                  ║
-- ╚═══════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS bases (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id),
  nome        TEXT NOT NULL,
  registros   INT DEFAULT 0,
  meta        JSONB,                   -- metadados da importacao
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS base_registros (
  id          BIGSERIAL PRIMARY KEY,
  base_id     BIGINT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  cpf         TEXT,
  nome        TEXT,
  beneficio   TEXT,
  dados       JSONB NOT NULL,          -- todos os campos do registro
  consultado  BOOLEAN DEFAULT false,
  elegivel    BOOLEAN,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_base_reg_base ON base_registros(base_id);
CREATE INDEX idx_base_reg_cpf ON base_registros(cpf);

-- ╔═══════════════════════════════════════╗
-- ║  5. CAMPANHAS WHATSAPP                ║
-- ╚═══════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS campanhas_wpp (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT REFERENCES users(id),
  nome            TEXT NOT NULL,
  template        TEXT,
  tipo            TEXT CHECK (tipo IN ('portabilidade', 'cartao', 'emprestimo', 'saque', 'geral')),
  instancia_wpp   TEXT,                -- nome da instancia Evolution
  total_contatos  INT DEFAULT 0,
  enviados        INT DEFAULT 0,
  respondidos     INT DEFAULT 0,
  convertidos     INT DEFAULT 0,
  status          TEXT DEFAULT 'rascunho' CHECK (status IN (
                    'rascunho', 'ativa', 'pausada', 'concluida', 'cancelada'
                  )),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campanha_contatos (
  id              BIGSERIAL PRIMARY KEY,
  campanha_id     BIGINT NOT NULL REFERENCES campanhas_wpp(id) ON DELETE CASCADE,
  cpf             TEXT,
  nome            TEXT,
  telefone        TEXT NOT NULL,
  dados_cliente   JSONB,               -- dados do cliente pra template
  status          TEXT DEFAULT 'pendente' CHECK (status IN (
                    'pendente', 'enviado', 'entregue', 'lido',
                    'respondido', 'convertido', 'erro', 'optout'
                  )),
  mensagem_enviada TEXT,
  enviado_at      TIMESTAMPTZ,
  respondido_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_camp_contatos_camp ON campanha_contatos(campanha_id);
CREATE INDEX idx_camp_contatos_status ON campanha_contatos(status);

-- ╔═══════════════════════════════════════╗
-- ║  6. CONVERSAS IA (SOFIA)              ║
-- ╚═══════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS conversas_ia (
  id              BIGSERIAL PRIMARY KEY,
  telefone        TEXT NOT NULL,
  instancia_wpp   TEXT,
  fase            TEXT DEFAULT 'abordagem',
  tipo_campanha   TEXT DEFAULT 'completa',
  dados_coletados JSONB DEFAULT '{}'::jsonb,
  dados_cliente   JSONB DEFAULT '{}'::jsonb,
  ativa           BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_conversas_tel ON conversas_ia(telefone) WHERE ativa = true;

-- ╔═══════════════════════════════════════╗
-- ║  7. AUDIT LOG                         ║
-- ╚═══════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id),
  action      TEXT NOT NULL,
  resource    TEXT,                     -- 'consulta', 'digitacao', 'campanha', etc.
  resource_id TEXT,
  details     JSONB,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_action ON audit_log(action);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

-- ╔═══════════════════════════════════════╗
-- ║  8. CONFIGURACOES                     ║
-- ╚═══════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS configuracoes (
  id          BIGSERIAL PRIMARY KEY,
  chave       TEXT UNIQUE NOT NULL,
  valor       JSONB NOT NULL,
  descricao   TEXT,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ╔═══════════════════════════════════════╗
-- ║  9. TRIGGERS (updated_at automatico)  ║
-- ╚═══════════════════════════════════════╝

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_digitacao_updated BEFORE UPDATE ON digitacao
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_campanhas_updated BEFORE UPDATE ON campanhas_wpp
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_conversas_updated BEFORE UPDATE ON conversas_ia
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ╔═══════════════════════════════════════╗
-- ║  10. LIMPEZA AUTOMATICA               ║
-- ╚═══════════════════════════════════════╝

-- Limpar sessoes expiradas (rodar via Supabase CRON ou pg_cron)
-- SELECT cron.schedule('limpar-sessoes', '0 */6 * * *', 'DELETE FROM sessions WHERE expires_at < now()');

-- ╔═══════════════════════════════════════╗
-- ║  11. USUARIO ADMIN INICIAL            ║
-- ╚═══════════════════════════════════════╝

-- Senha padrao: admin123 (trocar imediatamente apos primeiro login!)
-- O hash sera gerado pelo sistema no primeiro deploy
-- Por enquanto inserimos com hash placeholder — o auth.js vai criar o admin real
INSERT INTO users (username, name, password_hash, salt, role)
VALUES ('admin', 'Administrador', 'PENDING_FIRST_LOGIN', 'PENDING', 'admin')
ON CONFLICT (username) DO NOTHING;

-- ╔═══════════════════════════════════════╗
-- ║  12. RLS (Row Level Security)         ║
-- ╚═══════════════════════════════════════╝

-- Ativar RLS em todas as tabelas
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultas ENABLE ROW LEVEL SECURITY;
ALTER TABLE digitacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE base_registros ENABLE ROW LEVEL SECURITY;
ALTER TABLE campanhas_wpp ENABLE ROW LEVEL SECURITY;
ALTER TABLE campanha_contatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversas_ia ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracoes ENABLE ROW LEVEL SECURITY;

-- Policy: service_role tem acesso total (usado pelo backend)
-- As APIs usam SUPABASE_SERVICE_KEY que bypassa RLS automaticamente
-- Se no futuro quiser acesso direto do frontend ao Supabase,
-- adicione policies por user aqui

-- ══════════════════════════════════════════════════════════════════
-- PRONTO! Execute este script no SQL Editor do Supabase.
-- Depois configure as Environment Variables no Vercel (ver README).
-- ══════════════════════════════════════════════════════════════════
