import {
  Activity,
  BookOpen,
  Briefcase,
  Building2,
  DatabaseZap,
  Download,
  FileText,
  GitBranch,
  Landmark,
  ListChecks,
  MessageSquare,
  PiggyBank,
  Search,
  Settings,
  Smartphone,
  Sparkles,
  Target,
  Trophy,
  Zap,
} from 'lucide-react';

export type Section = 'consultar' | 'operar' | 'ia' | 'esteira' | 'config';

export const SECTION_LABEL: Record<Section, string> = {
  consultar: 'Consultar e analisar',
  operar: 'Operar oportunidades',
  ia: 'Atendimento e automação',
  esteira: 'Acompanhar propostas',
  config: 'Configurar',
};

export type Role = 'admin' | 'gestor' | 'operador';

export interface NavItem {
  href: string;
  label: string;
  description: string;
  icon: React.ElementType;
  needsRole?: Role[];
  section?: Section;
  featured?: boolean;
}

export interface NavGroup {
  k: string;
  icon: React.ElementType;
  label: string;
  base: string;
  desc: string;
  detail: string;
  iconClass: string;
  boxClass: string;
  cardClass: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    k: 'inss',
    icon: Briefcase,
    label: 'INSS',
    base: '/inss',
    desc: 'Aposentados e pensionistas',
    detail: 'Consulte benefícios, prepare bases e acompanhe oportunidades e propostas.',
    iconClass: 'text-purple-400',
    boxClass: 'bg-purple-500/10 ring-purple-500/25 group-hover:ring-purple-400/60',
    cardClass: 'hover:border-purple-500/50 hover:shadow-purple-500/10',
    items: [
      { href: '/inss/consulta', label: 'Consulta Unitária', description: 'Consulte um benefício e encontre oportunidades disponíveis.', icon: Search, section: 'consultar', featured: true },
      { href: '/inss/extrato-pdf', label: 'Ler Extrato PDF', description: 'Extraia contratos e informações de um extrato do benefício.', icon: FileText, section: 'consultar' },
      { href: '/inss/in100', label: 'IN100 (DataPrev)', description: 'Solicite e acompanhe a consulta de dados do benefício.', icon: Trophy, section: 'consultar' },
      { href: '/inss/fintech-corban', label: 'Fintech do Corban', description: 'Consulte margem e condições disponíveis na integração.', icon: Landmark, section: 'consultar' },
      { href: '/inss/enquadramento', label: 'Enquadramento Manual', description: 'Analise contratos manualmente pelas regras cadastradas.', icon: Target, section: 'consultar' },
      { href: '/inss/higienizacao', label: 'Higienização de Base', description: 'Importe uma planilha e classifique oportunidades em lote.', icon: Sparkles, section: 'operar' },
      { href: '/inss/rmc-rcc', label: 'RMC/RCC e Saque', description: 'Avalie cartões consignados, saques e margem complementar.', icon: BookOpen, section: 'operar' },
      { href: '/inss/pipeline', label: 'Pipeline', description: 'Priorize oportunidades e avance clientes na operação.', icon: ListChecks, section: 'operar', featured: true },
      { href: '/inss/conversas', label: 'Sofia — Conversas', description: 'Acompanhe atendimentos e intervenha quando necessário.', icon: MessageSquare, section: 'ia' },
      { href: '/inss/disparo', label: 'Disparo em Massa', description: 'Prepare campanhas e acompanhe os envios selecionados.', icon: MessageSquare, section: 'ia' },
      { href: '/inss/esteira', label: 'Esteira', description: 'Visualize o andamento das operações em curso.', icon: ListChecks, section: 'esteira' },
      { href: '/inss/propostas', label: 'Propostas', description: 'Consulte propostas criadas e seus próximos passos.', icon: FileText, section: 'esteira' },
      { href: '/inss/gestao', label: 'Painel Operacional', description: 'Acompanhe indicadores da equipe e da operação INSS.', icon: Activity, needsRole: ['admin', 'gestor'], section: 'esteira' },
      { href: '/inss/sofia-knowledge', label: 'Sofia — Conhecimento', description: 'Gerencie as orientações usadas no atendimento automatizado.', icon: BookOpen, needsRole: ['admin'], section: 'config' },
      { href: '/inss/conexao-whatsapp', label: 'Conectar WhatsApp', description: 'Gerencie a conexão usada nos atendimentos e campanhas.', icon: Smartphone, section: 'config' },
      { href: '/inss/motor-test', label: 'Testes do Motor', description: 'Valide cenários e regras do motor em ambiente controlado.', icon: Zap, needsRole: ['admin'], section: 'config' },
    ],
  },
  {
    k: 'clt',
    icon: Building2,
    label: 'CLT',
    base: '/clt',
    desc: 'Trabalhador de carteira assinada',
    detail: 'Consulte trabalhadores, compare bancos e acompanhe autorizações e propostas.',
    iconClass: 'text-emerald-400',
    boxClass: 'bg-emerald-500/10 ring-emerald-500/25 group-hover:ring-emerald-400/60',
    cardClass: 'hover:border-emerald-500/50 hover:shadow-emerald-500/10',
    items: [
      { href: '/clt/consulta', label: 'Consulta Unitária', description: 'Consulte um CPF nos bancos disponíveis e acompanhe o retorno.', icon: Search, section: 'consultar', featured: true },
      { href: '/clt/analise', label: 'Análise de Cliente', description: 'Consolide vínculos, margem e condições para um cliente.', icon: Target, section: 'consultar' },
      { href: '/clt/catalogo', label: 'Catálogo de Bancos', description: 'Confira integrações, regras e disponibilidade dos bancos.', icon: BookOpen, section: 'consultar' },
      { href: '/clt/aptos', label: 'Pipeline CLT', description: 'Priorize clientes aptos e organize a próxima ação comercial.', icon: GitBranch, section: 'operar' },
      { href: '/clt/analise-lote', label: 'Análise em Lote', description: 'Processe uma base e acompanhe resultados por cliente.', icon: ListChecks, section: 'operar' },
      { href: '/clt/empresas-aprovadas', label: 'Empresas Aprovadas', description: 'Consulte empresas elegíveis e higienize clientes em lote.', icon: Trophy, section: 'operar' },
      { href: '/clt/extrair-caged', label: 'Extrair Base CAGED', description: 'Prepare uma base CAGED para uso na operação.', icon: Download, needsRole: ['gestor', 'admin'], section: 'operar' },
      { href: '/clt/facta-offline', label: 'FACTA — Higienização Offline', description: 'Organize e acompanhe o processamento offline da FACTA.', icon: DatabaseZap, needsRole: ['gestor', 'admin'], section: 'operar' },
      { href: '/clt/conversas', label: 'Conversas IA', description: 'Acompanhe atendimentos e assuma conversas quando necessário.', icon: MessageSquare, section: 'ia' },
      { href: '/clt/conexao-whatsapp', label: 'Conexão WhatsApp', description: 'Gerencie a instância usada pelo atendimento automatizado.', icon: Smartphone, needsRole: ['gestor', 'admin'], section: 'ia' },
      { href: '/clt/esteira', label: 'Esteira', description: 'Acompanhe propostas, pendências e formalizações.', icon: ListChecks, section: 'esteira' },
      { href: '/clt/autorizacoes', label: 'Autorizações LGPD', description: 'Consulte consentimentos e pendências de autorização.', icon: FileText, section: 'esteira' },
      { href: '/clt/painel', label: 'Painel Operacional', description: 'Acompanhe indicadores, filas e atividade da operação CLT.', icon: Activity, needsRole: ['admin', 'gestor'], section: 'esteira' },
    ],
  },
  {
    k: 'fgts',
    icon: PiggyBank,
    label: 'FGTS',
    base: '/fgts',
    desc: 'Antecipação saque-aniversário',
    detail: 'Compare ofertas, consulte saldos e avance até a formalização.',
    iconClass: 'text-cyan-400',
    boxClass: 'bg-cyan-500/10 ring-cyan-500/25 group-hover:ring-cyan-400/60',
    cardClass: 'hover:border-cyan-500/50 hover:shadow-cyan-500/10',
    items: [
      { href: '/fgts/comparar', label: 'Comparar Ofertas', description: 'Consulte as fontes disponíveis e compare as condições retornadas.', icon: Search, section: 'consultar', featured: true },
      { href: '/fgts/fintech-corban', label: 'Fintech do Corban', description: 'Consulte saldo e autorizações QI/J17.', icon: Landmark, section: 'consultar' },
      { href: '/fgts/nossa-fintech', label: 'A Nossa Fintech', description: 'Consulte, simule e digite propostas nesta integração.', icon: Sparkles, section: 'operar' },
      { href: '/fgts/v8', label: 'V8 Sistema', description: 'Consulte períodos, simule e acompanhe propostas V8.', icon: Zap, section: 'operar' },
      { href: '/fgts/simulacao', label: 'FINANTO', description: 'Simule e acompanhe propostas na FINANTO.', icon: PiggyBank, section: 'operar' },
    ],
  },
  {
    k: 'fed',
    icon: Landmark,
    label: 'Federal',
    base: '/federal',
    desc: 'Servidor federal (SIAPE)',
    detail: 'Consulte convênios e analise contracheques para identificar bancos elegíveis.',
    iconClass: 'text-blue-400',
    boxClass: 'bg-blue-500/10 ring-blue-500/25 group-hover:ring-blue-400/60',
    cardClass: 'hover:border-blue-500/50 hover:shadow-blue-500/10',
    items: [
      { href: '/federal/catalogo', label: 'Catálogo de Convênios', description: 'Pesquise regras e bancos disponíveis por órgão federal.', icon: BookOpen, section: 'consultar' },
      { href: '/federal/analise', label: 'Análise de Contracheque', description: 'Envie o documento e confira enquadramento e simulações.', icon: FileText, section: 'consultar' },
    ],
  },
  {
    k: 'gov',
    icon: Landmark,
    label: 'Governos',
    base: '/governos',
    desc: 'Servidor estadual',
    detail: 'Encontre convênios estaduais e analise holerites com as regras cadastradas.',
    iconClass: 'text-yellow-400',
    boxClass: 'bg-yellow-500/10 ring-yellow-500/25 group-hover:ring-yellow-400/60',
    cardClass: 'hover:border-yellow-500/50 hover:shadow-yellow-500/10',
    items: [
      { href: '/governos/catalogo', label: 'Catálogo de Convênios', description: 'Navegue por estado, órgão e bancos disponíveis.', icon: BookOpen, section: 'consultar' },
      { href: '/governos/holerite', label: 'Análise de Holerite', description: 'Extraia dados do holerite e identifique possibilidades.', icon: FileText, section: 'consultar' },
    ],
  },
  {
    k: 'pref',
    icon: Building2,
    label: 'Prefeituras',
    base: '/prefeituras',
    desc: 'Servidor municipal',
    detail: 'Localize convênios municipais e analise holerites por prefeitura.',
    iconClass: 'text-orange-400',
    boxClass: 'bg-orange-500/10 ring-orange-500/25 group-hover:ring-orange-400/60',
    cardClass: 'hover:border-orange-500/50 hover:shadow-orange-500/10',
    items: [
      { href: '/prefeituras/catalogo', label: 'Catálogo de Convênios', description: 'Pesquise prefeituras, regras e bancos conveniados.', icon: BookOpen, section: 'consultar' },
      { href: '/prefeituras/holerite', label: 'Análise de Holerite', description: 'Envie o holerite e confira enquadramento por banco.', icon: FileText, section: 'consultar' },
    ],
  },
  {
    k: 'admin',
    icon: Settings,
    label: 'Administração',
    base: '/admin',
    desc: 'Gestão da plataforma',
    detail: 'Administre acessos, parceiros e tarefas de manutenção autorizadas.',
    iconClass: 'text-slate-300',
    boxClass: 'bg-slate-500/10 ring-slate-500/25 group-hover:ring-slate-400/60',
    cardClass: 'hover:border-slate-400/50 hover:shadow-slate-500/10',
    items: [
      { href: '/admin/usuarios', label: 'Usuários', description: 'Gerencie acessos, perfis e vínculos com parceiros.', icon: Settings, needsRole: ['admin'], section: 'config' },
      { href: '/admin/parceiros', label: 'Parceiros', description: 'Cadastre parceiros e acompanhe sua situação operacional.', icon: Building2, needsRole: ['admin'], section: 'config' },
      { href: '/admin/manutencao', label: 'Manutenção', description: 'Execute rotinas controladas de atualização das bases.', icon: Zap, needsRole: ['admin', 'gestor'], section: 'config' },
    ],
  },
];

export function canAccessItem(item: NavItem, role?: Role | null) {
  return !item.needsRole || (!!role && item.needsRole.includes(role));
}

export function getVisibleItems(group: NavGroup, role?: Role | null) {
  return group.items.filter((item) => canAccessItem(item, role));
}

export function getVisibleGroups(role?: Role | null) {
  return NAV.filter((group) => getVisibleItems(group, role).length > 0);
}

export function getFeaturedItems(role?: Role | null) {
  return getVisibleGroups(role).flatMap((group) =>
    getVisibleItems(group, role)
      .filter((item) => item.featured)
      .map((item) => ({ ...item, group })),
  );
}

export function moduloDoPath(pathname: string): NavGroup | null {
  return NAV.find((group) => pathname === group.base || pathname.startsWith(`${group.base}/`)) ?? null;
}

export function itemDoPath(pathname: string): NavItem | null {
  const group = moduloDoPath(pathname);
  return group?.items.find((item) => item.href === pathname) ?? null;
}

export function agruparPorSecao(items: NavItem[]): Array<{ section: Section | null; items: NavItem[] }> {
  const output: Array<{ section: Section | null; items: NavItem[] }> = [];
  let lastSection: Section | null | undefined;

  for (const item of items) {
    const section = item.section ?? null;
    if (section !== lastSection) {
      output.push({ section, items: [] });
      lastSection = section;
    }
    output[output.length - 1].items.push(item);
  }

  return output;
}
