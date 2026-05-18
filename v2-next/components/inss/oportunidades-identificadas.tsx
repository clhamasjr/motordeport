'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatBRL } from '@/lib/utils';
import { InssParsedResult } from '@/lib/inss-types';
import {
  testarTodos, calcReducaoPort, parseBR, pC, pP, pEN, ESP_INV, ESP_AUX,
  type BancoSimul,
} from '@/lib/inss-motor';
import { ChevronDown, ChevronUp, Banknote, TrendingUp, ShoppingCart, Sparkles, CheckCircle2 } from 'lucide-react';

// COEF do V1 — usado pra estimar empréstimo novo (taxa 1.85% piso INSS)
const COEF_NOVO = 0.02299;

interface ContratoCalc {
  idx: number;
  contrato: string;
  bancoOrigem: string;
  codOrigem: string;
  parcela: number;
  saldo: number;
  taxaOrig: number;
  prazos: string;
  pagas: number;
  prazoRest: number;
  destinos: BancoSimul[];
  destinoSelecionado: number; // índice em destinos
  novaParc: number;
  reducao: number;
  bloqueado: boolean;
  motivoBloqueio?: string;
}

interface Props {
  parsed: InssParsedResult;
}

function calcular(parsed: InssParsedResult): ContratoCalc[] {
  const ben = parsed.beneficio || {};
  const b = parsed.beneficiario || {};
  const esp = ben.especie || '';
  const eN = pEN(esp);
  const isInv = ESP_INV.includes(eN);
  const isAux = ESP_AUX.includes(eN) || String(esp).toUpperCase().includes('AUXIL');
  const idade = b.idade ? parseInt(String(b.idade), 10) : null;
  let bY: number | null = null;
  if (ben.ddb) {
    const m = String(ben.ddb).match(/(\d{2})[/-](\d{2})[/-](\d{4})/);
    if (m) {
      const d = new Date(+m[3], +m[2] - 1, +m[1]);
      const now = new Date();
      bY = now.getFullYear() - d.getFullYear();
      if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) bY--;
    }
  }

  const contratos = parsed.contratos || [];
  const out: ContratoCalc[] = [];

  for (let i = 0; i < contratos.length; i++) {
    const c = contratos[i];
    const parcela = parseBR(c.parcela);
    const saldo = parseBR(c.saldo || c.saldo_quitacao);
    if (!parcela || !saldo) continue;
    const taxaOrig = parseBR(c.taxa);
    const codOrigem = pC(c.banco_codigo || '');
    const [restPg, totPg, pagas] = c.prazos ? pP(c.prazos) : [0, 0, 0];
    const prazos = c.prazos || `${restPg}/${totPg}`;
    const contrato = c.contrato || '';
    const bancoOrigem = c.banco || codOrigem || '?';

    let destinos: BancoSimul[] = [];
    let bloqueado = false;
    let motivo: string | undefined;

    if (isAux) {
      bloqueado = true;
      motivo = 'Auxílio — não permite consignado';
    } else {
      try {
        destinos = testarTodos(parcela, saldo, pagas, codOrigem, isInv, idade, bY, restPg, eN, contrato, taxaOrig);
      } catch {
        destinos = [];
      }
      if (!destinos.length) {
        bloqueado = true;
        motivo = 'Nenhum banco aceita esse contrato (regras de origem, taxa, idade ou troco mín.)';
      }
    }

    const reducaoRes = calcReducaoPort({ par: parcela, sal: saldo }, 108);
    const novaParc = reducaoRes?.novaParc || 0;
    const reducao = reducaoRes?.reducao || 0;

    out.push({
      idx: i, contrato, bancoOrigem, codOrigem, parcela, saldo, taxaOrig, prazos, pagas: pagas || 0, prazoRest: restPg || 0,
      destinos, destinoSelecionado: 0, novaParc, reducao, bloqueado, motivoBloqueio: motivo,
    });
  }
  return out;
}

export function OportunidadesIdentificadas({ parsed }: Props) {
  const todos = useMemo(() => calcular(parsed), [parsed]);
  const [open, setOpen] = useState(true);
  const [selDestinos, setSelDestinos] = useState<Record<number, number>>({});

  const elegiveis = todos.filter((c) => !c.bloqueado);
  const bloqueados = todos.filter((c) => c.bloqueado);

  // Empréstimo novo: estima sobre margem livre
  const mrgLivre = parseBR(parsed.margem?.disponivel);
  const empNovoVlr = mrgLivre > 0 ? mrgLivre / COEF_NOVO : 0;

  // Totais Port: soma dos VCs dos destinos selecionados
  const totalVc = elegiveis.reduce((s, c) => {
    const idx = selDestinos[c.idx] ?? 0;
    const d = c.destinos[idx];
    return s + (d?.vc || 0);
  }, 0);
  const totalTroco = elegiveis.reduce((s, c) => {
    const idx = selDestinos[c.idx] ?? 0;
    const d = c.destinos[idx];
    return s + (d?.troco || 0);
  }, 0);

  if (todos.length === 0) return null;

  return (
    <Card className="border-cyan-500/30 bg-cyan-500/5">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-cyan-400" />
            <h3 className="font-bold text-base">Oportunidades Identificadas</h3>
          </div>
          <div className="text-right text-xs">
            <span className="text-muted-foreground">Potencial total:</span>{' '}
            <strong className="font-mono text-green-400">{formatBRL(empNovoVlr + totalVc)}</strong>
          </div>
        </div>

        {/* 2 cards principais */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {/* Empréstimo Novo */}
          <div className="rounded-lg border border-orange-500/40 bg-orange-500/5 p-3">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] uppercase tracking-wider font-bold text-orange-400">💰 Empréstimo Novo</div>
              <TrendingUp className="size-4 text-orange-400" />
            </div>
            <div className="text-2xl font-mono font-bold text-orange-400">{formatBRL(empNovoVlr)}</div>
            <div className="text-[10px] text-muted-foreground mt-1">
              Margem livre <strong className="font-mono">{formatBRL(mrgLivre)}</strong> / coef. 0.02299 (1.85% piso)
            </div>
          </div>

          {/* Portabilidade */}
          <div className="rounded-lg border border-green-500/40 bg-green-500/5 p-3">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] uppercase tracking-wider font-bold text-green-400">🔄 Portabilidade</div>
              <Banknote className="size-4 text-green-400" />
            </div>
            <div className="text-2xl font-mono font-bold text-green-400">{formatBRL(totalVc)}</div>
            <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
              <span>
                <strong className="text-foreground">{elegiveis.length}</strong> de{' '}
                <strong>{todos.length}</strong> contrato(s) elegível(eis)
              </span>
              <span>
                Troco: <strong className="font-mono text-green-400">{formatBRL(totalTroco)}</strong>
              </span>
            </div>
          </div>
        </div>

        {/* Tabela detalhada — colapsável */}
        <div>
          <button
            onClick={() => setOpen(!open)}
            className="w-full flex items-center justify-between text-xs font-semibold py-1.5 hover:bg-muted/30 rounded px-2 transition-colors"
          >
            <span>📋 Detalhe Portabilidade (todos os contratos)</span>
            {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
          {open && (
            <div className="mt-1 overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="text-left p-2 font-semibold">Contrato</th>
                    <th className="text-left p-2 font-semibold">Origem</th>
                    <th className="text-right p-2 font-semibold">Taxa atual</th>
                    <th className="text-right p-2 font-semibold">Parcela</th>
                    <th className="text-right p-2 font-semibold">Saldo</th>
                    <th className="text-center p-2 font-semibold">Pagas/Prazo</th>
                    <th className="text-left p-2 font-semibold">→ Destino</th>
                    <th className="text-right p-2 font-semibold">Nova taxa</th>
                    <th className="text-right p-2 font-semibold">Vlr Contrato</th>
                    <th className="text-right p-2 font-semibold">Troco</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {todos.map((c) => (
                    <LinhaContrato
                      key={c.idx}
                      c={c}
                      destinoIdx={selDestinos[c.idx] ?? 0}
                      onChangeDestino={(i) => setSelDestinos((prev) => ({ ...prev, [c.idx]: i }))}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Botões de ação */}
        {elegiveis.length > 0 && (
          <div className="flex justify-end">
            <Button size="sm" disabled className="gap-1 opacity-60" title="Carrinho de digitação — Fase 3">
              <ShoppingCart className="size-4" />
              Adicionar Todos Elegíveis ({elegiveis.length})
            </Button>
          </div>
        )}

        {bloqueados.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              ⚠ {bloqueados.length} contrato(s) bloqueado(s) — clique pra ver motivo
            </summary>
            <div className="mt-2 space-y-1">
              {bloqueados.map((c) => (
                <div key={c.idx} className="text-[11px] rounded-md bg-red-500/5 border border-red-500/20 p-2">
                  <div className="font-mono font-semibold">
                    {c.contrato || '(s/ nº)'} · {c.bancoOrigem} · {formatBRL(c.parcela)} / {formatBRL(c.saldo)}
                  </div>
                  <div className="text-red-400">{c.motivoBloqueio}</div>
                </div>
              ))}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function LinhaContrato({
  c, destinoIdx, onChangeDestino,
}: {
  c: ContratoCalc;
  destinoIdx: number;
  onChangeDestino: (i: number) => void;
}) {
  const dest = c.bloqueado ? null : c.destinos[destinoIdx];
  return (
    <tr className={c.bloqueado ? 'opacity-40' : 'hover:bg-muted/20'}>
      <td className="p-2 font-mono">{c.contrato || '—'}</td>
      <td className="p-2">
        <Badge variant="muted" className="text-[10px] font-mono">{c.codOrigem || '?'}</Badge>
      </td>
      <td className="p-2 text-right font-mono">{c.taxaOrig > 0 ? `${c.taxaOrig.toFixed(2)}%` : '—'}</td>
      <td className="p-2 text-right font-mono">{formatBRL(c.parcela)}</td>
      <td className="p-2 text-right font-mono">{formatBRL(c.saldo)}</td>
      <td className="p-2 text-center font-mono">{c.prazos}</td>
      <td className="p-2">
        {c.bloqueado ? (
          <span className="text-red-400 text-[10px]">{c.motivoBloqueio?.slice(0, 30)}...</span>
        ) : c.destinos.length === 1 ? (
          <Badge variant="success" className="text-[10px] font-mono">{dest?.banco}</Badge>
        ) : (
          <select
            value={destinoIdx}
            onChange={(e) => onChangeDestino(Number(e.target.value))}
            className="h-7 text-[11px] rounded-md border border-input bg-background px-1.5 font-mono"
          >
            {c.destinos.map((d, i) => (
              <option key={i} value={i}>
                {d.banco} {i === 0 ? '⭐' : ''}
              </option>
            ))}
          </select>
        )}
      </td>
      <td className="p-2 text-right font-mono">
        {dest ? <span className="text-green-400">{dest.taxa.toFixed(2)}%</span> : '—'}
      </td>
      <td className="p-2 text-right font-mono">
        {dest ? <span className="text-cyan-400 font-semibold">{formatBRL(dest.vc)}</span> : '—'}
      </td>
      <td className="p-2 text-right font-mono">
        {dest && dest.troco > 0 ? (
          <span className="text-green-400 font-bold">{formatBRL(dest.troco)}</span>
        ) : '—'}
      </td>
    </tr>
  );
}
