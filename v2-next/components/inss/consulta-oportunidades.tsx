'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatBRL } from '@/lib/utils';
import { InssParsedResult } from '@/lib/inss-types';
import {
  testarTodos, calcReducaoPort, parseBR, pC, pP, pEN, ESP_INV, ESP_AUX,
  type BancoSimul,
} from '@/lib/inss-motor';
import { TrendingDown, Banknote, Sparkles, AlertCircle } from 'lucide-react';

interface ContratoCalculado {
  contrato: string;
  bancoOrigem: string;
  codOrigem: string;
  parcela: number;
  saldo: number;
  taxaOrig: number;
  prazos: string;
  pagas: number;
  destinos: BancoSimul[];
  novaParc: number;
  reducao: number;
  bloqueado: boolean;
  motivoBloqueio?: string;
}

interface Props {
  parsed: InssParsedResult;
}

/**
 * Roda o motor V1 em cada contrato do beneficio e retorna lista de oportunidades.
 * Replica a lógica do V1 (Consulta Unitária).
 */
function calcularOportunidades(parsed: InssParsedResult): ContratoCalculado[] {
  const ben = parsed.beneficio || {};
  const b = parsed.beneficiario || {};
  const esp = ben.especie || '';
  const eN = pEN(esp);
  const isInv = ESP_INV.includes(eN);
  const isAux = ESP_AUX.includes(eN) || String(esp).toUpperCase().includes('AUXIL');
  // idade
  const idadeRaw = b.idade;
  const idade = idadeRaw ? parseInt(String(idadeRaw), 10) : null;
  const idadeOk = idade != null && !Number.isNaN(idade) ? idade : null;
  // DIB → years
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
  const out: ContratoCalculado[] = [];

  for (const c of contratos) {
    const parcela = parseBR(c.parcela);
    const saldo = parseBR(c.saldo || c.saldo_quitacao);
    const taxaOrig = parseBR(c.taxa);
    const codOrigem = pC(c.banco_codigo || '');
    const [restPg, totPg, pagas] = c.prazos ? pP(c.prazos) : [0, 0, 0];
    const prazos = c.prazos || `${restPg}/${totPg}`;
    const contrato = c.contrato || '';
    const bancoOrigem = c.banco || codOrigem;

    if (!parcela || !saldo) continue; // sem dado pra calcular

    let destinos: BancoSimul[] = [];
    let bloqueado = false;
    let motivo: string | undefined;

    if (isAux) {
      bloqueado = true;
      motivo = 'Auxílio — não permite consignado';
    } else {
      try {
        destinos = testarTodos(parcela, saldo, pagas, codOrigem, isInv, idadeOk, bY, restPg, eN, contrato, taxaOrig);
      } catch {
        destinos = [];
      }
      if (!destinos.length) {
        bloqueado = true;
        motivo = 'Nenhum banco destino aceita esse contrato (regras de origem, taxa, idade ou troco mínimo)';
      }
    }

    const reducaoRes = calcReducaoPort({ par: parcela, sal: saldo }, 108);
    const novaParc = reducaoRes?.novaParc || 0;
    const reducao = reducaoRes?.reducao || 0;

    out.push({
      contrato, bancoOrigem, codOrigem, parcela, saldo, taxaOrig, prazos, pagas: pagas || 0,
      destinos, novaParc, reducao, bloqueado, motivoBloqueio: motivo,
    });
  }
  return out;
}

export function ConsultaOportunidades({ parsed }: Props) {
  const lista = calcularOportunidades(parsed);
  if (!lista.length) return null;

  const totalTroco = lista.reduce((s, c) => s + (c.destinos[0]?.troco || 0), 0);
  const totalReducao = lista.reduce((s, c) => s + c.reducao, 0);
  const ok = lista.filter((c) => !c.bloqueado);
  const bloq = lista.filter((c) => c.bloqueado);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-yellow-400" />
          <h3 className="font-semibold text-base">
            Oportunidades de Portabilidade
            <span className="text-muted-foreground font-normal ml-2 text-sm">
              ({ok.length} elegível{ok.length !== 1 ? 'eis' : ''}{bloq.length > 0 ? ` · ${bloq.length} bloqueado${bloq.length !== 1 ? 's' : ''}` : ''})
            </span>
          </h3>
        </div>
        {ok.length > 0 && (
          <div className="flex gap-3 text-xs">
            <div>
              <span className="text-muted-foreground">Troco potencial:</span>{' '}
              <strong className="font-mono text-green-400">{formatBRL(totalTroco)}</strong>
            </div>
            <div>
              <span className="text-muted-foreground">Redução parcelas:</span>{' '}
              <strong className="font-mono text-green-400">{formatBRL(totalReducao)}</strong>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {lista.map((c, i) => (
          <ContratoCard key={`${c.contrato}-${i}`} c={c} />
        ))}
      </div>
    </div>
  );
}

function ContratoCard({ c }: { c: ContratoCalculado }) {
  const melhor = c.destinos[0];
  const corStatus = c.bloqueado ? 'border-red-500/40 bg-red-500/5' : 'border-green-500/40 bg-green-500/5';

  return (
    <Card className={corStatus}>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm font-semibold">{c.contrato || '(sem nº)'}</span>
              <Badge variant="muted" className="text-[10px] font-mono">{c.bancoOrigem}</Badge>
              {c.taxaOrig > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  taxa atual: <strong className="font-mono">{c.taxaOrig.toFixed(2)}%</strong>
                </span>
              )}
              {c.prazos && <span className="text-[10px] text-muted-foreground">prazo: <span className="font-mono">{c.prazos}</span></span>}
            </div>
            <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
              <span>parcela <strong className="font-mono text-foreground">{formatBRL(c.parcela)}</strong></span>
              <span>saldo <strong className="font-mono text-foreground">{formatBRL(c.saldo)}</strong></span>
            </div>
          </div>
          {!c.bloqueado && c.reducao > 0 && (
            <div className="text-right">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">
                Nova parcela (108m @ 1.50%)
              </div>
              <div className="text-lg font-mono font-bold text-green-400">{formatBRL(c.novaParc)}</div>
              <div className="text-[10px] text-green-400 flex items-center justify-end gap-1">
                <TrendingDown className="size-3" /> reduz {formatBRL(c.reducao)}/mês
              </div>
            </div>
          )}
        </div>

        {c.bloqueado ? (
          <div className="rounded-md bg-red-500/10 border border-red-500/30 p-2 text-xs flex items-center gap-2">
            <AlertCircle className="size-4 text-red-400 shrink-0" />
            <span className="text-red-400">{c.motivoBloqueio}</span>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Bancos destino possíveis
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
              {c.destinos.map((d, i) => {
                const isMelhor = melhor && d.banco === melhor.banco && d.taxa === melhor.taxa;
                return (
                  <div
                    key={`${d.banco}-${i}`}
                    className={`rounded-md border p-2 ${
                      isMelhor
                        ? 'border-green-500/60 bg-green-500/10 ring-1 ring-green-500/30'
                        : 'border-border bg-card/50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <Badge variant={isMelhor ? 'success' : 'outline'} className="text-[10px] font-mono">
                        {d.banco}
                        {isMelhor && ' ⭐'}
                      </Badge>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {d.taxa.toFixed(2)}%
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-[10px]">
                      <div>
                        <div className="text-muted-foreground uppercase tracking-wider font-semibold">Troco</div>
                        <div className="font-mono font-semibold text-green-400">
                          <Banknote className="size-3 inline mr-0.5" />
                          {formatBRL(d.troco)}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground uppercase tracking-wider font-semibold">Vlr Cont.</div>
                        <div className="font-mono font-semibold text-cyan-400">{formatBRL(d.vc)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
