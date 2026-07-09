'use client';

// ════════════════════════════════════════════════════════════════════
// hooks/use-fgts.ts — FGTS (antecipação saque-aniversário)
//
// Dois backends:
//  - Fintech do Corban (/api/fintechdocorban) — consulta de saldo nas
//    bancarizadoras QI SCD (typeQuery 1) e J17 (typeQuery 3). O cliente
//    precisa liberar as duas no app FGTS da Caixa.
//  - V8 Sistema (/api/v8) — fluxo completo: saldo (async) → tabela →
//    simulação → proposta com link de formalização.
// ════════════════════════════════════════════════════════════════════

import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

const FINTECH = '/api/fintechdocorban';
const V8 = '/api/v8';
const FACTA = '/api/facta';
const NOVOSAQUE = '/api/novosaque';

// ══════════════════════════════════════════════════════════════════
// FINTECH DO CORBAN
// ══════════════════════════════════════════════════════════════════

export interface FintechFgtsConsulta {
  typeQuery: number;
  instituicao: string;
  ok: boolean;
  httpStatus?: number;
  statusConsulta?: string | null;
  dados?: unknown;
  _raw?: unknown;
}

export interface FintechFgtsSaldoResult {
  success: boolean;
  cpf?: string;
  consultas?: FintechFgtsConsulta[];
}

/** Consulta saldo FGTS nas duas bancarizadoras (QI SCD + J17) em paralelo. */
export function useFintechFgtsSaldo() {
  return useMutation({
    mutationFn: async (cpf: string) => {
      const c = cpf.replace(/\D/g, '');
      if (c.length !== 11) throw new Error('CPF inválido — precisa ter 11 dígitos');
      return await api<FintechFgtsSaldoResult>(FINTECH, { action: 'fgtsConsultarSaldo', cpf: c });
    },
    onError: (err: Error) => toast.error(err.message || 'Erro na consulta FGTS'),
  });
}

export interface FintechFgtsTabela {
  idTabela: number | null;
  idProduto: number | null;
  nome: string;
  isFgts?: boolean;
}

/** Lista as tabelas FGTS da Fintech do Corban. */
export function useFintechFgtsTabelas() {
  return useMutation({
    mutationFn: async () => {
      return await api<{ success: boolean; total?: number; tabelasFgts?: number; tabelas?: FintechFgtsTabela[] }>(
        FINTECH, { action: 'listarTabelas', produto: 'fgts' },
      );
    },
    onError: (err: Error) => toast.error(err.message || 'Erro ao listar tabelas'),
  });
}

// ══════════════════════════════════════════════════════════════════
// FACTA
// ══════════════════════════════════════════════════════════════════

export interface FactaFgtsSaldo {
  success: boolean;
  cpf?: string;
  saldoTotal?: number | null;
  periodos?: Array<{ dataRepasse?: string; valor?: number } | Record<string, unknown>>;
  mensagem?: string | null;
  erro?: boolean;
}

/** Consulta o saldo/base FGTS na FACTA (roteia pelo proxy do escritório). */
export function useFactaFgtsSaldo() {
  return useMutation({
    mutationFn: async (cpf: string) => {
      const c = cpf.replace(/\D/g, '');
      if (c.length !== 11) throw new Error('CPF inválido — precisa ter 11 dígitos');
      return await api<FactaFgtsSaldo>(FACTA, { action: 'fgtsSaldo', cpf: c });
    },
    onError: (err: Error) => toast.error(err.message || 'Erro na consulta FACTA'),
  });
}

// ══════════════════════════════════════════════════════════════════
// NOVOSAQUE
// ══════════════════════════════════════════════════════════════════

/** Inicia a simulação FGTS na NovoSaque → retorna transactionId (async). */
export function useNovoSaqueFgtsIniciar() {
  return useMutation({
    mutationFn: async (cpf: string) => {
      const c = cpf.replace(/\D/g, '');
      if (c.length !== 11) throw new Error('CPF inválido — precisa ter 11 dígitos');
      const r = await api<{ success: boolean; transactionId: string | null; erro?: string }>(
        NOVOSAQUE, { action: 'fgtsSimular', cpf: c },
      );
      if (!r.success || !r.transactionId) throw new Error(r.erro || 'Falha ao iniciar simulação NovoSaque');
      return r;
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export interface NovoSaqueContrato {
  success: boolean;
  transactionId?: string;
  stage?: string | null;
  summaryStatus?: string | null;
  ofertaPronta?: boolean;
  semOferta?: boolean;
  falhou?: boolean;
  balanceOk?: boolean | null;
  contractLink?: string | null;
  simulacao?: {
    simulationId?: string | null;
    liquido?: number | null;
    parcelas?: number | null;
    taxaMensal?: number | null;
  } | null;
}

/** Busca o contrato/status NovoSaque. Faz polling até a oferta ficar pronta. */
export function useNovoSaqueFgtsContrato(transactionId?: string | null) {
  return useQuery({
    queryKey: ['novosaque', 'contrato', transactionId],
    queryFn: async () => {
      return await api<NovoSaqueContrato>(NOVOSAQUE, { action: 'fgtsContrato', transactionId });
    },
    enabled: !!transactionId,
    refetchInterval: (query) => {
      const d = query.state.data;
      if (d?.ofertaPronta || d?.falhou) return false;
      return 6_000;
    },
  });
}

// ══════════════════════════════════════════════════════════════════
// V8 SISTEMA
// ══════════════════════════════════════════════════════════════════

export type V8FgtsProvider = 'bms' | 'qi' | 'cartos';

export interface V8FgtsPeriod {
  amount: number;
  dueDate: string; // YYYY-MM-DD
}

export interface V8FgtsSaldo {
  success: boolean;
  cpf?: string;
  encontrado?: boolean;
  balanceId?: string | null;
  status?: string | null; // success | fail | null (processando)
  saldoTotal?: number | null;
  provider?: string | null;
  periods?: V8FgtsPeriod[];
  erro?: string | null;
}

/** Inicia a consulta de saldo na V8 (async — o resultado vem depois via fgtsBuscarSaldo). */
export function useV8FgtsIniciarConsulta() {
  return useMutation({
    mutationFn: async (params: { cpf: string; provider: V8FgtsProvider }) => {
      const c = params.cpf.replace(/\D/g, '');
      if (c.length !== 11) throw new Error('CPF inválido — precisa ter 11 dígitos');
      const r = await api<{ success: boolean; mensagem?: string; erro?: string; error?: string }>(
        V8, { action: 'fgtsConsultarSaldo', cpf: c, provider: params.provider },
      );
      if (!r.success) throw new Error(r.erro || r.error || r.mensagem || 'Falha ao iniciar consulta de saldo V8');
      return r;
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

/** Busca o resultado da consulta de saldo. Faz polling enquanto processa. */
export function useV8FgtsSaldo(cpf: string | null) {
  const c = (cpf || '').replace(/\D/g, '');
  return useQuery({
    queryKey: ['v8', 'fgts-saldo', c],
    queryFn: async () => {
      return await api<V8FgtsSaldo>(V8, { action: 'fgtsBuscarSaldo', cpf: c });
    },
    enabled: c.length === 11,
    refetchInterval: (query) => {
      const d = query.state.data;
      // status final (success/fail) → para de consultar
      if (d?.status === 'success' || d?.status === 'fail') return false;
      return 6_000;
    },
  });
}

/** Limpa o cache do saldo na V8 (permite reconsultar o mesmo CPF). */
export function useV8FgtsLimparCache() {
  return useMutation({
    mutationFn: async (cpf: string) => {
      const c = cpf.replace(/\D/g, '');
      return await api<{ success: boolean }>(V8, { action: 'fgtsLimparCache', cpf: c });
    },
    onSuccess: () => toast.success('Cache limpo — pode consultar de novo'),
    onError: (err: Error) => toast.error(err.message),
  });
}

export interface V8FgtsTabela {
  ativa: boolean;
  padrao: boolean;
  id: string;
  nome: string;
  taxaMensal: number | null;
  taxaAnual: number | null;
}

/** Tabelas de taxa (fees) disponíveis pra simulação. */
export function useV8FgtsTabelas(enabled = true) {
  return useQuery({
    queryKey: ['v8', 'fgts-tabelas'],
    queryFn: async () => {
      const r = await api<{ success: boolean; tabelas?: V8FgtsTabela[] }>(V8, { action: 'fgtsTabelas' });
      return (r.tabelas || []).filter((t) => t.ativa);
    },
    enabled,
    staleTime: 10 * 60 * 1000,
  });
}

export interface V8FgtsSimulacao {
  success: boolean;
  simulationId?: string | null;
  valorLiquido?: number | null;
  valorOperacao?: number | null;
  saldoBloqueado?: number | null;
  iof?: number | null;
  taxaMensal?: number | null;
  cetMensal?: number | null;
  cetAnual?: number | null;
  qtdParcelas?: number | null;
  error?: string;
  message?: string;
}

/** Simula a antecipação com a tabela escolhida + parcelas do saldo. */
export function useV8FgtsSimular() {
  return useMutation({
    mutationFn: async (params: {
      cpf: string;
      simulationFeesId: string;
      balanceId: string;
      desiredInstallments: Array<{ totalAmount: number; dueDate: string }>;
      targetAmount?: number;
      provider: V8FgtsProvider;
    }) => {
      const r = await api<V8FgtsSimulacao>(V8, {
        action: 'fgtsSimular',
        cpf: params.cpf.replace(/\D/g, ''),
        simulationFeesId: params.simulationFeesId,
        balanceId: params.balanceId,
        desiredInstallments: params.desiredInstallments,
        targetAmount: params.targetAmount ?? 0,
        provider: params.provider,
      });
      if (!r.success || !r.simulationId) {
        throw new Error(r.error || r.message || 'Falha na simulação V8');
      }
      return r;
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export interface V8Banco { id: string; nome: string; codigo: string }

/** Lista de bancos da V8 (bankId usado no pagamento transfer da proposta). */
export function useV8Bancos(enabled = true) {
  return useQuery({
    queryKey: ['v8', 'bancos'],
    queryFn: async () => {
      const r = await api<{ success: boolean; bancos?: V8Banco[] }>(V8, { action: 'fgtsListarBancos' });
      return r.bancos || [];
    },
    enabled,
    staleTime: 60 * 60 * 1000,
  });
}

export interface V8FgtsPropostaInput {
  cpf: string;
  nome: string;
  dataNascimento: string; // YYYY-MM-DD
  telefone: string;
  email?: string;
  nomeMae?: string;
  rg?: string;
  maritalStatus?: string;
  fgtsSimulationId: string;
  simulationFeesId: string;
  periods: V8FgtsPeriod[];
  address?: {
    postalCode?: string; state?: string; city?: string; neighborhood?: string;
    street?: string; number?: string; complement?: string;
  };
  payment: {
    bankId: string;
    accountType?: 'checking_account' | 'savings_account';
    agency: string;
    account: string;
    digit?: string;
  };
}

/** Cria a proposta FGTS → retorna link de formalização pro cliente. */
export function useV8FgtsCriarProposta() {
  return useMutation({
    mutationFn: async (input: V8FgtsPropostaInput) => {
      const r = await api<{
        success: boolean; proposalId?: string | null; contractNumber?: string | null;
        formalizationLink?: string | null; error?: string; message?: string;
      }>(V8, { action: 'fgtsCriarProposta', ...input });
      if (!r.success) throw new Error(r.error || r.message || 'Falha ao criar proposta V8');
      return r;
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

/** Lista propostas FGTS (por CPF ou período). */
export function useV8FgtsPropostas(search?: string, enabled = true) {
  return useQuery({
    queryKey: ['v8', 'fgts-propostas', search || ''],
    queryFn: async () => {
      const r = await api<{ success: boolean; data?: unknown[] }>(
        V8, { action: 'fgtsListarPropostas', search: search || undefined },
      );
      return (r.data || []) as Array<Record<string, unknown>>;
    },
    enabled,
    refetchInterval: 30_000,
  });
}
