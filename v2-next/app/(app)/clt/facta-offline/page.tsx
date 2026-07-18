'use client';

import { useMemo, useState } from 'react';
import {
  useCriarLoteOffline, useStatusLoteOffline, useListarBaldeOffline,
  useDispararAutorizacaoOffline, type LinhaOffline,
} from '@/hooks/use-facta-offline';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { formatCpf } from '@/lib/utils';
import { DatabaseZap, Loader2, Rocket, Upload, Send, RefreshCw } from 'lucide-react';

const brl = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function FactaOfflinePage() {
  const [textoCpfs, setTextoCpfs] = useState('');
  const [lote, setLote] = useState<string | null>(null);
  const [linhas, setLinhas] = useState<LinhaOffline[]>([]);

  const criar = useCriarLoteOffline();
  const status = useStatusLoteOffline(lote);
  const listar = useListarBaldeOffline();
  const disparar = useDispararAutorizacaoOffline();

  const cpfs = useMemo(() => {
    const vistos = new Set<string>();
    return textoCpfs
      .split(/[\n,;\s]+/)
      .map((s) => s.replace(/\D/g, ''))
      .filter((c) => c.length >= 9 && c.length <= 11)
      .map((c) => c.padStart(11, '0').slice(-11))
      .filter((c) => (vistos.has(c) ? false : (vistos.add(c), true)));
  }, [textoCpfs]);

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => setTextoCpfs(String(ev.target?.result || ''));
    reader.readAsText(f);
  }

  function criarLote() {
    if (!cpfs.length) return;
    if (!confirm(`Vou consultar ${cpfs.length} CPFs na base OFFLINE da FACTA (sem SMS, ~3s/CPF).\n\nContinuar?`)) return;
    criar.mutate(cpfs, { onSuccess: (r) => { setLote(r.lote); setLinhas([]); } });
  }

  function verComMargem() {
    if (!lote) return;
    listar.mutate({ lote, bucket: 'com_margem', limit: 500 }, { onSuccess: (r) => setLinhas(r.rows || []) });
  }

  const s = status.data;
  const b = s?.baldes;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <DatabaseZap className="w-6 h-6 text-primary" /> FACTA CLT — Higienização Offline
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Consulta a base <b>offline</b> da FACTA (histórico, <b>sem SMS</b>) pra separar quem tem margem —
          depois dispara a autorização (SMS) <b>só</b> pros com margem. Só acha CPF já consultado na FACTA antes.
        </p>
      </div>

      {/* Entrada de CPFs */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <Label className="text-[10px] uppercase text-muted-foreground tracking-wider">
            Lista de CPFs (1 por linha — aceita vírgula/espaço)
          </Label>
          <textarea
            className="mt-1 w-full min-h-[140px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
            placeholder="12345678901&#10;98765432100&#10;..."
            value={textoCpfs}
            onChange={(e) => setTextoCpfs(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 text-xs cursor-pointer text-muted-foreground hover:text-foreground">
              <Upload className="w-4 h-4" />
              <span>Upload TXT/CSV</span>
              <input type="file" accept=".txt,.csv" className="hidden" onChange={onUpload} />
            </label>
            <Badge variant="muted" className="ml-auto">{cpfs.length} CPFs válidos</Badge>
            <Button size="sm" disabled={!cpfs.length || criar.isPending} onClick={criarLote} className="gap-2">
              {criar.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
              Consultar offline
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Status do lote */}
      {lote && (
        <>
          <Card className="border-primary/30">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-sm font-bold flex items-center gap-2">
                  {(s && (s.pendentes > 0 || s.processando > 0)) && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                  Progresso: {s?.progresso || '...'}
                </div>
                <div className="text-xs text-muted-foreground">
                  {s ? `${s.concluidos}/${s.total} consultados · ${s.pendentes} na fila` : 'carregando...'}
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Kpi label="🟢 Com margem" valor={b?.com_margem ?? 0} cor="text-green-400" />
                <Kpi label="⚪ Sem margem" valor={b?.sem_margem ?? 0} />
                <Kpi label="🕓 Sem histórico" valor={b?.sem_historico ?? 0} cor="text-yellow-500" />
                <Kpi label="🔴 Erro" valor={b?.erro ?? 0} cor="text-destructive" />
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
                <Button size="sm" variant="outline" className="gap-2" disabled={listar.isPending} onClick={verComMargem}>
                  {listar.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Ver com margem ({b?.com_margem ?? 0})
                </Button>
                <Button
                  size="sm"
                  className="gap-2 ml-auto"
                  disabled={disparar.isPending || !(b && b.com_margem > 0)}
                  onClick={() => lote && disparar.mutate({ lote, max: 8 })}
                  title="Dispara o SMS de autorização (FACTA online) só pros que têm margem — em lotes de 8"
                >
                  {disparar.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Disparar SMS pros com margem
                </Button>
              </div>
              {disparar.data?.restantes ? (
                <div className="text-[11px] text-muted-foreground">
                  Faltam <b>{disparar.data.restantes}</b> com margem sem SMS — clique de novo pra disparar o próximo lote.
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Lista com margem */}
          {linhas.length > 0 && (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-secondary/30 border-b border-border">
                    <tr>
                      <th className="text-left p-2">CPF</th>
                      <th className="text-left p-2">Nome</th>
                      <th className="text-right p-2">Margem</th>
                      <th className="text-left p-2">Empregador</th>
                      <th className="text-center p-2">📱</th>
                      <th className="text-left p-2">Atualizado FACTA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((r) => (
                      <tr key={r.id} className="border-b border-border/50 hover:bg-secondary/20">
                        <td className="p-2 font-mono">{formatCpf(r.cpf)}</td>
                        <td className="p-2">{(r.nome || '—').substring(0, 28)}</td>
                        <td className="p-2 text-right font-bold text-green-400">{brl(r.margem)}</td>
                        <td className="p-2 text-muted-foreground">{(r.empregador || '—').substring(0, 26)}</td>
                        <td className="p-2 text-center">{r.temTelefone ? '✓' : '—'}</td>
                        <td className="p-2 text-muted-foreground text-[10px]">{(r.atualizadoNaFacta || '').substring(0, 10)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({ label, valor, cor }: { label: string; valor: number; cor?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`text-2xl font-black mt-0.5 ${cor || ''}`}>{valor.toLocaleString('pt-BR')}</div>
      </CardContent>
    </Card>
  );
}
