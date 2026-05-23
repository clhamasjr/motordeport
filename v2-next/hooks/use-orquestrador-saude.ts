// ════════════════════════════════════════════════════════════════════
// hooks/use-orquestrador-saude.ts
//
// Healthcheck paralelo de todos os bancos + agentes do FlowForce.
// Bate em /api/[banco] {action: 'test'} em paralelo via Promise.allSettled.
// Refetch automático a cada 60s.
//
// Fonte canônica dos endpoints: GESTAO.md §6.1
// ════════════════════════════════════════════════════════════════════

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  BancoSaude,
  AgenteSaude,
  SaudeSaaS,
  Vertical,
} from '@/lib/orquestrador-types';

// ── Catálogo de bancos/integrações pra healthcheck ────────────────────
// Cada entrada vira 1 call paralelo. Se algum banco tiver action diferente
// de 'test', ajusta aqui (ex: handbank usa 'status').
interface BancoCfg {
  key: string;
  label: string;
  vertical: Vertical;
  action: string;
}

const BANCOS: BancoCfg[] = [
  // INSS
  { key: 'multicorban', label: 'Multicorban', vertical: 'INSS', action: 'test' },
  { key: 'facta', label: 'FACTA', vertical: 'INSS', action: 'test' },
  { key: 'daycoval', label: 'Daycoval', vertical: 'INSS', action: 'test' },
  { key: 'finanto', label: 'FINANTO', vertical: 'INSS', action: 'test' },
  // CLT
  { key: 'c6', label: 'C6 Bank', vertical: 'CLT', action: 'test' },
  { key: 'presencabank', label: 'PresençaBank', vertical: 'CLT', action: 'test' },
  { key: 'v8', label: 'V8 Sistema', vertical: 'CLT', action: 'test' },
  { key: 'handbank', label: 'Handbank (UY3)', vertical: 'CLT', action: 'status' },
  { key: 'mercantil', label: 'Mercantil', vertical: 'CLT', action: 'test' },
  // Compartilhado entre INSS e CLT
  { key: 'joinbank', label: 'JoinBank/Quali', vertical: 'compartilhado', action: 'test' },
];

interface AgenteCfg {
  key: 'sofia' | 'agente-clt';
  label: string;
  endpoint: string;
}

const AGENTES: AgenteCfg[] = [
  { key: 'sofia', label: 'Sofia (INSS)', endpoint: '/api/agent' },
  { key: 'agente-clt', label: 'Agente CLT', endpoint: '/api/agente-clt' },
];

// ── Helpers ───────────────────────────────────────────────────────────

async function pingBanco(b: BancoCfg): Promise<BancoSaude> {
  const t0 = performance.now();
  try {
    const data = await api<Record<string, unknown>>(`/api/${b.key}`, { action: b.action });
    const lat = Math.round(performance.now() - t0);
    // Heurística: considera ok se a resposta não tem error/success=false.
    // Muitos endpoints retornam {success:true} ou {ok:true}.
    const d = data as { error?: string; success?: boolean; ok?: boolean };
    const negou = d?.error || d?.success === false || d?.ok === false;
    if (negou) {
      return {
        key: b.key, label: b.label, vertical: b.vertical,
        status: 'erro', erroMsg: String(d.error || 'banco respondeu falha'),
        latenciaMs: lat,
      };
    }
    return {
      key: b.key, label: b.label, vertical: b.vertical,
      status: 'ok', latenciaMs: lat,
    };
  } catch (e) {
    return {
      key: b.key, label: b.label, vertical: b.vertical,
      status: 'erro',
      erroMsg: e instanceof Error ? e.message : String(e),
    };
  }
}

async function pingAgente(a: AgenteCfg): Promise<AgenteSaude> {
  try {
    const data = await api<Record<string, unknown>>(a.endpoint, { action: 'test' });
    const d = data as { agentActive?: boolean; activeConversations?: number; claude?: string; evolution?: string };
    // Sofia retorna {agentActive, activeConversations, claude, evolution}
    // agente-clt retorna {claude, supabase, evolution, ...}
    const claudeOk = !d?.claude || /ok|ativo/i.test(String(d.claude));
    const evoOk = !d?.evolution || /ok|ativo/i.test(String(d.evolution));
    const ok = d?.agentActive !== false && claudeOk && evoOk;
    return {
      key: a.key, label: a.label,
      status: ok ? 'ok' : 'erro',
      conversasAtivas: typeof d?.activeConversations === 'number' ? d.activeConversations : undefined,
      erroMsg: ok ? undefined : `claude=${d?.claude} evolution=${d?.evolution}`,
    };
  } catch (e) {
    return {
      key: a.key, label: a.label,
      status: 'erro',
      erroMsg: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── Hook principal ────────────────────────────────────────────────────

async function fetchSessoes(): Promise<number | null> {
  try {
    const data = await api<{ ok: boolean; count?: number }>('/api/auth', { action: 'sessoesAtivas' });
    if (data?.ok && typeof data.count === 'number') return data.count;
    return null;
  } catch {
    return null;
  }
}

async function fetchSaude(): Promise<SaudeSaaS> {
  const [bancosRes, agentesRes, sessoesRes] = await Promise.all([
    Promise.all(BANCOS.map((b) => pingBanco(b))),
    Promise.all(AGENTES.map((a) => pingAgente(a))),
    fetchSessoes(),
  ]);

  const conversasAtivas = agentesRes.reduce(
    (acc, ag) => acc + (ag.conversasAtivas || 0),
    0,
  );

  return {
    bancos: bancosRes,
    agentes: agentesRes,
    conversasAtivas,
    sessoesAtivas: sessoesRes,
    atualizadoEm: new Date().toISOString(),
  };
}

export function useOrquestradorSaude() {
  return useQuery({
    queryKey: ['orquestrador', 'saude'],
    queryFn: fetchSaude,
    refetchInterval: 60_000, // 60s
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}
