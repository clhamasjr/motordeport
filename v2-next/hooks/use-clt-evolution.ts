'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export interface EvoInstance {
  name: string;
  status: string;
  isOnline: boolean;
  numero: string;
  raw: any;
}

interface ListResp {
  instances?: EvoInstance[];
  data?: EvoInstance[];
  [key: string]: unknown;
}

/**
 * Normaliza a resposta /api/evolution action=list pra um shape estavel.
 * O Evolution às vezes devolve array, às vezes { instances: [...] }, às vezes
 * objetos com instance.instanceName, outros com .name. Resolvemos aqui.
 */
function normalizar(raw: unknown): EvoInstance[] {
  let arr: any[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (raw && typeof raw === 'object') {
    const r: any = raw;
    arr = r.instances || r.data || [];
  }
  return arr.map((i: any) => {
    const name = i.instance?.instanceName || i.instanceName || i.name || '';
    const status = i.instance?.status || i.connectionStatus || i.status || 'desconhecido';
    const isOnline = String(status).toLowerCase() === 'open' || String(status).toLowerCase() === 'connected';
    const numero = i.instance?.owner || i.owner || i.number || '-';
    return { name, status: String(status), isOnline, numero: String(numero), raw: i };
  });
}

/**
 * Lista instances Evolution filtrando só as do CLT (nome contem 'clt').
 * Evita misturar com instances do INSS / outros produtos.
 */
export function useInstancesCLT() {
  return useQuery({
    queryKey: ['clt', 'evolution', 'instances'],
    queryFn: async () => {
      const r = await api<ListResp>('/api/evolution', { action: 'list' });
      const todas = normalizar(r);
      return todas.filter((i) => i.name.toLowerCase().includes('clt'));
    },
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000, // refresca status sozinho
  });
}

interface ConnectResp {
  base64?: string;
  qr?: string;
  qrcode?: string;
  code?: string;
  [key: string]: unknown;
}

/**
 * Solicita QR Code pra conectar uma instance ao WhatsApp.
 * Retorna base64 do QR (pode vir em campos diferentes — normaliza aqui).
 */
export function useConectarInstanceCLT() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const r = await api<ConnectResp>('/api/evolution', {
        action: 'connect',
        instance: name,
      });
      const qr = r.base64 || r.qr || r.qrcode || r.code || null;
      if (!qr) throw new Error('Evolution nao retornou QR Code. Verifica se a instance existe.');
      return { qr, instance: name };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clt', 'evolution', 'instances'] }),
    onError: (e: Error) => toast.error('Erro: ' + e.message),
  });
}

interface CreateResp {
  qrcode?: string;
  base64?: string;
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}

/**
 * Cria nova instance Evolution. Nome PRECISA conter 'clt' pra aparecer
 * nessa tela (filtro do useInstancesCLT).
 */
export function useCriarInstanceCLT() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      if (!name || !name.toLowerCase().includes('clt')) {
        throw new Error('Nome precisa conter "clt" pra ficar nessa tela (ex: lhamas-clt-2)');
      }
      const r = await api<CreateResp>('/api/evolution', { action: 'create', name });
      const qr = r.qrcode || r.base64 || null;
      return { qr, instance: name };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clt', 'evolution', 'instances'] });
      toast.success('Instance criada — escaneie o QR pra conectar.');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * Reaponta a webhook do Evolution dessa instance pra Sofia (/api/agent),
 * espelhando o V1. Necessario pra IA receber as mensagens.
 */
export function useApontarWebhookSofia() {
  return useMutation({
    mutationFn: async (instance: string) => {
      const r = await api<{ success: boolean; error?: string }>('/api/evolution', {
        action: 'setWebhook',
        instance,
        url: window.location.origin + '/api/agent',
      });
      if (!r.success) throw new Error(r.error || 'Falha ao apontar webhook');
      return r;
    },
    onSuccess: () => toast.success('Webhook apontada pra Sofia ✅'),
    onError: (e: Error) => toast.error('Erro: ' + e.message),
  });
}

/**
 * Logout/desconecta uma instance (pra trocar chip ou corrigir conexao).
 */
export function useDesconectarInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (instance: string) => {
      const r = await api<{ success?: boolean; error?: string }>('/api/evolution', {
        action: 'logout',
        instance,
      });
      return r;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clt', 'evolution', 'instances'] });
      toast.success('Instance desconectada.');
    },
    onError: (e: Error) => toast.error('Erro: ' + e.message),
  });
}
