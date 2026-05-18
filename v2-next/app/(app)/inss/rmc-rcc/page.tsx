'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { formatCpf, formatBRL } from '@/lib/utils';
import { useInssBaseStore } from '@/hooks/use-inss-base-store';
import { useConsultarSaqueComplementar, type CartaoSaque } from '@/hooks/use-saque-complementar';
import {
  CreditCard, Search, Banknote, Download, RefreshCw,
  CheckCircle2, AlertCircle, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import type { RmcRow } from '@/lib/inss-base-parser';

type CartaoFilter = '' | 'sem' | 'com' | 'PAN' | 'BMG' | 'DAYCOVAL';
const CODIGOS_BANCO: Record<string, string> = {
  PAN: '623',
  BMG: '318',
  DAYCOVAL: '707',
};

interface SaqueResult {
  cpf: string;
  ok: boolean;
  nome?: string;
  saqueTotal?: number;
  cartoes?: CartaoSaque[];
  error?: string;
}

const PER_PAGE = 100;

export default function RmcRccPage() {
  const { base } = useInssBaseStore();
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<CartaoFilter>('');
  const [pg, setPg] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saqueCache, setSaqueCache] = useState<Record<string, SaqueResult>>({});
  const [batch, setBatch] = useState<{ running: boolean; done: number; total: number }>({
    running: false, done: 0, total: 0,
  });
  const mut = useConsultarSaqueComplementar();

  const rmcRcc = base?.rmcRcc || [];

  // Filtros
  const filtered = useMemo(() => {
    let arr = rmcRcc;
    if (filtro === 'sem') arr = arr.filter((r) => r.mrgCart > 0 && !r.temCartao);
    else if (filtro === 'com') arr = arr.filter((r) => r.temCartao);
    else if (filtro in CODIGOS_BANCO) {
      const cod = CODIGOS_BANCO[filtro];
      arr = arr.filter((r) => r.cRmc === cod || r.cRcc === cod);
    }
    if (busca) {
      const q = busca.toLowerCase();
      const cpfNum = busca.replace(/\D/g, '');
      arr = arr.filter((r) =>
        r.nome.toLowerCase().includes(q) ||
        (cpfNum.length >= 6 && r.cpf.includes(cpfNum)),
      );
    }
    return arr;
  }, [rmcRcc, filtro, busca]);

  const items = filtered.slice(pg * PER_PAGE, (pg + 1) * PER_PAGE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));

  // KPIs
  const stats = useMemo(() => {
    const semCartao = rmcRcc.filter((r) => r.mrgCart > 0 && !r.temCartao).length;
    const comCartao = rmcRcc.filter((r) => r.temCartao).length;
    const totMrgCart = rmcRcc.reduce((s, r) => s + (r.mrgCartNova || 0), 0);
    const totMrgEmp = rmcRcc.reduce((s, r) => s + (r.mrgEmpNova || 0), 0);
    const saqueReal = Object.values(saqueCache).reduce((s, r) => s + (r.saqueTotal || 0), 0);
    return { semCartao, comCartao, totMrgCart, totMrgEmp, saqueReal };
  }, [rmcRcc, saqueCache]);

  // Seleção
  const toggleSel = (cpf: string) => {
    const next = new Set(selected);
    if (next.has(cpf)) next.delete(cpf); else next.add(cpf);
    setSelected(next);
  };
  const selecionarFiltrados = () => setSelected(new Set(filtered.map((r) => r.cpf)));
  const limparSelecao = () => setSelected(new Set());

  // Consulta batch saque complementar
  async function consultarLote() {
    if (selected.size === 0) {
      toast.error('Selecione clientes primeiro');
      return;
    }
    const cpfs = Array.from(selected);
    setBatch({ running: true, done: 0, total: cpfs.length });
    for (let i = 0; i < cpfs.length; i++) {
      const cpf = cpfs[i];
      const row = rmcRcc.find((r) => r.cpf === cpf);
      try {
        const r = await mut.mutateAsync({ cpf, matricula: row?.ben || '' });
        const saqueTotal = (r.cartoes || []).reduce((s, c) => s + (c.limiteSaqueDisp || 0), 0);
        setSaqueCache((prev) => ({
          ...prev,
          [cpf]: { cpf, ok: !!r.success, nome: r.nome, saqueTotal, cartoes: r.cartoes },
        }));
      } catch (e) {
        setSaqueCache((prev) => ({
          ...prev,
          [cpf]: { cpf, ok: false, error: (e as Error).message },
        }));
      }
      setBatch({ running: true, done: i + 1, total: cpfs.length });
      // Pausa pra não saturar a API
      await new Promise((r) => setTimeout(r, 500));
    }
    setBatch({ running: false, done: 0, total: 0 });
    toast.success(`Consulta finalizada — ${cpfs.length} CPFs processados`);
  }

  // Consulta de um cliente apenas (botão na linha)
  async function consultarUm(r: RmcRow) {
    try {
      const resp = await mut.mutateAsync({ cpf: r.cpf, matricula: r.ben || '' });
      const saqueTotal = (resp.cartoes || []).reduce((s, c) => s + (c.limiteSaqueDisp || 0), 0);
      setSaqueCache((prev) => ({
        ...prev,
        [r.cpf]: { cpf: r.cpf, ok: !!resp.success, nome: resp.nome, saqueTotal, cartoes: resp.cartoes },
      }));
    } catch {
      // toast no hook
    }
  }

  // Export CSV
  const exportCSV = () => {
    const header = [
      'CPF', 'Nome', 'Espécie', 'Tel 1', 'Tel 2', 'Tel 3',
      'Banco RMC', 'Cod RMC', 'Valor RMC',
      'Banco RCC', 'Cod RCC', 'Valor RCC',
      'Margem disp', 'Cartão potencial', 'Emp potencial',
      'Saque real consultado',
    ];
    const rows = filtered.map((r) => {
      const cache = saqueCache[r.cpf];
      return [
        r.cpf, r.nome, r.esp, r.t1, r.t2, r.t3,
        r.tRmc, r.cRmc, r.vRmc, r.tRcc, r.cRcc, r.vRcc,
        r.mrgCart, r.mrgCartNova, r.mrgEmpNova,
        cache?.saqueTotal ?? '',
      ];
    });
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inss-rmc-rcc-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!base) {
    return (
      <div className="max-w-5xl mx-auto p-6 space-y-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CreditCard className="size-6 text-purple-400" />
          INSS — RMC/RCC + Saque Complementar
        </h1>
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <Sparkles className="size-12 mx-auto mb-2 opacity-30" />
            <div className="text-sm mb-3">Nenhuma base carregada.</div>
            <Link href="/inss/higienizacao">
              <Button size="sm" variant="default">Ir para Higienização (carregar XLSX)</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CreditCard className="size-6 text-purple-400" />
            INSS — RMC/RCC + Saque Complementar
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cartões consignados da base <strong>{base.fname}</strong> · selecione clientes e consulte saque
            disponível em lote (BMG/DAYCOVAL via DataConsulta).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCSV} disabled={!filtered.length}>
          <Download className="size-4" />
          Exportar CSV ({filtered.length})
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Kpi label="Total clientes" value={rmcRcc.length} cor="text-foreground" />
        <Kpi label="🆕 Sem cartão" value={stats.semCartao} cor="text-yellow-400" />
        <Kpi label="💳 Com cartão" value={stats.comCartao} cor="text-purple-400" />
        <Kpi label="Potencial cartão" value={formatBRL(stats.totMrgCart)} cor="text-green-400" isText />
        <Kpi label="Potencial emp." value={formatBRL(stats.totMrgEmp)} cor="text-orange-400" isText />
        {stats.saqueReal > 0 && (
          <Kpi label="💰 Saque real" value={formatBRL(stats.saqueReal)} cor="text-green-400" isText />
        )}
      </div>

      {/* Batch progress */}
      {batch.running && (
        <Card className="border-purple-500/40 bg-purple-500/5">
          <CardContent className="p-3 flex items-center gap-3">
            <RefreshCw className="size-5 text-purple-400 animate-spin" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-purple-400">
                Consultando saque... {batch.done} / {batch.total}
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1">
                <div
                  className="h-full bg-purple-400 transition-all"
                  style={{ width: `${Math.round((batch.done / batch.total) * 100)}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filtros + ações */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[180px]">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Buscar
            </Label>
            <div className="relative mt-1">
              <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Nome ou CPF..."
                value={busca}
                onChange={(e) => { setBusca(e.target.value); setPg(0); }}
                className="pl-8"
              />
            </div>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Filtro
            </Label>
            <select
              value={filtro}
              onChange={(e) => { setFiltro(e.target.value as CartaoFilter); setPg(0); }}
              className="mt-1 h-10 rounded-md border border-input bg-background px-3 text-sm block"
            >
              <option value="">Todos</option>
              <option value="sem">🆕 Sem cartão (com margem)</option>
              <option value="com">💳 Com cartão</option>
              <option value="PAN">PAN (623)</option>
              <option value="BMG">BMG (318)</option>
              <option value="DAYCOVAL">DAYCOVAL (707)</option>
            </select>
          </div>
          <Button size="sm" variant="outline" onClick={selecionarFiltrados}>
            ☑ Selecionar {filtered.length}
          </Button>
          {selected.size > 0 && (
            <Button size="sm" variant="ghost" onClick={limparSelecao}>✕ {selected.size}</Button>
          )}
          {selected.size > 0 && (
            <Button size="sm" variant="default" onClick={consultarLote} disabled={batch.running} className="ml-auto">
              <Banknote className="size-4" />
              Consultar saque ({selected.size})
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Tabela */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/30">
                <tr>
                  <th className="w-8 p-2">
                    <input
                      type="checkbox"
                      onChange={(e) => {
                        if (e.target.checked) {
                          const next = new Set(selected);
                          items.forEach((r) => next.add(r.cpf));
                          setSelected(next);
                        } else {
                          const next = new Set(selected);
                          items.forEach((r) => next.delete(r.cpf));
                          setSelected(next);
                        }
                      }}
                      checked={items.length > 0 && items.every((r) => selected.has(r.cpf))}
                      className="cursor-pointer"
                    />
                  </th>
                  <th className="text-left p-2 font-semibold">Nome</th>
                  <th className="text-left p-2 font-semibold">CPF</th>
                  <th className="text-left p-2 font-semibold">Esp</th>
                  <th className="text-left p-2 font-semibold">Tel 1</th>
                  <th className="text-left p-2 font-semibold">RMC</th>
                  <th className="text-right p-2 font-semibold">Vlr RMC</th>
                  <th className="text-left p-2 font-semibold">RCC</th>
                  <th className="text-right p-2 font-semibold">Vlr RCC</th>
                  <th className="text-right p-2 font-semibold">Margem</th>
                  <th className="text-right p-2 font-semibold">Cart Pot.</th>
                  <th className="text-right p-2 font-semibold">Emp Pot.</th>
                  <th className="text-right p-2 font-semibold">Saque Real</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((r) => {
                  const cache = saqueCache[r.cpf];
                  const sel = selected.has(r.cpf);
                  return (
                    <tr key={r.cpf} className={`${sel ? 'bg-purple-500/5' : ''} hover:bg-muted/20`}>
                      <td className="p-2">
                        <input type="checkbox" checked={sel} onChange={() => toggleSel(r.cpf)} className="cursor-pointer" />
                      </td>
                      <td className="p-2 font-medium">{r.nome}</td>
                      <td className="p-2 font-mono text-[10px]">{formatCpf(r.cpf)}</td>
                      <td className="p-2">{r.esp || '—'}</td>
                      <td className="p-2 font-mono text-[10px]">{r.t1 || '—'}</td>
                      <td className="p-2">{r.cRmc ? <Badge variant="muted" className="text-[10px] font-mono">{r.cRmc}</Badge> : '—'}</td>
                      <td className={`p-2 text-right font-mono ${r.vRmc > 0 ? 'text-green-400' : 'text-muted-foreground'}`}>
                        {r.vRmc > 0 ? formatBRL(r.vRmc) : '—'}
                      </td>
                      <td className="p-2">{r.cRcc ? <Badge variant="muted" className="text-[10px] font-mono">{r.cRcc}</Badge> : '—'}</td>
                      <td className={`p-2 text-right font-mono ${r.vRcc > 0 ? 'text-purple-400' : 'text-muted-foreground'}`}>
                        {r.vRcc > 0 ? formatBRL(r.vRcc) : '—'}
                      </td>
                      <td className={`p-2 text-right font-mono ${r.mrgCart > 0 ? 'text-cyan-400' : 'text-muted-foreground'}`}>
                        {r.mrgCart > 0 ? formatBRL(r.mrgCart) : '—'}
                      </td>
                      <td className={`p-2 text-right font-mono ${r.mrgCartNova > 0 ? 'text-yellow-400' : 'text-muted-foreground'}`}>
                        {r.mrgCartNova > 0 ? formatBRL(r.mrgCartNova) : '—'}
                      </td>
                      <td className={`p-2 text-right font-mono ${r.mrgEmpNova > 0 ? 'text-orange-400' : 'text-muted-foreground'}`}>
                        {r.mrgEmpNova > 0 ? formatBRL(r.mrgEmpNova) : '—'}
                      </td>
                      <td className="p-2 text-right font-mono">
                        {cache ? (
                          cache.ok && cache.saqueTotal && cache.saqueTotal > 0 ? (
                            <span className="text-green-400 font-bold">{formatBRL(cache.saqueTotal)}</span>
                          ) : cache.ok ? (
                            <span className="text-muted-foreground text-[10px]">sem saque</span>
                          ) : (
                            <span className="text-red-400 text-[10px]" title={cache.error}>erro</span>
                          )
                        ) : '—'}
                      </td>
                      <td className="p-2">
                        <Button
                          variant={cache?.ok ? 'default' : 'outline'}
                          size="sm"
                          className="h-7 px-2 text-[10px]"
                          onClick={() => consultarUm(r)}
                          disabled={mut.isPending}
                        >
                          {cache?.ok ? <CheckCircle2 className="size-3" /> : <Banknote className="size-3" />}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {!items.length && (
                  <tr><td colSpan={14} className="p-10 text-center text-muted-foreground">Nenhum cliente encontrado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="p-3 border-t border-border flex items-center justify-between text-xs">
              <div className="text-muted-foreground">
                Mostrando {items.length} de {filtered.length} ({rmcRcc.length} na base)
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={pg === 0} onClick={() => setPg(pg - 1)}>Ant.</Button>
                <span className="px-2 self-center">{pg + 1} / {totalPages}</span>
                <Button variant="outline" size="sm" disabled={pg >= totalPages - 1} onClick={() => setPg(pg + 1)}>Próx.</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, cor, isText }: { label: string; value: number | string; cor: string; isText?: boolean }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
        <div className={`${isText ? 'text-base' : 'text-2xl'} font-mono font-bold mt-1 ${cor}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
