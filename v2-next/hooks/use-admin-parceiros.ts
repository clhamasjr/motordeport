'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  CreateParceiroParams,
  ListParceirosResponse,
  Parceiro,
  SimpleResponse,
  UpdateParceiroParams,
} from '@/lib/admin-types';
import { toast } from 'sonner';

/**
 * Lista todos os parceiros (admin e gestor). Inclui inativos.
 */
export function useAdminParceiros() {
  return useQuery({
    queryKey: ['admin', 'parceiros'],
    queryFn: async () => {
      const r = await api<ListParceirosResponse>('/api/auth', { action: 'list_parceiros' });
      if (!r.ok) throw new Error(r.error || 'Erro ao listar parceiros');
      return r.parceiros || [];
    },
    staleTime: 60 * 1000,
  });
}

function inv(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['admin', 'parceiros'] });
  // refresh users também (parceiro_id pode ter mudado)
  qc.invalidateQueries({ queryKey: ['admin', 'users'] });
}

export function useCreateParceiro() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: CreateParceiroParams) => {
      const r = await api<SimpleResponse & { parceiro?: Parceiro }>('/api/auth', {
        action: 'create_parceiro',
        ...params,
      });
      if (!r.ok) throw new Error(r.error || 'Erro ao criar parceiro');
      return r;
    },
    onSuccess: () => {
      inv(qc);
      toast.success('Parceiro criado');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useUpdateParceiro() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: UpdateParceiroParams) => {
      const r = await api<SimpleResponse>('/api/auth', {
        action: 'update_parceiro',
        ...params,
      });
      if (!r.ok) throw new Error(r.error || 'Erro ao atualizar parceiro');
      return r;
    },
    onSuccess: () => {
      inv(qc);
      toast.success('Parceiro atualizado');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

/**
 * Toggle ativo/inativo (soft delete). Reaproveita update_parceiro.
 */
export function useToggleParceiroActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ parceiroId, active }: { parceiroId: number; active: boolean }) => {
      const r = await api<SimpleResponse>('/api/auth', {
        action: 'update_parceiro',
        parceiroId,
        active,
      });
      if (!r.ok) throw new Error(r.error || 'Erro ao alterar status');
      return r;
    },
    onSuccess: (_, vars) => {
      inv(qc);
      toast.success(vars.active ? 'Parceiro reativado' : 'Parceiro desativado');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

/**
 * Soft delete — só funciona se nenhum user estiver vinculado.
 */
export function useDeleteParceiro() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (parceiroId: number) => {
      const r = await api<SimpleResponse>('/api/auth', {
        action: 'delete_parceiro',
        parceiroId,
      });
      if (!r.ok) throw new Error(r.error || 'Erro ao excluir parceiro');
      return r;
    },
    onSuccess: () => {
      inv(qc);
      toast.success('Parceiro desativado');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
