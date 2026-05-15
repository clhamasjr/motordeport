'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  DigitacaoListResponse,
  DigitacaoStatsResponse,
  DigitacaoUpdateParams,
  EsteiraFiltros,
} from '@/lib/inss-types';
import { toast } from 'sonner';

/**
 * Lista propostas INSS digitadas (tabela `digitacao` no Supabase).
 * Backend: /api/digitacao action=list — admin/gestor vê tudo, operador só dele.
 */
export function useEsteiraInss(filtros: EsteiraFiltros = {}) {
  return useQuery({
    queryKey: ['inss', 'esteira', filtros],
    queryFn: async () => {
      const body: Record<string, unknown> = { action: 'list', limit: 500 };
      if (filtros.status) body.status = filtros.status;
      if (filtros.cpf) body.cpf = filtros.cpf;
      const r = await api<DigitacaoListResponse>('/api/digitacao', body);
      if (!r.ok) throw new Error(r.error || 'Erro ao carregar esteira');
      // Filtro de banco aplicado em cliente (V1 não tem param)
      let items = r.items || [];
      if (filtros.banco) {
        items = items.filter((p) =>
          (p.banco || '').toLowerCase().includes(filtros.banco!.toLowerCase()),
        );
      }
      return items;
    },
    staleTime: 30 * 1000,
  });
}

/**
 * Contagem de propostas por status (KPI).
 */
export function useEsteiraStats() {
  return useQuery({
    queryKey: ['inss', 'esteira', 'stats'],
    queryFn: async () => {
      const r = await api<DigitacaoStatsResponse>('/api/digitacao', { action: 'stats' });
      if (!r.ok) throw new Error(r.error || 'Erro ao carregar stats');
      return { total: r.total || 0, counts: r.counts || {} };
    },
    staleTime: 60 * 1000,
  });
}

/**
 * Atualiza status/AF/observações de uma proposta.
 */
export function useUpdateDigitacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: DigitacaoUpdateParams) => {
      const r = await api<{ ok: boolean; error?: string }>('/api/digitacao', {
        action: 'update',
        ...params,
      });
      if (!r.ok) throw new Error(r.error || 'Erro ao atualizar');
      return r;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inss', 'esteira'] });
      toast.success('Proposta atualizada');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Erro ao atualizar');
    },
  });
}

/**
 * Exclui uma proposta da esteira (apenas admin).
 */
export function useDeleteDigitacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const r = await api<{ ok: boolean; error?: string }>('/api/digitacao', {
        action: 'delete',
        id,
      });
      if (!r.ok) throw new Error(r.error || 'Erro ao excluir');
      return r;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inss', 'esteira'] });
      toast.success('Proposta excluída');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Erro ao excluir');
    },
  });
}
