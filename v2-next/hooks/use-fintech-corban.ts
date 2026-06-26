'use client';

import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

// ──────────────────────────────────────────────────────────────────
// Fintech do Corban (Super Simples) — Consignado Privado CLT
// Backend: /api/fintechdocorban · providers: 'qi' (QI Tech) | 'celcoin'
// ──────────────────────────────────────────────────────────────────

export type FintechProvider = 'qi' | 'celcoin';

export interface FintechTestResult {
  success: boolean;
  ambiente?: string;
  baseUrl?: string;
  httpStatus?: number;
  mensagem?: string;
  amostra?: unknown;
}

export interface FintechConsultaResult {
  success: boolean;
  httpStatus?: number;
  cpf?: string;
  provider?: string;
  encontrado?: boolean;
  registros?: number;
  dados?: Record<string, unknown> | null;
  _raw?: unknown;
}

/** Testa a conexão + valida a API key (action 'test'). */
export function useFintechTest() {
  return useMutation({
    mutationFn: async (provider: FintechProvider) => {
      const r = await api<FintechTestResult>('/api/fintechdocorban', { action: 'test', provider });
      return r;
    },
    onError: (err: Error) => toast.error(err.message || 'Erro ao testar Fintech do Corban'),
  });
}

/** Consulta dados do trabalhador por CPF (action 'consultarPorCPF'). */
export function useFintechConsultarCPF() {
  return useMutation({
    mutationFn: async (params: { cpf: string; provider: FintechProvider }) => {
      const cpf = params.cpf.replace(/\D/g, '');
      if (cpf.length !== 11) throw new Error('CPF inválido — precisa ter 11 dígitos');
      const r = await api<FintechConsultaResult>('/api/fintechdocorban', {
        action: 'consultarPorCPF', cpf, provider: params.provider,
      });
      return r;
    },
    onError: (err: Error) => toast.error(err.message || 'Erro na consulta'),
  });
}

export interface FintechTabela {
  idTabela: number | null;
  idProduto: number | null;
  nome: string;
  isInss: boolean;
}
export interface FintechTabelasResult {
  success: boolean;
  httpStatus?: number;
  total?: number;
  tabelasInss?: number;
  tabelas?: FintechTabela[];
}

/** Lista as tabelas de comissão (as "regras": produto/taxa/prazo). produto='inss' filtra só INSS. */
export function useFintechTabelas() {
  return useMutation({
    mutationFn: async (produto?: 'inss' | '') => {
      const r = await api<FintechTabelasResult>('/api/fintechdocorban', { action: 'listarTabelas', produto: produto || '' });
      return r;
    },
    onError: (err: Error) => toast.error(err.message || 'Erro ao listar tabelas'),
  });
}

/** Consulta saldo/margem do beneficiário INSS por CPF (action 'consultarSaldoInss'). */
export function useFintechSaldoInss() {
  return useMutation({
    mutationFn: async (cpf: string) => {
      const c = cpf.replace(/\D/g, '');
      if (c.length !== 11) throw new Error('CPF inválido — precisa ter 11 dígitos');
      const r = await api<{ success: boolean; httpStatus?: number; statusConsulta?: string | null; dados?: unknown; _raw?: unknown }>(
        '/api/fintechdocorban', { action: 'consultarSaldoInss', cpf: c },
      );
      return r;
    },
    onError: (err: Error) => toast.error(err.message || 'Erro ao consultar margem INSS'),
  });
}

/** Envia o link de autorização (SMS) pro cliente (action 'enviarLinkAutorizacao'). */
export function useFintechEnviarLink() {
  return useMutation({
    mutationFn: async (params: { cpf: string; nome?: string; provider: FintechProvider }) => {
      const cpf = params.cpf.replace(/\D/g, '');
      if (cpf.length !== 11) throw new Error('CPF inválido');
      const r = await api<{ success: boolean; httpStatus?: number; _raw?: unknown; error?: string }>(
        '/api/fintechdocorban',
        { action: 'enviarLinkAutorizacao', cpf, nome: params.nome, provider: params.provider },
      );
      if (!r.success) throw new Error(r.error || `Falha ao enviar link (HTTP ${r.httpStatus})`);
      return r;
    },
    onSuccess: () => toast.success('Link de autorização enviado por SMS pro cliente'),
    onError: (err: Error) => toast.error(err.message),
  });
}
