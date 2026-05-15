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
}));
