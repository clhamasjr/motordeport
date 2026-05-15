'use client';

import { BaseUpload } from '@/components/inss/base-upload';
import { ElegiveisTable } from '@/components/inss/elegiveis-table';
import { Card, CardContent } from '@/components/ui/card';
import { useInssBaseStore } from '@/hooks/use-inss-base-store';
import { Sparkles, FileSpreadsheet, TrendingUp } from 'lucide-react';
import { formatBRL } from '@/lib/utils';

export default function HigienizacaoInssPage() {
  const { base } = useInssBaseStore();

  // KPIs gerais da base (não dos filtrados)
  const totalTroco = base ? base.elegiveis.reduce((s, e) => s + (e.troco || 0), 0) : 0;
  const totalVC = base ? base.elegiveis.reduce((s, e) => s + (e.vc || 0), 0) : 0;
  const clientesElegiveis = base ? new Set(base.elegiveis.map((e) => e.cpf)).size : 0;

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="size-6 text-pink-400" />
          INSS — Higienização (Base XLSX)
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Suba uma planilha do extrato consignado, o motor processa e mostra os clientes elegíveis
          pra portabilidade — com taxa, troco, parcela reduzida e enquadramento na regra de 45%.
        </p>
      </div>

      <BaseUpload />

      {base && (
        <>
          {/* KPIs da base completa */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Card>
              <CardContent className="p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Total na base
                </div>
                <div className="text-2xl font-mono font-bold mt-1">{base.analise.length}</div>
                <div className="text-[10px] text-muted-foreground">contratos lidos</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Elegíveis
                </div>
                <div className="text-2xl font-mono font-bold mt-1 text-green-400">
                  {base.elegiveis.length}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {clientesElegiveis} clientes únicos
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Troco total potencial
                </div>
                <div className="text-base font-mono font-bold mt-1 text-green-400">
                  {formatBRL(totalTroco)}
                </div>
                <div className="text-[10px] text-muted-foreground">soma dos trocos</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Volume de contratos
                </div>
                <div className="text-base font-mono font-bold mt-1 text-cyan-400">
                  {formatBRL(totalVC)}
                </div>
                <div className="text-[10px] text-muted-foreground">soma dos VCs novos</div>
              </CardContent>
            </Card>
          </div>

          {/* Resumo por banco destino */}
          {base.mapaArr.length > 0 && (
            <Card>
              <CardContent className="p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                  <TrendingUp className="size-3 inline mr-1" />
                  Distribuição por banco destino
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {base.mapaArr.map((m) => (
                    <div
                      key={m.banco}
                      className="rounded-md border border-border p-2 bg-card/50"
                    >
                      <div className="text-xs font-bold">{m.banco}</div>
                      <div className="text-xs text-muted-foreground">
                        <strong className="text-foreground">{m.n}</strong> contratos
                      </div>
                      <div className="text-[10px] text-green-400 font-mono">
                        troco: {formatBRL(m.total)}
                      </div>
                      <div className="text-[10px] text-cyan-400 font-mono">
                        VC: {formatBRL(m.vcTotal)}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tabela completa com filtros */}
          <ElegiveisTable />
        </>
      )}

      {!base && (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <FileSpreadsheet className="size-12 mx-auto mb-2 opacity-30" />
            <div className="text-sm">
              Carregue uma base acima pra ver a análise + tabela de elegíveis.
            </div>
            <div className="text-xs mt-2">
              O motor roda 100% client-side — nenhum dado é enviado pra servidor.
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
