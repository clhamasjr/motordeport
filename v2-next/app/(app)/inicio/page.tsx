'use client';

import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Briefcase, Building2, Landmark, Search, Sparkles, FileText } from 'lucide-react';
import Link from 'next/link';

// Classes completas (não interpoladas) — Tailwind só gera classe que aparece
// literal no fonte. Cada módulo tem cor própria pra leitura rápida.
const QUICK_LINKS = [
  {
    href: '/clt/consulta', label: 'Consulta CLT', desc: 'Multi-banco em paralelo', icon: Search,
    iconClass: 'text-emerald-400',
    boxClass: 'bg-emerald-500/10 ring-emerald-500/25 group-hover:ring-emerald-400/60',
    cardClass: 'hover:border-emerald-500/50 hover:shadow-emerald-500/10',
  },
  {
    href: '/inss/consulta', label: 'Consulta INSS', desc: 'Aposentados/pensionistas', icon: Briefcase,
    iconClass: 'text-purple-400',
    boxClass: 'bg-purple-500/10 ring-purple-500/25 group-hover:ring-purple-400/60',
    cardClass: 'hover:border-purple-500/50 hover:shadow-purple-500/10',
  },
  {
    href: '/inss/higienizacao', label: 'Higienização INSS', desc: 'Base XLSX em lote', icon: Sparkles,
    iconClass: 'text-cyan-400',
    boxClass: 'bg-cyan-500/10 ring-cyan-500/25 group-hover:ring-cyan-400/60',
    cardClass: 'hover:border-cyan-500/50 hover:shadow-cyan-500/10',
  },
  {
    href: '/federal/catalogo', label: 'Federal (SIAPE)', desc: 'Servidor federal civil', icon: Landmark,
    iconClass: 'text-blue-400',
    boxClass: 'bg-blue-500/10 ring-blue-500/25 group-hover:ring-blue-400/60',
    cardClass: 'hover:border-blue-500/50 hover:shadow-blue-500/10',
  },
  {
    href: '/governos/catalogo', label: 'Governos', desc: 'Servidores estaduais', icon: Building2,
    iconClass: 'text-yellow-400',
    boxClass: 'bg-yellow-500/10 ring-yellow-500/25 group-hover:ring-yellow-400/60',
    cardClass: 'hover:border-yellow-500/50 hover:shadow-yellow-500/10',
  },
  {
    href: '/prefeituras/catalogo', label: 'Prefeituras', desc: 'Servidores municipais', icon: FileText,
    iconClass: 'text-orange-400',
    boxClass: 'bg-orange-500/10 ring-orange-500/25 group-hover:ring-orange-400/60',
    cardClass: 'hover:border-orange-500/50 hover:shadow-orange-500/10',
  },
];

export default function InicioPage() {
  const { user } = useAuth();
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Bom dia';
    if (h < 18) return 'Boa tarde';
    return 'Boa noite';
  })();

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {greeting}, {user?.name?.split(' ')[0] || user?.username} 👋
        </h1>
        <p className="text-muted-foreground mt-1">
          {user?.role === 'admin' ? 'Visão completa da plataforma' :
           user?.role === 'gestor' ? `Equipe ${user?.nome_parceiro || 'LhamasCred'}` :
           'Sua operação de hoje'}
        </p>
      </div>

      <div>
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground mb-3">Acesso rápido</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
          {QUICK_LINKS.map((link) => {
            const Icon = link.icon;
            return (
              <Link key={link.href} href={link.href} className="group">
                <Card
                  className={`h-full cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:shadow-lg ${link.cardClass}`}
                >
                  <CardContent className="flex flex-col items-center text-center gap-3 p-5 sm:p-6">
                    <div
                      className={`w-16 h-16 sm:w-20 sm:h-20 rounded-2xl ring-1 flex items-center justify-center transition-all duration-200 ${link.boxClass}`}
                    >
                      <Icon
                        className={`size-8 sm:size-10 ${link.iconClass} transition-transform duration-200 group-hover:scale-110`}
                      />
                    </div>
                    <div>
                      <div className="font-semibold text-sm sm:text-base leading-tight">{link.label}</div>
                      <div className="text-[11px] sm:text-xs text-muted-foreground mt-1">{link.desc}</div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Status da migração</CardTitle>
          <CardDescription>O que já tá rodando aqui no V2 e o que ainda vem</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <div className="font-semibold text-foreground/80 pt-1">✅ CLT — completo</div>
          <div className="pl-4">✅ Consulta unitária + Análise em lote + Análise de cliente</div>
          <div className="pl-4">✅ Empresas Aprovadas + Esteira + Catálogo de bancos</div>
          <div className="pl-4">✅ Extrair Base CAGED (com botão Pesquisar)</div>
          <div className="pl-4">✅ Conversas IA Sofia + Conexão WhatsApp + Autorizações LGPD</div>
          <div className="pl-4">✅ Painel Operacional (KPIs + usuários online)</div>

          <div className="font-semibold text-foreground/80 pt-2">⚙️ Admin — completo</div>
          <div className="pl-4">✅ Usuários + Parceiros + Manutenção</div>
          <div className="pl-4">✅ Redefinir senha v2 (gerar aleatória, mostrar/esconder, confirmar, aviso de sessão)</div>

          <div className="font-semibold text-foreground/80 pt-2">🧭 Orquestrador — V1 entregue</div>
          <div className="pl-4">✅ Painel de visibilidade macro do SaaS (saúde de bancos, agentes, módulos)</div>

          <div className="font-semibold text-foreground/80 pt-2">🔵 INSS — completo</div>
          <div className="pl-4">✅ Consulta + Higienização + Pipeline + Esteira</div>
          <div className="pl-4">✅ IN100 (DataPrev) + Extrato PDF + Enquadramento (manual)</div>
          <div className="pl-4">✅ RMC/RCC + Saque + Propostas + Gestão</div>
          <div className="pl-4">✅ Sofia Knowledge + Conexão WhatsApp</div>
          <div className="pl-4">🟡 Sofia (Conversas) + Disparo em massa — em ajuste</div>

          <div className="font-semibold text-foreground/80 pt-2">🏛️ Federal (SIAPE) — em operação</div>
          <div className="pl-4">✅ Catálogo + Análise de holerite</div>

          <div className="font-semibold text-foreground/80 pt-2">🏙️ Governos (Estaduais) — em operação</div>
          <div className="pl-4">✅ Catálogo + Análise de holerite</div>

          <div className="font-semibold text-foreground/80 pt-2">🏘️ Prefeituras (Municipais) — em operação</div>
          <div className="pl-4">✅ Catálogo + Análise de holerite</div>

          <div className="font-semibold text-foreground/80 pt-2">🧱 Foundation</div>
          <div className="pl-4">✅ Fix posicionamento de modais (Dialog renderizava fora da viewport em desktop)</div>
          <div className="pl-4">✅ Tela inicial v2 (links corrigidos, tiles coloridos por módulo, sem banner V1)</div>

          <div className="font-semibold text-foreground/80 pt-2">⏳ Roadmap</div>
          <div className="pl-4">⏳ Consulta CLT com Supabase Realtime (substituir polling)</div>
          <div className="pl-4">⏳ Migrar backend Vercel → Next.js API routes (autonomia total da VPS)</div>
          <div className="pl-4">⏳ Polish final dos módulos em operação (Federal, Governos, Prefeituras)</div>
        </CardContent>
      </Card>
    </div>
  );
}
