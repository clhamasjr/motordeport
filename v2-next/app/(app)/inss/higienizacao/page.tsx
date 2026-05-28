'use client';

import { BaseUpload } from '@/components/inss/base-upload';
import { ElegiveisTable } from '@/components/inss/elegiveis-table';
import { Card, CardContent } from '@/components/ui/card';
import { useInssBaseStore } from '@/hooks/use-inss-base-store';
import { Sparkles, FileSpreadsheet, TrendingUp, Download } from 'lucide-react';
import { formatBRL } from '@/lib/utils';
import { useState, useMemo } from 'react';
import type { LoasRow } from '@/lib/inss-base-parser';
import { Button } from '@/components/ui/button';

// ─── helpers ────────────────────────────────────────────────────────────────
const STATUS_LABEL: Record<string, string> = {
  com_margem: '✅ Com margem',
  extrapolado_emp: '🔴 Extrap. empréstimo',
  extrapolado_cartoes: '🟠 Extrap. cartões',
  sem_dados: '⚪ Sem dados',
};
const STATUS_COLOR: Record<string, string> = {
  com_margem: 'text-green-400',
  extrapolado_emp: 'text-red-400',
  extrapolado_cartoes: 'text-orange-400',
  sem_dados: 'text-muted-foreground',
};

type LoasFiltro = 'ALL' | 'MARGEM' | 'SEMCART' | 'EXTRAP';

export default function HigienizacaoInssPage() {
  const { base } = useInssBaseStore();
  const [loasFiltro, setLoasFiltro] = useState<LoasFiltro>('ALL');

  // KPIs gerais da base (não dos filtrados)
  const totalTroco = base ? base.elegiveis.reduce((s, e) => s + (e.troco || 0), 0) : 0;
  const totalVC = base ? base.elegiveis.reduce((s, e) => s + (e.vc || 0), 0) : 0;
  const clientesElegiveis = base ? new Set(base.elegiveis.map((e) => e.cpf)).size : 0;

  // KPIs LOAS
  const loasAll: LoasRow[] = base?.loasAll ?? [];
  const loasComMargem = loasAll.filter((r) => r.statusLoas === 'com_margem');
  const loasExtrap = loasAll.filter(
    (r) => r.statusLoas === 'extrapolado_emp' || r.statusLoas === 'extrapolado_cartoes',
  );
  const loasSemCart = loasAll.filter((r) => r.numCartoes === 0 && r.statusLoas !== 'sem_dados');
  const potencialCartao = loasSemCart.reduce((s, r) => s + r.margemLivreCart, 0);
  const potencialEmp = loasComMargem.reduce((s, r) => s + r.margemLivreEmp, 0);

  const loasFiltrado = useMemo(() => {
    if (loasFiltro === 'MARGEM') return loasAll.filter((r) => r.statusLoas === 'com_margem');
    if (loasFiltro === 'SEMCART') return loasAll.filter((r) => r.numCartoes === 0 && r.statusLoas !== 'sem_dados');
    if (loasFiltro === 'EXTRAP')
      return loasAll.filter(
        (r) => r.statusLoas === 'extrapolado_emp' || r.statusLoas === 'extrapolado_cartoes',
      );
    return loasAll;
  }, [loasAll, loasFiltro]);

  // Exporta LOAS em XLSX com 4 abas (Todos / Com Margem / Oport Cartão / Extrapolados)
  async function exportLoasXlsx() {
    if (loasAll.length === 0) return;
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const STATUS_TXT: Record<string, string> = {
      com_margem: 'Com margem',
      extrapolado_emp: 'Extrap. empréstimo',
      extrapolado_cartoes: 'Extrap. cartões',
      sem_dados: 'Sem dados',
    };
    const toRow = (r: LoasRow) => ({
      Nome: r.nome,
      CPF: r.cpf,
      Benefício: r.ben,
      Espécie: r.esp,
      'Benefício R$': r.beneficio,
      'Teto 35%': r.tetoEmp,
      'Comprometido R$': r.sumEmp,
      '% Comp.': r.pctEmp,
      'Margem Emp R$': r.margemLivreEmp,
      'Margem Cart R$': r.margemLivreCart,
      'Nº Cartões': r.numCartoes,
      RMC: r.temRmc ? 'SIM' : '',
      RCC: r.temRcc ? 'SIM' : '',
      Idade: r.idade,
      Status: STATUS_TXT[r.statusLoas] ?? r.statusLoas,
      Tel1: r.t1, Tel2: r.t2, Tel3: r.t3,
    });
    const todos = loasAll.map(toRow);
    const comMargem = loasComMargem.map(toRow);
    const semCart = loasSemCart.map(toRow);
    const extrap = loasExtrap.map(toRow);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(todos), `Todos LOAS (${todos.length})`);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(comMargem), `Com Margem (${comMargem.length})`);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(semCart), `Oport Cartao (${semCart.length})`);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(extrap), `Extrapolados (${extrap.length})`);
    const fn = (base?.fname || 'base').replace(/\.[^.]+$/, '');
    const ts = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `LOAS_${fn}_${ts}.xlsx`);
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="size-6 text-pink-400" />
          INSS — Higienização (Base XLSX)
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Suba uma planilha do extrato consignado, o motor processa e mostra os clientes elegíveis
          pra portabilidade — com taxa, troco, parcela reduzida e enquadramento na regra de 45%.
        </p>
      </div>

      <BaseUpload />

      {base && (
        <>
          {/* KPIs da base completa */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Card>
              <CardContent className="p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Total na base
                </div>
                <div className="text-2xl font-mono font-bold mt-1">{base.analise.length}</div>
                <div className="text-[10px] text-muted-foreground">contratos lidos</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Elegíveis
                </div>
                <div className="text-2xl font-mono font-bold mt-1 text-green-400">
                  {base.elegiveis.length}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {clientesElegiveis} clientes únicos
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Troco total potencial
                </div>
                <div className="text-base font-mono font-bold mt-1 text-green-400">
                  {formatBRL(totalTroco)}
                </div>
                <div className="text-[10px] text-muted-foreground">soma dos trocos</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Volume de contratos
                </div>
                <div className="text-base font-mono font-bold mt-1 text-cyan-400">
                  {formatBRL(totalVC)}
                </div>
                <div className="text-[10px] text-muted-foreground">soma dos VCs novos</div>
              </CardContent>
            </Card>
          </div>

          {/* Resumo por banco destino */}
          {base.mapaArr.length > 0 && (
            <Card>
              <CardContent className="p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                  <TrendingUp className="size-3 inline mr-1" />
                  Distribuição por banco destino
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {base.mapaArr.map((m) => (
                    <div
                      key={m.banco}
                      className="rounded-md border border-border p-2 bg-card/50"
                    >
                      <div className="text-xs font-bold">{m.banco}</div>
                      <div className="text-xs text-muted-foreground">
                        <strong className="text-foreground">{m.n}</strong> contratos
                      </div>
                      <div className="text-[10px] text-green-400 font-mono">
                        troco: {formatBRL(m.total)}
                      </div>
                      <div className="text-[10px] text-cyan-400 font-mono">
                        VC: {formatBRL(m.vcTotal)}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tabela completa com filtros */}
          <ElegiveisTable />

          {/* ── BASE LOAS/BPC ─────────────────────────────────────────────── */}
          {loasAll.length > 0 && (
            <div className="space-y-3">
              {/* header + export */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-lg font-bold">🔵 Base LOAS / BPC</span>
                  <span className="text-xs text-muted-foreground">
                    (espécies 87/88 — só contrato novo, sem portabilidade)
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={exportLoasXlsx}
                  className="border-blue-500/40 text-blue-300 hover:bg-blue-500/10"
                >
                  <Download className="size-4" />
                  Exportar XLSX ({loasAll.length})
                </Button>
              </div>

              {/* KPIs LOAS */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Card className="border-blue-500/40 bg-blue-950/20">
                  <CardContent className="p-3">
                    <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">
                      Total LOAS
                    </div>
                    <div className="text-2xl font-mono font-bold mt-1 text-blue-200">
                      {loasAll.length}
                    </div>
                    <div className="text-[10px] text-blue-400">clientes na base</div>
                  </CardContent>
                </Card>
                <Card className="border-green-500/40 bg-green-950/20">
                  <CardContent className="p-3">
                    <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">
                      Com margem
                    </div>
                    <div className="text-2xl font-mono font-bold mt-1 text-green-400">
                      {loasComMargem.length}
                    </div>
                    <div className="text-[10px] text-green-500 font-mono">
                      {formatBRL(potencialEmp)} potencial emp
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-cyan-500/40 bg-cyan-950/20">
                  <CardContent className="p-3">
                    <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">
                      Oport. cartão
                    </div>
                    <div className="text-2xl font-mono font-bold mt-1 text-cyan-400">
                      {loasSemCart.length}
                    </div>
                    <div className="text-[10px] text-cyan-500 font-mono">
                      {formatBRL(potencialCartao)} potencial
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-red-500/40 bg-red-950/20">
                  <CardContent className="p-3">
                    <div className="text-[10px] uppercase tracking-wider text-red-300 font-semibold">
                      Extrapolados
                    </div>
                    <div className="text-2xl font-mono font-bold mt-1 text-red-400">
                      {loasExtrap.length}
                    </div>
                    <div className="text-[10px] text-red-500">acima do teto 35%</div>
                  </CardContent>
                </Card>
              </div>

              {/* filtro */}
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { v: 'ALL', label: `Todos (${loasAll.length})` },
                    { v: 'MARGEM', label: `Com margem (${loasComMargem.length})` },
                    { v: 'SEMCART', label: `Sem cartão (${loasSemCart.length})` },
                    { v: 'EXTRAP', label: `Extrapolados (${loasExtrap.length})` },
                  ] as { v: LoasFiltro; label: string }[]
                ).map(({ v, label }) => (
                  <button
                    key={v}
                    onClick={() => setLoasFiltro(v)}
                    className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                      loasFiltro === v
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'border-border text-muted-foreground hover:text-foreground hover:border-blue-500/50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* tabela */}
              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-left">
                        {[
                          'Nome', 'CPF', 'Ben', 'Esp',
                          'Benefício R$', 'Teto 35%', 'Comprometido', '% Comp.',
                          'Margem Emp', 'Margem Cart', 'Cartões', 'Idade',
                          'Status', 'Tel',
                        ].map((h) => (
                          <th key={h} className="px-2 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {loasFiltrado.length === 0 && (
                        <tr>
                          <td colSpan={14} className="text-center py-6 text-muted-foreground">
                            Nenhum registro nesse filtro.
                          </td>
                        </tr>
                      )}
                      {loasFiltrado.map((r, i) => (
                        <tr
                          key={`${r.cpf}-${i}`}
                          className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                        >
                          <td className="px-2 py-1.5 font-medium max-w-[140px] truncate" title={r.nome}>
                            {r.nome}
                          </td>
                          <td className="px-2 py-1.5 font-mono">{r.cpf}</td>
                          <td className="px-2 py-1.5 font-mono">{r.ben}</td>
                          <td className="px-2 py-1.5">{r.esp}</td>
                          <td className="px-2 py-1.5 font-mono text-right">
                            {r.beneficio > 0 ? formatBRL(r.beneficio) : '—'}
                          </td>
                          <td className="px-2 py-1.5 font-mono text-right">
                            {r.tetoEmp > 0 ? formatBRL(r.tetoEmp) : '—'}
                          </td>
                          <td className="px-2 py-1.5 font-mono text-right">
                            {r.sumEmp > 0 ? formatBRL(r.sumEmp) : '—'}
                          </td>
                          <td
                            className={`px-2 py-1.5 font-mono text-right font-bold ${
                              r.pctEmp >= 35 ? 'text-red-400' : r.pctEmp >= 25 ? 'text-yellow-400' : 'text-green-400'
                            }`}
                          >
                            {r.pctEmp > 0 ? `${r.pctEmp}%` : '—'}
                          </td>
                          <td className="px-2 py-1.5 font-mono text-right text-green-400">
                            {r.margemLivreEmp > 0 ? formatBRL(r.margemLivreEmp) : '—'}
                          </td>
                          <td className="px-2 py-1.5 font-mono text-right text-cyan-400">
                            {r.margemLivreCart > 0 ? formatBRL(r.margemLivreCart) : '—'}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            {r.temRmc && <span className="inline-block bg-blue-700/50 text-blue-200 rounded px-1 mr-0.5">RMC</span>}
                            {r.temRcc && <span className="inline-block bg-purple-700/50 text-purple-200 rounded px-1">RCC</span>}
                            {!r.temRmc && !r.temRcc && <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-2 py-1.5 text-center">{r.idade}</td>
                          <td className={`px-2 py-1.5 font-semibold whitespace-nowrap ${STATUS_COLOR[r.statusLoas] ?? ''}`}>
                            {STATUS_LABEL[r.statusLoas] ?? r.statusLoas}
                          </td>
                          <td className="px-2 py-1.5 text-muted-foreground">
                            {[r.t1, r.t2, r.t3].filter(Boolean).join(' · ') || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      {!base && (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <FileSpreadsheet className="size-12 mx-auto mb-2 opacity-30" />
            <div className="text-sm">
              Carregue uma base acima pra ver a análise + tabela de elegíveis.
            </div>
            <div className="text-xs mt-2">
              O motor roda 100% client-side — nenhum dado é enviado pra servidor.
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
