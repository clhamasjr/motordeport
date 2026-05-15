'use client';

import { useMemo, useState } from 'react';
import { useEsteiraCLT, EsteiraFiltros } from '@/hooks/use-clt-esteira';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCpf, formatBRL, formatDateBR } from '@/lib/utils';
import { ListChecks, Search, RefreshCw, ExternalLink, AlertCircle } from 'lucide-react';

const BANCO_LABEL: Record<string, string> = {
  c6: 'C6',
  presencabank: 'PresençaBank',
  joinbank: 'QualiBanking',
  v8_qi: 'V8 QI',
  v8_celcoin: 'V8 Celcoin',
  v8: 'V8',
  mercantil: 'Mercantil',
  handbank: 'UY3',
  fintech_qi: 'Fintech QI',
  fintech_celcoin: 'Fintech Celcoin',
};

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'destructive' | 'info' | 'muted'> = {
  criada: 'info',
  em_analise: 'info',
  aguardando_documentos: 'warning',
  aprovada: 'success',
  formalizada: 'success',
  averbada: 'success',
  paga: 'success',
  recusada: 'destructive',
  cancelada: 'muted',
  pendente: 'warning',
};

export default function EsteiraCltPage() {
  const [busca, setBusca] = useState('');
  const [bancoFilter, setBancoFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const filtros = useMemo<EsteiraFiltros>(() => {
    const f: EsteiraFiltros = {};
    if (busca && /^\d{6,11}$/.test(busca.replace(/\D/g, ''))) {
      f.cpf = busca.replace(/\D/g, '');
    }
    if (bancoFilter) f.banco = bancoFilter;
    if (statusFilter) f.status_interno = statusFilter;
    return f;
  }, [busca, bancoFilter, statusFilter]);

  const { data, isLoading, error, refetch, isFetching } = useEsteiraCLT(filtros);
  const propostas = data?.propostas || [];

  const filtradas = useMemo(() => {
    if (!busca || filtros.cpf) return propostas;
    const q = busca.toLowerCase();
    return propostas.filter(p =>
      (p.nome || '').toLowerCase().includes(q) ||
      (p.empregador_nome || '').toLowerCase().includes(q) ||
      (p.proposta_id_externo || '').toLowerCase().includes(q)
    );
  }, [propostas, busca, filtros.cpf]);

  const kpis = useMemo(() => {
    const total = propostas.length;
    const aprovadas = propostas.filter(p =>
      ['aprovada', 'formalizada', 'averbada', 'paga'].includes((p.status_interno || '').toLowerCase()),
    ).length;
    const pendentes = propostas.filter(p =>
      ['criada', 'em_analise', 'aguardando_documentos', 'pendente'].includes((p.status_interno || '').toLowerCase()),
    ).length;
    const valorTotal = propostas
      .filter(p => p.valor_liquido)
      .reduce((s, p) => s + Number(p.valor_liquido || 0), 0);
    return { total, aprovadas, pendentes, valorTotal };
  }, [propostas]);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ListChecks className="w-6 h-6 text-primary" /> CLT — Esteira de Propostas
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Propostas digitadas em todos os bancos. Status, valores, link de formalização.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2">
          <RefreshCw className={isFetching ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} />
          Atualizar
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi label="Total" valor={kpis.total} />
        <Kpi label="Aprovadas" valor={kpis.aprovadas} cor="text-green-400" />
        <Kpi label="Pendentes" valor={kpis.pendentes} cor="text-yellow-500" />
        <Kpi label="Valor total" valor={formatBRL(kpis.valorTotal)} cor="text-bank-c6" small />
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-3 grid grid-cols-1 md:grid-cols-3 gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="CPF, nome, empresa, ID..." className="pl-9"
              value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <select value={bancoFilter} onChange={(e) => setBancoFilter(e.target.value)}
            className="h-10 px-3 text-sm rounded-md border border-input bg-background">
            <option value="">Todos os bancos</option>
            {Object.entries(BANCO_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 px-3 text-sm rounded-md border border-input bg-background">
            <option value="">Todos os status</option>
            {['criada','em_analise','aguardando_documentos','aprovada','formalizada','averbada','paga','recusada','cancelada'].map(s => (
              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </CardContent>
      </Card>

      {/* Lista */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
      )}

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-bold text-destructive">Erro carregando esteira</div>
              <div className="text-sm text-muted-foreground mt-1">{(error as Error).message}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && filtradas.length === 0 && (
        <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">
          Nenhuma proposta encontrada. Quando digitar uma proposta, ela aparece aqui.
        </CardContent></Card>
      )}

      {filtradas.length > 0 && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-secondary/30 border-b border-border">
                <tr>
                  <th className="text-left p-3">Banco</th>
                  <th className="text-left p-3">Cliente</th>
                  <th className="text-left p-3">CPF</th>
                  <th className="text-left p-3">Empresa</th>
                  <th className="text-right p-3">Valor</th>
                  <th className="text-right p-3">Parcelas</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">Data</th>
                  <th className="text-left p-3">Vendedor</th>
                  <th className="text-center p-3">Link</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((p) => (
                  <tr key={p.id} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                    <td className="p-3">
                      <Badge variant="muted" className="text-[10px]">{BANCO_LABEL[p.banco] || p.banco}</Badge>
                    </td>
                    <td className="p-3 font-medium">{(p.nome || '-').substring(0, 30)}</td>
                    <td className="p-3 font-mono">{formatCpf(p.cpf)}</td>
                    <td className="p-3 text-muted-foreground">{(p.empregador_nome || '-').substring(0, 25)}</td>
                    <td className="p-3 text-right font-bold text-green-400">{p.valor_liquido ? formatBRL(p.valor_liquido) : '-'}</td>
                    <td className="p-3 text-right text-muted-foreground">
                      {p.qtd_parcelas ? `${p.qtd_parcelas}x ${p.valor_parcela ? formatBRL(p.valor_parcela) : ''}` : '-'}
                    </td>
                    <td className="p-3">
                      <Badge variant={STATUS_VARIANT[(p.status_interno || '').toLowerCase()] || 'muted'} className="text-[10px]">
                        {(p.status_interno || '?').replace(/_/g, ' ')}
                      </Badge>
                    </td>
                    <td className="p-3 text-muted-foreground">{formatDateBR(p.created_at || '')}</td>
                    <td className="p-3 text-muted-foreground text-[11px]">{p.vendedor_nome || '-'}</td>
                    <td className="p-3 text-center">
                      {p.link_formalizacao && (
                        <a href={p.link_formalizacao} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Kpi({ label, valor, cor, small }: { label: string; valor: string | number; cor?: string; small?: boolean }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`${small ? 'text-base' : 'text-2xl'} font-black mt-0.5 ${cor || ''}`}>
          {typeof valor === 'number' ? valor.toLocaleString('pt-BR') : valor}
        </div>
      </CardContent>
    </Card>
  );
}
