'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface PropostaEsteira {
  id: string;
  banco: string;
  proposta_id_externo?: string;
  cpf: string;
  nome?: string;
  telefone?: string;
  empregador_nome?: string;
  empregador_cnpj?: string;
  valor_liquido?: number;
  valor_parcela?: number;
  qtd_parcelas?: number;
  taxa_mensal?: number;
  status_externo?: string;
  status_interno?: string;
  link_formalizacao?: string;
  contract_number?: string;
  vendedor_nome?: string;
  parceiro_nome?: string;
  criada_por_user_id?: number;
  origem?: string;
  conversa_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface EsteiraFiltros {
  banco?: string;
  status_interno?: string;
  cpf?: string;
  user_id?: number;
  dataInicial?: string;
  dataFinal?: string;
}

interface ListResponse {
  success: boolean;
  propostas: PropostaEsteira[];
  total: number;
  error?: string;
}

interface ResumoResponse {
  success: boolean;
  resumo: Array<{
    banco: string;
    status_interno: string;
    total: number;
    valor_total?: number;
  }>;
  error?: string;
}

export function useEsteiraCLT(filtros: EsteiraFiltros = {}, limit = 100) {
  return useQuery({
    queryKey: ['clt', 'esteira', filtros, limit],
    queryFn: async () => {
      const r = await api<ListResponse>('/api/clt-esteira', {
        action: 'list', filters: filtros, limit,
      });
      if (!r.success) throw new Error(r.error || 'Falha ao carregar esteira');
      return r;
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });
}

export function useResumoEsteiraCLT() {
  return useQuery({
    queryKey: ['clt', 'esteira', 'resumo'],
    queryFn: async () => {
      const r = await api<ResumoResponse>('/api/clt-esteira', { action: 'resumo' });
      if (!r.success) throw new Error(r.error || 'Falha resumo');
      return r;
    },
    staleTime: 60 * 1000,
  });
}
