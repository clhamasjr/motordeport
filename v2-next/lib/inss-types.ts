// ──────────────────────────────────────────────────────────────────
// INSS V2 — Tipos espelhando /api/multicorban consult_cpf/consult_beneficio
// V1 está em api/multicorban.js. Backend não muda — só tipamos a resposta.
// ──────────────────────────────────────────────────────────────────

export interface InssBeneficiario {
  cpf?: string;
  nome?: string;
  nb?: string;
  rg?: string;
  nome_mae?: string;
  data_nascimento?: string;
  idade?: string;
}

export interface InssBeneficio {
  valor?: string;
  base_calculo?: string;
  situacao?: string;
  especie?: string;
  data_extrato?: string;
  ddb?: string;
  desbloqueio?: string;
  nb?: string;
}

export interface InssMargem {
  parcelas?: string;
  total?: string;
  disponivel?: string;
  rmc?: string;
  rcc?: string;
}

export interface InssContrato {
  contrato?: string;
  banco?: string;
  banco_codigo?: string;
  taxa?: string;
  valor?: string;
  parcela?: string;
  prazos?: string;
  prazo_original?: string;
  saldo?: string;
  saldo_quitacao?: string;
  competencia_inicial?: string;
  competencia_final?: string;
}

export interface InssCartao {
  tipo?: string;
  banco?: string;
  banco_codigo?: string;
  numero?: string;
  margem?: string;
  competencia_inicial?: string;
}

export interface InssTelefone {
  ddd?: string;
  numero?: string;
}

export interface InssBenefListItem {
  nb?: string;
  situacao?: string;
  especie?: string;
  nome?: string;
}

export interface InssParsedResult {
  beneficiario: InssBeneficiario;
  beneficio: InssBeneficio;
  margem: InssMargem;
  contratos: InssContrato[];
  cartoes: InssCartao[];
  telefones: InssTelefone[];
  endereco?: Record<string, string>;
  banco?: Record<string, string>;
}

export interface InssConsultaResponse {
  ok: boolean;
  cpf?: string;
  parsed?: InssParsedResult;
  lista?: InssBenefListItem[];
  auto_selected?: string;
  error?: string;
  raw_code?: number;
}

// ──────────────────────────────────────────────────────────────────
// Enquadramento (motor v1 — calcEnquadramentoPlus)
// REGRA HOJE: emp ≤ 35% + RMC ≤ 5% + RCC ≤ 5% = total ≤ 45%
// ──────────────────────────────────────────────────────────────────

export type CompStatus =
  | 'dentro_regra'
  | 'fora_regra_resolvivel'
  | 'fora_regra_inviavel'
  | 'sem_dados';

export interface EnquadramentoResultado {
  compPct: number;
  compStatus: CompStatus;
  excedente: number;
  total: number;
  benef: number;
  teto45: number;
  sumEmp: number;
  sumRmc: number;
  sumRcc: number;
}

// Resultado consolidado da consulta (com enquadramento já calculado)
export interface ConsultaInssView {
  parsed: InssParsedResult;
  enquadramento: EnquadramentoResultado | null;
  lista?: InssBenefListItem[];
  auto_selected?: string;
}

// ──────────────────────────────────────────────────────────────────
// Esteira INSS — tabela `digitacao` (Supabase)
// ──────────────────────────────────────────────────────────────────

export type DigitacaoStatus =
  | 'pendente'
  | 'digitada'
  | 'analise'
  | 'aprovada'
  | 'cip'
  | 'averbada'
  | 'paga'
  | 'recusada'
  | 'cancelada';

export interface DigitacaoItem {
  id: number;
  user_id: number | null;
  cpf: string;
  nome: string | null;
  beneficio: string | null;
  tipo: string;            // 'portabilidade' | 'novo' | 'cartao' | 'saque' | 'refinanciamento'
  banco: string;           // 'FACTA' | 'QUALI' | 'BRB' | 'ICRED' | etc
  status: DigitacaoStatus | string;
  contrato_origem: string | null;
  banco_origem: string | null;
  parcela_origem: number | null;
  saldo_devedor: number | null;
  taxa_origem: number | null;
  prazo_restante: number | null;
  valor_operacao: number | null;
  valor_parcela: number | null;
  taxa_nova: number | null;
  prazo_novo: number | null;
  valor_troco: number | null;
  codigo_tabela: string | null;
  codigo_af: string | null;
  id_simulador: string | null;
  simulation_id: string | null;
  loan_id: string | null;
  url_formalizacao: string | null;
  dados_pessoais: Record<string, unknown> | null;
  dados_simulacao: Record<string, unknown> | null;
  observacoes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface DigitacaoListResponse {
  ok: boolean;
  items?: DigitacaoItem[];
  error?: string;
}

export interface DigitacaoStatsResponse {
  ok: boolean;
  total?: number;
  counts?: Record<string, number>;
  error?: string;
}

export interface DigitacaoUpdateParams {
  id: number;
  status?: string;
  codigo_af?: string;
  observacoes?: string;
  url_formalizacao?: string;
}

export interface EsteiraFiltros {
  status?: string;
  banco?: string;
  cpf?: string;
}
