'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useInssBaseStore } from '@/hooks/use-inss-base-store';
import { parseFileToBase } from '@/lib/inss-base-parser';
import { Upload, FileSpreadsheet, X, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

export function BaseUpload() {
  const { base, setBase, reset } = useInssBaseStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setLoading(true);
    setError(null);
    try {
      const processed = await parseFileToBase(file);
      if (!processed) {
        setError('Não consegui ler a planilha. Verifique se tem cabeçalho na primeira linha.');
        return;
      }
      setBase(processed);
      toast.success(
        `Base "${file.name}" carregada — ${processed.analise.length} contratos, ${processed.elegiveis.length} elegíveis`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao processar';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  if (base) {
    return (
      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <FileSpreadsheet className="size-8 text-green-400 shrink-0" />
            <div className="min-w-0">
              <div className="font-semibold truncate">{base.fname || '(sem nome)'}</div>
              <div className="text-xs text-muted-foreground">
                {base.analise.length} contratos · <strong className="text-green-400">{base.elegiveis.length} elegíveis</strong>
                {base.rmcRcc.length > 0 && ` · ${base.rmcRcc.length} c/ margem ou cartão`}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={loading}>
              <Upload className="size-4" />
              Outra base
            </Button>
            <Button variant="ghost" size="sm" onClick={reset} className="text-destructive">
              <X className="size-4" />
              Descartar
            </Button>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            className="hidden"
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className="border-dashed border-2 cursor-pointer hover:bg-muted/30 transition-colors"
      onClick={() => inputRef.current?.click()}
    >
      <CardContent className="p-10 text-center">
        <Upload className="size-12 mx-auto mb-3 text-muted-foreground/50" />
        <div className="font-semibold text-lg mb-1">Carregar base XLSX</div>
        <div className="text-sm text-muted-foreground mb-4">
          {loading ? 'Processando...' : 'Clique pra selecionar (.xlsx, .xls ou .csv)'}
        </div>
        <Button disabled={loading} size="sm">
          {loading ? 'Processando...' : 'Selecionar arquivo'}
        </Button>
        {error && (
          <div className="mt-4 inline-flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="size-4" />
            {error}
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          className="hidden"
        />
      </CardContent>
    </Card>
  );
}
