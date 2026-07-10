// ════════════════════════════════════════════════════════════════════
// lib/nav.ts — fonte ÚNICA de navegação do FlowForce
//
// Usado pela sidebar (contextual, por módulo) e pelas páginas-hub de
// cada módulo (/inss, /clt, /fgts, /governos, /federal, /prefeituras).
// Mudou o menu? Muda aqui — os dois consomem daqui.
// ════════════════════════════════════════════════════════════════════

import {
  Search, BookOpen, Target, Trophy, Download,
  ListChecks, FileText, MessageSquare, Settings, Building2, Landmark,
  Briefcase, Zap, Smartphone, Sparkles, Activity, GitBranch, PiggyBank,
} from 'lucide-react';

export type Section = 'consultar' | 'operar' | 'ia' | 'esteira' | 'config';

export const SECTION_LABEL: Record<Section, string> = {
  consultar: 'Consultar',
  operar: 'Operar',
  ia: 'IA & Disparo',
  esteira: 'Esteira & Propostas',
  config: 'Config',
};

export type Role = 'admin' | 'gestor' | 'operador';

export interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  needsRole?: Role[];
  section?: Section;
}

export interface NavGroup {
  k: string;
  icon: React.ElementType;
  label: string;
  base: string;          // prefixo da rota / href do hub do módulo
  desc: string;          // subtítulo do módulo (header do hub)
  iconClass: string;     // cor do ícone (identidade do módulo)
  boxClass: string;      // fundo + anel da caixa do ícone
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    k: 'inss', icon: Briefcase, label: 'INSS', base: '/inss',
    desc: 'Aposentados e pensionistas',
    iconClass: 'text-purple-400',
    boxClass: 'bg-purple-500/10 ring-purple-500/25 group-hover:ring-purple-400/60',
    items: [
      { href: '/inss/consulta', label: 'Consulta Unitária', icon: Search, section: 'consultar' },
      { href: '/inss/extrato-pdf', label: 'Ler Extrato PDF', icon: FileText, section: 'consultar' },
      { href: '/inss/in100', label: 'IN100 (DataPrev)', icon: Trophy, section: 'consultar' },
      { href: '/inss/fintech-corban', label: 'Fintech do Corban', icon: Landmark, section: 'consultar' },
      { href: '/inss/enquadramento', label: 'Enquadramento (Manual)', icon: Target, section: 'consultar' },
      { href: '/inss/higienizacao', label: 'Higienização (XLSX)', icon: Sparkles, section: 'operar' },
      { href: '/inss/rmc-rcc', label: 'RMC/RCC + Saque', icon: BookOpen, section: 'operar' },
      { href: '/inss/pipeline', label: 'Pipeline', icon: ListChecks, section: 'operar' },
      { href: '/inss/conversas', label: 'Sofia (Conversas)', icon: MessageSquare, section: 'ia' },
      { href: '/inss/disparo', label: 'Disparo em massa', icon: MessageSquare, section: 'ia' },
      { href: '/inss/esteira', label: 'Esteira', icon: ListChecks, section: 'esteira' },
      { href: '/inss/propostas', label: 'Propostas', icon: FileText, section: 'esteira' },
      { href: '/inss/gestao', label: 'Painel Operacional', icon: Activity, needsRole: ['admin', 'gestor'], section: 'esteira' },
      { href: '/inss/sofia-knowledge', label: 'Sofia — Knowledge', icon: BookOpen, needsRole: ['admin'], section: 'config' },
      { href: '/inss/conexao-whatsapp', label: 'Conectar WhatsApp', icon: Smartphone, section: 'config' },
      { href: '/inss/motor-test', label: 'Motor — Testes', icon: Zap, needsRole: ['admin'], section: 'config' },
    ],
  },
  {
    k: 'clt', icon: Building2, label: 'CLT', base: '/clt',
    desc: 'Trabalhador de carteira assinada',
    iconClass: 'text-emerald-400',
    boxClass: 'bg-emerald-500/10 ring-emerald-500/25 group-hover:ring-emerald-400/60',
    items: [
      { href: '/clt/consulta', label: 'Consulta Unitária', icon: Search, section: 'consultar' },
      { href: '/clt/analise', label: 'Análise de Cliente', icon: Target, section: 'consultar' },
      { href: '/clt/catalogo', label: 'Catálogo de Bancos', icon: BookOpen, section: 'consultar' },
      { href: '/clt/aptos', label: 'Pipeline CLT', icon: GitBranch, section: 'operar' },
      { href: '/clt/analise-lote', label: 'Análise em Lote', icon: ListChecks, section: 'operar' },
      { href: '/clt/empresas-aprovadas', label: 'Empresas Aprovadas', icon: Trophy, section: 'operar' },
      { href: '/clt/extrair-caged', label: 'Extrair Base CAGED', icon: Download, needsRole: ['gestor', 'admin'], section: 'operar' },
      { href: '/clt/conversas', label: 'Conversas IA', icon: MessageSquare, section: 'ia' },
      { href: '/clt/esteira', label: 'Esteira', icon: ListChecks, section: 'ia' },
      { href: '/clt/conexao-whatsapp', label: 'Conexão WhatsApp', icon: Smartphone, needsRole: ['gestor', 'admin'], section: 'ia' },
      { href: '/clt/autorizacoes', label: 'Autorizações LGPD', icon: FileText, section: 'config' },
      { href: '/clt/painel', label: 'Painel Operacional', icon: Activity, needsRole: ['admin', 'gestor'], section: 'config' },
    ],
  },
  {
    k: 'fgts', icon: PiggyBank, label: 'FGTS', base: '/fgts',
    desc: 'Antecipação saque-aniversário',
    iconClass: 'text-cyan-400',
    boxClass: 'bg-cyan-500/10 ring-cyan-500/25 group-hover:ring-cyan-400/60',
    items: [
      { href: '/fgts/comparar', label: 'Consulta (3 bancos)', icon: Search, section: 'consultar' },
      { href: '/fgts/fintech-corban', label: 'Fintech do Corban (QI/J17)', icon: Landmark, section: 'consultar' },
      { href: '/fgts/v8', label: 'V8 Sistema', icon: Zap, section: 'operar' },
      { href: '/fgts/simulacao', label: 'FINANTO', icon: PiggyBank, section: 'operar' },
    ],
  },
  {
    k: 'gov', icon: Landmark, label: 'Governos', base: '/governos',
    desc: 'Servidor estadual',
    iconClass: 'text-yellow-400',
    boxClass: 'bg-yellow-500/10 ring-yellow-500/25 group-hover:ring-yellow-400/60',
    items: [
      { href: '/governos/catalogo', label: 'Catálogo de Convênios', icon: BookOpen, section: 'consultar' },
      { href: '/governos/holerite', label: 'Análise de Holerite', icon: FileText, section: 'consultar' },
    ],
  },
  {
    k: 'fed', icon: Landmark, label: 'Federal', base: '/federal',
    desc: 'Servidor federal (SIAPE)',
    iconClass: 'text-blue-400',
    boxClass: 'bg-blue-500/10 ring-blue-500/25 group-hover:ring-blue-400/60',
    items: [
      { href: '/federal/catalogo', label: 'Catálogo de Convênios', icon: BookOpen, section: 'consultar' },
      { href: '/federal/analise', label: 'Análise de Contracheque', icon: FileText, section: 'consultar' },
    ],
  },
  {
    k: 'pref', icon: Building2, label: 'Prefeituras', base: '/prefeituras',
    desc: 'Servidor municipal',
    iconClass: 'text-orange-400',
    boxClass: 'bg-orange-500/10 ring-orange-500/25 group-hover:ring-orange-400/60',
    items: [
      { href: '/prefeituras/catalogo', label: 'Catálogo', icon: BookOpen, section: 'consultar' },
      { href: '/prefeituras/holerite', label: 'Análise de Holerite', icon: FileText, section: 'consultar' },
    ],
  },
  {
    k: 'admin', icon: Settings, label: 'Admin', base: '/admin',
    desc: 'Gestão da plataforma',
    iconClass: 'text-slate-300',
    boxClass: 'bg-slate-500/10 ring-slate-500/25 group-hover:ring-slate-400/60',
    items: [
      { href: '/admin/usuarios', label: 'Usuários', icon: Settings, needsRole: ['admin'] },
      { href: '/admin/parceiros', label: 'Parceiros', icon: Building2, needsRole: ['admin'] },
      { href: '/admin/manutencao', label: 'Manutenção', icon: Zap, needsRole: ['admin', 'gestor'] },
    ],
  },
];

/** Retorna o grupo do módulo cujo `base` casa com o pathname (ou null na home). */
export function moduloDoPath(pathname: string): NavGroup | null {
  return NAV.find((g) => pathname === g.base || pathname.startsWith(g.base + '/')) ?? null;
}

/** Agrupa os itens (já filtrados) por seção, preservando a ordem original. */
export function agruparPorSecao(items: NavItem[]): Array<{ section: Section | null; items: NavItem[] }> {
  const out: Array<{ section: Section | null; items: NavItem[] }> = [];
  let last: Section | null | undefined = undefined;
  for (const item of items) {
    const s = item.section ?? null;
    if (s !== last) {
      out.push({ section: s, items: [] });
      last = s;
    }
    out[out.length - 1].items.push(item);
  }
  return out;
}
