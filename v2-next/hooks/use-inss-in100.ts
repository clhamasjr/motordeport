'use client';

import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export interface In100Result {
  success: boolean;
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
}

export function useConsultarIN100() {
  return useMutation({
    mutationFn: async (params: { cpf: string; beneficio: string }) => {
      const cpf = params.cpf.replace(/\D/g, '');
      const beneficio = params.beneficio.replace(/\D/g, '');
      if (cpf.length !== 11) throw new Error('CPF inválido');
      if (!beneficio) throw new Error('Número do benefício obrigatório');
      const r = await api<In100Result>('/api/joinbank', { action: 'in100', cpf, beneficio });
      if (!r.success) throw new Error(r.error || 'Erro IN100');
      return r;
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
