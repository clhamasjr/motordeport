'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { formatBRL } from '@/lib/utils';
import { calcEnquadramentoPlus, calcReducaoPort, parseBR } from '@/lib/inss-motor';
import { Calculator, Plus, Trash2, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';

type TipoContrato = 'emp' | 'rmc' | 'rcc';

interface ContratoInput {
  banco: string;
  parcela: number;
  saldo: number;
  taxa: number;
  prazoRest: number;
  tipo: TipoContrato;
}

const COR_TIPO: Record<TipoContrato, string> = {
  emp: 'text-red-400',
  rmc: 'text-purple-400',
  rcc: 'text-pink-400',
};
const LABEL_TIPO: Record<TipoContrato, string> = {
  emp: 'Empréstimo',
  rmc: 'Cartão RMC',
  rcc: 'Cartão RCC',
};

const STORAGE_KEY = 'inss_enquad_manual';

function loadState(): { beneficio: number; contratos: ContratoInput[] } {
  if (typeof window === 'undefined') return { beneficio: 0, contratos: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { beneficio: 0, contratos: [] };
    return JSON.parse(raw);
  } catch {
    return { beneficio: 0, contratos: [] };
  }
}

function saveState(b: number, c: ContratoInput[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ beneficio: b, contratos: c }));
}

export default function EnquadramentoManualPage() {
  const initial = useMemo(() => loadState(), []);
  const [beneficio, setBeneficio] = useState(initial.beneficio);
  const [contratos, setContratos] = useState<ContratoInput[]>(initial.contratos);

  function updateContrato(i: number, patch: Partial<ContratoInput>) {
    const next = [...contratos];
    next[i] = { ...next[i], ...patch };
    setContratos(next);
    saveState(beneficio, next);
  }

  function addContrato(tipo: TipoContrato = 'emp') {
    const next = [...contratos, { banco: '', parcela: 0, saldo: 0, taxa: 1.85, prazoRest: 96, tipo }];
    setContratos(next);
    saveState(beneficio, next);
  }

  function delContrato(i: number) {
    const next = contratos.filter((_, idx) => idx !== i);
    setContratos(next);
    saveState(beneficio, next);
  }

  function limpar() {
    if (!confirm('Limpar TODOS os contratos e benefício?')) return;
    setBeneficio(0);
    setContratos([]);
    saveState(0, []);
  }

  function setBen(v: number) {
    setBeneficio(v);
    saveState(v, contratos);
  }

  // Cálculo
  const sumEmp = contratos.filter((c) => c.tipo === 'emp').reduce((s, c) => s + (c.parcela || 0), 0);
  const sumRmc = contratos.filter((c) => c.tipo === 'rmc').reduce((s, c) => s + (c.parcela || 0), 0);
  const sumRcc = contratos.filter((c) => c.tipo === 'rcc').reduce((s, c) => s + (c.parcela || 0), 0);
  const sumTotal = sumEmp + sumRmc + sumRcc;

  // Cenários
  const tetoEmp35 = beneficio * 0.35;
  const tetoCart = beneficio * 0.05;
  const teto45 = beneficio * 0.45;

  const enq = useMemo(() => {
    if (!beneficio) return null;
    const contratosMotor = contratos
      .filter((c) => c.tipo === 'emp' && c.parcela > 0 && c.saldo > 0)
      .map((c) => ({ par: c.parcela, sal: c.saldo, con: c.banco, cod: c.banco }));
    return calcEnquadramentoPlus(beneficio, sumEmp, sumRmc, sumRcc, contratosMotor);
  }, [beneficio, contratos, sumEmp, sumRmc, sumRcc]);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Calculator className="size-6 text-cyan-400" />
          INSS — Enquadramento Manual (Calculadora)
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Insira benefício + contratos manualmente. Simulação 100% client-side com motor V1
          (regra atual: emp ≤ 35% + RMC ≤ 5% + RCC ≤ 5% = total ≤ 45%).
        </p>
      </div>

      {/* Header form */}
      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Valor do benefício (R$) *
            </Label>
            <Input
              type="number"
              step="0.01"
              value={beneficio || ''}
              onChange={(e) => setBen(parseFloat(e.target.value) || 0)}
              placeholder="ex: 1500,00"
              className="font-mono text-lg mt-1"
              autoFocus
            />
            <div className="text-[10px] text-muted-foreground mt-1">
              Base de cálculo do INSS. Pode pegar do extrato.
            </div>
          </div>
          <div className="md:col-span-2 flex items-end gap-2 flex-wrap">
            <Button onClick={() => addContrato('emp')} size="sm" variant="default">
              <Plus className="size-4" /> + Empréstimo
            </Button>
            <Button onClick={() => addContrato('rmc')} size="sm" variant="outline" className="border-purple-500/40 text-purple-400">
              <Plus className="size-4" /> + RMC
            </Button>
            <Button onClick={() => addContrato('rcc')} size="sm" variant="outline" className="border-pink-500/40 text-pink-400">
              <Plus className="size-4" /> + RCC
            </Button>
            <Button onClick={limpar} size="sm" variant="ghost" className="text-destructive">
              <RefreshCw className="size-4" /> Limpar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabela de contratos */}
      {contratos.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="text-left p-2 font-semibold">Tipo</th>
                    <th className="text-left p-2 font-semibold">Banco</th>
                    <th className="text-right p-2 font-semibold">Parcela</th>
                    <th className="text-right p-2 font-semibold">Saldo</th>
                    <th className="text-right p-2 font-semibold">Taxa</th>
                    <th className="text-right p-2 font-semibold">Prazo restante</th>
                    <th className="text-right p-2 font-semibold">Nova parc (108m)</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {contratos.map((c, i) => {
                    const reducao = c.tipo === 'emp' && c.parcela > 0 && c.saldo > 0
                      ? calcReducaoPort({ par: c.parcela, sal: c.saldo }, 108)
                      : null;
                    return (
                      <tr key={i} className="hover:bg-muted/20">
                        <td className="p-2">
                          <select
                            value={c.tipo}
                            onChange={(e) => updateContrato(i, { tipo: e.target.value as TipoContrato })}
                            className={`h-8 rounded-md border border-input bg-background px-2 text-xs font-semibold ${COR_TIPO[c.tipo]}`}
                          >
                            <option value="emp">{LABEL_TIPO.emp}</option>
                            <option value="rmc">{LABEL_TIPO.rmc}</option>
                            <option value="rcc">{LABEL_TIPO.rcc}</option>
                          </select>
                        </td>
                        <td className="p-2">
                          <Input
                            value={c.banco}
                            onChange={(e) => updateContrato(i, { banco: e.target.value })}
                            placeholder="ex: BMG"
                            className="h-8 text-xs w-32"
                          />
                        </td>
                        <td className="p-2">
                          <Input
                            type="number"
                            step="0.01"
                            value={c.parcela || ''}
                            onChange={(e) => updateContrato(i, { parcela: parseFloat(e.target.value) || 0 })}
                            className="h-8 text-xs font-mono text-right w-28"
                            placeholder="0,00"
                          />
                        </td>
                        <td className="p-2">
                          <Input
                            type="number"
                            step="100"
                            value={c.saldo || ''}
                            onChange={(e) => updateContrato(i, { saldo: parseFloat(e.target.value) || 0 })}
                            className="h-8 text-xs font-mono text-right w-32"
                            placeholder="0,00"
                            disabled={c.tipo !== 'emp'}
                          />
                        </td>
                        <td className="p-2">
                          <Input
                            type="number"
                            step="0.01"
                            value={c.taxa || ''}
                            onChange={(e) => updateContrato(i, { taxa: parseFloat(e.target.value) || 0 })}
                            className="h-8 text-xs font-mono text-right w-20"
                            placeholder="0,00"
                            disabled={c.tipo !== 'emp'}
                          />
                        </td>
                        <td className="p-2">
                          <Input
                            type="number"
                            value={c.prazoRest || ''}
                            onChange={(e) => updateContrato(i, { prazoRest: parseInt(e.target.value) || 0 })}
                            className="h-8 text-xs font-mono text-right w-20"
                            placeholder="96"
                            disabled={c.tipo !== 'emp'}
                          />
                        </td>
                        <td className="p-2 text-right font-mono text-xs">
                          {reducao ? (
                            <span className="text-green-400">
                              {formatBRL(reducao.novaParc)}
                              <div className="text-[9px] text-green-400/80">↓ {formatBRL(reducao.reducao)}</div>
                            </span>
                          ) : '—'}
                        </td>
                        <td className="p-2">
                          <Button variant="ghost" size="sm" onClick={() => delContrato(i)} className="text-destructive h-7 w-7 p-0">
                            <Trash2 className="size-3.5" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-muted/30 font-semibold">
                  <tr>
                    <td colSpan={2} className="p-2 text-xs uppercase tracking-wider text-muted-foreground">
                      Totais
                    </td>
                    <td className="p-2 text-right font-mono text-xs">{formatBRL(sumTotal)}</td>
                    <td colSpan={5} className="p-2 text-xs text-muted-foreground">
                      Emp: <span className="text-red-400 font-mono">{formatBRL(sumEmp)}</span>{' · '}
                      RMC: <span className="text-purple-400 font-mono">{formatBRL(sumRmc)}</span>{' · '}
                      RCC: <span className="text-pink-400 font-mono">{formatBRL(sumRcc)}</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <Calculator className="size-12 mx-auto mb-2 opacity-30" />
            <div className="text-sm mb-2">Nenhum contrato adicionado.</div>
            <Button onClick={() => addContrato('emp')} size="sm">
              <Plus className="size-4" /> Adicionar primeiro contrato
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Cenário da regra VIGENTE (pós-queda da MP 1355, 02/09/2026):
          35% emp + 5% RMC + 5% RCC = 45%. O card da "nova regra 40%" foi
          removido — a MP caiu antes de valer. */}
      {beneficio > 0 && contratos.length > 0 && (
        <div className="grid grid-cols-1 gap-3">
          <CenarioCard
            titulo="Regra vigente"
            sub="35% emp + 5% RMC + 5% RCC = teto 45%"
            sumEmp={sumEmp}
            sumRmc={sumRmc}
            sumRcc={sumRcc}
            tetoEmp={tetoEmp35}
            tetoRmc={tetoCart}
            tetoRcc={tetoCart}
            tetoTotal={teto45}
            beneficio={beneficio}
            enq={enq}
          />
        </div>
      )}
    </div>
  );
}

function CenarioCard({
  titulo, sub, sumEmp, sumRmc, sumRcc, tetoEmp, tetoRmc, tetoRcc, tetoTotal, beneficio, enq,
}: {
  titulo: string; sub: string;
  sumEmp: number; sumRmc: number; sumRcc: number;
  tetoEmp: number; tetoRmc: number; tetoRcc: number; tetoTotal: number; beneficio: number;
  enq?: ReturnType<typeof calcEnquadramentoPlus> | null;
}) {
  const sumTotal = sumEmp + sumRmc + sumRcc;
  const teto = tetoTotal;
  const compPct = beneficio > 0 ? (sumTotal / beneficio) * 100 : 0;
  const ok = sumTotal <= teto && sumEmp <= tetoEmp && sumRmc <= tetoRmc && sumRcc <= tetoRcc;
  const cor = ok ? 'border-green-500/40 bg-green-500/5' : 'border-red-500/40 bg-red-500/5';

  return (
    <Card className={cor}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="font-bold flex items-center gap-2">
              {ok ? <CheckCircle2 className="size-5 text-green-400" /> : <AlertTriangle className="size-5 text-red-400" />}
              {titulo}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Comp.</div>
            <div className={`text-2xl font-mono font-bold ${ok ? 'text-green-400' : 'text-red-400'}`}>
              {compPct.toFixed(1)}%
            </div>
          </div>
        </div>

        <div className="space-y-2 text-xs">
          <LinhaTeto label="Empréstimo" usado={sumEmp} teto={tetoEmp} cor="text-red-400" />
          <LinhaTeto label="RMC" usado={sumRmc} teto={tetoRmc} cor="text-purple-400" />
          <LinhaTeto label="RCC" usado={sumRcc} teto={tetoRcc} cor="text-pink-400" />
          <div className="border-t border-border pt-2">
            <LinhaTeto label="TOTAL" usado={sumTotal} teto={teto} cor="text-foreground" bold />
          </div>
        </div>

        {enq && (enq.status === 'VIA_PORT_REDUCAO' || enq.status === 'VIA_PORT_MULTI' || enq.status === 'INVIAVEL') && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="text-[10px] uppercase tracking-wider font-bold mb-1.5">
              {enq.status === 'VIA_PORT_REDUCAO' ? '🔄 Resolução com port'
                : enq.status === 'VIA_PORT_MULTI' ? '🏦 BRB INCONTA — enquadra portando contratos'
                : '⚠ Análise'}
            </div>
            <div className="text-xs text-muted-foreground">{enq.detalhe}</div>
            {enq.contratoSugerido && (
              <div className="mt-1.5 rounded-md bg-green-500/10 border border-green-500/30 p-2 text-xs">
                <strong className="text-green-400">Sugestão:</strong> refinanciar{' '}
                <span className="font-mono">{enq.contratoSugerido.contrato || '?'}</span>{' '}
                ({enq.contratoSugerido.banco || '?'}) → reduz{' '}
                <strong className="font-mono">{formatBRL(enq.contratoSugerido.reducao)}</strong>
              </div>
            )}
            {enq.viaBrbInconta?.enquadra && enq.status !== 'VIA_PORT_REDUCAO' && (
              <div className="mt-1.5 rounded-md bg-cyan-500/10 border border-cyan-500/30 p-2 text-xs space-y-1">
                <div className="text-cyan-300">
                  <strong>BRB INCONTA</strong> porta {enq.viaBrbInconta.contratos.length} contrato
                  {enq.viaBrbInconta.contratos.length > 1 ? 's' : ''} (tabela 1,85% / 108m) → reduz{' '}
                  <strong className="font-mono">{formatBRL(enq.viaBrbInconta.reducaoTotal)}</strong> no total:
                </div>
                {enq.viaBrbInconta.contratos.map((c, i) => (
                  <div key={i} className="flex justify-between font-mono text-[11px]">
                    <span>{c.contrato || c.banco || '?'}</span>
                    <span className="text-cyan-400">
                      {formatBRL(c.novaParc)} <span className="text-cyan-400/70">↓ {formatBRL(c.reducao)}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


function LinhaTeto({ label, usado, teto, cor, bold }: { label: string; usado: number; teto: number; cor: string; bold?: boolean }) {
  const pct = teto > 0 ? (usado / teto) * 100 : 0;
  const excedido = usado > teto;
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className={`${bold ? 'font-bold uppercase tracking-wider text-[10px]' : ''} ${cor}`}>{label}</span>
        <span className="font-mono">
          {formatBRL(usado)} / {formatBRL(teto)}{' '}
          <Badge variant={excedido ? 'destructive' : 'muted'} className="ml-1 text-[9px]">
            {pct.toFixed(0)}%
          </Badge>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full transition-all ${excedido ? 'bg-red-400' : pct > 80 ? 'bg-yellow-400' : 'bg-green-400'}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}
