'use client';

// ════════════════════════════════════════════════════════════════════
// /orquestrador — Painel macro do FlowForce (V1: visibilidade)
//
// Constituição: ../../../../ORQUESTRADOR.md (raiz do repo)
//
// V1 entrega:
//   - 4 cards de saúde (bancos, agentes, conversas, sessões)
//   - mapa visual dos módulos
//   - atalhos rápidos pras telas de governança
//
// V2+ entrega: editor de tema, layout, RBAC.
// ════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { useOrquestradorSaude } from '@/hooks/use-orquestrador-saude';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Compass, Building2, Landmark, Briefcase, Settings,
  Server, Bot, MessageSquare, Users, AlertCircle, CheckCircle2,
  ExternalLink, BookOpen, Wrench,
} from 'lucide-react';
import type { ModuloStatus, BancoSaude } from '@/lib/orquestrador-types';

// ── Mapa de Módulos (estático na V1; pode virar dinâmico no V2) ─────
const MODULOS: ModuloStatus[] = [
  { key: 'inss',   label: 'INSS',        icone: 'briefcase', totalTelas: 13, status: 'operando',  resumo: 'Sofia + esteira + pipeline + propostas' },
  { key: 'clt',    label: 'CLT',         icone: 'building',  totalTelas: 12, status: 'operando',  resumo: '100% migrado pro V2 — referência de padrão' },
  { key: 'gov',    label: 'Governos',    icone: 'landmark',  totalTelas: 2,  status: 'migracao',  resumo: 'Catálogo + holerite. Demais telas a migrar' },
  { key: 'fed',    label: 'Federal',     icone: 'landmark',  totalTelas: 2,  status: 'migracao',  resumo: 'SIAPE — catálogo + análise contracheque' },
  { key: 'pref',   label: 'Prefeituras', icone: 'building',  totalTelas: 2,  status: 'migracao',  resumo: 'Catálogo + análise holerite' },
  { key: 'admin',  label: 'Admin',       icone: 'settings',  totalTelas: 3,  status: 'operando',  resumo: 'Usuários + Parceiros + Manutenção' },
];

const ICON_MAP = {
  briefcase: Briefcase,
  building: Building2,
  landmark: Landmark,
  settings: Settings,
} as const;

// ── Helpers de visual ───────────────────────────────────────────────
function statusDot(status: 'ok' | 'erro' | 'verificando') {
  if (status === 'ok') return <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />;
  if (status === 'erro') return <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />;
  return <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse inline-block" />;
}

function moduloPill(s: ModuloStatus['status']) {
  if (s === 'operando') return <Badge variant="outline" className="border-green-500/30 text-green-500">🟢 operando</Badge>;
  if (s === 'migracao') return <Badge variant="outline" className="border-yellow-500/30 text-yellow-500">🟡 em migração</Badge>;
  return <Badge variant="outline" className="border-orange-500/30 text-orange-500">🟠 parcial</Badge>;
}

// ── Linha de banco no detalhamento ──────────────────────────────────
function BancoLinha({ b }: { b: BancoSaude }) {
  return (
    <div className="flex items-center gap-2 text-xs py-1">
      {statusDot(b.status)}
      <span className="flex-1 truncate">{b.label}</span>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{b.vertical}</span>
      {b.status === 'ok' && b.latenciaMs !== undefined && (
        <span className="text-[10px] text-muted-foreground/60 font-mono">{b.latenciaMs}ms</span>
      )}
      {b.status === 'erro' && b.erroMsg && (
        <span className="text-[10px] text-red-500 truncate max-w-[140px]" title={b.erroMsg}>
          {b.erroMsg}
        </span>
      )}
    </div>
  );
}

// ── Página ──────────────────────────────────────────────────────────
export default function OrquestradorPage() {
  const { user } = useAuth();
  const { data, isLoading, error } = useOrquestradorSaude();

  if (user?.role !== 'admin') {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <Card className="border-destructive/50">
          <CardContent className="p-6 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Acesso restrito</div>
              <p className="text-sm text-muted-foreground mt-1">
                O Orquestrador é uma área de governança macro — apenas administradores
                podem acessar.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // KPIs derivados
  const bancosOk = data?.bancos.filter((b) => b.status === 'ok').length ?? 0;
  const bancosTotal = data?.bancos.length ?? 0;
  const agentesOk = data?.agentes.filter((a) => a.status === 'ok').length ?? 0;
  const agentesTotal = data?.agentes.length ?? 0;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-lg bg-aurora flex items-center justify-center ring-1 ring-primary/30 shadow-[0_0_22px_-4px_hsl(var(--primary)/.7)] flex-shrink-0">
          <Compass className="w-6 h-6 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gradient">Orquestrador</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Visão de cima do FlowForce. Saúde, módulos e governança.
            <Link href="https://github.com/clhamasjr/motordeport/blob/main/ORQUESTRADOR.md"
                  target="_blank"
                  className="ml-2 inline-flex items-center gap-1 text-primary hover:underline">
              constituição <ExternalLink className="w-3 h-3" />
            </Link>
          </p>
        </div>
      </div>

      {/* Erro global */}
      {error && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-semibold">Falha ao carregar saúde do SaaS</div>
              <p className="text-muted-foreground mt-1">
                {error instanceof Error ? error.message : String(error)}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 4 cards de saúde */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-sm font-medium text-muted-foreground">Bancos</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-7 w-20" />
            ) : (
              <div className="flex items-baseline gap-1">
                <span className={`text-2xl font-bold ${bancosOk === bancosTotal ? 'text-green-500' : 'text-yellow-500'}`}>
                  {bancosOk}
                </span>
                <span className="text-sm text-muted-foreground">/ {bancosTotal} OK</span>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground mt-1">healthcheck paralelo · 60s</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-sm font-medium text-muted-foreground">Agentes IA</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-7 w-20" />
            ) : (
              <div className="flex items-baseline gap-1">
                <span className={`text-2xl font-bold ${agentesOk === agentesTotal ? 'text-green-500' : 'text-red-500'}`}>
                  {agentesOk}
                </span>
                <span className="text-sm text-muted-foreground">/ {agentesTotal} OK</span>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground mt-1">Sofia · Agente CLT</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-sm font-medium text-muted-foreground">Conversas ativas</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-7 w-20" />
            ) : (
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold">{data?.conversasAtivas ?? 0}</span>
                <span className="text-sm text-muted-foreground">em curso</span>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground mt-1">soma de Sofia + Agente CLT</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-sm font-medium text-muted-foreground">Sessões</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-7 w-20" />
            ) : data?.sessoesAtivas == null ? (
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-muted-foreground">—</span>
                <span className="text-sm text-red-400">erro</span>
              </div>
            ) : (
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold">{data.sessoesAtivas}</span>
                <span className="text-sm text-muted-foreground">logados</span>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground mt-1">sessões não expiradas</p>
          </CardContent>
        </Card>
      </div>

      {/* Detalhe dos bancos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detalhe de integrações</CardTitle>
          <CardDescription>
            Healthcheck em paralelo via /api/[banco] action: test. Atualiza a cada 60s.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
              {data?.bancos.map((b) => <BancoLinha key={b.key} b={b} />)}
            </div>
          )}
          {data?.atualizadoEm && (
            <p className="text-[10px] text-muted-foreground mt-3 text-right">
              atualizado {new Date(data.atualizadoEm).toLocaleTimeString('pt-BR')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Mapa de Módulos */}
      <div>
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground mb-3">
          🗺️ Mapa de Módulos
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {MODULOS.map((m) => {
            const Icon = ICON_MAP[m.icone as keyof typeof ICON_MAP] ?? Briefcase;
            return (
              <Card key={m.key} className="hover:border-primary/50 transition-colors">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-secondary/50 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-sm">{m.label}</CardTitle>
                      <CardDescription className="text-[10px]">{m.totalTelas} telas</CardDescription>
                    </div>
                    {moduloPill(m.status)}
                  </div>
                </CardHeader>
                {m.resumo && (
                  <CardContent className="pt-0">
                    <p className="text-xs text-muted-foreground">{m.resumo}</p>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      {/* Governança rápida */}
      <div>
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground mb-3">
          🎛️ Governança rápida
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Link href="/admin/usuarios">
            <Card className="hover:border-primary/50 hover:shadow-md transition-all cursor-pointer">
              <CardContent className="p-4 flex items-center gap-3">
                <Users className="w-5 h-5 text-primary" />
                <div className="text-sm font-medium">Usuários</div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/admin/parceiros">
            <Card className="hover:border-primary/50 hover:shadow-md transition-all cursor-pointer">
              <CardContent className="p-4 flex items-center gap-3">
                <Building2 className="w-5 h-5 text-primary" />
                <div className="text-sm font-medium">Parceiros</div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/admin/manutencao">
            <Card className="hover:border-primary/50 hover:shadow-md transition-all cursor-pointer">
              <CardContent className="p-4 flex items-center gap-3">
                <Wrench className="w-5 h-5 text-primary" />
                <div className="text-sm font-medium">Manutenção</div>
              </CardContent>
            </Card>
          </Link>
          <a href="https://github.com/clhamasjr/motordeport/blob/main/GESTAO.md" target="_blank" rel="noreferrer">
            <Card className="hover:border-primary/50 hover:shadow-md transition-all cursor-pointer">
              <CardContent className="p-4 flex items-center gap-3">
                <BookOpen className="w-5 h-5 text-primary" />
                <div className="text-sm font-medium flex items-center gap-1">
                  Manual GESTAO.md <ExternalLink className="w-3 h-3" />
                </div>
              </CardContent>
            </Card>
          </a>
        </div>
      </div>

      {/* Rodapé conceitual */}
      <Card className="bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20">
        <CardContent className="p-4 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-semibold mb-1">V1 — apenas visibilidade</div>
            <p className="text-muted-foreground">
              Editor de tema, layout/sidebar e RBAC virão em V2+. Conforme constituição,
              o Orquestrador <strong>não vende, não integra banco, não conversa com cliente</strong> —
              ele governa o produto FlowForce.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
