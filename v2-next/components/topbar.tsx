'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AuthUser, useAuth } from '@/hooks/use-auth';
import { LogOut, Search, User as UserIcon } from 'lucide-react';

export function Topbar({ user }: { user: AuthUser }) {
  const { logout } = useAuth();

  return (
    <header className="h-14 border-b border-border bg-card flex items-center px-4 gap-4 flex-shrink-0">
      {/* Search global (placeholder) */}
      <div className="flex-1 max-w-md relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Buscar CPF ou nome..." className="pl-9 h-9" />
      </div>

      {/* User pill */}
      <div className="flex items-center gap-3">
        <div className="text-right hidden sm:block">
          <div className="text-sm font-medium leading-tight">{user.name || user.username}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
            {user.role === 'admin' ? 'Administrador' : user.role === 'gestor' ? 'Gestor' : 'Operador'}
            {user.nome_parceiro && ` · ${user.nome_parceiro}`}
          </div>
        </div>
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
          <UserIcon className="w-4 h-4 text-primary" />
        </div>
        <Button variant="ghost" size="icon" onClick={logout} title="Sair">
          <LogOut className="w-4 h-4" />
        </Button>
      </div>
    </header>
  );
}
