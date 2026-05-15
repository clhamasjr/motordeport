'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export interface ConversaIA {
  id: string;
  telefone: string;
  nome?: string;
  cpf?: string;
  etapa?: string;
  banco_escolhido?: string;
  consentimento_lgpd?: boolean;
  pausada_por_humano?: boolean;
  ativo?: boolean;
  last_message_at?: string;
  historico?: Array<{ role: 'user' | 'assistant'; content: string; ts: string }>;
  ofertas?: Array<{ banco: string; valor_liquido?: number; parcelas?: number; valor_parcela?: number }>;
}

interface ConversasResponse {
  success: boolean;
  conversas: ConversaIA[];
  total: number;
}

interface ConversaResponse {
  success: boolean;
  conversa: ConversaIA;
}

export function useConversasAtivas() {
  return useQuery({
    queryKey: ['clt', 'conversas', 'ativas'],
    queryFn: async () => {
      const r = await api<ConversasResponse>('/api/agente-clt', { action: 'conversasAtivas' });
      return r.conversas || [];
    },
    refetchInterval: 30 * 1000, // refresh a cada 30s pra novas conversas
    staleTime: 10 * 1000,
  });
}

export function useConversa(telefone: string | null) {
  return useQuery({
    queryKey: ['clt', 'conversas', telefone],
    queryFn: async () => {
      if (!telefone) throw new Error('telefone obrigatorio');
      const r = await api<ConversaResponse>('/api/agente-clt', { action: 'getConversa', telefone });
      return r.conversa;
    },
    enabled: !!telefone,
    staleTime: 5 * 1000,
  });
}

export function useRetomarConversa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (telefone: string) => {
      const r = await api<{ success: boolean; retomada: boolean }>('/api/agente-clt', {
        action: 'retomarConversa', telefone,
      });
      if (!r.success) throw new Error('Não retomou');
      return r;
    },
    onSuccess: (_, tel) => {
      toast.success('Agente IA retomou a conversa');
      qc.invalidateQueries({ queryKey: ['clt', 'conversas'] });
      qc.invalidateQueries({ queryKey: ['clt', 'conversas', tel] });
    },
    onError: (e: Error) => toast.error('Erro: ' + e.message),
  });
}
