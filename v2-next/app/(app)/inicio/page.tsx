'use client';

import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Briefcase, Building2, Landmark, FileSpreadsheet, Users, ArrowRight, CheckCircle2, PiggyBank } from 'lucide-react';
import Link from 'next/link';

// Portas de entrada por PRODUTO — o parceiro escolhe por onde quer operar.
// Classes completas (não interpoladas) — Tailwind só gera classe que aparece
// literal no fonte. Cada produto tem cor própria pra leitura rápida.
const PRODUTOS = [
  {
    href: '/inss/consulta',
    label: 'INSS',
    desc: 'Aposentados e pensionistas',
    icon: Briefcase,
    iconClass: 'text-purple-400',
    boxClass: 'bg-purple-500/10 ring-purple-500/25 group-hover:ring-purple-400/60',
    cardClass: 'hover:border-purple-500/50 hover:shadow-purple-500/10',
  },
  {
    href: '/clt/consulta',
    label: 'CLT',
    desc: 'Trabalhador de carteira assinada',
    icon: Users,
    iconClass: 'text-emerald-400',
    boxClass: 'bg-emerald-500/10 ring-emerald-500/25 group-hover:ring-emerald-400/60',
    cardClass: 'hover:border-emerald-500/50 hover:shadow-emerald-500/10',
  },
  {
    href: '/fgts/comparar',
    label: 'FGTS',
    desc: 'Antecipação saque-aniversário',
    icon: PiggyBank,
    iconClass: 'text-cyan-400',
    boxClass: 'bg-cyan-500/10 ring-cyan-500/25 group-hover:ring-cyan-400/60',
    cardClass: 'hover:border-cyan-500/50 hover:shadow-cyan-500/10',
  },
  {
    href: '/federal/analise',
    label: 'Federal',
    desc: 'Servidor federal (SIAPE)',
    icon: Landmark,
    iconClass: 'text-blue-400',
    boxClass: 'bg-blue-500/10 ring-blue-500/25 group-hover:ring-blue-400/60',
    cardClass: 'hover:border-blue-500/50 hover:shadow-blue-500/10',
  },
  {
    href: '/governos/holerite',
    label: 'Governos',
    desc: 'Servidor estadual',
    icon: Building2,
    iconClass: 'text-yellow-400',
    boxClass: 'bg-yellow-500/10 ring-yellow-500/25 group-hover:ring-yellow-400/60',
    cardClass: 'hover:border-yellow-500/50 hover:shadow-yellow-500/10',
  },
  {
    href: '/prefeituras/holerite',
    label: 'Prefeituras',
    desc: 'Servidor municipal',
    icon: FileSpreadsheet,
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
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {greeting}, {user?.name?.split(' ')[0] || user?.username} 👋
        </h1>
        <p className="text-muted-foreground mt-1">
          {user?.role === 'admin'
            ? 'Visão completa da plataforma'
            : user?.role === 'gestor'
              ? `Equipe ${user?.nome_parceiro || 'LhamasCred'}`
              : 'Escolha por onde quer começar hoje'}
        </p>
      </div>

      <div>
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground mb-4">
          Por onde você quer entrar?
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {PRODUTOS.map((p) => {
            const Icon = p.icon;
            return (
              <Link key={p.href} href={p.href} className="group">
                <Card
                  className={`h-full cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:shadow-lg ${p.cardClass}`}
                >
                  <CardContent className="flex items-center gap-4 p-5">
                    <div
                      className={`w-16 h-16 rounded-2xl ring-1 flex items-center justify-center flex-shrink-0 transition-all duration-200 ${p.boxClass}`}
                    >
                      <Icon
                        className={`size-8 ${p.iconClass} transition-transform duration-200 group-hover:scale-110`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-lg leading-tight">{p.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{p.desc}</div>
                    </div>
                    <ArrowRight className="size-5 text-muted-foreground/40 group-hover:text-foreground group-hover:translate-x-1 transition-all duration-200 flex-shrink-0" />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-emerald-400" />
            <CardTitle>Migração V2 — praticamente concluída</CardTitle>
          </div>
          <CardDescription>
            Todos os produtos já operam aqui no V2. Faltam só ajustes finos.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <div className="font-semibold text-foreground/80 pt-1">✅ CLT — completo</div>
          <div className="pl-4">✅ Consulta unitária + Análise em lote + Análise de cliente</div>
          <div className="pl-4">✅ Empresas Aprovadas + Esteira + Catálogo de bancos</div>
          <div className="pl-4">✅ Extrair Base CAGED (com botão Pesquisar)</div>
          <div className="pl-4">✅ Conversas IA Sofia + Conexão WhatsApp + Autorizações LGPD</div>
          <div className="pl-4">✅ Painel Operacional (KPIs + usuários online)</div>

          <div className="font-semibold text-foreground/80 pt-2">✅ INSS — completo</div>
          <div className="pl-4">✅ Consulta + Higienização + Pipeline + Esteira</div>
          <div className="pl-4">✅ IN100 (DataPrev) + Extrato PDF + Enquadramento (manual)</div>
          <div className="pl-4">✅ RMC/RCC + Saque + Propostas + Gestão</div>
          <div className="pl-4">✅ Sofia Knowledge + Conexão WhatsApp</div>

          <div className="font-semibold text-foreground/80 pt-2">✅ Federal (SIAPE) — completo</div>
          <div className="pl-4">✅ Catálogo + Análise de holerite</div>

          <div className="font-semibold text-foreground/80 pt-2">✅ Governos (Estaduais) — completo</div>
          <div className="pl-4">✅ Catálogo + Análise de holerite</div>

          <div className="font-semibold text-foreground/80 pt-2">✅ Prefeituras (Municipais) — completo</div>
          <div className="pl-4">✅ Catálogo + Análise de holerite</div>

          <div className="font-semibold text-foreground/80 pt-2">⚙️ Admin — completo</div>
          <div className="pl-4">✅ Usuários + Parceiros + Manutenção</div>
          <div className="pl-4">✅ Redefinir senha v2 (gerar aleatória, mostrar/esconder, confirmar, aviso de sessão)</div>

          <div className="font-semibold text-foreground/80 pt-2">🧭 Orquestrador — V1 entregue</div>
          <div className="pl-4">✅ Painel de visibilidade macro do SaaS (saúde de bancos, agentes, módulos)</div>

          <div className="font-semibold text-foreground/80 pt-2">🟡 Ajustes finos pendentes</div>
          <div className="pl-4">🟡 Sofia INSS (Conversas) + Disparo em massa — em ajuste</div>
          <div className="pl-4">⏳ Consulta CLT com Supabase Realtime (substituir polling)</div>
          <div className="pl-4">⏳ Migrar backend Vercel → Next.js API routes (autonomia total da VPS)</div>
        </CardContent>
      </Card>
    </div>
  );
}
