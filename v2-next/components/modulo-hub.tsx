'use client';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight, Crosshair, LockKeyhole, Radio } from 'lucide-react';
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
  const moduleIndex = NAV.findIndex((candidate) => candidate.k === k) + 1;

  return (
    <div className="mx-auto w-full max-w-[1440px] p-4 sm:p-6 lg:p-8">
      <Link href="/inicio" className="inline-flex min-h-10 items-center gap-2 rounded-md px-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ArrowLeft className="size-3.5" aria-hidden /> Return to command center
      </Link>

      <header className="command-surface relative mt-4 overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-primary via-accent to-transparent" aria-hidden />
        <div className="grid lg:grid-cols-[150px_1fr_330px]">
          <div className="flex min-h-36 items-center justify-center border-b border-border/70 lg:min-h-[250px] lg:border-b-0 lg:border-r">
            <div className="text-center">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Operational lane</div>
              <div className="mt-3 font-mono text-5xl font-semibold tracking-[-0.08em] text-primary">{String(moduleIndex).padStart(2, '0')}</div>
            </div>
          </div>
          <div className="flex items-center gap-5 border-b border-border/70 p-6 sm:p-8 lg:border-b-0 lg:border-r lg:p-10">
            <div className={cn('flex size-16 shrink-0 items-center justify-center border border-border/80 sm:size-20', group.boxClass)}>
              <GroupIcon className={cn('size-8 sm:size-9', group.iconClass)} aria-hidden />
            </div>
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-primary"><Radio className="size-3" aria-hidden />Lane online</div>
              <h1 className="mt-3 text-4xl font-semibold tracking-[-0.055em] text-foreground sm:text-5xl">{group.label}</h1>
              <p className="mt-2 text-base font-medium text-foreground/85">{group.desc}</p>
              <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{group.detail}</p>
            </div>
          </div>
          <div className="flex flex-col justify-between bg-[linear-gradient(145deg,hsl(var(--primary)/.045),transparent_62%)] p-6 sm:p-8">
            <div className="space-y-4">
              <DataLine label="Status" value="READY" tone="text-emerald-400" />
              <DataLine label="Etapas" value={String(sections.length).padStart(2, '0')} />
              <DataLine label="Ferramentas" value={String(visibleItems.length).padStart(2, '0')} />
              <DataLine label="Perfil" value={roleLabel(user?.role)} tone="text-primary" />
            </div>
            {primaryItem && (
              <Link href={primaryItem.href} className="group mt-8 flex min-h-12 items-center justify-between border-t border-border/70 pt-4 text-sm font-semibold text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex items-center gap-2"><Crosshair className="size-4 text-primary" aria-hidden />Iniciar: {primaryItem.label}</span>
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />
              </Link>
            )}
          </div>
        </div>
      </header>

      {visibleItems.length === 0 ? (
        <EmptyState
          className="mt-8"
          title="Nenhum comando disponível"
          description="Seu perfil não possui ferramentas liberadas nesta trilha operacional."
          action={<Link href="/inicio" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"><LockKeyhole className="size-4" aria-hidden />Voltar ao centro de comando</Link>}
        />
      ) : (
        <div className="mt-8 grid gap-8 xl:grid-cols-[240px_1fr]">
          <aside className="hidden xl:block">
            <div className="sticky top-24 border-l border-border/75 pl-5">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Mission sequence</div>
              <ol className="mt-5 space-y-5">
                {sections.map((section, index) => (
                  <li key={section.section ?? index} className="grid grid-cols-[28px_1fr] gap-3">
                    <span className="font-mono text-[10px] text-primary">{String(index + 1).padStart(2, '0')}</span>
                    <span><span className="block text-sm font-semibold text-foreground">{section.section ? SECTION_LABEL[section.section] : 'Ferramentas'}</span><span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">{section.items.length} commands</span></span>
                  </li>
                ))}
              </ol>
            </div>
          </aside>

          <div className="space-y-10">
            {sections.map((section, sectionIndex) => (
              <section key={section.section ?? sectionIndex} aria-labelledby={`section-${section.section ?? sectionIndex}`}>
                <div className="grid grid-cols-[46px_1fr_auto] items-end gap-3 border-b border-border/75 pb-3">
                  <span className="font-mono text-xs text-primary">{String(sectionIndex + 1).padStart(2, '0')}</span>
                  <div><div className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">Sequence block</div><h2 id={`section-${section.section ?? sectionIndex}`} className="mt-1 text-xl font-semibold tracking-tight text-foreground">{section.section ? SECTION_LABEL[section.section] : 'Ferramentas'}</h2></div>
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{section.items.length} commands</span>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {section.items.map((item, itemIndex) => {
                    const ItemIcon = item.icon;
                    return (
                      <Link key={item.href} href={item.href} className="command-surface command-hover group grid min-h-[142px] grid-cols-[46px_1fr_auto] gap-4 rounded-md p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                        <div className="font-mono text-[10px] text-muted-foreground/50">{String(sectionIndex + 1).padStart(2, '0')}.{String(itemIndex + 1).padStart(2, '0')}</div>
                        <div className="min-w-0"><div className="flex items-center gap-3"><span className={cn('flex size-9 items-center justify-center border border-border/75', group.boxClass)}><ItemIcon className={cn('size-4', group.iconClass)} aria-hidden /></span><h3 className="text-base font-semibold tracking-tight text-foreground">{item.label}</h3></div><p className="mt-4 text-sm leading-6 text-muted-foreground">{item.description}</p></div>
                        <ArrowRight className="mt-2 size-4 text-muted-foreground/40 transition-transform group-hover:translate-x-1 group-hover:text-primary" aria-hidden />
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DataLine({ label, value, tone = 'text-foreground' }: { label: string; value: string; tone?: string }) {
  return <div className="flex items-center justify-between gap-4 border-b border-border/55 pb-2"><span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{label}</span><span className={cn('font-mono text-xs font-semibold', tone)}>{value}</span></div>;
}

function roleLabel(role?: string) {
  if (role === 'admin') return 'ADMIN';
  if (role === 'gestor') return 'MANAGER';
  return 'OPERATOR';
}
