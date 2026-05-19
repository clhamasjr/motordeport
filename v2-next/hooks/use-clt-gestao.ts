'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface CltDashboardUser {
  id: number;
  user: string;
  name: string;
  role: string;
  online: boolean;
  sessions: number;
  lastIp: string;
  propostas: number;
  propostasValor: number;
  consultasHoje: number;
}

export interface CltDashboardConsulta {
  id: string;
  cpf: string;
  nome_manual: string | null;
  status_geral: string;
  iniciado_em: string;
  concluido_em: string | null;
  criada_por_user_id: number | null;
  criada_por_nome: string | null;
  userName?: string;
}

export interface CltDashboardConversa {
  id: number;
  telefone: string;
  nome: string | null;
  etapa: string | null;
  pausada_por_humano: boolean;
  banco_escolhido: string | null;
  last_message_at: string | null;
  created_at: string;
}

export interface CltDashboardResp {
  ok: boolean;
  users?: CltDashboardUser[];
  onlineCount?: number;
  consultas?: {
    totalRecentes: number;
    hoje: number;
    emAndamento: number;
    recentes: CltDashboardConsulta[];
  };
  propostas?: {
    total: number;
    totalValor: number;
    perStatus: Record<string, number>;
  };
  conversas?: {
    total: number;
    abertas: number;
    pausadas: number;
    recentes: CltDashboardConversa[];
  };
  error?: string;
}

/**
 * Dashboard CLT — espelha o do INSS mas usa tabelas do CLT
 * (clt_consultas_fila, clt_propostas, clt_conversas).
 * Refresca a cada 60s. Restrito a admin/gestor no backend.
 */
export function useCltGestaoDashboard() {
  return useQuery({
    queryKey: ['clt-gestao', 'dashboard'],
    queryFn: async () => {
      const r = await api<CltDashboardResp>('/api/gestao', { action: 'dashboardClt' });
      if (!r.ok) throw new Error(r.error || 'Erro');
      return r;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: (failureCount, err: any) => {
      const status = err?.status;
      if (status && status >= 400 && status < 500) return false;
      return failureCount < 1;
    },
  });
}
