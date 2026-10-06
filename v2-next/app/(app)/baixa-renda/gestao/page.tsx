'use client';

// ════════════════════════════════════════════════════════════════════
// Baixa Renda — Produção da loja (visão do gestor)
//
// Gestor vê os vendedores da loja dele; admin vê todas. Vendedor comum
// não entra aqui (o backend recusa com 403 e o menu esconde).
//
// Os números saem da fila de digitação: é o que de fato foi mandado pra
// Crefisa. O que ainda está na fila não entra na taxa de êxito, senão o
// número oscilaria só por causa do tempo de espera.
// ════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatBRL } from '@/lib/utils';
import { useProducaoCrefisa, type ProducaoVendedor } from '@/hooks/use-crefisa-fila';
import { ApiError } from '@/lib/api';
import { BarChart3, Loader2, AlertCircle, Trophy, TrendingUp } from 'lucide-react';

const PERIODOS = [
  { dias: 1, label: 'Hoje' },
  { dias: 7, label: '7 dias' },
  { dias: 30, label: '30 dias' },
  { dias: 90, label: '90 dias' },
];

function Tile({ label, valor, destaque = false, sufixo = '' }: { label: string; valor: string | number; destaque?: boolean; sufixo?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[10px] uppercase text-muted-foreground tracking-wide">{label}</div>
        <div className={`text-xl font-bold mt-0.5 ${destaque ? 'text-primary' : ''}`}>
          {valor}{sufixo}
        </div>
      </CardContent>
    </Card>
  );
}

function LinhaVendedor({ v, lider }: { v: ProducaoVendedor; lider: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 px-4 border-b border-border last:border-b-0">
      <div className="min-w-0 flex items-center gap-2">
        {lider && v.digitadas > 0 && <Trophy className="size-3.5 text-yellow-500 shrink-0" />}
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{v.vendedor}</div>
          <div className="text-[11px] text-muted-foreground">
            {v.propostas} proposta{v.propostas === 1 ? '' : 's'}
            {v.naFila > 0 && <> · {v.naFila} na fila</>}
            {v.erros > 0 && <span className="text-red-400"> · {v.erros} com erro</span>}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4 shrink-0">
        {v.taxaExito !== null && (
          <div className="text-right hidden sm:block">
            <div className={`text-sm font-medium ${v.taxaExito >= 80 ? 'text-green-400' : v.taxaExito >= 50 ? 'text-yellow-500' : 'text-red-400'}`}>
              {v.taxaExito}%
            </div>
            <div className="text-[9px] text-muted-foreground uppercase">êxito</div>
          </div>
        )}
        <div className="text-right">
          <div className="text-sm font-bold text-primary">{formatBRL(v.valorDigitado)}</div>
          <div className="text-[9px] text-muted-foreground uppercase">{v.digitadas} digitada{v.digitadas === 1 ? '' : 's'}</div>
        </div>
      </div>
    </div>
  );
}

export default function BaixaRendaGestaoPage() {
  const [dias, setDias] = useState(30);
  const producao = useProducaoCrefisa(dias);

  const semPermissao = producao.error instanceof ApiError && producao.error.status === 403;
  const d = producao.data;
  const vendedores = d?.vendedores || [];

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart3 className="size-6 text-emerald-400" /> Produção — Baixa Renda
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {d?.escopo === 'tudo' ? 'Todas as lojas.' : 'Sua loja.'} O que foi efetivamente
          mandado pra digitação na Crefisa.
        </p>
      </div>

      {/* Período */}
      <div className="flex gap-1 flex-wrap">
        {PERIODOS.map((p) => (
          <Button
            key={p.dias}
            size="sm"
            variant={dias === p.dias ? 'default' : 'outline'}
            onClick={() => setDias(p.dias)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      {semPermissao && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-500 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5" /> Essa visão é do gestor da loja.
        </div>
      )}

      {producao.isPending && (
        <Card><CardContent className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> carregando produção…
        </CardContent></Card>
      )}

      {d && (
        <>
          {/* Totais */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile label="Digitadas" valor={d.total.digitadas} destaque />
            <Tile label="Valor digitado" valor={formatBRL(d.total.valorDigitado)} />
            <Tile label="Taxa de êxito" valor={d.total.taxaExito ?? '—'} sufixo={d.total.taxaExito !== null ? '%' : ''} />
            <Tile label="Ticket médio" valor={formatBRL(d.total.ticketMedio)} />
          </div>

          {(d.total.naFila > 0 || d.total.erros > 0) && (
            <div className="flex gap-2 flex-wrap">
              {d.total.naFila > 0 && <Badge variant="warning">{d.total.naFila} aguardando digitação</Badge>}
              {d.total.erros > 0 && <Badge variant="destructive">{d.total.erros} com erro</Badge>}
              {d.total.canceladas > 0 && <Badge variant="muted">{d.total.canceladas} canceladas</Badge>}
            </div>
          )}

          {/* Por vendedor */}
          <Card>
            <CardContent className="p-0">
              <div className="p-4 border-b border-border flex items-center gap-2">
                <TrendingUp className="size-4 text-emerald-400" />
                <span className="font-medium text-sm">Por vendedor</span>
                <span className="text-[11px] text-muted-foreground">({vendedores.length})</span>
              </div>
              {vendedores.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground text-center">
                  Nenhuma proposta nesse período.
                </div>
              ) : (
                vendedores.map((v, i) => (
                  <LinhaVendedor key={v.userId ?? v.vendedor} v={v} lider={i === 0} />
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
