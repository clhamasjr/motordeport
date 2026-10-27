'use client';

import { Card, CardContent } from '@/components/ui/card';
import { formatBRL } from '@/lib/utils';
import {
  ContratoAtivo,
  ExtratoConsistencia,
  SecaoConsistencia,
  tipoContratoIcone,
  tipoContratoLabel,
} from '@/lib/fed-types';

interface Props {
  contratos: ContratoAtivo[];
  erro?: string | null;
  /** Conferência soma das parcelas lidas × total utilizado impresso no extrato (por seção) */
  consistencia?: ExtratoConsistencia | null;
  /** True quando o sistema releu o extrato porque a 1ª leitura não bateu */
  releitura?: boolean;
}

const NOME_SECAO: Record<string, string> = { emprestimo: 'Empréstimos', rmc: 'RMC', rcc: 'RCC' };

export function TabelaContratos({ contratos, erro, consistencia, releitura }: Props) {
  const emp = contratos.filter((c) => c.tipo === 'emprestimo');
  const rmc = contratos.filter((c) => c.tipo === 'rmc');
  const rcc = contratos.filter((c) => c.tipo === 'rcc');

  const secoes = consistencia ? (Object.entries(consistencia) as [string, SecaoConsistencia][]) : [];
  const divergentes = secoes.filter(([, s]) => s && s.ok === false);
  const conferidas = secoes.filter(([, s]) => s && s.ok === true);

  return (
    <Card className="border-cyan-500/30">
      <CardContent className="p-4 space-y-3">
        <div>
          <div className="text-sm font-bold text-cyan-400">📋 Extrato de Consignação</div>
          {!erro && contratos.length > 0 && (
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {contratos.length} contrato(s) ativos: <b>{emp.length}</b> empréstimo
              · <b>{rmc.length}</b> RMC · <b>{rcc.length}</b> RCC
            </div>
          )}
        </div>

        {erro && (
          <div className="text-xs text-destructive bg-destructive/10 rounded p-2.5">
            ⚠ Erro ao ler extrato: {erro}
          </div>
        )}

        {/* Conferência: soma das parcelas lidas × total utilizado impresso */}
        {divergentes.length > 0 && (
          <div className="text-xs text-destructive bg-destructive/10 rounded p-2.5 space-y-1">
            <div className="font-semibold">⚠ Leitura do extrato não bate com o total impresso</div>
            {divergentes.map(([tipo, s]) => (
              <div key={tipo}>
                {NOME_SECAO[tipo] || tipo}: soma das parcelas lidas <b>{formatBRL(s.soma)}</b> × utilizado no
                extrato <b>{formatBRL(s.informado ?? 0)}</b> (diferença {formatBRL(Math.abs(s.diferenca ?? 0))})
              </div>
            ))}
            <div className="text-muted-foreground">
              Provável parcela lida com dígito a mais ou a menos (ex.: 33,69 → 333,69)
              {releitura ? ' — já houve uma releitura automática e ainda não bateu' : ''}. O enquadramento usa o{' '}
              <b>total impresso</b>; confira a tabela abaixo antes de digitar.
            </div>
          </div>
        )}
        {divergentes.length === 0 && conferidas.length > 0 && (
          <div className="text-[11px] text-green-500">
            ✓ Soma das parcelas conferida com o total utilizado impresso no extrato
            {releitura ? ' (corrigida por releitura automática)' : ''}.
          </div>
        )}

        {!erro && contratos.length === 0 && (
          <div className="text-xs text-muted-foreground">Nenhum contrato extraído.</div>
        )}

        {contratos.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-muted-foreground text-[10px] uppercase tracking-wider">
                  <th className="px-2 py-1.5 border-b border-border">Tipo</th>
                  <th className="px-2 py-1.5 border-b border-border">Banco</th>
                  <th className="px-2 py-1.5 border-b border-border">Contrato</th>
                  <th className="px-2 py-1.5 border-b border-border text-right">Parcela</th>
                  <th className="px-2 py-1.5 border-b border-border text-center">Pagas/Total</th>
                  <th className="px-2 py-1.5 border-b border-border text-right">Saldo (sem juros)</th>
                  <th className="px-2 py-1.5 border-b border-border">Fim</th>
                </tr>
              </thead>
              <tbody>
                {contratos.map((c, i) => (
                  <tr key={i} className="border-b border-dashed border-border/70">
                    <td className="px-2 py-2">
                      {tipoContratoIcone(c.tipo)} {tipoContratoLabel(c.tipo)}
                    </td>
                    <td className="px-2 py-2 font-semibold">{c.banco_extrato || '—'}</td>
                    <td className="px-2 py-2 font-mono text-[10px] text-muted-foreground">
                      {c.numero || '—'}
                    </td>
                    <td className="px-2 py-2 text-right">{formatBRL(c.parcela_valor)}</td>
                    <td className="px-2 py-2 text-center">
                      {c.parcelas_pagas || 0}/{c.parcelas_totais || 0}
                    </td>
                    <td className="px-2 py-2 text-right">{formatBRL(c.saldo_estimado)}</td>
                    <td className="px-2 py-2 text-[10px] text-muted-foreground">
                      {(c.fim || '').slice(0, 7)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-[10px] text-muted-foreground mt-2">
              ⚠ Saldo sem juros = parcela × parcelas restantes (teto). O saldo devedor real (com taxa
              1,80%) está calculado abaixo, na simulação de port.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
