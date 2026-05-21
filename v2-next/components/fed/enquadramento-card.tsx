'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatBRL } from '@/lib/utils';
import { Enquadramento } from '@/lib/fed-types';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

interface Props {
  enquadramento: Enquadramento;
}

export function EnquadramentoCard({ enquadramento: e }: Props) {
  const estourou = e.estourou;
  const tetoPctLabel = `${(e.teto_pct * 100).toFixed(0)}%`;
  const pctConsumidoLabel = `${(e.pct_consumido * 100).toFixed(1)}%`;

  return (
    <Card className={estourou ? 'border-destructive/50' : 'border-green-500/30'}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 font-bold text-sm">
            {estourou ? (
              <>
                <AlertTriangle className="w-4 h-4 text-destructive" />
                <span className="text-destructive">⚠ Margem estourada</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span className="text-green-500">Margem dentro do teto</span>
              </>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            Teto {tetoPctLabel} · consumido {pctConsumidoLabel}
          </div>
        </div>

        {/* KPIs principais */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <KPI label="Salário bruto" valor={formatBRL(e.salario_bruto)} />
          <KPI label={`Teto (${tetoPctLabel})`} valor={formatBRL(e.teto_valor)} />
          <KPI
            label="Total consignado"
            valor={formatBRL(e.total_consignado)}
            cor={estourou ? 'text-destructive' : 'text-foreground'}
          />
          {estourou && (
            <KPI
              label="💥 Estouro"
              valor={'+ ' + formatBRL(e.valor_estouro)}
              cor="text-destructive font-bold"
            />
          )}
          {!estourou && (
            <KPI
              label="Folga"
              valor={formatBRL(Math.max(0, e.teto_valor - e.total_consignado))}
              cor="text-green-500"
            />
          )}
        </div>

        {/* Quebra dos consignados */}
        <div className="grid grid-cols-3 gap-2 text-xs pt-2 border-t border-border">
          <Quebra
            label="Empréstimos"
            valor={e.pmt_emprestimos}
            qtd={e.qtd_emprestimos}
            pctSalario={e.salario_bruto > 0 ? e.pmt_emprestimos / e.salario_bruto : 0}
          />
          <Quebra
            label="RMC (cartão crédito)"
            valor={e.pmt_rmc}
            ativo={e.tem_rmc}
            pctSalario={e.salario_bruto > 0 ? e.pmt_rmc / e.salario_bruto : 0}
          />
          <Quebra
            label="RCC (cartão benefício)"
            valor={e.pmt_rcc}
            ativo={e.tem_rcc}
            pctSalario={e.salario_bruto > 0 ? e.pmt_rcc / e.salario_bruto : 0}
          />
        </div>

        {/* Mensagem explicativa */}
        {estourou ? (
          <div className="rounded-md bg-destructive/10 p-3 text-xs space-y-1">
            <div className="font-semibold text-destructive">
              Como reenquadrar: port com REDUÇÃO de parcela
            </div>
            <div className="text-muted-foreground">
              A margem teto baixou pra {tetoPctLabel}. Pra encaixar tudo, é preciso{' '}
              <b>reduzir as parcelas dos empréstimos em ~{formatBRL(e.valor_estouro)}</b> no total
              (rateado entre os {e.qtd_emprestimos} contrato(s)). Veja a coluna{' '}
              <b>“Pra enquadrar”</b> na simulação de port abaixo — mostra qual a parcela alvo de
              cada contrato e em qual prazo cabe.
            </div>
            {e.tem_ambos_cartoes && (
              <div className="text-muted-foreground pt-1">
                💳 Cliente tem RMC + RCC averbados (5% + 5% = 10% reservado).
                Margem útil pra empréstimo:{' '}
                <b className="text-foreground">{formatBRL(e.margem_util_emprestimo_valor)}</b>.
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            {e.tem_ambos_cartoes
              ? `Cliente tem RMC + RCC averbados (5% + 5% reservados). Margem útil pra empréstimo: ${formatBRL(e.margem_util_emprestimo_valor)}.`
              : 'Não há ambos cartões averbados — todos os 40% disponíveis pra empréstimo.'}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KPI({ label, valor, cor }: { label: string; valor: string; cor?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-bold text-base mt-0.5 ${cor || 'text-foreground'}`}>{valor}</div>
    </div>
  );
}

function Quebra({
  label,
  valor,
  qtd,
  ativo,
  pctSalario,
}: {
  label: string;
  valor: number;
  qtd?: number;
  ativo?: boolean;
  pctSalario: number;
}) {
  const presente = valor > 0 || ativo || (qtd ?? 0) > 0;
  return (
    <div className={presente ? '' : 'opacity-50'}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        {label}
        {qtd != null && qtd > 0 && (
          <Badge variant="muted" className="text-[9px] px-1">
            {qtd}x
          </Badge>
        )}
      </div>
      <div className="font-semibold mt-0.5">
        {valor > 0 ? (
          <>
            {formatBRL(valor)}{' '}
            <span className="text-[10px] text-muted-foreground">
              ({(pctSalario * 100).toFixed(1)}%)
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
    </div>
  );
}
