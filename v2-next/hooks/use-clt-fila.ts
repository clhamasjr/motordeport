'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  CriarConsultaParams,
  CriarConsultaResponse,
  FilaConsulta,
  StatusFilaResponse,
} from '@/lib/clt-types';
import { toast } from 'sonner';

/**
 * Cria nova consulta CLT na fila.
 * On success: invalida lista de recentes pra aparecer.
 */
export function useCriarConsultaCLT() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: CriarConsultaParams) => {
      const body: Record<string, unknown> = {
        action: 'criar',
        cpf: params.cpf,
        incluirC6: params.incluirC6 !== false,
      };
      if (params.nome) body.nome = params.nome;
      if (params.dataNascimento) body.dataNascimento = params.dataNascimento;
      if (params.sexo) body.sexo = params.sexo;
      if (params.telefone) body.telefone = params.telefone;
      if (params.origem) body.origem = params.origem;
      return api<CriarConsultaResponse>('/api/clt-fila', body);
    },
    onSuccess: (data) => {
      if (data.success && data.id) {
        qc.invalidateQueries({ queryKey: ['clt', 'recentes'] });
        toast.success('Consulta iniciada — aguardando bancos...');
      } else {
        toast.error(data.error || 'Falha ao criar consulta');
      }
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Erro ao criar consulta');
    },
  });
}

/**
 * Status de UMA consulta com polling INTELIGENTE:
 * - Se status_geral === 'concluido': sem refetch automático (cache 30min)
 * - Se ainda 'processando': refetch a cada 2s
 * - Para automaticamente quando concluir
 *
 * No futuro, substituído por Supabase Realtime (subscribe na tabela
 * clt_consultas_fila filtrando por id) — sem necessidade de polling.
 */
export function useFilaStatus(filaId: string | null) {
  return useQuery({
    queryKey: ['clt', 'fila', filaId],
    queryFn: async (): Promise<FilaConsulta> => {
      if (!filaId) throw new Error('filaId obrigatorio');
      const r = await api<StatusFilaResponse>('/api/clt-fila', {
        action: 'status',
        id: filaId,
      });
      if (!r.success || !r.fila) throw new Error(r.error || 'Fila não encontrada');
      return r.fila;
    },
    enabled: !!filaId,
    refetchInterval: (query) => {
      const fila = query.state.data;
      if (!fila) return 1500;
      return fila.status_geral === 'concluido' ? false : 2000;
    },
    staleTime: (query) => {
      const fila = query.state.data;
      return fila?.status_geral === 'concluido' ? 30 * 60 * 1000 : 1000;
    },
  });
}

/**
 * Lista de consultas recentes (últimas N do user/parceiro).
 * Cache 30s, revalida ao focar.
 */
interface RecentesResponse {
  success: boolean;
  consultas?: Array<{
    id: string;
    cpf: string;
    nome?: string;
    status_geral: string;
    iniciado_em: string;
  }>;
}

export function useConsultasRecentes(limit = 20) {
  return useQuery({
    queryKey: ['clt', 'recentes', limit],
    queryFn: async () => {
      const r = await api<RecentesResponse>('/api/clt-fila', {
        action: 'recentes',
        limit,
      });
      return r.consultas || [];
    },
    staleTime: 30 * 1000,
  });
}
