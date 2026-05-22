'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { formatCpf, formatBRL } from '@/lib/utils';
import { useConsultarIN100, In100Error, type In100Result } from '@/hooks/use-inss-in100';
import { Shield, Search, CheckCircle2, AlertCircle, Lock, Unlock, Copy, RotateCw } from 'lucide-react';
import { toast } from 'sonner';

interface ErroEstado {
  message: string;
  step?: string;
  httpStatus?: number;
  rawAjin?: unknown;
  queryId?: string;
}

export default function In100Page() {
  const mut = useConsultarIN100();
  const [cpf, setCpf] = useState('');
  const [beneficio, setBeneficio] = useState('');
  const [result, setResult] = useState<In100Result | null>(null);
  const [erro, setErro] = useState<ErroEstado | null>(null);

  async function consultar(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    setErro(null);
    try {
      const r = await mut.mutateAsync({ cpf, beneficio });
      setResult(r);
    } catch (e) {
      if (e instanceof In100Error) {
        setErro({
          message: e.message, step: e.step, httpStatus: e.httpStatus,
          rawAjin: e.rawAjin, queryId: e.queryId,
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
      toast.error('Falha ao copiar — selecione o JSON manualmente');
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="size-6 text-blue-400" />
          INSS — Consulta IN100 (DataPrev)
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Consulta oficial DataPrev via JoinBank — saldo, margens, status do benefício, bloqueios.
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <form onSubmit={consultar} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">CPF</Label>
              <Input value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" className="font-mono mt-1" required />
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Número do benefício (NB)</Label>
              <Input value={beneficio} onChange={(e) => setBeneficio(e.target.value)} placeholder="123456789" className="font-mono mt-1" required />
            </div>
            <Button type="submit" disabled={mut.isPending}>
              <Search className="size-4" />
              {mut.isPending ? 'Consultando...' : 'Consultar IN100'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* ─── BLOCO DE ERRO ─────────────────────────────────────────── */}
      {erro && !mut.isPending && (
        <Card className="border-red-500/50 bg-red-500/5">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="size-6 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-bold text-red-300">Falha na consulta IN100</div>
                <div className="text-sm mt-1 break-words">{erro.message}</div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {erro.step && (
                    <Badge variant="destructive" className="text-[10px] uppercase">
                      etapa: {erro.step}
                    </Badge>
                  )}
                  {erro.httpStatus && (
                    <Badge variant="muted" className="text-[10px]">HTTP {erro.httpStatus}</Badge>
                  )}
                  {erro.queryId && (
                    <Badge variant="muted" className="text-[10px] font-mono">
                      queryId: {String(erro.queryId).substring(0, 16)}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Contexto */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md border border-border bg-card/50 p-2">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">CPF testado</div>
                <div className="font-mono">{cpf || '—'}</div>
              </div>
              <div className="rounded-md border border-border bg-card/50 p-2">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Benefício (NB)</div>
                <div className="font-mono">{beneficio || '—'}</div>
              </div>
            </div>

            {/* Dicas baseadas no tipo */}
            {erro.step === 'cpf_invalido' && (
              <div className="text-xs text-muted-foreground p-2 rounded bg-muted/30">
                💡 CPF precisa ter 11 dígitos (com ou sem máscara).
              </div>
            )}
            {erro.step === 'beneficio_invalido' && (
              <div className="text-xs text-muted-foreground p-2 rounded bg-muted/30">
                💡 Preencha o número do benefício INSS (NB) antes de consultar.
              </div>
            )}
            {erro.step === 'pending_timeout' && (
              <div className="text-xs text-muted-foreground p-2 rounded bg-muted/30">
                💡 A DATAPREV ficou mais de 90s sem responder. Isso costuma ser instabilidade lá. Tenta de novo em 1-2 minutos.
              </div>
            )}
            {erro.step === 'ajin' && (
              <div className="text-xs text-muted-foreground p-2 rounded bg-muted/30">
                💡 A Ajin/QualiBanking retornou um erro. Motivos comuns: benefício não cadastrado, espécie não habilitada, CPF sem opt-in DATAPREV ainda, bloqueio temporário, ou rate-limit. Veja o detalhe técnico abaixo.
              </div>
            )}

            {/* JSON cru da Ajin */}
            {erro.rawAjin != null && (
              <details className="rounded-md border border-border bg-card/30 p-2" open>
                <summary className="cursor-pointer text-xs font-semibold text-cyan-400">
                  ▸ Detalhe técnico da Ajin (manda isso pro suporte se precisar)
                </summary>
                <pre className="mt-2 p-2 rounded bg-background overflow-x-auto text-[10px] font-mono max-h-96">
                  {JSON.stringify(erro.rawAjin, null, 2)}
                </pre>
              </details>
            )}

            {/* Ações */}
            <div className="flex gap-2 flex-wrap pt-1">
              <Button size="sm" variant="default" onClick={(e) => consultar(e as any)} disabled={mut.isPending}>
                <RotateCw className="size-3.5" /> Tentar de novo
              </Button>
              <Button size="sm" variant="outline" onClick={copiarErro}>
                <Copy className="size-3.5" /> Copiar erro completo
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {result && !erro && (
        <Card className={result.bloqueado ? 'border-red-500/50 bg-red-500/5' : result.elegivel ? 'border-green-500/50 bg-green-500/5' : 'border-yellow-500/50 bg-yellow-500/5'}>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                {result.bloqueado ? <Lock className="size-6 text-red-400" /> : result.elegivel ? <Unlock className="size-6 text-green-400" /> : <AlertCircle className="size-6 text-yellow-400" />}
                <div>
                  <div className="font-bold">{result.nome || '(sem nome)'}</div>
                  <div className="text-xs text-muted-foreground font-mono">
                    CPF {formatCpf(result.cpf || cpf)} · NB {result.beneficio || beneficio}
                  </div>
                </div>
              </div>
              <div className="flex gap-1">
                {result.elegivel && <Badge variant="success" className="text-[10px]">ELEGÍVEL</Badge>}
                {result.bloqueado && <Badge variant="destructive" className="text-[10px]">BLOQUEADO</Badge>}
                {result.benefitStatus && <Badge variant="muted" className="text-[10px]">{result.benefitStatus}</Badge>}
                {result.especie && <Badge variant="info" className="text-[10px]">{result.especie}</Badge>}
              </div>
            </div>

            {result.tipoBlock && (
              <div className="rounded-md bg-red-500/10 border border-red-500/30 p-2 text-xs flex items-center gap-2">
                <AlertCircle className="size-4 text-red-400" />
                <span><strong>Bloqueio:</strong> {result.tipoBlock}</span>
              </div>
            )}

            {/* KPIs financeiros */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              <Kpi label="Margem empréstimo" value={formatBRL(result.margemEmprestimo || 0)} cor="text-green-400" />
              <Kpi label="Margem cartão" value={formatBRL(result.margemCartao || 0)} cor="text-purple-400" />
              <Kpi label="Limite cartão" value={formatBRL(result.limiteCartao || 0)} cor="text-pink-400" />
              <Kpi label="Limite cart. benef." value={formatBRL(result.limiteCartaoBeneficio || 0)} cor="text-orange-400" />
              <Kpi label="Saldo cart. benef." value={formatBRL(result.saldoCartaoBeneficio || 0)} cor="text-cyan-400" />
              <Kpi label="Saldo máx total" value={formatBRL(result.maxSaldo || 0)} cor="text-foreground" />
              <Kpi label="Saldo usado" value={formatBRL(result.saldoUsado || 0)} cor="text-red-400" />
              <Kpi label="Saldo disponível" value={formatBRL(result.saldoDisponivel || 0)} cor="text-green-400" />
            </div>

            {/* Info extra */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
              {result.dataNascimento && (
                <div className="rounded-md bg-card/50 border border-border p-2">
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Nascimento</div>
                  <div className="font-mono">{result.dataNascimento}</div>
                </div>
              )}
              {result.dataConcessao && (
                <div className="rounded-md bg-card/50 border border-border p-2">
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Concessão (DDB)</div>
                  <div className="font-mono">{result.dataConcessao}</div>
                </div>
              )}
              {result.uf && (
                <div className="rounded-md bg-card/50 border border-border p-2">
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">UF</div>
                  <div className="font-mono">{result.uf}</div>
                </div>
              )}
              <div className="rounded-md bg-card/50 border border-border p-2">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Contratos ativos</div>
                <div className="font-mono">{result.contratosAtivos || 0}</div>
              </div>
              <div className="rounded-md bg-card/50 border border-border p-2">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Portabilidades</div>
                <div className="font-mono">{result.portabilidades || 0}</div>
              </div>
              <div className="rounded-md bg-card/50 border border-border p-2">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Repr. legal</div>
                <div className="font-mono">{result.representanteLegal ? 'SIM' : 'NÃO'}</div>
              </div>
            </div>

            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">Ver resposta raw</summary>
              <pre className="mt-2 p-3 bg-muted/30 rounded-md overflow-x-auto text-[10px] max-h-96">
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Kpi({ label, value, cor }: { label: string; value: string; cor: string }) {
  return (
    <div className="rounded-md border border-border bg-card/50 p-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={`text-sm font-mono font-bold mt-0.5 ${cor}`}>{value}</div>
    </div>
  );
}
