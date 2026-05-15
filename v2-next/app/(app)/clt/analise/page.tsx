'use client';

import { useState } from 'react';
import { useAnalisarCltCliente, AnaliseFiltros } from '@/hooks/use-clt-analise';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatBRL } from '@/lib/utils';
import { Target, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronRight } from 'lucide-react';

export default function AnaliseClienteCltPage() {
  const [f, setF] = useState<AnaliseFiltros & { _operacao?: string }>({ operacao: 'novo' });
  const [verNaoAtendem, setVerNaoAtendem] = useState(false);
  const analisar = useAnalisarCltCliente();

  const r = analisar.data;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    analisar.mutate({
      idade: f.idade,
      dataNascimento: f.dataNascimento,
      margem: f.margem,
      valor: f.valor,
      prazo: f.prazo,
      tempo_admissao_meses: f.tempo_admissao_meses,
      operacao: f.operacao,
    });
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Target className="w-6 h-6 text-primary" /> CLT — Análise de Cliente
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Entre os parâmetros do cliente e veja quais bancos atendem (e por que os outros não).
        </p>
      </div>

      {/* Form */}
      <Card>
        <CardContent className="p-4">
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-2">
              <Field label="Idade">
                <Input type="number" placeholder="45" value={f.idade ?? ''}
                  onChange={(e) => setF({ ...f, idade: e.target.value ? parseInt(e.target.value) : undefined })} />
              </Field>
              <Field label="Ou Data Nasc">
                <Input type="date" value={f.dataNascimento ?? ''}
                  onChange={(e) => setF({ ...f, dataNascimento: e.target.value || undefined })} />
              </Field>
              <Field label="Margem (parcela)">
                <Input type="number" placeholder="250" value={f.margem ?? ''}
                  onChange={(e) => setF({ ...f, margem: e.target.value ? parseFloat(e.target.value) : undefined })} />
              </Field>
              <Field label="Valor solicitado">
                <Input type="number" placeholder="5000" value={f.valor ?? ''}
                  onChange={(e) => setF({ ...f, valor: e.target.value ? parseFloat(e.target.value) : undefined })} />
              </Field>
              <Field label="Prazo (parcelas)">
                <Input type="number" placeholder="60" value={f.prazo ?? ''}
                  onChange={(e) => setF({ ...f, prazo: e.target.value ? parseInt(e.target.value) : undefined })} />
              </Field>
              <Field label="Tempo casa (meses)">
                <Input type="number" placeholder="24" value={f.tempo_admissao_meses ?? ''}
                  onChange={(e) => setF({ ...f, tempo_admissao_meses: e.target.value ? parseInt(e.target.value) : undefined })} />
              </Field>
              <Field label="Operação">
                <select value={f.operacao || 'novo'}
                  onChange={(e) => setF({ ...f, operacao: e.target.value as 'novo' | 'refin' | 'port' | 'cartao' })}
                  className="h-10 px-3 text-sm rounded-md border border-input bg-background w-full">
                  <option value="novo">Novo</option>
                  <option value="refin">Refinanciamento</option>
                  <option value="port">Portabilidade</option>
                  <option value="cartao">Cartão</option>
                </select>
              </Field>
            </div>
            <div className="flex justify-end pt-1">
              <Button type="submit" disabled={analisar.isPending} className="gap-2">
                {analisar.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
                Analisar bancos
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Resultado */}
      {r && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Kpi label="Total bancos" valor={r.total_bancos} />
            <Kpi label="✅ Atendem" valor={r.atendem_count} cor="text-green-400" border="border-green-500/30" />
            <Kpi label="❌ Não atendem" valor={r.nao_atendem_count} cor="text-red-400" border="border-red-500/30" />
          </div>

          {/* Atendem */}
          {r.atendem.length > 0 && (
            <Card className="border-green-500/30">
              <CardContent className="p-4">
                <div className="text-sm font-bold text-green-400 mb-3 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  {r.atendem.length} banco(s) atendem este cliente
                </div>
                <div className="space-y-2">
                  {r.atendem.map((b) => (
                    <div key={b.banco_id} className="bg-background/50 border border-border rounded-md p-3">
                      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                        <div className="font-bold text-sm">{b.banco_nome}</div>
                        <div className="flex gap-1 flex-wrap">
                          {b.exige_selfie && <Badge variant="warning" className="text-[10px]">📸 Selfie</Badge>}
                          {b.exige_termo && <Badge variant="muted" className="text-[10px]">📝 Termo</Badge>}
                          <Badge variant="success" className="text-[10px]">{b.api_status}</Badge>
                        </div>
                      </div>
                      <div className="text-[11px] text-muted-foreground space-y-0.5">
                        {(b.regras.idade_min || b.regras.idade_max) && (
                          <div>Idade {b.regras.idade_min || '?'}-{b.regras.idade_max || '?'}</div>
                        )}
                        {b.regras.margem_minima && <div>Margem mín {formatBRL(b.regras.margem_minima)}</div>}
                        {(b.regras.valor_minimo || b.regras.valor_maximo) && (
                          <div>Valor {formatBRL(b.regras.valor_minimo || 0)} - {formatBRL(b.regras.valor_maximo || 0)}</div>
                        )}
                        {(b.regras.prazo_min || b.regras.prazo_max) && (
                          <div>{b.regras.prazo_min || 0}x - {b.regras.prazo_max || '?'}x</div>
                        )}
                        {b.regras.tempo_admissao_min_meses && <div>{b.regras.tempo_admissao_min_meses}m+ casa</div>}
                      </div>
                      {b.documentos.length > 0 && (
                        <div className="text-[11px] mt-2 text-muted-foreground/90">
                          📄 {b.documentos.join(' · ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Não atendem (collapsable) */}
          {r.nao_atendem.length > 0 && (
            <Card>
              <CardContent className="p-3">
                <button
                  onClick={() => setVerNaoAtendem((v) => !v)}
                  className="w-full flex items-center gap-2 text-xs font-bold text-muted-foreground hover:text-foreground"
                >
                  {verNaoAtendem ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  <XCircle className="w-3 h-3 text-destructive" />
                  {r.nao_atendem.length} banco(s) NÃO atendem
                  <span className="text-[10px] text-muted-foreground/70 ml-1">(clique pra ver motivo)</span>
                </button>
                {verNaoAtendem && (
                  <div className="mt-3 space-y-1">
                    {r.nao_atendem.map((b) => (
                      <div key={b.banco_slug} className="bg-background/50 rounded p-2 text-xs flex flex-wrap gap-2">
                        <b className="text-foreground">{b.banco_nome}</b>
                        <span className="text-destructive">— {b.motivo}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {analisar.isError && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 text-sm text-destructive">
            Erro: {(analisar.error as Error).message}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Kpi({ label, valor, cor, border }: { label: string; valor: string | number; cor?: string; border?: string }) {
  return (
    <Card className={border}>
      <CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`text-2xl font-black ${cor || ''}`}>
          {typeof valor === 'number' ? valor.toLocaleString('pt-BR') : valor}
        </div>
      </CardContent>
    </Card>
  );
}
