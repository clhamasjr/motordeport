'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  useEvoStatus, useEvoDiag, useResetWebhook, useStressTest, useIdleFollowup,
} from '@/hooks/use-inss-evolution';
import { Smartphone, RefreshCw, CheckCircle2, AlertCircle, Zap, MessageCircle, Activity } from 'lucide-react';

export default function ConexaoWhatsAppPage() {
  const { data: status, refetch, isFetching } = useEvoStatus();
  const diag = useEvoDiag();
  const reset = useResetWebhook();
  const stress = useStressTest();
  const idle = useIdleFollowup();
  const [instance, setInstance] = useState('testesofia');

  const evolutionOk = status?.evolution === 'Ativo';
  const claudeOk = status?.claude === 'Ativo';

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Smartphone className="size-6 text-green-400" />
          INSS — Conexão WhatsApp (Sofia + Evolution)
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Status do agente Sofia + Evolution API. Diagnóstico, reset de webhook, stress test e disparo
          manual de follow-up.
        </p>
      </div>

      {/* Status geral */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-sm">Status geral</h2>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`size-4 ${isFetching ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <StatusKpi
              label="Sofia (Claude)"
              ok={claudeOk}
              value={status?.claude || '...'}
              icon={<MessageCircle className="size-4" />}
            />
            <StatusKpi
              label="Evolution API"
              ok={evolutionOk}
              value={status?.evolution || '...'}
              icon={<Smartphone className="size-4" />}
            />
            <StatusKpi
              label="Modelo"
              ok={true}
              value={status?.model || '...'}
              cor="text-cyan-400"
              icon={<Zap className="size-4" />}
            />
            <StatusKpi
              label="Conv. ativas"
              ok={true}
              value={String(status?.activeConversations ?? 0)}
              cor="text-purple-400"
              icon={<Activity className="size-4" />}
            />
          </div>
          {status?.version && (
            <div className="text-[10px] text-muted-foreground text-center mt-2">
              {status.version}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Ações na Evolution */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <h2 className="font-bold text-sm">Diagnóstico Evolution</h2>
          <div className="flex gap-2 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Nome da instance
              </Label>
              <Input
                value={instance}
                onChange={(e) => setInstance(e.target.value)}
                placeholder="testesofia"
                className="font-mono mt-1"
              />
            </div>
            <div className="flex gap-2 items-end">
              <Button onClick={() => diag.mutate(instance)} disabled={!instance || diag.isPending} size="sm">
                <Activity className="size-4" />
                {diag.isPending ? 'Diagnosticando...' : 'Diagnosticar'}
              </Button>
              <Button
                onClick={() => {
                  if (confirm(`Reset COMPLETO do webhook da instance "${instance}"?\n\n- Desliga Chatwoot nativo\n- Apaga webhook\n- Reconfigura pra Sofia`)) {
                    reset.mutate(instance);
                  }
                }}
                variant="outline"
                size="sm"
                disabled={!instance || reset.isPending}
                className="border-yellow-500/40 text-yellow-400"
              >
                <Zap className="size-4" />
                Reset Webhook
              </Button>
            </div>
          </div>

          {diag.data && (
            <details className="mt-3" open>
              <summary className="cursor-pointer text-xs font-semibold">Resultado do diagnóstico</summary>
              <pre className="mt-2 text-[10px] bg-muted/30 p-3 rounded-md overflow-x-auto max-h-96">
                {JSON.stringify(diag.data.diag, null, 2)}
              </pre>
            </details>
          )}
        </CardContent>
      </Card>

      {/* Sofia: stress test + idle followup */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <h2 className="font-bold text-sm">Sofia — Testes e Ações</h2>

          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Stress Test (simula conversa com persona)
            </Label>
            <div className="flex gap-2 flex-wrap mt-1">
              <Button size="sm" variant="outline" onClick={() => stress.mutate('qualificado')} disabled={stress.isPending}>
                ✅ Qualificado
              </Button>
              <Button size="sm" variant="outline" onClick={() => stress.mutate('indeciso')} disabled={stress.isPending}>
                🤷 Indeciso
              </Button>
              <Button size="sm" variant="outline" onClick={() => stress.mutate('confuso')} disabled={stress.isPending}>
                😕 Confuso
              </Button>
              <Button size="sm" variant="outline" onClick={() => stress.mutate('agressivo')} disabled={stress.isPending}>
                😡 Agressivo
              </Button>
            </div>
            {stress.data && (
              <details className="mt-2" open>
                <summary className="cursor-pointer text-xs font-semibold">Log do teste ({(stress.data.log as unknown[])?.length} turnos)</summary>
                <pre className="mt-2 text-[10px] bg-muted/30 p-3 rounded-md overflow-x-auto max-h-96">
                  {JSON.stringify(stress.data.log, null, 2)}
                </pre>
              </details>
            )}
          </div>

          <div className="pt-3 border-t border-border">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Follow-up automático (Sofia volta a falar com clientes inativos 4h+)
            </Label>
            <div className="flex items-center gap-2 mt-1">
              <Button
                size="sm"
                variant="default"
                onClick={() => {
                  if (confirm('Disparar follow-up agora?\n\nSofia vai mandar mensagem pra TODAS as conversas open com agente ativo onde o cliente não responde há 4h+ (máx 20 por execução).')) {
                    idle.mutate();
                  }
                }}
                disabled={idle.isPending}
              >
                <MessageCircle className="size-4" />
                {idle.isPending ? 'Enviando...' : 'Disparar follow-up agora'}
              </Button>
              <span className="text-[10px] text-muted-foreground">
                (executado automaticamente a cada 2h via Vercel Cron)
              </span>
            </div>
            {idle.data && (
              <div className="text-xs mt-2 rounded-md bg-green-500/10 border border-green-500/30 p-2">
                ✅ {(idle.data.results as { ok?: boolean }[])?.filter((x) => x.ok).length || 0} mensagens enviadas
                de {idle.data.processed || 0} elegíveis.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusKpi({
  label, ok, value, cor, icon,
}: { label: string; ok: boolean; value: string; cor?: string; icon?: React.ReactNode }) {
  const corFinal = cor || (ok ? 'text-green-400' : 'text-red-400');
  return (
    <div className={`rounded-lg border p-2 ${ok ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {icon}
        {label}
      </div>
      <div className={`text-sm font-mono font-bold mt-1 flex items-center gap-1 ${corFinal}`}>
        {ok ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
        {value}
      </div>
    </div>
  );
}
