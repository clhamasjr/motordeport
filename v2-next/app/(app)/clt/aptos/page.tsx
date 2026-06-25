'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useCltAptos } from '@/hooks/use-clt-fila';
import { BANCO_LABEL } from '@/lib/clt-bancos';
import { formatBRL, formatCpf } from '@/lib/utils';
import { CheckCircle2, AlertCircle, TrendingUp, Users } from 'lucide-react';
import type { BancoSlug } from '@/lib/clt-types';

export default function AptosCltPage() {
  const { data, isLoading, error } = useCltAptos();

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CheckCircle2 className="size-6 text-green-500" />
          CLT — Clientes Aptos
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Clientes que ficaram com margem disponível em pelo menos um banco. Pronto pra trabalhar:
          ordenado pela maior margem. Cada vendedor vê os seus; admin vê todos.
        </p>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
        </div>
      )}

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 flex items-center gap-2 text-destructive">
            <AlertCircle className="size-4" /> {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-2">
            <Card>
              <CardContent className="p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Users className="size-3" /> Clientes aptos
                </div>
                <div className="text-2xl font-black text-green-500">{data.total}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="size-3" /> Soma das margens
                </div>
                <div className="text-2xl font-black text-cyan-400">{formatBRL(data.somaMargem)}</div>
              </CardContent>
            </Card>
          </div>

          {data.total === 0 && (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                Nenhum cliente apto ainda. Depois das consultas processarem, os clientes com margem
                aparecem aqui.
              </CardContent>
            </Card>
          )}

          {data.total > 0 && (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="text-left p-3">Cliente</th>
                        <th className="text-right p-3">Melhor margem</th>
                        <th className="text-left p-3">Melhor banco</th>
                        <th className="text-center p-3">Bancos</th>
                        <th className="text-left p-3">Empregador</th>
                        <th className="text-left p-3">Vendedor</th>
                        <th className="text-center p-3">WhatsApp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.aptos.map((a) => (
                        <tr key={a.id} className="hover:bg-muted/20">
                          <td className="p-3">
                            <div className="font-medium">{a.nome}</div>
                            <div className="text-xs text-muted-foreground">{formatCpf(a.cpf)}</div>
                          </td>
                          <td className="p-3 text-right font-bold text-green-500">
                            {formatBRL(a.melhorMargem)}
                          </td>
                          <td className="p-3">
                            <Badge variant="muted" className="text-[10px]">
                              {BANCO_LABEL[a.melhorBanco as BancoSlug] || a.melhorBanco}
                            </Badge>
                          </td>
                          <td className="p-3 text-center">
                            <span className="font-mono text-xs">{a.totalBancosAptos}</span>
                          </td>
                          <td className="p-3 text-xs text-muted-foreground">
                            {a.empregador ? a.empregador.substring(0, 32) : '—'}
                          </td>
                          <td className="p-3 text-xs">{a.vendedor || '—'}</td>
                          <td className="p-3 text-center">
                            {a.telefone ? (
                              <a
                                href={`https://wa.me/55${a.telefone.replace(/\D/g, '')}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-block text-[11px] px-2 py-1 rounded bg-green-500/10 text-green-500 hover:bg-green-500/20"
                              >
                                📱 Chamar
                              </a>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
