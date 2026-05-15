'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export interface CagedFiltros {
  uf?: string;
  cidade?: string;
  idade_min?: number;
  idade_max?: number;
  sexo?: 'M' | 'F';
  empregador_cnpj?: string;
  empregador_nome?: string;
  cbo?: string;
  cnae?: string;
  tempo_empresa_min_meses?: number;
  ativo?: boolean;
  tem_telefone?: boolean;
  tem_email?: boolean;
}

export interface CagedCpf {
  cpf: string;
  nome?: string;
  sexo?: string;
  data_nascimento?: string;
  empregador_cnpj?: string;
  empregador_nome?: string;
  cbo?: string;
  data_admissao?: string;
  ativo?: boolean;
  cidade?: string;
  uf?: string;
  ddd?: string;
  telefone?: string;
  email?: string;
}

interface ContarResponse {
  success: boolean;
  total: number | null;
  modo: 'estimado' | 'exato';
  error?: string;
}

interface ListarResponse {
  success: boolean;
  total_pagina: number;
  cpfs: CagedCpf[];
  error?: string;
}

interface ExportResponse {
  success: boolean;
  filename: string;
  total_linhas: number;
  csv: string;
  error?: string;
}

interface BatchResponse {
  success: boolean;
  total: number;
  cpfs: CagedCpf[];
  error?: string;
}

export function useCagedContar(filtros: CagedFiltros, exato = false) {
  return useQuery({
    queryKey: ['clt', 'caged', 'contar', filtros, exato],
    queryFn: async () => {
      const r = await api<ContarResponse>('/api/clt-caged-extrair', {
        action: 'contar', exato, ...filtros,
      });
      if (!r.success) throw new Error(r.error || 'Erro contagem');
      return r;
    },
    staleTime: 30 * 1000,
  });
}

export function useCagedListar() {
  return useMutation({
    mutationFn: async (filtros: CagedFiltros) => {
      const r = await api<ListarResponse>('/api/clt-caged-extrair', {
        action: 'listar', limit: 200, offset: 0, ...filtros,
      });
      if (!r.success) throw new Error(r.error || 'Erro listar');
      return r;
    },
  });
}

export function useCagedExportCsv() {
  return useMutation({
    mutationFn: async (filtros: CagedFiltros) => {
      const r = await api<ExportResponse>('/api/clt-caged-extrair', {
        action: 'exportarCsv', limit: 50000, ...filtros,
      });
      if (!r.success) throw new Error(r.error || 'Erro export');
      return r;
    },
    onSuccess: (r) => {
      const blob = new Blob([r.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = r.filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`✅ Download: ${r.total_linhas.toLocaleString('pt-BR')} CPFs`);
    },
    onError: (e: Error) => toast.error(`Erro: ${e.message}`),
  });
}

export function useCagedHigienizarLote() {
  return useMutation({
    mutationFn: async (params: { filtros: CagedFiltros; bancos?: string[] }) => {
      const r1 = await api<BatchResponse>('/api/clt-caged-extrair', {
        action: 'higienizarLote', limit: 1000, ...params.filtros,
      });
      if (!r1.success || !r1.cpfs?.length) throw new Error(r1.error || 'Sem CPFs');
      let enviados = 0, erros = 0;
      for (const c of r1.cpfs) {
        try {
          const body: Record<string, unknown> = {
            action: 'criar', cpf: c.cpf, nome: c.nome,
            telefone: c.ddd && c.telefone ? c.ddd + c.telefone : undefined,
            origem: 'lote',
          };
          if (params.bancos && params.bancos.length > 0) body.bancos = params.bancos;
          const rf = await api<{ success: boolean }>('/api/clt-fila', body);
          if (rf.success) enviados++; else erros++;
        } catch { erros++; }
        if (enviados % 20 === 0) await new Promise((r) => setTimeout(r, 300));
      }
      return { enviados, erros };
    },
    onSuccess: (r) => toast.success(`✅ ${r.enviados} CPFs enviados. ❌ ${r.erros} falhas.`),
    onError: (e: Error) => toast.error(`Erro: ${e.message}`),
  });
}
