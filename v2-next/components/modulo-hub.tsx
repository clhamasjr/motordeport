'use client';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight, LockKeyhole } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { NAV, SECTION_LABEL, agruparPorSecao, getVisibleItems } from '@/lib/nav';
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
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
      <Link
        href="/inicio"
        className="inline-flex min-h-10 items-center gap-2 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Todos os módulos
      </Link>

      <header className="mt-4 border-b border-border/70 pb-8 pt-3 sm:pb-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4 sm:gap-5">
            <div className={cn('flex size-14 shrink-0 items-center justify-center rounded-lg border border-border/75 sm:size-16', group.boxClass)}>
              <GroupIcon className={cn('size-7 sm:size-8', group.iconClass)} aria-hidden />
            </div>
            <div className="max-w-2xl">
              <p className="text-sm font-medium text-[hsl(var(--brand-orange))]">Área de operação</p>
              <h1 className="mt-1 text-4xl font-semibold tracking-[-0.05em] text-foreground sm:text-5xl">{group.label}</h1>
              <p className="mt-2 text-base font-medium text-foreground/80">{group.desc}</p>
              <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{group.detail}</p>
            </div>
          </div>

          {primaryItem && (
            <Link
              href={primaryItem.href}
              className="group inline-flex min-h-11 shrink-0 items-center justify-center gap-2 self-start rounded-md bg-[hsl(var(--brand-orange))] px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-[hsl(var(--brand-orange)/.9)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:self-auto"
            >
              Começar por {primaryItem.label}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          )}
        </div>
      </header>

      {visibleItems.length === 0 ? (
        <EmptyState
          className="mt-8"
          title="Nenhuma ferramenta disponível"
          description="Seu perfil não possui ferramentas liberadas neste módulo."
          action={
            <Link href="/inicio" className="inline-flex items-center gap-2 text-sm font-semibold text-[hsl(var(--brand-orange))] hover:underline">
              <LockKeyhole className="size-4" aria-hidden />
              Voltar aos módulos
            </Link>
          }
        />
      ) : (
        <div className="mt-9 space-y-10">
          {sections.map((section, sectionIndex) => (
            <section key={section.section ?? sectionIndex} aria-labelledby={`section-${section.section ?? sectionIndex}`}>
              <div className="flex items-end justify-between gap-4 border-b border-border/65 pb-3">
                <div>
                  <p className="text-xs font-medium text-[hsl(var(--brand-orange))]">Etapa {sectionIndex + 1}</p>
                  <h2 id={`section-${section.section ?? sectionIndex}`} className="mt-1 text-xl font-semibold tracking-tight text-foreground">
                    {section.section ? SECTION_LABEL[section.section] : 'Ferramentas'}
                  </h2>
                </div>
                <span className="text-xs text-muted-foreground">
                  {section.items.length} {section.items.length === 1 ? 'ferramenta' : 'ferramentas'}
                </span>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {section.items.map((item) => {
                  const ItemIcon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="command-surface command-hover group flex min-h-40 flex-col rounded-lg p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <span className={cn('flex size-10 items-center justify-center rounded-md border border-border/75', group.boxClass)}>
                          <ItemIcon className={cn('size-4.5', group.iconClass)} aria-hidden />
                        </span>
                        <ArrowRight className="size-4 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-[hsl(var(--brand-orange))]" aria-hidden />
                      </div>
                      <div className="mt-5">
                        <h3 className="text-base font-semibold tracking-tight text-foreground">{item.label}</h3>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p>
                      </div>
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
