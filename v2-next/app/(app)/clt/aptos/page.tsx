'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useCltPipeline, type CategoriaCliente } from '@/hooks/use-clt-fila';
import { BANCO_LABEL } from '@/lib/clt-bancos';
import { formatBRL, formatCpf, formatDateBR } from '@/lib/utils';
import { GitBranch, AlertCircle } from 'lucide-react';
import type { BancoSlug } from '@/lib/clt-types';

// Ordem e rótulo das categorias do pipeline
const CATEGORIAS: { key: CategoriaCliente; label: string; cor: string }[] = [
  { key: 'apto', label: 'Aptos', cor: 'text-green-500' },
  { key: 'sem_margem', label: 'Sem margem', cor: 'text-yellow-500' },
  { key: 'aguardando', label: 'Aguardando autorização', cor: 'text-orange-400' },
  { key: 'inapto', label: 'Inaptos', cor: 'text-red-400' },
  { key: 'processando', label: 'Processando', cor: 'text-cyan-400' },
  { key: 'standby', label: 'Agendados (26/06)', cor: 'text-amber-400' },
];

export default function PipelineCltPage() {
  const { data, isLoading, error } = useCltPipeline();
  const [aba, setAba] = useState<CategoriaCliente>('apto');

  const clientes = (data?.clientes || []).filter((c) => c.categoria === aba);
  const mostraMargem = aba === 'apto' || aba === 'sem_margem';

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <GitBranch className="size-6 text-orange-400" />
          CLT — Pipeline de Clientes
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Todos os clientes consultados, segmentados por situação. Pool comum — todos os operadores
          veem. Clique numa categoria pra filtrar.
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
          {/* Cards por categoria — clicáveis (filtram a tabela) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {CATEGORIAS.map((cat) => {
              const n = data.contadores?.[cat.key] || 0;
              const ativo = aba === cat.key;
              return (
                <button
                  key={cat.key}
                  onClick={() => setAba(cat.key)}
                  className={`text-left rounded-md p-3 border transition-colors ${
                    ativo ? 'border-primary bg-primary/5' : 'border-border bg-surface-1 hover:bg-muted/30'
                  }`}
                >
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">
                    {cat.label}
                  </div>
                  <div className={`text-2xl font-black ${cat.cor}`}>{n}</div>
                </button>
              );
            })}
          </div>

          {/* Soma das margens (só faz sentido em aptos) */}
          {aba === 'apto' && (
            <div className="text-sm text-muted-foreground">
              Potencial total em margem dos aptos:{' '}
              <b className="text-cyan-400">{formatBRL(data.somaMargem)}</b>
            </div>
          )}

          {/* Tabela da categoria selecionada */}
          {clientes.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                Nenhum cliente nesta categoria.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="text-left p-3">Cliente</th>
                        {mostraMargem && <th className="text-right p-3">Melhor margem</th>}
                        {mostraMargem && <th className="text-left p-3">Melhor banco</th>}
                        <th className="text-left p-3">Empregador</th>
                        <th className="text-left p-3">Vendedor</th>
                        <th className="text-left p-3">Consultado em</th>
                        <th className="text-center p-3">WhatsApp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {clientes.map((a) => (
                        <tr key={a.id} className="hover:bg-muted/20">
                          <td className="p-3">
                            <div className="font-medium">{a.nome}</div>
                            <div className="text-xs text-muted-foreground">{formatCpf(a.cpf)}</div>
                          </td>
                          {mostraMargem && (
                            <td className="p-3 text-right font-bold text-green-500">
                              {a.melhorMargem > 0 ? formatBRL(a.melhorMargem) : '—'}
                            </td>
                          )}
                          {mostraMargem && (
                            <td className="p-3">
                              {a.melhorBanco ? (
                                <Badge variant="muted" className="text-[10px]">
                                  {BANCO_LABEL[a.melhorBanco as BancoSlug] || a.melhorBanco}
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                          )}
                          <td className="p-3 text-xs text-muted-foreground">
                            {a.empregador ? a.empregador.substring(0, 32) : '—'}
                          </td>
                          <td className="p-3 text-xs">{a.vendedor || '—'}</td>
                          <td className="p-3 text-xs text-muted-foreground">{formatDateBR(a.iniciado_em)}</td>
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
