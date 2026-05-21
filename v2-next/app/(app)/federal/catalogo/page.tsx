'use client';

import { useState, useMemo } from 'react';
import { useFedConvenios, useFedConvenio } from '@/hooks/use-fed-catalogo';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ConvenioCard } from '@/components/fed/convenio-card';
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
import { Search, AlertCircle, RefreshCw, FileText } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export default function FederalCatalogoPage() {
  const [busca, setBusca] = useState('');
  const [filtroCategoria, setFiltroCategoria] = useState<CategoriaFed | ''>('');
  const [filtroOrgao, setFiltroOrgao] = useState('');
  const [convenioAbertoSlug, setConvenioAbertoSlug] = useState<string | null>(null);

  const { data, isLoading, error, refetch, isFetching } = useFedConvenios({
    categoria: filtroCategoria,
    orgao: filtroOrgao,
    busca,
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
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">🇧🇷 Federal — Catálogo de Convênios</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Convênios federais civis (SIAPE, SERPRO) e militares (Marinha, Exército, Aeronáutica).
            Clica num card pra ver as regras operacionais e bancos.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2">
          <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
          Atualizar
        </Button>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-3 flex flex-wrap gap-2 items-center">
          <div className="flex-1 min-w-[220px] relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar (ex: SIAPE, Marinha, port)..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-9"
            />
          </div>
          <select
            value={filtroCategoria}
            onChange={(e) => setFiltroCategoria(e.target.value as CategoriaFed | '')}
            className="h-9 px-3 text-sm rounded-md border border-input bg-background"
          >
            <option value="">Todas categorias</option>
            <option value="civil">👔 Civis</option>
            <option value="militar">🪖 Militares</option>
          </select>
          <select
            value={filtroOrgao}
            onChange={(e) => setFiltroOrgao(e.target.value)}
            className="h-9 px-3 text-sm rounded-md border border-input bg-background"
          >
            <option value="">Todos órgãos</option>
            {orgaosDisponiveis.map((o) => (
              <option key={o} value={o}>
                {orgaoIcone(o)} {o}
              </option>
            ))}
          </select>
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
        <Card className="border-destructive/50">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-bold text-destructive">Erro carregando catálogo</div>
              <div className="text-sm text-muted-foreground mt-1">{(error as Error).message}</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Tentar de novo
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Empty */}
      {!isLoading && !error && totalConv === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Nenhum convênio encontrado com esses filtros.
          </CardContent>
        </Card>
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
                  <div
                    key={c.id}
                    onClick={() => setConvenioAbertoSlug(c.slug)}
                    className="cursor-pointer"
                  >
                    <ConvenioCard convenio={c} />
                  </div>
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
  const { data, isLoading, error } = useFedConvenio(slug);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-sm text-destructive p-4">
        Erro: {(error as Error).message}
      </div>
    );
  }
  if (!data) return null;

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
          <Link href={`/federal/analise?conv=${encodeURIComponent(c.slug)}`}>
            <Button size="sm" className="gap-2">
              <FileText className="w-4 h-4" /> Analisar Contracheque
            </Button>
          </Link>
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
