'use client';

import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  ConsultaInssView,
  CompStatus,
  EnquadramentoResultado,
  InssConsultaResponse,
  InssParsedResult,
} from '@/lib/inss-types';
import { toast } from 'sonner';

// ── Parser numérico universal: aceita number JS, string pt-BR ou string sem formatação ──
function parseBR(v: unknown): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v).trim();
  if (!s) return 0;
  if (s.indexOf(',') >= 0) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
  const dots = (s.match(/\./g) || []).length;
  if (dots > 1) return parseFloat(s.replace(/\./g, '')) || 0;
  return parseFloat(s) || 0;
}

// ── Calcula enquadramento na regra HOJE: emp ≤ 35% + RMC ≤ 5% + RCC ≤ 5% = ≤ 45% ──
export function calcEnquadramento(parsed: InssParsedResult): EnquadramentoResultado | null {
  const ben = parsed.beneficio || {};
  const mrg = parsed.margem || {};
  const baseCalc = parseBR(ben.base_calculo);
  const valor = parseBR(ben.valor);
  const benef = baseCalc > 0 ? baseCalc : valor;
  if (!benef) return null;

  const sumEmp = parseBR(mrg.parcelas);
  const mrgRmcLivre = parseBR(mrg.rmc);
  const mrgRccLivre = parseBR(mrg.rcc);
  const tetoCartao = benef * 0.05;
  // RMC/RCC comprometido = teto - margem livre (quando há cartão)
  const cartoes = parsed.cartoes || [];
  const temRmc =
    (mrg.rmc != null && mrgRmcLivre < tetoCartao - 0.01) ||
    cartoes.some((c) => (c.tipo || '').toUpperCase().includes('RMC'));
  const temRcc =
    (mrg.rcc != null && mrgRccLivre < tetoCartao - 0.01) ||
    cartoes.some((c) => (c.tipo || '').toUpperCase().includes('RCC'));
  const sumRmc = temRmc ? Math.max(0, tetoCartao - mrgRmcLivre) : 0;
  const sumRcc = temRcc ? Math.max(0, tetoCartao - mrgRccLivre) : 0;

  const total = sumEmp + sumRmc + sumRcc;
  const teto45 = benef * 0.45;
  const excedente = Math.max(0, total - teto45);
  const compPct = (total / benef) * 100;
  let compStatus: CompStatus = total <= teto45 ? 'dentro_regra' : 'fora_regra_resolvivel';
  // Se extrapolou, vou marcar como "resolvivel" — o motor V1 já filtra na esteira.
  // Aqui só sinaliza "dentro vs fora"; resolvibilidade fica em outro hook.
  if (total > teto45 + 0.01) compStatus = 'fora_regra_resolvivel';

  return {
    compPct: Math.round(compPct * 10) / 10,
    compStatus,
    excedente: Math.round(excedente * 100) / 100,
    total: Math.round(total * 100) / 100,
    benef: Math.round(benef * 100) / 100,
    teto45: Math.round(teto45 * 100) / 100,
    sumEmp: Math.round(sumEmp * 100) / 100,
    sumRmc: Math.round(sumRmc * 100) / 100,
    sumRcc: Math.round(sumRcc * 100) / 100,
  };
}

// ── Mutation: consulta CPF no Multicorban (V1 endpoint) ──
export function useConsultaInss() {
  return useMutation({
    mutationFn: async (cpf: string): Promise<ConsultaInssView> => {
      const clean = cpf.replace(/\D/g, '');
      if (clean.length !== 11) throw new Error('CPF deve ter 11 dígitos');
      const r = await api<InssConsultaResponse>('/api/multicorban', {
        action: 'consult_cpf',
        cpf: clean,
      });
      if (!r.ok || !r.parsed) {
        throw new Error(r.error || 'CPF não encontrado');
      }
      return {
        parsed: r.parsed,
        enquadramento: calcEnquadramento(r.parsed),
        lista: r.lista,
        auto_selected: r.auto_selected,
      };
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Erro ao consultar CPF');
    },
  });
}

// ── Mutation: consulta beneficio especifico (quando o cliente tem múltiplos) ──
export function useConsultaBeneficio() {
  return useMutation({
    mutationFn: async (beneficio: string): Promise<ConsultaInssView> => {
      const clean = beneficio.replace(/\D/g, '');
      if (!clean) throw new Error('Benefício obrigatório');
      const r = await api<InssConsultaResponse>('/api/multicorban', {
        action: 'consult_beneficio',
        beneficio: clean,
      });
      if (!r.ok || !r.parsed) {
        throw new Error(r.error || 'Benefício não encontrado');
      }
      return {
        parsed: r.parsed,
        enquadramento: calcEnquadramento(r.parsed),
      };
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Erro ao consultar benefício');
    },
  });
}
