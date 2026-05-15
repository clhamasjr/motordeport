'use client';

import { useState, useMemo } from 'react';
import { useCatalogoCltBancos } from '@/hooks/use-clt-bancos';
import { BancoCard } from '@/components/clt/banco-card';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, RefreshCw, AlertCircle } from 'lucide-react';

export default function CatalogoBancosPage() {
  const { data, isLoading, error, refetch, isFetching } = useCatalogoCltBancos();
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'operando' | 'parado'>('todos');

  const bancosFiltrados = useMemo(() => {
    if (!data?.bancos) return [];
    return data.bancos.filter(b => {
      if (filtroStatus === 'operando' && !b.ativo) return false;
      if (filtroStatus === 'parado' && b.ativo) return false;
      if (busca) {
        const q = busca.toLowerCase();
        return b.nome.toLowerCase().includes(q) || b.slug.includes(q.toLowerCase());
      }
      return true;
    });
  }, [data, busca, filtroStatus]);

  const counts = useMemo(() => {
    const bancos = data?.bancos || [];
    return {
      total: bancos.length,
      operando: bancos.filter(b => b.ativo).length,
      parado: bancos.filter(b => !b.ativo).length,
    };
  }, [data]);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">📚 CLT — Catálogo de Bancos</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Bancos integrados e suas regras (idade, valor, prazo, documentos). Clica num card pra expandir.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2">
          <RefreshCw className={cnSpin(isFetching)} />
          Atualizar
        </Button>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-3 flex flex-wrap gap-2 items-center">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou slug..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-1">
            {(['todos', 'operando', 'parado'] as const).map((f) => (
              <Button
                key={f}
                variant={filtroStatus === f ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFiltroStatus(f)}
                className="capitalize"
              >
                {f}
                <Badge variant={filtroStatus === f ? 'secondary' : 'muted'} className="ml-1.5 text-[10px]">
                  {f === 'todos' ? counts.total : f === 'operando' ? counts.operando : counts.parado}
                </Badge>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
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
            <Button size="sm" variant="outline" onClick={() => refetch()}>Tentar de novo</Button>
          </CardContent>
        </Card>
      )}

      {/* Lista */}
      {!isLoading && !error && bancosFiltrados.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Nenhum banco encontrado com esses filtros.
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && bancosFiltrados.length > 0 && (
        <div className="space-y-2.5">
          {bancosFiltrados.map((banco) => (
            <BancoCard
              key={banco.id}
              banco={banco}
              convenios={data!.convenios}
              vinculos={data!.vinculos}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function cnSpin(spinning: boolean) {
  return spinning ? 'w-4 h-4 animate-spin' : 'w-4 h-4';
}
