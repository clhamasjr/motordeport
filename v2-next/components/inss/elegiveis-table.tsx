'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { formatCpf, formatBRL } from '@/lib/utils';
import { ElegivelRow } from '@/lib/inss-base-parser';
import { ORDEM } from '@/lib/inss-motor';
import { useInssBaseStore } from '@/hooks/use-inss-base-store';
import { Search, Download, ShoppingCart, X } from 'lucide-react';

type ElegRealMode = 'nova' | 'todos';

interface Filtros {
  banco: string;
  taxa: string;          // valor mínimo
  trocoMin: string;
  trocoMax: string;
  vcMin: string;
  vcMax: string;
  parMin: string;
  parMax: string;
  salMin: string;
  salMax: string;
  pagasMin: string;
  pagasMax: string;
  idadeMin: string;
  idadeMax: string;
  margemPctMin: string;
  margemPctMax: string;
  cartao: string;
  invalidez: string;
  enquadramento: string;
  elegReal: ElegRealMode;
  busca: string;
}

const INITIAL: Filtros = {
  banco: '', taxa: '', trocoMin: '', trocoMax: '', vcMin: '', vcMax: '',
  parMin: '', parMax: '', salMin: '', salMax: '', pagasMin: '', pagasMax: '',
  idadeMin: '', idadeMax: '', margemPctMin: '', margemPctMax: '',
  cartao: '', invalidez: '', enquadramento: '', elegReal: 'nova', busca: '',
};

const pN = (v: string) => parseFloat(v.replace(',', '.')) || 0;
const pI = (v: string) => parseInt(v, 10) || 0;

const PER_PAGE = 50;

export function ElegiveisTable() {
  const { base, selectedCpfs, toggleSelected, selectAll, clearSelection } = useInssBaseStore();
  const [f, setF] = useState<Filtros>(INITIAL);
  const [pg, setPg] = useState(0);

  const update = <K extends keyof Filtros>(k: K, v: Filtros[K]) => {
    setF((prev) => ({ ...prev, [k]: v }));
    setPg(0);
  };

  // Map rmcRcc por cpf pra filtros (cartão, margem%)
  const rmcByCpf = useMemo(() => {
    const m: Record<string, (typeof base extends { rmcRcc: infer R } ? R : never)[number]> = {} as Record<string, never>;
    if (!base) return m as Record<string, never>;
    for (const r of base.rmcRcc) (m as Record<string, unknown>)[r.cpf] = r;
    return m;
  }, [base]);

  const filtered = useMemo(() => {
    if (!base) return [] as ElegivelRow[];
    let arr = base.elegiveis;

    // Nova regra de elegibilidade
    if (f.elegReal === 'nova') arr = arr.filter((r) => r.elegRealOk === true);

    if (f.banco) arr = arr.filter((r) => r.dest === f.banco);
    if (f.taxa) {
      const min = pN(f.taxa);
      arr = arr.filter((r) => typeof r.taxa === 'number' && r.taxa >= min);
    }
    if (f.trocoMin) arr = arr.filter((r) => r.troco >= pN(f.trocoMin));
    if (f.trocoMax) arr = arr.filter((r) => r.troco <= pN(f.trocoMax));
    if (f.vcMin) arr = arr.filter((r) => r.vc >= pN(f.vcMin));
    if (f.vcMax) arr = arr.filter((r) => r.vc <= pN(f.vcMax));
    if (f.parMin) arr = arr.filter((r) => r.par >= pN(f.parMin));
    if (f.parMax) arr = arr.filter((r) => r.par <= pN(f.parMax));
    if (f.salMin) arr = arr.filter((r) => r.sal >= pN(f.salMin));
    if (f.salMax) arr = arr.filter((r) => r.sal <= pN(f.salMax));
    if (f.pagasMin) arr = arr.filter((r) => r.pag >= pI(f.pagasMin));
    if (f.pagasMax) arr = arr.filter((r) => r.pag <= pI(f.pagasMax));
    if (f.idadeMin || f.idadeMax) {
      const min = pI(f.idadeMin), max = pI(f.idadeMax);
      arr = arr.filter((r) => {
        const a = typeof r.idade === 'number' ? r.idade : parseInt(String(r.idade), 10);
        if (isNaN(a)) return false;
        if (min && a < min) return false;
        if (max && a > max) return false;
        return true;
      });
    }
    if (f.cartao) {
      arr = arr.filter((r) => {
        const x = (rmcByCpf as Record<string, { temRmc: boolean; temRcc: boolean; temCartao: boolean }>)[r.cpf];
        if (!x) {
          return f.cartao === 'sem' || f.cartao === 'sem_rmc' || f.cartao === 'sem_rcc' || f.cartao === 'sem_rmc_ou_rcc';
        }
        if (f.cartao === 'sem') return !x.temCartao;
        if (f.cartao === 'sem_rmc') return !x.temRmc;
        if (f.cartao === 'sem_rcc') return !x.temRcc;
        if (f.cartao === 'sem_rmc_ou_rcc') return !x.temRmc || !x.temRcc;
        if (f.cartao === 'com') return x.temCartao;
        if (f.cartao === 'com_rmc') return x.temRmc;
        if (f.cartao === 'com_rcc') return x.temRcc;
        return true;
      });
    }
    if (f.invalidez === 'sim') arr = arr.filter((r) => r.isInv);
    else if (f.invalidez === 'nao') arr = arr.filter((r) => !r.isInv);

    if (f.enquadramento) arr = arr.filter((r) => r.compStatus === f.enquadramento);

    if (f.busca) {
      const q = f.busca.toLowerCase();
      const cpfNum = f.busca.replace(/\D/g, '');
      arr = arr.filter((r) => {
        if (cpfNum.length >= 6 && r.cpf.includes(cpfNum)) return true;
        return (
          (r.nome || '').toLowerCase().includes(q) ||
          (r.con || '').toLowerCase().includes(q) ||
          (r.cod || '').includes(q)
        );
      });
    }
    return arr;
  }, [base, f, rmcByCpf]);

  const items = filtered.slice(pg * PER_PAGE, (pg + 1) * PER_PAGE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));

  // CPFs únicos do filtro (pra "Selecionar todos")
  const cpfsFiltro = useMemo(() => Array.from(new Set(filtered.map((r) => r.cpf))), [filtered]);
  const cpfsFiltroNum = cpfsFiltro.length;
  const contratosFiltro = filtered.length;

  const kpis = useMemo(() => {
    const trocoTotal = filtered.reduce((s, r) => s + (r.troco || 0), 0);
    const vcTotal = filtered.reduce((s, r) => s + (r.vc || 0), 0);
    return { trocoTotal, vcTotal, clientes: cpfsFiltroNum, contratos: contratosFiltro };
  }, [filtered, cpfsFiltroNum, contratosFiltro]);

  // Export CSV
  const exportCSV = () => {
    if (!filtered.length) return;
    const header = [
      'CPF', 'Nome', 'Benefício', 'Contrato', 'Banco origem', 'Parcela', 'Nova parcela estim.', 'Saldo', 'Prazo', 'Pagas',
      'Idade', 'Taxa origem', 'Banco destino', 'Vlr Contrato', 'Troco', 'Taxa nova',
      'Comp. %', 'Status enquadramento', 'Resolve sozinho', 'Redução estim.', 'Tel 1', 'Tel 2', 'Tel 3',
    ];
    const rows = filtered.map((r) => [
      r.cpf, r.nome, r.ben || '', r.con || '', r.cod, r.par, r.parcelaNovaEstim || '', r.sal, r.prazo, r.pag,
      String(r.idade), r.taxaOrig || '', r.dest, r.vc, r.troco, r.taxa,
      r.compPct || '', r.compStatus || '', r.resolveExc ? 'SIM' : '', r.reducaoEstim || '',
      r.t1 || '', r.t2 || '', r.t3 || '',
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inss-elegiveis-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!base) return null;

  return (
    <div className="space-y-3">
      {/* Header: KPIs + Ações */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard label="Clientes filtrados" value={kpis.clientes} />
        <KpiCard label="Contratos" value={kpis.contratos} />
        <KpiCard label="Troco total" value={formatBRL(kpis.trocoTotal)} isText cor="text-green-400" />
        <KpiCard label="VC total" value={formatBRL(kpis.vcTotal)} isText cor="text-cyan-400" />
      </div>

      {/* Toggle "Nova regra" */}
      <Card className="border-green-500/30 bg-green-500/5">
        <CardContent className="p-3 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-green-400 uppercase tracking-wider">🎯 Elegibilidade — Nova regra</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Dentro de 45% = elegível. Excedente só elegível se 1 port resolver. Acima sem solução = excluído.
            </div>
          </div>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant={f.elegReal === 'nova' ? 'default' : 'outline'}
              onClick={() => update('elegReal', 'nova')}
            >
              🎯 Nova regra
            </Button>
            <Button
              size="sm"
              variant={f.elegReal === 'todos' ? 'default' : 'outline'}
              onClick={() => update('elegReal', 'todos')}
            >
              📋 Todos
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Busca + Ações principais */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[200px]">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Buscar
            </Label>
            <div className="relative mt-1">
              <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="CPF, nome ou contrato..." value={f.busca} onChange={(e) => update('busca', e.target.value)} className="pl-8" />
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (selectedCpfs.size > 0) clearSelection();
              else selectAll(cpfsFiltro);
            }}
          >
            <ShoppingCart className="size-4" />
            {selectedCpfs.size > 0 ? `Limpar (${selectedCpfs.size})` : `Selecionar ${cpfsFiltroNum}`}
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={!filtered.length}>
            <Download className="size-4" />
            Exportar CSV ({filtered.length})
          </Button>
        </CardContent>
      </Card>

      {/* Filtros */}
      <Card>
        <CardContent className="p-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            <Field label="Banco destino">
              <select className="h-9 rounded-md border border-input bg-background px-2 text-xs" value={f.banco} onChange={(e) => update('banco', e.target.value)}>
                <option value="">Todos</option>
                {ORDEM.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </Field>
            <Field label="Taxa mínima %">
              <select className="h-9 rounded-md border border-input bg-background px-2 text-xs" value={f.taxa} onChange={(e) => update('taxa', e.target.value)}>
                <option value="">Todas</option>
                {[1.50, 1.55, 1.60, 1.66, 1.70, 1.75, 1.80, 1.85].map((t) => (
                  <option key={t} value={t}>{`≥ ${t.toFixed(2)}%`}</option>
                ))}
              </select>
            </Field>
            <Field label="Cartão">
              <select className="h-9 rounded-md border border-input bg-background px-2 text-xs" value={f.cartao} onChange={(e) => update('cartao', e.target.value)}>
                <option value="">Qualquer</option>
                <option value="sem">Sem nenhum cartão</option>
                <option value="sem_rmc">Sem RMC</option>
                <option value="sem_rcc">Sem RCC</option>
                <option value="sem_rmc_ou_rcc">Sem RMC OU RCC</option>
                <option value="com">Com algum cartão</option>
                <option value="com_rmc">Com RMC</option>
                <option value="com_rcc">Com RCC</option>
              </select>
            </Field>
            <Field label="Enquadramento (45%)">
              <select className="h-9 rounded-md border border-input bg-background px-2 text-xs" value={f.enquadramento} onChange={(e) => update('enquadramento', e.target.value)}>
                <option value="">Todos</option>
                <option value="dentro_regra">✅ Dentro (≤45%)</option>
                <option value="fora_regra_resolvivel">🔄 Fora — refin resolve</option>
                <option value="fora_regra_inviavel">❌ Fora — sem solução</option>
              </select>
            </Field>
            <RangeField label="Troco R$" min={f.trocoMin} max={f.trocoMax} onMin={(v) => update('trocoMin', v)} onMax={(v) => update('trocoMax', v)} />
            <RangeField label="Vlr contrato R$" min={f.vcMin} max={f.vcMax} onMin={(v) => update('vcMin', v)} onMax={(v) => update('vcMax', v)} />
            <RangeField label="Parcela R$" min={f.parMin} max={f.parMax} onMin={(v) => update('parMin', v)} onMax={(v) => update('parMax', v)} />
            <RangeField label="Saldo R$" min={f.salMin} max={f.salMax} onMin={(v) => update('salMin', v)} onMax={(v) => update('salMax', v)} />
            <RangeField label="Pagas" min={f.pagasMin} max={f.pagasMax} onMin={(v) => update('pagasMin', v)} onMax={(v) => update('pagasMax', v)} />
            <RangeField label="Idade" min={f.idadeMin} max={f.idadeMax} onMin={(v) => update('idadeMin', v)} onMax={(v) => update('idadeMax', v)} />
            <Field label="Invalidez">
              <select className="h-9 rounded-md border border-input bg-background px-2 text-xs" value={f.invalidez} onChange={(e) => update('invalidez', e.target.value)}>
                <option value="">Todos</option>
                <option value="sim">Só invalidez</option>
                <option value="nao">Sem invalidez</option>
              </select>
            </Field>
            <div className="flex items-end">
              <Button variant="ghost" size="sm" onClick={() => setF(INITIAL)} className="text-xs">
                <X className="size-3" /> Limpar filtros
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabela */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/30">
                <tr>
                  <th className="w-8 p-2"></th>
                  <th className="text-left p-2 font-semibold">Nome</th>
                  <th className="text-left p-2 font-semibold">CPF</th>
                  <th className="text-left p-2 font-semibold">Orig</th>
                  <th className="text-right p-2 font-semibold">Parcela</th>
                  <th className="text-right p-2 font-semibold" title="Nova parcela pós refin 108m @ 1.50%">Nova Parc.</th>
                  <th className="text-right p-2 font-semibold">Saldo</th>
                  <th className="text-left p-2 font-semibold">Comp. %</th>
                  <th className="text-left p-2 font-semibold">Dest.</th>
                  <th className="text-right p-2 font-semibold">Vlr Cont</th>
                  <th className="text-right p-2 font-semibold">Troco</th>
                  <th className="text-left p-2 font-semibold">Taxa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((r, i) => (
                  <ElegivelRowRender
                    key={`${r.cpf}-${r.con}-${i}`}
                    row={r}
                    checked={selectedCpfs.has(r.cpf)}
                    onToggle={() => toggleSelected(r.cpf)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-3 border-t border-border flex items-center justify-between text-xs">
            <div className="text-muted-foreground">
              Mostrando <strong className="text-foreground">{items.length}</strong> de {filtered.length}
              {filtered.length !== base.elegiveis.length && ` (filtrados de ${base.elegiveis.length})`}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={pg === 0} onClick={() => setPg((p) => p - 1)}>
                  Ant.
                </Button>
                <span>{pg + 1} / {totalPages}</span>
                <Button variant="outline" size="sm" disabled={pg >= totalPages - 1} onClick={() => setPg((p) => p + 1)}>
                  Próx.
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ElegivelRowRender({ row: r, checked, onToggle }: { row: ElegivelRow; checked: boolean; onToggle: () => void }) {
  const compCor =
    r.compStatus === 'dentro_regra' ? 'text-green-400 bg-green-500/15 border-green-500/40'
    : r.compStatus === 'fora_regra_resolvivel' ? 'text-yellow-400 bg-yellow-500/15 border-yellow-500/40'
    : r.compStatus === 'fora_regra_inviavel' ? 'text-red-400 bg-red-500/15 border-red-500/40'
    : 'text-muted-foreground bg-muted/20 border-border';
  const compTxt =
    r.compStatus === 'dentro_regra' ? '✅ ≤ 45%'
    : r.compStatus === 'fora_regra_resolvivel' ? (r.resolveExc ? '🔄 ESTE resolve' : '🔄 outro resolve')
    : r.compStatus === 'fora_regra_inviavel' ? '❌ sem solução'
    : 'sem dados';
  const novaP = r.parcelaNovaEstim || 0;
  const reduz = r.reducaoEstim || 0;
  return (
    <tr className={`hover:bg-muted/20 ${checked ? 'bg-blue-500/5' : ''}`}>
      <td className="p-2 text-center">
        {!r._semContrato && (
          <input type="checkbox" checked={checked} onChange={onToggle} className="cursor-pointer" />
        )}
      </td>
      <td className="p-2 font-medium">{r.nome || '—'}</td>
      <td className="p-2 font-mono text-[10px]">{formatCpf(r.cpf)}</td>
      <td className="p-2">
        {r._semContrato ? (
          <span className="text-muted-foreground/40">—</span>
        ) : (
          <Badge variant="muted" className="text-[9px] font-mono">{r.cod}</Badge>
        )}
      </td>
      <td className="p-2 text-right font-mono">{r._semContrato ? '—' : formatBRL(r.par)}</td>
      <td className="p-2 text-right font-mono">
        {r._semContrato || !novaP ? <span className="text-muted-foreground">—</span> : (
          <div>
            <div className="text-green-400 font-semibold">{formatBRL(novaP)}</div>
            <div className="text-[9px] text-green-400/70">↓ {formatBRL(reduz)}</div>
          </div>
        )}
      </td>
      <td className="p-2 text-right font-mono">{r._semContrato ? '—' : formatBRL(r.sal)}</td>
      <td className="p-2">
        <div className={`inline-flex flex-col items-center gap-0.5 px-1.5 py-0.5 rounded border ${compCor}`}>
          <span className="text-xs font-bold font-mono">{r.compPct || 0}%</span>
          <span className="text-[9px] font-semibold">{compTxt}</span>
        </div>
      </td>
      <td className="p-2">
        {r._semContrato ? (
          <span className="text-[10px] text-green-400 font-semibold">💰 emp. novo</span>
        ) : r.dest !== '-' ? (
          <Badge variant="outline" className="text-[10px] font-mono">{r.dest}</Badge>
        ) : '—'}
      </td>
      <td className="p-2 text-right font-mono">{r.vc > 0 ? formatBRL(r.vc) : '—'}</td>
      <td className="p-2 text-right font-mono">
        {r.troco > 0 ? <span className="text-green-400 font-semibold">{formatBRL(r.troco)}</span> : '—'}
      </td>
      <td className="p-2 font-mono">{r.taxa !== '-' ? `${r.taxa}%` : '—'}</td>
    </tr>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</Label>
      {children}
    </div>
  );
}

function RangeField({ label, min, max, onMin, onMax }: { label: string; min: string; max: string; onMin: (v: string) => void; onMax: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</Label>
      <div className="flex gap-1">
        <Input placeholder="de" value={min} onChange={(e) => onMin(e.target.value)} className="h-9 text-xs" />
        <Input placeholder="até" value={max} onChange={(e) => onMax(e.target.value)} className="h-9 text-xs" />
      </div>
    </div>
  );
}

function KpiCard({ label, value, cor, isText }: { label: string; value: number | string; cor?: string; isText?: boolean }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
        <div className={`${isText ? 'text-base' : 'text-2xl'} font-mono font-bold mt-1 ${cor || 'text-foreground'}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
