'use client';

import { Card, CardContent } from '@/components/ui/card';
import { formatBRL } from '@/lib/utils';
import { SimulacaoContrato } from '@/lib/fed-types';

interface Props {
  simulacao: SimulacaoContrato[];
  /** Mostra coluna extra "Pra enquadrar" se houver estouro de margem */
  estourou?: boolean;
}

export function SimulacaoPortTable({ simulacao, estourou = false }: Props) {
  if (!simulacao || simulacao.length === 0) return null;

  return (
    <Card className="border-yellow-500/40">
      <CardContent className="p-4 space-y-3">
        <div>
          <div className="text-sm font-bold text-yellow-400">
            🔄 Simulação de Portabilidade + Troco — contrato a contrato
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            Saldo devedor calculado assumindo <b>taxa atual de 1,80% a.m.</b> no contrato origem.{' '}
            <b>Troco</b> = capital financiável pelo banco destino (mantendo a parcela atual e o
            prazo total original) menos o saldo devedor de hoje. Top 5 bancos por troco.
            {estourou && (
              <>
                {' '}
                Como há <b className="text-destructive">estouro de margem</b>, a coluna{' '}
                <b>Pra enquadrar</b> mostra a parcela alvo (e o prazo necessário) pra eliminar a
                fatia desse contrato no estouro.
              </>
            )}
          </div>
        </div>

        {simulacao.map((s, i) => {
          const ct = s.contrato;
          return (
            <div key={i} className="rounded-md border border-border bg-background/40 p-3">
              <div className="flex justify-between flex-wrap gap-2 mb-2 text-xs">
                <div>
                  <b>💰 {ct.banco_origem || '?'}</b>{' '}
                  <span className="text-muted-foreground">· {ct.numero || ''}</span>
                </div>
                <div className="text-muted-foreground">
                  Parcela atual: <b className="text-foreground">{formatBRL(ct.parcela_valor)}</b> ·{' '}
                  {ct.parcelas_pagas}/{ct.parcelas_totais} pagas ·{' '}
                  <span title="Saldo devedor real assumindo 1,80% a.m. no contrato origem">
                    saldo devedor (1,80%):{' '}
                    <b className="text-foreground">{formatBRL(ct.saldo_devedor_estimado || 0)}</b>
                  </span>
                </div>
              </div>

              {s.qtd_atendem === 0 ? (
                <div className="text-xs text-muted-foreground bg-destructive/5 rounded p-2">
                  Nenhum banco do convênio recebe port deste contrato (verifique parcelas pagas
                  mínimas).
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="text-left text-muted-foreground text-[10px] uppercase tracking-wider">
                        <th className="px-1.5 py-1">Banco destino</th>
                        <th className="px-1.5 py-1 text-right">Taxa</th>
                        <th
                          className="px-1.5 py-1 text-right"
                          title="Capital que o banco destino financia mantendo a parcela atual no prazo total"
                        >
                          Novo PV
                        </th>
                        <th
                          className="px-1.5 py-1 text-right"
                          title="Troco = Novo PV − Saldo devedor. Sai pra conta do cliente"
                        >
                          💵 Troco
                        </th>
                        <th
                          className="px-1.5 py-1 text-right"
                          title="Alternativa: port pura, mantém prazo restante e reduz a parcela mensal"
                        >
                          Port pura (parcela)
                        </th>
                        {estourou && (
                          <th
                            className="px-1.5 py-1 text-right"
                            title="Parcela alvo + prazo necessário pra eliminar a fatia desse contrato no estouro de margem"
                          >
                            🎯 Pra enquadrar
                          </th>
                        )}
                        <th className="px-1.5 py-1"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.sugestoes_top.map((sg, j) => {
                        const tr = sg.troco_estimado;
                        const ppura = sg.parcela_port_pura;
                        return (
                          <tr
                            key={j}
                            className={
                              'border-b border-dashed border-border/70 ' +
                              (sg.atende ? '' : 'opacity-50')
                            }
                          >
                            <td className="px-1.5 py-1.5 font-semibold">{sg.banco_nome}</td>
                            <td className="px-1.5 py-1.5 text-right">
                              {sg.taxa_minima_port != null
                                ? `${(sg.taxa_minima_port * 100).toFixed(2).replace('.', ',')}%`
                                : '—'}
                            </td>
                            <td className="px-1.5 py-1.5 text-right">
                              {sg.novo_pv_refin != null ? formatBRL(sg.novo_pv_refin) : '—'}
                            </td>
                            <td className="px-1.5 py-1.5 text-right">
                              {tr == null ? (
                                '—'
                              ) : tr > 0 ? (
                                <span className="text-green-400 font-bold">+ {formatBRL(tr)}</span>
                              ) : (
                                <span className="text-destructive">{formatBRL(tr)}</span>
                              )}
                            </td>
                            <td className="px-1.5 py-1.5 text-right">
                              {ppura != null ? (
                                <>
                                  {formatBRL(ppura)}{' '}
                                  <span className="text-green-400 text-[10px]">
                                    (↓{formatBRL(ct.parcela_valor - ppura)})
                                  </span>
                                </>
                              ) : (
                                '—'
                              )}
                            </td>
                            {estourou && (
                              <td className="px-1.5 py-1.5 text-right">
                                {sg.parcela_alvo_enquadramento != null && sg.prazo_enquadrar_meses != null ? (
                                  <>
                                    <div className={sg.enquadra ? '' : 'text-destructive'}>
                                      {formatBRL(sg.parcela_alvo_enquadramento)}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground">
                                      em {Math.ceil(sg.prazo_enquadrar_meses)}x
                                      {!sg.enquadra && ' (não cabe)'}
                                    </div>
                                  </>
                                ) : (
                                  '—'
                                )}
                              </td>
                            )}
                            <td className="px-1.5 py-1.5 text-[10px] text-muted-foreground">
                              {sg.atende
                                ? '✓'
                                : '⛔ ' + (sg.motivos_bloqueio || []).join('; ')}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {s.total_sugestoes > s.sugestoes_top.length && (
                    <div className="text-[10px] text-muted-foreground mt-1.5">
                      + {s.total_sugestoes - s.sugestoes_top.length} outros bancos do convênio (não
                      exibidos no top 5).
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        <div className="text-[10px] text-muted-foreground">
          ⚠ Taxa origem assumida: <b>1,80% a.m.</b>. Se a taxa real do contrato origem for diferente,
          o saldo devedor (e o troco) muda. IOF, seguro e tarifas não incluídos no troco bruto.
        </div>
      </CardContent>
    </Card>
  );
}
