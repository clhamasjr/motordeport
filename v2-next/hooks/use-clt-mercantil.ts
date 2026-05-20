'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

interface SolicitarSmsParams {
  filaId?: string;
  operacaoId: string;
  telefone: string;   // pode vir com 55, com DDD, com mascara — normalizamos aqui
  nomeCliente?: string;
}

/**
 * Solicita SMS de autorização do Mercantil pro cliente.
 * O cliente recebe SMS com link bml.b.br pra autorizar consulta DataPrev.
 * Depois precisamos chamar useMercantilVerificar pra checar se autorizou.
 */
export function useMercantilSolicitarSMS() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: SolicitarSmsParams) => {
      if (!params.operacaoId) {
        throw new Error('Sem operacaoId — refaça a consulta CLT pra Mercantil retornar o ID');
      }
      const tel = String(params.telefone || '').replace(/\D/g, '');
      if (tel.length < 10) {
        throw new Error('Telefone inválido — use DDD + número (ex: 15998583505)');
      }
      // Remove o prefixo 55 se vier com country code
      const semCountry = tel.startsWith('55') && tel.length >= 12 ? tel.substring(2) : tel;
      const ddd = parseInt(semCountry.substring(0, 2), 10);
      const numeroCelular = parseInt(semCountry.substring(2), 10);
      if (!ddd || !numeroCelular) {
        throw new Error('Não consegui extrair DDD e número do telefone');
      }
      const r = await api<{ success: boolean; smsEnviado?: boolean; error?: string; mensagem?: string }>(
        '/api/mercantil',
        {
          action: 'solicitarAutorizacao',
          propostaProspectId: params.operacaoId,
          ddd,
          numeroCelular,
        },
      );
      if (!r.success) {
        throw new Error(r.error || r.mensagem || 'Falha ao disparar SMS');
      }
      return { ...r, ddd, numeroCelular, filaId: params.filaId };
    },
    onSuccess: (r) => {
      toast.success(`✅ SMS enviado pra (${r.ddd}) ${r.numeroCelular}. Cliente recebe link bml.b.br pra autorizar.`);
      if (r.filaId) qc.invalidateQueries({ queryKey: ['clt', 'fila', r.filaId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

interface VerificarParams {
  cpf: string;
  filaId?: string;
}

/**
 * Verifica se o cliente já autorizou o Mercantil via SMS.
 * Se autorizou, re-dispara processarMercantil pra carregar a oferta real.
 */
export function useMercantilVerificarAutorizacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: VerificarParams) => {
      const r = await api<{
        success: boolean;
        autorizado?: boolean;
        operacaoId?: string;
        nomeCliente?: string;
        mensagem?: string;
        error?: string;
      }>('/api/mercantil', { action: 'verificarAutorizacao', cpf: params.cpf });
      if (r.error) throw new Error(r.error);
      // Se autorizou, re-dispara processar Mercantil pra liberar simulação
      if (r.autorizado && params.filaId) {
        await api('/api/clt-fila', {
          action: 'processar',
          id: params.filaId,
          banco: 'mercantil',
          force: true,
        }).catch(() => {});
      }
      return { ...r, filaId: params.filaId };
    },
    onSuccess: (r) => {
      if (r.autorizado) {
        toast.success('✅ Cliente autorizou! Re-consultando Mercantil pra liberar oferta...');
      } else {
        toast.info('⏳ Cliente ainda não autorizou. Peça pra ele clicar no link do SMS e tente em ~1 min.');
      }
      if (r.filaId) qc.invalidateQueries({ queryKey: ['clt', 'fila', r.filaId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
