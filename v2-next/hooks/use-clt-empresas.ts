'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export interface BancoAprovacao {
  banco: string;
  primeira_aprovacao_em?: string;
  ultima_aprovacao_em?: string;
  total_aprovacoes?: number;
}

export interface EmpresaAprovada {
  cnpj: string;
  empregador_nome?: string | null;
  bancos_aprovam: BancoAprovacao[];
  total_aprovacoes: number;
  total_consultas: number;
  primeira_aprovacao_em?: string | null;
  ultima_aprovacao_em?: string | null;
  cnae?: string | null;
  cidade_empresa?: string | null;
  uf?: string | null;
  cpfs_no_caged?: number;
}

export interface ListarFiltros {
  busca?: string;
  banco?: string;
  uf?: string;
  orderBy?: 'total_aprovacoes' | 'ultima_aprovacao_em' | 'empregador_nome';
  limit?: number;
  offset?: number;
}

interface ListarResponse {
  success: boolean;
  total: number;
  empresas: EmpresaAprovada[];
  error?: string;
}

export function useEmpresasAprovadas(filtros: ListarFiltros = {}) {
  return useQuery({
    queryKey: ['clt', 'empresas-aprovadas', filtros],
    queryFn: async () => {
      const r = await api<ListarResponse>('/api/clt-empresas-aprovadas', {
        action: 'listar',
        ...filtros,
      });
      if (!r.success) throw new Error(r.error || 'Falha ao carregar empresas');
      return r;
    },
    staleTime: 60 * 1000,
  });
}

interface CpfsDessaEmpresaResponse {
  success: boolean;
  cnpj: string;
  total: number;
  cpfs: Array<{
    cpf: string;
    nome?: string;
    sexo?: string;
    data_nascimento?: string;
    ddd?: string;
    telefone?: string;
    email?: string;
    data_admissao?: string;
    cbo?: string;
    cidade?: string;
    uf?: string;
    ativo?: boolean;
  }>;
  error?: string;
}

export function useCpfsDessaEmpresa(cnpj: string | null, opts: { apenasAtivos?: boolean; limit?: number } = {}) {
  return useQuery({
    queryKey: ['clt', 'empresas-aprovadas', 'cpfs', cnpj, opts],
    queryFn: async () => {
      if (!cnpj) throw new Error('cnpj obrigatorio');
      const r = await api<CpfsDessaEmpresaResponse>('/api/clt-empresas-aprovadas', {
        action: 'cpfsDessaEmpresa',
        cnpj,
        apenasAtivos: opts.apenasAtivos ?? true,
        limit: opts.limit ?? 5000,
      });
      if (!r.success) throw new Error(r.error || 'Falha ao buscar CPFs');
      return r;
    },
    enabled: !!cnpj,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Higieniza em lote uma lista de CPFs (manda 1 por 1 pra clt-fila).
 * Throttle a cada 20 pra não saturar o backend.
 */
export function useHigienizarLote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cpfs: Array<{ cpf: string; nome?: string; ddd?: string; telefone?: string }>) => {
      let enviados = 0, erros = 0;
      for (const c of cpfs) {
        try {
          const r = await api<{ success: boolean }>('/api/clt-fila', {
            action: 'criar',
            cpf: c.cpf,
            nome: c.nome,
            telefone: c.ddd && c.telefone ? c.ddd + c.telefone : undefined,
            origem: 'lote',
          });
          if (r.success) enviados++; else erros++;
        } catch {
          erros++;
        }
        if (enviados % 20 === 0) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }
      return { enviados, erros };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['clt', 'recentes'] });
      toast.success(`✅ ${r.enviados} CPFs enviados pra higienização. ❌ ${r.erros} falhas.`);
    },
    onError: (e: Error) => {
      toast.error(`Erro: ${e.message}`);
    },
  });
}
