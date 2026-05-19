'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { formatBRL } from '@/lib/utils';
import { InssParsedResult } from '@/lib/inss-types';
import {
  testarTodos, calcPortRefin108, parseBR, pC, pEN, ESP_INV, ESP_AUX,
  type BancoSimul, type PortRefin108Result,
} from '@/lib/inss-motor';
import {
  Banknote, TrendingUp, ShoppingCart, Sparkles, AlertTriangle,
  CheckCircle2, XCircle, Scissors, RefreshCw,
} from 'lucide-react';

// Coef pra estimar empréstimo novo (1.85% piso) e cartão (≈2.92%)
const COEF_EMP_185 = 0.02299;

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
  prazoTotal: number;
  destinos: BancoSimul[];
  destinoSelecionado: number;
  // Port+Refin 108m (operação UNIFICADA) — calculada com coef 108m
  portRefin108: PortRefin108Result | null;
  resolveExcedente: boolean;     // refin no destino 108m cobre o excedente?
  bloqueado: boolean;
  motivoBloqueio?: string;
}

interface SolucaoCartao {
  tipo: 'RMC' | 'RCC';
  valor: number;
  resolve: boolean;
}

interface AnaliseNovaRegra {
  // Inputs
  benef: number;
  sumEmp: number;
  sumRmc: number;
  sumRcc: number;
  total: number;
  compPct: number;

  // Tetos NOVA regra (40% total)
  teto40Total: number;     // 40% benefício
  tetoEmpComCartao: number; // 35% (se tiver cartão)
  tetoCartao: number;      // 5% (se tiver cartão)

  // Estado NOVA
  enquadraNovaRegra: boolean;
  excedente: number;       // total - teto40Total se positivo
  margemLivreNova: number; // teto40Total - total se positivo

  // Soluções pra enquadrar (só se NÃO enquadra)
  contratosQueResolvem: ContratoCalc[]; // contratos cujo refin sozinho cobre o excedente
  cartoesQueResolvem: SolucaoCartao[];  // cancelar RMC/RCC se valor >= excedente
}

function calcularTudo(
  parsed: InssParsedResult,
  saldoOverrides: Record<number, number> = {},
): { contratos: ContratoCalc[]; analise: AnaliseNovaRegra } {
  const ben = parsed.beneficio || {};
  const b = parsed.beneficiario || {};
  const mrg = parsed.margem || {};
  const esp = ben.especie || '';
  const eN = pEN(esp);
  const isInv = ESP_INV.includes(eN);
  const isAux = ESP_AUX.includes(eN) || String(esp).toUpperCase().includes('AUXIL');
  const idade = b.idade ? parseInt(String(b.idade), 10) : null;

  // DIB → anos de benefício
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

  // ── Análise da nova regra (40% total) ──
  const benef = parseBR(ben.base_calculo) || parseBR(ben.valor) || 0;
  const sumEmp = parseBR(mrg.parcelas);
  const tetoCartao = benef * 0.05;
  const mrgRmcLivre = parseBR(mrg.rmc);
  const mrgRccLivre = parseBR(mrg.rcc);
  const cartoes = parsed.cartoes || [];
  const temRmc = (mrg.rmc != null && mrgRmcLivre < tetoCartao - 0.01) ||
    cartoes.some((c) => (c.tipo || '').toUpperCase().includes('RMC'));
  const temRcc = (mrg.rcc != null && mrgRccLivre < tetoCartao - 0.01) ||
    cartoes.some((c) => (c.tipo || '').toUpperCase().includes('RCC'));
  const sumRmc = temRmc ? Math.max(0, tetoCartao - mrgRmcLivre) : 0;
  const sumRcc = temRcc ? Math.max(0, tetoCartao - mrgRccLivre) : 0;
  const total = sumEmp + sumRmc + sumRcc;
  const compPct = benef > 0 ? (total / benef) * 100 : 0;

  const teto40Total = benef * 0.40;
  const tetoEmpComCartao = benef * 0.35;
  const enquadraNovaRegra = total <= teto40Total + 0.01;
  const excedente = Math.max(0, total - teto40Total);
  const margemLivreNova = Math.max(0, teto40Total - total);

  // ── Roda motor pra cada contrato ──
  const contratosRaw = parsed.contratos || [];
  const contratos: ContratoCalc[] = [];

  for (let i = 0; i < contratosRaw.length; i++) {
    const c = contratosRaw[i];
    const parcela = parseBR(c.parcela);
    // Override do user tem precedência sobre o saldo do Multicorban
    const saldoOriginal = parseBR(c.saldo || c.saldo_quitacao);
    const saldo = saldoOverrides[i] !== undefined ? saldoOverrides[i] : saldoOriginal;
    if (!parcela || !saldo) continue;
    const taxaOrig = parseBR(c.taxa);
    const codOrigem = pC(c.banco_codigo || '');
    const restPg = parseInt(String(c.prazo || '0'), 10) || 0;
    const totPg = parseInt(String(c.prazo_original || '0'), 10) || 0;
    const pagas = Math.max(0, totPg - restPg);
    const prazos = totPg > 0 ? `${pagas}/${totPg}` : (restPg > 0 ? `?/${restPg}` : '—');
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
        motivo = 'Nenhum banco aceita esse contrato';
      }
    }

    // ── PORT + REFIN 108m: operação unificada ──
    // Pra cada destino, calcula coef 108m + 2 cenários (refin puro + port com troco).
    // Escolhe o destino com MAIOR redução da parcela.
    let portRefin108: PortRefin108Result | null = null;
    if (!bloqueado && destinos.length > 0 && saldo > 0 && parcela > 0) {
      let melhorReducao = -Infinity;
      for (const d of destinos) {
        const r = calcPortRefin108(parcela, saldo, d, taxaOrig);
        if (r && r.taxaOrigVale && r.refin_reducao > melhorReducao) {
          melhorReducao = r.refin_reducao;
          portRefin108 = r;
        }
      }
    }

    // Resolve o excedente da nova regra?
    const resolveExcedente = !bloqueado && excedente > 0 &&
      !!portRefin108 && portRefin108.refin_reducao >= excedente - 0.01;

    contratos.push({
      idx: i, contrato, bancoOrigem, codOrigem, parcela, saldo, taxaOrig, prazos,
      pagas, prazoRest: restPg, prazoTotal: totPg,
      destinos, destinoSelecionado: 0,
      portRefin108,
      resolveExcedente,
      bloqueado, motivoBloqueio: motivo,
    });
  }

  // Soluções de cartão
  const cartoesQueResolvem: SolucaoCartao[] = [];
  if (sumRmc > 0) cartoesQueResolvem.push({ tipo: 'RMC', valor: sumRmc, resolve: sumRmc >= excedente - 0.01 });
  if (sumRcc > 0) cartoesQueResolvem.push({ tipo: 'RCC', valor: sumRcc, resolve: sumRcc >= excedente - 0.01 });

  const analise: AnaliseNovaRegra = {
    benef, sumEmp, sumRmc, sumRcc, total, compPct,
    teto40Total, tetoEmpComCartao, tetoCartao,
    enquadraNovaRegra, excedente, margemLivreNova,
    contratosQueResolvem: contratos.filter((c) => c.resolveExcedente),
    cartoesQueResolvem,
  };

  return { contratos, analise };
}

interface Props {
  parsed: InssParsedResult;
}

export function OportunidadesIdentificadas({ parsed }: Props) {
  const [saldoOverrides, setSaldoOverrides] = useState<Record<number, number>>({});
  const { contratos, analise } = useMemo(
    () => calcularTudo(parsed, saldoOverrides),
    [parsed, saldoOverrides],
  );

  const ajustarSaldo = (idx: number, valor: number) => {
    setSaldoOverrides((prev) => ({ ...prev, [idx]: valor }));
  };
  const resetSaldo = (idx: number) => {
    setSaldoOverrides((prev) => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  };

  if (contratos.length === 0 && analise.benef === 0) return null;

  const {
    benef, total, compPct, teto40Total, enquadraNovaRegra, excedente, margemLivreNova,
    contratosQueResolvem, cartoesQueResolvem,
  } = analise;

  const numSolucoesContrato = contratosQueResolvem.length;
  const numSolucoesCartao = cartoesQueResolvem.filter((c) => c.resolve).length;
  const totalSolucoes = numSolucoesContrato + numSolucoesCartao;
  const inviavel = !enquadraNovaRegra && totalSolucoes === 0;

  // Empréstimo Novo: só faz sentido se ENQUADRA e tem margem livre na nova
  const empNovoVlr = enquadraNovaRegra && margemLivreNova > 0 ? margemLivreNova / COEF_EMP_185 : 0;

  return (
    <Card className={
      inviavel ? 'border-red-500/40 bg-red-500/5'
      : !enquadraNovaRegra ? 'border-yellow-500/40 bg-yellow-500/5'
      : 'border-green-500/30 bg-green-500/5'
    }>
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-cyan-400" />
            <h3 className="font-bold text-base">Enquadramento na NOVA regra do INSS (40%)</h3>
          </div>
          <Badge
            variant={inviavel ? 'destructive' : !enquadraNovaRegra ? 'warning' : 'success'}
            className="text-xs"
          >
            {compPct.toFixed(1)}% / 40%
          </Badge>
        </div>

        {/* Status principal */}
        {enquadraNovaRegra ? (
          <div className="rounded-md bg-green-500/10 border border-green-500/40 p-3 text-sm">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="size-5 text-green-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-green-400">✅ Cliente ENQUADRADO na nova regra</div>
                <div className="text-xs text-foreground mt-1">
                  Comprometimento total <strong className="font-mono">{formatBRL(total)}</strong> de{' '}
                  <strong className="font-mono">{formatBRL(teto40Total)}</strong> (40%).
                  {margemLivreNova > 0 ? (
                    <> Sobra <strong className="font-mono text-green-400">{formatBRL(margemLivreNova)}</strong> de margem livre.</>
                  ) : (
                    <> No limite — sem margem livre pra novas operações.</>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : inviavel ? (
          <div className="rounded-md bg-red-500/10 border border-red-500/40 p-3 text-sm">
            <div className="flex items-start gap-2">
              <XCircle className="size-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-red-400">❌ INVIÁVEL — sem operação isolada que enquadre</div>
                <div className="text-xs text-foreground mt-1">
                  Cliente extrapola em <strong className="font-mono text-red-400">{formatBRL(excedente)}</strong>{' '}
                  na nova regra. Nenhum contrato sozinho reduz parcela suficiente
                  ({contratos.length > 0 && `melhor reduz ${formatBRL(Math.max(0, ...contratos.map((c) => c.portRefin108?.refin_reducao || 0)))}`}),
                  e {cartoesQueResolvem.length === 0 ? 'cliente não tem cartão pra cancelar' : 'cancelar cartão sozinho também não cobre'}.
                  <div className="mt-1 text-red-400 font-semibold">→ Não tem o que fazer com 1 operação só. Precisaria combinar várias.</div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-md bg-yellow-500/10 border border-yellow-500/40 p-3 text-sm">
            <div className="flex items-start gap-2">
              <AlertTriangle className="size-5 text-yellow-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-yellow-400">
                  ⚠ Cliente VAI EXTRAPOLAR — excedente {formatBRL(excedente)}
                </div>
                <div className="text-xs text-foreground mt-1">
                  Precisa de UMA operação que cubra esse valor. <strong className="text-green-400">{totalSolucoes}</strong> solução{totalSolucoes !== 1 ? 'ões' : ''} disponível{totalSolucoes !== 1 ? 'is' : ''}:
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Soluções isoladas pra enquadrar (só se NÃO enquadra mas tem solução) */}
        {!enquadraNovaRegra && totalSolucoes > 0 && (
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
              Soluções pra enquadrar (escolha 1):
            </div>

            {/* Cancelar cartão */}
            {cartoesQueResolvem.filter((c) => c.resolve).map((c) => (
              <div key={c.tipo} className="rounded-md border border-cyan-500/40 bg-cyan-500/5 p-2.5 flex items-center gap-2">
                <Scissors className="size-4 text-cyan-400 shrink-0" />
                <div className="flex-1 text-xs">
                  <div className="font-semibold text-cyan-400">Cancelar cartão {c.tipo}</div>
                  <div className="text-muted-foreground">
                    Libera <strong className="font-mono text-foreground">{formatBRL(c.valor)}</strong>{' '}
                    (≥ excedente <strong className="font-mono">{formatBRL(excedente)}</strong>) — cliente passa a usar emp ≤ 40%.
                  </div>
                </div>
                <Badge variant="success" className="text-[10px]">RESOLVE</Badge>
              </div>
            ))}

            {/* Refin contratos */}
            {contratosQueResolvem.map((c) => (
              <div key={c.idx} className="rounded-md border border-green-500/40 bg-green-500/5 p-2.5 flex items-center gap-2">
                <RefreshCw className="size-4 text-green-400 shrink-0" />
                <div className="flex-1 text-xs">
                  <div className="font-semibold text-green-400">
                    Port + Refin contrato <span className="font-mono">{c.contrato || '?'}</span> ({c.bancoOrigem}{' '}
                    {c.taxaOrig > 0 && <span className="text-muted-foreground">@ {c.taxaOrig.toFixed(2)}%</span>})
                    {c.portRefin108 && (
                      <span className="text-cyan-400 ml-1">
                        → {c.portRefin108.banco} @ {c.portRefin108.taxa.toFixed(2)}% / 108m
                      </span>
                    )}
                  </div>
                  <div className="text-muted-foreground">
                    Parcela <strong className="font-mono text-foreground">{formatBRL(c.parcela)}</strong>{' '}
                    → <strong className="font-mono text-green-400">{formatBRL(c.portRefin108?.refin_novaParc || 0)}</strong>{' '}
                    (reduz <strong className="font-mono">{formatBRL(c.portRefin108?.refin_reducao || 0)}</strong> ≥ excedente{' '}
                    {formatBRL(excedente)})
                    {c.portRefin108 && c.portRefin108.port_troco > 0 && (
                      <> · ou pegar troco <strong className="font-mono text-cyan-400">{formatBRL(c.portRefin108.port_troco)}</strong> mantendo parcela atual</>
                    )}
                  </div>
                </div>
                <Badge variant="success" className="text-[10px]">RESOLVE</Badge>
              </div>
            ))}
          </div>
        )}

        {/* Empréstimo Novo (só se ENQUADRA + tem margem livre na nova) */}
        {enquadraNovaRegra && margemLivreNova > 0 && (
          <div className="rounded-lg border border-orange-500/40 bg-orange-500/5 p-3">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] uppercase tracking-wider font-bold text-orange-400">💰 Empréstimo Novo</div>
              <TrendingUp className="size-4 text-orange-400" />
            </div>
            <div className="text-2xl font-mono font-bold text-orange-400">{formatBRL(empNovoVlr)}</div>
            <div className="text-[10px] text-muted-foreground mt-1">
              Margem livre na nova regra <strong className="font-mono">{formatBRL(margemLivreNova)}</strong> / coef 0.02299 (1.85% piso)
            </div>
          </div>
        )}

        {/* Tabela de contratos pra contexto */}
        {contratos.length > 0 && (
          <details className={!enquadraNovaRegra ? '' : 'pt-2'} open>
            <summary className="cursor-pointer text-xs font-semibold py-1.5 hover:bg-muted/30 rounded px-2">
              📋 Ver todos os contratos ({contratos.length})
              <span className="text-[10px] text-muted-foreground font-normal ml-2">
                — clique no saldo pra editar e recalcular
              </span>
            </summary>
            <div className="mt-1 overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="text-left p-2 font-semibold">Contrato</th>
                    <th className="text-left p-2 font-semibold">Origem</th>
                    <th className="text-right p-2 font-semibold">Taxa atual</th>
                    <th className="text-right p-2 font-semibold">Parcela</th>
                    <th className="text-right p-2 font-semibold">Saldo (editável)</th>
                    <th className="text-center p-2 font-semibold">Pagas/Prazo</th>
                    <th className="text-left p-2 font-semibold">→ Port+Refin 108m</th>
                    <th className="text-right p-2 font-semibold">Refin (reduz parc.)</th>
                    <th className="text-right p-2 font-semibold">Port (com troco)</th>
                    <th className="text-center p-2 font-semibold">Resolve?</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {contratos.map((c) => {
                    const melhorDest = c.destinos && c.destinos[0];
                    const saldoEditado = saldoOverrides[c.idx] !== undefined;
                    return (
                      <tr key={c.idx} className={c.bloqueado ? 'opacity-60' : c.resolveExcedente ? 'bg-green-500/5' : ''}>
                        <td className="p-2 font-mono">{c.contrato || '—'}</td>
                        <td className="p-2"><Badge variant="muted" className="text-[10px] font-mono">{c.codOrigem || '?'}</Badge></td>
                        <td className="p-2 text-right font-mono">
                          {c.taxaOrig > 0 ? (
                            <span className="text-yellow-400">{c.taxaOrig.toFixed(2)}%</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-2 text-right font-mono">{formatBRL(c.parcela)}</td>
                        <td className="p-2 text-right font-mono">
                          <div className="flex items-center gap-1 justify-end">
                            <Input
                              type="number"
                              step="100"
                              defaultValue={c.saldo}
                              onBlur={(e) => {
                                const v = parseFloat(e.target.value) || 0;
                                if (v !== c.saldo && v > 0) ajustarSaldo(c.idx, v);
                              }}
                              className={`h-7 text-xs font-mono text-right w-28 ${saldoEditado ? 'border-yellow-500/60 bg-yellow-500/5' : ''}`}
                            />
                            {saldoEditado && (
                              <button
                                onClick={() => resetSaldo(c.idx)}
                                className="text-[10px] text-muted-foreground hover:text-foreground"
                                title="Resetar pro saldo original"
                              >
                                ↺
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="p-2 text-center font-mono">{c.prazos}</td>
                        <td className="p-2">
                          {c.portRefin108 ? (
                            <div className="flex flex-col gap-0.5">
                              <Badge variant="success" className="text-[10px] font-mono w-fit">
                                {c.portRefin108.banco} · {c.portRefin108.taxa.toFixed(2)}%
                              </Badge>
                              <span className="text-[9px] text-muted-foreground font-mono">
                                108m · de {c.taxaOrig.toFixed(2)}% → {c.portRefin108.taxa.toFixed(2)}%
                              </span>
                            </div>
                          ) : melhorDest && c.taxaOrig > 0 ? (
                            <span className="text-[10px] text-muted-foreground">
                              taxa {c.taxaOrig.toFixed(2)}% ≤ destinos
                            </span>
                          ) : (
                            <span className="text-red-400 text-[10px]">{c.motivoBloqueio?.slice(0, 40) || '—'}</span>
                          )}
                        </td>
                        <td className="p-2 text-right">
                          {c.portRefin108 ? (
                            <div className="flex flex-col items-end gap-0.5">
                              <span className="font-mono text-green-400 text-xs">{formatBRL(c.portRefin108.refin_novaParc)}</span>
                              <span className="text-[9px] text-green-400/70 font-mono">
                                ↓ {formatBRL(c.portRefin108.refin_reducao)}/mês
                              </span>
                            </div>
                          ) : (<span className="text-muted-foreground">—</span>)}
                        </td>
                        <td className="p-2 text-right">
                          {c.portRefin108 && c.portRefin108.port_troco > 0 ? (
                            <div className="flex flex-col items-end gap-0.5">
                              <span className="font-mono text-cyan-400 text-xs">{formatBRL(c.portRefin108.port_troco)}</span>
                              <span className="text-[9px] text-muted-foreground font-mono">
                                parc R$ {formatBRL(c.portRefin108.port_novaParc)}
                              </span>
                            </div>
                          ) : (<span className="text-muted-foreground">—</span>)}
                        </td>
                        <td className="p-2 text-center">
                          {enquadraNovaRegra ? (
                            <span className="text-muted-foreground text-[10px]">—</span>
                          ) : c.resolveExcedente ? (
                            <Badge variant="success" className="text-[10px]">✓ SIM</Badge>
                          ) : (
                            <Badge variant="muted" className="text-[10px]">não</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {Object.keys(saldoOverrides).length > 0 && (
              <div className="text-[10px] text-yellow-400 mt-1 px-2">
                ⚠ {Object.keys(saldoOverrides).length} saldo(s) editado(s) manualmente —
                <button onClick={() => setSaldoOverrides({})} className="ml-1 underline hover:text-foreground">
                  resetar tudo
                </button>
              </div>
            )}
          </details>
        )}
      </CardContent>
    </Card>
  );
}
