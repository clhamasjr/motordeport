import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { BancoSaude, AgenteSaude, SaudeSaaS, Vertical } from '@/lib/orquestrador-types';

interface BancoCfg {
  key: string;
  label: string;
  vertical: Vertical;
  action: string;
}

const BANCOS: BancoCfg[] = [
  { key: 'multicorban', label: 'Multicorban', vertical: 'INSS', action: 'test' },
  { key: 'facta', label: 'FACTA', vertical: 'INSS', action: 'test' },
  { key: 'daycoval', label: 'Daycoval', vertical: 'INSS', action: 'test' },
  { key: 'finanto', label: 'FINANTO', vertical: 'INSS', action: 'test' },
  { key: 'c6', label: 'C6 Bank', vertical: 'CLT', action: 'test' },
  { key: 'presencabank', label: 'PresençaBank', vertical: 'CLT', action: 'test' },
  { key: 'v8', label: 'V8 Sistema', vertical: 'CLT', action: 'test' },
  { key: 'handbank', label: 'Handbank (UY3)', vertical: 'CLT', action: 'status' },
  { key: 'mercantil', label: 'Mercantil', vertical: 'CLT', action: 'test' },
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

const HEALTHCHECK_TIMEOUT_MS = 12_000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs = HEALTHCHECK_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function hasPositiveStatus(value: unknown) {
  return typeof value === 'string' && /ok|ativo|online|success|healthy|connected/i.test(value);
}

async function pingBanco(bank: BancoCfg): Promise<BancoSaude> {
  const startedAt = performance.now();
  try {
    const data = await withTimeout(api<Record<string, unknown>>(`/api/${bank.key}`, { action: bank.action }));
    const latency = Math.round(performance.now() - startedAt);
    const keys = data && typeof data === 'object' ? Object.keys(data) : [];
    const response = data as { error?: unknown; success?: boolean; ok?: boolean; status?: unknown };
    const explicitlyFailed = Boolean(response.error) || response.success === false || response.ok === false;
    const explicitlyHealthy = response.success === true || response.ok === true || hasPositiveStatus(response.status);

    if (explicitlyFailed || keys.length === 0) {
      return {
        key: bank.key,
        label: bank.label,
        vertical: bank.vertical,
        status: 'erro',
        erroMsg: keys.length === 0 ? 'Resposta vazia ou inválida' : 'Integração respondeu com falha',
        latenciaMs: latency,
      };
    }

    return {
      key: bank.key,
      label: bank.label,
      vertical: bank.vertical,
      status: explicitlyHealthy || keys.length > 0 ? 'ok' : 'erro',
      latenciaMs: latency,
    };
  } catch {
    return {
      key: bank.key,
      label: bank.label,
      vertical: bank.vertical,
      status: 'erro',
      erroMsg: 'Integração indisponível ou sem resposta',
    };
  }
}

async function pingAgente(agent: AgenteCfg): Promise<AgenteSaude> {
  try {
    const data = await withTimeout(api<Record<string, unknown>>(agent.endpoint, { action: 'test' }));
    const response = data as {
      agentActive?: boolean;
      activeConversations?: number;
      claude?: unknown;
      evolution?: unknown;
      supabase?: unknown;
    };
    const knownSignals = [response.agentActive, response.claude, response.evolution, response.supabase].filter((value) => value !== undefined);
    const services = [response.claude, response.evolution, response.supabase].filter((value) => value !== undefined);
    const servicesHealthy = services.every(hasPositiveStatus);
    const healthy = knownSignals.length > 0 && response.agentActive !== false && servicesHealthy;

    return {
      key: agent.key,
      label: agent.label,
      status: healthy ? 'ok' : 'erro',
      conversasAtivas: typeof response.activeConversations === 'number' ? response.activeConversations : undefined,
      erroMsg: healthy ? undefined : 'Agente indisponível ou resposta inválida',
    };
  } catch {
    return {
      key: agent.key,
      label: agent.label,
      status: 'erro',
      erroMsg: 'Agente indisponível ou sem resposta',
    };
  }
}

async function fetchSessoes(): Promise<number | null> {
  try {
    const data = await withTimeout(api<{ ok: boolean; count?: number }>('/api/auth', { action: 'sessoesAtivas' }));
    if (data.ok && typeof data.count === 'number') return data.count;
    return null;
  } catch {
    return null;
  }
}

async function fetchSaude(): Promise<SaudeSaaS> {
  const [banks, agents, activeSessions] = await Promise.all([
    Promise.all(BANCOS.map(pingBanco)),
    Promise.all(AGENTES.map(pingAgente)),
    fetchSessoes(),
  ]);

  const activeConversations = agents.reduce((total, agent) => total + (agent.conversasAtivas ?? 0), 0);

  return {
    bancos: banks,
    agentes: agents,
    conversasAtivas: activeConversations,
    sessoesAtivas: activeSessions,
    atualizadoEm: new Date().toISOString(),
  };
}

export function useOrquestradorSaude() {
  return useQuery({
    queryKey: ['orquestrador', 'saude'],
    queryFn: fetchSaude,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    retry: 1,
  });
}
