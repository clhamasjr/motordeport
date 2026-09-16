'use client';

import Link from 'next/link';
import { ArrowRight, Compass } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent } from '@/components/ui/card';
import { getFeaturedItems, getVisibleGroups } from '@/lib/nav';
import { cn } from '@/lib/utils';

export default function InicioPage() {
  const { user } = useAuth();
  const firstName = user?.name?.trim().split(/\s+/)[0] || user?.username || 'bem-vindo';
  const groups = getVisibleGroups(user?.role);
  const featured = getFeaturedItems(user?.role).slice(0, 4);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-10 p-4 sm:p-6 lg:p-8">
      <header className="relative overflow-hidden rounded-3xl border border-border/70 bg-card/45 p-6 shadow-xl shadow-black/15 backdrop-blur-xl sm:p-8">
        <div className="absolute -right-16 -top-24 size-64 rounded-full bg-primary/10 blur-3xl" aria-hidden />
        <div className="absolute -bottom-28 right-32 size-56 rounded-full bg-accent/10 blur-3xl" aria-hidden />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
              Central de operações
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.03em] text-foreground sm:text-4xl">
              {getGreeting()}, {firstName}.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              Inicie uma tarefa frequente ou entre na área correspondente ao perfil do cliente.
            </p>
          </div>
          {user?.role === 'admin' && (
            <Link
              href="/orquestrador"
              className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-xl border border-border bg-background/50 px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:self-auto"
            >
              <Compass className="size-4 text-primary" aria-hidden />
              Ver saúde da operação
            </Link>
          )}
        </div>
      </header>

      {featured.length > 0 && (
        <section aria-labelledby="atalhos-title">
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Acesso rápido</p>
            <h2 id="atalhos-title" className="mt-1 text-xl font-semibold tracking-tight">Tarefas frequentes</h2>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {featured.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} className="group rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                  <Card interactive className={cn('h-full border-border/70', item.group.cardClass)}>
                    <CardContent className="flex h-full items-center gap-3 p-4">
                      <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl ring-1', item.group.boxClass)}>
                        <Icon className={cn('size-4.5', item.group.iconClass)} aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{item.label}</div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">{item.group.label}</div>
                      </div>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden />
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section aria-labelledby="modulos-title">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Produtos</p>
          <h2 id="modulos-title" className="mt-1 text-xl font-semibold tracking-tight">Seus módulos</h2>
          <p className="mt-1 text-sm text-muted-foreground">A lista respeita as permissões do seu perfil.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => {
            const Icon = group.icon;
            return (
              <Link key={group.base} href={group.base} className="group rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                <Card interactive className={cn('h-full border-border/70', group.cardClass)}>
                  <CardContent className="flex h-full flex-col p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className={cn('flex size-12 shrink-0 items-center justify-center rounded-2xl ring-1 transition-all duration-200', group.boxClass)}>
                        <Icon className={cn('size-5.5 transition-transform duration-200 group-hover:scale-110', group.iconClass)} aria-hidden />
                      </div>
                      <ArrowRight className="size-5 text-muted-foreground/40 transition-all duration-200 group-hover:translate-x-1 group-hover:text-foreground" aria-hidden />
                    </div>
                    <div className="mt-6">
                      <h3 className="text-lg font-semibold tracking-tight">{group.label}</h3>
                      <p className="mt-1 text-sm font-medium text-foreground/80">{group.desc}</p>
                      <p className="mt-2 text-sm leading-5 text-muted-foreground">{group.detail}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}
