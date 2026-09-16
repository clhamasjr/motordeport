'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, ChevronRight, Command, Home, Orbit, Radio, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AuthUser } from '@/hooks/use-auth';
import {
  SECTION_LABEL,
  agruparPorSecao,
  getVisibleGroups,
  getVisibleItems,
  moduloDoPath,
  type NavGroup,
} from '@/lib/nav';

type SidebarContentProps = {
  user: AuthUser;
  onNavigate?: () => void;
};

const linkFocus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

export function SidebarContent({ user, onNavigate }: SidebarContentProps) {
  const pathname = usePathname();
  const currentModule = moduloDoPath(pathname);

  return (
    <div className="flex h-full flex-col border-r border-border/75 bg-[hsl(var(--background)/.92)] backdrop-blur-2xl">
      <div className="border-b border-border/70 px-4 py-5 pr-14 lg:pr-4">
        <Link href="/inicio" onClick={onNavigate} className={cn('group flex items-center gap-3 rounded-md', linkFocus)}>
          <div className="command-mark flex size-10 items-center justify-center bg-primary text-primary-foreground">
            <Command className="size-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-extrabold uppercase tracking-[0.12em] text-foreground">FlowForce</span>
              <span className="font-mono text-[9px] text-primary">CC</span>
            </div>
            <div className="truncate font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Operational command</div>
          </div>
        </Link>
      </div>

      <nav aria-label="Navegação principal" className="flex-1 overflow-y-auto px-3 py-4 scrollbar-thin">
        <div className="space-y-1">
          <TopLink href="/inicio" icon={Home} code="00" label="Centro de comando" active={pathname === '/inicio'} onNavigate={onNavigate} />
          {user.role === 'admin' && (
            <TopLink href="/orquestrador" icon={Orbit} code="SYS" label="Orquestrador" active={pathname === '/orquestrador'} onNavigate={onNavigate} />
          )}
        </div>

        {currentModule ? (
          <ModuleNavigation module={currentModule} pathname={pathname} user={user} onNavigate={onNavigate} />
        ) : (
          <ModuleList user={user} onNavigate={onNavigate} />
        )}
      </nav>

      <div className="border-t border-border/70 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_hsl(142_70%_50%/.8)]" aria-hidden />
            Node online
          </div>
          <ShieldCheck className="size-3.5 text-muted-foreground" aria-label="Sessão protegida" />
        </div>
      </div>
    </div>
  );
}

function TopLink({ href, icon: Icon, code, label, active, onNavigate }: {
  href: string; icon: React.ElementType; code: string; label: string; active: boolean; onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'command-nav-row group grid min-h-11 grid-cols-[34px_1fr_auto] items-center gap-2 rounded-md px-2.5 text-sm transition-colors',
        linkFocus,
        active ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-secondary/45 hover:text-foreground',
      )}
    >
      <span className={cn('font-mono text-[10px]', active ? 'text-primary' : 'text-muted-foreground/55')}>{code}</span>
      <span className="flex items-center gap-2.5"><Icon className="size-3.5" aria-hidden /><span className="font-medium">{label}</span></span>
      {active && <Radio className="size-3 text-primary" aria-hidden />}
    </Link>
  );
}

function ModuleList({ user, onNavigate }: { user: AuthUser; onNavigate?: () => void }) {
  const groups = getVisibleGroups(user.role);
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between px-2.5 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground/65">
        <span>Operational lanes</span><span>{String(groups.length).padStart(2, '0')}</span>
      </div>
      <div className="space-y-0.5">
        {groups.map((group, index) => {
          const Icon = group.icon;
          return (
            <Link key={group.k} href={group.base} onClick={onNavigate} className={cn('group grid min-h-11 grid-cols-[34px_28px_1fr_auto] items-center gap-2 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-secondary/45 hover:text-foreground', linkFocus)}>
              <span className="font-mono text-[10px] text-muted-foreground/45">{String(index + 1).padStart(2, '0')}</span>
              <span className={cn('flex size-7 items-center justify-center border border-border/70', group.boxClass)}><Icon className={cn('size-3.5', group.iconClass)} aria-hidden /></span>
              <span className="font-medium">{group.label}</span>
              <ChevronRight className="size-3.5 text-muted-foreground/35 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function ModuleNavigation({ module, pathname, user, onNavigate }: {
  module: NavGroup; pathname: string; user: AuthUser; onNavigate?: () => void;
}) {
  const Icon = module.icon;
  const visibleItems = getVisibleItems(module, user.role);
  const sections = agruparPorSecao(visibleItems);

  return (
    <div className="mt-5">
      <Link href="/inicio" onClick={onNavigate} className={cn('mb-3 flex min-h-10 items-center gap-2 rounded-md px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:bg-secondary/40 hover:text-foreground', linkFocus)}>
        <ArrowLeft className="size-3.5" aria-hidden /> Back to lanes
      </Link>
      <Link href={module.base} onClick={onNavigate} aria-current={pathname === module.base ? 'page' : undefined} className={cn('grid grid-cols-[36px_1fr_auto] items-center gap-3 border-y border-border/70 px-2 py-3', linkFocus, pathname === module.base && 'bg-primary/5')}>
        <span className={cn('flex size-9 items-center justify-center border border-border', module.boxClass)}><Icon className={cn('size-4', module.iconClass)} aria-hidden /></span>
        <span><span className="block text-sm font-bold">{module.label}</span><span className="block text-[10px] text-muted-foreground">{visibleItems.length} tools online</span></span>
        <Radio className="size-3.5 text-primary" aria-hidden />
      </Link>

      {visibleItems.length === 0 ? (
        <p className="mt-4 border border-dashed border-border p-3 text-xs leading-5 text-muted-foreground">Nenhuma ferramenta deste módulo está disponível para seu perfil.</p>
      ) : (
        <div className="mt-2">
          {sections.map((section, index) => (
            <div key={section.section ?? index} className="mt-4">
              {section.section && <div className="mb-1 flex items-center gap-2 px-2.5 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/65"><span className="text-primary">{String(index + 1).padStart(2, '0')}</span><span>{SECTION_LABEL[section.section]}</span></div>}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const ItemIcon = item.icon;
                  const active = pathname === item.href;
                  return (
                    <Link key={item.href} href={item.href} onClick={onNavigate} aria-current={active ? 'page' : undefined} title={item.description} className={cn('command-nav-row flex min-h-9 items-center gap-3 rounded-md px-2.5 text-[13px] transition-colors', linkFocus, active ? 'bg-primary/10 font-medium text-foreground' : 'text-muted-foreground hover:bg-secondary/45 hover:text-foreground')}>
                      <ItemIcon className={cn('size-3.5 shrink-0', active && 'text-primary')} aria-hidden /><span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ user }: { user: AuthUser }) {
  return <aside className="relative z-30 hidden w-72 shrink-0 flex-col lg:flex"><SidebarContent user={user} /></aside>;
}
