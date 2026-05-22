'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AuthUser, useAuth } from '@/hooks/use-auth';
import { LogOut, Search, User as UserIcon } from 'lucide-react';
import { InstallPwaButton } from '@/components/install-pwa-button';
import { MobileNav } from '@/components/mobile-nav';

export function Topbar({ user }: { user: AuthUser }) {
  const { logout } = useAuth();

  return (
    <header className="h-14 glass-subtle border-b border-border/60 flex items-center px-3 sm:px-4 gap-2 sm:gap-4 flex-shrink-0 sticky top-0 z-20">
      {/* Hamburger mobile — esconde em lg+ (sidebar fixa cobre) */}
      <MobileNav user={user} />

      {/* Search global (placeholder) */}
      <div className="flex-1 max-w-md relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Buscar CPF ou nome..."
          className="pl-9 h-9 bg-background/40 backdrop-blur-md border-border/60 focus-visible:border-primary/50 focus-visible:ring-primary/30"
        />
      </div>

      {/* PWA install (so aparece em browser que suporta + nao instalado) */}
      <InstallPwaButton />

      {/* User pill */}
      <div className="flex items-center gap-1 sm:gap-3">
        <div className="text-right hidden sm:block">
          <div className="text-sm font-medium leading-tight">{user.name || user.username}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
            {user.role === 'admin' ? 'Administrador' : user.role === 'gestor' ? 'Gestor' : 'Operador'}
            {user.nome_parceiro && ` · ${user.nome_parceiro}`}
          </div>
        </div>
        <div className="w-9 h-9 rounded-full bg-aurora flex items-center justify-center ring-1 ring-primary/30 shadow-[0_0_18px_-4px_hsl(var(--primary)/.6)]">
          <UserIcon className="w-4 h-4 text-primary-foreground" />
        </div>
        <Button variant="ghost" size="icon" onClick={logout} title="Sair">
          <LogOut className="w-4 h-4" />
        </Button>
      </div>
    </header>
  );
}
