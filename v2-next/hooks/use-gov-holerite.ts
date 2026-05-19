'use client';

import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { AnalisarHoleriteRequest, AnalisarHoleriteResponse } from '@/lib/gov-types';

/**
 * Analise de holerite: sobe arquivo (PDF/imagem em base64) e Claude extrai
 * + cruza com a base de bancos do convenio.
 */
export function useAnalisarHolerite() {
  return useMutation({
    mutationFn: async (req: AnalisarHoleriteRequest) => {
      const r = await api<AnalisarHoleriteResponse>('/api/gov', {
        action: 'analisarHolerite',
        ...req,
      });
      if (!r.ok) throw new Error(r.error || 'Falha ao analisar');
      return r;
    },
  });
}

/**
 * Converte um File pra base64 puro (sem prefixo data:).
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const b64 = dataUrl.split(',')[1] || '';
      resolve(b64);
    };
    reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
    reader.readAsDataURL(file);
  });
}
