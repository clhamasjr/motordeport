// ════════════════════════════════════════════════════════════════════
// lib/orquestrador-types.ts
//
// Tipos do painel /orquestrador — visão macro do FlowForce (V1).
// Consumido por:
//   - hooks/use-orquestrador-saude.ts
//   - app/(app)/orquestrador/page.tsx
// ════════════════════════════════════════════════════════════════════

export type StatusBanco = 'ok' | 'erro' | 'verificando';

export type Vertical = 'INSS' | 'CLT' | 'compartilhado';

/** Resultado do healthcheck de UM banco/integração. */
export interface BancoSaude {
  /** Identificador do endpoint sem `/api/` (ex: 'c6', 'facta'). */
  key: string;
  /** Nome amigável pra exibir no card. */
  label: string;
  /** Vertical principal (INSS, CLT, ou compartilhado entre os dois). */
  vertical: Vertical;
  status: StatusBanco;
  /** Mensagem curta quando deu erro (pra tooltip/debug). */
  erroMsg?: string;
  /** Latência em ms (quando ok). */
  latenciaMs?: number;
}

/** Resultado do healthcheck dos agentes IA (Sofia, agente-clt). */
export interface AgenteSaude {
  key: 'sofia' | 'agente-clt';
  label: string;
  status: StatusBanco;
  /** Conversas ativas reportadas pelo agente (quando disponível). */
  conversasAtivas?: number;
  erroMsg?: string;
}

/** Status agregado de um módulo do FlowForce (INSS, CLT, etc.). */
export interface ModuloStatus {
  key: string;
  label: string;
  icone: string; // nome do ícone lucide
  totalTelas: number;
  /** Status macro do módulo. */
  status: 'operando' | 'migracao' | 'parcial';
  /** Texto curto explicando o estado. */
  resumo?: string;
}

/** Payload completo retornado pelo hook use-orquestrador-saude. */
export interface SaudeSaaS {
  bancos: BancoSaude[];
  agentes: AgenteSaude[];
  /** Contagem agregada de conversas ativas (Sofia + agente-clt). */
  conversasAtivas: number;
  /** Sessões logadas no momento. null se a chamada falhou. */
  sessoesAtivas: number | null;
  /** Timestamp ISO do último refresh. */
  atualizadoEm: string;
}
