'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatBRL } from '@/lib/utils';
import {
  testarTodos, calcReducaoPort, calcEnquadramentoPlus,
  BD, ORDEM, B1P, IDADE_MAX, ESP_INV, ESP_LOAS,
  type BancoSimul,
} from '@/lib/inss-motor';
import { CheckCircle2, AlertCircle, FlaskConical, Calculator } from 'lucide-react';

// ──────────────────────────────────────────────────────────────────
// Cenários conhecidos do V1 — output esperado calculado manualmente
// usando as regras de BD. Cada cenário cobre uma regra crítica.
// ──────────────────────────────────────────────────────────────────

interface Cenario {
  nome: string;
  desc: string;
  input: {
    p: number; s: number; pg: number; cd: string;
    inv: boolean; age: number | null; bY: number | null;
    rest: number; espN: number; con: string; taxaOrig: number;
  };
  /** Bancos esperados (pelo V1) — ['QUALI','BRB',...] ou [] se nenhum aceita */
  esperado: { bancos: string[]; motivo?: string };
}

const CENARIOS: Cenario[] = [
  {
    nome: 'BMG (318) padrão — 24 pagas',
    desc: 'Cliente com BMG, 24 parcelas pagas, espécie aposentadoria — deve aparecer em todos bancos ativos',
    input: { p: 500, s: 12000, pg: 24, cd: '318', inv: false, age: 65, bY: null, rest: 60, espN: 41, con: '12345', taxaOrig: 1.85 },
    esperado: { bancos: ['QUALI', 'BRB', 'ICRED'], motivo: 'BMG aceita em todos os 3 destinos ativos' },
  },
  {
    nome: 'PAN (623) com 11 pagas — bloqueado',
    desc: 'PAN exige pgMin=12 em QUALI/FACTA/DAYCOVAL/BRB. Com 11 pagas, só ICRED (pgMin=1)',
    input: { p: 600, s: 15000, pg: 11, cd: '623', inv: false, age: 60, bY: null, rest: 70, espN: 41, con: '99999', taxaOrig: 1.85 },
    esperado: { bancos: ['ICRED'], motivo: 'Só ICRED aceita PAN com < 12 pagas (pgMinMap "623":1)' },
  },
  {
    nome: 'BRB origem (070) — 12 pagas exigidas',
    desc: 'BRB origem aceito em QUALI/FACTA/DIGIO/DAYCOVAL com pgMin=12; bloqueado em BRB destino',
    input: { p: 700, s: 20000, pg: 12, cd: '070', inv: false, age: 65, bY: null, rest: 84, espN: 41, con: '12345', taxaOrig: 1.85 },
    esperado: { bancos: ['QUALI', 'ICRED'], motivo: 'QUALI aceita BRB 070 com 12+ pagas; BRB destino bloqueia origem 070; ICRED aceita' },
  },
  {
    nome: 'BRB CORRESPONDENTE (925) — bloqueado em TODOS',
    desc: 'BRB-correspondente é bloqueado em todos os bancos destino — regra definitiva',
    input: { p: 800, s: 25000, pg: 36, cd: '925', inv: false, age: 65, bY: null, rest: 60, espN: 41, con: '99999', taxaOrig: 1.85 },
    esperado: { bancos: [], motivo: 'Cod 925 está em block de TODOS os bancos' },
  },
  {
    nome: 'FACTA (149) origem com taxa origem 1.50%',
    desc: 'QUALI exige taxa origem > 1.10% pra portar FACTA. Aqui taxa origem 1.50% — passa em QUALI',
    input: { p: 750, s: 20000, pg: 24, cd: '149', inv: false, age: 60, bY: null, rest: 84, espN: 41, con: '12345', taxaOrig: 1.50 },
    esperado: { bancos: ['QUALI'], motivo: 'QUALI aceita FACTA com taxa origem > 1.10% (atende com 1.50%)' },
  },
  {
    nome: 'PICPAY (380) com 1 paga',
    desc: 'PICPAY tá em B1P — port a partir de 1 paga em todos os bancos sem block',
    input: { p: 500, s: 12000, pg: 1, cd: '380', inv: false, age: 60, bY: null, rest: 95, espN: 41, con: '11111', taxaOrig: 1.85 },
    esperado: { bancos: ['QUALI', 'ICRED'], motivo: 'PICPAY com 1 paga: QUALI/ICRED aceitam; BRB bloqueia (380 está em block)' },
  },
  {
    nome: 'Cliente 73 anos',
    desc: 'IDADE_MAX = 72. Acima disso, nenhum banco aceita',
    input: { p: 500, s: 15000, pg: 24, cd: '318', inv: false, age: 73, bY: null, rest: 60, espN: 41, con: '12345', taxaOrig: 1.85 },
    esperado: { bancos: [], motivo: 'Idade > IDADE_MAX (72) bloqueia em todos os bancos' },
  },
  {
    nome: 'Invalidez (esp 32) + 58 anos',
    desc: 'QUALI exige minAge=55 pra invalidez; FACTA/BRB/ICRED exigem 60. Aqui só QUALI passa',
    input: { p: 400, s: 12000, pg: 24, cd: '318', inv: true, age: 58, bY: 20, rest: 60, espN: 32, con: '12345', taxaOrig: 1.85 },
    esperado: { bancos: ['QUALI'], motivo: 'QUALI aceita invalidez ≥ 55 anos com DIB > 15 anos; BRB/ICRED exigem 60' },
  },
  {
    nome: 'LOAS/BPC (esp 88)',
    desc: 'LOAS é bloqueado em todos por regra global',
    input: { p: 500, s: 15000, pg: 24, cd: '318', inv: false, age: 65, bY: null, rest: 60, espN: 88, con: '12345', taxaOrig: 1.85 },
    esperado: { bancos: [], motivo: 'Espécie 88 (LOAS) bloqueada globalmente' },
  },
  {
    nome: 'ICRED com 68 anos + VC alto',
    desc: 'ICRED limita VC por idade: 68 anos = R$ 30k. Se proposta gera VC > 30k, ICRED não aceita',
    input: { p: 1500, s: 8000, pg: 24, cd: '318', inv: false, age: 68, bY: null, rest: 60, espN: 41, con: '12345', taxaOrig: 1.85 },
    esperado: { bancos: ['QUALI', 'BRB'], motivo: 'ICRED bloqueia: parcela R$1500 / coef 1.50% (108m) ≈ R$80k VC > 30k limite pra 68 anos' },
  },
];

// ──────────────────────────────────────────────────────────────────

interface Resultado {
  cenario: Cenario;
  destinos: BancoSimul[];
  ok: boolean;
}

function rodarCenario(c: Cenario): Resultado {
  const { p, s, pg, cd, inv, age, bY, rest, espN, con, taxaOrig } = c.input;
  const destinos = testarTodos(p, s, pg, cd, inv, age, bY, rest, espN, con, taxaOrig);
  const bancosObtidos = destinos.map((d) => d.banco).sort();
  const bancosEsperados = [...c.esperado.bancos].sort();
  const ok = JSON.stringify(bancosObtidos) === JSON.stringify(bancosEsperados);
  return { cenario: c, destinos, ok };
}

export default function MotorTestPage() {
  const resultados = useMemo(() => CENARIOS.map(rodarCenario), []);
  const passou = resultados.filter((r) => r.ok).length;
  const total = resultados.length;
  const allOk = passou === total;

  // Calculadora livre
  const [livre, setLivre] = useState({
    p: '500', s: '12000', pg: '24', cd: '318',
    inv: false, age: '65', bY: '', rest: '60', espN: '41',
    con: '12345', taxaOrig: '1.85',
  });
  const livreResult = useMemo(() => {
    try {
      const p = parseFloat(livre.p) || 0;
      const s = parseFloat(livre.s) || 0;
      const pg = parseInt(livre.pg, 10) || 0;
      const age = livre.age ? parseInt(livre.age, 10) : null;
      const bY = livre.bY ? parseInt(livre.bY, 10) : null;
      const rest = parseInt(livre.rest, 10) || 0;
      const espN = parseInt(livre.espN, 10) || 0;
      const taxaOrig = parseFloat(livre.taxaOrig) || 0;
      const destinos = testarTodos(p, s, pg, livre.cd, livre.inv, age, bY, rest, espN, livre.con, taxaOrig);
      const reducao = calcReducaoPort({ par: p, sal: s }, 108);
      return { destinos, reducao };
    } catch (e) {
      return { destinos: [] as BancoSimul[], reducao: null, err: (e as Error).message };
    }
  }, [livre]);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FlaskConical className="size-6 text-purple-400" />
          Motor INSS — Teste e Diagnóstico
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Valida que o motor V2 entrega os mesmos resultados do V1. Cada cenário cobre uma regra crítica.
        </p>
      </div>

      {/* Resumo */}
      <Card className={allOk ? 'border-green-500/50 bg-green-500/5' : 'border-yellow-500/50 bg-yellow-500/5'}>
        <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            {allOk ? <CheckCircle2 className="size-8 text-green-400" /> : <AlertCircle className="size-8 text-yellow-400" />}
            <div>
              <div className="font-bold text-lg">
                {passou} / {total} cenários passaram
              </div>
              <div className="text-sm text-muted-foreground">
                {allOk
                  ? 'Motor V2 está 100% equivalente ao V1.'
                  : `${total - passou} cenário(s) com diferença — clique pra ver detalhes`}
              </div>
            </div>
          </div>
          <div className="flex gap-2 text-xs">
            <Badge variant="muted" className="font-mono">ORDEM: {ORDEM.join(' / ')}</Badge>
            <Badge variant="muted" className="font-mono">IDADE_MAX: {IDADE_MAX}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Cenários */}
      <div className="space-y-2">
        {resultados.map((r, i) => (
          <CenarioCard key={i} resultado={r} />
        ))}
      </div>

      {/* Calculadora livre */}
      <Card className="border-cyan-500/40 bg-cyan-500/5">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Calculator className="size-5 text-cyan-400" />
            <h2 className="font-bold">Calculadora livre — teste qualquer combinação</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
            <NumField label="Parcela R$" value={livre.p} onChange={(v) => setLivre({ ...livre, p: v })} />
            <NumField label="Saldo R$" value={livre.s} onChange={(v) => setLivre({ ...livre, s: v })} />
            <NumField label="Pagas" value={livre.pg} onChange={(v) => setLivre({ ...livre, pg: v })} />
            <NumField label="Cod origem (3 dig)" value={livre.cd} onChange={(v) => setLivre({ ...livre, cd: v })} />
            <NumField label="Idade" value={livre.age} onChange={(v) => setLivre({ ...livre, age: v })} />
            <NumField label="Anos benefício (DIB)" value={livre.bY} onChange={(v) => setLivre({ ...livre, bY: v })} />
            <NumField label="Prazo restante" value={livre.rest} onChange={(v) => setLivre({ ...livre, rest: v })} />
            <NumField label="Espécie INSS" value={livre.espN} onChange={(v) => setLivre({ ...livre, espN: v })} />
            <NumField label="Contrato" value={livre.con} onChange={(v) => setLivre({ ...livre, con: v })} />
            <NumField label="Taxa origem %" value={livre.taxaOrig} onChange={(v) => setLivre({ ...livre, taxaOrig: v })} />
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={livre.inv}
                  onChange={(e) => setLivre({ ...livre, inv: e.target.checked })}
                />
                Invalidez
              </label>
            </div>
          </div>
          <div className="border-t border-border pt-3 space-y-2">
            <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Resultado</div>
            {livreResult.destinos.length === 0 ? (
              <div className="text-sm text-red-400">❌ Nenhum banco aceita esse contrato</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {livreResult.destinos.map((d, i) => (
                  <div key={i} className="rounded-md border border-border bg-card p-2">
                    <div className="flex justify-between items-center">
                      <Badge variant="outline" className="font-mono">{d.banco}</Badge>
                      <span className="text-xs font-mono">{d.taxa.toFixed(2)}%</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 mt-1 text-xs">
                      <div>
                        <div className="text-[9px] text-muted-foreground uppercase">Troco</div>
                        <div className="font-mono font-semibold text-green-400">{formatBRL(d.troco)}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-muted-foreground uppercase">VC</div>
                        <div className="font-mono font-semibold text-cyan-400">{formatBRL(d.vc)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {livreResult.reducao && (
              <div className="text-xs text-muted-foreground">
                <strong className="text-green-400">Nova parcela (108m @ 1.50%):</strong>{' '}
                <span className="font-mono">{formatBRL(livreResult.reducao.novaParc)}</span>{' '}
                <span className="text-[10px]">(reduz {formatBRL(livreResult.reducao.reducao)}/mês)</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Resumo das regras */}
      <Card>
        <CardContent className="p-4">
          <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">
            Regras dos bancos ativos no motor
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {ORDEM.map((b) => {
              const r = BD[b];
              return (
                <div key={b} className="rounded-md border border-border bg-card p-3">
                  <div className="font-bold mb-1">{b}</div>
                  <div className="text-[10px] font-mono space-y-0.5">
                    <div>Faixa: {r.faixa ? `${r.faixa[0]}% – ${r.faixa[1]}%` : `coef ${r.coefF}`}</div>
                    <div>Saldo mín: {formatBRL(r.sMin || 0)}</div>
                    <div>Troco mín: {formatBRL(r.tMin || 0)}{r.tMinPct ? ` ou ${(r.tMinPct * 100).toFixed(1)}%` : ''}</div>
                    <div>Parcela mín: {formatBRL(r.pMin || 0)}</div>
                    <div>Pagas mín: {r.pgMin}</div>
                    <div>Origem bloqueada: {r.block.slice(0, 6).join(', ')}{r.block.length > 6 ? ` +${r.block.length - 6}` : ''}</div>
                    {r.vcMax && <div>VC máx: {formatBRL(r.vcMax)}</div>}
                    {r.invRules && <div>Inv: min {r.invRules.minAge} anos</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CenarioCard({ resultado }: { resultado: Resultado }) {
  const { cenario: c, destinos, ok } = resultado;
  const obtidos = destinos.map((d) => d.banco).sort();
  const esperados = [...c.esperado.bancos].sort();
  return (
    <Card className={ok ? 'border-green-500/30' : 'border-red-500/50 bg-red-500/5'}>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            {ok ? (
              <CheckCircle2 className="size-5 text-green-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="size-5 text-red-400 shrink-0 mt-0.5" />
            )}
            <div className="min-w-0">
              <div className="font-semibold">{c.nome}</div>
              <div className="text-xs text-muted-foreground">{c.desc}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Input</div>
            <div className="text-[10px] font-mono">
              p={formatBRL(c.input.p)} · s={formatBRL(c.input.s)} · pg={c.input.pg} · cod={c.input.cd}
              {c.input.age != null && ` · idade=${c.input.age}`}
              {c.input.inv && ' · INV'}
              {c.input.espN > 0 && ` · esp=${c.input.espN}`}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div className="rounded-md bg-card/50 p-2 border border-border">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Esperado (V1)</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {esperados.length === 0 ? (
                <span className="text-xs text-red-400">Bloqueado em todos</span>
              ) : (
                esperados.map((b) => (
                  <Badge key={b} variant="muted" className="text-[10px] font-mono">{b}</Badge>
                ))
              )}
            </div>
          </div>
          <div className="rounded-md bg-card/50 p-2 border border-border">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Obtido (V2)</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {obtidos.length === 0 ? (
                <span className="text-xs text-red-400">Bloqueado em todos</span>
              ) : (
                destinos.map((d, i) => (
                  <Badge key={i} variant={ok ? 'success' : 'destructive'} className="text-[10px] font-mono">
                    {d.banco} · {d.taxa.toFixed(2)}% · troco {formatBRL(d.troco)}
                  </Badge>
                ))
              )}
            </div>
          </div>
        </div>
        {c.esperado.motivo && (
          <div className="text-[10px] text-muted-foreground mt-2 italic">↳ {c.esperado.motivo}</div>
        )}
      </CardContent>
    </Card>
  );
}

function NumField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-9 text-xs font-mono" />
    </div>
  );
}
