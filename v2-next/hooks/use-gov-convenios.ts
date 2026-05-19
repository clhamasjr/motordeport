'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  ListConveniosResponse,
  GetConvenioResponse,
  ListBancosResponse,
} from '@/lib/gov-types';

/**
 * Lista todos os convenios ativos agrupados por UF.
 * Cache 5min — catalogo muda raramente.
 */
export function useGovConvenios() {
  return useQuery({
    queryKey: ['gov', 'convenios'],
    queryFn: async () => {
      const r = await api<ListConveniosResponse>('/api/gov', { action: 'listConvenios' });
      if (!r.ok) throw new Error(r.error || 'Falha ao carregar convênios');
      return r;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Detalhe de 1 convenio com seus bancos + regras.
 * `slug` null/undefined = nao busca (idle).
 */
export function useGovConvenio(slug: string | null | undefined) {
  return useQuery({
    queryKey: ['gov', 'convenio', slug],
    queryFn: async () => {
      const r = await api<GetConvenioResponse>('/api/gov', { action: 'getConvenio', slug });
      if (!r.ok) throw new Error(r.error || 'Convênio não encontrado');
      return r;
    },
    enabled: !!slug,
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Lista todos os bancos GOV (para dropdowns de admin).
 */
export function useGovBancos() {
  return useQuery({
    queryKey: ['gov', 'bancos'],
    queryFn: async () => {
      const r = await api<ListBancosResponse>('/api/gov', { action: 'listBancos' });
      if (!r.ok) throw new Error(r.error || 'Falha ao carregar bancos');
      return r;
    },
    staleTime: 5 * 60 * 1000,
  });
}
