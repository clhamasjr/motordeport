'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { AuthUser } from '@/hooks/use-auth';
import {
  Home, Search, BookOpen, Target, Trophy, Download,
  ListChecks, FileText, MessageSquare, Settings, Building2, Landmark,
  Briefcase, Zap, ChevronRight, Smartphone, Sparkles, Activity,
} from 'lucide-react';
import { useState } from 'react';

type Section = 'consultar' | 'operar' | 'ia' | 'config';

const SECTION_LABEL: Record<Section, string> = {
  consultar: 'Consultar',
  operar: 'Operar',
  ia: 'IA & Disparo',
  config: 'Config',
};

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  needsRole?: ('admin' | 'gestor' | 'operador')[];
  section?: Section;
}

interface NavGroup {
  k: string;
  icon: React.ElementType;
  label: string;
  items: NavItem[];
}

// Ordem das sections dentro de cada grupo (consultar -> operar -> ia -> config)
const NAV: NavGroup[] = [
  {
    k: 'inss', icon: Briefcase, label: 'INSS',
    items: [
      // ── Consultar ──
      { href: '/inss/consulta', label: 'Consulta Unitária', icon: Search, section: 'consultar' },
      { href: '/inss/in100', label: 'IN100 (DataPrev)', icon: Trophy, section: 'consultar' },
      { href: '/inss/enquadramento', label: 'Enquadramento (Manual)', icon: Target, section: 'consultar' },
      { href: '/inss/rmc-rcc', label: 'RMC/RCC + Saque', icon: BookOpen, section: 'consultar' },
      // ── Operar ──
      { href: '/inss/higienizacao', label: 'Higienização (XLSX)', icon: Sparkles, section: 'operar' },
      { href: '/inss/pipeline', label: 'Pipeline', icon: ListChecks, section: 'operar' },
      { href: '/inss/esteira', label: 'Esteira', icon: ListChecks, section: 'operar' },
      { href: '/inss/propostas', label: 'Propostas', icon: FileText, section: 'operar' },
      { href: '/inss/gestao', label: 'Painel Operacional', icon: Activity, needsRole: ['admin', 'gestor'], section: 'operar' },
      // ── IA & Disparo ──
      { href: '/inss/conversas', label: 'Sofia (Conversas)', icon: MessageSquare, section: 'ia' },
      { href: '/inss/disparo', label: 'Disparo em massa', icon: MessageSquare, section: 'ia' },
      // ── Config ──
      { href: '/inss/sofia-knowledge', label: 'Sofia — Knowledge', icon: BookOpen, needsRole: ['admin'], section: 'config' },
      { href: '/inss/conexao-whatsapp', label: 'Conexão WhatsApp', icon: Smartphone, needsRole: ['admin', 'gestor'], section: 'config' },
      { href: '/inss/motor-test', label: 'Motor — Testes', icon: Zap, needsRole: ['admin'], section: 'config' },
    ],
  },
  {
    k: 'clt', icon: Building2, label: 'CLT',
    items: [
      // ── Consultar ──
      { href: '/clt/consulta', label: 'Consulta Unitária', icon: Search, section: 'consultar' },
      { href: '/clt/analise-lote', label: 'Análise em Lote', icon: ListChecks, section: 'consultar' },
      { href: '/clt/analise', label: 'Análise de Cliente', icon: Target, section: 'consultar' },
      // ── Operar ──
      { href: '/clt/empresas-aprovadas', label: 'Empresas Aprovadas', icon: Trophy, section: 'operar' },
      { href: '/clt/esteira', label: 'Esteira', icon: ListChecks, section: 'operar' },
      // ── IA & Disparo ──
      { href: '/clt/conversas', label: 'Conversas IA', icon: MessageSquare, section: 'ia' },
      // ── Config ──
      { href: '/clt/catalogo', label: 'Catálogo de Bancos', icon: BookOpen, section: 'config' },
      { href: '/clt/extrair-caged', label: 'Extrair Base CAGED', icon: Download, needsRole: ['gestor', 'admin'], section: 'config' },
      { href: '/clt/conexao-whatsapp', label: 'Conexão WhatsApp', icon: Smartphone, needsRole: ['gestor', 'admin'], section: 'config' },
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
    <aside className="w-64 glass-strong border-r border-border/60 flex flex-col flex-shrink-0 relative z-10">
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
        <Link
          href="/inicio"
          className={cn(
            'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
            pathname === '/inicio'
              ? 'bg-aurora-subtle text-foreground font-medium ring-1 ring-primary/30 shadow-[0_0_18px_-6px_hsl(var(--primary)/.55)]'
              : 'hover:bg-secondary/60 text-muted-foreground hover:text-foreground',
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
                  {(() => {
                    // Agrupa visibleItems por section (preservando ordem original)
                    const sections: Array<{ section: Section | null; items: NavItem[] }> = [];
                    let last: Section | null | undefined = undefined;
                    for (const item of visibleItems) {
                      const s = item.section ?? null;
                      if (s !== last) {
                        sections.push({ section: s, items: [] });
                        last = s;
                      }
                      sections[sections.length - 1].items.push(item);
                    }
                    return sections.map((sec, idx) => (
                      <div key={idx}>
                        {sec.section && (
                          <div className="pl-6 pr-3 pt-2 pb-0.5 text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold">
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
                    ));
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Versão */}
      <div className="p-3 border-t border-border/60">
        <div className="text-[10px] text-muted-foreground text-center">
          V2 · Beta · {process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.substring(0, 7) || 'dev'}
        </div>
      </div>
    </aside>
  );
}
