'use client';

import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

interface ReseedResponse {
  ok: boolean;
  stats?: { bancos?: number; convenios?: number; banco_convenio?: number };
  duracao_ms?: number;
  seed_meta?: { fonte?: string; gerado_em?: string; versao_seed?: string };
  error?: string;
}

/**
 * Reseed do catalogo de governos a partir do /gov_seed.json deployado.
 * Preserva registros marcados como editado_manual=true (correcoes via UI).
 */
export function useGovReseed() {
  return useMutation({
    mutationFn: async () => {
      const r = await api<ReseedResponse>('/api/gov-seed', { action: 'reseed' });
      if (!r.ok) throw new Error(r.error || 'Falha no reseed');
      return r;
    },
    onSuccess: (r) => {
      const s = r.stats || {};
      toast.success(
        `✓ ${s.bancos || 0} bancos · ${s.convenios || 0} convênios · ${s.banco_convenio || 0} relações (${((r.duracao_ms || 0) / 1000).toFixed(1)}s)`
      );
    },
    onError: (e: Error) => toast.error('Erro no reseed: ' + e.message),
  });
}
