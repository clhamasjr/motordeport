'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { formatCpf, formatBRL } from '@/lib/utils';
import { useConsultarIN100, type In100Result } from '@/hooks/use-inss-in100';
import { Shield, Search, CheckCircle2, AlertCircle, Lock, Unlock } from 'lucide-react';

export default function In100Page() {
  const mut = useConsultarIN100();
  const [cpf, setCpf] = useState('');
  const [beneficio, setBeneficio] = useState('');
  const [result, setResult] = useState<In100Result | null>(null);

  async function consultar(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await mut.mutateAsync({ cpf, beneficio });
      setResult(r);
    } catch { /* toast no hook */ }
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

      {result && (
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
