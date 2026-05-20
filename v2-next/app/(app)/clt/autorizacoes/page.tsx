'use client';

import { useMemo, useState } from 'react';
import {
  useCltAutorizacoes,
  useReenviarAutzWpp,
  useSyncAutz,
  CltAutzFiltros,
} from '@/hooks/use-clt-autorizacoes';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCpf, formatDateBR } from '@/lib/utils';
import {
  Camera,
  RefreshCw,
  Send,
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
} from 'lucide-react';

const BANCOS = ['c6', 'facta', 'pan'] as const;
const STATUSES = ['pending', 'authorized', 'denied', 'expired'] as const;

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'muted'> = {
  authorized: 'success',
  pending: 'warning',
  denied: 'destructive',
  expired: 'muted',
};
const STATUS_LABEL: Record<string, string> = {
  authorized: 'Autorizada',
  pending: 'Pendente',
  denied: 'Recusada',
  expired: 'Expirada',
};

export default function AutorizacoesCltPage() {
  const [filtros, setFiltros] = useState<CltAutzFiltros>({});
  const { data: lista = [], isLoading, error, refetch, isFetching } = useCltAutorizacoes(filtros);
  const reenviar = useReenviarAutzWpp();
  const sync = useSyncAutz();

  const kpis = useMemo(() => {
    const por: Record<string, number> = {};
    for (const a of lista) por[a.status] = (por[a.status] || 0) + 1;
    return {
      total: lista.length,
      pending: por.pending || 0,
      authorized: por.authorized || 0,
      negativas: (por.denied || 0) + (por.expired || 0),
    };
  }, [lista]);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Camera className="size-6 text-cyan-400" />
            CLT — Autorizações LGPD
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Selfies pendentes/autorizadas dos clientes. C6 ativo. Atualiza a cada 60s.
          </p>
        </div>
        <Button onClick={() => refetch()} variant="outline" size="sm" disabled={isFetching} className="gap-2">
          <RefreshCw className={isFetching ? 'size-4 animate-spin' : 'size-4'} />
          Atualizar
        </Button>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-3 flex items-center gap-2 flex-wrap">
          <select
            value={filtros.banco || ''}
            onChange={(e) => setFiltros((f) => ({ ...f, banco: e.target.value || undefined }))}
            className="h-9 px-3 text-sm rounded-md border border-input bg-background"
          >
            <option value="">Todos os bancos</option>
            {BANCOS.map((b) => (
              <option key={b} value={b}>{b.toUpperCase()}</option>
            ))}
          </select>
          <select
            value={filtros.status || ''}
            onChange={(e) => setFiltros((f) => ({ ...f, status: e.target.value || undefined }))}
            className="h-9 px-3 text-sm rounded-md border border-input bg-background"
          >
            <option value="">Todos os status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
          {(filtros.banco || filtros.status) && (
            <Button variant="ghost" size="sm" onClick={() => setFiltros({})}>Limpar</Button>
          )}
        </CardContent>
      </Card>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
      )}

      {/* Erro */}
      {error && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 flex items-center gap-2 text-destructive">
            <AlertCircle className="size-4" /> {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {/* Vazio */}
      {!isLoading && !error && lista.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center space-y-2">
            <div className="text-5xl">📭</div>
            <div className="font-semibold">Nenhuma autorização registrada</div>
            <div className="text-sm text-muted-foreground max-w-md mx-auto">
              Quando você gerar um link de selfie pro cliente (botão &quot;Gerar Selfie&quot; no card do C6 em /clt/consulta), aparece aqui.
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPIs + tabela */}
      {!isLoading && !error && lista.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Kpi label="Total" value={kpis.total} icon={Camera} cor="text-foreground" />
            <Kpi label="Pendentes" value={kpis.pending} icon={Clock} cor="text-yellow-400" />
            <Kpi label="Autorizadas" value={kpis.authorized} icon={CheckCircle2} cor="text-green-400" />
            <Kpi label="Recusadas/Expiradas" value={kpis.negativas} icon={XCircle} cor="text-red-400" />
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs">
                    <tr>
                      <th className="text-left p-3 font-semibold">Gerada</th>
                      <th className="text-left p-3 font-semibold">Banco</th>
                      <th className="text-left p-3 font-semibold">CPF</th>
                      <th className="text-left p-3 font-semibold">Nome</th>
                      <th className="text-left p-3 font-semibold">Status</th>
                      <th className="text-left p-3 font-semibold">Telefone</th>
                      <th className="text-right p-3 font-semibold">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {lista.map((a) => {
                      const variant = STATUS_VARIANT[a.status] || 'muted';
                      const label = STATUS_LABEL[a.status] || a.status;
                      const podeReenviar = a.status === 'pending' && a.link_selfie && a.telefone;
                      return (
                        <tr key={a.id} className="hover:bg-muted/20">
                          <td className="p-3 text-[11px] text-muted-foreground whitespace-nowrap">
                            {a.gerado_em ? formatDateBR(a.gerado_em) : '-'}
                          </td>
                          <td className="p-3">
                            <Badge variant="muted" className="text-[10px] uppercase">{a.banco}</Badge>
                          </td>
                          <td className="p-3 font-mono text-[11px]">{formatCpf(a.cpf)}</td>
                          <td className="p-3 text-xs">{a.nome || '-'}</td>
                          <td className="p-3">
                            <Badge variant={variant} className="text-[10px]">{label}</Badge>
                          </td>
                          <td className="p-3 font-mono text-[11px] text-muted-foreground">
                            {a.telefone || '-'}
                          </td>
                          <td className="p-3">
                            <div className="flex items-center justify-end gap-1 flex-wrap">
                              {podeReenviar && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1 h-7 text-[10px]"
                                  disabled={reenviar.isPending}
                                  onClick={() => reenviar.mutate({
                                    id: a.id,
                                    link: a.link_selfie!,
                                    telefone: a.telefone!,
                                    banco: a.banco,
                                  })}
                                  title="Reenviar link de selfie no WhatsApp"
                                >
                                  <Send className="size-3" /> Enviar WA
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1 h-7 text-[10px]"
                                disabled={sync.isPending}
                                onClick={() => sync.mutate({ cpf: a.cpf, banco: a.banco })}
                                title="Forçar sync com o banco"
                              >
                                <RefreshCw className={sync.isPending ? 'size-3 animate-spin' : 'size-3'} />
                                Sync
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Kpi({
  label, value, icon: Icon, cor,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  cor: string;
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1">
          <Icon className="size-3" /> {label}
        </div>
        <div className={`text-2xl font-mono font-bold mt-1 ${cor}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
