'use client';

// ════════════════════════════════════════════════════════════════════
// components/modulo-hub.tsx — página-hub de um módulo
//
// Renderiza as ferramentas do módulo (do lib/nav.ts) em cards agrupados
// por seção (Consultar / Operar / IA / Esteira / Config). É a tela que
// abre quando o usuário clica num produto na home.
// ════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { NAV, SECTION_LABEL, agruparPorSecao, type NavItem, type Role } from '@/lib/nav';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';

export function ModuloHub({ k }: { k: string }) {
  const { user } = useAuth();
  const group = NAV.find((g) => g.k === k);
  if (!group) return notFound();

  const canSee = (item: NavItem) =>
    !item.needsRole || (user?.role ? item.needsRole.includes(user.role as Role) : false);

  const visiveis = group.items.filter(canSee);
  const secoes = agruparPorSecao(visiveis);
  const Icone = group.icon;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      {/* Voltar aos módulos */}
      <Link
        href="/inicio"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-4" />
        Módulos
      </Link>

      {/* Header do módulo */}
      <div className="flex items-center gap-4">
        <div className={`w-16 h-16 rounded-2xl ring-1 flex items-center justify-center flex-shrink-0 ${group.boxClass}`}>
          <Icone className={`size-8 ${group.iconClass}`} />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{group.label}</h1>
          <p className="text-muted-foreground mt-0.5">{group.desc}</p>
        </div>
      </div>

      {visiveis.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground text-sm">
            Você não tem acesso a nenhuma ferramenta deste módulo.
          </CardContent>
        </Card>
      )}

      {/* Seções com cards */}
      {secoes.map((sec, idx) => (
        <div key={idx}>
          {sec.section && (
            <h2 className="text-sm uppercase tracking-wider text-muted-foreground mb-3">
              {SECTION_LABEL[sec.section]}
            </h2>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {sec.items.map((item) => {
              const ItemIcon = item.icon;
              return (
                <Link key={item.href} href={item.href} className="group">
                  <Card
                    className={`h-full cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:shadow-lg hover:border-primary/40`}
                  >
                    <CardContent className="flex items-center gap-3 p-4">
                      <div className={`w-11 h-11 rounded-xl ring-1 flex items-center justify-center flex-shrink-0 transition-all duration-200 ${group.boxClass}`}>
                        <ItemIcon className={`size-5 ${group.iconClass} transition-transform duration-200 group-hover:scale-110`} />
                      </div>
                      <span className="font-medium text-sm leading-tight">{item.label}</span>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
