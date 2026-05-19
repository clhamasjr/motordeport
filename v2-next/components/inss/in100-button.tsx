'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { formatBRL } from '@/lib/utils';
import { useConsultarIN100, type In100Result } from '@/hooks/use-inss-in100';
import { FileSearch, Download, AlertCircle, CheckCircle2 } from 'lucide-react';

interface Props {
  cpf: string;
  beneficio?: string;
  /** Se true, renderiza como botão pequeno na toolbar */
  compact?: boolean;
}

/**
 * Botão IN100 — consulta DATAPREV via JoinBank.
 * Mostra elegibilidade, margens, contratos, bloqueios.
 */
export function In100Button({ cpf, beneficio, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<In100Result | null>(null);
  const mut = useConsultarIN100();

  const disabled = !cpf || !beneficio;

  async function consultar() {
    if (!cpf || !beneficio) return;
    setOpen(true);
    setData(null);
    try {
      const r = await mut.mutateAsync({ cpf, beneficio });
      setData(r);
    } catch {
      // toast tratado no hook
    }
  }

  function baixarJson() {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `in100_${cpf}_${beneficio || 'sem-nb'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <>
      <Button
        variant="outline"
        size={compact ? 'sm' : 'default'}
        onClick={consultar}
        disabled={disabled || mut.isPending}
        title={disabled ? 'CPF e benefício obrigatórios' : 'Consulta DATAPREV via JoinBank'}
        className="border-purple-500/40 text-purple-300 hover:bg-purple-500/10"
      >
        <FileSearch className="size-4" />
        {mut.isPending ? 'IN100...' : 'IN100'}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSearch className="size-5 text-purple-400" />
              IN100 — DATAPREV
            </DialogTitle>
            <DialogDescription>
              Consulta oficial DATAPREV via JoinBank — margens reais, bloqueios, contratos.
            </DialogDescription>
          </DialogHeader>

          {mut.isPending && !data && (
            <div className="text-center py-10">
              <div className="text-3xl mb-2 animate-pulse">🔍</div>
              <div className="text-sm text-muted-foreground">Consultando DATAPREV...</div>
            </div>
          )}

          {data && (
            <div className="space-y-3">
              {/* Header com nome + status */}
              <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-border">
                <div>
                  <div className="text-base font-bold">{data.nome || '—'}</div>
                  <div className="text-xs text-muted-foreground font-mono">CPF {cpf} · NB {beneficio}</div>
                </div>
                <Badge
                  variant={data.elegivel ? 'success' : 'destructive'}
                  className="text-xs"
                >
                  {data.elegivel ? <CheckCircle2 className="size-3" /> : <AlertCircle className="size-3" />}
                  {data.elegivel ? 'ELEGÍVEL' : data.benefitStatus || 'NÃO ELEGÍVEL'}
                </Badge>
              </div>

              {/* Grid de campos */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <CampoIN100 label="Espécie" value={data.especie || '—'} />
                <CampoIN100 label="Status" value={data.status || '—'} />
                <CampoIN100
                  label="Bloqueio"
                  value={data.bloqueado ? `🚫 ${data.tipoBlock || 'Bloqueado'}` : '✅ Livre'}
                  cor={data.bloqueado ? 'text-red-400' : 'text-green-400'}
                />
                <CampoIN100
                  label="Margem Empréstimo"
                  value={formatBRL(data.margemEmprestimo || 0)}
                  cor="text-green-400"
                />
                <CampoIN100
                  label="Margem Cartão"
                  value={formatBRL(data.margemCartao || 0)}
                  cor="text-cyan-400"
                />
                <CampoIN100
                  label="Limite Cartão"
                  value={formatBRL(data.limiteCartao || 0)}
                  cor="text-purple-400"
                />
                <CampoIN100
                  label="Contratos Ativos"
                  value={`${data.contratosAtivos || 0} ativ. · ${data.contratosSuspensos || 0} susp.`}
                />
                <CampoIN100
                  label="Portabilidades"
                  value={String(data.portabilidades || 0)}
                />
                <CampoIN100
                  label="UF / Nascimento"
                  value={`${data.uf || '—'} / ${data.dataNascimento || '—'}`}
                />
                {data.dataConcessao && (
                  <CampoIN100 label="DDB" value={data.dataConcessao} mono />
                )}
                {data.representanteLegal !== undefined && (
                  <CampoIN100
                    label="Rep. Legal"
                    value={data.representanteLegal ? 'SIM' : 'NÃO'}
                    cor={data.representanteLegal ? 'text-yellow-400' : 'text-muted-foreground'}
                  />
                )}
                {data.saldoDisponivel != null && (
                  <CampoIN100
                    label="Saldo Cartão Disp."
                    value={formatBRL(data.saldoDisponivel)}
                    cor="text-purple-400"
                  />
                )}
              </div>

              {/* JSON expand pra debug */}
              <details className="rounded-md border border-border bg-card/30 p-2">
                <summary className="cursor-pointer text-xs font-semibold text-cyan-400">
                  ▸ Ver JSON completo (raw)
                </summary>
                <pre className="mt-2 p-2 rounded bg-background overflow-x-auto text-[10px] font-mono">
                  {JSON.stringify(data, null, 2)}
                </pre>
              </details>
            </div>
          )}

          <DialogFooter className="flex sm:justify-between gap-2">
            <div className="flex gap-2">
              {data && (
                <Button variant="outline" size="sm" onClick={baixarJson}>
                  <Download className="size-3.5" />
                  Baixar JSON
                </Button>
              )}
            </div>
            <Button variant="outline" onClick={() => setOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CampoIN100({
  label, value, cor, mono,
}: {
  label: string; value: string; cor?: string; mono?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-card/50 p-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={`text-sm font-bold mt-0.5 ${cor || 'text-foreground'} ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}
