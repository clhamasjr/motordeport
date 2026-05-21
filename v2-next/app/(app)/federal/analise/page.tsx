'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAnalisarFedContracheque } from '@/hooks/use-fed-analise';
import { useFedConvenios } from '@/hooks/use-fed-catalogo';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { UploadZone } from '@/components/fed/upload-zone';
import { ResultadoAnalise } from '@/components/fed/resultado-analise';
import { FileText, Loader2, AlertCircle } from 'lucide-react';
import { categoriaLabel } from '@/lib/fed-types';

export default function FederalAnalisePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Carregando...</div>}>
      <FederalAnaliseInner />
    </Suspense>
  );
}

function FederalAnaliseInner() {
  const searchParams = useSearchParams();
  const convFromUrl = searchParams.get('conv') || '';

  const [contracheque, setContracheque] = useState<File | null>(null);
  const [extrato, setExtrato] = useState<File | null>(null);
  const [convenioSlug, setConvenioSlug] = useState<string>(convFromUrl);

  // Pré-seleciona convênio quando vier da URL (após carregar a lista)
  const { data: cat } = useFedConvenios();
  useEffect(() => {
    if (convFromUrl) setConvenioSlug(convFromUrl);
  }, [convFromUrl]);

  const analisar = useAnalisarFedContracheque();
  const r = analisar.data;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!contracheque) return;
    analisar.mutate({
      contracheque_file: contracheque,
      extrato_file: extrato,
      convenio_slug: convenioSlug || undefined,
    });
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <FileText className="w-6 h-6 text-primary" /> Federal — Análise de Contracheque
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Sobe o contracheque do servidor (obrigatório) e o extrato de consignação do SIGEPE
          (opcional, mas necessário pra simular portabilidade contrato-a-contrato). A IA identifica
          o convênio, cruza com os bancos e calcula a port com troco.
        </p>
      </div>

      {/* Form */}
      <form onSubmit={onSubmit} className="space-y-4">
        {/* Upload 1 */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1.5">
            1. Contracheque (obrigatório)
          </div>
          <UploadZone
            label="Holerite/contracheque do servidor (PDF ou imagem)"
            file={contracheque}
            onChange={setContracheque}
          />
        </div>

        {/* Upload 2 */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1.5">
            2. Extrato de Consignação{' '}
            <span className="normal-case text-muted-foreground/80 font-normal">
              (opcional — habilita simulação de port + troco)
            </span>
          </div>
          <UploadZone
            label="Extrato de Consignações Vigentes (SIGEPE / portal do servidor)"
            hint="Sem o extrato, a análise mostra só os bancos compatíveis (sem simular port contrato-a-contrato)."
            file={extrato}
            onChange={setExtrato}
          />
        </div>

        {/* Seletor de convênio */}
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground mb-1.5">
              Convênio (opcional — se não escolher, a IA tenta detectar pelo contracheque):
            </div>
            <select
              value={convenioSlug}
              onChange={(e) => setConvenioSlug(e.target.value)}
              className="w-full h-10 px-3 text-sm rounded-md border border-input bg-background"
            >
              <option value="">— Detectar automaticamente —</option>
              {(cat?.grupos || []).map((g) => (
                <optgroup key={String(g.categoria)} label={categoriaLabel(g.categoria)}>
                  {g.convenios.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.nome}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex justify-center">
          <Button
            type="submit"
            disabled={!contracheque || analisar.isPending}
            className="gap-2 px-8 py-6 text-sm"
          >
            {analisar.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Analisando com IA... (pode levar 10-30s)
              </>
            ) : (
              <>
                <FileText className="w-4 h-4" />
                Analisar Contracheque
              </>
            )}
          </Button>
        </div>
      </form>

      {/* Erro */}
      {analisar.isError && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-sm text-destructive">
              {(analisar.error as Error).message}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Resultado */}
      {r && <ResultadoAnalise r={r} />}
    </div>
  );
}
