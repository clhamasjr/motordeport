'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Briefcase,
  Building2,
  FileSpreadsheet,
  Landmark,
  ListChecks,
  PiggyBank,
  Search,
  Sparkles,
  Users,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent } from '@/components/ui/card';

const PRODUTOS = [
  {
    href: '/inss',
    label: 'INSS',
    description: 'Aposentados e pensionistas',
    detail: 'Consultas, higienização, propostas e gestão.',
    icon: Briefcase,
    iconClass: 'text-purple-400',
    boxClass: 'bg-purple-500/10 ring-purple-500/25 group-hover:ring-purple-400/60',
    cardClass: 'hover:border-purple-500/50 hover:shadow-purple-500/10',
  },
  {
    href: '/clt',
    label: 'CLT',
    description: 'Trabalhador de carteira assinada',
    detail: 'Análise, bancos, esteira e atendimento.',
    icon: Users,
    iconClass: 'text-emerald-400',
    boxClass: 'bg-emerald-500/10 ring-emerald-500/25 group-hover:ring-emerald-400/60',
    cardClass: 'hover:border-emerald-500/50 hover:shadow-emerald-500/10',
  },
  {
    href: '/fgts',
    label: 'FGTS',
    description: 'Antecipação saque-aniversário',
    detail: 'Compare bancos e encontre a melhor condição.',
    icon: PiggyBank,
    iconClass: 'text-cyan-400',
    boxClass: 'bg-cyan-500/10 ring-cyan-500/25 group-hover:ring-cyan-400/60',
    cardClass: 'hover:border-cyan-500/50 hover:shadow-cyan-500/10',
  },
  {
    href: '/federal',
    label: 'Federal',
    description: 'Servidor federal (SIAPE)',
    detail: 'Catálogo e análise de contracheque.',
    icon: Landmark,
    iconClass: 'text-blue-400',
    boxClass: 'bg-blue-500/10 ring-blue-500/25 group-hover:ring-blue-400/60',
    cardClass: 'hover:border-blue-500/50 hover:shadow-blue-500/10',
  },
  {
    href: '/governos',
    label: 'Governos',
    description: 'Servidor estadual',
    detail: 'Convênios e análise de holerite.',
    icon: Building2,
    iconClass: 'text-yellow-400',
    boxClass: 'bg-yellow-500/10 ring-yellow-500/25 group-hover:ring-yellow-400/60',
    cardClass: 'hover:border-yellow-500/50 hover:shadow-yellow-500/10',
  },
  {
    href: '/prefeituras',
    label: 'Prefeituras',
    description: 'Servidor municipal',
    detail: 'Catálogo e operação por município.',
    icon: FileSpreadsheet,
    iconClass: 'text-orange-400',
    boxClass: 'bg-orange-500/10 ring-orange-500/25 group-hover:ring-orange-400/60',
    cardClass: 'hover:border-orange-500/50 hover:shadow-orange-500/10',
  },
];

const ATALHOS = [
  { href: '/inss/consulta', label: 'Consultar INSS', description: 'Consulta individual', icon: Search },
  { href: '/clt/consulta', label: 'Consultar CLT', description: 'Análise de trabalhador', icon: Search },
  { href: '/fgts/comparar', label: 'Comparar FGTS', description: 'Condições em múltiplos bancos', icon: Sparkles },
  { href: '/inss/pipeline', label: 'Abrir pipeline', description: 'Acompanhar oportunidades', icon: ListChecks },
];

export default function InicioPage() {
  const { user } = useAuth();
  const firstName = user?.name?.trim().split(/\s+/)[0] || user?.username || 'bem-vindo';
  const greeting = getGreeting();

  return (
    <div className="mx-auto w-full max-w-7xl space-y-10 p-4 sm:p-6 lg:p-8">
      <header className="relative overflow-hidden rounded-3xl border border-border/70 bg-card/45 p-6 shadow-xl shadow-black/15 backdrop-blur-xl sm:p-8">
        <div className="absolute -right-16 -top-24 size-64 rounded-full bg-primary/10 blur-3xl" aria-hidden />
        <div className="absolute -bottom-28 right-32 size-56 rounded-full bg-accent/10 blur-3xl" aria-hidden />
        <div className="relative max-w-3xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
            Central de operações
          </div>
          <h1 className="text-3xl font-semibold tracking-[-0.03em] text-foreground sm:text-4xl">
            {greeting}, {firstName}.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            Escolha uma área para iniciar uma consulta, acompanhar oportunidades ou continuar uma operação.
          </p>
        </div>
      </header>

      <section aria-labelledby="atalhos-title">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Acesso rápido</p>
            <h2 id="atalhos-title" className="mt-1 text-xl font-semibold tracking-tight">Tarefas frequentes</h2>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {ATALHOS.map(({ href, label, description, icon: Icon }) => (
            <Link key={href} href={href} className="group rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
              <Card interactive className="h-full border-border/70">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
                    <Icon className="size-4.5" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{label}</div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{description}</div>
                  </div>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="modulos-title">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Produtos</p>
          <h2 id="modulos-title" className="mt-1 text-xl font-semibold tracking-tight">Todos os módulos</h2>
          <p className="mt-1 text-sm text-muted-foreground">Entre na área correspondente ao perfil do cliente.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {PRODUTOS.map((product) => {
            const Icon = product.icon;
            return (
              <Link key={product.href} href={product.href} className="group rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                <Card interactive className={`h-full border-border/70 ${product.cardClass}`}>
                  <CardContent className="flex h-full flex-col p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className={`flex size-12 shrink-0 items-center justify-center rounded-2xl ring-1 transition-all duration-200 ${product.boxClass}`}>
                        <Icon className={`size-5.5 ${product.iconClass} transition-transform duration-200 group-hover:scale-110`} aria-hidden />
                      </div>
                      <ArrowRight className="size-5 text-muted-foreground/40 transition-all duration-200 group-hover:translate-x-1 group-hover:text-foreground" aria-hidden />
                    </div>
                    <div className="mt-6">
                      <h3 className="text-lg font-semibold tracking-tight">{product.label}</h3>
                      <p className="mt-1 text-sm font-medium text-foreground/80">{product.description}</p>
                      <p className="mt-2 text-sm leading-5 text-muted-foreground">{product.detail}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}
