'use client';

import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatBRL } from '@/lib/utils';
import { InssParsedResult } from '@/lib/inss-types';
import {
  testarTodos, calcReducaoPort, parseBR, pC, pEN, ESP_INV, ESP_AUX,
  type BancoSimul,
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
  reducaoEstim: number;     // refin 108m @ 1.50% — quanto reduz a parcela
  novaParcEstim: number;    // parcela nova após refin
  resolveExcedente: boolean; // refin desse contrato sozinho cobre o excedente da nova regra?
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

function calcularTudo(parsed: InssParsedResult): { contratos: ContratoCalc[]; analise: AnaliseNovaRegra } {
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
    const saldo = parseBR(c.saldo || c.saldo_quitacao);
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

    // Refin estimado (108m @ 1.50% — taxa piso INSS)
    const rcalc = calcReducaoPort({ par: parcela, sal: saldo }, 108);
    const reducaoEstim = rcalc?.reducao || 0;
    const novaParcEstim = rcalc?.novaParc || parcela;

    // Esse contrato sozinho resolve o excedente da nova regra?
    const resolveExcedente = !bloqueado && excedente > 0 && reducaoEstim >= excedente - 0.01;

    contratos.push({
      idx: i, contrato, bancoOrigem, codOrigem, parcela, saldo, taxaOrig, prazos,
      pagas, prazoRest: restPg, prazoTotal: totPg,
      destinos, destinoSelecionado: 0,
      reducaoEstim, novaParcEstim, resolveExcedente,
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
  const { contratos, analise } = useMemo(() => calcularTudo(parsed), [parsed]);

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
                  ({contratos.length > 0 && `melhor reduz ${formatBRL(Math.max(0, ...contratos.map((c) => c.reducaoEstim)))}`}),
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
                    Refin contrato <span className="font-mono">{c.contrato || '?'}</span> ({c.bancoOrigem})
                  </div>
                  <div className="text-muted-foreground">
                    Parcela <strong className="font-mono text-foreground">{formatBRL(c.parcela)}</strong>{' '}
                    → <strong className="font-mono text-green-400">{formatBRL(c.novaParcEstim)}</strong>{' '}
                    (reduz <strong className="font-mono">{formatBRL(c.reducaoEstim)}</strong> ≥ excedente{' '}
                    {formatBRL(excedente)})
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
          <details className={!enquadraNovaRegra ? '' : 'pt-2'}>
            <summary className="cursor-pointer text-xs font-semibold py-1.5 hover:bg-muted/30 rounded px-2">
              📋 Ver todos os contratos ({contratos.length})
            </summary>
            <div className="mt-1 overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="text-left p-2 font-semibold">Contrato</th>
                    <th className="text-left p-2 font-semibold">Origem</th>
                    <th className="text-right p-2 font-semibold">Parcela</th>
                    <th className="text-right p-2 font-semibold">Saldo</th>
                    <th className="text-center p-2 font-semibold">Pagas/Prazo</th>
                    <th className="text-right p-2 font-semibold">Refin (108m @ 1.50%)</th>
                    <th className="text-center p-2 font-semibold">Resolve?</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {contratos.map((c) => (
                    <tr key={c.idx} className={c.bloqueado ? 'opacity-50' : c.resolveExcedente ? 'bg-green-500/5' : ''}>
                      <td className="p-2 font-mono">{c.contrato || '—'}</td>
                      <td className="p-2"><Badge variant="muted" className="text-[10px] font-mono">{c.codOrigem || '?'}</Badge></td>
                      <td className="p-2 text-right font-mono">{formatBRL(c.parcela)}</td>
                      <td className="p-2 text-right font-mono">{formatBRL(c.saldo)}</td>
                      <td className="p-2 text-center font-mono">{c.prazos}</td>
                      <td className="p-2 text-right font-mono">
                        {c.reducaoEstim > 0 ? (
                          <span>
                            <span className="text-green-400">{formatBRL(c.novaParcEstim)}</span>
                            <span className="text-[10px] text-green-400/70 ml-1">↓{formatBRL(c.reducaoEstim)}</span>
                          </span>
                        ) : c.bloqueado ? (
                          <span className="text-red-400 text-[10px]">{c.motivoBloqueio?.slice(0, 30)}</span>
                        ) : '—'}
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
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
