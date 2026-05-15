'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { CatalogoResponse } from '@/lib/clt-bancos-types';

/**
 * Lista todos os bancos CLT cadastrados + convênios + regras (vínculos).
 * Cache 5min — catálogo muda raramente.
 */
export function useCatalogoCltBancos() {
  return useQuery({
    queryKey: ['clt', 'catalogo-bancos'],
    queryFn: async () => {
      const r = await api<CatalogoResponse>('/api/clt-bancos', { action: 'listar' });
      if (!r.success) throw new Error(r.error || 'Falha ao carregar catálogo');
      return r;
    },
    staleTime: 5 * 60 * 1000,
  });
}
