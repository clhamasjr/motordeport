'use client';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight, Compass, LockKeyhole } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { NAV, SECTION_LABEL, agruparPorSecao, getVisibleItems } from '@/lib/nav';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/system-state';
import { cn } from '@/lib/utils';

export function ModuloHub({ k }: { k: string }) {
  const { user } = useAuth();
  const group = NAV.find((candidate) => candidate.k === k);
  if (!group) return notFound();

  const visibleItems = getVisibleItems(group, user?.role);
  const sections = agruparPorSecao(visibleItems);
  const GroupIcon = group.icon;
  const primaryItem = visibleItems.find((item) => item.featured) ?? visibleItems[0];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 p-4 sm:p-6 lg:p-8">
      <Link
        href="/inicio"
        className="inline-flex items-center gap-2 rounded-lg text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Todos os módulos
      </Link>

      <header className="relative overflow-hidden rounded-3xl border border-border/70 bg-card/45 p-6 shadow-xl shadow-black/15 backdrop-blur-xl sm:p-8">
        <div className="absolute -right-20 -top-24 size-64 rounded-full bg-primary/10 blur-3xl" aria-hidden />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4 sm:gap-5">
            <div className={cn('flex size-14 shrink-0 items-center justify-center rounded-2xl ring-1 sm:size-16', group.boxClass)}>
              <GroupIcon className={cn('size-7 sm:size-8', group.iconClass)} aria-hidden />
            </div>
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Área operacional</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-[-0.03em] text-foreground sm:text-4xl">{group.label}</h1>
              <p className="mt-2 text-sm font-medium text-foreground/80 sm:text-base">{group.desc}</p>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{group.detail}</p>
            </div>
          </div>

          {primaryItem && (
            <Link
              href={primaryItem.href}
              className="group inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Começar por {primaryItem.label}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          )}
        </div>
      </header>

      {visibleItems.length === 0 ? (
        <EmptyState
          title="Nenhuma ferramenta disponível"
          description="Seu perfil não possui ferramentas liberadas neste módulo. Se isso parecer incorreto, fale com um administrador."
          action={
            <Link href="/inicio" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
              <LockKeyhole className="size-4" aria-hidden />
              Voltar aos módulos
            </Link>
          }
        />
      ) : (
        <div className="space-y-8">
          {sections.map((section, index) => (
            <section key={section.section ?? index} aria-labelledby={`section-${section.section ?? index}`}>
              <div className="mb-4 flex items-end justify-between gap-4 border-b border-border/60 pb-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">Etapa {index + 1}</p>
                  <h2 id={`section-${section.section ?? index}`} className="mt-1 text-lg font-semibold tracking-tight text-foreground">
                    {section.section ? SECTION_LABEL[section.section] : 'Ferramentas'}
                  </h2>
                </div>
                <span className="text-xs text-muted-foreground">
                  {section.items.length} {section.items.length === 1 ? 'ferramenta' : 'ferramentas'}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {section.items.map((item) => {
                  const ItemIcon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="group rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      <Card interactive className={cn('h-full border-border/70', group.cardClass)}>
                        <CardContent className="flex h-full min-h-44 flex-col p-5">
                          <div className="flex items-start justify-between gap-4">
                            <div className={cn('flex size-11 shrink-0 items-center justify-center rounded-xl ring-1', group.boxClass)}>
                              <ItemIcon className={cn('size-5', group.iconClass)} aria-hidden />
                            </div>
                            <ArrowRight className="size-4 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden />
                          </div>
                          <div className="mt-5 flex-1">
                            <h3 className="text-base font-semibold tracking-tight text-foreground">{item.label}</h3>
                            <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p>
                          </div>
                          <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-primary">
                            <Compass className="size-3.5" aria-hidden />
                            Abrir ferramenta
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
