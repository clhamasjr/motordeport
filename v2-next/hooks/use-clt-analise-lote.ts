'use client';

import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export interface CpfCagedInfo {
  cpf: string;
  nome?: string;
  data_nascimento?: string;
  sexo?: string;
  empregador_cnpj?: string;
  empregador_nome?: string;
  cbo?: string;
  cidade?: string;
  uf?: string;
  ddd?: string;
  telefone?: string;
  email?: string;
  ativo?: boolean;
  encontrado?: boolean;
}

interface BulkLookupResponse {
  success: boolean;
  encontrados: CpfCagedInfo[];
  nao_encontrados: string[];
  error?: string;
}

/**
 * Busca em lote no CAGED: dado lista de CPFs, retorna dados cadastrais
 * + vínculo de cada um. CPFs sem registro no CAGED voltam em nao_encontrados.
 *
 * Usa filtro 'cpfs' (in.()) do endpoint — 1 request pra até 500 CPFs.
 * Pra mais que isso, batcheia em chunks de 500.
 */
export function useBulkLookupCAGED() {
  return useMutation({
    mutationFn: async (cpfs: string[]) => {
      const cpfsLimpos = cpfs
        .map(c => c.replace(/\D/g, '').padStart(11, '0').slice(-11))
        .filter(c => c.length === 11);
      if (!cpfsLimpos.length) throw new Error('Nenhum CPF válido');

      const encontrados: CpfCagedInfo[] = [];
      const idsBuscados = new Set(cpfsLimpos);
      const CHUNK = 500;
      for (let i = 0; i < cpfsLimpos.length; i += CHUNK) {
        const batch = cpfsLimpos.slice(i, i + CHUNK);
        const r = await api<{ success: boolean; cpfs: CpfCagedInfo[] }>('/api/clt-caged-extrair', {
          action: 'listar',
          cpfs: batch,
          limit: CHUNK,
        });
        for (const c of r.cpfs || []) {
          encontrados.push({ ...c, encontrado: true });
        }
      }

      const idsEncontrados = new Set(encontrados.map(c => c.cpf));
      const naoEncontrados = Array.from(idsBuscados).filter(cpf => !idsEncontrados.has(cpf));

      return {
        success: true,
        encontrados,
        nao_encontrados: naoEncontrados,
      } as BulkLookupResponse;
    },
    onError: (e: Error) => toast.error('Erro: ' + e.message),
  });
}

/**
 * Higieniza lote escolhendo bancos específicos (ou todos se vazio).
 * Cria 1 fila por CPF, com filtro de bancos no body.
 */
export function useHigienizarLoteComBancos() {
  return useMutation({
    mutationFn: async (params: {
      cpfs: Array<{ cpf: string; nome?: string; ddd?: string; telefone?: string }>;
      bancos?: string[]; // se vazio, dispara todos
    }) => {
      let enviados = 0, erros = 0;
      for (const c of params.cpfs) {
        try {
          const body: Record<string, unknown> = {
            action: 'criar',
            cpf: c.cpf,
            nome: c.nome,
            telefone: c.ddd && c.telefone ? c.ddd + c.telefone : undefined,
            origem: 'lote',
          };
          if (params.bancos && params.bancos.length > 0) body.bancos = params.bancos;
          const r = await api<{ success: boolean }>('/api/clt-fila', body);
          if (r.success) enviados++; else erros++;
        } catch { erros++; }
        if (enviados % 20 === 0) await new Promise(r => setTimeout(r, 300));
      }
      return { enviados, erros };
    },
    onSuccess: (r) => toast.success(`✅ ${r.enviados} CPFs enviados. ❌ ${r.erros} falhas.`),
    onError: (e: Error) => toast.error('Erro: ' + e.message),
  });
}
