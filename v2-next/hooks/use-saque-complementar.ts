'use client';

import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

// ──────────────────────────────────────────────────────────────────
// Saque Complementar — consulta /api/cartao do V1 (DataConsulta API)
// Retorna cartões existentes do cliente com limite de saque disponível.
// ──────────────────────────────────────────────────────────────────

export interface CartaoSaque {
  banco: string;
  fonte: string;
  margem: number;
  limiteCartao: number;
  limiteSaqueTotal: number;
  limiteSaqueDisp: number;
  minimoSaque: number;
  limiteUtilizado: number;
  saldoDevedor: number;
  statusCartao: string;
  produto: string;
  matricula: string;
  observacao: string;
}

export interface CartaoTelefone {
  ddd?: string;
  telefone?: string;
}

export interface SaqueComplementarResponse {
  success: boolean;
  cpf?: string;
  nome?: string;
  fontes?: string[];
  cartoes?: CartaoSaque[];
  telefones?: CartaoTelefone[];
  dados?: Record<string, unknown>;
  errors?: string[];
  error?: string;
}

export interface ConsultarSaqueParams {
  cpf: string;
  matricula?: string;
  /** Lista de bancos pra consultar. Default: ['BMG', 'DAYCOVAL']. */
  bancos?: string[];
}

export function useConsultarSaqueComplementar() {
  return useMutation({
    mutationFn: async (params: ConsultarSaqueParams): Promise<SaqueComplementarResponse> => {
      const cpf = (params.cpf || '').replace(/\D/g, '');
      if (cpf.length !== 11) throw new Error('CPF inválido');
      const body: Record<string, unknown> = { cpf, matricula: params.matricula || '' };
      // Bancos por padrão (BMG / DAYCOVAL — V1)
      if (params.bancos && params.bancos.length) body.bancos = params.bancos;
      const r = await api<SaqueComplementarResponse>('/api/cartao', body);
      if (!r.success && r.error) throw new Error(r.error);
      return r;
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Erro ao consultar saque complementar');
    },
  });
}
