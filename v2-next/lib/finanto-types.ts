// ════════════════════════════════════════════════════════════════════
// lib/finanto-types.ts — Tipos TypeScript dos contratos Ajin/FINANTO v3
// ════════════════════════════════════════════════════════════════════

// ── Códigos do catálogo ──────────────────────────────────────────────
// Type codes:
export const FINANTO_TYPE_INSS = 20;
export const FINANTO_TYPE_FGTS = 40;
export const FINANTO_TYPE_FGTS_PAGAMENTO = 41;
export const FINANTO_TYPE_CONSIGNADO_PRIVADO = 50;

// Operation codes:
export const FINANTO_OP_NOVO = 1;
export const FINANTO_OP_REFIN = 2;
export const FINANTO_OP_PORTABILIDADE = 3;
export const FINANTO_OP_PORT_REFIN = 4;
export const FINANTO_OP_REFIN_PORT = 5;
export const FINANTO_OP_MARGEM_COMPLEMENTAR = 6;

// CLT Providers:
export const FINANTO_CLT_PROVIDER_QITECH = '950002';
export const FINANTO_CLT_PROVIDER_321BANK = '950703';

// Lender QI Tech (banco emissor default FINANTO):
export const FINANTO_LENDER_QITECH = 329;
// Fund Banco Inbursa:
export const FINANTO_FUND_INBURSA = 12;

// ── Status genérico ──────────────────────────────────────────────────
export interface FinantoStatus {
  code?: number;
  key?: string;
  name?: string;
  color?: string;
}

// ── Borrower (cliente) ───────────────────────────────────────────────
export interface FinantoBorrower {
  id?: string;
  name: string;
  identity: string; // CPF apenas dígitos
  birthDate?: string; // YYYY-MM-DD
  benefit?: string; // número do benefício INSS
  benefitNumber?: string;
  benefitType?: { code?: number; name?: string };
  motherName?: string;
  email?: string;
  gender?: 'M' | 'F';
  maritalStatus?: { code?: number; name?: string };
  address?: FinantoAddress;
  document?: FinantoDocument;
  phones?: Array<{ ddd?: string; number?: string }>;
}

export interface FinantoAddress {
  zipCode?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
}

export interface FinantoDocument {
  type?: string;
  number?: string;
  issuer?: string;
  issuerState?: string;
  issueDate?: string;
}

// ── Bank account (crédito) ───────────────────────────────────────────
export interface FinantoCreditBankAccount {
  bankCode?: string;
  agencyNumber?: string;
  agencyDigit?: string;
  accountNumber?: string;
  accountDigit?: string;
  accountType?: 'checking' | 'savings' | string;
  pixKey?: string;
  pixKeyType?: string;
}

// ── Origin contract (portabilidade) ──────────────────────────────────
export interface FinantoOriginContract {
  lenderCode?: number;
  lender?: { code?: number; name?: string };
  contractNumber?: string;
  term?: number;
  installmentsRemaining?: number;
  installmentValue?: number;
  dueBalanceValue?: number;
}

// ── Item da simulação ────────────────────────────────────────────────
export interface FinantoSimulationItem {
  product?: { id?: string; code?: number; name?: string };
  rule?: { id?: string; name?: string };
  ruleId?: string;
  status?: FinantoStatus;
  creditDate?: string;
  firstDueDate?: string;
  lastDueDate?: string;
  simulationValue?: number;
  loanValue?: number;
  netValue?: number;
  costValue?: number;
  installmentValue?: number;
  term?: number;
  rate?: number;
  dailyRate?: number;
  monthlyRate?: number;
  annualRate?: number;
  totalEffectiveCost?: number;
  costs?: Array<{ type?: string; value?: number }>;
  refinancing?: Record<string, unknown>;
  originContract?: FinantoOriginContract;
  hasInsurance?: boolean;
  referenceCode?: string | null;
}

// ── Simulação INSS ───────────────────────────────────────────────────
export interface FinantoInssSimulation {
  id: string;
  code?: string;
  status?: FinantoStatus;
  proposalDate?: string;
  borrower: FinantoBorrower;
  items: FinantoSimulationItem[];
  signature?: {
    provider?: { code?: string };
    url?: string;
    status?: FinantoStatus;
    key?: string;
  };
  inssPortAccepted?: {
    webhookType?: string;
    proposalKey?: string;
    proposalStatus?: string;
    data?: {
      finalDueBalance?: number;
      portabilityNumber?: string;
      originalContract?: FinantoOriginContract;
    };
  };
  creditBankAccount?: FinantoCreditBankAccount;
  step?: { code?: number; name?: string | null };
  files?: Array<{ id?: string; name?: string; url?: string }>;
  brokerId?: string | null;
  accessId?: string | null;
  note?: string | null;
}

// ── Simulação FGTS (saque-aniversário antecipado) ────────────────────
export interface FinantoFgtsSimulation {
  id: string;
  code?: string;
  status?: FinantoStatus;
  proposalDate?: string;
  borrower?: FinantoBorrower;
  items?: FinantoSimulationItem[];
  creditBankAccount?: FinantoCreditBankAccount;
  signature?: {
    provider?: { code?: string };
    url?: string;
    status?: FinantoStatus;
    key?: string;
  };
  step?: { code?: number; name?: string | null };
  note?: string | null;
  brokerId?: string | null;
}

// ── Loan (proposta digitada) ─────────────────────────────────────────
export interface FinantoLoan {
  id: string;
  code?: string;
  product?: { id?: string; code?: number; name?: string };
  rule?: { id?: string; name?: string };
  borrower?: { name?: string; identity?: string; cpf?: string; benefit?: string };
  status?: FinantoStatus;
  operationStatus?: FinantoStatus;
  proposalStatus?: FinantoStatus;
  contractNumber?: string;
  proposalDate?: string;
  creditDate?: string;
  loanValue?: number;
  netValue?: number;
  installmentValue?: number;
  term?: number;
  rate?: number;
  signature?: {
    provider?: { code?: string };
    url?: string;
    status?: FinantoStatus;
    key?: string;
  };
}

// ── Saldo INSS (IN100/DATAPREV) ──────────────────────────────────────
export interface FinantoInssBalance {
  success?: boolean;
  cpf?: string;
  beneficio?: string;
  nome?: string | null;
  status?: string | null;
  benefitStatus?: string | null;
  elegivel?: boolean;
  bloqueado?: boolean;
  tipoBlock?: string | null;
  especie?: string | null;
  margemEmprestimo?: number;
  margemCartao?: number;
  limiteCartao?: number;
  limiteCartaoBeneficio?: number;
  saldoCartaoBeneficio?: number;
  maxSaldo?: number;
  saldoUsado?: number;
  saldoDisponivel?: number;
  contaBanco?: unknown;
  contratosAtivos?: number;
  contratosSuspensos?: number;
  portabilidades?: number;
  representanteLegal?: boolean;
  uf?: string | null;
  dataNascimento?: string | null;
  dataConcessao?: string | null;
  queryDate?: string | null;
  error?: string;
  _raw?: unknown;
}

// ── IN100 assíncrono (job) ───────────────────────────────────────────
export interface FinantoIn100Job {
  success?: boolean;
  queryId?: string | null;
  status?: 'awaiting' | 'completed' | 'failed' | string | null;
  queryDate?: string | null;
}

// ── Auth term (termo INSS/DATAPREV ou CLT) ───────────────────────────
export interface FinantoAuthTerm {
  success?: boolean;
  authTermKey?: string | null;
  signed?: boolean;
  status?: FinantoStatus | null;
  content?: string | null;
}

// ── Contratos refinanciáveis ─────────────────────────────────────────
export interface FinantoRefinanceableContract {
  lenderCode?: number;
  lender?: { code?: number; name?: string };
  contractNumber?: string;
  term?: number;
  installmentsRemaining?: number;
  installmentValue?: number;
  dueBalanceValue?: number;
  startDate?: string;
  endDate?: string;
}

// ── Catálogo: produto e regra ────────────────────────────────────────
export interface FinantoLoanProduct {
  id: string;
  code?: number;
  name?: string;
  type?: { code?: number; name?: string };
  operation?: { code?: number; name?: string };
}

export interface FinantoLoanRule {
  id: string;
  name?: string;
  product?: FinantoLoanProduct;
  rate?: number;
  dailyRate?: number;
  monthlyRate?: number;
  term?: { min?: number; max?: number };
  minLoanValue?: number;
  maxLoanValue?: number;
  benefitTypeAllowed?: number[];
  benefitTypeNotAllowed?: number[];
  recalculationRules?: Record<string, unknown>;
  lender?: { code?: number; name?: string };
  fund?: { code?: number; name?: string };
}

// ── Webhook payload (credit_transfer.proposal) ───────────────────────
export interface FinantoWebhookCreditTransferProposal {
  webhookType: 'credit_transfer.proposal';
  proposalKey: string;
  proposalStatus: 'accepted' | 'rejected' | string;
  data?: {
    finalDueBalance?: number;
    portabilityNumber?: string;
    originalContract?: FinantoOriginContract;
    rejectionReason?: string;
  };
}

// ── CLT (Consignado Privado) — employment relationship ───────────────
export interface FinantoEmploymentRelationship {
  employerName?: string;
  employerDocument?: string;
  registrationNumber?: string;
  salary?: number;
  availableMargin?: number;
  startDate?: string;
}

// ── Response wrappers padrão ─────────────────────────────────────────
export interface FinantoApiResponse<T = unknown> {
  success: boolean;
  httpStatus?: number;
  error?: string;
  mensagem?: string;
  _raw?: unknown;
  data?: T;
  items?: T[];
}
