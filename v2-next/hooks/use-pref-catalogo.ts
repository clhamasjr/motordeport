'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  ListConveniosResponse,
  GetConvenioResponse,
  ListBancosResponse,
  UpsertBancoConvenioPayload,
  PrefConvenio,
  BancoConvenioPref,
} from '@/lib/pref-types';
import { toast } from 'sonner';

/**
 * Lista TODOS os convênios de prefeituras (ativos). Cache 5min — base muda raramente.
 * Agrupamento por Estado/Cidade é feito client-side nas telas.
 */
export function usePrefConvenios() {
  return useQuery({
    queryKey: ['pref', 'convenios'],
    queryFn: async () => {
      const r = await api<ListConveniosResponse>('/api/pref', { action: 'listConvenios' });
      if (!r.ok) throw new Error(r.error || 'Falha ao carregar convênios');
      return r;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Detalhe de 1 convênio com bancos + regras. Cache 2min. */
export function usePrefConvenio(slug: string | null | undefined) {
  return useQuery({
    queryKey: ['pref', 'convenio', slug],
    queryFn: async () => {
      const r = await api<GetConvenioResponse>('/api/pref', { action: 'getConvenio', slug });
      if (!r.ok) throw new Error(r.error || 'Convênio não encontrado');
      return r;
    },
    enabled: !!slug,
    staleTime: 2 * 60 * 1000,
  });
}

/** Lista de bancos PREF cadastrados (pra dropdown do modal admin). */
export function usePrefBancos() {
  return useQuery({
    queryKey: ['pref', 'bancos'],
    queryFn: async () => {
      const r = await api<ListBancosResponse>('/api/pref', { action: 'listBancos' });
      if (!r.ok) throw new Error(r.error || 'Falha ao listar bancos');
      return r;
    },
    staleTime: 10 * 60 * 1000,
  });
}

/** ADMIN: criar/editar vínculo banco × convênio. */
export function useUpsertBancoConvenio(convenioSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpsertBancoConvenioPayload) => {
      const r = await api<{ ok: boolean; vinculo?: BancoConvenioPref; error?: string }>(
        '/api/pref',
        { action: 'upsertBancoConvenio', ...payload }
      );
      if (!r.ok) throw new Error(r.error || 'Falha ao salvar');
      return r;
    },
    onSuccess: () => {
      toast.success('Banco salvo no convênio');
      qc.invalidateQueries({ queryKey: ['pref', 'convenio', convenioSlug] });
      qc.invalidateQueries({ queryKey: ['pref', 'bancos'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** ADMIN: criar banco novo (volta o id). */
export function useCriarPrefBanco() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { nome: string; slug?: string; observacoes?: string }) => {
      const r = await api<{ ok: boolean; banco?: { id: number; slug: string; nome: string }; error?: string }>(
        '/api/pref',
        { action: 'criarBanco', ...data }
      );
      if (!r.ok || !r.banco) throw new Error(r.error || 'Falha ao criar banco');
      return r.banco;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pref', 'bancos'] });
    },
  });
}

/** ADMIN: remove vínculo. */
export function useDeleteBancoConvenio(convenioSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const r = await api<{ ok: boolean; error?: string }>('/api/pref', {
        action: 'deleteBancoConvenio', id,
      });
      if (!r.ok) throw new Error(r.error || 'Falha ao remover');
      return r;
    },
    onSuccess: () => {
      toast.success('Banco removido do convênio');
      qc.invalidateQueries({ queryKey: ['pref', 'convenio', convenioSlug] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Helpers de agrupamento (client-side) ──────────────────────

/** Agrupa convênios em UF -> Cidade -> Convênios, com filtro por busca/tipo. */
export function agruparPorUfCidade(
  convenios: PrefConvenio[],
  filtros: { busca?: string; tipo?: string } = {}
) {
  const norm = (s: string | null | undefined) =>
    (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const q = norm(filtros.busca || '').trim();
  const tFilter = filtros.tipo || '';

  const filtrados = convenios.filter((c) => {
    if (tFilter && c.tipo !== tFilter) return false;
    if (!q) return true;
    return (
      norm(c.nome).includes(q) ||
      norm(c.municipio).includes(q) ||
      norm(c.sheet_origem).includes(q) ||
      norm(c.uf).includes(q)
    );
  });

  type Cidade = { municipio: string; convenios: PrefConvenio[] };
  type UfGrupo = {
    uf: string;
    estado_nome: string | null;
    cidades: Map<string, Cidade>;
    total: number;
  };

  const ufs = new Map<string, UfGrupo>();
  for (const c of filtrados) {
    const uf = c.uf || 'OUTROS';
    let g = ufs.get(uf);
    if (!g) {
      g = { uf, estado_nome: c.estado_nome, cidades: new Map(), total: 0 };
      ufs.set(uf, g);
    }
    const muni = c.municipio || '(sem cidade)';
    let cid = g.cidades.get(muni);
    if (!cid) {
      cid = { municipio: muni, convenios: [] };
      g.cidades.set(muni, cid);
    }
    cid.convenios.push(c);
    g.total++;
  }

  return Array.from(ufs.values()).sort((a, b) =>
    (a.uf || 'ZZ').localeCompare(b.uf || 'ZZ')
  );
}
