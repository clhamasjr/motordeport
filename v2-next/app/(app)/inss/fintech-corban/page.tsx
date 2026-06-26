'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { formatCpf } from '@/lib/utils';
import {
  useFintechTest, useFintechTabelas, useFintechSaldoInss,
} from '@/hooks/use-fintech-corban';
import {
  Landmark, Search, CheckCircle2, AlertCircle, RefreshCw, Loader2, BookOpen,
} from 'lucide-react';

export default function FintechCorbanInssPage() {
  const [cpfRaw, setCpfRaw] = useState('');
  const test = useFintechTest();
  const tabelas = useFintechTabelas();
  const saldo = useFintechSaldoInss();

  const cpfValido = cpfRaw.replace(/\D/g, '').length === 11;
  const t = tabelas.data;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Landmark className="size-6 text-cyan-400" />
          INSS — Fintech do Corban
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Consignado INSS via Fintech do Corban (QI Tech). As tabelas de INSS (regras: produto, taxa,
          prazo) vêm da plataforma deles e são marcadas com &quot;INSS&quot; no nome.
        </p>
      </div>

      {/* Status da conexão */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-sm">Status da conexão</h2>
            <Button size="sm" variant="outline" onClick={() => test.mutate('qi')} disabled={test.isPending}>
              {test.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Testar conexão
            </Button>
          </div>
          {test.data ? (
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
                    Configure a <code className="font-mono">FINTECH_API_KEY_PRD</code> no Vercel e redeploye.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Clique em &quot;Testar conexão&quot; pra validar a chave de API.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Tabelas / Regras INSS */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-sm flex items-center gap-1.5">
              <BookOpen className="size-4 text-purple-400" /> Tabelas (regras) de INSS
            </h2>
            <Button size="sm" variant="outline" onClick={() => tabelas.mutate('inss')} disabled={tabelas.isPending}>
              {tabelas.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Ver tabelas INSS
            </Button>
          </div>
          {t && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                <strong className="text-foreground">{t.tabelasInss ?? 0}</strong> tabela(s) INSS encontrada(s)
                {typeof t.total === 'number' && <> de {t.total} no total</>}.
              </div>
              {(t.tabelas || []).length === 0 ? (
                <div className="text-xs text-yellow-400 rounded-md border border-yellow-500/40 bg-yellow-500/5 p-2">
                  Nenhuma tabela INSS retornada. Verifique se a chave tem produto INSS habilitado na Fintech do Corban.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/30">
                      <tr>
                        <th className="text-left p-2 font-semibold">Tabela (nome)</th>
                        <th className="text-right p-2 font-semibold">ID Tabela</th>
                        <th className="text-right p-2 font-semibold">ID Produto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(t.tabelas || []).map((tb, i) => (
                        <tr key={`${tb.idTabela}-${i}`} className={tb.isInss ? 'bg-cyan-500/5' : ''}>
                          <td className="p-2">
                            {tb.nome || '(sem nome)'}
                            {tb.isInss && <Badge variant="info" className="text-[9px] ml-1.5">INSS</Badge>}
                          </td>
                          <td className="p-2 text-right font-mono">{tb.idTabela ?? '—'}</td>
                          <td className="p-2 text-right font-mono">{tb.idProduto ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Consulta de margem INSS */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <h2 className="font-bold text-sm">Consultar margem do benefício (CPF)</h2>
          <form
            onSubmit={(e) => { e.preventDefault(); if (cpfValido) saldo.mutate(cpfRaw); }}
            className="flex flex-wrap items-end gap-3"
          >
            <div className="flex-1 min-w-[200px]">
              <Label htmlFor="cpf" className="text-xs uppercase tracking-wider text-muted-foreground">CPF do beneficiário</Label>
              <Input
                id="cpf"
                value={cpfRaw.replace(/\D/g, '').length === 11 ? formatCpf(cpfRaw) : cpfRaw}
                onChange={(e) => setCpfRaw(e.target.value.replace(/\D/g, '').slice(0, 11))}
                placeholder="000.000.000-00"
                inputMode="numeric"
                className="font-mono mt-1"
              />
            </div>
            <Button type="submit" disabled={!cpfValido || saldo.isPending}>
              {saldo.isPending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              Consultar margem
            </Button>
          </form>
          {saldo.data && (
            <div className="space-y-2">
              <div className="text-xs">
                Status da consulta: <Badge variant="muted" className="text-[10px]">{saldo.data.statusConsulta || '—'}</Badge>
                {saldo.data.httpStatus != null && <span className="text-muted-foreground ml-2">HTTP {saldo.data.httpStatus}</span>}
              </div>
              <details className="text-xs" open>
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground py-1">Resposta da API</summary>
                <pre className="mt-1 bg-muted/30 p-3 rounded-md overflow-x-auto max-h-80 text-[10px]">
                  {JSON.stringify(saldo.data._raw ?? saldo.data, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
