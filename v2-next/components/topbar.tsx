'use client';

import { usePathname } from 'next/navigation';
import { Activity, Command, Home, LogOut, User as UserIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuthUser, useAuth } from '@/hooks/use-auth';
import { moduloDoPath } from '@/lib/nav';
import { InstallPwaButton } from '@/components/install-pwa-button';
import { MobileNav } from '@/components/mobile-nav';

export function Topbar({ user }: { user: AuthUser }) {
  const { logout } = useAuth();
  const pathname = usePathname();
  const context = getPageContext(pathname);
  const PageIcon = context.icon;

  return (
    <header className="sticky top-0 z-20 flex min-h-16 shrink-0 items-center gap-3 border-b border-border/70 bg-[hsl(var(--background)/.88)] px-3 py-2 backdrop-blur-xl sm:px-5">
      <MobileNav user={user} />

      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="hidden size-9 shrink-0 items-center justify-center rounded-md border border-border/70 bg-card/55 text-[hsl(var(--brand-orange))] sm:flex">
          <PageIcon className="size-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold leading-tight text-foreground">{context.title}</div>
          <div className="hidden truncate text-[11px] text-muted-foreground sm:block">{context.subtitle}</div>
        </div>
      </div>

      <InstallPwaButton />

      <div className="flex items-center gap-1 sm:gap-3">
        <div className="hidden text-right md:block">
          <div className="max-w-48 truncate text-sm font-medium leading-tight">{user.name || user.username}</div>
          <div className="max-w-48 truncate text-[10px] text-muted-foreground">
            {roleLabel(user.role)}{user.nome_parceiro && ` · ${user.nome_parceiro}`}
          </div>
        </div>
        <div className="command-mark flex size-9 items-center justify-center bg-[hsl(var(--brand-orange))] text-black" title={user.name || user.username}>
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
  if (pathname === '/inicio') return { title: 'Início', subtitle: 'Visão geral da operação', icon: Home };
  if (pathname === '/orquestrador') return { title: 'Orquestrador', subtitle: 'Saúde e integrações da plataforma', icon: Activity };

  const currentModule = moduloDoPath(pathname);
  if (!currentModule) return { title: 'FlowForce', subtitle: 'Plataforma operacional LhamasCred', icon: Command };

  const item = currentModule.items.find((candidate) => candidate.href === pathname);
  return {
    title: item?.label || currentModule.label,
    subtitle: item ? `${currentModule.label} · ${currentModule.desc}` : currentModule.desc,
    icon: item?.icon || currentModule.icon,
  };
}

function roleLabel(role: AuthUser['role']) {
  if (role === 'admin') return 'Administrador';
  if (role === 'gestor') return 'Gestor';
  return 'Operador';
}
