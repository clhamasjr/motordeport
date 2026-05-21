'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  ListConveniosResponse,
  GetConvenioResponse,
  CategoriaFed,
} from '@/lib/fed-types';

interface ListFiltros {
  categoria?: CategoriaFed | '';
  orgao?: string;
  busca?: string;
}

/**
 * Lista todos os convênios federais (SIAPE / SERPRO / militares) com filtros.
 * Cache 5min — catálogo muda raramente. Retorna `grupos` agrupado por
 * categoria (civil × militar).
 */
export function useFedConvenios(filtros: ListFiltros = {}) {
  return useQuery({
    queryKey: ['fed', 'convenios', filtros],
    queryFn: async () => {
      const r = await api<ListConveniosResponse>('/api/fed', {
        action: 'listConvenios',
        ...(filtros.categoria ? { categoria: filtros.categoria } : {}),
        ...(filtros.orgao ? { orgao: filtros.orgao } : {}),
        ...(filtros.busca ? { busca: filtros.busca } : {}),
      });
      if (!r.ok) throw new Error(r.error || 'Falha ao carregar convênios');
      return r;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Detalhe de 1 convênio federal (com lista de bancos + regras).
 * Cache 5min — só busca quando `slug` for não-vazio.
 */
export function useFedConvenio(slug: string | null | undefined) {
  return useQuery({
    queryKey: ['fed', 'convenio', slug],
    queryFn: async () => {
      const r = await api<GetConvenioResponse>('/api/fed', {
        action: 'getConvenio',
        slug,
      });
      if (!r.ok) throw new Error(r.error || 'Convênio não encontrado');
      return r;
    },
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
  });
}
