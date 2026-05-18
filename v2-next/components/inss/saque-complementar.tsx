'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatBRL } from '@/lib/utils';
import { useConsultarSaqueComplementar, type CartaoSaque, type SaqueComplementarResponse } from '@/hooks/use-saque-complementar';
import { Banknote, AlertCircle, CheckCircle2 } from 'lucide-react';

interface Props {
  cpf: string;
  matricula?: string;
}

export function SaqueComplementar({ cpf, matricula }: Props) {
  const [result, setResult] = useState<SaqueComplementarResponse | null>(null);
  const mut = useConsultarSaqueComplementar();

  async function consultar() {
    try {
      const r = await mut.mutateAsync({ cpf, matricula });
      setResult(r);
    } catch {
      // toast no hook
    }
  }

  // Resumo: total saque disponível
  const totalSaque = result?.cartoes?.reduce((s, c) => s + (c.limiteSaqueDisp || 0), 0) || 0;
  const cartoesComSaque = result?.cartoes?.filter((c) => c.limiteSaqueDisp > 0) || [];

  if (!result) {
    return (
      <Card className="border-purple-500/30 bg-purple-500/5">
        <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <Banknote className="size-8 text-purple-400 shrink-0" />
            <div className="min-w-0">
              <div className="font-semibold">💳 Saque Complementar</div>
              <div className="text-xs text-muted-foreground">
                Consulta cartões existentes do cliente (BMG, Daycoval) e mostra limite disponível pra saque
              </div>
            </div>
          </div>
          <Button onClick={consultar} disabled={mut.isPending} size="sm" variant="outline">
            {mut.isPending ? 'Consultando...' : '💳 Consultar saque'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (mut.isPending) {
    return <Skeleton className="h-32" />;
  }

  return (
    <Card className="border-purple-500/40 bg-purple-500/5">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Banknote className="size-6 text-purple-400" />
            <div>
              <div className="font-semibold">💳 Saque Complementar</div>
              <div className="text-xs text-muted-foreground">
                {result.fontes?.length || 0} fonte(s) consultada(s) ·{' '}
                <strong className="text-foreground">{result.cartoes?.length || 0}</strong> cartão/cartões encontrado(s)
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {totalSaque > 0 && (
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Saque total disponível
                </div>
                <div className="text-xl font-mono font-bold text-green-400">{formatBRL(totalSaque)}</div>
              </div>
            )}
            <Button onClick={consultar} disabled={mut.isPending} size="sm" variant="ghost">
              🔄
            </Button>
          </div>
        </div>

        {result.errors && result.errors.length > 0 && (
          <div className="rounded-md bg-yellow-500/10 border border-yellow-500/30 p-2 text-xs flex items-start gap-2">
            <AlertCircle className="size-4 text-yellow-500 shrink-0 mt-0.5" />
            <div className="text-yellow-500">
              <strong>Alguns bancos falharam:</strong>
              <ul className="mt-0.5 list-disc list-inside">
                {result.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {!result.cartoes || result.cartoes.length === 0 ? (
          <div className="rounded-md bg-card/50 border border-border p-4 text-center text-sm text-muted-foreground">
            Nenhum cartão encontrado para esse CPF nos bancos consultados.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Cartões encontrados ({result.cartoes.length}
              {cartoesComSaque.length > 0 && ` · ${cartoesComSaque.length} com saque disponível`})
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {result.cartoes.map((c, i) => (
                <CartaoCard key={i} cartao={c} />
              ))}
            </div>
          </div>
        )}

        {result.telefones && result.telefones.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
              Telefones cadastrados nos cartões ({result.telefones.length})
            </div>
            <div className="flex flex-wrap gap-1 font-mono text-xs">
              {result.telefones.slice(0, 6).map((t, i) => (
                <Badge key={i} variant="outline" className="py-1 text-[10px]">
                  ({t.ddd}) {t.telefone}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CartaoCard({ cartao: c }: { cartao: CartaoSaque }) {
  const temSaque = c.limiteSaqueDisp > 0;
  const corBorda = temSaque ? 'border-green-500/40 bg-green-500/5' : 'border-border bg-card/50';
  return (
    <div className={`rounded-md border ${corBorda} p-3 space-y-2`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="muted" className="text-[10px] font-mono">{c.banco}</Badge>
          {c.fonte && c.fonte !== c.banco && (
            <span className="text-[9px] text-muted-foreground">via {c.fonte}</span>
          )}
          {c.statusCartao && (
            <Badge variant={c.statusCartao.toUpperCase().includes('ATIVO') ? 'success' : 'warning'} className="text-[9px]">
              {c.statusCartao}
            </Badge>
          )}
        </div>
        {temSaque ? (
          <CheckCircle2 className="size-4 text-green-400" />
        ) : (
          <span className="text-[10px] text-muted-foreground">sem saque</span>
        )}
      </div>
      {c.produto && <div className="text-xs text-muted-foreground">{c.produto}</div>}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Kpi label="Saque disponível" value={c.limiteSaqueDisp} highlight={temSaque} />
        <Kpi label="Limite total saque" value={c.limiteSaqueTotal} />
        <Kpi label="Limite cartão" value={c.limiteCartao} />
        <Kpi label="Saldo devedor" value={c.saldoDevedor} negative />
      </div>
      {c.observacao && (
        <div className="text-[10px] text-muted-foreground italic">↳ {c.observacao}</div>
      )}
    </div>
  );
}

function Kpi({ label, value, highlight, negative }: { label: string; value: number; highlight?: boolean; negative?: boolean }) {
  const cor = highlight ? 'text-green-400' : negative ? 'text-red-400' : 'text-foreground';
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={`font-mono font-semibold ${cor}`}>{formatBRL(value)}</div>
    </div>
  );
}
