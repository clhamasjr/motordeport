'use client';

// ════════════════════════════════════════════════════════════════════
// hooks/use-finanto.ts — Hooks React Query pra integração FINANTO/Ajin
//
// Endpoint backend: /api/finanto (Vercel edge function)
// Cobre: INSS (sim, port, refin, novo, margem), FGTS, CLT, drive, catálogo
// ════════════════════════════════════════════════════════════════════

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import type {
  FinantoAuthTerm,
  FinantoBorrower,
  FinantoCreditBankAccount,
  FinantoEmploymentRelationship,
  FinantoFgtsSimulation,
  FinantoInssBalance,
  FinantoInssSimulation,
  FinantoIn100Job,
  FinantoLoan,
  FinantoLoanProduct,
  FinantoLoanRule,
  FinantoOriginContract,
  FinantoRefinanceableContract,
  FinantoSimulationItem,
} from '@/lib/finanto-types';

const ENDPOINT = '/api/finanto';

// ── DIAGNÓSTICO ──────────────────────────────────────────────────────

export function useFinantoTest() {
  return useMutation({
    mutationFn: async () => {
      return await api<{ apiActive: boolean; httpStatus: number; message: string; baseUrl?: string }>(
        ENDPOINT, { action: 'test' },
      );
    },
    onSuccess: (r) => {
      if (r.apiActive) toast.success(`✅ ${r.message}`);
      else toast.error(`❌ ${r.message} (HTTP ${r.httpStatus})`);
    },
    onError: (e: Error) => toast.error('Erro: ' + e.message),
  });
}

// ── CATÁLOGO ─────────────────────────────────────────────────────────

export function useFinantoListProducts(opts?: { type?: number; operation?: number; enabled?: boolean }) {
  return useQuery({
    queryKey: ['finanto', 'products', opts?.type, opts?.operation],
    queryFn: async () => {
      const r = await api<{ success: boolean; items?: FinantoLoanProduct[] }>(
        ENDPOINT,
        { action: 'listProducts', type: opts?.type, operation: opts?.operation },
      );
      return r.items || [];
    },
    enabled: opts?.enabled ?? true,
    staleTime: 5 * 60 * 1000,
  });
}

export function useFinantoListRules(opts?: {
  type?: number; operation?: number; productId?: string;
  offset?: number; limit?: number; enabled?: boolean;
}) {
  return useQuery({
    queryKey: ['finanto', 'rules', opts?.type, opts?.operation, opts?.productId, opts?.offset, opts?.limit],
    queryFn: async () => {
      const r = await api<{ success: boolean; items?: FinantoLoanRule[]; total?: number }>(
        ENDPOINT,
        {
          action: 'listRules',
          type: opts?.type,
          operation: opts?.operation,
          productId: opts?.productId,
          offset: opts?.offset ?? 0,
          limit: opts?.limit ?? 50,
        },
      );
      return { items: r.items || [], total: r.total ?? r.items?.length ?? 0 };
    },
    enabled: opts?.enabled ?? true,
    staleTime: 5 * 60 * 1000,
  });
}

export function useFinantoGetRule(ruleId: string | null | undefined) {
  return useQuery({
    queryKey: ['finanto', 'rule', ruleId],
    queryFn: async () => {
      if (!ruleId) return null;
      const r = await api<FinantoLoanRule & { success: boolean }>(
        ENDPOINT, { action: 'getRule', ruleId },
      );
      return r;
    },
    enabled: !!ruleId,
    staleTime: 5 * 60 * 1000,
  });
}

// ── INSS: SALDO (IN100 / DATAPREV) ───────────────────────────────────

/**
 * Disparo síncrono — espera saldo voltar (timeout em torno de 120s).
 * Recomendado pra UX de "consulta agora".
 */
export function useFinantoConsultarSaldoInss() {
  return useMutation({
    mutationFn: async (params: { cpf: string; beneficio: string }) => {
      const cpf = params.cpf.replace(/\D/g, '');
      const beneficio = params.beneficio.replace(/\D/g, '');
      if (cpf.length !== 11) throw new Error('CPF inválido');
      if (!beneficio) throw new Error('Número do benefício obrigatório');
      const r = await api<FinantoInssBalance>(
        ENDPOINT, { action: 'in100Sync', cpf, beneficio },
      );
      if (!r.success) throw new Error(r.error || 'Erro ao consultar saldo INSS');
      return r;
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

/**
 * Disparo assíncrono — retorna queryId imediatamente, busca depois via getBalance.
 * Ideal pra processos em lote.
 */
export function useFinantoIn100Async() {
  return useMutation({
    mutationFn: async (params: { cpf: string; beneficio: string; lastDays?: number; attempts?: number }) => {
      const cpf = params.cpf.replace(/\D/g, '');
      const beneficio = params.beneficio.replace(/\D/g, '');
      if (cpf.length !== 11) throw new Error('CPF inválido');
      if (!beneficio) throw new Error('Número do benefício obrigatório');
      return await api<FinantoIn100Job>(
        ENDPOINT,
        { action: 'in100', cpf, beneficio, lastDays: params.lastDays ?? 0, attempts: params.attempts ?? 3 },
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useFinantoGetBalance(queryId: string | null | undefined, opts?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: ['finanto', 'balance', queryId],
    queryFn: async () => {
      if (!queryId) return null;
      const r = await api<FinantoInssBalance & { success: boolean }>(
        ENDPOINT, { action: 'getBalance', queryId },
      );
      return r;
    },
    enabled: !!queryId,
    refetchInterval: opts?.refetchInterval ?? false,
  });
}

// ── INSS: CONTRATOS REFINANCIÁVEIS (PORTABILIDADE) ───────────────────

export function useFinantoContratosRefinanciaveis() {
  return useMutation({
    mutationFn: async (params: { cpf: string; beneficio?: string; operation?: number }) => {
      const cpf = params.cpf.replace(/\D/g, '');
      const beneficio = params.beneficio?.replace(/\D/g, '');
      if (cpf.length !== 11) throw new Error('CPF inválido');
      const r = await api<{ success: boolean; items?: FinantoRefinanceableContract[] }>(
        ENDPOINT,
        { action: 'contratosRefinanciaveis', cpf, beneficio, operation: params.operation },
      );
      return r.items || [];
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

// ── INSS: SIMULAÇÃO (CÁLCULO) ────────────────────────────────────────

export interface FinantoCalcInput {
  ruleId: string;
  term: number;
  rate?: number;
  installmentValue?: number;
  loanValue?: number;
  hasInsurance?: boolean;
  referenceCode?: string | null;
  originContract?: FinantoOriginContract;
}

export function useFinantoCalcular() {
  return useMutation({
    mutationFn: async (input: FinantoCalcInput) => {
      if (!input.ruleId) throw new Error('ruleId obrigatório');
      if (!input.term) throw new Error('term obrigatório');
      const r = await api<{ success: boolean; httpStatus: number } & FinantoSimulationItem>(
        ENDPOINT, { action: 'calculate', ...input },
      );
      if (!r.success) throw new Error('Falha no cálculo');
      return r;
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

// ── INSS: CRIAR SIMULAÇÃO (PROPOSTA EM RASCUNHO) ─────────────────────

export interface FinantoCreateProposalInput {
  borrower: FinantoBorrower;
  items: FinantoSimulationItem[];
  creditBankAccount?: FinantoCreditBankAccount;
  step?: { code?: number; name?: string | null };
  files?: Array<{ id?: string; name?: string; url?: string }>;
  note?: string;
  brokerId?: string;
  accessId?: string;
}

export function useFinantoCriarSimulacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: FinantoCreateProposalInput) => {
      const r = await api<{ success: boolean; simulationId: string | null } & FinantoInssSimulation>(
        ENDPOINT, { action: 'createProposal', ...input },
      );
      if (!r.success || !r.simulationId) throw new Error('Falha ao criar simulação');
      return r;
    },
    onSuccess: (r) => {
      toast.success(`✅ Simulação criada (${r.code || r.simulationId})`);
      qc.invalidateQueries({ queryKey: ['finanto', 'simulations'] });
    },
    onError: (err: Error) => toast.error('Erro: ' + err.message),
  });
}

export function useFinantoGetSimulacao(simulationId: string | null | undefined) {
  return useQuery({
    queryKey: ['finanto', 'simulation', simulationId],
    queryFn: async () => {
      if (!simulationId) return null;
      const r = await api<FinantoInssSimulation & { success: boolean }>(
        ENDPOINT, { action: 'getSimulation', simulationId },
      );
      return r;
    },
    enabled: !!simulationId,
  });
}

// ── INSS: AUTH-TERM (DATAPREV opt-in) ────────────────────────────────

export function useFinantoGetAuthTerm() {
  return useMutation({
    mutationFn: async (simulationId: string) => {
      if (!simulationId) throw new Error('simulationId obrigatório');
      const r = await api<FinantoAuthTerm>(
        ENDPOINT, { action: 'getAuthTerm', simulationId },
      );
      if (!r.success) throw new Error('Falha ao gerar termo');
      return r;
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useFinantoAssinarTermo() {
  return useMutation({
    mutationFn: async (params: { authTermKey: string; latitude?: string; longitude?: string }) => {
      const r = await api<FinantoAuthTerm>(
        ENDPOINT,
        {
          action: 'signTerm',
          authTermKey: params.authTermKey,
          latitude: params.latitude,
          longitude: params.longitude,
        },
      );
      if (!r.success || !r.signed) throw new Error('Falha ao assinar termo');
      return r;
    },
    onSuccess: () => toast.success('Termo assinado ✓'),
    onError: (err: Error) => toast.error(err.message),
  });
}

// ── INSS: GERAR CONTRATOS (LOANS) ────────────────────────────────────

export function useFinantoGerarContratos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (simulationId: string) => {
      if (!simulationId) throw new Error('simulationId obrigatório');
      const r = await api<{ success: boolean; status?: unknown; signature?: unknown; items?: unknown[] }>(
        ENDPOINT, { action: 'generateContracts', simulationId },
      );
      if (!r.success) throw new Error('Falha ao gerar contratos');
      return r;
    },
    onSuccess: (_, simulationId) => {
      toast.success('✅ Contratos gerados!');
      qc.invalidateQueries({ queryKey: ['finanto', 'simulation', simulationId] });
      qc.invalidateQueries({ queryKey: ['finanto', 'loans'] });
    },
    onError: (err: Error) => toast.error('Erro: ' + err.message),
  });
}

// ── LOANS (PROPOSTAS DIGITADAS) ──────────────────────────────────────

export function useFinantoGetLoan(loanId: string | null | undefined) {
  return useQuery({
    queryKey: ['finanto', 'loan', loanId],
    queryFn: async () => {
      if (!loanId) return null;
      const r = await api<FinantoLoan & { success: boolean }>(
        ENDPOINT, { action: 'getLoan', loanId },
      );
      return r;
    },
    enabled: !!loanId,
  });
}

export function useFinantoLoansBySimulation(simulationId: string | null | undefined) {
  return useQuery({
    queryKey: ['finanto', 'loans', 'sim', simulationId],
    queryFn: async () => {
      if (!simulationId) return null;
      const r = await api<{ success: boolean; items?: FinantoLoan[] }>(
        ENDPOINT, { action: 'getLoansBySimulation', simulationId },
      );
      return r.items || [];
    },
    enabled: !!simulationId,
  });
}

export function useFinantoSearchLoans() {
  return useMutation({
    mutationFn: async (params: {
      searchText?: string;
      simulationId?: string;
      referenceCode?: string;
      offset?: number;
      limit?: number;
    }) => {
      const payload: Record<string, unknown> = {
        action: 'searchLoans',
        offset: params.offset ?? 0,
        limit: params.limit ?? 20,
      };
      if (params.searchText) payload.searchText = params.searchText;
      if (params.simulationId) payload.simulationId = { eq: params.simulationId };
      if (params.referenceCode) payload.referenceCode = { eq: params.referenceCode };
      return await api<{ success: boolean; items?: FinantoLoan[]; total?: number }>(
        ENDPOINT, payload,
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useFinantoRecalcular() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      loanId: string;
      ruleId?: string;
      hasInsurance?: boolean;
      refinance?: { rate?: number };
      term?: number;
      rate?: number;
      installmentValue?: number;
      loanValue?: number;
    }) => {
      if (!params.loanId) throw new Error('loanId obrigatório');
      const r = await api<{ success: boolean } & FinantoLoan>(
        ENDPOINT, { action: 'recalculate', ...params },
      );
      if (!r.success) throw new Error('Falha no recálculo');
      return r;
    },
    onSuccess: (_, vars) => {
      toast.success('Loan recalculado ✓');
      qc.invalidateQueries({ queryKey: ['finanto', 'loan', vars.loanId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useFinantoAceitarLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { loanId: string; payload?: Record<string, unknown> }) => {
      if (!params.loanId) throw new Error('loanId obrigatório');
      const r = await api<{ success: boolean } & FinantoLoan>(
        ENDPOINT, { action: 'acceptLoan', loanId: params.loanId, payload: params.payload },
      );
      if (!r.success) throw new Error('Falha ao aceitar loan');
      return r;
    },
    onSuccess: (_, vars) => {
      toast.success('✅ Loan aceito!');
      qc.invalidateQueries({ queryKey: ['finanto', 'loan', vars.loanId] });
    },
    onError: (err: Error) => toast.error('Erro: ' + err.message),
  });
}

export function useFinantoReformalizar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      loanId: string;
      ruleId?: string;
      hasInsurance?: boolean;
      refinance?: { rate?: number };
      term?: number;
      rate?: number;
      installmentValue?: number;
      loanValue?: number;
    }) => {
      if (!params.loanId) throw new Error('loanId obrigatório');
      const r = await api<{ success: boolean } & FinantoLoan>(
        ENDPOINT, { action: 'reformalize', ...params },
      );
      if (!r.success) throw new Error('Falha ao reformalizar');
      return r;
    },
    onSuccess: (_, vars) => {
      toast.success('Loan reformalizado ✓');
      qc.invalidateQueries({ queryKey: ['finanto', 'loan', vars.loanId] });
    },
    onError: (err: Error) => toast.error('Erro: ' + err.message),
  });
}

// ── CLT (CONSIGNADO PRIVADO) ─────────────────────────────────────────

export function useFinantoCltCheckEligibility() {
  return useMutation({
    mutationFn: async (params: { borrower: FinantoBorrower; providerCode?: string }) => {
      const r = await api<{
        success: boolean;
        disponivel: boolean;
        motivo?: string;
        simulationId?: string;
        vinculo?: {
          empregador?: string;
          empregadorCnpj?: string;
          matricula?: string;
          renda?: number;
          margemDisponivel?: number;
        };
        _raw?: unknown;
      }>(ENDPOINT, { action: 'cltCheckEligibility', ...params });
      return r;
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useFinantoCltCalcular() {
  return useMutation({
    mutationFn: async (params: {
      simulationId: string;
      type?: 1 | 2;
      identity: string;
      ruleId: string;
      term: number;
      rate: number;
      installmentValue?: number;
      registrationNumber: string;
      employerDocument: string;
      employerName: string;
      isInitialCalculation?: boolean;
    }) => {
      return await api<{ success: boolean; httpStatus: number; items?: unknown[] }>(
        ENDPOINT, { action: 'cltCalculate', ...params },
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

// ── FGTS ─────────────────────────────────────────────────────────────

export function useFinantoFgtsCriarSimulacao() {
  return useMutation({
    mutationFn: async (params: {
      borrower: FinantoBorrower;
      items?: FinantoSimulationItem[];
      creditBankAccount?: FinantoCreditBankAccount;
      brokerId?: string;
    }) => {
      const r = await api<{
        success: boolean; simulationId: string | null;
        error?: string; message?: string; mensagem?: string;
      }>(
        ENDPOINT, { action: 'fgtsCreateSimulation', ...params },
      );
      if (!r.success || !r.simulationId) {
        throw new Error(r.error || r.message || r.mensagem || 'Falha ao criar simulação FGTS');
      }
      return r;
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

// Busca a simulação FGTS por ID. Faz polling enquanto os valores ainda
// não foram calculados (Ajin processa a consulta de saldo na Caixa async).
export function useFinantoFgtsSimulacao(simulationId?: string | null) {
  return useQuery({
    queryKey: ['finanto', 'fgts-sim', simulationId],
    queryFn: async () => {
      return await api<{ success: boolean; httpStatus: number } & FinantoFgtsSimulation>(
        ENDPOINT, { action: 'fgtsGetSimulation', simulationId },
      );
    },
    enabled: !!simulationId,
    refetchInterval: (query) => {
      const d = query.state.data;
      // Sem items calculados ainda → continua consultando a cada 8s
      const calculado = !!d?.items?.some((it) => (it.netValue ?? it.loanValue ?? 0) > 0);
      return calculado ? false : 8_000;
    },
  });
}

export function useFinantoFgtsCriarContratos() {
  return useMutation({
    mutationFn: async (simulationId: string) => {
      const r = await api<{ success: boolean; error?: string; message?: string; mensagem?: string }>(
        ENDPOINT, { action: 'fgtsActions', simulationId, command: 'create_loans' },
      );
      if (!r.success) {
        throw new Error(r.error || r.message || r.mensagem || 'Falha ao criar contratos FGTS');
      }
      return r;
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

// Contratos (loans) gerados a partir de uma simulação FGTS.
// Usa o search genérico de loans filtrando por simulationId.
export function useFinantoFgtsContratos(simulationId?: string | null, enabled = true) {
  return useQuery({
    queryKey: ['finanto', 'fgts-loans', simulationId],
    queryFn: async () => {
      const r = await api<{ success: boolean; items?: FinantoLoan[] }>(
        ENDPOINT, { action: 'searchLoans', simulationId: { eq: simulationId } },
      );
      return r.items || [];
    },
    enabled: !!simulationId && enabled,
    refetchInterval: 15_000,
  });
}

// ── ESCAPE HATCH (debug/exploração) ──────────────────────────────────

export function useFinantoRawCall() {
  return useMutation({
    mutationFn: async (params: { method: string; path: string; payload?: unknown }) => {
      return await api<{ success: boolean; httpStatus: number }>(
        ENDPOINT, { action: 'rawCall', ...params },
      );
    },
  });
}

// ════════════════════════════════════════════════════════════════════
// DIGITAÇÃO MANUAL VIA UI (chama /api/sofia-digitar-finanto)
// ════════════════════════════════════════════════════════════════════

export interface DigitarFinantoInput {
  // Dados do cliente (mesmos campos que FACTA_REQUIRED no agent.js)
  convData: {
    cpf: string;
    nome_completo: string;
    data_nascimento: string;
    beneficio: string;
    especie?: string;
    rg_numero?: string;
    rg_orgao?: string;
    rg_uf?: string;
    rg_data?: string;
    nome_mae?: string;
    sexo?: 'M' | 'F';
    estado_civil?: string;
    email?: string;
    telefone?: string;
    // Endereço
    cep?: string;
    endereco?: string;
    numero_end?: string;
    complemento?: string;
    bairro?: string;
    cidade?: string;
    uf?: string;
    // Conta de depósito
    banco_deposito?: string;
    agencia?: string;
    conta?: string;
    conta_digito?: string;
    tipo_conta?: string;
  };
  // Oportunidade escolhida
  oportunidade: {
    tipo: 'emprestimo_novo' | 'portabilidade';
    banco?: string;
    valor?: number;
    novaParc?: number;
    reducao?: number;
    troco?: number;
    prazo?: number;
    taxa?: number;
    contrato?: string;
    desc?: string;
    // Só pra port+refin:
    origem?: {
      cod?: string;
      banco?: string;
      contrato?: string;
      taxa?: number;
      parcela?: number;
      saldo?: number;
      prazoRestante?: number;
      prazoTotal?: number;
    };
  };
  telefone?: string;
}

export interface DigitarFinantoResult {
  success: boolean;
  type?: 'novo' | 'port_refin';
  simulationId?: string;
  code?: string;
  signatureUrl?: string | null;
  loanValue?: number;
  netValue?: number;
  installmentValue?: number;
  term?: number;
  rate?: number;
  troco?: number;
  reducao?: number;
  items?: unknown[];
  step?: string;
  error?: string;
  trace?: Array<{ step: string; ts: number; [k: string]: unknown }>;
  raw?: unknown;
}

export function useDigitarFinanto() {
  return useMutation({
    mutationFn: async (input: DigitarFinantoInput) => {
      const r = await api<DigitarFinantoResult>('/api/sofia-digitar-finanto', {
        action: 'digitar',
        convData: input.convData,
        oportunidade: input.oportunidade,
        telefone: input.telefone || input.convData.telefone,
      });
      if (!r.success) {
        const msg = r.error || 'Falha na digitação';
        const step = r.step ? `[${r.step}] ` : '';
        throw new Error(step + msg);
      }
      return r;
    },
    onError: (e: Error) => toast.error(e.message, { duration: 8000 }),
    onSuccess: (r) => {
      const tipo = r.type === 'port_refin' ? 'Port+Refin' : 'Empréstimo Novo';
      toast.success(`${tipo} digitado! Código: ${r.code || r.simulationId}`);
    },
  });
}
