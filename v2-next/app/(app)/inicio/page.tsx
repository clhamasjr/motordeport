'use client';

import Link from 'next/link';
import { Activity, ArrowRight } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { getFeaturedItems, getVisibleGroups } from '@/lib/nav';
import { cn } from '@/lib/utils';

export default function InicioPage() {
  const { user } = useAuth();
  const firstName = user?.name?.trim().split(/\s+/)[0] || user?.username || 'operador';
  const groups = getVisibleGroups(user?.role);
  const featured = getFeaturedItems(user?.role).slice(0, 4);

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
      <header className="border-b border-border/70 pb-8 pt-2 sm:pb-10">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm font-medium text-[hsl(var(--brand-orange))]">FlowForce</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-foreground sm:text-5xl">
              {getGreeting()}, {firstName}.<br />
              <span className="text-muted-foreground">Qual missão começa agora?</span>
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              Escolha uma tarefa frequente ou acesse a área do produto que deseja operar.
            </p>
          </div>

          {user?.role === 'admin' && (
            <Link
              href="/orquestrador"
              className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-md border border-border bg-card/55 px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:border-[hsl(var(--brand-orange)/.5)] hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:self-auto"
            >
              <Activity className="size-4 text-emerald-400" aria-hidden />
              Ver saúde da operação
            </Link>
          )}
        </div>
      </header>

      {featured.length > 0 && (
        <section className="mt-9" aria-labelledby="frequentes-title">
          <SectionHeading title="Tarefas frequentes" description="Acesso rápido às ações mais usadas." id="frequentes-title" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {featured.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="command-surface command-hover group flex min-h-28 items-center gap-4 rounded-lg p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-md border border-border/75', item.group.boxClass)}>
                    <Icon className={cn('size-4.5', item.group.iconClass)} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-foreground">{item.label}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{item.group.label}</span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground/45 transition-transform group-hover:translate-x-0.5 group-hover:text-[hsl(var(--brand-orange))]" aria-hidden />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section className="mt-10" aria-labelledby="modulos-title">
        <SectionHeading title="Áreas de operação" description="Os módulos disponíveis para o seu perfil." id="modulos-title" />
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => {
            const Icon = group.icon;
            return (
              <Link
                key={group.base}
                href={group.base}
                className="command-surface command-hover group flex min-h-40 flex-col rounded-lg p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-start justify-between gap-4">
                  <span className={cn('flex size-11 items-center justify-center rounded-md border border-border/75', group.boxClass)}>
                    <Icon className={cn('size-5', group.iconClass)} aria-hidden />
                  </span>
                  <ArrowRight className="size-4 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-[hsl(var(--brand-orange))]" aria-hidden />
                </div>
                <div className="mt-5">
                  <h2 className="text-lg font-semibold tracking-tight text-foreground">{group.label}</h2>
                  <p className="mt-1 text-sm font-medium text-foreground/75">{group.desc}</p>
                  <p className="mt-2 text-sm leading-5 text-muted-foreground">{group.detail}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <footer className="mt-10 border-t border-border/65 pt-4 text-center text-[11px] text-muted-foreground/65">
        FlowForce Command Center · Uma plataforma LhamasCred
      </footer>
    </div>
  );
}

function SectionHeading({ title, description, id }: { title: string; description: string; id: string }) {
  return (
    <div>
      <h2 id={id} className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}
