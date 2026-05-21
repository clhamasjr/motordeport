'use client';

import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { AnaliseHoleriteResponse } from '@/lib/fed-types';

export interface AnalisePayload {
  /** Contracheque obrigatório */
  contracheque_file: File;
  /** Extrato de consignação opcional — habilita simulação de port contrato-a-contrato */
  extrato_file?: File | null;
  /** Slug do convênio forçado (opcional — se omitido a IA detecta) */
  convenio_slug?: string;
}

/**
 * Converte um File em base64 puro (sem o prefixo data:...;base64,)
 */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const b64 = dataUrl.split(',')[1] || '';
      resolve(b64);
    };
    reader.onerror = () => reject(new Error('Falha lendo arquivo'));
    reader.readAsDataURL(file);
  });
}

/**
 * Mutation que sobe contracheque (obrigatório) + extrato (opcional),
 * envia pro /api/fed action:analisarHolerite e retorna dados extraídos,
 * bancos atendem, e simulação de port com troco contrato-a-contrato.
 *
 * Backend tem timeout de 25s (Vercel Edge) — analise costuma levar 8-20s.
 */
export function useAnalisarFedContracheque() {
  return useMutation({
    mutationFn: async (p: AnalisePayload): Promise<AnaliseHoleriteResponse> => {
      if (!p.contracheque_file) {
        throw new Error('Arquivo do contracheque obrigatório');
      }
      const arquivo_base64 = await fileToBase64(p.contracheque_file);

      let extratoFields: Record<string, unknown> = {};
      if (p.extrato_file) {
        const extrato_base64 = await fileToBase64(p.extrato_file);
        extratoFields = {
          extrato_base64,
          extrato_nome: p.extrato_file.name,
          extrato_tipo: p.extrato_file.type || 'application/pdf',
        };
      }

      const r = await api<AnaliseHoleriteResponse>('/api/fed', {
        action: 'analisarHolerite',
        arquivo_base64,
        arquivo_nome: p.contracheque_file.name,
        arquivo_tipo: p.contracheque_file.type || 'application/pdf',
        ...extratoFields,
        ...(p.convenio_slug ? { convenio_slug: p.convenio_slug } : {}),
      });
      if (!r.ok) throw new Error(r.error || 'Falha na análise');
      return r;
    },
  });
}
