'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, ArrowLeft, ChevronRight, Command, Home } from 'lucide-react';
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
    <div className="flex h-full flex-col border-r border-border/70 bg-[hsl(var(--background)/.94)] backdrop-blur-xl">
      <div className="border-b border-border/65 p-4 pr-14 lg:pr-4">
        <Link href="/inicio" onClick={onNavigate} className={cn('group flex items-center gap-3 rounded-md', linkFocus)}>
          <div className="command-mark flex size-10 items-center justify-center bg-[hsl(var(--brand-orange))] text-black">
            <Command className="size-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-extrabold tracking-[-0.02em] text-foreground">FlowForce</div>
            <div className="truncate text-[10px] text-muted-foreground">Uma plataforma LhamasCred</div>
          </div>
        </Link>
      </div>

      <nav aria-label="Navegação principal" className="flex-1 overflow-y-auto p-3 scrollbar-thin">
        <div className="space-y-1">
          <TopLink href="/inicio" icon={Home} label="Início" active={pathname === '/inicio'} onNavigate={onNavigate} />
          {user.role === 'admin' && (
            <TopLink href="/orquestrador" icon={Activity} label="Orquestrador" active={pathname === '/orquestrador'} onNavigate={onNavigate} />
          )}
        </div>

        {currentModule ? (
          <ModuleNavigation module={currentModule} pathname={pathname} user={user} onNavigate={onNavigate} />
        ) : (
          <ModuleList user={user} onNavigate={onNavigate} />
        )}
      </nav>

      <div className="border-t border-border/65 px-4 py-3 text-center text-[10px] text-muted-foreground/65">
        FlowForce · LhamasCred
      </div>
    </div>
  );
}

function TopLink({ href, icon: Icon, label, active, onNavigate }: {
  href: string; icon: React.ElementType; label: string; active: boolean; onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'command-nav-row flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
        linkFocus,
        active ? 'bg-[hsl(var(--brand-orange)/.1)] text-foreground' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
      )}
    >
      <Icon className={cn('size-4', active && 'text-[hsl(var(--brand-orange))]')} aria-hidden />
      <span>{label}</span>
    </Link>
  );
}

function ModuleList({ user, onNavigate }: { user: AuthUser; onNavigate?: () => void }) {
  const groups = getVisibleGroups(user.role);
  return (
    <div className="mt-6">
      <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/65">Módulos</div>
      <div className="space-y-0.5">
        {groups.map((group) => {
          const Icon = group.icon;
          return (
            <Link key={group.k} href={group.base} onClick={onNavigate} className={cn('group flex min-h-11 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground', linkFocus)}>
              <span className={cn('flex size-8 items-center justify-center rounded-md border border-border/65', group.boxClass)}><Icon className={cn('size-4', group.iconClass)} aria-hidden /></span>
              <span className="flex-1 font-medium">{group.label}</span>
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
      <Link href="/inicio" onClick={onNavigate} className={cn('mb-2 flex min-h-10 items-center gap-2 rounded-md px-3 text-xs text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground', linkFocus)}>
        <ArrowLeft className="size-3.5" aria-hidden />
        Todos os módulos
      </Link>

      <Link href={module.base} onClick={onNavigate} aria-current={pathname === module.base ? 'page' : undefined} className={cn('command-nav-row flex min-h-12 items-center gap-3 rounded-md px-3 transition-colors', linkFocus, pathname === module.base ? 'bg-[hsl(var(--brand-orange)/.1)]' : 'hover:bg-secondary/40')}>
        <span className={cn('flex size-8 items-center justify-center rounded-md border border-border/65', module.boxClass)}><Icon className={cn('size-4', module.iconClass)} aria-hidden /></span>
        <span className="flex-1 text-sm font-semibold">{module.label}</span>
      </Link>

      {visibleItems.length === 0 ? (
        <p className="mx-3 mt-3 border border-dashed border-border p-3 text-xs leading-5 text-muted-foreground">Nenhuma ferramenta disponível para seu perfil.</p>
      ) : (
        <div className="mt-2">
          {sections.map((section, index) => (
            <div key={section.section ?? index} className="mt-4">
              {section.section && <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/65">{SECTION_LABEL[section.section]}</div>}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const ItemIcon = item.icon;
                  const active = pathname === item.href;
                  return (
                    <Link key={item.href} href={item.href} onClick={onNavigate} aria-current={active ? 'page' : undefined} title={item.description} className={cn('command-nav-row flex min-h-9 items-center gap-3 rounded-md px-3 text-[13px] transition-colors', linkFocus, active ? 'bg-[hsl(var(--brand-orange)/.1)] font-medium text-foreground' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground')}>
                      <ItemIcon className={cn('size-3.5 shrink-0', active && 'text-[hsl(var(--brand-orange))]')} aria-hidden />
                      <span className="truncate">{item.label}</span>
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
  return <aside className="relative z-30 hidden w-64 shrink-0 flex-col lg:flex"><SidebarContent user={user} /></aside>;
}
