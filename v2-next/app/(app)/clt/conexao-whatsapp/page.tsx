'use client';

import { useState } from 'react';
import {
  useInstancesCLT,
  useConectarInstanceCLT,
  useCriarInstanceCLT,
  useApontarWebhookSofia,
  useDesconectarInstance,
} from '@/hooks/use-clt-evolution';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Smartphone, RefreshCw, Plus, QrCode, CheckCircle2, AlertCircle, Phone, LogOut, Webhook,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ConexaoWhatsAppPage() {
  const { data: instances = [], isLoading, refetch, isFetching } = useInstancesCLT();
  const conectar = useConectarInstanceCLT();
  const criar = useCriarInstanceCLT();
  const apontarWebhook = useApontarWebhookSofia();
  const desconectar = useDesconectarInstance();

  const [qr, setQr] = useState<{ instance: string; img: string } | null>(null);
  const [novaOpen, setNovaOpen] = useState(false);
  const [novoNome, setNovoNome] = useState('lhamas-clt-');

  const handleConectar = async (name: string) => {
    const r = await conectar.mutateAsync(name);
    if (r.qr) setQr({ instance: name, img: r.qr });
  };

  const handleCriar = async () => {
    const r = await criar.mutateAsync(novoNome.trim());
    setNovaOpen(false);
    setNovoNome('lhamas-clt-');
    if (r.qr) setQr({ instance: r.instance, img: r.qr });
    else {
      // Sem QR: usuário precisa clicar em "Conectar" depois
      setTimeout(() => handleConectar(r.instance), 500);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Smartphone className="w-6 h-6 text-primary" /> CLT — Conexão WhatsApp
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Conecta os chips WhatsApp do agente IA do CLT (Sofia). Cada instance é um número WhatsApp dedicado pra atender clientes.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2">
            <RefreshCw className={isFetching ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} />
            Atualizar
          </Button>
          <Button size="sm" onClick={() => setNovaOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" /> Nova Instance
          </Button>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      )}

      {/* Vazio */}
      {!isLoading && instances.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center space-y-3">
            <div className="text-5xl">📭</div>
            <div className="font-semibold">Nenhuma instance CLT criada ainda</div>
            <div className="text-sm text-muted-foreground max-w-md mx-auto">
              Clique em <b>Nova Instance</b> pra criar a primeira. O nome precisa conter <code className="bg-secondary px-1 rounded">clt</code> pra aparecer nessa tela (ex: <code className="bg-secondary px-1 rounded">lhamas-clt-1</code>).
            </div>
            <Button onClick={() => setNovaOpen(true)} className="gap-2 mt-2">
              <Plus className="w-4 h-4" /> Criar primeira instance
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Lista */}
      {instances.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {instances.map((i) => (
            <Card
              key={i.name}
              className={cn(
                'border-l-4',
                i.isOnline ? 'border-l-green-500' : 'border-l-yellow-500',
              )}
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {i.isOnline
                      ? <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                      : <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0" />}
                    <div className="font-bold text-base truncate">{i.name}</div>
                  </div>
                  <Badge variant={i.isOnline ? 'success' : 'warning'}>{i.status}</Badge>
                </div>

                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <Phone className="w-3.5 h-3.5" /> {i.numero}
                </div>

                <div className="flex gap-2 flex-wrap pt-1">
                  {!i.isOnline && (
                    <Button
                      size="sm"
                      onClick={() => handleConectar(i.name)}
                      disabled={conectar.isPending}
                      className="gap-1"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      {conectar.isPending && conectar.variables === i.name ? 'Gerando QR...' : 'Conectar (QR)'}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => apontarWebhook.mutate(i.name)}
                    disabled={apontarWebhook.isPending}
                    className="gap-1"
                  >
                    <Webhook className="w-3.5 h-3.5" />
                    Apontar Webhook (Sofia)
                  </Button>
                  {i.isOnline && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (confirm(`Desconectar ${i.name}? Isso desliga a IA até você conectar de novo.`)) {
                          desconectar.mutate(i.name);
                        }
                      }}
                      disabled={desconectar.isPending}
                      className="gap-1 text-destructive hover:text-destructive"
                    >
                      <LogOut className="w-3.5 h-3.5" /> Desconectar
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Modal QR Code */}
      <Dialog open={!!qr} onOpenChange={(o) => !o && setQr(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="w-5 h-5" /> Escanear pra conectar
            </DialogTitle>
            <DialogDescription>
              <b>{qr?.instance}</b> — abra o WhatsApp do chip → Configurações → Aparelhos Conectados → Conectar um aparelho.
            </DialogDescription>
          </DialogHeader>
          {qr && (
            <div className="flex flex-col items-center gap-3 py-2">
              <img
                src={qr.img.startsWith('data:') ? qr.img : `data:image/png;base64,${qr.img}`}
                alt="QR Code"
                className="w-72 h-72 bg-white p-2 rounded-md"
              />
              <p className="text-xs text-muted-foreground text-center">
                O QR expira em ~30 segundos. Se não escanear a tempo, clique em &quot;Conectar (QR)&quot; de novo.
              </p>
              <Button variant="outline" size="sm" onClick={() => setQr(null)}>Fechar</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal Nova Instance */}
      <Dialog open={novaOpen} onOpenChange={setNovaOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nova instance CLT</DialogTitle>
            <DialogDescription>
              O nome precisa conter <code className="bg-secondary px-1 rounded">clt</code> pra aparecer nessa tela (ex: <code className="bg-secondary px-1 rounded">lhamas-clt-2</code>).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="nova-instance-nome">Nome da instance</Label>
              <Input
                id="nova-instance-nome"
                value={novoNome}
                onChange={(e) => setNovoNome(e.target.value)}
                placeholder="lhamas-clt-2"
                onKeyDown={(e) => { if (e.key === 'Enter' && novoNome.trim()) handleCriar(); }}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setNovaOpen(false)}>Cancelar</Button>
              <Button onClick={handleCriar} disabled={criar.isPending || !novoNome.trim()}>
                {criar.isPending ? 'Criando...' : 'Criar instance'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
