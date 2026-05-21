'use client';

import { create } from 'zustand';
import { BaseProcessada } from '@/lib/inss-base-parser';

// ──────────────────────────────────────────────────────────────────
// Store da base INSS carregada (RAM apenas — não persiste).
// V1: armazenava em window.S.data; aqui usamos zustand pra estado global.
// ──────────────────────────────────────────────────────────────────

interface InssBaseStore {
  base: BaseProcessada | null;
  loadedFiles: string[];     // histórico simples (nomes de arquivos carregados nesta sessão)
  selectedCpfs: Set<string>; // seleção pro carrinho
  setBase: (b: BaseProcessada | null) => void;
  reset: () => void;
  toggleSelected: (cpf: string) => void;
  selectAll: (cpfs: string[]) => void;
  clearSelection: () => void;
  /** Importa telefones via mapeamento CPF → [t1, t2, t3]. Atualiza todos os
   *  contratos da base com mesma CPF (vários contratos por CPF compartilham telefone). */
  importTelefones: (mapa: Record<string, { t1?: string; t2?: string; t3?: string }>) => number;
}

export const useInssBaseStore = create<InssBaseStore>((set) => ({
  base: null,
  loadedFiles: [],
  selectedCpfs: new Set<string>(),
  setBase: (b) =>
    set((s) => ({
      base: b,
      loadedFiles: b ? [...s.loadedFiles, b.fname || '(sem nome)'].slice(-5) : s.loadedFiles,
      selectedCpfs: new Set<string>(), // limpa seleção ao trocar base
    })),
  reset: () =>
    set({ base: null, selectedCpfs: new Set<string>() }),
  toggleSelected: (cpf) =>
    set((s) => {
      const next = new Set(s.selectedCpfs);
      if (next.has(cpf)) next.delete(cpf);
      else next.add(cpf);
      return { selectedCpfs: next };
    }),
  selectAll: (cpfs) => set({ selectedCpfs: new Set(cpfs) }),
  clearSelection: () => set({ selectedCpfs: new Set<string>() }),
  importTelefones: (mapa) => {
    let atualizados = 0;
    const cpfsNormalizados: Record<string, { t1?: string; t2?: string; t3?: string }> = {};
    for (const [cpf, tels] of Object.entries(mapa)) {
      const clean = String(cpf).replace(/\D/g, '');
      if (clean) cpfsNormalizados[clean] = tels;
    }
    set((s) => {
      if (!s.base) return s;
      const novoAnalise = s.base.analise.map((r) => {
        const tels = cpfsNormalizados[r.cpf.replace(/\D/g, '')];
        if (!tels) return r;
        atualizados++;
        return { ...r, t1: tels.t1 || r.t1, t2: tels.t2 || r.t2, t3: tels.t3 || r.t3 };
      });
      const novoElegiveis = s.base.elegiveis.map((r) => {
        const tels = cpfsNormalizados[r.cpf.replace(/\D/g, '')];
        if (!tels) return r;
        return { ...r, t1: tels.t1 || r.t1, t2: tels.t2 || r.t2, t3: tels.t3 || r.t3 };
      });
      const novoRmc = s.base.rmcRcc.map((r) => {
        const tels = cpfsNormalizados[r.cpf.replace(/\D/g, '')];
        if (!tels) return r;
        return { ...r, t1: tels.t1 || r.t1, t2: tels.t2 || r.t2, t3: tels.t3 || r.t3 };
      });
      return { base: { ...s.base, analise: novoAnalise, elegiveis: novoElegiveis, rmcRcc: novoRmc } };
    });
    return atualizados;
  },
}));
