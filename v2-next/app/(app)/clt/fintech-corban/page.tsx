'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { formatCpf } from '@/lib/utils';
import {
  useFintechTest, useFintechConsultarCPF, useFintechEnviarLink,
  type FintechProvider,
} from '@/hooks/use-fintech-corban';
import {
  Building2, Search, CheckCircle2, AlertCircle, Send, RefreshCw, Loader2,
} from 'lucide-react';

export default function FintechCorbanPage() {
  const [provider, setProvider] = useState<FintechProvider>('qi');
  const [cpfRaw, setCpfRaw] = useState('');

  const test = useFintechTest();
  const consulta = useFintechConsultarCPF();
  const enviarLink = useFintechEnviarLink();

  const cpfValido = cpfRaw.replace(/\D/g, '').length === 11;
  const res = consulta.data;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Building2 className="size-6 text-cyan-400" />
          CLT — Fintech do Corban
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Consignado privado CLT via Fintech do Corban (QI Tech / Celcoin). Consulta de margem,
          autorização e simulação. As tabelas/regras (taxa, prazo, valor) vêm da plataforma do Fintech do Corban.
        </p>
      </div>

      {/* Seletor de bancarizadora */}
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Bancarizadora:</span>
        {(['qi', 'celcoin'] as FintechProvider[]).map((p) => (
          <button
            key={p}
            onClick={() => setProvider(p)}
            className={`text-xs px-3 py-1.5 rounded-md font-semibold transition ${
              provider === p
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'bg-muted/30 text-muted-foreground hover:bg-muted/50 border border-transparent'
            }`}
          >
            {p === 'qi' ? 'QI Tech' : 'Celcoin'}
          </button>
        ))}
      </div>

      {/* Status da conexão */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-sm">Status da conexão</h2>
            <Button size="sm" variant="outline" onClick={() => test.mutate(provider)} disabled={test.isPending}>
              {test.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Testar conexão
            </Button>
          </div>
          {test.data && (
            <div className={`rounded-md border p-3 text-sm flex items-start gap-2 ${
              test.data.success ? 'border-green-500/40 bg-green-500/5' : 'border-red-500/40 bg-red-500/5'
            }`}>
              {test.data.success
                ? <CheckCircle2 className="size-5 text-green-400 shrink-0 mt-0.5" />
                : <AlertCircle className="size-5 text-red-400 shrink-0 mt-0.5" />}
              <div>
                <div className={`font-semibold ${test.data.success ? 'text-green-400' : 'text-red-400'}`}>
                  {test.data.mensagem}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Ambiente: <strong>{test.data.ambiente || '—'}</strong>
                  {test.data.httpStatus != null && <> · HTTP {test.data.httpStatus}</>}
                </div>
                {!test.data.success && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Configure a <code className="font-mono">FINTECH_API_KEY_PRD</code> no Vercel e refaça o deploy.
                  </div>
                )}
              </div>
            </div>
          )}
          {!test.data && (
            <p className="text-xs text-muted-foreground">
              Clique em &quot;Testar conexão&quot; pra validar a chave de API do Fintech do Corban.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Consulta por CPF */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <h2 className="font-bold text-sm">Consultar trabalhador (CPF)</h2>
          <form
            onSubmit={(e) => { e.preventDefault(); if (cpfValido) consulta.mutate({ cpf: cpfRaw, provider }); }}
            className="flex flex-wrap items-end gap-3"
          >
            <div className="flex-1 min-w-[200px]">
              <Label htmlFor="cpf" className="text-xs uppercase tracking-wider text-muted-foreground">CPF</Label>
              <Input
                id="cpf"
                value={cpfRaw.replace(/\D/g, '').length === 11 ? formatCpf(cpfRaw) : cpfRaw}
                onChange={(e) => setCpfRaw(e.target.value.replace(/\D/g, '').slice(0, 11))}
                placeholder="000.000.000-00"
                inputMode="numeric"
                className="font-mono mt-1"
              />
            </div>
            <Button type="submit" disabled={!cpfValido || consulta.isPending}>
              {consulta.isPending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              Consultar
            </Button>
          </form>

          {res && (
            <div className="space-y-3">
              {res.encontrado ? (
                <div className="rounded-md border border-green-500/40 bg-green-500/5 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="size-5 text-green-400" />
                    <span className="font-semibold text-green-400">
                      Trabalhador encontrado ({res.registros} registro{res.registros !== 1 ? 's' : ''})
                    </span>
                    <Badge variant="muted" className="text-[10px]">{provider === 'qi' ? 'QI Tech' : 'Celcoin'}</Badge>
                  </div>
                  {res.dados && typeof res.dados === 'object' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      {Object.entries(res.dados)
                        .filter(([, v]) => v != null && typeof v !== 'object')
                        .slice(0, 16)
                        .map(([k, v]) => (
                          <div key={k} className="flex justify-between gap-2 border-b border-border/40 py-1">
                            <span className="text-muted-foreground">{k}</span>
                            <span className="text-right font-mono truncate" title={String(v)}>{String(v)}</span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="size-5 text-yellow-400 shrink-0" />
                    <div className="flex-1">
                      <div className="font-semibold text-yellow-400">Sem autorização ativa pra este CPF</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Envie o link de autorização (SMS) pro cliente liberar a consulta da margem.
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => enviarLink.mutate({ cpf: cpfRaw, provider })}
                      disabled={enviarLink.isPending}
                      className="bg-cyan-600 hover:bg-cyan-700 text-white shrink-0"
                    >
                      {enviarLink.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                      Enviar link
                    </Button>
                  </div>
                </div>
              )}

              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground py-1">
                  Ver resposta completa da API (debug)
                </summary>
                <pre className="mt-1 bg-muted/30 p-3 rounded-md overflow-x-auto max-h-80 text-[10px]">
                  {JSON.stringify(res._raw ?? res, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
