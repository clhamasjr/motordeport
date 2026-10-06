'use client';

// ════════════════════════════════════════════════════════════════════
// Painel da fila de digitação (Baixa Renda)
//
// Mostra o que está na fila conforme o papel de quem olha:
//   vendedor → só o que ele lançou
//   gestor   → tudo da loja dele
//   admin    → tudo
// O backend é quem decide o escopo; aqui só rotulamos.
// ════════════════════════════════════════════════════════════════════

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatCpf } from '@/lib/utils';
import {
  useFilaCrefisa, useStatusFila, useCancelarFila,
  STATUS_FILA_LABEL, type EscopoFila,
} from '@/hooks/use-crefisa-fila';
import { ListChecks, Loader2, X, Clock, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

const ESCOPO_LABEL: Record<EscopoFila, string> = {
  tudo: 'todas as lojas',
  loja: 'sua loja',
  proprio: 'suas propostas',
};

export function FilaPainel() {
  const fila = useFilaCrefisa();
  const status = useStatusFila();
  const cancelar = useCancelarFila();

  const itens = fila.data?.itens || [];
  const escopo = fila.data?.escopo;
  const naFila = itens.filter((i) => i.status === 'NA_FILA').length;
  const horarioFechado = status.data && status.data.horarioAberto === false;

  const remover = async (id: string, cpf: string) => {
    const r = await cancelar.mutateAsync(id).catch(() => null);
    if (r?.success) toast.success(`${formatCpf(cpf)} cancelado`);
  };

  if (fila.isPending) {
    return (
      <Card>
        <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> carregando fila…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        {/* Cabeçalho */}
        <div className="p-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <ListChecks className="size-4 text-emerald-400" />
            <span className="font-medium text-sm">Fila de digitação</span>
            {escopo && (
              <span className="text-[11px] text-muted-foreground">({ESCOPO_LABEL[escopo]})</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {naFila > 0 && <Badge variant="warning">{naFila} aguardando</Badge>}
            {horarioFechado && (
              <Badge variant="muted" className="gap-1">
                <Clock className="w-3 h-3" /> fora do horário
              </Badge>
            )}
          </div>
        </div>

        {horarioFechado && (
          <div className="px-4 py-2 text-[11px] text-muted-foreground border-b border-border">
            A Crefisa só aceita digitação das 7h às 23h. O que está na fila entra automaticamente quando abrir.
          </div>
        )}

        {/* Itens */}
        {itens.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">
            Nada na fila ainda.
          </div>
        ) : (
          <div>
            {itens.map((i) => {
              const b = STATUS_FILA_LABEL[i.status] || STATUS_FILA_LABEL.NA_FILA;
              return (
                <div key={i.id} className="flex items-center justify-between gap-3 py-2.5 px-4 border-b border-border last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-xs font-mono font-medium">{formatCpf(i.cpf)}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {i.nome_cliente || '—'}
                      {/* Só faz sentido mostrar o vendedor pra quem vê mais de um */}
                      {escopo !== 'proprio' && i.vendedor_nome && <> · {i.vendedor_nome}</>}
                    </div>
                    {i.status === 'ERRO' && i.mensagem && (
                      <div className="text-[10px] text-red-400 flex items-center gap-1 mt-0.5">
                        <AlertCircle className="size-3 shrink-0" /> {i.mensagem}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={b.variant} className="gap-1">
                      {i.status === 'PROCESSANDO' && <Loader2 className="w-3 h-3 animate-spin" />}
                      {b.label}
                    </Badge>
                    {i.status === 'NA_FILA' && (
                      <Button
                        size="icon" variant="ghost" className="h-7 w-7"
                        onClick={() => remover(i.id, i.cpf)}
                        disabled={cancelar.isPending}
                        title="Cancelar"
                      >
                        <X className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
