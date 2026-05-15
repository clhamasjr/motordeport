'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCpf, formatBRL } from '@/lib/utils';
import { ConsultaInssView } from '@/lib/inss-types';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';

interface Props {
  cpf: string;
  view: ConsultaInssView;
  onClose: () => void;
}

// helper: parse BR string ("1.234,56") → number, ou aceita number direto
function pn(v: unknown): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v);
  if (s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
  return parseFloat(s) || 0;
}

export function ConsultaResultado({ cpf, view, onClose }: Props) {
  const { parsed, enquadramento } = view;
  const b = parsed.beneficiario || {};
  const ben = parsed.beneficio || {};
  const mrg = parsed.margem || {};

  const enqStatus = enquadramento?.compStatus;
  const enqCor =
    enqStatus === 'dentro_regra'
      ? 'border-green-500/50 bg-green-500/5'
      : enqStatus === 'fora_regra_resolvivel'
      ? 'border-yellow-500/50 bg-yellow-500/5'
      : enqStatus === 'fora_regra_inviavel'
      ? 'border-destructive/50 bg-destructive/5'
      : 'border-border';

  return (
    <Card className={enqCor}>
      <CardContent className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold truncate">{b.nome || '(sem nome)'}</h2>
              {ben.situacao && (
                <Badge variant={ben.situacao.toUpperCase() === 'ATIVO' ? 'success' : 'muted'} className="text-[10px]">
                  {ben.situacao}
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
              <span className="font-mono">CPF {formatCpf(cpf)}</span>
              {b.nb && <span className="font-mono">NB {b.nb}</span>}
              {ben.especie && <span>{ben.especie}</span>}
              {b.idade && <span>{b.idade} anos</span>}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Fechar">
            <X className="size-4" />
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <Kpi label="Valor benefício" value={formatBRL(pn(ben.valor))} cor="text-cyan-400" />
          <Kpi label="Base cálculo" value={formatBRL(pn(ben.base_calculo))} cor="text-cyan-400" />
          <Kpi label="Parcelas emp." value={formatBRL(pn(mrg.parcelas))} cor="text-red-400" />
          <Kpi label="Margem livre" value={formatBRL(pn(mrg.disponivel))} cor="text-green-400" />
          <Kpi label="RMC livre" value={formatBRL(pn(mrg.rmc))} cor="text-purple-400" />
          <Kpi label="RCC livre" value={formatBRL(pn(mrg.rcc))} cor="text-pink-400" />
        </div>

        {/* Enquadramento (regra atual 35+5+5=45%) */}
        {enquadramento && (
          <div className={`rounded-lg border p-3 ${enqCor}`}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                {enqStatus === 'dentro_regra' ? (
                  <CheckCircle2 className="size-5 text-green-400" />
                ) : (
                  <AlertTriangle className="size-5 text-yellow-400" />
                )}
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Enquadramento — regra atual 45%
                  </div>
                  <div className="text-sm font-semibold">
                    {enqStatus === 'dentro_regra'
                      ? '✅ Dentro da regra (≤ 45%)'
                      : '⚠ Extrapolando — precisa refin'}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Comprometimento
                </div>
                <div className={`text-2xl font-mono font-bold ${enqStatus === 'dentro_regra' ? 'text-green-400' : 'text-red-400'}`}>
                  {enquadramento.compPct}% <span className="text-sm text-muted-foreground">/ 45%</span>
                </div>
                <div className="text-[10px] text-muted-foreground font-mono">
                  {formatBRL(enquadramento.total)} de {formatBRL(enquadramento.teto45)}
                </div>
              </div>
            </div>
            {enquadramento.excedente > 0 && (
              <div className="mt-2 text-xs text-red-400">
                Excedente: <strong className="font-mono">{formatBRL(enquadramento.excedente)}</strong>
              </div>
            )}
          </div>
        )}

        {/* Contratos */}
        {parsed.contratos && parsed.contratos.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
              Contratos ({parsed.contratos.length})
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="text-left p-2 font-semibold">Contrato</th>
                    <th className="text-left p-2 font-semibold">Banco</th>
                    <th className="text-right p-2 font-semibold">Parcela</th>
                    <th className="text-right p-2 font-semibold">Saldo</th>
                    <th className="text-right p-2 font-semibold">Taxa</th>
                    <th className="text-left p-2 font-semibold">Prazos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {parsed.contratos.map((c, i) => (
                    <tr key={i} className="hover:bg-muted/20">
                      <td className="p-2 font-mono">{c.contrato || '—'}</td>
                      <td className="p-2">{c.banco || c.banco_codigo || '—'}</td>
                      <td className="p-2 text-right font-mono">{formatBRL(pn(c.parcela))}</td>
                      <td className="p-2 text-right font-mono">{formatBRL(pn(c.saldo || c.saldo_quitacao))}</td>
                      <td className="p-2 text-right font-mono">{c.taxa ? c.taxa + '%' : '—'}</td>
                      <td className="p-2 font-mono">{c.prazos || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Cartões */}
        {parsed.cartoes && parsed.cartoes.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
              Cartões ({parsed.cartoes.length})
            </div>
            <div className="flex flex-wrap gap-2">
              {parsed.cartoes.map((c, i) => (
                <Badge key={i} variant="muted" className="text-xs py-1 px-2">
                  {c.tipo || '?'} · {c.banco || '?'} ·{' '}
                  <span className="font-mono ml-1">{formatBRL(pn(c.margem))}</span>
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Telefones */}
        {parsed.telefones && parsed.telefones.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
              Telefones ({parsed.telefones.length})
            </div>
            <div className="flex flex-wrap gap-2 font-mono text-xs">
              {parsed.telefones.slice(0, 6).map((t, i) => (
                <Badge key={i} variant="outline" className="py-1">
                  ({t.ddd}) {t.numero}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Kpi({ label, value, cor }: { label: string; value: string; cor: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={`text-base font-mono font-bold mt-0.5 ${cor}`}>{value}</div>
    </div>
  );
}
