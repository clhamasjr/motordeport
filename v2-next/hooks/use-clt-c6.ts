'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

interface GerarSelfieParams {
  cpf: string;
  nome: string;
  dataNascimento: string;
  telefone?: string;
  filaId?: string; // pra invalidar status depois
}

interface GerarSelfieResponse {
  success: boolean;
  link?: string;
  dataExpiracao?: string;
  mensagemParaCliente?: string;
  erro?: string;
  error?: string;
}

/**
 * Gera link de selfie/liveness do C6 para o cliente autorizar a consulta.
 * Espelha o fluxo V1: cltGerarSelfieC6 → POST /api/clt-autorizacoes action=gerar.
 *
 * Quando bem-sucedido:
 *  - Copia o link pra clipboard
 *  - Abre WhatsApp em nova aba (se houver telefone) com a mensagem pronta
 *  - Toast confirmando
 */
export function useGerarLinkSelfieC6() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: GerarSelfieParams) => {
      if (!params.nome || !params.dataNascimento) {
        throw new Error('Pra gerar link de selfie preciso de nome E data de nascimento. Preencha o nome na consulta e tente de novo.');
      }
      const r = await api<GerarSelfieResponse>('/api/clt-autorizacoes', {
        action: 'gerar',
        banco: 'c6',
        cpf: params.cpf,
        nome: params.nome,
        dataNascimento: params.dataNascimento,
        telefone: params.telefone || '',
      });
      if (!r.success || !r.link) {
        throw new Error(r.erro || r.error || 'Não retornou link');
      }
      return { ...r, telefone: params.telefone, filaId: params.filaId };
    },
    onSuccess: async (data) => {
      // 1) Copia pro clipboard
      try {
        await navigator.clipboard.writeText(data.link!);
      } catch { /* alguns browsers bloqueiam fora de gesto direto */ }

      // 2) Abre WhatsApp com mensagem pronta (se tiver telefone)
      const tel = (data.telefone || '').replace(/\D/g, '');
      const msgCliente = data.mensagemParaCliente || `Pra prosseguir com sua oferta de crédito CLT, faça uma selfie rápida aqui: ${data.link}`;
      if (tel && tel.length >= 10) {
        const url = `https://wa.me/55${tel}?text=${encodeURIComponent(msgCliente)}`;
        window.open(url, '_blank', 'noopener,noreferrer');
        toast.success('Link gerado, copiado e WhatsApp aberto. Mande pro cliente!');
      } else {
        toast.success('Link gerado e copiado. Cole no WhatsApp do cliente — sem telefone cadastrado.');
      }

      // 3) Invalida o status da fila (C6 vai pra AGUARDANDO_AUTORIZACAO no backend)
      if (data.filaId) {
        qc.invalidateQueries({ queryKey: ['clt', 'fila', data.filaId] });
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

/**
 * Re-consulta forçando incluir C6 — chamado após cliente fazer a selfie
 * pra puxar o resultado real do banco.
 */
export function useRecarregarC6() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { cpf: string; filaId?: string }) => {
      const r = await api<{ success: boolean; id?: string; error?: string }>('/api/clt-fila', {
        action: 'criar',
        cpf: params.cpf,
        incluirC6: true,
        origem: 'unitaria',
      });
      if (!r.success) throw new Error(r.error || 'Falha ao reconsultar');
      return { novaFilaId: r.id, filaIdAntigo: params.filaId };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['clt', 'recentes'] });
      if (r.filaIdAntigo) qc.invalidateQueries({ queryKey: ['clt', 'fila', r.filaIdAntigo] });
      if (r.novaFilaId) qc.invalidateQueries({ queryKey: ['clt', 'fila', r.novaFilaId] });
      toast.success('Reconsulta disparada — aguarde resposta do C6.');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
