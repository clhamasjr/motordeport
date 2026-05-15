'use client';

import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface AnaliseFiltros {
  idade?: number;
  dataNascimento?: string;
  margem?: number;
  valor?: number;
  prazo?: number;
  tempo_admissao_meses?: number;
  operacao?: 'novo' | 'refin' | 'port' | 'cartao';
}

export interface BancoAtende {
  banco_slug: string;
  banco_nome: string;
  banco_id: number;
  vinculo_id: number;
  api_status: string;
  exige_selfie: boolean;
  exige_termo: boolean;
  documentos: string[];
  regras: {
    idade_min?: number; idade_max?: number;
    margem_minima?: number;
    valor_minimo?: number; valor_maximo?: number;
    prazo_min?: number; prazo_max?: number;
    tempo_admissao_min_meses?: number;
  };
}

export interface BancoNaoAtende {
  banco_slug: string;
  banco_nome: string;
  motivo: string;
  regras?: unknown;
}

interface AnaliseResponse {
  success: boolean;
  total_bancos: number;
  atendem_count: number;
  nao_atendem_count: number;
  atendem: BancoAtende[];
  nao_atendem: BancoNaoAtende[];
  error?: string;
}

export function useAnalisarCltCliente() {
  return useMutation({
    mutationFn: async (filtros: AnaliseFiltros) => {
      const r = await api<AnaliseResponse>('/api/clt-bancos', {
        action: 'analisar', operacao: 'novo', ...filtros,
      });
      if (!r.success) throw new Error(r.error || 'Erro na análise');
      return r;
    },
  });
}
