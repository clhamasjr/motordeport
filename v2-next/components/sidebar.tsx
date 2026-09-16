'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, ChevronRight, Compass, Home, Zap } from 'lucide-react';
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
    <div className="flex h-full flex-col glass-strong">
      <div className="border-b border-border/60 p-4 pr-14 lg:pr-4">
        <Link href="/inicio" onClick={onNavigate} className={cn('group flex items-center gap-3 rounded-lg', linkFocus)}>
          <div className="flex size-9 items-center justify-center rounded-xl bg-aurora shadow-[0_0_22px_-4px_hsl(var(--primary)/.7)] ring-1 ring-primary/30 transition-shadow group-hover:shadow-[0_0_28px_-2px_hsl(var(--accent)/.7)]">
            <Zap className="size-4 text-primary-foreground" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold leading-tight text-gradient">FlowForce</div>
            <div className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">Plataforma de crédito</div>
          </div>
        </Link>
      </div>

      <nav aria-label="Navegação principal" className="flex-1 space-y-1 overflow-y-auto p-2 scrollbar-thin">
        <TopLink href="/inicio" icon={Home} label="Início" active={pathname === '/inicio'} onNavigate={onNavigate} />
        {user.role === 'admin' && (
          <TopLink href="/orquestrador" icon={Compass} label="Orquestrador" active={pathname === '/orquestrador'} onNavigate={onNavigate} />
        )}

        {currentModule ? (
          <ModuleNavigation module={currentModule} pathname={pathname} user={user} onNavigate={onNavigate} />
        ) : (
          <ModuleList user={user} onNavigate={onNavigate} />
        )}
      </nav>

      <div className="border-t border-border/60 p-3">
        <div className="text-center text-[10px] text-muted-foreground">FlowForce · LhamasCred</div>
      </div>
    </div>
  );
}

function TopLink({
  href,
  icon: Icon,
  label,
  active,
  onNavigate,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors',
        linkFocus,
        active ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
      )}
    >
      <span
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-lg transition-all',
          active
            ? 'bg-aurora-subtle text-foreground shadow-[0_0_14px_-4px_hsl(var(--primary)/.55)] ring-1 ring-primary/30'
            : 'bg-secondary/40 text-muted-foreground',
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="flex-1 text-left">{label}</span>
    </Link>
  );
}

function ModuleList({ user, onNavigate }: { user: AuthUser; onNavigate?: () => void }) {
  const groups = getVisibleGroups(user.role);

  return (
    <div className="pt-3">
      <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">Módulos</div>
      {groups.map((group) => {
        const Icon = group.icon;
        return (
          <Link
            key={group.k}
            href={group.base}
            onClick={onNavigate}
            className={cn('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground', linkFocus)}
          >
            <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg', group.boxClass)}>
              <Icon className={cn('size-4', group.iconClass)} aria-hidden />
            </span>
            <span className="flex-1 text-left font-medium">{group.label}</span>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/40" aria-hidden />
          </Link>
        );
      })}
    </div>
  );
}

function ModuleNavigation({
  module,
  pathname,
  user,
  onNavigate,
}: {
  module: NavGroup;
  pathname: string;
  user: AuthUser;
  onNavigate?: () => void;
}) {
  const Icon = module.icon;
  const visibleItems = getVisibleItems(module, user.role);
  const sections = agruparPorSecao(visibleItems);

  return (
    <div className="pt-3">
      <Link
        href="/inicio"
        onClick={onNavigate}
        className={cn('mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground', linkFocus)}
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Todos os módulos
      </Link>

      <Link
        href={module.base}
        onClick={onNavigate}
        aria-current={pathname === module.base ? 'page' : undefined}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 transition-colors',
          linkFocus,
          pathname === module.base ? 'bg-aurora-subtle ring-1 ring-primary/30' : 'hover:bg-secondary/40',
        )}
      >
        <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg', module.boxClass)}>
          <Icon className={cn('size-4', module.iconClass)} aria-hidden />
        </span>
        <span className="flex-1 text-left text-sm font-bold">{module.label}</span>
      </Link>

      {visibleItems.length === 0 ? (
        <p className="mx-3 mt-3 rounded-lg border border-dashed border-border p-3 text-xs leading-5 text-muted-foreground">
          Nenhuma ferramenta deste módulo está disponível para seu perfil.
        </p>
      ) : (
        <div className="mt-1 space-y-1">
          {sections.map((section, index) => (
            <div key={section.section ?? index}>
              {section.section && (
                <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                  {SECTION_LABEL[section.section]}
                </div>
              )}
              {section.items.map((item) => {
                const ItemIcon = item.icon;
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    title={item.description}
                    className={cn(
                      'flex min-h-9 items-center gap-3 rounded-lg py-2 pl-5 pr-3 text-sm transition-all',
                      linkFocus,
                      active
                        ? 'bg-aurora-subtle font-medium text-foreground shadow-[0_0_14px_-6px_hsl(var(--primary)/.5)] ring-1 ring-primary/30'
                        : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
                    )}
                  >
                    <ItemIcon className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ user }: { user: AuthUser }) {
  return (
    <aside className="relative z-10 hidden w-64 shrink-0 flex-col border-r border-border/60 lg:flex">
      <SidebarContent user={user} />
    </aside>
  );
}
