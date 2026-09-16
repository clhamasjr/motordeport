'use client';

import Link from 'next/link';
import { Activity, ArrowRight, CornerDownRight, Layers3 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { getFeaturedItems, getVisibleGroups, getVisibleItems } from '@/lib/nav';
import { cn } from '@/lib/utils';

export default function InicioPage() {
  const { user } = useAuth();
  const firstName = user?.name?.trim().split(/\s+/)[0] || user?.username || 'operador';
  const groups = getVisibleGroups(user?.role);
  const featured = getFeaturedItems(user?.role).slice(0, 4);
  const primary = featured[0];
  const secondary = featured.slice(1);

  return (
    <div className="mx-auto w-full max-w-[1480px] px-4 py-8 sm:px-7 lg:px-10 lg:py-12">
      <header className="max-w-5xl">
        <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--brand-gold))]">
          <span className="h-px w-8 bg-[hsl(var(--brand-orange))]" aria-hidden />
          Sua mesa de trabalho
        </div>
        <h1 className="mt-5 text-[clamp(2.7rem,6vw,5.7rem)] font-semibold leading-[0.92] tracking-[-0.07em] text-foreground">
          {getGreeting()}, {firstName}.
          <span className="mt-2 block text-muted-foreground">Qual missão começa agora?</span>
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground">
          Um ponto de partida para consultar, operar e acompanhar crédito sem perder o contexto entre produtos.
        </p>
      </header>

      <section className="mt-10 grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,.45fr)]" aria-labelledby="continuar-title">
        {primary && (() => {
          const Icon = primary.icon;
          return (
            <Link
              href={primary.href}
              className="workspace-ink group relative min-h-[310px] overflow-hidden rounded-[28px] p-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-9"
            >
              <div className="absolute -right-16 -top-16 size-56 rounded-full border border-white/10" aria-hidden />
              <div className="absolute -right-4 -top-4 size-36 rounded-full border border-[hsl(var(--brand-orange)/.28)]" aria-hidden />
              <div className="relative flex h-full flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--brand-orange))]">
                    <CornerDownRight className="size-3.5" aria-hidden />
                    Começar por aqui
                  </div>
                  <div className="mt-8 flex size-14 items-center justify-center rounded-2xl bg-white/[0.07] text-[hsl(var(--brand-orange))]">
                    <Icon className="size-6" aria-hidden />
                  </div>
                  <h2 id="continuar-title" className="mt-5 text-3xl font-semibold tracking-[-0.045em] text-white sm:text-4xl">{primary.label}</h2>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-white/55 sm:text-base">{primary.description}</p>
                </div>
                <div className="mt-8 flex items-center justify-between border-t border-white/10 pt-5">
                  <span className="text-xs font-medium text-white/50">{primary.group.label} · {primary.group.desc}</span>
                  <span className="flex size-11 items-center justify-center rounded-full bg-[hsl(var(--brand-orange))] text-black transition-transform duration-150 group-hover:translate-x-1">
                    <ArrowRight className="size-4.5" aria-hidden />
                  </span>
                </div>
              </div>
            </Link>
          );
        })()}

        <div className="workspace-paper rounded-[28px] border border-border/65 p-6 sm:p-7">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--brand-gold))]">Atalhos</p>
              <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">Próximas ações</h2>
            </div>
            <Layers3 className="size-5 text-muted-foreground" aria-hidden />
          </div>
          <div className="mt-6 divide-y divide-border/65">
            {secondary.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} className="group flex min-h-[74px] items-center gap-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', item.group.boxClass)}>
                    <Icon className={cn('size-4', item.group.iconClass)} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-foreground">{item.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{item.group.label}</span>
                  </span>
                  <ArrowRight className="size-4 text-muted-foreground/45 transition-transform group-hover:translate-x-1 group-hover:text-[hsl(var(--brand-gold))]" aria-hidden />
                </Link>
              );
            })}
          </div>
          {user?.role === 'admin' && (
            <Link href="/orquestrador" className="mt-5 flex min-h-11 items-center justify-between rounded-xl bg-secondary px-4 text-sm font-semibold text-foreground hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="flex items-center gap-2"><Activity className="size-4 text-emerald-600" aria-hidden />Saúde da operação</span>
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          )}
        </div>
      </section>

      <section className="mt-14" aria-labelledby="produtos-title">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--brand-gold))]">Portfólio</p>
            <h2 id="produtos-title" className="mt-1 text-3xl font-semibold tracking-[-0.045em]">Produtos da operação</h2>
          </div>
          <p className="max-w-md text-sm leading-6 text-muted-foreground">Cada produto organiza suas ferramentas em uma jornada contínua, da consulta ao acompanhamento.</p>
        </div>

        <div className="workspace-paper mt-6 overflow-hidden rounded-[24px] border border-border/65">
          {groups.map((group) => {
            const Icon = group.icon;
            const tools = getVisibleItems(group, user?.role).length;
            return (
              <Link
                key={group.base}
                href={group.base}
                className="group grid min-h-[112px] grid-cols-[52px_1fr_auto] items-center gap-4 border-b border-border/60 px-5 py-5 last:border-b-0 hover:bg-secondary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[66px_1fr_220px_auto] sm:px-7"
              >
                <span className={cn('flex size-12 items-center justify-center rounded-2xl', group.boxClass)}>
                  <Icon className={cn('size-5', group.iconClass)} aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="text-lg font-semibold tracking-tight text-foreground">{group.label}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{group.desc}</span>
                </span>
                <span className="hidden text-sm leading-5 text-muted-foreground sm:block">{group.detail}</span>
                <span className="flex items-center gap-3">
                  <span className="hidden text-xs text-muted-foreground xl:inline">{tools} ferramentas</span>
                  <span className="flex size-10 items-center justify-center rounded-full border border-border bg-card transition-colors group-hover:border-[hsl(var(--brand-orange)/.45)] group-hover:bg-[hsl(var(--brand-orange))] group-hover:text-black">
                    <ArrowRight className="size-4" aria-hidden />
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <footer className="mt-10 flex flex-col gap-1 border-t border-border/65 pt-5 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>FlowForce Workspace</span>
        <span>Uma plataforma LhamasCred</span>
      </footer>
    </div>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}
