'use client';

import { useMemo, useState } from 'react';
import { useEsteiraInss } from '@/hooks/use-inss-esteira';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCpf, formatBRL, formatDateBR } from '@/lib/utils';
import { EsteiraFiltros, DigitacaoItem } from '@/lib/inss-types';
import { ListChecks, Search, RefreshCw, ExternalLink, AlertCircle } from 'lucide-react';

const BANCO_LABEL: Record<string, string> = {
  FACTA: 'FACTA',
  QUALI: 'QualiBanking',
  JOINBANK: 'JoinBank',
  BRB: 'BRB',
  ICRED: 'ICRED',
  C6: 'C6',
  DIGIO: 'Digio',
  DAYCOVAL: 'Daycoval',
  MERCANTIL: 'Mercantil',
  MANUAL: 'Manual',
};

const TIPO_LABEL: Record<string, string> = {
  portabilidade: '🔄 Port',
  port_refin: '🔄 Port+Refin',
  refinanciamento: '🔁 Refin',
  novo: '💰 Empréstimo Novo',
  cartao: '💳 Cartão',
  saque: '💵 Saque RMC/RCC',
};

const STATUS_VARIANT: Record<
  string,
  'default' | 'success' | 'warning' | 'destructive' | 'info' | 'muted'
> = {
  pendente: 'warning',
  digitada: 'info',
  analise: 'info',
  aprovada: 'success',
  cip: 'info',
  averbada: 'success',
  paga: 'success',
  recusada: 'destructive',
  cancelada: 'muted',
};

const STATUS_OPCOES = [
  '',
  'pendente',
  'digitada',
  'analise',
  'aprovada',
  'cip',
  'averbada',
  'paga',
  'recusada',
  'cancelada',
];

export default function EsteiraInssPage() {
  const [busca, setBusca] = useState('');
  const [bancoFilter, setBancoFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const filtros = useMemo<EsteiraFiltros>(() => {
    const f: EsteiraFiltros = {};
    if (busca && /^\d{6,11}$/.test(busca.replace(/\D/g, ''))) {
      f.cpf = busca.replace(/\D/g, '');
    }
    if (bancoFilter) f.banco = bancoFilter;
    if (statusFilter) f.status = statusFilter;
    return f;
  }, [busca, bancoFilter, statusFilter]);

  const { data: propostas = [], isLoading, error, refetch, isFetching } = useEsteiraInss(filtros);

  const filtradas = useMemo(() => {
    if (!busca || filtros.cpf) return propostas;
    const q = busca.toLowerCase();
    return propostas.filter(
      (p) =>
        (p.nome || '').toLowerCase().includes(q) ||
        (p.contrato_origem || '').toLowerCase().includes(q) ||
        (p.codigo_af || '').toLowerCase().includes(q),
    );
  }, [propostas, busca, filtros.cpf]);

  const kpis = useMemo(() => {
    const total = propostas.length;
    const aprovadas = propostas.filter((p) =>
      ['aprovada', 'averbada', 'paga'].includes((p.status || '').toLowerCase()),
    ).length;
    const pendentes = propostas.filter((p) =>
      ['pendente', 'digitada', 'analise', 'cip'].includes((p.status || '').toLowerCase()),
    ).length;
    const recusadas = propostas.filter((p) =>
      ['recusada', 'cancelada'].includes((p.status || '').toLowerCase()),
    ).length;
    const trocoTotal = propostas
      .filter((p) => p.valor_troco)
      .reduce((s, p) => s + Number(p.valor_troco || 0), 0);
    return { total, aprovadas, pendentes, recusadas, trocoTotal };
  }, [propostas]);

  // Lista dos bancos presentes nas propostas (pra filtro)
  const bancosDisponiveis = useMemo(() => {
    const s = new Set(propostas.map((p) => p.banco || 'MANUAL'));
    return Array.from(s).sort();
  }, [propostas]);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ListChecks className="size-6 text-purple-400" />
            INSS — Esteira de Propostas
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Propostas digitadas (port + refin + empréstimo novo + cartão + saque) em tempo real.
          </p>
        </div>
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

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2">
        <KpiCard label="Total" value={kpis.total} cor="text-foreground" />
        <KpiCard label="Aprovadas" value={kpis.aprovadas} cor="text-green-400" />
        <KpiCard label="Pendentes" value={kpis.pendentes} cor="text-yellow-400" />
        <KpiCard label="Recusadas" value={kpis.recusadas} cor="text-red-400" />
        <KpiCard
          label="Troco total"
          value={formatBRL(kpis.trocoTotal)}
          cor="text-cyan-400"
          isText
        />
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Buscar (CPF, nome, contrato, AF)
            </label>
            <div className="relative mt-1">
              <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="ex: 12345678900"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Banco
            </label>
            <select
              value={bancoFilter}
              onChange={(e) => setBancoFilter(e.target.value)}
              className="mt-1 h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Todos</option>
              {bancosDisponiveis.map((b) => (
                <option key={b} value={b}>
                  {BANCO_LABEL[b] || b}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="mt-1 h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {STATUS_OPCOES.map((s) => (
                <option key={s} value={s}>
                  {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Todos'}
                </option>
              ))}
            </select>
          </div>
          {(busca || bancoFilter || statusFilter) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setBusca('');
                setBancoFilter('');
                setStatusFilter('');
              }}
            >
              Limpar
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      )}

      {/* Erro */}
      {error && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 flex items-center gap-3 text-destructive">
            <AlertCircle className="size-5" />
            <div>
              <div className="font-semibold">Erro ao carregar esteira</div>
              <div className="text-sm">{(error as Error).message}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lista vazia */}
      {!isLoading && !error && filtradas.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <ListChecks className="size-12 mx-auto mb-2 opacity-30" />
            <div className="text-sm">
              Nenhuma proposta encontrada
              {busca || bancoFilter || statusFilter ? ' com esses filtros' : ''}.
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabela */}
      {!isLoading && !error && filtradas.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs">
                  <tr>
                    <th className="text-left p-3 font-semibold">Cliente</th>
                    <th className="text-left p-3 font-semibold">Tipo</th>
                    <th className="text-left p-3 font-semibold">Banco</th>
                    <th className="text-right p-3 font-semibold">Valor op.</th>
                    <th className="text-right p-3 font-semibold">Parcela</th>
                    <th className="text-right p-3 font-semibold">Troco</th>
                    <th className="text-left p-3 font-semibold">Status</th>
                    <th className="text-left p-3 font-semibold">AF</th>
                    <th className="text-left p-3 font-semibold">Criada</th>
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtradas.map((p) => (
                    <PropostaRow key={p.id} p={p} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-3 border-t border-border text-xs text-muted-foreground">
              Mostrando <strong className="text-foreground">{filtradas.length}</strong>{' '}
              {filtradas.length === 1 ? 'proposta' : 'propostas'}
              {filtros.banco || filtros.cpf || filtros.status ? ' (filtradas)' : ''}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PropostaRow({ p }: { p: DigitacaoItem }) {
  const statusVariant = STATUS_VARIANT[(p.status || '').toLowerCase()] || 'muted';
  return (
    <tr className="hover:bg-muted/20">
      <td className="p-3">
        <div className="font-medium">{p.nome || '(sem nome)'}</div>
        <div className="text-xs text-muted-foreground font-mono">{formatCpf(p.cpf)}</div>
        {p.beneficio && (
          <div className="text-[10px] text-muted-foreground font-mono">NB {p.beneficio}</div>
        )}
      </td>
      <td className="p-3 text-xs">{TIPO_LABEL[p.tipo] || p.tipo}</td>
      <td className="p-3">
        <Badge variant="outline" className="font-mono text-[10px]">
          {BANCO_LABEL[p.banco] || p.banco}
        </Badge>
        {p.banco_origem && (
          <div className="text-[10px] text-muted-foreground mt-0.5">
            ← {p.banco_origem}
          </div>
        )}
      </td>
      <td className="p-3 text-right font-mono text-xs">
        {p.valor_operacao ? formatBRL(p.valor_operacao) : '—'}
      </td>
      <td className="p-3 text-right font-mono text-xs">
        {p.valor_parcela ? formatBRL(p.valor_parcela) : '—'}
      </td>
      <td className="p-3 text-right font-mono text-xs">
        {p.valor_troco && p.valor_troco > 0 ? (
          <span className="text-green-400 font-semibold">{formatBRL(p.valor_troco)}</span>
        ) : (
          '—'
        )}
      </td>
      <td className="p-3">
        <Badge variant={statusVariant} className="text-[10px]">
          {(p.status || '').toUpperCase()}
        </Badge>
      </td>
      <td className="p-3 font-mono text-xs">{p.codigo_af || '—'}</td>
      <td className="p-3 text-xs text-muted-foreground">
        {p.created_at ? formatDateBR(p.created_at) : '—'}
      </td>
      <td className="p-3">
        {p.url_formalizacao && (
          <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0">
            <a
              href={p.url_formalizacao}
              target="_blank"
              rel="noopener noreferrer"
              title="Abrir link de formalização"
            >
              <ExternalLink className="size-4" />
            </a>
          </Button>
        )}
      </td>
    </tr>
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
