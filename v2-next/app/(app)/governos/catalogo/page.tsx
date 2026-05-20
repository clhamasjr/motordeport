'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useGovConvenios, useGovConvenio, useGovBancos } from '@/hooks/use-gov-convenios';
import { useDeleteBancoConvenio } from '@/hooks/use-gov-admin';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, AlertCircle, ChevronRight, ArrowLeft, FileText, Plus } from 'lucide-react';
import { BancoCard } from '@/components/gov/banco-card';
import { ModalEditarBanco } from '@/components/gov/modal-editar-banco';
import { Convenio, BancoConvenio } from '@/lib/gov-types';

export default function GovCatalogoPage() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'gestor';

  const [busca, setBusca] = useState('');
  const [ufAberta, setUfAberta] = useState<string | null>(null);
  const [convenioSlug, setConvenioSlug] = useState<string | null>(null);

  const lista = useGovConvenios();
  const detalhe = useGovConvenio(convenioSlug);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">🏛 Catálogo de Convênios</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Estado → Convênio → Regras dos bancos.
        </p>
      </div>

      {/* Loading lista raiz */}
      {lista.isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}

      {/* Erro lista */}
      {lista.error && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-bold text-destructive">Erro carregando catálogo</div>
              <div className="text-sm text-muted-foreground mt-1">{(lista.error as Error).message}</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => lista.refetch()}>
              Tentar de novo
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Camada 3: detalhe do convenio */}
      {convenioSlug && lista.data && (
        <DetalheConvenio
          slug={convenioSlug}
          isAdmin={isAdmin}
          onVoltar={() => setConvenioSlug(null)}
          ufNome={ufAberta || '?'}
          estadoNome={lista.data.grupos.find(g => g.uf === ufAberta)?.estado_nome || null}
          detalhe={detalhe.data || null}
          isLoadingDetalhe={detalhe.isLoading}
          erroDetalhe={detalhe.error as Error | null}
        />
      )}

      {/* Camada 2: convenios de um estado */}
      {!convenioSlug && ufAberta && lista.data && (
        <ListaConvenios
          uf={ufAberta}
          estadoNome={lista.data.grupos.find(g => g.uf === ufAberta)?.estado_nome || null}
          convenios={lista.data.grupos.find(g => g.uf === ufAberta)?.convenios || []}
          onVoltar={() => setUfAberta(null)}
          onAbrirConvenio={(slug) => setConvenioSlug(slug)}
        />
      )}

      {/* Camada 1: grid de estados */}
      {!convenioSlug && !ufAberta && lista.data && (
        <GridEstados
          busca={busca}
          setBusca={setBusca}
          grupos={lista.data.grupos}
          onSelecionarUf={(uf) => setUfAberta(uf)}
          onAbrirConvenio={(slug, uf) => {
            setUfAberta(uf);
            setConvenioSlug(slug);
          }}
        />
      )}
    </div>
  );
}

/* ── Camada 1: Grid de Estados ────────────────────────────── */
function GridEstados({
  busca, setBusca, grupos, onSelecionarUf, onAbrirConvenio,
}: {
  busca: string;
  setBusca: (s: string) => void;
  grupos: { uf: string; estado_nome: string | null; convenios: Convenio[] }[];
  onSelecionarUf: (uf: string) => void;
  onAbrirConvenio: (slug: string, uf: string) => void;
}) {
  const buscaTrim = busca.trim().toLowerCase();
  const matches = useMemo(() => {
    if (buscaTrim.length < 2) return [];
    const out: (Convenio & { _uf: string; _estado: string | null })[] = [];
    for (const g of grupos) {
      for (const c of g.convenios) {
        if (
          c.nome.toLowerCase().includes(buscaTrim) ||
          (c.sheet_origem || '').toLowerCase().includes(buscaTrim)
        ) {
          out.push({ ...c, _uf: g.uf, _estado: g.estado_nome });
        }
      }
    }
    return out;
  }, [buscaTrim, grupos]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="🔍 Buscar convênio direto (ex: TJMG, GOV PA, SPPREV)…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      {buscaTrim.length >= 2 && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            {matches.length} resultado(s) para “{busca}”:
          </div>
          {matches.length === 0 ? (
            <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
              Nada encontrado. Tente outro termo ou navegue por estado abaixo.
            </CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {matches.map(c => (
                <button
                  key={c.id}
                  onClick={() => onAbrirConvenio(c.slug, c._uf)}
                  className="text-left rounded-md border border-border bg-card p-3 hover:border-primary/60 transition-colors"
                >
                  <div className="text-[10px] text-muted-foreground font-bold uppercase mb-1">
                    {c._uf} {c._estado && `— ${c._estado}`}
                  </div>
                  <div className="font-semibold text-sm leading-tight">{c.nome}</div>
                </button>
              ))}
            </div>
          )}
          <div className="text-[11px] uppercase font-bold tracking-wider text-muted-foreground pt-2">
            — ou navegue por estado —
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
        {grupos.map((g) => (
          <button
            key={g.uf}
            onClick={() => onSelecionarUf(g.uf)}
            className="rounded-xl border border-border bg-card p-4 text-center hover:border-primary/60 hover:-translate-y-0.5 transition-all"
          >
            <div className="text-3xl font-black text-primary">{g.uf}</div>
            {g.estado_nome && (
              <div className="text-[11px] text-muted-foreground mt-1.5 font-medium">
                {g.estado_nome}
              </div>
            )}
            <div className="text-[10px] text-muted-foreground/70 mt-1.5">
              {g.convenios.length} convênio{g.convenios.length === 1 ? '' : 's'}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Camada 2: Convenios do Estado ───────────────────────── */
function ListaConvenios({
  uf, estadoNome, convenios, onVoltar, onAbrirConvenio,
}: {
  uf: string;
  estadoNome: string | null;
  convenios: Convenio[];
  onVoltar: () => void;
  onAbrirConvenio: (slug: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <button onClick={onVoltar} className="text-primary hover:underline">🏛 Estados</button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground font-semibold">{uf} {estadoNome && `— ${estadoNome}`}</span>
      </div>
      <Button variant="outline" size="sm" onClick={onVoltar} className="gap-1">
        <ArrowLeft className="w-3.5 h-3.5" /> Voltar pra estados
      </Button>

      {convenios.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
          Nenhum convênio cadastrado neste estado.
        </CardContent></Card>
      ) : (
        <>
          <div className="text-xs text-muted-foreground">
            {convenios.length} convênio(s) — clique pra ver as regras e bancos:
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {convenios.map((c) => (
              <button
                key={c.id}
                onClick={() => onAbrirConvenio(c.slug)}
                className="text-left rounded-md border border-border bg-card p-3 hover:border-primary/60 transition-colors"
              >
                <div className="font-semibold text-sm leading-tight">{c.nome}</div>
                {c.sheet_origem && (
                  <div className="text-[11px] text-muted-foreground mt-1">{c.sheet_origem}</div>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Camada 3: Detalhe do Convenio ───────────────────────── */
function DetalheConvenio({
  slug, isAdmin, onVoltar, ufNome, estadoNome, detalhe, isLoadingDetalhe, erroDetalhe,
}: {
  slug: string;
  isAdmin: boolean;
  onVoltar: () => void;
  ufNome: string;
  estadoNome: string | null;
  detalhe: { ok: boolean; convenio: Convenio; bancos: BancoConvenio[] } | null;
  isLoadingDetalhe: boolean;
  erroDetalhe: Error | null;
}) {
  const router = useRouter();
  const bancosCat = useGovBancos();
  const deleteBC = useDeleteBancoConvenio();
  const [modalBanco, setModalBanco] = useState<BancoConvenio | null>(null);
  const [modalNovo, setModalNovo] = useState(false);

  const handleExcluir = (id: number, nome: string) => {
    if (!confirm(`Excluir o banco "${nome}" deste convênio?`)) return;
    deleteBC.mutate(id);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
        <button onClick={() => router.push('/governos/catalogo')} className="text-primary hover:underline">🏛 Estados</button>
        <ChevronRight className="w-3 h-3" />
        <button onClick={onVoltar} className="text-primary hover:underline">{ufNome}</button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground font-semibold">{detalhe?.convenio?.nome || '…'}</span>
      </div>

      {isLoadingDetalhe && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      )}

      {erroDetalhe && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 text-destructive flex gap-3">
            <AlertCircle className="w-5 h-5" />
            <div>
              <div className="font-bold">Erro</div>
              <div className="text-sm">{erroDetalhe.message}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {detalhe && (
        <>
          {/* Cabecalho */}
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold">{detalhe.convenio.nome}</h2>
              <div className="text-xs text-muted-foreground mt-0.5">
                {detalhe.convenio.uf}
                {detalhe.convenio.estado_nome && ` — ${detalhe.convenio.estado_nome}`}
                {detalhe.convenio.sheet_origem && ` · Aba: ${detalhe.convenio.sheet_origem}`}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/governos/holerite?convenio=${slug}`)}
              className="gap-1"
            >
              <FileText className="w-3.5 h-3.5" /> Analisar holerite
            </Button>
          </div>

          {/* Lista de bancos */}
          {detalhe.bancos.length === 0 ? (
            <Card className="border-yellow-500/50 bg-yellow-500/5">
              <CardContent className="p-5 space-y-3">
                <div className="font-bold text-yellow-500">⚠️ Sem bancos cadastrados</div>
                <div className="text-sm text-muted-foreground">
                  Este convênio não tem bancos cadastrados (provavelmente só tinha
                  ITAU/MASTER/OLÉ, todos descontinuados).
                </div>
                {isAdmin && (
                  <Button size="sm" onClick={() => setModalNovo(true)} className="gap-1">
                    <Plus className="w-3.5 h-3.5" /> Adicionar banco
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="text-xs text-muted-foreground">
                  {detalhe.bancos.length} banco(s) operam este convênio:
                </div>
                {isAdmin && (
                  <Button size="sm" onClick={() => setModalNovo(true)} className="gap-1">
                    <Plus className="w-3.5 h-3.5" /> Adicionar banco
                  </Button>
                )}
              </div>
              <div className="space-y-2.5">
                {detalhe.bancos.map((b) => (
                  <BancoCard
                    key={b.id}
                    banco={b}
                    isAdmin={isAdmin}
                    onEditar={(banco) => setModalBanco(banco)}
                    onExcluir={handleExcluir}
                  />
                ))}
              </div>
            </>
          )}

          {/* Modal edicao */}
          {(modalBanco || modalNovo) && (
            <ModalEditarBanco
              open={true}
              onClose={() => { setModalBanco(null); setModalNovo(false); }}
              convenioId={detalhe.convenio.id}
              bancosCatalogo={bancosCat.data?.bancos || []}
              banco={modalBanco}
            />
          )}
        </>
      )}
    </div>
  );
}
