'use client';

import { useState, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { formatBRL } from '@/lib/utils';
import {
  testarTodos, calcReducaoPort, parseBR, ORDEM, type BancoSimul,
} from '@/lib/inss-motor';
import { InssParsedResult } from '@/lib/inss-types';
import { Calculator, ArrowRightLeft, Banknote, TrendingDown } from 'lucide-react';

interface Props {
  parsed: InssParsedResult;
}

type TipoOp = 'novo' | 'refin' | 'port' | 'cartao';

/**
 * Calculadora manual replicando openSimulacao do V1.
 * - Novo emp: input parcela desejada → mostra VC liberado nos bancos
 * - Refin: input saldo + nova taxa → mostra nova parcela / economia
 * - Port: input contrato (parcela+saldo+banco origem) → testarTodos
 * - Cartão: input valor desejado → estima parcela em coef cartão
 */
export function CalculadoraManual({ parsed }: Props) {
  const [open, setOpen] = useState(false);
  const [tipo, setTipo] = useState<TipoOp>('port');

  // Pré-fill quando abre, baseado no parsed
  const ben = parsed.beneficio || {};
  const mrg = parsed.margem || {};
  const margemLivre = parseBR(mrg.disponivel);
  const valor = parseBR(ben.valor);
  const b = parsed.beneficiario || {};
  const idade = b.idade ? parseInt(String(b.idade), 10) : null;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Calculator className="size-4" />
        Calculadora Manual
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="size-5 text-cyan-400" />
              Calculadora Manual — Simulação rápida
            </DialogTitle>
            <DialogDescription>
              Inputs livres pra testar cenários alternativos (parcela diferente, contrato hipotético etc).
              Roda o mesmo motor da consulta.
            </DialogDescription>
          </DialogHeader>

          {/* Seletor de tipo */}
          <div className="grid grid-cols-4 gap-1 rounded-md border border-input p-0.5 bg-background">
            <Button size="sm" variant={tipo === 'novo' ? 'default' : 'ghost'} onClick={() => setTipo('novo')} className="h-8 text-xs">
              💰 Novo
            </Button>
            <Button size="sm" variant={tipo === 'refin' ? 'default' : 'ghost'} onClick={() => setTipo('refin')} className="h-8 text-xs">
              🔁 Refin
            </Button>
            <Button size="sm" variant={tipo === 'port' ? 'default' : 'ghost'} onClick={() => setTipo('port')} className="h-8 text-xs">
              🔄 Port
            </Button>
            <Button size="sm" variant={tipo === 'cartao' ? 'default' : 'ghost'} onClick={() => setTipo('cartao')} className="h-8 text-xs">
              💳 Cartão
            </Button>
          </div>

          {tipo === 'novo' && <SimNovoEmp margemLivre={margemLivre} valor={valor} idade={idade} />}
          {tipo === 'refin' && <SimRefin />}
          {tipo === 'port' && <SimPort parsed={parsed} idade={idade} />}
          {tipo === 'cartao' && <SimCartao valor={valor} />}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────
// Sub-painéis por tipo de operação
// ──────────────────────────────────────────────────────────────────

function SimNovoEmp({ margemLivre, valor, idade }: { margemLivre: number; valor: number; idade: number | null }) {
  const [parcela, setParcela] = useState(margemLivre > 0 ? margemLivre.toFixed(2) : '');
  // Pra empréstimo novo: simula port com saldo=0 (não tem contrato origem)
  const result = useMemo(() => {
    const p = parseFloat(parcela.replace(',', '.')) || 0;
    if (p <= 0) return [] as BancoSimul[];
    // Empréstimo novo: sem origem (cod '000'), sem pagas, taxa origem 0
    return testarTodos(p, 0, 0, '000', false, idade, null, 96, 41, '', 0);
  }, [parcela, idade]);

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        Margem livre identificada: <strong className="font-mono text-green-400">{formatBRL(margemLivre)}</strong>
        {valor > 0 && <> · Valor benefício: <strong className="font-mono">{formatBRL(valor)}</strong></>}
      </div>
      <div>
        <Label>Parcela mensal (R$)</Label>
        <Input value={parcela} onChange={(e) => setParcela(e.target.value)} placeholder="500,00" className="font-mono" />
      </div>
      <ResultadoBancos destinos={result} reducao={null} legenda="Valor liberado por banco" />
    </div>
  );
}

function SimPort({ parsed, idade }: { parsed: InssParsedResult; idade: number | null }) {
  // Lista os contratos do beneficiário pra escolher
  const contratos = parsed.contratos || [];
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [parcela, setParcela] = useState('');
  const [saldo, setSaldo] = useState('');
  const [pagas, setPagas] = useState('0');
  const [codOrigem, setCodOrigem] = useState('318'); // BMG default
  const [taxaOrig, setTaxaOrig] = useState('1.85');

  // Atualiza inputs quando troca contrato
  useEffect(() => {
    if (contratos[selectedIdx]) {
      const c = contratos[selectedIdx];
      setParcela(String(parseBR(c.parcela)));
      setSaldo(String(parseBR(c.saldo || c.saldo_quitacao)));
      setCodOrigem(String(c.banco_codigo || '318').padStart(3, '0'));
      setTaxaOrig(String(parseBR(c.taxa) || 1.85));
      if (c.prazos) {
        const m = String(c.prazos).match(/(\d+)\s*[/\\]\s*(\d+)/);
        if (m) setPagas(String((+m[2]) - (+m[1])));
      }
    }
  }, [selectedIdx, contratos]);

  const result = useMemo(() => {
    const p = parseFloat(parcela.replace(',', '.')) || 0;
    const s = parseFloat(saldo.replace(',', '.')) || 0;
    const pg = parseInt(pagas, 10) || 0;
    const tx = parseFloat(taxaOrig.replace(',', '.')) || 0;
    if (p <= 0 || s <= 0) return { destinos: [] as BancoSimul[], reducao: null };
    const destinos = testarTodos(p, s, pg, codOrigem, false, idade, null, 60, 41, '', tx);
    const reducao = calcReducaoPort({ par: p, sal: s }, 108);
    return { destinos, reducao };
  }, [parcela, saldo, pagas, codOrigem, taxaOrig, idade]);

  return (
    <div className="space-y-3">
      {contratos.length > 0 && (
        <div>
          <Label>Pré-preencher com contrato</Label>
          <select
            value={selectedIdx}
            onChange={(e) => setSelectedIdx(Number(e.target.value))}
            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {contratos.map((c, i) => (
              <option key={i} value={i}>
                {c.contrato || '(s/ nº)'} · {c.banco || c.banco_codigo} · {formatBRL(parseBR(c.parcela))}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Parcela atual (R$)" value={parcela} onChange={setParcela} />
        <Field label="Saldo devedor (R$)" value={saldo} onChange={setSaldo} />
        <Field label="Pagas" value={pagas} onChange={setPagas} />
        <Field label="Banco origem (3 dig)" value={codOrigem} onChange={setCodOrigem} />
        <Field label="Taxa origem (%)" value={taxaOrig} onChange={setTaxaOrig} />
      </div>
      <ResultadoBancos destinos={result.destinos} reducao={result.reducao} legenda="Bancos destino aceitos" />
    </div>
  );
}

function SimRefin() {
  const [parcela, setParcela] = useState('');
  const [saldo, setSaldo] = useState('');
  const result = useMemo(() => {
    const p = parseFloat(parcela.replace(',', '.')) || 0;
    const s = parseFloat(saldo.replace(',', '.')) || 0;
    if (p <= 0 || s <= 0) return null;
    return calcReducaoPort({ par: p, sal: s }, 108);
  }, [parcela, saldo]);
  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        Refinanciamento simples — recalcula parcela em 108 meses a 1.50% (taxa piso INSS).
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Parcela atual (R$)" value={parcela} onChange={setParcela} />
        <Field label="Saldo devedor (R$)" value={saldo} onChange={setSaldo} />
      </div>
      {result && (
        <div className="rounded-md border border-green-500/40 bg-green-500/10 p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Resultado</div>
          <div className="grid grid-cols-2 gap-3 mt-1">
            <div>
              <div className="text-[10px] text-muted-foreground">Nova parcela (108m @ 1.50%)</div>
              <div className="text-lg font-mono font-bold text-green-400">{formatBRL(result.novaParc)}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">Economia/mês</div>
              <div className="text-lg font-mono font-bold text-green-400 flex items-center gap-1">
                <TrendingDown className="size-4" /> {formatBRL(result.reducao)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SimCartao({ valor }: { valor: number }) {
  const [vSaque, setVSaque] = useState('');
  // Cartão: coef 0.029214 (V1) — parcela = valor / vc_factor
  const COEF_CART = 0.029214;
  const result = useMemo(() => {
    const v = parseFloat(vSaque.replace(',', '.')) || 0;
    if (v <= 0) return null;
    const parcela = v * COEF_CART;
    return { parcela };
  }, [vSaque]);
  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        Cartão consignado / benefício — estima parcela mensal (RMC ou RCC) sobre saque desejado.
        Valor benefício: <strong className="font-mono">{formatBRL(valor)}</strong>
      </div>
      <Field label="Valor de saque desejado (R$)" value={vSaque} onChange={setVSaque} />
      {result && (
        <div className="rounded-md border border-purple-500/40 bg-purple-500/10 p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Parcela estimada</div>
          <div className="text-2xl font-mono font-bold text-purple-400">{formatBRL(result.parcela)}</div>
          <div className="text-[10px] text-muted-foreground mt-1">coef cartão = 0.029214 (≈ 2,92%)</div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-9 font-mono text-xs" />
    </div>
  );
}

function ResultadoBancos({
  destinos, reducao, legenda,
}: {
  destinos: BancoSimul[];
  reducao: { novaParc: number; reducao: number } | null;
  legenda: string;
}) {
  if (!destinos.length && !reducao) {
    return (
      <div className="rounded-md border border-border bg-card/50 p-3 text-xs text-muted-foreground text-center">
        Preencha os campos pra ver o resultado.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{legenda}</div>
      {destinos.length === 0 ? (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-400">
          ❌ Nenhum banco aceita essa combinação.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {destinos.map((d, i) => {
            const isMelhor = i === 0;
            return (
              <div
                key={i}
                className={`rounded-md border p-2 ${
                  isMelhor ? 'border-green-500/60 bg-green-500/10 ring-1 ring-green-500/30' : 'border-border bg-card/50'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <Badge variant={isMelhor ? 'success' : 'outline'} className="text-[10px] font-mono">
                    {d.banco}{isMelhor && ' ⭐'}
                  </Badge>
                  <span className="text-[10px] font-mono">{d.taxa.toFixed(2)}%</span>
                </div>
                <div className="grid grid-cols-2 gap-1 text-[10px]">
                  <div>
                    <div className="text-muted-foreground uppercase font-semibold">Troco</div>
                    <div className="font-mono font-semibold text-green-400">
                      <Banknote className="size-3 inline mr-0.5" />
                      {formatBRL(d.troco)}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground uppercase font-semibold">Vlr Cont</div>
                    <div className="font-mono font-semibold text-cyan-400">
                      <ArrowRightLeft className="size-3 inline mr-0.5" />
                      {formatBRL(d.vc)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {reducao && (
        <div className="rounded-md border border-cyan-500/40 bg-cyan-500/5 p-2 flex items-center gap-3">
          <TrendingDown className="size-4 text-cyan-400" />
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Nova parcela (estim. 108m @ 1.50%)
            </div>
            <div className="text-sm font-mono font-bold text-cyan-400">
              {formatBRL(reducao.novaParc)}{' '}
              <span className="text-[10px] text-green-400">(↓ {formatBRL(reducao.reducao)}/mês)</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
