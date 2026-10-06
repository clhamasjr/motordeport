// ════════════════════════════════════════════════════════════════════
// hooks/use-crefisa-fila.ts — Fila (buffer) de digitação Crefisa
//
// A Crefisa tem UMA sessão (um login por vez). Consulta e simulação rodam
// direto; a DIGITAÇÃO entra nesta fila no servidor e um worker processa
// uma de cada vez. Cada vendedor vê o que é dele; gestor vê a loja toda.
// ════════════════════════════════════════════════════════════════════

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';

const FILA = '/api/crefisa-fila';

export type StatusFila = 'NA_FILA' | 'PROCESSANDO' | 'DIGITADA' | 'ERRO' | 'CANCELADA';

export interface ItemFilaServidor {
  id: string;
  cpf: string;
  nome_cliente: string | null;
  telefone: string | null;
  status: StatusFila;
  mensagem: string | null;
  vendedor_nome: string | null;
  user_id: number | null;
  parceiro_id: number | null;
  guid: string | null;
  criado_em: string;
  processado_em: string | null;
}

/** Escopo que o backend aplicou: o que este usuário enxerga. */
export type EscopoFila = 'tudo' | 'loja' | 'proprio';

export const STATUS_FILA_LABEL: Record<StatusFila, { label: string; variant: 'success' | 'warning' | 'destructive' | 'info' | 'muted' }> = {
  NA_FILA: { label: 'NA FILA', variant: 'warning' },
  PROCESSANDO: { label: 'DIGITANDO', variant: 'info' },
  DIGITADA: { label: 'DIGITADA', variant: 'success' },
  ERRO: { label: 'ERRO', variant: 'destructive' },
  CANCELADA: { label: 'CANCELADA', variant: 'muted' },
};

/**
 * Fila conforme o papel: vendedor vê a dele, gestor vê a loja, admin vê tudo.
 * Fica atualizando sozinha enquanto houver item em andamento.
 */
export function useFilaCrefisa() {
  return useQuery({
    queryKey: ['crefisa-fila', 'lista'],
    queryFn: async () => await api<{ success: boolean; escopo: EscopoFila; itens: ItemFilaServidor[] }>(FILA, { action: 'minhaFila' }),
    refetchInterval: (query) => {
      const itens = query.state.data?.itens || [];
      const emAndamento = itens.some((i) => i.status === 'NA_FILA' || i.status === 'PROCESSANDO');
      return emAndamento ? 10_000 : 60_000;
    },
  });
}

/** Contadores + se a janela da Crefisa (7h–23h) está aberta. */
export function useStatusFila() {
  return useQuery({
    queryKey: ['crefisa-fila', 'status'],
    queryFn: async () => await api<{ success: boolean; contadores: Record<string, number>; horarioAberto: boolean }>(FILA, { action: 'status' }),
    refetchInterval: 60_000,
  });
}

/** Joga uma proposta pronta na fila (o worker digita depois, em série). */
export function useEnfileirarDigitacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { cpf: string; telefone?: string; nomeCliente?: string; payload: Record<string, unknown> }) =>
      await api<{ success: boolean; id?: string; posicao?: number; jaNaFila?: boolean; mensagem: string }>(FILA, {
        action: 'enfileirar',
        ...p,
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crefisa-fila'] }); },
    onError: (err: Error) => toast.error(err.message || 'Erro ao enfileirar'),
  });
}

/** Cancela item que ainda não foi processado (dono, gestor da loja ou admin). */
export function useCancelarFila() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      await api<{ success: boolean; mensagem: string }>(FILA, { action: 'cancelar', id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crefisa-fila'] }); },
    onError: (err: Error) => toast.error(err.message || 'Erro ao cancelar'),
  });
}
