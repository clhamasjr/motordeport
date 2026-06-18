'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

// ──────────────────────────────────────────────────────────────────
// Sofia / Evolution — config WhatsApp
// Backend: /api/agent
// ──────────────────────────────────────────────────────────────────

export interface EvoStatusResponse {
  agentActive?: boolean;
  claude?: string;
  evolution?: string;
  model?: string;
  version?: string;
  activeConversations?: number;
  error?: string;
}

export interface EvoDiagResponse {
  success: boolean;
  instance?: string;
  diag?: {
    connectionState?: unknown;
    webhook?: unknown;
    chatwoot?: unknown;
    settings?: unknown;
  };
  error?: string;
}

export function useEvoStatus() {
  return useQuery({
    queryKey: ['inss-evolution', 'status'],
    queryFn: async () => {
      const r = await api<EvoStatusResponse>('/api/agent', { action: 'test' });
      return r;
    },
    staleTime: 30_000,
  });
}

export function useEvoDiag() {
  return useMutation({
    mutationFn: async (instance: string) => {
      const r = await api<EvoDiagResponse>('/api/agent', { action: 'evoDiag', instance });
      if (!r.success) throw new Error(r.error || 'Erro');
      return r;
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useResetWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (instance: string) => {
      const r = await api<{ success: boolean; log?: unknown[]; final?: unknown; error?: string }>(
        '/api/agent',
        { action: 'resetWebhook', instance },
      );
      if (!r.success) throw new Error(r.error || 'Erro');
      return r;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inss-evolution'] });
      toast.success('Webhook resetado + Chatwoot desligado');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useStressTest() {
  return useMutation({
    mutationFn: async (persona: 'qualificado' | 'indeciso' | 'confuso' | 'agressivo') => {
      const r = await api<{ ok: boolean; persona?: string; turnos?: number; log?: unknown[]; error?: string }>(
        '/api/agent',
        { action: 'stressTest', persona },
      );
      if (!r.ok) throw new Error(r.error || 'Erro');
      return r;
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useIdleFollowup() {
  return useMutation({
    mutationFn: async () => {
      const r = await api<{ ok: boolean; processed?: number; sent?: number; results?: unknown[]; error?: string }>(
        '/api/agent',
        { action: 'idleFollowup', horas: 4, max: 20 },
      );
      if (!r.ok) throw new Error(r.error || 'Erro');
      return r;
    },
    onSuccess: (r) => {
      const sent = (r.results as { ok?: boolean }[])?.filter((x) => x.ok).length || 0;
      toast.success(`Follow-up: ${sent} enviado(s)`);
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

// ──────────────────────────────────────────────────────────────────
// Conectar meu WhatsApp (vendedor cria/pareia a própria instância)
// ──────────────────────────────────────────────────────────────────

export interface QrResponse {
  success?: boolean;
  qrcode?: string | null;      // data:image/png;base64,... ou base64 puro
  instance?: unknown;
  error?: string;
  state?: string;
}

/**
 * Cria/pareia a instância do vendedor JÁ deixando o webhook apontado pra Sofia
 * (cria → connect → webhook /api/agent → desliga Chatwoot). Retorna QR + estado.
 * É a ação "criar, conectar e vender" num passo só.
 */
export function useConnectMyWhatsapp() {
  return useMutation({
    mutationFn: async (instance: string) => {
      const r = await api<QrResponse>('/api/agent', { action: 'connectMyWhatsapp', instance });
      return r;
    },
    onError: (err: Error) => toast.error(err.message || 'Erro ao conectar WhatsApp'),
  });
}

/** Estado da conexão da instância (open = conectado). */
export function useInstanceStatus(instance: string | null, ativo: boolean) {
  return useQuery({
    queryKey: ['inss-evolution', 'instance-status', instance],
    queryFn: async () => {
      const r = await api<{ instance?: { state?: string }; state?: string }>(
        '/api/evolution', { action: 'status', instance },
      );
      return (r?.instance?.state || r?.state || 'unknown') as string;
    },
    enabled: !!instance && ativo,
    refetchInterval: ativo ? 3000 : false,
  });
}

/** Salva a instância no PRÓPRIO usuário (bank_codes.WPP). */
export function useSaveMyWhatsapp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (instance: string) => {
      const r = await api<{ ok: boolean; instance?: string; error?: string }>(
        '/api/auth', { action: 'set_my_whatsapp', instance },
      );
      if (!r.ok) throw new Error(r.error || 'Erro ao salvar');
      return r;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

// ──────────────────────────────────────────────────────────────────
// Knowledge base
// ──────────────────────────────────────────────────────────────────
export interface KnowledgeItem {
  id: number;
  categoria: string;
  topico: string;
  conteudo: string;
  prioridade?: number;
  ativo?: boolean;
}

export function useListKnowledge() {
  return useQuery({
    queryKey: ['sofia-knowledge'],
    queryFn: async () => {
      const r = await api<{ ok: boolean; knowledge?: KnowledgeItem[]; error?: string }>(
        '/api/agent', { action: 'listKnowledge' },
      );
      if (!r.ok) throw new Error(r.error || 'Erro');
      return r.knowledge || [];
    },
    staleTime: 60_000,
  });
}

export function useAddKnowledge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (k: Omit<KnowledgeItem, 'id'>) => {
      const r = await api<{ ok: boolean; error?: string }>('/api/agent', { action: 'addKnowledge', ...k });
      if (!r.ok) throw new Error(r.error || 'Erro');
      return r;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sofia-knowledge'] });
      toast.success('Afirmação adicionada');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useUpdateKnowledge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (k: Partial<KnowledgeItem> & { id: number }) => {
      const r = await api<{ ok: boolean; error?: string }>('/api/agent', { action: 'updateKnowledge', ...k });
      if (!r.ok) throw new Error(r.error || 'Erro');
      return r;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sofia-knowledge'] });
      toast.success('Atualizado');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
