'use client';

import { useState, useMemo } from 'react';
import { usePrefConvenios, agruparPorUfCidade } from '@/hooks/use-pref-catalogo';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft, ChevronRight, Search, AlertCircle, MapPin } from 'lucide-react';
import { tipoIcone, tipoLabel } from '@/lib/pref-types';
import type { PrefConvenio } from '@/lib/pref-types';
import { ConvenioDetalhe } from '@/components/pref/convenio-detalhe';

type Tipo = '' | 'prefeitura' | 'instituto_previdencia' | 'cartao_beneficio';

export default function CatalogoPrefeiturasPage() {
  const { data, isLoading, error, refetch } = usePrefConvenios();
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState<Tipo>('');

  // Drill state — null = camada superior
  const [ufAberta, setUfAberta] = useState<string | null>(null);
  const [cidadeAberta, setCidadeAberta] = useState<string | null>(null);
  const [slugAberto, setSlugAberto] = useState<string | null>(null);

  const grupos = useMemo(
    () => agruparPorUfCidade(data?.convenios || [], { busca, tipo }),
    [data, busca, tipo]
  );

  // ── Loading / Erro globais ──
  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto p-6 space-y-4">
        <Header />
        <Skeleton className="h-12" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="max-w-6xl mx-auto p-6 space-y-4">
        <Header />
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
      </div>
    );
  }

  // ── Camada 4: Detalhe do convênio (bancos + regras) ──
  if (slugAberto) {
    return (
      <div className="max-w-5xl mx-auto p-6 space-y-4">
        <Breadcrumb
          items={[
            { label: '🏙️ Estados', onClick: () => { setUfAberta(null); setCidadeAberta(null); setSlugAberto(null); } },
            { label: ufAberta || '?', onClick: () => { setCidadeAberta(null); setSlugAberto(null); } },
            { label: cidadeAberta ? `📍 ${cidadeAberta}` : '?', onClick: () => setSlugAberto(null) },
            { label: 'Convênio', current: true },
          ]}
        />
        <ConvenioDetalhe slug={slugAberto} onVoltar={() => setSlugAberto(null)} />
      </div>
    );
  }

  // ── Camada 3: Convênios da Cidade ──
  if (ufAberta && cidadeAberta) {
    const grp = grupos.find((g) => g.uf === ufAberta);
    const cid = grp?.cidades.get(cidadeAberta);
    const ord: Record<string, number> = { prefeitura: 0, instituto_previdencia: 1, cartao_beneficio: 2 };
    const convs = (cid?.convenios || []).slice().sort(
      (a, b) => (ord[a.tipo] ?? 9) - (ord[b.tipo] ?? 9) || a.nome.localeCompare(b.nome, 'pt-BR')
    );
    return (
      <div className="max-w-5xl mx-auto p-6 space-y-4">
        <Breadcrumb
          items={[
            { label: '🏙️ Estados', onClick: () => { setUfAberta(null); setCidadeAberta(null); } },
            { label: ufAberta, onClick: () => setCidadeAberta(null) },
            { label: `📍 ${cidadeAberta}`, current: true },
          ]}
        />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">📍 {cidadeAberta}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {ufAberta}{grp?.estado_nome ? ` · ${grp.estado_nome}` : ''} — escolha um convênio para ver as regras e bancos.
          </p>
        </div>
        {convs.length === 0 ? (
          <EmptyMsg />
        ) : (
          <div className="space-y-2">
            {convs.map((c) => (
              <ConvenioRow key={c.id} c={c} onClick={() => setSlugAberto(c.slug)} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Camada 2: Cidades dentro da UF ──
  if (ufAberta) {
    const grp = grupos.find((g) => g.uf === ufAberta);
    const cidades = Array.from(grp?.cidades.values() || []).sort(
      (a, b) => a.municipio.localeCompare(b.municipio, 'pt-BR')
    );
    return (
      <div className="max-w-6xl mx-auto p-6 space-y-4">
        <Breadcrumb
          items={[
            { label: '🏙️ Estados', onClick: () => setUfAberta(null) },
            { label: `${ufAberta}${grp?.estado_nome ? ` · ${grp.estado_nome}` : ''}`, current: true },
          ]}
        />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {grp?.estado_nome || ufAberta} <span className="text-muted-foreground font-normal text-sm">({ufAberta})</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Escolha uma cidade para ver os convênios disponíveis.</p>
        </div>
        <FiltrosBar busca={busca} setBusca={setBusca} tipo={tipo} setTipo={setTipo} />
        {cidades.length === 0 ? (
          <EmptyMsg />
        ) : (
          <>
            <div className="text-xs text-muted-foreground">
              {cidades.length} cidade(s) · {grp?.total} convênio(s)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {cidades.map((cid) => {
                const tipos: Record<string, number> = {};
                for (const c of cid.convenios) tipos[c.tipo] = (tipos[c.tipo] || 0) + 1;
                return (
                  <Card
                    key={cid.municipio}
                    onClick={() => setCidadeAberta(cid.municipio)}
                    className="cursor-pointer hover:border-primary transition-colors"
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 font-semibold">
                        <MapPin className="w-4 h-4 text-muted-foreground" />
                        <span>{cid.municipio}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {cid.convenios.length} convênio(s)
                      </div>
                      <div className="flex gap-1 flex-wrap mt-2">
                        {tipos.prefeitura && <Badge variant="muted" className="text-[10px]">🏛️ {tipos.prefeitura}</Badge>}
                        {tipos.instituto_previdencia && <Badge variant="muted" className="text-[10px]">📋 {tipos.instituto_previdencia}</Badge>}
                        {tipos.cartao_beneficio && <Badge variant="muted" className="text-[10px]">💳 {tipos.cartao_beneficio}</Badge>}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Camada 1: Estados ──
  const totalConv = grupos.reduce((s, g) => s + g.total, 0);
  const totalCid = grupos.reduce((s, g) => s + g.cidades.size, 0);
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <Header />
      <FiltrosBar busca={busca} setBusca={setBusca} tipo={tipo} setTipo={setTipo} />
      {grupos.length === 0 ? (
        <EmptyMsg />
      ) : (
        <>
          <div className="text-xs text-muted-foreground">
            {grupos.length} estado(s) · {totalCid} cidade(s) · {totalConv} convênio(s)
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {grupos.map((g) => (
              <Card
                key={g.uf}
                onClick={() => setUfAberta(g.uf)}
                className="cursor-pointer hover:border-primary hover:-translate-y-0.5 transition-all"
              >
                <CardContent className="p-4">
                  <div className="text-3xl font-bold text-primary">{g.uf}</div>
                  <div className="text-xs text-muted-foreground mt-1 truncate">{g.estado_nome}</div>
                  <div className="text-[11px] text-muted-foreground mt-2">
                    📍 {g.cidades.size} · 📋 {g.total}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Componentes auxiliares ──

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">🏙️ Catálogo de Prefeituras</h1>
      <p className="text-sm text-muted-foreground mt-1">
        Convênios municipais (prefeituras, institutos de previdência, cartões benefício). Escolha um estado para começar.
      </p>
    </div>
  );
}

function FiltrosBar({
  busca, setBusca, tipo, setTipo,
}: {
  busca: string; setBusca: (s: string) => void; tipo: string; setTipo: (s: any) => void;
}) {
  return (
    <Card>
      <CardContent className="p-3 flex flex-wrap gap-2 items-center">
        <div className="flex-1 min-w-[240px] relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar (cidade, instituto, ex: Sorocaba, IPREM)..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
          className="h-10 px-3 rounded-md border border-input bg-background text-sm"
        >
          <option value="">Todos os tipos</option>
          <option value="prefeitura">🏛️ Prefeitura</option>
          <option value="instituto_previdencia">📋 Instituto Prev.</option>
          <option value="cartao_beneficio">💳 Cartão Benefício</option>
        </select>
      </CardContent>
    </Card>
  );
}

function Breadcrumb({ items }: { items: Array<{ label: string; onClick?: () => void; current?: boolean }> }) {
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1">
          {it.current ? (
            <span className="text-foreground font-semibold">{it.label}</span>
          ) : (
            <button onClick={it.onClick} className="text-primary hover:underline">{it.label}</button>
          )}
          {i < items.length - 1 && <ChevronRight className="w-3 h-3" />}
        </span>
      ))}
    </div>
  );
}

function ConvenioRow({ c, onClick }: { c: PrefConvenio; onClick: () => void }) {
  return (
    <Card onClick={onClick} className="cursor-pointer hover:border-primary transition-colors">
      <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm flex items-center gap-2">
            <span>{tipoIcone(c.tipo)}</span>
            <span className="truncate">{c.nome}</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            {tipoLabel(c.tipo)} · {c.sheet_origem}
          </div>
        </div>
        <Button size="sm" variant="outline" className="gap-1 pointer-events-none">
          Ver regras <ChevronRight className="w-3 h-3" />
        </Button>
      </CardContent>
    </Card>
  );
}

function EmptyMsg() {
  return (
    <Card>
      <CardContent className="p-8 text-center text-sm text-muted-foreground">
        Nenhum convênio encontrado.
      </CardContent>
    </Card>
  );
}
