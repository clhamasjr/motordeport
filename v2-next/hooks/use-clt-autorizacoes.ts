'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export interface CltAutorizacao {
  id: string;
  banco: string;
  cpf: string;
  nome?: string | null;
  telefone?: string | null;
  status: 'pending' | 'authorized' | 'denied' | 'expired' | string;
  link_selfie?: string | null;
  gerado_em?: string | null;
  data_expiracao?: string | null;
  enviado_wpp_em?: string | null;
  ultima_verificacao?: string | null;
}

export interface CltAutzFiltros {
  banco?: string;
  status?: string;
}

interface ListarResp {
  success?: boolean;
  autorizacoes?: CltAutorizacao[];
  error?: string;
}

/**
 * Lista autorizacoes LGPD (selfies C6/Mercantil/etc) com filtros opcionais.
 * Refresca a cada 60s pra refletir mudancas de status sem precisar F5.
 */
export function useCltAutorizacoes(filtros: CltAutzFiltros = {}) {
  return useQuery({
    queryKey: ['clt', 'autorizacoes', filtros],
    queryFn: async () => {
      const r = await api<ListarResp>('/api/clt-autorizacoes', {
        action: 'listar',
        ...filtros,
      });
      return r.autorizacoes || [];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: (failureCount, err: any) => {
      const status = err?.status;
      if (status && status >= 400 && status < 500) return false;
      return failureCount < 1;
    },
  });
}

/**
 * Marca que o link de selfie foi (re)enviado por WhatsApp e abre o wa.me
 * com a mensagem pronta numa aba nova — espelha cltReenviarAutz do V1.
 */
export function useReenviarAutzWpp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: string; link: string; telefone: string; banco: string }) => {
      if (!params.link || !params.telefone) {
        throw new Error('Link ou telefone faltando');
      }
      const msg = encodeURIComponent(
        `Pra prosseguir com sua oferta de crédito CLT (${params.banco.toUpperCase()}), faça uma selfie rápida aqui: ${params.link}`,
      );
      const tel = String(params.telefone).replace(/\D/g, '');
      window.open(`https://wa.me/55${tel}?text=${msg}`, '_blank', 'noopener,noreferrer');
      // Marca no backend que foi reenviado (incrementa contador / atualiza
      // enviado_wpp_em). Falha silenciosa nao quebra UX.
      await api('/api/clt-autorizacoes', { action: 'marcarEnvioWpp', id: params.id }).catch(() => {});
      return true;
    },
    onSuccess: () => {
      toast.success('WhatsApp aberto. Encaminhe pro cliente!');
      qc.invalidateQueries({ queryKey: ['clt', 'autorizacoes'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * Forca sync com o banco emissor (C6/Mercantil) pra atualizar o status
 * da autorizacao do CPF. Util quando cliente diz que ja fez a selfie mas
 * status ainda nao mudou.
 */
export function useSyncAutz() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { cpf: string; banco: string }) => {
      const r = await api<{ success?: boolean; statusAutorizacao?: string; error?: string }>(
        '/api/clt-autorizacoes',
        { action: 'verificar', cpf: params.cpf, banco: params.banco, sync: true },
      );
      if (r.error) throw new Error(r.error);
      return r;
    },
    onSuccess: (r) => {
      const novo = r.statusAutorizacao || 'OK';
      toast.success(`Status atualizado: ${novo}`);
      qc.invalidateQueries({ queryKey: ['clt', 'autorizacoes'] });
    },
    onError: (e: Error) => toast.error('Falha ao sincronizar: ' + e.message),
  });
}
