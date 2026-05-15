'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export interface DigitacaoPayload {
  banco: string;
  cliente: {
    cpf: string;
    nome: string;
    telefone?: string;
    ddd?: string;
    dataNascimento: string;
    sexo?: 'M' | 'F';
    nomeMae?: string;
    email?: string;
  };
  endereco?: {
    cep?: string;
    logradouro?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    cidade?: string;
    uf?: string;
  };
  bancario?: {
    numeroBanco?: string;
    numeroAgencia?: string;
    digitoAgencia?: string;
    numeroConta?: string;
    digitoConta?: string;
    tipoConta?: string;
    formaCredito?: string;
    chavePix?: string;
    pixKeyType?: string;
  };
  empregador?: {
    cnpj?: string;
    nome?: string;
    matricula?: string;
    valorRenda?: number | string;
  };
  proposta?: {
    idSimulacao?: string;
    simulationId?: string;
    type?: string | number;
    tabelaId?: string | number;
    quantidadeParcelas?: number;
    valorParcela?: number;
    provider?: string;
    workerId?: string | number;
    valorLiquido?: number;
    parcelas?: number;
  };
  origem?: string;
}

export interface DigitacaoResult {
  success?: boolean;
  ok?: boolean;
  propostaNumero?: string;
  propostaId?: string;
  operationId?: string;
  linkFormalizacao?: string;
  formalizationUrl?: string;
  url?: string;
  link?: string;
  error?: string;
  erro?: string;
  portalUrl?: string;
  mensagem?: string;
  _raw?: unknown;
}

export function useDigitarCLT() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: DigitacaoPayload) => {
      const r = await api<DigitacaoResult>('/api/clt-digitacao', {
        action: 'digitar',
        ...payload,
      });
      return r;
    },
    onSuccess: (r) => {
      const link = r.linkFormalizacao || r.formalizationUrl || r.url || r.link;
      if (link || r.propostaNumero || r.propostaId || r.operationId) {
        toast.success('✅ Proposta criada com sucesso!');
        qc.invalidateQueries({ queryKey: ['clt', 'esteira'] });
      } else if (r.portalUrl) {
        toast.info('Banco em modo manual — finalize no portal');
      } else {
        toast.error(r.error || r.erro || r.mensagem || 'Falha na digitação');
      }
    },
    onError: (e: Error) => toast.error('Erro: ' + e.message),
  });
}
