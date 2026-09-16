'use client';

import { usePathname } from 'next/navigation';
import { Activity, Command, Home, LogOut, Radio, User as UserIcon, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuthUser, useAuth } from '@/hooks/use-auth';
import { NAV, moduloDoPath } from '@/lib/nav';
import { InstallPwaButton } from '@/components/install-pwa-button';
import { MobileNav } from '@/components/mobile-nav';

export function Topbar({ user }: { user: AuthUser }) {
  const { logout } = useAuth();
  const pathname = usePathname();
  const context = getPageContext(pathname);
  const PageIcon = context.icon;

  return (
    <header className="sticky top-0 z-20 flex min-h-16 shrink-0 items-center gap-3 border-b border-border/75 bg-[hsl(var(--background)/.82)] px-3 py-2 backdrop-blur-2xl sm:px-5">
      <MobileNav user={user} />
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="hidden size-9 shrink-0 items-center justify-center border border-border/80 bg-card/55 text-primary sm:flex">
          <PageIcon className="size-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            <span className="text-primary">{context.code}</span><span>/</span><span className="truncate">{context.channel}</span>
          </div>
          <div className="mt-0.5 truncate text-sm font-semibold leading-tight text-foreground">{context.title}</div>
        </div>
      </div>

      <div className="hidden items-center gap-2 border-x border-border/70 px-4 xl:flex">
        <Radio className="size-3.5 text-emerald-400" aria-hidden />
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">System live</span>
      </div>
      <InstallPwaButton />
      <div className="flex items-center gap-1 sm:gap-3">
        <div className="hidden text-right md:block">
          <div className="max-w-48 truncate text-sm font-medium leading-tight">{user.name || user.username}</div>
          <div className="max-w-48 truncate font-mono text-[9px] uppercase tracking-[0.13em] text-muted-foreground">
            {user.role === 'admin' ? 'Administrator' : user.role === 'gestor' ? 'Manager' : 'Operator'}
            {user.nome_parceiro && ` · ${user.nome_parceiro}`}
          </div>
        </div>
        <div className="command-mark flex size-9 items-center justify-center bg-primary text-primary-foreground" title={user.name || user.username}>
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
  if (pathname === '/inicio') return { code: 'CC-00', channel: 'overview', title: 'Centro de comando', subtitle: 'Visão geral dos produtos', icon: Home };
  if (pathname === '/orquestrador') return { code: 'SYS-01', channel: 'observability', title: 'Orquestrador', subtitle: 'Saúde e integrações da plataforma', icon: Activity };

  const currentModule = moduloDoPath(pathname);
  if (!currentModule) return { code: 'FF-00', channel: 'platform', title: 'FlowForce', subtitle: 'Plataforma de crédito', icon: Command };

  const item = currentModule.items.find((candidate) => candidate.href === pathname);
  const moduleIndex = NAV.findIndex((candidate) => candidate.k === currentModule.k) + 1;
  return {
    code: `OP-${String(moduleIndex).padStart(2, '0')}`,
    channel: currentModule.label,
    title: item?.label || currentModule.label,
    subtitle: item ? `${currentModule.label} · ${currentModule.desc}` : currentModule.desc,
    icon: item?.icon || currentModule.icon || Zap,
  };
}
