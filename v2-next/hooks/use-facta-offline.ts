'use client';

// ════════════════════════════════════════════════════════════════════
// Hooks do FUNIL FACTA CLT OFFLINE (base cltoff, sem SMS).
// Backend: api/facta-offline-lote.js (criar / status / listar / dispararAutorizacao).
//   1) criar lote de CPFs → worker serial (3s/CPF) classifica em baldes.
//   2) status: contagem por balde (com_margem / sem_margem / sem_historico / erro).
//   3) só pros COM MARGEM → dispararAutorizacao (SMS via FACTA online).
// ════════════════════════════════════════════════════════════════════

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export interface LoteOfflineStatus {
  success: boolean;
  lote: string;
  total: number;
  pendentes: number;
  processando: number;
  concluidos: number;
  baldes: { com_margem: number; sem_margem: number; sem_historico: number; erro: number };
  progresso: string;
  rekick?: boolean;
}

export interface LinhaOffline {
  id: string;
  cpf: string;
  nome: string | null;
  temTelefone: boolean;
  margem: number | null;
  empregador: string | null;
  atualizadoNaFacta: string | null;
  mensagem: string | null;
}

// ── CRIAR LOTE ──────────────────────────────────────────────────
export function useCriarLoteOffline() {
  return useMutation({
    mutationFn: (cpfs: string[]) =>
      api<{ success: boolean; lote: string; loteId: string; total: number; invalidos: number; estimativa: string }>(
        '/api/facta-offline-lote', { action: 'criar', cpfs }),
    onSuccess: (r) => toast.success(`Lote criado: ${r.total} CPFs · ${r.estimativa}`),
    onError: (e: Error) => toast.error('Erro ao criar lote: ' + e.message),
  });
}

// ── STATUS (poll enquanto tem pendente/processando) ─────────────
export function useStatusLoteOffline(lote: string | null) {
  return useQuery({
    queryKey: ['facta-offline-status', lote],
    enabled: !!lote,
    refetchInterval: (q) => {
      const d = q.state.data as LoteOfflineStatus | undefined;
      if (!d) return 4000;
      return (d.pendentes > 0 || d.processando > 0) ? 4000 : false; // para quando drenou
    },
    queryFn: () => api<LoteOfflineStatus>('/api/facta-offline-lote', { action: 'status', lote }),
  });
}

// ── LISTAR um balde (com_margem por padrão) ─────────────────────
export function useListarBaldeOffline() {
  return useMutation({
    mutationFn: (p: { lote: string; bucket?: string; limit?: number; offset?: number }) =>
      api<{ success: boolean; rows: LinhaOffline[]; count: number; bucket: string }>(
        '/api/facta-offline-lote', { action: 'listar', bucket: 'com_margem', ...p }),
    onError: (e: Error) => toast.error('Erro ao listar: ' + e.message),
  });
}

// ── DISPARAR AUTORIZAÇÃO (SMS) pros com margem (1 lote de `max`) ─
export function useDispararAutorizacaoOffline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { lote: string; max?: number }) =>
      api<{ success: boolean; disparados: number; semTelefone: number; restantes: number | null }>(
        '/api/facta-offline-lote', { action: 'dispararAutorizacao', lote: p.lote, max: p.max || 8 }),
    onSuccess: (r) => {
      toast.success(
        `SMS disparados: ${r.disparados}` +
        (r.semTelefone ? ` · ${r.semTelefone} sem telefone` : '') +
        (r.restantes != null ? ` · faltam ${r.restantes}` : ''),
      );
      qc.invalidateQueries({ queryKey: ['facta-offline-status'] });
    },
    onError: (e: Error) => toast.error('Erro ao disparar SMS: ' + e.message),
  });
}
