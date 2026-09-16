'use client';

import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Command,
  Orbit,
  Radio,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { getFeaturedItems, getVisibleGroups } from '@/lib/nav';
import { cn } from '@/lib/utils';

export default function InicioPage() {
  const { user } = useAuth();
  const firstName = user?.name?.trim().split(/\s+/)[0] || user?.username || 'operador';
  const groups = getVisibleGroups(user?.role);
  const featured = getFeaturedItems(user?.role).slice(0, 4);

  return (
    <div className="mx-auto w-full max-w-[1480px] p-4 sm:p-6 lg:p-8">
      <section className="command-surface relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent" aria-hidden />
        <div className="grid min-h-[330px] lg:grid-cols-[1fr_340px]">
          <div className="flex flex-col justify-between border-b border-border/75 p-6 sm:p-8 lg:border-b-0 lg:border-r lg:p-10">
            <div>
              <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
                <Command className="size-3.5" aria-hidden />
                FlowForce Command Center
              </div>
              <h1 className="mt-6 max-w-4xl text-4xl font-semibold tracking-[-0.055em] text-foreground sm:text-5xl lg:text-6xl">
                {getGreeting()}, {firstName}.<br />
                <span className="text-muted-foreground">Qual missão começa agora?</span>
              </h1>
            </div>
            <p className="mt-8 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              Selecione uma ação prioritária ou entre em uma trilha operacional. O sistema mostra apenas os comandos liberados para seu perfil.
            </p>
          </div>

          <div className="grid grid-rows-[1fr_auto] bg-[linear-gradient(150deg,hsl(var(--primary)/.055),transparent_58%)] p-6 sm:p-8">
            <div>
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                <span>Session telemetry</span>
                <Radio className="size-3.5 text-emerald-400" aria-hidden />
              </div>
              <dl className="mt-8 space-y-5">
                <Telemetry label="Acesso" value={roleLabel(user?.role)} tone="text-primary" />
                <Telemetry label="Trilhas disponíveis" value={String(groups.length).padStart(2, '0')} />
                <Telemetry label="Comandos prioritários" value={String(featured.length).padStart(2, '0')} />
                <Telemetry label="Proteção" value="ACTIVE" tone="text-emerald-400" />
              </dl>
            </div>
            {user?.role === 'admin' && (
              <Link href="/orquestrador" className="mt-8 flex min-h-12 items-center justify-between border-t border-border/75 pt-4 text-sm font-semibold text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex items-center gap-2"><Orbit className="size-4 text-primary" aria-hidden />Abrir telemetria da operação</span>
                <ArrowUpRight className="size-4" aria-hidden />
              </Link>
            )}
          </div>
        </div>
      </section>

      <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,.65fr)]">
        <section aria-labelledby="command-queue-title">
          <SectionHeading code="01" title="Fila de partida" description="Atalhos escolhidos pelo impacto no trabalho diário." id="command-queue-title" />
          <div className="mt-4 border-y border-border/75">
            {featured.map((item, index) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group grid min-h-[108px] grid-cols-[48px_46px_1fr_auto] items-center gap-4 border-b border-border/65 px-2 last:border-b-0 hover:bg-primary/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[64px_52px_1fr_auto] sm:px-4"
                >
                  <span className="font-mono text-xs text-muted-foreground/55">{String(index + 1).padStart(2, '0')}</span>
                  <span className={cn('flex size-11 items-center justify-center border border-border/80', item.group.boxClass)}>
                    <Icon className={cn('size-4.5', item.group.iconClass)} aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-mono text-[9px] uppercase tracking-[0.16em] text-primary">{item.group.label} / priority command</span>
                    <span className="mt-1 block text-lg font-semibold tracking-tight text-foreground">{item.label}</span>
                    <span className="mt-1 hidden text-sm text-muted-foreground sm:block">{item.description}</span>
                  </span>
                  <ArrowRight className="size-5 text-muted-foreground/45 transition-transform group-hover:translate-x-1 group-hover:text-primary" aria-hidden />
                </Link>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="lanes-title">
          <SectionHeading code="02" title="Mapa operacional" description="Todas as trilhas acessíveis nesta sessão." id="lanes-title" />
          <div className="command-surface mt-4 divide-y divide-border/65">
            {groups.map((group, index) => {
              const Icon = group.icon;
              const visibleCount = group.items.filter((item) => !item.needsRole || (user?.role && item.needsRole.includes(user.role))).length;
              return (
                <Link key={group.base} href={group.base} className="group grid min-h-[72px] grid-cols-[34px_36px_1fr_auto] items-center gap-3 px-4 transition-colors hover:bg-primary/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  <span className="font-mono text-[10px] text-muted-foreground/45">{String(index + 1).padStart(2, '0')}</span>
                  <span className={cn('flex size-9 items-center justify-center border border-border/75', group.boxClass)}><Icon className={cn('size-4', group.iconClass)} aria-hidden /></span>
                  <span><span className="block text-sm font-semibold">{group.label}</span><span className="block text-[11px] text-muted-foreground">{group.desc}</span></span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground group-hover:text-primary">{visibleCount} tools</span>
                </Link>
              );
            })}
          </div>
        </section>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
        <span className="flex items-center gap-2"><ShieldCheck className="size-3.5 text-primary" aria-hidden />Access map synchronized</span>
        <span>FlowForce / LhamasCred / Command Layer</span>
      </div>
    </div>
  );
}

function SectionHeading({ code, title, description, id }: { code: string; title: string; description: string; id: string }) {
  return (
    <div className="grid grid-cols-[44px_1fr] gap-4 border-b border-border/70 pb-3">
      <span className="font-mono text-xs text-primary">{code}</span>
      <div><h2 id={id} className="text-xl font-semibold tracking-tight">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>
    </div>
  );
}

function Telemetry({ label, value, tone = 'text-foreground' }: { label: string; value: string; tone?: string }) {
  return <div className="flex items-end justify-between gap-4 border-b border-border/55 pb-2"><dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</dt><dd className={cn('font-mono text-sm font-semibold', tone)}>{value}</dd></div>;
}

function roleLabel(role?: string) {
  if (role === 'admin') return 'ADMIN';
  if (role === 'gestor') return 'MANAGER';
  return 'OPERATOR';
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}
