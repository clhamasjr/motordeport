'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { AuthUser } from '@/hooks/use-auth';
import { Home, Zap, Compass, ArrowLeft, ChevronRight } from 'lucide-react';
import {
  NAV, SECTION_LABEL, agruparPorSecao, moduloDoPath,
  type NavItem, type Role,
} from '@/lib/nav';

/**
 * Conteúdo INTERNO da navegação lateral — CONTEXTUAL por módulo.
 *
 * - Na home (/inicio) ou no /orquestrador: lista os MÓDULOS (atalhos pros hubs).
 * - Dentro de um módulo (ex: /inss/*): mostra só as telas daquele módulo,
 *   agrupadas por seção, + um "← Módulos" pra voltar.
 *
 * Fonte de navegação: lib/nav.ts (compartilhada com as páginas-hub).
 * Usado pela `<Sidebar>` (desktop) e pelo `<MobileNav>` (drawer).
 */
export function SidebarContent({ user }: { user: AuthUser }) {
  const pathname = usePathname();
  const modulo = moduloDoPath(pathname);
  const canSee = (item: NavItem) =>
    !item.needsRole || item.needsRole.includes(user.role as Role);

  return (
    <div className="flex flex-col h-full glass-strong">
      {/* Logo */}
      <div className="p-4 border-b border-border/60">
        <Link href="/inicio" className="flex items-center gap-3 group">
          <div className="w-9 h-9 rounded-lg bg-aurora flex items-center justify-center ring-1 ring-primary/30 shadow-[0_0_22px_-4px_hsl(var(--primary)/.7)] group-hover:shadow-[0_0_28px_-2px_hsl(var(--accent)/.7)] transition-shadow">
            <Zap className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <div className="font-bold text-sm leading-tight text-gradient">FlowForce</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">V2 · Plataforma de crédito</div>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        <TopLink href="/inicio" icon={Home} label="Início" active={pathname === '/inicio'} />
        {user.role === 'admin' && (
          <TopLink href="/orquestrador" icon={Compass} label="Orquestrador" active={pathname === '/orquestrador'} />
        )}

        {modulo ? (
          <ModuloNav modulo={modulo} pathname={pathname} canSee={canSee} />
        ) : (
          <ModulosList user={user} />
        )}
      </nav>

      {/* Versão */}
      <div className="p-3 border-t border-border/60">
        <div className="text-[10px] text-muted-foreground text-center">
          V2 · Beta · {process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.substring(0, 7) || 'dev'}
        </div>
      </div>
    </div>
  );
}

// ── Link de topo (Início, Orquestrador) ────────────────────────────
function TopLink({ href, icon: Icon, label, active }: { href: string; icon: React.ElementType; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs uppercase tracking-wider font-semibold transition-colors',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <span
        className={cn(
          'w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 transition-all',
          active
            ? 'bg-aurora-subtle ring-1 ring-primary/30 text-foreground shadow-[0_0_14px_-4px_hsl(var(--primary)/.55)]'
            : 'bg-secondary/40 text-muted-foreground',
        )}
      >
        <Icon className="w-4 h-4" />
      </span>
      <span className="flex-1 text-left">{label}</span>
    </Link>
  );
}

// ── FORA de módulo: lista de módulos (atalhos pros hubs) ────────────
function ModulosList({ user }: { user: AuthUser }) {
  const grupos = NAV.filter((g) => {
    // só mostra o grupo se o user vê ao menos 1 item dele
    return g.items.some((it) => !it.needsRole || it.needsRole.includes(user.role as Role));
  });
  return (
    <div className="pt-3">
      <div className="px-3 pb-1 text-[9px] uppercase tracking-wider font-semibold text-muted-foreground/60">
        Módulos
      </div>
      {grupos.map((g) => {
        const Icon = g.icon;
        // Nota: quando pathname === g.base, o SidebarContent renderiza ModuloNav
        // (não esta lista) — então aqui nunca há item "ativo".
        return (
          <Link
            key={g.k}
            href={g.base}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-muted-foreground hover:text-foreground hover:bg-secondary/50"
          >
            <span className={cn('w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0', g.boxClass)}>
              <Icon className={cn('w-4 h-4', g.iconClass)} />
            </span>
            <span className="flex-1 text-left font-medium">{g.label}</span>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
          </Link>
        );
      })}
    </div>
  );
}

// ── DENTRO de módulo: telas do módulo por seção ─────────────────────
function ModuloNav({
  modulo, pathname, canSee,
}: {
  modulo: NonNullable<ReturnType<typeof moduloDoPath>>;
  pathname: string;
  canSee: (item: NavItem) => boolean;
}) {
  const Icon = modulo.icon;
  const visiveis = modulo.items.filter(canSee);
  const secoes = agruparPorSecao(visiveis);

  return (
    <div className="pt-3">
      {/* Voltar aos módulos */}
      <Link
        href="/inicio"
        className="w-full flex items-center gap-2 px-3 py-1.5 mb-1 rounded-md text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Módulos
      </Link>

      {/* Cabeçalho do módulo atual */}
      <Link
        href={modulo.base}
        className={cn(
          'w-full flex items-center gap-2.5 px-3 py-2 rounded-md transition-colors',
          pathname === modulo.base ? 'bg-aurora-subtle ring-1 ring-primary/30' : 'hover:bg-secondary/40',
        )}
      >
        <span className={cn('w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0', modulo.boxClass)}>
          <Icon className={cn('w-4 h-4', modulo.iconClass)} />
        </span>
        <span className="flex-1 text-left font-bold text-sm">{modulo.label}</span>
      </Link>

      {/* Seções */}
      <div className="mt-1 space-y-0.5">
        {secoes.map((sec, idx) => (
          <div key={idx}>
            {sec.section && (
              <div className="px-3 pt-3 pb-0.5 text-[9px] uppercase tracking-wider font-semibold text-muted-foreground/60">
                {SECTION_LABEL[sec.section]}
              </div>
            )}
            {sec.items.map((item) => {
              const ItemIcon = item.icon;
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 pl-6 pr-3 py-1.5 rounded-md text-sm transition-all',
                    active
                      ? 'bg-aurora-subtle text-foreground font-medium ring-1 ring-primary/30 shadow-[0_0_14px_-6px_hsl(var(--primary)/.5)]'
                      : 'hover:bg-secondary/50 text-muted-foreground hover:text-foreground',
                  )}
                >
                  <ItemIcon className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Sidebar desktop — wrapper fixo de 256px (w-64).
 * Escondida em telas < lg; nesses casos o `<MobileNav>` exibe o mesmo conteúdo.
 */
export function Sidebar({ user }: { user: AuthUser }) {
  return (
    <aside className="hidden lg:flex w-64 border-r border-border/60 flex-col flex-shrink-0 relative z-10">
      <SidebarContent user={user} />
    </aside>
  );
}
