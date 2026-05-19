'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { UpsertBancoConvenioRequest, UpsertBancoRequest } from '@/lib/gov-types';

/**
 * Cria ou atualiza relacao banco x convenio. Marca editado_manual=true
 * automaticamente no backend (protegido contra Reseed).
 */
export function useUpsertBancoConvenio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (req: UpsertBancoConvenioRequest) => {
      const r = await api<{ ok: boolean; registro?: unknown; error?: string }>(
        '/api/gov',
        { action: 'upsertBancoConvenio', ...req }
      );
      if (!r.ok) throw new Error(r.error || 'Falha ao salvar');
      return r;
    },
    onSuccess: (_, vars) => {
      toast.success(vars.id ? 'Regras atualizadas' : 'Banco adicionado');
      qc.invalidateQueries({ queryKey: ['gov', 'convenio'] });
    },
    onError: (e: Error) => toast.error('Erro: ' + e.message),
  });
}

/**
 * Remove relacao banco x convenio.
 */
export function useDeleteBancoConvenio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const r = await api<{ ok: boolean; error?: string }>(
        '/api/gov',
        { action: 'deleteBancoConvenio', id }
      );
      if (!r.ok) throw new Error(r.error || 'Falha ao excluir');
      return r;
    },
    onSuccess: () => {
      toast.success('Banco removido do convênio');
      qc.invalidateQueries({ queryKey: ['gov', 'convenio'] });
    },
    onError: (e: Error) => toast.error('Erro: ' + e.message),
  });
}

/**
 * Cria banco novo no cadastro modular.
 */
export function useUpsertBanco() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (req: UpsertBancoRequest) => {
      const r = await api<{ ok: boolean; banco?: { id: number; slug: string; nome: string }; error?: string }>(
        '/api/gov',
        { action: 'upsertBanco', ...req }
      );
      if (!r.ok) throw new Error(r.error || 'Falha ao criar banco');
      return r;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gov', 'bancos'] });
    },
  });
}
