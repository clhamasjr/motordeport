'use client';

import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Briefcase, Building2, Landmark, Trophy, Search, Download } from 'lucide-react';
import Link from 'next/link';

const QUICK_LINKS = [
  { href: '/clt/consulta', label: 'Consulta CLT', desc: 'Multi-banco em paralelo', icon: Search, color: 'text-bank-pb' },
  { href: '/clt/empresas-aprovadas', label: 'Empresas Aprovadas', desc: 'CNPJs com histórico', icon: Trophy, color: 'text-yellow-500' },
  { href: '/clt/extrair-caged', label: 'Extrair CAGED', desc: '43,6M CPFs filtráveis', icon: Download, color: 'text-bank-c6' },
  { href: '/inss/consulta', label: 'Consulta INSS', desc: 'Aposentados/pensionistas', icon: Briefcase, color: 'text-purple-400' },
  { href: '/governos/federal', label: 'SIAPE', desc: 'Servidor federal', icon: Landmark, color: 'text-bank-handbank' },
  { href: '/prefeituras/catalogo', label: 'Prefeituras', desc: 'Municipais', icon: Building2, color: 'text-orange-400' },
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

      <Card className="bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="text-2xl">🚧</div>
            <div className="flex-1">
              <div className="font-bold mb-1">FlowForce V2 em construção</div>
              <p className="text-sm text-muted-foreground">
                Versão moderna substituindo a anterior. Telas migrando uma a uma. Pra fluxos ainda não migrados, use o{' '}
                <a href="https://motordeport.vercel.app" className="underline hover:text-primary">
                  sistema V1
                </a>
                .
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground mb-3">Acesso rápido</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {QUICK_LINKS.map((link) => {
            const Icon = link.icon;
            return (
              <Link key={link.href} href={link.href}>
                <Card className="hover:border-primary/50 hover:shadow-md transition-all cursor-pointer h-full">
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-secondary/50 flex items-center justify-center flex-shrink-0">
                        <Icon className={`w-5 h-5 ${link.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base">{link.label}</CardTitle>
                        <CardDescription className="text-xs mt-0.5">{link.desc}</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
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

          <div className="font-semibold text-foreground/80 pt-2">⏳ Roadmap</div>
          <div className="pl-4">⏳ Consulta CLT com Supabase Realtime (substituir polling)</div>
          <div className="pl-4">⏳ Migrar backend Vercel → Next.js API routes (autonomia total da VPS)</div>
          <div className="pl-4">⏳ Polish final dos módulos em operação (Federal, Governos, Prefeituras)</div>
        </CardContent>
      </Card>
    </div>
  );
}
