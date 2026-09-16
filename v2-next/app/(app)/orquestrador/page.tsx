'use client';

import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  Bell,
  BellOff,
  BellRing,
  BookOpen,
  Bot,
  Building2,
  Compass,
  ExternalLink,
  MessageSquare,
  RefreshCw,
  Server,
  Users,
  Wrench,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useOrquestradorSaude } from '@/hooks/use-orquestrador-saude';
import { useSaudeAlertas } from '@/hooks/use-saude-alertas';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState, OperationBanner } from '@/components/system-state';
import { NAV } from '@/lib/nav';
import { cn } from '@/lib/utils';
import type { AgenteSaude, BancoSaude } from '@/lib/orquestrador-types';

const statusStyles = {
  ok: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400',
  erro: 'border-destructive/25 bg-destructive/10 text-destructive',
  verificando: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
};

function StatusBadge({ status }: { status: BancoSaude['status'] }) {
  const label = status === 'ok' ? 'OK' : status === 'erro' ? 'Falha' : 'Verificando';
  return <Badge variant="outline" className={cn('shrink-0 text-[10px]', statusStyles[status])}>{label}</Badge>;
}

function IntegrationRow({ item }: { item: BancoSaude | AgenteSaude }) {
  const vertical = 'vertical' in item ? item.vertical : 'Agente IA';
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-background/35 px-3 py-2.5 text-xs">
      <StatusBadge status={item.status} />
      <span className="min-w-32 flex-1 font-medium text-foreground">{item.label}</span>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{vertical}</span>
      {'latenciaMs' in item && item.status === 'ok' && item.latenciaMs !== undefined && (
        <span className="font-mono text-[10px] text-muted-foreground">{item.latenciaMs} ms</span>
      )}
      {item.status === 'erro' && (
        <span className="w-full text-xs text-destructive sm:w-auto" role="status">{item.erroMsg || 'Indisponível'}</span>
      )}
    </div>
  );
}

function HealthMetric({
  icon: Icon,
  title,
  value,
  suffix,
  loading,
  available,
  healthy,
  description,
}: {
  icon: React.ElementType;
  title: string;
  value: number | null;
  suffix: string;
  loading: boolean;
  available: boolean;
  healthy?: boolean;
  description: string;
}) {
  return (
    <Card className="border-border/70">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : !available || value === null ? (
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-muted-foreground">—</span>
            <span className="text-sm text-destructive">indisponível</span>
          </div>
        ) : (
          <div className="flex items-baseline gap-2">
            <span className={cn('text-2xl font-bold', healthy === true && 'text-emerald-400', healthy === false && 'text-amber-300')}>{value}</span>
            <span className="text-sm text-muted-foreground">{suffix}</span>
          </div>
        )}
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

export default function OrquestradorPage() {
  const { user } = useAuth();
  const health = useOrquestradorSaude();
  const { armado, armar, permissao, caidos } = useSaudeAlertas(health.data);

  if (user?.role !== 'admin') {
    return (
      <div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
        <EmptyState title="Acesso restrito" description="O Orquestrador é uma área de governança disponível somente para administradores." />
      </div>
    );
  }

  const dataAvailable = !!health.data && !health.error;
  const banksOk = health.data?.bancos.filter((bank) => bank.status === 'ok').length ?? 0;
  const banksTotal = health.data?.bancos.length ?? 0;
  const agentsOk = health.data?.agentes.filter((agent) => agent.status === 'ok').length ?? 0;
  const agentsTotal = health.data?.agentes.length ?? 0;
  const conversationsKnown = !!health.data?.agentes.some((agent) => typeof agent.conversasAtivas === 'number');
  const integrations = [
    ...(health.data?.bancos ?? []),
    ...(health.data?.agentes ?? []),
  ].sort((a, b) => Number(a.status === 'ok') - Number(b.status === 'ok'));

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-border/70 bg-card/45 p-6 shadow-lg shadow-black/10 backdrop-blur-xl">
        <div className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-aurora shadow-[0_0_22px_-4px_hsl(var(--primary)/.7)] ring-1 ring-primary/30">
            <Compass className="size-6 text-primary-foreground" aria-hidden />
          </div>
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Governança operacional</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Orquestrador</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Monitore integrações, agentes e sessões. Dados ausentes são exibidos como indisponíveis, nunca como saudáveis.
              <a href="https://github.com/clhamasjr/motordeport/blob/main/ORQUESTRADOR.md" target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-1 text-primary hover:underline">
                Ver constituição <ExternalLink className="size-3" aria-hidden />
              </a>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {armado ? (
            <Badge variant="outline" className={cn('gap-1.5 px-3 py-2', permissao === 'granted' ? statusStyles.ok : statusStyles.verificando)}>
              {permissao === 'granted' ? <BellRing className="size-3.5" aria-hidden /> : <BellOff className="size-3.5" aria-hidden />}
              {permissao === 'granted' ? 'Som e notificações ativos' : 'Som ativo · notificação bloqueada'}
            </Badge>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={armar}>
              <Bell className="size-4" aria-hidden />
              Ativar alertas
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => void health.refetch()} disabled={health.isFetching}>
            <RefreshCw className={cn('size-4', health.isFetching && 'animate-spin')} aria-hidden />
            {health.isFetching ? 'Atualizando…' : 'Recarregar agora'}
          </Button>
        </div>
      </header>

      {health.isFetching && !health.isLoading && (
        <OperationBanner busy title="Atualizando o monitoramento" description="Os dados anteriores permanecem visíveis até a nova verificação terminar." />
      )}

      {!health.isLoading && caidos.length > 0 && (
        <OperationBanner
          variant="error"
          title={caidos.length === 1 ? '1 integração precisa de atenção' : `${caidos.length} integrações precisam de atenção`}
          description={caidos.map((item) => item.label).join(', ')}
          action={!armado ? <Button type="button" size="sm" variant="outline" onClick={armar}>Ativar alertas</Button> : undefined}
        />
      )}

      {health.error && (
        <ErrorState
          title="Não foi possível carregar a saúde da operação"
          description="As métricas abaixo ficam indisponíveis até uma verificação válida. Tente novamente agora."
          onRetry={() => void health.refetch()}
        />
      )}

      <section aria-labelledby="health-title">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Estado atual</p>
            <h2 id="health-title" className="mt-1 text-xl font-semibold">Saúde da operação</h2>
          </div>
          {health.data?.atualizadoEm && (
            <p className="text-xs text-muted-foreground">Atualizado às {new Date(health.data.atualizadoEm).toLocaleTimeString('pt-BR')}</p>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <HealthMetric icon={Server} title="Bancos" value={dataAvailable ? banksOk : null} suffix={`/ ${banksTotal} disponíveis`} loading={health.isLoading} available={dataAvailable && banksTotal > 0} healthy={banksTotal > 0 && banksOk === banksTotal} description="Verificação paralela a cada 60 segundos." />
          <HealthMetric icon={Bot} title="Agentes IA" value={dataAvailable ? agentsOk : null} suffix={`/ ${agentsTotal} disponíveis`} loading={health.isLoading} available={dataAvailable && agentsTotal > 0} healthy={agentsTotal > 0 && agentsOk === agentsTotal} description="Sofia e agente CLT." />
          <HealthMetric icon={MessageSquare} title="Conversas ativas" value={dataAvailable && conversationsKnown ? health.data!.conversasAtivas : null} suffix="em curso" loading={health.isLoading} available={dataAvailable && conversationsKnown} description="Soma apenas agentes que reportaram a contagem." />
          <HealthMetric icon={Users} title="Sessões" value={dataAvailable ? health.data!.sessoesAtivas : null} suffix="logadas" loading={health.isLoading} available={dataAvailable && health.data!.sessoesAtivas !== null} description="Sessões autenticadas e não expiradas." />
        </div>
      </section>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="text-base">Detalhe de integrações e agentes</CardTitle>
          <CardDescription>Falhas aparecem primeiro. Cada linha indica um status textual além da cor.</CardDescription>
        </CardHeader>
        <CardContent>
          {health.isLoading ? (
            <div className="grid gap-2 md:grid-cols-2">{Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-11 w-full" />)}</div>
          ) : integrations.length === 0 ? (
            <EmptyState title="Nenhum resultado disponível" description="Recarregue o painel para executar uma nova verificação." />
          ) : (
            <div className="grid gap-2 md:grid-cols-2">{integrations.map((item) => <IntegrationRow key={item.key} item={item} />)}</div>
          )}
        </CardContent>
      </Card>

      <section aria-labelledby="modules-title">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Navegação</p>
          <h2 id="modules-title" className="mt-1 text-xl font-semibold">Mapa de módulos</h2>
          <p className="mt-1 text-sm text-muted-foreground">Os cartões abrem os hubs reais e são derivados da mesma fonte usada pela navegação.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {NAV.map((group) => {
            const Icon = group.icon;
            return (
              <Link key={group.k} href={group.base} className="group rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                <Card interactive className={cn('h-full border-border/70', group.cardClass)}>
                  <CardContent className="flex h-full items-start gap-3 p-4">
                    <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl ring-1', group.boxClass)}><Icon className={cn('size-4.5', group.iconClass)} aria-hidden /></div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{group.label}</div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{group.desc} · {group.items.length} ferramentas</p>
                    </div>
                    <ArrowRight className="size-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="governance-title">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Administração</p>
          <h2 id="governance-title" className="mt-1 text-xl font-semibold">Governança rápida</h2>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { href: '/admin/usuarios', label: 'Usuários', icon: Users },
            { href: '/admin/parceiros', label: 'Parceiros', icon: Building2 },
            { href: '/admin/manutencao', label: 'Manutenção', icon: Wrench },
          ].map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Card interactive><CardContent className="flex items-center gap-3 p-4"><Icon className="size-5 text-primary" aria-hidden /><span className="text-sm font-medium">{label}</span></CardContent></Card>
            </Link>
          ))}
          <a href="https://github.com/clhamasjr/motordeport/blob/main/GESTAO.md" target="_blank" rel="noopener noreferrer" className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Card interactive><CardContent className="flex items-center gap-3 p-4"><BookOpen className="size-5 text-primary" aria-hidden /><span className="flex items-center gap-1 text-sm font-medium">Manual de gestão <ExternalLink className="size-3" aria-hidden /></span></CardContent></Card>
          </a>
        </div>
      </section>

      <OperationBanner variant="info" title="Painel de visibilidade" description="Este painel informa disponibilidade e acesso rápido. Ele não altera regras de crédito nem executa ações nos módulos monitorados." action={<Activity className="size-4" aria-hidden />} />
    </div>
  );
}
