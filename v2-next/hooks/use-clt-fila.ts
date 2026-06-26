'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  CriarConsultaParams,
  CriarConsultaResponse,
  FilaConsulta,
  StatusFilaResponse,
} from '@/lib/clt-types';
import { toast } from 'sonner';

/**
 * Cria nova consulta CLT na fila.
 * On success: invalida lista de recentes pra aparecer.
 */
export function useCriarConsultaCLT() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: CriarConsultaParams) => {
      const body: Record<string, unknown> = {
        action: 'criar',
        cpf: params.cpf,
        incluirC6: params.incluirC6 !== false,
      };
      if (params.nome) body.nome = params.nome;
      if (params.dataNascimento) body.dataNascimento = params.dataNascimento;
      if (params.sexo) body.sexo = params.sexo;
      if (params.telefone) body.telefone = params.telefone;
      if (params.origem) body.origem = params.origem;
      return api<CriarConsultaResponse>('/api/clt-fila', body);
    },
    onSuccess: (data) => {
      if (data.success && data.id) {
        qc.invalidateQueries({ queryKey: ['clt', 'recentes'] });
        toast.success('Consulta iniciada — aguardando bancos...');
      } else {
        toast.error(data.error || 'Falha ao criar consulta');
      }
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Erro ao criar consulta');
    },
  });
}

/**
 * Status de UMA consulta com polling INTELIGENTE:
 * - Se status_geral === 'concluido': sem refetch automático (cache 30min)
 * - Se ainda 'processando': refetch a cada 2s
 * - Para automaticamente quando concluir
 *
 * No futuro, substituído por Supabase Realtime (subscribe na tabela
 * clt_consultas_fila filtrando por id) — sem necessidade de polling.
 */
// UUID v4 + permite outros formatos longos. Bloqueia "", "undefined", "null",
// numeros, etc — que viravam request com `id` ruim e voltavam 400 do backend
const ID_VALIDO_RE = /^[0-9a-fA-F-]{8,}$/;

export function useFilaStatus(filaId: string | null, pool = false) {
  const idValido = !!filaId && typeof filaId === 'string' && ID_VALIDO_RE.test(filaId);
  return useQuery({
    queryKey: ['clt', 'fila', filaId, pool ? 'pool' : 'own'],
    queryFn: async (): Promise<FilaConsulta> => {
      if (!filaId) throw new Error('filaId obrigatorio');
      const r = await api<StatusFilaResponse>('/api/clt-fila', {
        action: 'status',
        id: filaId,
        ...(pool ? { pool: true } : {}),
      });
      if (!r.success || !r.fila) throw new Error(r.error || 'Fila não encontrada');
      return r.fila;
    },
    enabled: idValido,
    // CRITICO: nao retentar erros 4xx (ex: ID antigo no localStorage que retorna 404).
    // Sem isso, RQ tenta 3x cada poll, gerando dezenas de requests 400/404 no console.
    retry: (failureCount, err: any) => {
      const status = err?.status || err?.data?.status;
      // 4xx = erro de cliente (id invalido), nao retenta
      if (status && status >= 400 && status < 500) return false;
      return failureCount < 2;
    },
    refetchInterval: (query) => {
      // Se ja deu erro, PARA de pollar (senao bate 400/404 a cada 2s pra sempre)
      if (query.state.error) return false;
      const fila = query.state.data;
      if (!fila) return 1500;
      // 'standby' (agendada pra 26/06) e 'concluido' nao mudam — sem polling
      if (fila.status_geral === 'concluido' || fila.status_geral === 'standby') return false;
      return 2000;
    },
    refetchOnWindowFocus: false,
    staleTime: (query) => {
      const fila = query.state.data;
      return (fila?.status_geral === 'concluido' || fila?.status_geral === 'standby') ? 30 * 60 * 1000 : 1000;
    },
  });
}

/**
 * Lista de consultas recentes (últimas N do user/parceiro).
 *
 * ATENCAO ao backend (api/clt-fila.js):
 *  - action válidas: criar, processar, status, listar, complementarCliente
 *  - 'recentes' NÃO existe — bate 400 "Action invalida"
 * Por isso usamos 'listar' (igual o V1 faz em _carregarRecentesDoBanco).
 *
 * Resposta vem em `items[]` com { id, cpf, status_geral, iniciado_em,
 * nome_manual, cliente: {nome}, criada_por_nome, ... }
 */
interface ListarItem {
  id: string;
  cpf: string;
  nome_manual?: string | null;
  cliente?: { nome?: string } | null;
  status_geral: string;
  iniciado_em: string;
  criada_por_nome?: string | null;
  criada_por_user_id?: number | null;
}
interface ListarResponse {
  success: boolean;
  items?: ListarItem[];
  error?: string;
}

export interface ConsultaRecente {
  id: string;
  cpf: string;
  nome: string;
  status_geral: string;
  iniciado_em: string;
  criada_por_nome?: string;
  criada_por_user_id?: number | null;
}

/**
 * Pré-check do CPF: verifica se as bases (clt_clientes + CAGED) já têm
 * nome + data de nascimento + telefone. A tela de consulta usa isso pra
 * decidir se segue direto ou obriga o operador a digitar os dados.
 */
export interface PrecheckResult {
  success: boolean;
  completo: boolean;
  temNome: boolean;
  temDataNascimento: boolean;
  temTelefone: boolean;
  faltam: string[];
  dados: {
    nome: string | null;
    dataNascimento: string | null;
    sexo: 'M' | 'F' | null;
    telefone: string | null;
  };
  error?: string;
}
/**
 * Pipeline de clientes APTOS — quem ficou com margem disponível em >=1
 * banco. Lista trabalhável pós-consulta. Mesmo isolamento (vendedor vê
 * os seus, admin vê todos). Ordenado por maior margem.
 */
export type CategoriaCliente = 'apto' | 'sem_margem' | 'aguardando' | 'sem_dados' | 'inapto' | 'standby' | 'processando';
export interface ClientePipeline {
  id: string;
  cpf: string;
  nome: string;
  telefone: string | null;
  empregador: string | null;
  empregadorCnpj: string | null;
  categoria: CategoriaCliente;
  melhorBanco: string | null;
  melhorMargem: number;
  totalBancosAptos: number;
  bancosAptos: { banco: string; margem: number }[];
  aguardandoBancos: string[];
  precisaSelfieC6: boolean;
  vendedor: string;
  iniciado_em: string;
}
interface PipelineResponse {
  success: boolean;
  total: number;
  contadores: Partial<Record<CategoriaCliente, number>>;
  somaMargem: number;
  clientes: ClientePipeline[];
}
export function useCltPipeline() {
  return useQuery({
    queryKey: ['clt', 'pipeline'],
    queryFn: async (): Promise<PipelineResponse> => {
      return api<PipelineResponse>('/api/clt-fila', { action: 'pipeline' });
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function usePrecheckCpf() {
  return useMutation({
    mutationFn: async (cpf: string): Promise<PrecheckResult> => {
      return api<PrecheckResult>('/api/clt-fila', { action: 'precheck', cpf });
    },
  });
}

/**
 * Re-dispara processamento de UM banco em uma consulta existente.
 * Backend `clt-fila.js action='processar'` aceita `force: true` que bypass
 * o guard de idempotencia — sem isso, ele recusa re-rodar bancos em estado
 * final ('falha', 'ok', etc) com `skipped`.
 *
 * Uso: card de banco em status='falha' → botao "Re-tentar".
 *
 * Apos sucesso, invalida o cache do status da fila pra UI puxar o estado novo
 * (banco volta a aparecer como 'processando' e segue o polling normal).
 */
interface ReprocessarParams {
  filaId: string;
  banco: string; // BancoSlug
}
interface ReprocessarResponse {
  success: boolean;
  banco?: string;
  id?: string;
  skipped?: string;
  error?: string;
}
export function useReprocessarBanco() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: ReprocessarParams) => {
      return api<ReprocessarResponse>('/api/clt-fila', {
        action: 'processar',
        id: params.filaId,
        banco: params.banco,
        force: true,
      });
    },
    onSuccess: (data, vars) => {
      if (data.success) {
        // Invalida o status da fila pra UI puxar o novo estado (processando)
        qc.invalidateQueries({ queryKey: ['clt', 'fila', vars.filaId] });
        toast.success(`Re-disparado: ${vars.banco}`);
      } else {
        toast.error(data.error || 'Falha ao re-disparar banco');
      }
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Erro ao re-disparar banco');
    },
  });
}

export function useConsultasRecentes(limit = 20) {
  return useQuery({
    queryKey: ['clt', 'recentes', limit],
    queryFn: async (): Promise<ConsultaRecente[]> => {
      const r = await api<ListarResponse>('/api/clt-fila', {
        action: 'listar',
        limit,
      });
      if (!r.success) throw new Error(r.error || 'Falha ao listar');
      return (r.items || []).map((it) => ({
        id: it.id,
        cpf: it.cpf,
        nome: it.cliente?.nome || it.nome_manual || '',
        status_geral: it.status_geral,
        iniciado_em: it.iniciado_em,
        criada_por_nome: it.criada_por_nome || undefined,
        criada_por_user_id: it.criada_por_user_id ?? null,
      }));
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
    retry: (failureCount, err: any) => {
      const status = err?.status;
      if (status && status >= 400 && status < 500) return false;
      return failureCount < 1;
    },
  });
}
