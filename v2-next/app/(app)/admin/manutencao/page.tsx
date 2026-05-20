'use client';

import { useGovReseed } from '@/hooks/use-gov-reseed';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Wrench, RefreshCw, AlertCircle, CheckCircle2, Landmark } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function AdminManutencaoPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const reseed = useGovReseed();

  useEffect(() => {
    if (!isLoading && user && user.role !== 'admin' && user.role !== 'gestor') {
      router.replace('/');
    }
  }, [user, isLoading, router]);

  if (isLoading || !user) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <Card><CardContent className="p-8 text-center text-muted-foreground">Carregando…</CardContent></Card>
      </div>
    );
  }

  const handleReseed = () => {
    if (!confirm(
      'Recarregar catálogo de governos a partir do gov_seed.json deployado?\n\n' +
      'Vai adicionar convênios/bancos novos. Suas edições manuais ficam protegidas (editado_manual=true).'
    )) return;
    reseed.mutate();
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Wrench className="w-6 h-6" /> Manutenção
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Operações administrativas pontuais.
        </p>
      </div>

      {/* Reseed Governos */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="font-bold text-base flex items-center gap-2">
                <Landmark className="w-5 h-5 text-primary" />
                Reseed Catálogo de Governos
              </div>
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                Recarrega convênios + bancos a partir do <code className="px-1 py-0.5 rounded bg-secondary/50">/gov_seed.json</code> deployado.
                Use após atualizar a planilha original e regenerar o seed.
              </p>
              <div className="mt-2 text-[11px] text-green-400/90 flex items-start gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  Suas edições manuais ficam <b>protegidas</b> — registros com{' '}
                  <code className="px-1 rounded bg-secondary/50">editado_manual=true</code> não são tocados.
                </span>
              </div>
            </div>
            <Button onClick={handleReseed} disabled={reseed.isPending} className="gap-2 flex-shrink-0">
              <RefreshCw className={reseed.isPending ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} />
              {reseed.isPending ? 'Aplicando…' : 'Reseed'}
            </Button>
          </div>

          {/* Resultado */}
          {reseed.data && (
            <div className="rounded-md border border-green-500/30 bg-green-500/5 p-3 text-xs space-y-1">
              <div className="flex items-center gap-2 text-green-400 font-bold">
                <CheckCircle2 className="w-4 h-4" />
                Concluído em {((reseed.data.duracao_ms || 0) / 1000).toFixed(1)}s
              </div>
              <div className="flex flex-wrap gap-2 text-muted-foreground">
                <Badge variant="muted">{reseed.data.stats?.bancos ?? 0} bancos</Badge>
                <Badge variant="muted">{reseed.data.stats?.convenios ?? 0} convênios</Badge>
                <Badge variant="muted">{reseed.data.stats?.banco_convenio ?? 0} relações</Badge>
              </div>
            </div>
          )}

          {reseed.error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm flex items-start gap-2 text-destructive">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>{(reseed.error as Error).message}</div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
