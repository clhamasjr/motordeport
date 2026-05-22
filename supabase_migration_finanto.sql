-- ════════════════════════════════════════════════════════════════════
-- Migration: campos pra digitação FINANTO via Sofia
-- Roda no SQL Editor do Supabase
-- ════════════════════════════════════════════════════════════════════

-- 1) Campo jsonb na inss_conversas pra guardar estado da proposta digitada
ALTER TABLE inss_conversas
  ADD COLUMN IF NOT EXISTS proposta_finanto JSONB DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_inss_conversas_proposta_finanto
  ON inss_conversas USING GIN (proposta_finanto);

COMMENT ON COLUMN inss_conversas.proposta_finanto IS
  'Estado da proposta digitada na FINANTO/Ajin via Sofia. Ex: {simulationId, code, type:"novo"|"port_refin", status:"rascunho"|"gerado", signatureUrl, rate, term, loanValue, netValue, installmentValue, troco, reducao, bancoOrigem, contratoOrigem, updated_at}';

-- 2) (Opcional) Tabela espelho de propostas FINANTO — usada se você quiser
--    fazer relatorios cross-conversas. Pode pular se nao precisar.
CREATE TABLE IF NOT EXISTS inss_propostas_finanto (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefone        TEXT,
  cpf             TEXT,
  nome            TEXT,
  beneficio       TEXT,
  simulation_id   TEXT UNIQUE,
  code            TEXT,
  tipo            TEXT, -- 'novo' | 'port_refin'
  status          TEXT, -- 'rascunho' | 'gerado' | 'assinado' | 'aceito' | 'rejeitado' | 'pago'
  signature_url   TEXT,
  rate            NUMERIC(6, 4),
  term            INTEGER,
  loan_value      NUMERIC(14, 2),
  net_value       NUMERIC(14, 2),
  installment_value NUMERIC(14, 2),
  troco           NUMERIC(14, 2),
  reducao         NUMERIC(14, 2),
  banco_origem    TEXT,
  contrato_origem TEXT,
  created_by      INTEGER, -- users.id (vendedor que iniciou)
  parceiro_id     INTEGER,
  raw             JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inss_propostas_finanto_cpf ON inss_propostas_finanto(cpf);
CREATE INDEX IF NOT EXISTS idx_inss_propostas_finanto_status ON inss_propostas_finanto(status);
CREATE INDEX IF NOT EXISTS idx_inss_propostas_finanto_simulation_id ON inss_propostas_finanto(simulation_id);
CREATE INDEX IF NOT EXISTS idx_inss_propostas_finanto_telefone ON inss_propostas_finanto(telefone);
CREATE INDEX IF NOT EXISTS idx_inss_propostas_finanto_created_at ON inss_propostas_finanto(created_at DESC);

COMMENT ON TABLE inss_propostas_finanto IS
  'Espelho local das propostas INSS digitadas via FINANTO/Ajin pela Sofia. Atualizada pelo webhook credit_transfer.proposal e pelo sofia-digitar-finanto.';
