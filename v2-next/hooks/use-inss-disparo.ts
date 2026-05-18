'use client';

import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export interface DispatchClientData {
  nome?: string;
  cpf?: string;
  beneficio?: string;
  banco_origem?: string;
  parcela_atual?: number;
  troco?: number;
  margem_disponivel?: number;
  margem_emprestimo?: number;
  margem_cartao?: number;
  saque_disponivel?: number;
  phone?: string;
  t1?: string;
}

export interface BulkDispatchResult {
  success: boolean;
  total?: number;
  sent?: number;
  failed?: number;
  results?: { nome: string; phone?: string; ok: boolean; message?: string; error?: string }[];
  error?: string;
}

export function useBulkDispatch() {
  return useMutation({
    mutationFn: async (params: {
      instance: string;
      campaignType: string;
      clients: DispatchClientData[];
    }) => {
      const r = await api<BulkDispatchResult>('/api/agent', {
        action: 'bulkDispatch',
        instance: params.instance,
        campaignType: params.campaignType,
        clients: params.clients,
      });
      if (!r.success) throw new Error(r.error || 'Erro no disparo');
      return r;
    },
    onSuccess: (r) => {
      toast.success(`Disparo: ${r.sent || 0} enviado(s), ${r.failed || 0} falha(s)`);
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useSingleDispatch() {
  return useMutation({
    mutationFn: async (params: {
      instance: string;
      number: string;
      campaignType: string;
      clientData: DispatchClientData;
    }) => {
      const r = await api<{ success: boolean; number?: string; message?: string; error?: string }>(
        '/api/agent',
        {
          action: 'dispatch',
          instance: params.instance,
          number: params.number,
          campaignType: params.campaignType,
          clientData: params.clientData,
        },
      );
      if (!r.success) throw new Error(r.error || 'Erro no envio');
      return r;
    },
    onSuccess: () => toast.success('Mensagem enviada'),
    onError: (err: Error) => toast.error(err.message),
  });
}
