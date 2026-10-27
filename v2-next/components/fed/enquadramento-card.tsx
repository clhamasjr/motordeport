'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatBRL } from '@/lib/utils';
import { Enquadramento } from '@/lib/fed-types';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

interface Props {
  enquadramento: Enquadramento;
}

const pct = (v: number | undefined, casas = 0) => `${((v ?? 0) * 100).toFixed(casas)}%`;

/**
 * Card de enquadramento de margem (análise de contracheque federal).
 * Regra vigente desde 02/09/2026 (fim da MP 1.355): CIVIL = 35% empréstimos + 5% RMC + 5% RCC,
 * cada fatia com o seu teto; MILITAR = teto global 70%. Análises antigas (sem `modelo`)
 * caem no layout genérico com os campos legados.
 */
export function EnquadramentoCard({ enquadramento: e }: Props) {
  const estourou = e.estourou;
  const fatias = e.modelo === 'fatias';
  const tetoEmpValor = e.teto_emprestimo_valor ?? e.margem_util_emprestimo_valor;
  const tetoEmpPct = e.teto_emprestimo_pct ?? (e.salario_bruto > 0 ? tetoEmpValor / e.salario_bruto : 0);
  const estouroEmp = e.valor_estouro_emprestimo ?? e.valor_estouro;
  const estouroRmc = e.valor_estouro_rmc ?? 0;
  const estouroRcc = e.valor_estouro_rcc ?? 0;
  const estouroCartoes = e.valor_estouro_cartoes ?? 0;
  const folgaEmp = e.margem_livre_emprestimo ?? Math.max(0, tetoEmpValor - e.pmt_emprestimos);
  const pctSal = (v: number) => (e.salario_bruto > 0 ? v / e.salario_bruto : 0);

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
            Teto total {pct(e.teto_pct)} · consumido {pct(e.pct_consumido, 1)}
          </div>
        </div>

        {/* KPIs principais */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <KPI label="Salário bruto" valor={formatBRL(e.salario_bruto)} />
          <KPI label={`Teto empréstimos (${pct(tetoEmpPct)})`} valor={formatBRL(tetoEmpValor)} />
          <KPI
            label="Empréstimos averbados"
            valor={formatBRL(e.pmt_emprestimos)}
            cor={estouroEmp > 0 ? 'text-destructive' : 'text-foreground'}
          />
          {estouroEmp > 0 ? (
            <KPI label="💥 Estouro empréstimos" valor={'+ ' + formatBRL(estouroEmp)} cor="text-destructive font-bold" />
          ) : (
            <KPI label="Folga pra novo empréstimo" valor={formatBRL(folgaEmp)} cor="text-green-500" />
          )}
        </div>

        {/* Fatias: uso × limite */}
        <div className="grid grid-cols-3 gap-2 text-xs pt-2 border-t border-border">
          <Fatia
            label="Empréstimos"
            usado={e.pmt_emprestimos}
            limite={tetoEmpValor}
            limitePct={tetoEmpPct}
            qtd={e.qtd_emprestimos}
            estouro={estouroEmp}
            pctSalario={pctSal(e.pmt_emprestimos)}
          />
          <Fatia
            label="RMC (cartão crédito)"
            usado={e.pmt_rmc}
            limite={e.limite_rmc_valor}
            limitePct={fatias ? 0.05 : undefined}
            ativo={e.tem_rmc}
            estouro={estouroRmc}
            pctSalario={pctSal(e.pmt_rmc)}
          />
          <Fatia
            label="RCC (cartão benefício)"
            usado={e.pmt_rcc}
            limite={e.limite_rcc_valor}
            limitePct={fatias ? 0.05 : undefined}
            ativo={e.tem_rcc}
            estouro={estouroRcc}
            pctSalario={pctSal(e.pmt_rcc)}
          />
        </div>

        {/* Mensagem explicativa */}
        {estourou ? (
          <div className="rounded-md bg-destructive/10 p-3 text-xs space-y-1">
            {estouroEmp > 0 && (
              <>
                <div className="font-semibold text-destructive">
                  Como reenquadrar: port com REDUÇÃO de parcela
                </div>
                <div className="text-muted-foreground">
                  Os empréstimos passam do teto da fatia ({pct(tetoEmpPct)} = {formatBRL(tetoEmpValor)}). Pra
                  encaixar, é preciso{' '}
                  <b>reduzir as parcelas dos empréstimos em ~{formatBRL(estouroEmp)}</b> no total (rateado entre
                  os {e.qtd_emprestimos} contrato(s)). Veja a coluna <b>“Pra enquadrar”</b> na simulação de port
                  abaixo — mostra a parcela alvo de cada contrato e em qual prazo cabe
                  {e.prazo_max_parcelas ? ` (até ${e.prazo_max_parcelas} parcelas)` : ''}.
                </div>
              </>
            )}
            {estouroCartoes > 0 && (
              <div className="text-muted-foreground">
                💳 Cartão acima do limite:{' '}
                {estouroRmc > 0 && <>RMC +{formatBRL(estouroRmc)} </>}
                {estouroRcc > 0 && <>RCC +{formatBRL(estouroRcc)}</>}
                {!fatias && estouroRmc === 0 && estouroRcc === 0 && <>+{formatBRL(estouroCartoes)}</>}
                {' '}— port não resolve cartão; precisa reduzir ou cancelar o cartão no banco emissor.
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            Empréstimos dentro da fatia de {pct(tetoEmpPct)} ({formatBRL(tetoEmpValor)}) — folga de{' '}
            <b className="text-foreground">{formatBRL(folgaEmp)}</b> pra novo empréstimo.
            {fatias && ' Cartões têm fatia própria (5% RMC + 5% RCC) e não consomem a margem de empréstimo.'}
          </div>
        )}

        {e.fonte_totais === 'extrato_impresso' && (
          <div className="text-[11px] text-yellow-500">
            ⚠ Totais tirados do quadro de margens impresso no extrato — a soma das parcelas lidas não bateu
            (veja o aviso no extrato acima).
          </div>
        )}
        <div className="text-[10px] text-muted-foreground">
          Regra: {e.regra_descricao || (fatias ? '35% empréstimos + 5% RMC + 5% RCC' : `teto global de ${pct(e.teto_pct)}`)}
        </div>
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

function Fatia({
  label,
  usado,
  limite,
  limitePct,
  qtd,
  ativo,
  estouro,
  pctSalario,
}: {
  label: string;
  usado: number;
  limite?: number;
  limitePct?: number;
  qtd?: number;
  ativo?: boolean;
  estouro?: number;
  pctSalario: number;
}) {
  const presente = usado > 0 || ativo || (qtd ?? 0) > 0;
  const acima = (estouro ?? 0) > 0;
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
      <div className={`font-semibold mt-0.5 ${acima ? 'text-destructive' : ''}`}>
        {usado > 0 ? (
          <>
            {formatBRL(usado)}{' '}
            <span className="text-[10px] text-muted-foreground">({(pctSalario * 100).toFixed(1)}%)</span>
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
      {limite != null && (
        <div className="text-[10px] text-muted-foreground">
          limite {limitePct != null ? `${(limitePct * 100).toFixed(0)}% = ` : ''}
          {formatBRL(limite)}
          {acima && <span className="text-destructive"> · +{formatBRL(estouro ?? 0)}</span>}
        </div>
      )}
    </div>
  );
}
