'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { formatBRL } from '@/lib/utils';
import { useConsultarIN100, In100Error, type In100Result } from '@/hooks/use-inss-in100';
import { FileSearch, Download, AlertCircle, CheckCircle2, Copy, RotateCw } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  cpf: string;
  beneficio?: string;
  /** Se true, renderiza como botão pequeno na toolbar */
  compact?: boolean;
}

interface ErroEstado {
  message: string;
  step?: string;
  httpStatus?: number;
  rawAjin?: unknown;
  queryId?: string;
}

/**
 * Botão IN100 — consulta DATAPREV via JoinBank.
 * Mostra elegibilidade, margens, contratos, bloqueios.
 */
export function In100Button({ cpf, beneficio, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<In100Result | null>(null);
  const [erro, setErro] = useState<ErroEstado | null>(null);
  const mut = useConsultarIN100();

  const disabled = !cpf || !beneficio;

  async function consultar() {
    if (!cpf || !beneficio) return;
    setOpen(true);
    setData(null);
    setErro(null);
    try {
      const r = await mut.mutateAsync({ cpf, beneficio });
      setData(r);
    } catch (e) {
      // Captura erro estruturado pra mostrar na UI (não só toast)
      if (e instanceof In100Error) {
        setErro({
          message: e.message,
          step: e.step,
          httpStatus: e.httpStatus,
          rawAjin: e.rawAjin,
          queryId: e.queryId,
        });
      } else if (e instanceof Error) {
        setErro({ message: e.message });
      } else {
        setErro({ message: 'Erro desconhecido' });
      }
    }
  }

  async function copiarErro() {
    if (!erro) return;
    const txt = JSON.stringify({
      cpf, beneficio,
      timestamp: new Date().toISOString(),
      ...erro,
    }, null, 2);
    try {
      await navigator.clipboard.writeText(txt);
      toast.success('Erro copiado pra área de transferência');
    } catch {
      toast.error('Falha ao copiar — selecione o JSON manualmente abaixo');
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

          {mut.isPending && !data && !erro && (
            <div className="text-center py-10">
              <div className="text-3xl mb-2 animate-pulse">🔍</div>
              <div className="text-sm text-muted-foreground">Consultando DATAPREV...</div>
              <div className="text-[10px] text-muted-foreground mt-1">Pode levar até 90s se a DATAPREV estiver lenta.</div>
            </div>
          )}

          {/* ─── BLOCO DE ERRO ────────────────────────────────────────── */}
          {erro && !mut.isPending && (
            <div className="space-y-3">
              <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="size-5 text-red-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-red-300 text-sm">Falha na consulta IN100</div>
                    <div className="text-xs mt-1 text-foreground/90 break-words">{erro.message}</div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {erro.step && (
                        <Badge variant="destructive" className="text-[9px] uppercase">
                          etapa: {erro.step}
                        </Badge>
                      )}
                      {erro.httpStatus && (
                        <Badge variant="muted" className="text-[9px]">HTTP {erro.httpStatus}</Badge>
                      )}
                      {erro.queryId && (
                        <Badge variant="muted" className="text-[9px] font-mono">
                          queryId: {String(erro.queryId).substring(0, 12)}...
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Contexto */}
              <div className="text-xs grid grid-cols-2 gap-2">
                <div className="rounded-md border border-border bg-card/50 p-2">
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">CPF testado</div>
                  <div className="font-mono">{cpf || '—'}</div>
                </div>
                <div className="rounded-md border border-border bg-card/50 p-2">
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Benefício (NB)</div>
                  <div className="font-mono">{beneficio || '—'}</div>
                </div>
              </div>

              {/* Resposta crua da Ajin pra debug */}
              {erro.rawAjin != null && (
                <details className="rounded-md border border-border bg-card/30 p-2" open>
                  <summary className="cursor-pointer text-xs font-semibold text-cyan-400">
                    ▸ Detalhe técnico da Ajin (mande isso pro suporte se precisar)
                  </summary>
                  <pre className="mt-2 p-2 rounded bg-background overflow-x-auto text-[10px] font-mono max-h-72">
                    {JSON.stringify(erro.rawAjin, null, 2)}
                  </pre>
                </details>
              )}

              {/* Ações de erro */}
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="default" onClick={consultar} disabled={mut.isPending}>
                  <RotateCw className="size-3.5" /> Tentar de novo
                </Button>
                <Button size="sm" variant="outline" onClick={copiarErro}>
                  <Copy className="size-3.5" /> Copiar erro
                </Button>
              </div>

              {/* Dicas baseadas no tipo de erro */}
              {erro.step === 'cpf_invalido' && (
                <div className="text-[11px] text-muted-foreground p-2 rounded bg-muted/30">
                  💡 CPF precisa ter 11 dígitos (com ou sem máscara).
                </div>
              )}
              {erro.step === 'beneficio_invalido' && (
                <div className="text-[11px] text-muted-foreground p-2 rounded bg-muted/30">
                  💡 Preencha o número do benefício INSS (NB) antes de consultar.
                </div>
              )}
              {erro.step === 'pending_timeout' && (
                <div className="text-[11px] text-muted-foreground p-2 rounded bg-muted/30">
                  💡 A DATAPREV ficou mais de 90s sem responder. Isso costuma ser instabilidade lá. Tenta de novo em 1-2 minutos.
                </div>
              )}
              {erro.step === 'ajin' && (
                <div className="text-[11px] text-muted-foreground p-2 rounded bg-muted/30">
                  💡 A Ajin/QualiBanking retornou um erro. Os motivos mais comuns: benefício não cadastrado, espécie não habilitada, CPF sem opt-in DATAPREV ainda, ou bloqueio temporário.
                </div>
              )}
            </div>
          )}

          {data && !erro && (
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
