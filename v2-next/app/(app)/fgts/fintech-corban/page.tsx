'use client';

// ════════════════════════════════════════════════════════════════════
// FGTS — Fintech do Corban (QI SCD + J17)
//
// A antecipação via Fintech do Corban roda nas bancarizadoras QI SCD e
// J17. ANTES de consultar, o cliente precisa LIBERAR AS DUAS no app
// FGTS da Caixa (menu Autorizações). Esta tela consulta o saldo nas
// duas em paralelo e mostra o status de cada uma.
// ════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { formatCpf } from '@/lib/utils';
import { useFintechFgtsSaldo, useFintechFgtsTabelas } from '@/hooks/use-fgts';
import {
  Landmark, Search, Loader2, RefreshCw, BookOpen, CheckCircle2,
  AlertCircle, Smartphone, Copy,
} from 'lucide-react';
import { toast } from 'sonner';

// Instrução pro cliente liberar as instituições no app FGTS.
// Texto pronto pra copiar e mandar no WhatsApp.
const TEXTO_LIBERACAO = `Pra gente consultar seu saldo do FGTS, você precisa autorizar no app FGTS da Caixa (leva 2 minutos):

1. Abra o app FGTS (da Caixa)
2. Confirme que o SAQUE-ANIVERSÁRIO está ativo (menu "Saque-aniversário do FGTS")
3. Vá em "Autorizar bancos a consultarem seu FGTS"
4. Autorize estas duas instituições:
   • QI SOCIEDADE DE CRÉDITO DIRETO S.A.
   • J17 SOCIEDADE DE CRÉDITO DIRETO S.A.

Depois me avisa que eu já te passo a simulação! 😊`;

export default function FgtsFintechCorbanPage() {
  const [cpfRaw, setCpfRaw] = useState('');
  const saldo = useFintechFgtsSaldo();
  const tabelas = useFintechFgtsTabelas();

  const cpfValido = cpfRaw.replace(/\D/g, '').length === 11;
  const t = tabelas.data;

  const copiarInstrucao = () => {
    navigator.clipboard.writeText(TEXTO_LIBERACAO).then(
      () => toast.success('Instrução copiada — cola no WhatsApp do cliente'),
      () => toast.error('Não consegui copiar'),
    );
  };

  // Interpreta o status de cada consulta pra exibição amigável
  const statusInfo = (statusConsulta?: string | null, ok?: boolean) => {
    const s = String(statusConsulta || '').toLowerCase();
    if (/complet|success|conclu|ok/.test(s)) return { cor: 'success' as const, texto: statusConsulta || 'concluída', liberado: true };
    if (/pend|process|aguard|wait/.test(s)) return { cor: 'info' as const, texto: statusConsulta || 'pendente', liberado: false };
    if (!ok) return { cor: 'destructive' as const, texto: statusConsulta || 'falhou', liberado: false };
    return { cor: 'muted' as const, texto: statusConsulta || '—', liberado: false };
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Landmark className="size-6 text-cyan-400" />
          FGTS — Fintech do Corban
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Antecipação saque-aniversário via QI SCD e J17. Consulta o saldo nas duas bancarizadoras em paralelo.
        </p>
      </div>

      {/* Instrução de liberação — o passo 1 do fluxo */}
      <Card className="border-primary/30">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="font-bold text-sm flex items-center gap-1.5">
              <Smartphone className="size-4 text-primary" /> Passo 1 — Cliente libera no app FGTS
            </h2>
            <Button size="sm" variant="outline" onClick={copiarInstrucao}>
              <Copy className="size-3.5 mr-1.5" /> Copiar instrução pro cliente
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            O cliente precisa ter o <b className="text-foreground">saque-aniversário ativo</b> e autorizar
            estas duas instituições no app FGTS da Caixa (menu Autorizações):
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="info" className="text-[11px]">QI SOCIEDADE DE CRÉDITO DIRETO S.A.</Badge>
            <Badge variant="info" className="text-[11px]">J17 SOCIEDADE DE CRÉDITO DIRETO S.A.</Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            Sem a liberação, a consulta abaixo volta <b>pendente/negada</b>. O botão acima copia a
            instrução completa pronta pra mandar no WhatsApp.
          </div>
        </CardContent>
      </Card>

      {/* Consulta de saldo */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <h2 className="font-bold text-sm">Passo 2 — Consultar saldo (QI SCD + J17)</h2>
          <form
            onSubmit={(e) => { e.preventDefault(); if (cpfValido) saldo.mutate(cpfRaw); }}
            className="flex flex-wrap items-end gap-3"
          >
            <div className="flex-1 min-w-[200px]">
              <Label htmlFor="cpf" className="text-xs uppercase tracking-wider text-muted-foreground">CPF do cliente</Label>
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
              Consultar nas duas
            </Button>
          </form>

          {saldo.data?.consultas && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {saldo.data.consultas.map((c) => {
                const info = statusInfo(c.statusConsulta, c.ok);
                return (
                  <div
                    key={c.typeQuery}
                    className={`rounded-md border p-3 space-y-2 ${
                      info.liberado ? 'border-green-500/40 bg-green-500/5' : 'border-border bg-secondary/20'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-sm">{c.instituicao}</div>
                      {info.liberado
                        ? <CheckCircle2 className="size-4 text-green-400 shrink-0" />
                        : <AlertCircle className="size-4 text-yellow-400 shrink-0" />}
                    </div>
                    <div className="text-xs">
                      Status: <Badge variant={info.cor} className="text-[10px]">{info.texto}</Badge>
                      {c.httpStatus != null && <span className="text-muted-foreground ml-2">HTTP {c.httpStatus}</span>}
                    </div>
                    {!info.liberado && (
                      <div className="text-[11px] text-muted-foreground">
                        Provável falta de autorização no app FGTS — mande a instrução do Passo 1.
                      </div>
                    )}
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground py-1">
                        Resposta da API
                      </summary>
                      <pre className="mt-1 bg-muted/30 p-2 rounded-md overflow-x-auto max-h-64 text-[10px]">
                        {JSON.stringify(c.dados ?? c._raw, null, 2)}
                      </pre>
                    </details>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tabelas FGTS */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-sm flex items-center gap-1.5">
              <BookOpen className="size-4 text-purple-400" /> Tabelas FGTS disponíveis
            </h2>
            <Button size="sm" variant="outline" onClick={() => tabelas.mutate()} disabled={tabelas.isPending}>
              {tabelas.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Ver tabelas FGTS
            </Button>
          </div>
          {t && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                <strong className="text-foreground">{t.tabelasFgts ?? 0}</strong> tabela(s) FGTS encontrada(s).
              </div>
              {(t.tabelas || []).length === 0 ? (
                <div className="text-xs text-yellow-400 rounded-md border border-yellow-500/40 bg-yellow-500/5 p-2">
                  Nenhuma tabela FGTS retornada. Verifique se a chave tem o produto FGTS habilitado na Fintech do Corban.
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
                        <tr key={`${tb.idTabela}-${i}`}>
                          <td className="p-2">{tb.nome || '(sem nome)'}</td>
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
    </div>
  );
}
