'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConsultaCard } from '@/components/clt/consulta-card';
import { useCltPipeline, useEnriquecerNovaVida, type CategoriaCliente } from '@/hooks/use-clt-fila';
import { BANCO_LABEL } from '@/lib/clt-bancos';
import { formatBRL, formatCpf, formatDateBR } from '@/lib/utils';
import { GitBranch, AlertCircle, Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { BancoSlug } from '@/lib/clt-types';

// Ordem e rótulo das categorias do pipeline
const CATEGORIAS: { key: CategoriaCliente; label: string; cor: string }[] = [
  { key: 'apto', label: 'Aptos', cor: 'text-green-500' },
  { key: 'sem_margem', label: 'Sem margem', cor: 'text-yellow-500' },
  { key: 'aguardando', label: 'Aguardando autorização', cor: 'text-orange-400' },
  { key: 'sem_dados', label: 'Sem dados', cor: 'text-zinc-400' },
  { key: 'inapto', label: 'Inaptos', cor: 'text-red-400' },
  { key: 'processando', label: 'Processando', cor: 'text-cyan-400' },
  { key: 'standby', label: 'Agendados (26/06)', cor: 'text-amber-400' },
];

// Rótulo curto do banco que está travando a autorização
const BANCO_CURTO: Record<string, string> = {
  c6: 'C6', handbank: 'UY3', presencabank: 'Presença', joinbank: 'Join',
  v8_qi: 'V8/QI', v8_celcoin: 'V8/Celcoin', fintech_qi: 'Fintech',
  unno: 'Unno', nossa_fintech: 'N.Fintech', nossa_fintech_uy3: 'N.Fintech/UY3',
  facta_clt: 'FACTA',
};

export default function PipelineCltPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useCltPipeline();
  const enriquecer = useEnriquecerNovaVida();
  const [aba, setAba] = useState<CategoriaCliente>('apto');
  // Cliente aberto inline (modal com o ConsultaCard completo, leitura pool-comum)
  const [aberto, setAberto] = useState<{ id: string; nome: string } | null>(null);
  // Progresso do enriquecimento em lote (Nova Vida)
  const [enrich, setEnrich] = useState<{ rodando: boolean; feitos: number; total: number; ok: number } | null>(null);

  const clientes = (data?.clientes || []).filter((c) => c.categoria === aba);
  const mostraMargem = aba === 'apto' || aba === 'sem_margem';
  const mostraTravado = aba === 'aguardando';

  // Enriquece TODOS os "sem dados" da lista atual, 1 por vez (Nova Vida).
  async function enriquecerTodos() {
    const alvo = (data?.clientes || []).filter((c) => c.categoria === 'sem_dados');
    if (alvo.length === 0) return;
    setEnrich({ rodando: true, feitos: 0, total: alvo.length, ok: 0 });
    let ok = 0;
    for (let i = 0; i < alvo.length; i++) {
      try {
        const r = await enriquecer.mutateAsync(alvo[i].id);
        if (r.enriquecido) ok++;
      } catch { /* segue pro próximo */ }
      setEnrich({ rodando: true, feitos: i + 1, total: alvo.length, ok });
    }
    setEnrich({ rodando: false, feitos: alvo.length, total: alvo.length, ok });
    toast.success(`Nova Vida: ${ok}/${alvo.length} clientes enriquecidos`);
    qc.invalidateQueries({ queryKey: ['clt', 'pipeline'] });
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <GitBranch className="size-6 text-orange-400" />
          CLT — Pipeline de Clientes
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Todos os clientes consultados, segmentados por situação. Pool comum — todos os operadores
          veem. Clique numa categoria pra filtrar.
        </p>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
        </div>
      )}

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 flex items-center gap-2 text-destructive">
            <AlertCircle className="size-4" /> {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* Cards por categoria — clicáveis (filtram a tabela) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {CATEGORIAS.map((cat) => {
              const n = data.contadores?.[cat.key] || 0;
              const ativo = aba === cat.key;
              return (
                <button
                  key={cat.key}
                  onClick={() => setAba(cat.key)}
                  className={`text-left rounded-md p-3 border transition-colors ${
                    ativo ? 'border-primary bg-primary/5' : 'border-border bg-surface-1 hover:bg-muted/30'
                  }`}
                >
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">
                    {cat.label}
                  </div>
                  <div className={`text-2xl font-black ${cat.cor}`}>{n}</div>
                </button>
              );
            })}
          </div>

          {/* Soma das margens (só faz sentido em aptos) */}
          {aba === 'apto' && (
            <div className="text-sm text-muted-foreground">
              Potencial total em margem dos aptos:{' '}
              <b className="text-cyan-400">{formatBRL(data.somaMargem)}</b>
            </div>
          )}
          {aba === 'aguardando' && (
            <div className="text-sm text-muted-foreground">
              Têm dados e contato, mas algum banco precisa de autorização. Veja em
              <b className="text-orange-400"> Travado em</b> qual banco — <b>C6 · selfie</b> significa
              que falta o cliente fazer a selfie (reenvie o link na consulta do cliente).
            </div>
          )}
          {aba === 'sem_dados' && (
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">
                Aguardando autorização, mas <b>sem nome e sem telefone</b> nas bases. Use o
                <b> Nova Vida</b> pra puxar nome/telefone por CPF e destravar a consulta.
              </div>
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  onClick={enriquecerTodos}
                  disabled={enrich?.rodando || (data.contadores?.sem_dados || 0) === 0}
                >
                  {enrich?.rodando ? (
                    <Loader2 className="size-4 mr-1.5 animate-spin" />
                  ) : (
                    <Sparkles className="size-4 mr-1.5" />
                  )}
                  Enriquecer todos com Nova Vida ({data.contadores?.sem_dados || 0})
                </Button>
                {enrich && (
                  <span className="text-xs text-muted-foreground">
                    {enrich.rodando
                      ? `Processando ${enrich.feitos}/${enrich.total}… (${enrich.ok} com dados)`
                      : `Concluído: ${enrich.ok}/${enrich.total} enriquecidos`}
                  </span>
                )}
              </div>
              {enrich?.rodando && (
                <div className="h-1.5 w-full max-w-md rounded bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${Math.round((enrich.feitos / enrich.total) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Tabela da categoria selecionada */}
          {clientes.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                Nenhum cliente nesta categoria.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="text-left p-3">Cliente</th>
                        {mostraMargem && <th className="text-right p-3">Melhor margem</th>}
                        {mostraMargem && <th className="text-left p-3">Melhor banco</th>}
                        {mostraTravado && <th className="text-left p-3">Travado em</th>}
                        <th className="text-left p-3">Empregador</th>
                        <th className="text-left p-3">Vendedor</th>
                        <th className="text-left p-3">Consultado em</th>
                        <th className="text-center p-3">WhatsApp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {clientes.map((a) => (
                        <tr
                          key={a.id}
                          className="hover:bg-muted/20 cursor-pointer"
                          onClick={() => setAberto({ id: a.id, nome: a.nome })}
                          title="Clique para abrir o cliente"
                        >
                          <td className="p-3">
                            <div className="font-medium flex items-center gap-1.5">
                              {a.nome}
                              <span className="text-[10px] text-primary/60">↗</span>
                            </div>
                            <div className="text-xs text-muted-foreground">{formatCpf(a.cpf)}</div>
                          </td>
                          {mostraMargem && (
                            <td className="p-3 text-right font-bold text-green-500">
                              {a.melhorMargem > 0 ? formatBRL(a.melhorMargem) : '—'}
                            </td>
                          )}
                          {mostraMargem && (
                            <td className="p-3">
                              {a.melhorBanco ? (
                                <Badge variant="muted" className="text-[10px]">
                                  {BANCO_LABEL[a.melhorBanco as BancoSlug] || a.melhorBanco}
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                          )}
                          {mostraTravado && (
                            <td className="p-3">
                              <div className="flex flex-wrap gap-1">
                                {a.precisaSelfieC6 && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 font-medium">
                                    C6 · selfie
                                  </span>
                                )}
                                {(a.aguardandoBancos || [])
                                  .filter((b) => b !== 'c6')
                                  .map((b) => (
                                    <span
                                      key={b}
                                      className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                                    >
                                      {BANCO_CURTO[b] || b}
                                    </span>
                                  ))}
                                {(a.aguardandoBancos || []).length === 0 && !a.precisaSelfieC6 && (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </div>
                            </td>
                          )}
                          <td className="p-3 text-xs text-muted-foreground">
                            {a.empregador ? a.empregador.substring(0, 32) : '—'}
                          </td>
                          <td className="p-3 text-xs">{a.vendedor || '—'}</td>
                          <td className="p-3 text-xs text-muted-foreground">{formatDateBR(a.iniciado_em)}</td>
                          <td className="p-3 text-center">
                            {a.telefone ? (
                              <a
                                href={`https://wa.me/55${a.telefone.replace(/\D/g, '')}`}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-block text-[11px] px-2 py-1 rounded bg-green-500/10 text-green-500 hover:bg-green-500/20"
                              >
                                📱 Chamar
                              </a>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Cliente aberto inline — ConsultaCard completo (leitura pool-comum) */}
      <Dialog open={!!aberto} onOpenChange={(o) => { if (!o) setAberto(null); }}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">{aberto?.nome || 'Cliente'}</DialogTitle>
          </DialogHeader>
          {aberto && <ConsultaCard filaId={aberto.id} pool onClose={() => setAberto(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
