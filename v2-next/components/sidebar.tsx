'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { AuthUser } from '@/hooks/use-auth';
import {
  Home, Search, BookOpen, Target, Trophy, Download,
  ListChecks, FileText, MessageSquare, Settings, Building2, Landmark,
  Briefcase, Zap, ChevronRight, Smartphone,
} from 'lucide-react';
import { useState } from 'react';

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  needsRole?: ('admin' | 'gestor' | 'operador')[];
}

interface NavGroup {
  k: string;
  icon: React.ElementType;
  label: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    k: 'inss', icon: Briefcase, label: 'INSS',
    items: [
      { href: '/inss/consulta', label: 'Consulta', icon: Search },
      { href: '/inss/esteira', label: 'Esteira', icon: ListChecks },
      { href: '/inss/propostas', label: 'Propostas', icon: FileText },
    ],
  },
  {
    k: 'clt', icon: Building2, label: 'CLT',
    items: [
      { href: '/clt/consulta', label: 'Consulta Unitária', icon: Search },
      { href: '/clt/catalogo', label: 'Catálogo de Bancos', icon: BookOpen },
      { href: '/clt/analise', label: 'Análise de Cliente', icon: Target },
      { href: '/clt/empresas-aprovadas', label: 'Empresas Aprovadas', icon: Trophy },
      { href: '/clt/extrair-caged', label: 'Extrair Base CAGED', icon: Download, needsRole: ['gestor', 'admin'] },
      { href: '/clt/analise-lote', label: 'Análise em Lote', icon: ListChecks },
      { href: '/clt/esteira', label: 'Esteira', icon: ListChecks },
      { href: '/clt/conversas', label: 'Conversas IA', icon: MessageSquare },
      { href: '/clt/conexao-whatsapp', label: 'Conexão WhatsApp', icon: Smartphone, needsRole: ['gestor', 'admin'] },
    ],
  },
  {
    k: 'gov', icon: Landmark, label: 'Governos',
    items: [
      { href: '/governos/federal', label: 'Federal (SIAPE)', icon: FileText },
      { href: '/governos/estaduais', label: 'Estaduais', icon: FileText },
      { href: '/governos/municipais', label: 'Municipais', icon: FileText },
    ],
  },
  {
    k: 'pref', icon: Building2, label: 'Prefeituras',
    items: [
      { href: '/prefeituras/catalogo', label: 'Catálogo', icon: BookOpen },
    ],
  },
  {
    k: 'admin', icon: Settings, label: 'Admin',
    items: [
      { href: '/admin/usuarios', label: 'Usuários', icon: Settings, needsRole: ['admin'] },
      { href: '/admin/parceiros', label: 'Parceiros', icon: Building2, needsRole: ['admin'] },
    ],
  },
];

export function Sidebar({ user }: { user: AuthUser }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<Record<string, boolean>>(
    () => Object.fromEntries(NAV.map((g) => [g.k, true])),
  );

  const canSee = (item: NavItem) => {
    if (!item.needsRole) return true;
    return item.needsRole.includes(user.role);
  };

  return (
    <aside className="w-64 border-r border-border bg-card flex flex-col flex-shrink-0">
      {/* Logo */}
      <div className="p-4 border-b border-border">
        <Link href="/inicio" className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Zap className="w-4 h-4 text-primary" />
          </div>
          <div>
            <div className="font-bold text-sm leading-tight">FlowForce</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">V2 · Plataforma de crédito</div>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        <Link
          href="/inicio"
          className={cn(
            'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
            pathname === '/inicio' ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-secondary',
          )}
        >
          <Home className="w-4 h-4" />
          <span>Início</span>
        </Link>

        {NAV.map((group) => {
          const visibleItems = group.items.filter(canSee);
          if (!visibleItems.length) return null;
          const Icon = group.icon;
          const isOpen = open[group.k];
          return (
            <div key={group.k} className="pt-3">
              <button
                onClick={() => setOpen((o) => ({ ...o, [group.k]: !o[group.k] }))}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                <Icon className="w-3 h-3" />
                <span className="flex-1 text-left">{group.label}</span>
                <ChevronRight className={cn('w-3 h-3 transition-transform', isOpen && 'rotate-90')} />
              </button>
              {isOpen && (
                <div className="mt-1 space-y-0.5">
                  {visibleItems.map((item) => {
                    const ItemIcon = item.icon;
                    const active = pathname === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          'flex items-center gap-3 pl-6 pr-3 py-1.5 rounded-md text-sm transition-colors',
                          active ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-secondary text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <ItemIcon className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Versão */}
      <div className="p-3 border-t border-border">
        <div className="text-[10px] text-muted-foreground text-center">
          V2 · Beta · {process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.substring(0, 7) || 'dev'}
        </div>
      </div>
    </aside>
  );
}
