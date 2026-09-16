'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, ArrowLeft, Command, Home } from 'lucide-react';
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
  mobile?: boolean;
  collapsed?: boolean;
};

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--brand-orange))] focus-visible:ring-offset-2 focus-visible:ring-offset-[#17181d]';

export function SidebarContent({ user, onNavigate, mobile = false, collapsed = false }: SidebarContentProps) {
  const pathname = usePathname();
  const currentModule = moduloDoPath(pathname);

  if (mobile) {
    return (
      <div className="workspace-context flex h-full flex-col">
        <BrandHeader onNavigate={onNavigate} />
        <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
          <PrimaryLinks pathname={pathname} user={user} onNavigate={onNavigate} />
          {currentModule ? (
            <ModuleContext module={currentModule} pathname={pathname} user={user} onNavigate={onNavigate} mobile />
          ) : (
            <MobileProductList user={user} onNavigate={onNavigate} />
          )}
        </div>
        <Endorsement />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <ProductRail pathname={pathname} user={user} onNavigate={onNavigate} />
      {!collapsed && (
        <div className="workspace-sidebar-context workspace-context flex w-[232px] min-w-0 flex-1 flex-col overflow-hidden border-r border-white/5">
          <ContextHeader currentModule={currentModule} />
          <div className="flex-1 overflow-y-auto px-3 pb-4 scrollbar-thin">
            {currentModule ? (
              <ModuleContext module={currentModule} pathname={pathname} user={user} onNavigate={onNavigate} />
            ) : (
              <WorkspaceContext pathname={pathname} user={user} onNavigate={onNavigate} />
            )}
          </div>
          <Endorsement />
        </div>
      )}
    </div>
  );
}

function ProductRail({ pathname, user, onNavigate }: { pathname: string; user: AuthUser; onNavigate?: () => void }) {
  const groups = getVisibleGroups(user.role);
  const current = moduloDoPath(pathname);

  return (
    <nav aria-label="Produtos FlowForce" className="workspace-rail flex w-[72px] shrink-0 flex-col items-center border-r border-white/5 py-3">
      <RailLink href="/inicio" label="FlowForce" active={pathname === '/inicio'} onNavigate={onNavigate} prominent>
        <Command className="size-5" aria-hidden />
      </RailLink>

      <div className="my-3 h-px w-7 bg-white/10" aria-hidden />

      <RailLink href="/inicio" label="Início" active={pathname === '/inicio'} onNavigate={onNavigate}>
        <Home className="size-4.5" aria-hidden />
      </RailLink>
      {user.role === 'admin' && (
        <RailLink href="/orquestrador" label="Orquestrador" active={pathname === '/orquestrador'} onNavigate={onNavigate}>
          <Activity className="size-4.5" aria-hidden />
        </RailLink>
      )}

      <div className="my-3 h-px w-7 bg-white/10" aria-hidden />

      <div className="flex flex-1 flex-col gap-1.5">
        {groups.map((group) => {
          const Icon = group.icon;
          return (
            <RailLink key={group.k} href={group.base} label={group.label} active={current?.k === group.k} onNavigate={onNavigate}>
              <Icon className={cn('size-4.5', current?.k === group.k ? 'text-[#111216]' : group.iconClass)} aria-hidden />
            </RailLink>
          );
        })}
      </div>

      <div className="mb-1 size-2 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,.12)]" title="Sistema disponível" aria-label="Sistema disponível" />
    </nav>
  );
}

function RailLink({ href, label, active, onNavigate, prominent, children }: {
  href: string;
  label: string;
  active: boolean;
  onNavigate?: () => void;
  prominent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative mb-1 flex size-11 items-center justify-center rounded-xl transition-all duration-150 ease-out',
        focusRing,
        prominent && 'mb-2 bg-[hsl(var(--brand-orange))] text-[#111216] shadow-[0_10px_26px_-12px_rgba(255,159,10,.8)]',
        !prominent && active && 'bg-[hsl(var(--brand-orange))] text-[#111216]',
        !prominent && !active && 'text-white/55 hover:bg-white/[0.07] hover:text-white',
      )}
    >
      {children}
      <span className="workspace-rail-tip absolute left-[calc(100%+12px)] z-50 whitespace-nowrap rounded-md bg-[#111216] px-2.5 py-1.5 text-xs font-medium text-white shadow-xl">
        {label}
      </span>
    </Link>
  );
}

function ContextHeader({ currentModule }: { currentModule: NavGroup | null }) {
  return (
    <div className="border-b border-white/[0.07] px-5 py-5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--brand-orange))]">
        {currentModule ? 'Produto' : 'Workspace'}
      </div>
      <div className="mt-2 text-lg font-semibold tracking-[-0.025em] text-white">
        {currentModule?.label || 'Visão geral'}
      </div>
      <p className="mt-1 text-xs leading-5 text-white/48">
        {currentModule?.desc || 'Acesse produtos, tarefas e saúde da operação.'}
      </p>
    </div>
  );
}

function BrandHeader({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="border-b border-white/[0.07] px-5 py-5 pr-14">
      <Link href="/inicio" onClick={onNavigate} className={cn('flex items-center gap-3 rounded-md', focusRing)}>
        <span className="flex size-10 items-center justify-center rounded-xl bg-[hsl(var(--brand-orange))] text-[#111216]">
          <Command className="size-5" aria-hidden />
        </span>
        <span>
          <span className="block text-sm font-extrabold tracking-[-0.02em] text-white">FlowForce</span>
          <span className="block text-[10px] text-white/45">Uma plataforma LhamasCred</span>
        </span>
      </Link>
    </div>
  );
}

function PrimaryLinks({ pathname, user, onNavigate }: { pathname: string; user: AuthUser; onNavigate?: () => void }) {
  return (
    <div className="space-y-1">
      <ContextLink href="/inicio" icon={Home} label="Início" active={pathname === '/inicio'} onNavigate={onNavigate} />
      {user.role === 'admin' && (
        <ContextLink href="/orquestrador" icon={Activity} label="Orquestrador" active={pathname === '/orquestrador'} onNavigate={onNavigate} />
      )}
    </div>
  );
}

function WorkspaceContext({ pathname, user, onNavigate }: { pathname: string; user: AuthUser; onNavigate?: () => void }) {
  const groups = getVisibleGroups(user.role);
  return (
    <div className="pt-4">
      <PrimaryLinks pathname={pathname} user={user} onNavigate={onNavigate} />
      <div className="mb-2 mt-7 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">Produtos</div>
      <div className="space-y-1">
        {groups.map((group) => {
          const Icon = group.icon;
          return (
            <ContextLink key={group.k} href={group.base} icon={Icon} label={group.label} active={false} onNavigate={onNavigate} tone={group.iconClass} />
          );
        })}
      </div>
    </div>
  );
}

function MobileProductList({ user, onNavigate }: { user: AuthUser; onNavigate?: () => void }) {
  const groups = getVisibleGroups(user.role);
  return (
    <div className="mt-7">
      <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">Produtos</div>
      <div className="grid grid-cols-2 gap-2">
        {groups.map((group) => {
          const Icon = group.icon;
          return (
            <Link key={group.k} href={group.base} onClick={onNavigate} className={cn('flex min-h-20 flex-col justify-between rounded-xl border border-white/[0.08] bg-white/[0.035] p-3 text-white transition-colors hover:bg-white/[0.07]', focusRing)}>
              <Icon className={cn('size-4.5', group.iconClass)} aria-hidden />
              <span className="text-sm font-semibold">{group.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function ModuleContext({ module, pathname, user, onNavigate, mobile = false }: {
  module: NavGroup;
  pathname: string;
  user: AuthUser;
  onNavigate?: () => void;
  mobile?: boolean;
}) {
  const Icon = module.icon;
  const visibleItems = getVisibleItems(module, user.role);
  const sections = agruparPorSecao(visibleItems);

  return (
    <div className={cn(mobile ? 'mt-6' : 'pt-4')}>
      {mobile && (
        <Link href="/inicio" onClick={onNavigate} className={cn('mb-4 flex min-h-10 items-center gap-2 rounded-lg text-xs text-white/55 hover:text-white', focusRing)}>
          <ArrowLeft className="size-4" aria-hidden /> Todos os produtos
        </Link>
      )}

      <Link
        href={module.base}
        onClick={onNavigate}
        aria-current={pathname === module.base ? 'page' : undefined}
        className={cn(
          'flex min-h-14 items-center gap-3 rounded-xl border px-3 transition-colors',
          focusRing,
          pathname === module.base ? 'border-[hsl(var(--brand-orange)/.55)] bg-[hsl(var(--brand-orange)/.11)]' : 'border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.06]',
        )}
      >
        <span className="flex size-9 items-center justify-center rounded-lg bg-white/[0.07]">
          <Icon className={cn('size-4.5', module.iconClass)} aria-hidden />
        </span>
        <span>
          <span className="block text-sm font-semibold text-white">Visão geral</span>
          <span className="block text-[10px] text-white/42">{visibleItems.length} ferramentas</span>
        </span>
      </Link>

      {sections.map((section, index) => (
        <div key={section.section ?? index} className="mt-6">
          {section.section && (
            <div className="mb-2 px-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/32">
              {SECTION_LABEL[section.section]}
            </div>
          )}
          <div className="space-y-0.5">
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
                    'flex min-h-10 items-center gap-3 rounded-lg px-3 text-[13px] transition-colors',
                    focusRing,
                    active ? 'bg-white text-[#17181d] shadow-sm' : 'text-white/58 hover:bg-white/[0.06] hover:text-white',
                  )}
                >
                  <ItemIcon className={cn('size-3.5 shrink-0', active ? 'text-[hsl(var(--brand-gold))]' : 'text-white/38')} aria-hidden />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function ContextLink({ href, icon: Icon, label, active, onNavigate, tone }: {
  href: string;
  icon: React.ElementType;
  label: string;
  active: boolean;
  onNavigate?: () => void;
  tone?: string;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors',
        focusRing,
        active ? 'bg-white text-[#17181d]' : 'text-white/58 hover:bg-white/[0.06] hover:text-white',
      )}
    >
      <Icon className={cn('size-4', active ? 'text-[hsl(var(--brand-gold))]' : tone || 'text-white/38')} aria-hidden />
      <span className="font-medium">{label}</span>
    </Link>
  );
}

function Endorsement() {
  return (
    <div className="border-t border-white/[0.07] px-5 py-4">
      <div className="text-[9px] uppercase tracking-[0.16em] text-white/28">Endossado por</div>
      <div className="mt-1 text-xs font-semibold text-white/62">LhamasCred</div>
    </div>
  );
}

export function Sidebar({ user, collapsed }: { user: AuthUser; collapsed: boolean }) {
  return (
    <aside className={cn('workspace-sidebar relative z-30 hidden shrink-0 flex-col transition-[width] duration-200 ease-out lg:flex', collapsed ? 'w-[72px]' : 'w-[304px]')}>
      <SidebarContent user={user} collapsed={collapsed} />
    </aside>
  );
}
