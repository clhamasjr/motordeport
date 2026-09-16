'use client';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, LockKeyhole } from 'lucide-react';
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
    <div className="mx-auto w-full max-w-[1480px] px-4 py-7 sm:px-7 lg:px-10 lg:py-10">
      <Link href="/inicio" className="inline-flex min-h-10 items-center gap-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ArrowLeft className="size-4" aria-hidden />
        Produtos
      </Link>

      <header className="mt-4 grid overflow-hidden rounded-[28px] border border-border/65 bg-card xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="p-6 sm:p-9 lg:p-11">
          <div className="flex items-center gap-4">
            <span className={cn('flex size-14 shrink-0 items-center justify-center rounded-2xl sm:size-16', group.boxClass)}>
              <GroupIcon className={cn('size-7 sm:size-8', group.iconClass)} aria-hidden />
            </span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--brand-gold))]">Produto FlowForce</p>
              <p className="mt-1 text-sm text-muted-foreground">{group.desc}</p>
            </div>
          </div>
          <h1 className="mt-8 text-[clamp(3rem,7vw,6rem)] font-semibold leading-none tracking-[-0.075em] text-foreground">{group.label}</h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">{group.detail}</p>
        </div>

        <div className="workspace-ink flex flex-col justify-between p-6 sm:p-8">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--brand-orange))]">Jornada deste produto</p>
            <ol className="mt-6 space-y-4">
              {sections.map((section, index) => (
                <li key={section.section ?? index} className="flex items-start gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-white/20 text-[10px] font-semibold text-white/80">{index + 1}</span>
                  <span>
                    <span className="block text-sm font-semibold text-white">{section.section ? SECTION_LABEL[section.section] : 'Ferramentas'}</span>
                    <span className="mt-0.5 block text-xs text-white/65">{section.items.length} {section.items.length === 1 ? 'ação disponível' : 'ações disponíveis'}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
          {primaryItem && (
            <Link href={primaryItem.href} className="group mt-8 flex min-h-12 items-center justify-between rounded-xl bg-[hsl(var(--brand-orange))] px-4 text-sm font-semibold text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
              Começar por {primaryItem.label}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />
            </Link>
          )}
        </div>
      </header>

      {visibleItems.length === 0 ? (
        <EmptyState
          className="mt-8"
          title="Nenhuma ferramenta disponível"
          description="Seu perfil não possui ferramentas liberadas neste produto."
          action={<Link href="/inicio" className="inline-flex items-center gap-2 text-sm font-semibold text-[hsl(var(--brand-gold))] hover:underline"><LockKeyhole className="size-4" aria-hidden />Voltar aos produtos</Link>}
        />
      ) : (
        <div className="mt-12 space-y-14">
          {sections.map((section, sectionIndex) => (
            <section key={section.section ?? sectionIndex} className="grid gap-5 lg:grid-cols-[180px_1fr]" aria-labelledby={`section-${section.section ?? sectionIndex}`}>
              <div className="lg:sticky lg:top-28 lg:self-start">
                <div className="flex items-center gap-3 lg:block">
                  <span className="flex size-10 items-center justify-center rounded-full bg-[#17181d] text-sm font-semibold text-white lg:size-12">{sectionIndex + 1}</span>
                  <div className="lg:mt-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--brand-gold))]">Etapa {sectionIndex + 1}</p>
                    <h2 id={`section-${section.section ?? sectionIndex}`} className="mt-1 text-xl font-semibold tracking-[-0.035em] text-foreground">
                      {section.section ? SECTION_LABEL[section.section] : 'Ferramentas'}
                    </h2>
                  </div>
                </div>
              </div>

              <div className="workspace-paper overflow-hidden rounded-[22px] border border-border/65">
                {section.items.map((item) => {
                  const ItemIcon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="group grid min-h-[112px] grid-cols-[48px_1fr_auto] items-center gap-4 border-b border-border/60 px-5 py-5 last:border-b-0 hover:bg-secondary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[52px_1fr_140px_auto] sm:px-7"
                    >
                      <span className={cn('flex size-11 items-center justify-center rounded-xl', group.boxClass)}>
                        <ItemIcon className={cn('size-4.5', group.iconClass)} aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-base font-semibold tracking-tight text-foreground">{item.label}</span>
                        <span className="mt-1 block text-sm leading-5 text-muted-foreground">{item.description}</span>
                      </span>
                      <span className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
                        <Check className="size-3.5 text-emerald-600" aria-hidden />
                        Disponível
                      </span>
                      <span className="flex size-10 items-center justify-center rounded-full border border-border bg-card transition-colors group-hover:border-[hsl(var(--brand-orange)/.45)] group-hover:bg-[hsl(var(--brand-orange))] group-hover:text-black">
                        <ArrowRight className="size-4" aria-hidden />
                      </span>
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
