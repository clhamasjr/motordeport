'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FileText, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { useAnalisarFedContracheque } from '@/hooks/use-fed-analise';
import { useFedConvenios } from '@/hooks/use-fed-catalogo';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { UploadZone } from '@/components/fed/upload-zone';
import { ResultadoAnalise } from '@/components/fed/resultado-analise';
import { ErrorState, LoadingState, OperationBanner } from '@/components/system-state';
import { categoriaLabel } from '@/lib/fed-types';

export default function FederalAnalisePage() {
  return (
    <Suspense fallback={<LoadingState title="Preparando análise" description="Carregando convênios e opções disponíveis." />}>
      <FederalAnaliseInner />
    </Suspense>
  );
}

function FederalAnaliseInner() {
  const searchParams = useSearchParams();
  const convFromUrl = searchParams.get('conv') || '';
  const [contracheque, setContracheque] = useState<File | null>(null);
  const [extrato, setExtrato] = useState<File | null>(null);
  const [convenioSlug, setConvenioSlug] = useState(convFromUrl);

  const catalog = useFedConvenios();
  const analisar = useAnalisarFedContracheque();
  const result = analisar.data;

  useEffect(() => {
    if (convFromUrl) setConvenioSlug(convFromUrl);
  }, [convFromUrl]);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contracheque || analisar.isPending) return;
    analisar.mutate({
      contracheque_file: contracheque,
      extrato_file: extrato,
      convenio_slug: convenioSlug || undefined,
    });
  }

  function resetAnalysis() {
    analisar.reset();
    setContracheque(null);
    setExtrato(null);
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="rounded-3xl border border-border/70 bg-card/45 p-6 shadow-lg shadow-black/10 backdrop-blur-xl">
        <div className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/25">
            <FileText className="size-6" aria-hidden />
          </div>
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Federal · análise assistida</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Análise de contracheque</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Envie o contracheque para identificar o convênio e os bancos compatíveis. O extrato do SIGEPE é opcional e permite avaliar portabilidade contrato a contrato.
            </p>
          </div>
        </div>
      </header>

      <form onSubmit={onSubmit} className="space-y-5" aria-busy={analisar.isPending}>
        <section aria-labelledby="documentos-title" className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Etapa 1</p>
            <h2 id="documentos-title" className="mt-1 text-lg font-semibold">Selecione os documentos</h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <UploadZone label="Contracheque do servidor" hint="Obrigatório para identificar o convênio e avaliar as regras." file={contracheque} onChange={setContracheque} />
            <UploadZone label="Extrato de consignações do SIGEPE" hint="Opcional. Necessário para simular portabilidade e troco por contrato." file={extrato} onChange={setExtrato} />
          </div>
        </section>

        <Card className="border-border/70">
          <CardContent className="space-y-3 p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Etapa 2</p>
              <h2 className="mt-1 text-lg font-semibold">Confirme o convênio</h2>
              <p className="mt-1 text-sm text-muted-foreground">Você pode selecionar um convênio ou deixar a identificação por conta da análise.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="federal-convenio">Convênio</Label>
              <select
                id="federal-convenio"
                value={convenioSlug}
                onChange={(event) => setConvenioSlug(event.target.value)}
                disabled={catalog.isLoading || !!catalog.error || analisar.isPending}
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">{catalog.isLoading ? 'Carregando convênios…' : 'Detectar automaticamente'}</option>
                {(catalog.data?.grupos || []).map((group) => (
                  <optgroup key={String(group.categoria)} label={categoriaLabel(group.categoria)}>
                    {group.convenios.map((convenio) => (
                      <option key={convenio.slug} value={convenio.slug}>{convenio.nome}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            {catalog.error && (
              <OperationBanner
                variant="warning"
                title="Catálogo indisponível"
                description="Você ainda pode usar a detecção automática ou tentar carregar a lista novamente."
                action={<Button type="button" size="sm" variant="outline" onClick={() => void catalog.refetch()}>Recarregar</Button>}
              />
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-muted-foreground">A análise pode levar alguns segundos. Mantenha esta página aberta até a conclusão.</p>
          <Button type="submit" size="lg" variant="gradient" disabled={!contracheque || analisar.isPending} className="min-w-56 gap-2">
            {analisar.isPending ? (
              <><Loader2 className="size-4 animate-spin" aria-hidden />Processando documentos…</>
            ) : (
              <><Sparkles className="size-4" aria-hidden />Analisar documentos</>
            )}
          </Button>
        </div>
      </form>

      {analisar.isPending && (
        <OperationBanner busy title="Análise em andamento" description="Estamos lendo os documentos, identificando o convênio e aplicando as regras cadastradas." />
      )}

      {analisar.isError && (
        <ErrorState
          title="Não foi possível concluir a análise"
          description="Revise os arquivos e tente novamente. Se o problema continuar, use um documento mais legível ou menor."
          onRetry={() => {
            if (!contracheque) return;
            analisar.mutate({ contracheque_file: contracheque, extrato_file: extrato, convenio_slug: convenioSlug || undefined });
          }}
        />
      )}

      {result && (
        <section aria-labelledby="resultado-title" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-400">Análise concluída</p>
              <h2 id="resultado-title" className="mt-1 text-xl font-semibold">Resultado</h2>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={resetAnalysis}>
              <RotateCcw className="size-4" aria-hidden />
              Nova análise
            </Button>
          </div>
          <ResultadoAnalise r={result} />
        </section>
      )}
    </div>
  );
}
