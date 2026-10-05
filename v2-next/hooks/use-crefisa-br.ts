// ════════════════════════════════════════════════════════════════════
// hooks/use-crefisa-br.ts — Crefisa "Baixa Renda" (Bolsa Família)
//
// Backend: /api/crefisa-br (sessão colada do portal 2tech).
// O fluxo tem uma espera no meio: o cliente precisa autorizar o Open
// Finance antes do portal liberar o NIS. Por isso o status tem polling.
// ════════════════════════════════════════════════════════════════════

import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type {
  FluxoBR,
  RegrasBR,
  ResultadoSimulacaoBR,
  StatusOpenFinanceBR,
  StatusSessaoBR,
  EnderecoCep,
  DocumentoBR,
} from '@/lib/crefisa-br-types';

const CREFISA = '/api/crefisa-br';

function limpaCpf(cpf: string) {
  const c = (cpf || '').replace(/\D/g, '');
  if (c.length !== 11) throw new Error('CPF inválido — precisa ter 11 dígitos');
  return c;
}

/** Status da sessão colada do portal — mostra se o motor está operante. */
export function useCrefisaSessao() {
  return useQuery({
    queryKey: ['crefisa-br', 'sessao'],
    queryFn: async () => await api<StatusSessaoBR>(CREFISA, { action: 'statusPortalSession' }),
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

/** Cola a sessão capturada no portal (bearer + cookie). */
export function useCrefisaColarSessao() {
  return useMutation({
    mutationFn: async (payload: {
      bearer: string;
      cookie: string;
      versaoSistema?: string;
      cod?: string;
      vendedorId?: number;
      codigoParceiro?: string;
      codigoUsuarioParceiro?: string;
    }) => await api<{ success: boolean; mensagem: string }>(CREFISA, { action: 'setPortalSession', ...payload }),
    onError: (err: Error) => toast.error(err.message || 'Erro ao salvar a sessão'),
  });
}

/** Regras do convênio Baixa Renda (faixas de valor, parcela e prazo). */
export function useCrefisaRegras() {
  return useQuery({
    queryKey: ['crefisa-br', 'regras'],
    queryFn: async () => await api<RegrasBR & { success: boolean }>(CREFISA, { action: 'regras' }),
    staleTime: 60 * 60 * 1000,
  });
}

/**
 * Chamada principal: diz em que ponto o CPF está e qual o próximo passo.
 * Junta consulta do cliente + consulta do benefício numa coisa só.
 */
export function useCrefisaFluxo() {
  return useMutation({
    mutationFn: async (cpf: string) =>
      await api<FluxoBR>(CREFISA, { action: 'fluxo', cpf: limpaCpf(cpf) }),
    onError: (err: Error) => toast.error(err.message || 'Erro ao consultar na Crefisa'),
  });
}

/** Dispara o link de consentimento Open Finance pro cliente. */
export function useCrefisaEnviarOpenFinance() {
  return useMutation({
    mutationFn: async (p: { cpf: string; telefone?: string; codigoBanco?: number }) =>
      await api<{ success: boolean; mensagem: string; link?: string | null }>(CREFISA, {
        action: 'enviarLinkOpenFinance',
        cpf: limpaCpf(p.cpf),
        telefone: p.telefone || '',
        codigoBanco: p.codigoBanco ?? null,
      }),
    onError: (err: Error) => toast.error(err.message || 'Erro ao enviar o link de Open Finance'),
  });
}

/**
 * Acompanha o consentimento. O polling se desliga sozinho quando o
 * cliente compartilha — enquanto não, repete a cada 15s.
 */
export function useCrefisaStatusOpenFinance(cpf: string | null, ativo: boolean) {
  const c = (cpf || '').replace(/\D/g, '');
  return useQuery({
    queryKey: ['crefisa-br', 'openfinance', c],
    queryFn: async () => await api<StatusOpenFinanceBR>(CREFISA, { action: 'statusOpenFinance', cpf: c }),
    enabled: ativo && c.length === 11,
    refetchInterval: (query) => (query.state.data?.compartilhado ? false : 15_000),
  });
}

/** Simulação da operação (NOVO ou REFIN). */
export function useCrefisaSimular() {
  return useMutation({
    mutationFn: async (p: {
      cpf: string;
      tipoSimulacao: 1 | 2;
      valorTomador?: number | null;
      valorParcela?: number | null;
      dataPagamento?: number | string | null;
      digito?: string;
      ddd?: string;
      telefone?: string;
      quantidadeParcelas?: number | null;
    }) =>
      await api<ResultadoSimulacaoBR>(CREFISA, {
        action: 'simular',
        ...p,
        cpf: limpaCpf(p.cpf),
      }),
    onError: (err: Error) => toast.error(err.message || 'Erro ao simular'),
  });
}

/** Contratos refinanciáveis do cliente (pra operação REFIN). */
export function useCrefisaRefinanciaveis() {
  return useMutation({
    mutationFn: async (cpf: string) =>
      await api<{ success: boolean; contratos: Record<string, unknown>[] }>(CREFISA, {
        action: 'refinanciaveis',
        cpf: limpaCpf(cpf),
      }),
    onError: (err: Error) => toast.error(err.message || 'Erro ao buscar contratos refinanciáveis'),
  });
}

/** Busca endereço pelo CEP (usa a base do próprio portal). */
export function useCrefisaCep() {
  return useMutation({
    mutationFn: async (cep: string) =>
      await api<{ success: boolean; mensagem?: string; endereco: EnderecoCep | null }>(CREFISA, {
        action: 'buscarCep',
        cep: (cep || '').replace(/\D/g, ''),
      }),
  });
}

/** Sobe 1 documento (PDF em base64) pro storage da Crefisa. */
export function useCrefisaUploadDocumento() {
  return useMutation({
    mutationFn: async (p: { guid: string; tipo: string; base64: string }) =>
      await api<{ success: boolean; mensagem: string; documento?: DocumentoBR }>(CREFISA, {
        action: 'uploadDocumento',
        ...p,
      }),
  });
}

/** Envio final da proposta. */
export function useCrefisaDigitar() {
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      await api<{ etapa: string; success: boolean; mensagem: string; guid?: string; proposta?: unknown }>(CREFISA, {
        action: 'digitar',
        ...payload,
      }),
  });
}
