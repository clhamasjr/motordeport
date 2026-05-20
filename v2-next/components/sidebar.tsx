'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { AuthUser } from '@/hooks/use-auth';
import {
  Home, Search, BookOpen, Target, Trophy, Download,
  ListChecks, FileText, MessageSquare, Settings, Building2, Landmark,
  Briefcase, Zap, ChevronRight, Smartphone, Sparkles, Activity, ChevronDown,
} from 'lucide-react';
import { useEffect, useState } from 'react';

type Section = 'consultar' | 'operar' | 'ia' | 'esteira' | 'config';

const SECTION_LABEL: Record<Section, string> = {
  consultar: 'Consultar',
  operar: 'Operar',
  ia: 'IA & Disparo',
  esteira: 'Esteira & Propostas',
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
      { href: '/inss/extrato-pdf', label: 'Ler Extrato PDF', icon: FileText, section: 'consultar' },
      { href: '/inss/in100', label: 'IN100 (DataPrev)', icon: Trophy, section: 'consultar' },
      { href: '/inss/enquadramento', label: 'Enquadramento (Manual)', icon: Target, section: 'consultar' },
      // ── Operar ──
      { href: '/inss/higienizacao', label: 'Higienização (XLSX)', icon: Sparkles, section: 'operar' },
      { href: '/inss/rmc-rcc', label: 'RMC/RCC + Saque', icon: BookOpen, section: 'operar' },
      { href: '/inss/pipeline', label: 'Pipeline', icon: ListChecks, section: 'operar' },
      // ── IA & Disparo ──
      { href: '/inss/conversas', label: 'Sofia (Conversas)', icon: MessageSquare, section: 'ia' },
      { href: '/inss/disparo', label: 'Disparo em massa', icon: MessageSquare, section: 'ia' },
      // ── Esteira & Propostas (depois de IA & Disparo) ──
      { href: '/inss/esteira', label: 'Esteira', icon: ListChecks, section: 'esteira' },
      { href: '/inss/propostas', label: 'Propostas', icon: FileText, section: 'esteira' },
      { href: '/inss/gestao', label: 'Painel Operacional', icon: Activity, needsRole: ['admin', 'gestor'], section: 'esteira' },
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
      { href: '/clt/analise', label: 'Análise de Cliente', icon: Target, section: 'consultar' },
      { href: '/clt/catalogo', label: 'Catálogo de Bancos', icon: BookOpen, section: 'consultar' },
      // ── Operar ──
      { href: '/clt/analise-lote', label: 'Análise em Lote', icon: ListChecks, section: 'operar' },
      { href: '/clt/empresas-aprovadas', label: 'Empresas Aprovadas', icon: Trophy, section: 'operar' },
      { href: '/clt/extrair-caged', label: 'Extrair Base CAGED', icon: Download, needsRole: ['gestor', 'admin'], section: 'operar' },
      // ── IA & Disparo ──
      { href: '/clt/conversas', label: 'Conversas IA', icon: MessageSquare, section: 'ia' },
      { href: '/clt/esteira', label: 'Esteira', icon: ListChecks, section: 'ia' },
      { href: '/clt/conexao-whatsapp', label: 'Conexão WhatsApp', icon: Smartphone, needsRole: ['gestor', 'admin'], section: 'ia' },
      // ── Config ──
      { href: '/clt/autorizacoes', label: 'Autorizações LGPD', icon: FileText, section: 'config' },
      { href: '/clt/painel', label: 'Painel Operacional', icon: Activity, needsRole: ['admin', 'gestor'], section: 'config' },
    ],
  },
  {
    k: 'gov', icon: Landmark, label: 'Governos',
    items: [
      { href: '/governos/catalogo', label: 'Catálogo de Convênios', icon: BookOpen },
      { href: '/governos/holerite', label: 'Análise de Holerite', icon: FileText },
    ],
  },
  {
    k: 'pref', icon: Building2, label: 'Prefeituras',
    items: [
      { href: '/prefeituras/catalogo', label: 'Catálogo', icon: BookOpen },
      { href: '/prefeituras/holerite', label: 'Análise de Holerite', icon: FileText },
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

// Chaves do localStorage pra persistir colapsos entre sessoes
const LS_GROUPS = 'flowforce_sidebar_groups_v2';
const LS_SECTIONS = 'flowforce_sidebar_sections_v2';

function loadLS<T extends Record<string, boolean>>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? { ...fallback, ...parsed } : fallback;
  } catch { return fallback; }
}

export function Sidebar({ user }: { user: AuthUser }) {
  const pathname = usePathname();

  // Grupos: por padrao todos abertos. Persiste em localStorage.
  const [open, setOpen] = useState<Record<string, boolean>>(
    () => Object.fromEntries(NAV.map((g) => [g.k, true])),
  );

  // Sections (Consultar/Operar/IA/Config dentro de cada grupo).
  // Chave: `${groupKey}:${section}` (ex: "clt:consultar"). Default: aberto.
  const [openSec, setOpenSec] = useState<Record<string, boolean>>({});

  // Hidrata estado do localStorage depois do mount (evita SSR mismatch)
  useEffect(() => {
    const groupsDefault = Object.fromEntries(NAV.map((g) => [g.k, true]));
    setOpen(loadLS(LS_GROUPS, groupsDefault));
    setOpenSec(loadLS(LS_SECTIONS, {}));
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem(LS_GROUPS, JSON.stringify(open)); } catch {}
  }, [open]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem(LS_SECTIONS, JSON.stringify(openSec)); } catch {}
  }, [openSec]);

  const canSee = (item: NavItem) => {
    if (!item.needsRole) return true;
    return item.needsRole.includes(user.role);
  };

  // Section eh "aberta" por padrao quando nao foi mexida ainda (key ausente)
  const isSectionOpen = (groupKey: string, section: Section) => {
    const k = `${groupKey}:${section}`;
    return openSec[k] !== false; // default true
  };
  const toggleSection = (groupKey: string, section: Section) => {
    const k = `${groupKey}:${section}`;
    setOpenSec((prev) => ({ ...prev, [k]: prev[k] === false ? true : false }));
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
                    return sections.map((sec, idx) => {
                      // Sections sem nome (ex: grupo Admin sem section): sempre aberta
                      if (!sec.section) {
                        return (
                          <div key={idx}>
                            {sec.items.map((item) => {
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
                        );
                      }
                      const secOpen = isSectionOpen(group.k, sec.section);
                      // Conta itens da section que estao na rota atual — destaca
                      const algumAtivo = sec.items.some((it) => pathname === it.href);
                      return (
                        <div key={idx}>
                          <button
                            onClick={() => toggleSection(group.k, sec.section!)}
                            className={cn(
                              'w-full flex items-center gap-1 pl-3 pr-2 pt-2 pb-0.5 text-[9px] uppercase tracking-wider font-semibold transition-colors',
                              algumAtivo
                                ? 'text-primary/70 hover:text-primary'
                                : 'text-muted-foreground/60 hover:text-foreground',
                            )}
                          >
                            <ChevronDown
                              className={cn(
                                'w-2.5 h-2.5 transition-transform flex-shrink-0',
                                !secOpen && '-rotate-90',
                              )}
                            />
                            <span className="flex-1 text-left">{SECTION_LABEL[sec.section]}</span>
                            <span className="text-muted-foreground/40 font-mono">{sec.items.length}</span>
                          </button>
                          {secOpen && (
                            <div className="space-y-0.5">
                              {sec.items.map((item) => {
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
                    });
                  })()}
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
