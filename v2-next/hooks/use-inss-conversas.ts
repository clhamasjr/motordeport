'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

// ──────────────────────────────────────────────────────────────────
// Sofia — Conversas WhatsApp (Evolution + Supabase inss_conversas)
// Backend: /api/inss-chat
// ──────────────────────────────────────────────────────────────────

export interface ConversaResumo {
  id?: string | number;
  telefone: string;
  instance?: string;
  nome?: string;
  cpf?: string;
  status: 'open' | 'pending' | 'resolved' | string;
  agente_ativo?: boolean;
  unread?: number;
  last_msg_at?: string;
  last_msg_preview?: string;
  last_msg_role?: 'cliente' | 'sofia' | 'me' | string;
  intencao?: string | null;
  sentimento?: string | null;
  lead_score?: number | null;
  tags?: string[];
  handoff_motivo?: string | null;
}

export interface MensagemHist {
  role: 'cliente' | 'sofia' | 'me' | string;
  content: string;
  ts: string;
  instance?: string;
  sender?: string;
  nome?: string;
  cpf?: string;
}

export interface ConversaFull {
  id?: string | number;
  telefone: string;
  instance?: string;
  nome?: string;
  cpf?: string;
  status?: string;
  agente_ativo?: boolean;
  unread_count?: number;
  historico?: MensagemHist[];
  last_msg_at?: string;
  tags?: string[];
  intencao?: string | null;
  sentimento?: string | null;
  lead_score?: number | null;
  handoff_motivo?: string | null;
}

export function useListConversas(filtros: { status?: string; instance?: string; scope?: string } = {}) {
  return useQuery({
    queryKey: ['inss-chat', 'list', filtros],
    queryFn: async () => {
      const r = await api<{ ok: boolean; conversas?: ConversaResumo[]; error?: string }>(
        '/api/inss-chat',
        { action: 'listConversas', ...filtros, limit: 200 },
      );
      if (!r.ok) throw new Error(r.error || 'Erro ao listar conversas');
      return r.conversas || [];
    },
    refetchInterval: 10_000,
    staleTime: 5000,
  });
}

export function useConversa(telefone: string | null) {
  return useQuery({
    queryKey: ['inss-chat', 'conversa', telefone],
    queryFn: async () => {
      if (!telefone) throw new Error('telefone obrigatorio');
      const r = await api<{ ok: boolean; conversa?: ConversaFull; error?: string }>(
        '/api/inss-chat',
        { action: 'getConversa', telefone },
      );
      if (!r.ok) throw new Error(r.error || 'Conversa não encontrada');
      return r.conversa as ConversaFull;
    },
    enabled: !!telefone,
    refetchInterval: 3000,
    staleTime: 1000,
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ telefone, content, instance }: { telefone: string; content: string; instance?: string }) => {
      const r = await api<{ ok: boolean; delivered?: boolean; error?: string }>(
        '/api/inss-chat',
        { action: 'sendMessage', telefone, content, instance },
      );
      if (!r.ok) throw new Error(r.error || 'Falha ao enviar');
      return r;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['inss-chat', 'conversa', vars.telefone] });
      qc.invalidateQueries({ queryKey: ['inss-chat', 'list'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useToggleAgente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ telefone, ativar }: { telefone: string; ativar: boolean }) => {
      const action = ativar ? 'retomarAgente' : 'pausarAgente';
      const r = await api<{ ok: boolean; agente_ativo?: boolean; error?: string }>(
        '/api/inss-chat',
        { action, telefone },
      );
      if (!r.ok) throw new Error(r.error || 'Falha ao trocar agente');
      return r;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['inss-chat', 'conversa', vars.telefone] });
      qc.invalidateQueries({ queryKey: ['inss-chat', 'list'] });
      toast.success(vars.ativar ? '🤖 Sofia retomou' : '👤 Você assumiu');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useSetStatusConversa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ telefone, status }: { telefone: string; status: string }) => {
      const r = await api<{ ok: boolean; error?: string }>(
        '/api/inss-chat',
        { action: 'setStatus', telefone, status },
      );
      if (!r.ok) throw new Error(r.error || 'Falha ao trocar status');
      return r;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['inss-chat', 'conversa', vars.telefone] });
      qc.invalidateQueries({ queryKey: ['inss-chat', 'list'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useCreateConversa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ telefone, nome, instance }: { telefone: string; nome?: string; instance?: string }) => {
      const r = await api<{ ok: boolean; conversa?: ConversaFull; error?: string }>(
        '/api/inss-chat',
        { action: 'createConversa', telefone, nome, instance },
      );
      if (!r.ok) throw new Error(r.error || 'Falha ao criar');
      return r.conversa as ConversaFull;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inss-chat', 'list'] });
      toast.success('Conversa criada');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
