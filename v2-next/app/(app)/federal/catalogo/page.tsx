'use client';

import { useEffect, useMemo, useState } from 'react';
import { useFedConvenios, useFedConvenio } from '@/hooks/use-fed-catalogo';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ConvenioCard } from '@/components/fed/convenio-card';
import { EmptyState, ErrorState } from '@/components/system-state';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  CategoriaFed,
  orgaoIcone,
  categoriaLabel,
  operacaoTipoLabel,
} from '@/lib/fed-types';
import { Search, RefreshCw, FileText, Landmark } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export default function FederalCatalogoPage() {
  const [busca, setBusca] = useState('');
  const [buscaDebounced, setBuscaDebounced] = useState('');
  const [filtroCategoria, setFiltroCategoria] = useState<CategoriaFed | ''>('');
  const [filtroOrgao, setFiltroOrgao] = useState('');
  const [convenioAbertoSlug, setConvenioAbertoSlug] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setBuscaDebounced(busca.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [busca]);

  const { data, isLoading, error, refetch, isFetching } = useFedConvenios({
    categoria: filtroCategoria,
    orgao: filtroOrgao,
    busca: buscaDebounced,
  });

  const orgaosDisponiveis = useMemo(() => {
    const s = new Set<string>();
    for (const g of data?.grupos || []) {
      for (const c of g.convenios) if (c.orgao) s.add(String(c.orgao));
    }
    return Array.from(s);
  }, [data]);

  const totalConv = useMemo(
    () => (data?.grupos || []).reduce((sum, g) => sum + g.convenios.length, 0),
    [data],
  );

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-border/70 bg-card/45 p-6 shadow-lg shadow-black/10 backdrop-blur-xl">
        <div className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/25">
            <Landmark className="size-6" aria-hidden />
          </div>
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Federal · referência operacional</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Catálogo de convênios</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Pesquise convênios civis e militares, consulte regras e abra a análise de contracheque com o contexto selecionado.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2">
          <RefreshCw className={cn('size-4', isFetching && 'animate-spin')} aria-hidden />
          {isFetching ? 'Atualizando…' : 'Atualizar catálogo'}
        </Button>
      </header>

      <Card className="border-border/70">
        <CardContent className="grid gap-3 p-4 md:grid-cols-[minmax(240px,1fr)_180px_220px_auto] md:items-end">
          <div className="space-y-2">
            <Label htmlFor="federal-busca">Buscar convênio</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                id="federal-busca"
                placeholder="Ex.: SIAPE, Marinha, portabilidade"
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="federal-categoria">Categoria</Label>
            <select
              id="federal-categoria"
              value={filtroCategoria}
              onChange={(event) => setFiltroCategoria(event.target.value as CategoriaFed | '')}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Todas</option>
              <option value="civil">Civis</option>
              <option value="militar">Militares</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="federal-orgao">Órgão</Label>
            <select
              id="federal-orgao"
              value={filtroOrgao}
              onChange={(event) => setFiltroOrgao(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Todos os órgãos</option>
              {orgaosDisponiveis.map((orgao) => (
                <option key={orgao} value={orgao}>{orgaoIcone(orgao)} {orgao}</option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            variant="ghost"
            disabled={!busca && !filtroCategoria && !filtroOrgao}
            onClick={() => { setBusca(''); setFiltroCategoria(''); setFiltroOrgao(''); }}
          >
            Limpar filtros
          </Button>
        </CardContent>
      </Card>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {/* Erro */}
      {error && (
        <ErrorState
          title="Não foi possível carregar o catálogo"
          description="A consulta pode estar temporariamente indisponível. Tente novamente sem perder seus filtros."
          onRetry={() => void refetch()}
        />
      )}

      {/* Empty */}
      {!isLoading && !error && totalConv === 0 && (
        <EmptyState
          title="Nenhum convênio encontrado"
          description="Revise o termo, a categoria ou o órgão selecionado. Você também pode limpar todos os filtros."
          action={
            <Button type="button" variant="outline" onClick={() => { setBusca(''); setFiltroCategoria(''); setFiltroOrgao(''); }}>
              Limpar filtros
            </Button>
          }
        />
      )}

      {/* Lista agrupada por categoria */}
      {!isLoading && !error && totalConv > 0 && (
        <>
          <div className="text-xs text-muted-foreground">
            {totalConv} convênio(s) em {data!.grupos!.length} categoria(s)
          </div>
          {data!.grupos!.map((g) => (
            <div key={String(g.categoria)} className="space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold flex items-center gap-2">
                {categoriaLabel(g.categoria)}
                <Badge variant="muted" className="text-[10px]">
                  {g.convenios.length}
                </Badge>
              </div>
              <div className="space-y-2">
                {g.convenios.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => setConvenioAbertoSlug(c.slug)}
                    className="block w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    aria-label={`Abrir detalhes de ${c.nome}`}
                  >
                    <ConvenioCard convenio={c} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {/* Modal detalhe do convênio */}
      <Dialog open={!!convenioAbertoSlug} onOpenChange={(open) => !open && setConvenioAbertoSlug(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <ConvenioDetalhe slug={convenioAbertoSlug} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConvenioDetalhe({ slug }: { slug: string | null }) {
  const { data, isLoading, error, refetch } = useFedConvenio(slug);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <DialogHeader>
          <DialogTitle>Carregando detalhes do convênio</DialogTitle>
          <DialogDescription>Aguarde enquanto consultamos regras e bancos disponíveis.</DialogDescription>
        </DialogHeader>
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-4">
        <DialogHeader>
          <DialogTitle>Detalhes do convênio</DialogTitle>
          <DialogDescription>Não foi possível concluir esta consulta.</DialogDescription>
        </DialogHeader>
        <ErrorState
          title="Falha ao carregar as regras"
          description="Tente novamente. O catálogo principal continua disponível."
          onRetry={() => void refetch()}
          className="min-h-0"
        />
      </div>
    );
  }
  if (!data) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Detalhes do convênio</DialogTitle>
          <DialogDescription>Nenhuma informação foi retornada para este convênio.</DialogDescription>
        </DialogHeader>
        <EmptyState title="Detalhes indisponíveis" description="Feche esta janela e selecione outro convênio." />
      </>
    );
  }

  const c = data.convenio;
  const bancos = data.bancos || [];

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-lg flex items-center gap-2">
          {orgaoIcone(c.orgao)} {c.nome}
        </DialogTitle>
        <DialogDescription className="text-xs">
          {categoriaLabel(c.categoria)}
          {c.orgao && ' · ' + c.orgao}
          {c.operacao_tipo && ' · ⚙️ ' + operacaoTipoLabel(c.operacao_tipo)}
          {c.sheet_origem && ' · Aba: ' + c.sheet_origem}
        </DialogDescription>
      </DialogHeader>

      <Card className="border-cyan-500/40 mt-3">
        <CardContent className="p-3 flex items-center justify-between flex-wrap gap-2 text-sm">
          <div>📄 Tem o contracheque do servidor? Sobe pra ver bancos compatíveis e simulação de port.</div>
          <Button asChild size="sm" className="gap-2">
            <Link href={`/federal/analise?conv=${encodeURIComponent(c.slug)}`}>
              <FileText className="size-4" aria-hidden /> Analisar contracheque
            </Link>
          </Button>
        </CardContent>
      </Card>

      <div className="mt-3">
        <div className="text-sm text-muted-foreground mb-2">
          {bancos.length} banco(s) operam este convênio
        </div>
        {bancos.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6">
            Sem bancos cadastrados.
          </div>
        ) : (
          <div className="space-y-2">
            {bancos.map((b) => {
              const ops = [
                b.operacoes.novo && 'Novo',
                b.operacoes.refin && 'Refin',
                b.operacoes.port && 'Port',
                b.operacoes.cartao && 'Cartão',
              ].filter(Boolean) as string[];
              return (
                <div
                  key={b.id}
                  className={cn(
                    'rounded-md border border-border p-3',
                    b.suspenso && 'opacity-60',
                  )}
                >
                  <div className="flex items-center justify-between flex-wrap gap-2 mb-1.5">
                    <div className="font-bold text-sm flex items-center gap-2">
                      {b.banco_nome}
                      {b.suspenso && (
                        <Badge variant="destructive" className="text-[10px]">
                          ⛔ Suspenso
                        </Badge>
                      )}
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      {ops.length > 0 ? (
                        ops.map((o) => (
                          <Badge key={o} variant="success" className="text-[10px]">
                            {o}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-[10px] text-muted-foreground">
                          — sem operações
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-4 flex-wrap text-[11px] text-muted-foreground">
                    {b.margem_utilizavel != null && (
                      <div>
                        Margem <b className="text-foreground">{(b.margem_utilizavel * 100).toFixed(0)}%</b>
                      </div>
                    )}
                    {(b.idade_min || b.idade_max) && (
                      <div>
                        Idade <b className="text-foreground">{b.idade_min || '?'}-{b.idade_max || '?'}</b>
                      </div>
                    )}
                    {b.taxa_minima_port != null && (
                      <div>
                        Taxa Port{' '}
                        <b className="text-foreground">
                          {(b.taxa_minima_port * 100).toFixed(2).replace('.', ',')}%
                        </b>
                      </div>
                    )}
                    {b.data_corte && (
                      <div>
                        Corte <b className="text-foreground">{b.data_corte}</b>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
