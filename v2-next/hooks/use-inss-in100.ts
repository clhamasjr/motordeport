'use client';

import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export interface In100Result {
  success: boolean;
  pending?: boolean;
  queryId?: string;
  cpf?: string;
  beneficio?: string;
  nome?: string | null;
  status?: string | null;
  benefitStatus?: string | null;
  elegivel?: boolean;
  bloqueado?: boolean;
  tipoBlock?: string | null;
  especie?: string | null;
  margemEmprestimo?: number;
  margemCartao?: number;
  limiteCartao?: number;
  limiteCartaoBeneficio?: number;
  saldoCartaoBeneficio?: number;
  maxSaldo?: number;
  saldoUsado?: number;
  saldoDisponivel?: number;
  contaBanco?: unknown;
  contratosAtivos?: number;
  contratosSuspensos?: number;
  portabilidades?: number;
  representanteLegal?: boolean;
  uf?: string | null;
  dataNascimento?: string | null;
  dataConcessao?: string | null;
  queryDate?: string | null;
  error?: string;
  message?: string;
  _raw?: unknown;
}

// Sleep helper
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/**
 * Erro estruturado de IN100 — preserva o detalhe que veio da Ajin pra UI mostrar.
 * Lance com `throw new In100Error({...})` em vez de `throw new Error(string)`.
 */
export class In100Error extends Error {
  step: 'cpf_invalido' | 'beneficio_invalido' | 'pending_timeout' | 'ajin' | 'desconhecido';
  httpStatus?: number;
  rawAjin?: unknown;
  queryId?: string;
  constructor(opts: {
    message: string;
    step?: In100Error['step'];
    httpStatus?: number;
    rawAjin?: unknown;
    queryId?: string;
  }) {
    super(opts.message);
    this.name = 'In100Error';
    this.step = opts.step || 'desconhecido';
    this.httpStatus = opts.httpStatus;
    this.rawAjin = opts.rawAjin;
    this.queryId = opts.queryId;
  }
}

export function useConsultarIN100() {
  return useMutation({
    mutationFn: async (params: { cpf: string; beneficio: string }) => {
      const cpf = params.cpf.replace(/\D/g, '');
      const beneficio = params.beneficio.replace(/\D/g, '');
      if (cpf.length !== 11) {
        throw new In100Error({ message: 'CPF inválido — precisa ter 11 dígitos', step: 'cpf_invalido' });
      }
      if (!beneficio) {
        throw new In100Error({ message: 'Número do benefício (NB) obrigatório', step: 'beneficio_invalido' });
      }

      // 1) Tenta consulta síncrona (com polling interno do backend até ~24s)
      const r = await api<In100Result>('/api/joinbank', { action: 'in100', cpf, beneficio });

      // 2) Se voltou pending+queryId (Ajin caiu em modo assíncrono), faz polling
      //    no frontend por mais ~60s (Vercel Edge tem timeout, então polling client-side)
      if (r.pending && r.queryId) {
        toast.info('Consulta DATAPREV em andamento, aguardando retorno...', { duration: 4000 });
        const maxTentativas = 30; // 30 x 2s = 60s
        for (let i = 0; i < maxTentativas; i++) {
          await sleep(2000);
          const p = await api<In100Result>('/api/joinbank', { action: 'in100Poll', queryId: r.queryId });
          if (p.success) return p;
          if (!p.pending) {
            throw new In100Error({
              message: p.error || p.message || 'Erro DATAPREV durante polling',
              step: 'ajin',
              rawAjin: p._raw || p,
              queryId: r.queryId,
            });
          }
        }
        throw new In100Error({
          message: 'Timeout: a DATAPREV demorou mais de 90s pra responder. Tente novamente em 1 minuto.',
          step: 'pending_timeout',
          queryId: r.queryId,
        });
      }

      if (!r.success) {
        throw new In100Error({
          message: r.error || r.message || 'Erro IN100 (sem detalhe da Ajin)',
          step: 'ajin',
          rawAjin: r._raw || r,
        });
      }
      return r;
    },
    onError: (err: Error) => {
      const detalhe = err instanceof In100Error
        ? `[${err.step}] ${err.message}`
        : err.message;
      toast.error(detalhe, { duration: 8000 });
    },
  });
}
