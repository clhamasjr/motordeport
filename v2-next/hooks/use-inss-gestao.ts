'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface DashboardUser {
  id: number;
  user: string;
  name: string;
  role: string;
  online: boolean;
  activeSessions: number;
  lastSession: string | null;
  ip: string | null;
  consultasHoje: number;
  digitacao: { total: number; pendente: number; enviada: number; aprovada: number; paga: number; valor: number };
}

interface DashboardConsulta {
  id: number;
  user_id: number;
  tipo: string;
  cpf: string;
  nome: string;
  fonte: string;
  created_at: string;
}

export interface DashboardResp {
  ok: boolean;
  users?: DashboardUser[];
  digitacao?: { totalValor: number; perStatus: Record<string, number> };
  consultas?: DashboardConsulta[];
  consultasHoje?: number;
  audit?: { id: number; user_id: number; action: string; details: unknown; created_at: string }[];
  chats?: { id: number; instance: string; name: string; phone: string; status: string; unread_count: number }[];
  error?: string;
}

export function useGestaoDashboard() {
  return useQuery({
    queryKey: ['inss-gestao', 'dashboard'],
    queryFn: async () => {
      const r = await api<DashboardResp>('/api/gestao', { action: 'dashboard' });
      if (!r.ok) throw new Error(r.error || 'Erro');
      return r;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
