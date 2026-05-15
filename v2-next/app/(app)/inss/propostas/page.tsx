'use client';

import { useMemo, useState } from 'react';
import { useEsteiraInss, useEsteiraStats } from '@/hooks/use-inss-esteira';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCpf, formatBRL, formatDateBR } from '@/lib/utils';
import { FileText, Search, RefreshCw, AlertCircle, Download } from 'lucide-react';

const BANCO_LABEL: Record<string, string> = {
  FACTA: 'FACTA',
  QUALI: 'QualiBanking',
  JOINBANK: 'JoinBank',
  BRB: 'BRB',
  ICRED: 'ICRED',
  C6: 'C6',
  MERCANTIL: 'Mercantil',
  MANUAL: 'Manual',
};

// Histórico = propostas com status final (não estão mais em andamento)
const STATUS_FINAIS = new Set(['averbada', 'paga', 'recusada', 'cancelada']);
const STATUS_ATIVOS = new Set(['pendente', 'digitada', 'analise', 'aprovada', 'cip']);

const STATUS_VARIANT: Record<
  string,
  'default' | 'success' | 'warning' | 'destructive' | 'info' | 'muted'
> = {
  averbada: 'success',
  paga: 'success',
  recusada: 'destructive',
  cancelada: 'muted',
};

type ViewMode = 'finalizadas' | 'todas';

export default function PropostasInssPage() {
  const [view, setView] = useState<ViewMode>('finalizadas');
  const [busca, setBusca] = useState('');
  const { data: todas = [], isLoading, error, refetch, isFetching } = useEsteiraInss();
  const { data: stats } = useEsteiraStats();

  const filtradas = useMemo(() => {
    const base =
      view === 'finalizadas'
        ? todas.filter((p) => STATUS_FINAIS.has((p.status || '').toLowerCase()))
        : todas;
    if (!busca) return base;
    const q = busca.toLowerCase();
    const cpfNum = busca.replace(/\D/g, '');
    return base.filter((p) => {
      if (cpfNum.length >= 6 && p.cpf.includes(cpfNum)) return true;
      return (
        (p.nome || '').toLowerCase().includes(q) ||
        (p.contrato_origem || '').toLowerCase().includes(q) ||
        (p.codigo_af || '').toLowerCase().includes(q)
      );
    });
  }, [todas, view, busca]);

  const kpis = useMemo(() => {
    const final = todas.filter((p) => STATUS_FINAIS.has((p.status || '').toLowerCase()));
    const ativas = todas.filter((p) => STATUS_ATIVOS.has((p.status || '').toLowerCase()));
    const pagas = todas.filter((p) => p.status === 'paga');
    const trocoPago = pagas.reduce((s, p) => s + Number(p.valor_troco || 0), 0);
    const valorOpPago = pagas.reduce((s, p) => s + Number(p.valor_operacao || 0), 0);
    return {
      total: todas.length,
      finalizadas: final.length,
      ativas: ativas.length,
      pagas: pagas.length,
      trocoPago,
      valorOpPago,
    };
  }, [todas]);

  const exportCSV = () => {
    if (!filtradas.length) return;
    const header = [
      'CPF',
      'Nome',
      'Benefício',
      'Tipo',
      'Banco',
      'Banco origem',
      'Contrato origem',
      'Valor op.',
      'Parcela',
      'Troco',
      'Taxa nova',
      'Prazo novo',
      'Status',
      'AF',
      'Criada',
    ];
    const linhas = filtradas.map((p) => [
      p.cpf,
      p.nome || '',
      p.beneficio || '',
      p.tipo || '',
      p.banco || '',
      p.banco_origem || '',
      p.contrato_origem || '',
      p.valor_operacao ?? '',
      p.valor_parcela ?? '',
      p.valor_troco ?? '',
      p.taxa_nova ?? '',
      p.prazo_novo ?? '',
      p.status || '',
      p.codigo_af || '',
      p.created_at || '',
    ]);
    const csv = [header, ...linhas]
      .map((row) =>
        row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'),
      )
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `propostas-inss-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="size-6 text-green-400" />
            INSS — Propostas (Histórico)
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Visão de propostas finalizadas (pagas, averbadas, recusadas, canceladas).
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={exportCSV}
            variant="outline"
            size="sm"
            disabled={!filtradas.length}
            className="gap-2"
          >
            <Download className="size-4" />
            Exportar CSV
          </Button>
          <Button
            onClick={() => refetch()}
            variant="outline"
            size="sm"
            disabled={isFetching}
            className="gap-2"
          >
            <RefreshCw className={`size-4 ${isFetching ? 'animate-spin' : ''}`} />
            Recarregar
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <KpiCard label="Total geral" value={kpis.total} cor="text-foreground" />
        <KpiCard label="Finalizadas" value={kpis.finalizadas} cor="text-muted-foreground" />
        <KpiCard label="Ativas" value={kpis.ativas} cor="text-yellow-400" />
        <KpiCard label="Pagas" value={kpis.pagas} cor="text-green-400" />
        <KpiCard
          label="Troco pago"
          value={formatBRL(kpis.trocoPago)}
          cor="text-green-400"
          isText
        />
        <KpiCard
          label="Volume pago"
          value={formatBRL(kpis.valorOpPago)}
          cor="text-cyan-400"
          isText
        />
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Buscar
            </label>
            <div className="relative mt-1">
              <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="CPF, nome, contrato, AF..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
          <div className="flex gap-1 rounded-md border border-input p-0.5 bg-background">
            <Button
              size="sm"
              variant={view === 'finalizadas' ? 'default' : 'ghost'}
              onClick={() => setView('finalizadas')}
              className="h-8"
            >
              Finalizadas ({kpis.finalizadas})
            </Button>
            <Button
              size="sm"
              variant={view === 'todas' ? 'default' : 'ghost'}
              onClick={() => setView('todas')}
              className="h-8"
            >
              Todas ({kpis.total})
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      )}

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 flex items-center gap-3 text-destructive">
            <AlertCircle className="size-5" />
            <div>
              <div className="font-semibold">Erro ao carregar propostas</div>
              <div className="text-sm">{(error as Error).message}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && filtradas.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <FileText className="size-12 mx-auto mb-2 opacity-30" />
            <div className="text-sm">
              {view === 'finalizadas'
                ? 'Nenhuma proposta finalizada ainda.'
                : 'Nenhuma proposta encontrada.'}
            </div>
            {busca && <div className="text-xs mt-1">Tente afrouxar o filtro de busca.</div>}
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && filtradas.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs">
                  <tr>
                    <th className="text-left p-3 font-semibold">Cliente</th>
                    <th className="text-left p-3 font-semibold">Tipo / Banco</th>
                    <th className="text-right p-3 font-semibold">Valor op.</th>
                    <th className="text-right p-3 font-semibold">Troco</th>
                    <th className="text-right p-3 font-semibold">Taxa</th>
                    <th className="text-left p-3 font-semibold">Status</th>
                    <th className="text-left p-3 font-semibold">AF</th>
                    <th className="text-left p-3 font-semibold">Criada</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtradas.map((p) => {
                    const variant = STATUS_VARIANT[(p.status || '').toLowerCase()] || 'info';
                    return (
                      <tr key={p.id} className="hover:bg-muted/20">
                        <td className="p-3">
                          <div className="font-medium">{p.nome || '(sem nome)'}</div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {formatCpf(p.cpf)}
                          </div>
                        </td>
                        <td className="p-3 text-xs">
                          <div>{p.tipo}</div>
                          <Badge variant="outline" className="text-[10px] mt-1 font-mono">
                            {BANCO_LABEL[p.banco] || p.banco}
                          </Badge>
                        </td>
                        <td className="p-3 text-right font-mono text-xs">
                          {p.valor_operacao ? formatBRL(p.valor_operacao) : '—'}
                        </td>
                        <td className="p-3 text-right font-mono text-xs">
                          {p.valor_troco && p.valor_troco > 0 ? (
                            <span className="text-green-400 font-semibold">
                              {formatBRL(p.valor_troco)}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="p-3 text-right font-mono text-xs">
                          {p.taxa_nova ? `${p.taxa_nova}%` : '—'}
                        </td>
                        <td className="p-3">
                          <Badge variant={variant} className="text-[10px]">
                            {(p.status || '').toUpperCase()}
                          </Badge>
                        </td>
                        <td className="p-3 font-mono text-xs">{p.codigo_af || '—'}</td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {p.created_at ? formatDateBR(p.created_at) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="p-3 border-t border-border text-xs text-muted-foreground">
              Mostrando <strong className="text-foreground">{filtradas.length}</strong>{' '}
              {filtradas.length === 1 ? 'proposta' : 'propostas'}
              {busca ? ' (filtradas)' : ''}
            </div>
          </CardContent>
        </Card>
      )}

      {stats && (
        <div className="text-[11px] text-muted-foreground text-center">
          BD tem <strong>{stats.total}</strong> registros totais (incluindo de outros usuários se você
          for admin).
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  cor,
  isText,
}: {
  label: string;
  value: number | string;
  cor: string;
  isText?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          {label}
        </div>
        <div className={`${isText ? 'text-base' : 'text-2xl'} font-mono font-bold mt-1 ${cor}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
