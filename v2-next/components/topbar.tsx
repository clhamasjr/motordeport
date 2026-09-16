'use client';

import { usePathname } from 'next/navigation';
import { Activity, Command, Home, LogOut, User as UserIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuthUser, useAuth } from '@/hooks/use-auth';
import { moduloDoPath } from '@/lib/nav';
import { InstallPwaButton } from '@/components/install-pwa-button';
import { MobileNav } from '@/components/mobile-nav';
import { ThemeToggle } from '@/components/theme-toggle';

export function Topbar({ user }: { user: AuthUser }) {
  const { logout } = useAuth();
  const pathname = usePathname();
  const context = getPageContext(pathname);
  const PageIcon = context.icon;

  return (
    <header className="sticky top-0 z-20 flex min-h-[72px] shrink-0 items-center gap-3 border-b border-border/65 bg-[hsl(var(--card)/.88)] px-3 py-2 backdrop-blur-xl sm:px-6">
      <MobileNav user={user} />

      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="hidden size-9 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--secondary))] text-foreground sm:flex">
          <PageIcon className="size-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <div className="hidden text-[9px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--brand-gold))] sm:block">{context.eyebrow}</div>
          <div className="truncate text-sm font-semibold leading-tight text-foreground">{context.title}</div>
        </div>
      </div>

      <div className="hidden items-center gap-2 rounded-full border border-border/70 bg-background/65 px-3 py-1.5 text-[11px] text-muted-foreground xl:flex">
        <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
        Operação disponível
      </div>

      <InstallPwaButton />
      <ThemeToggle />

      <div className="flex items-center gap-1 sm:gap-2">
        <div className="hidden text-right md:block">
          <div className="max-w-48 truncate text-sm font-semibold leading-tight text-foreground">{user.name || user.username}</div>
          <div className="max-w-48 truncate text-[10px] text-muted-foreground">
            {roleLabel(user.role)}{user.nome_parceiro && ` · ${user.nome_parceiro}`}
          </div>
        </div>
        <div className="flex size-9 items-center justify-center rounded-xl bg-[#17181d] text-white" title={user.name || user.username}>
          <UserIcon className="size-4" aria-hidden />
        </div>
        <Button variant="ghost" size="icon" onClick={logout} title="Sair" aria-label="Sair da plataforma">
          <LogOut className="size-4" aria-hidden />
        </Button>
      </div>
    </header>
  );
}

function getPageContext(pathname: string) {
  if (pathname === '/inicio') return { title: 'Mesa de trabalho', eyebrow: 'FlowForce Workspace', icon: Home };
  if (pathname === '/orquestrador') return { title: 'Orquestrador', eyebrow: 'Saúde da operação', icon: Activity };

  const currentModule = moduloDoPath(pathname);
  if (!currentModule) return { title: 'FlowForce', eyebrow: 'Workspace operacional', icon: Command };

  const item = currentModule.items.find((candidate) => candidate.href === pathname);
  return {
    title: item?.label || currentModule.label,
    eyebrow: item ? currentModule.label : 'Visão do produto',
    icon: item?.icon || currentModule.icon,
  };
}

function roleLabel(role: AuthUser['role']) {
  if (role === 'admin') return 'Administrador';
  if (role === 'gestor') return 'Gestor';
  return 'Operador';
}
