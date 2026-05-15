'use client';

import { useState } from 'react';
import { useConversasAtivas, useConversa, useRetomarConversa } from '@/hooks/use-clt-conversas';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { formatCpf, formatDateBR, cn } from '@/lib/utils';
import { MessageSquare, Search, Play, Phone, User, RefreshCw, Bot, CheckCircle2 } from 'lucide-react';

const ETAPA_LABEL: Record<string, { label: string; variant: 'info' | 'warning' | 'success' | 'muted' }> = {
  inicio: { label: 'Início', variant: 'info' },
  aguardando_consentimento_lgpd: { label: 'Aguarda LGPD', variant: 'warning' },
  coletando_cpf: { label: 'Pedindo CPF', variant: 'info' },
  aguardando_autorizacao_c6: { label: 'Aguarda Selfie C6', variant: 'warning' },
  simulando: { label: 'Simulando', variant: 'info' },
  apresentando_ofertas: { label: 'Apresentando Ofertas', variant: 'info' },
  coletando_dados: { label: 'Coletando Dados', variant: 'warning' },
  proposta_criada: { label: 'Proposta Criada', variant: 'success' },
  link_enviado: { label: 'Link Enviado', variant: 'success' },
  fechada_venda: { label: 'Fechada (venda)', variant: 'success' },
  fechada_sem_venda: { label: 'Fechada (sem venda)', variant: 'muted' },
  pausada_humano: { label: 'Pausada (humano)', variant: 'warning' },
};

export default function ConversasIaCltPage() {
  const [busca, setBusca] = useState('');
  const [telSelecionado, setTelSelecionado] = useState<string | null>(null);
  const { data: conversas = [], isLoading, refetch, isFetching } = useConversasAtivas();

  const filtradas = conversas.filter((c) => {
    if (!busca) return true;
    const q = busca.toLowerCase().replace(/\D/g, '');
    if (q && (c.telefone || '').includes(q)) return true;
    if ((c.nome || '').toLowerCase().includes(busca.toLowerCase())) return true;
    if (q && (c.cpf || '').includes(q)) return true;
    return false;
  });

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <MessageSquare className="w-6 h-6 text-primary" /> CLT — Conversas IA (WhatsApp)
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Conversas ativas do agente vendedor com clientes CLT no WhatsApp.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2">
          <RefreshCw className={isFetching ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} />
          Atualizar
        </Button>
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Telefone, nome ou CPF..." className="pl-9"
              value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
      )}

      {!isLoading && filtradas.length === 0 && (
        <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">
          Nenhuma conversa ativa. Quando um cliente CLT iniciar conversa no WhatsApp, aparece aqui.
        </CardContent></Card>
      )}

      {filtradas.length > 0 && (
        <div className="space-y-2">
          {filtradas.map((c) => {
            const etapa = ETAPA_LABEL[c.etapa || 'inicio'] || { label: c.etapa || '?', variant: 'muted' as const };
            return (
              <Card
                key={c.id}
                className={cn(
                  'border-l-4 cursor-pointer hover:bg-secondary/30 transition-colors',
                  c.pausada_por_humano ? 'border-l-yellow-500' : 'border-l-primary/40',
                )}
                onClick={() => setTelSelecionado(c.telefone)}
              >
                <CardContent className="p-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 flex-1 min-w-[250px]">
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      {c.pausada_por_humano ? (
                        <User className="w-4 h-4 text-yellow-500" />
                      ) : (
                        <Bot className="w-4 h-4 text-primary" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate flex items-center gap-2">
                        {c.nome || '(sem nome)'}
                        {c.consentimento_lgpd && (
                          <CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0" />
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                        <Phone className="w-3 h-3" /> {c.telefone}
                        {c.cpf && <span>· CPF {formatCpf(c.cpf)}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {c.banco_escolhido && (
                      <Badge variant="muted" className="text-[10px]">{c.banco_escolhido}</Badge>
                    )}
                    <Badge variant={etapa.variant} className="text-[10px]">{etapa.label}</Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {formatDateBR(c.last_message_at || '')}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ModalConversa telefone={telSelecionado} onClose={() => setTelSelecionado(null)} />
    </div>
  );
}

function ModalConversa({ telefone, onClose }: { telefone: string | null; onClose: () => void }) {
  const { data: c, isLoading } = useConversa(telefone);
  const retomar = useRetomarConversa();

  return (
    <Dialog open={!!telefone} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {c?.pausada_por_humano ? <User className="w-4 h-4 text-yellow-500" /> : <Bot className="w-4 h-4 text-primary" />}
            {c?.nome || 'Conversa'}
          </DialogTitle>
          <DialogDescription>
            <span className="flex items-center gap-2 flex-wrap">
              <Phone className="w-3 h-3" /> {telefone}
              {c?.cpf && <span>· CPF {formatCpf(c.cpf)}</span>}
              {c?.banco_escolhido && <Badge variant="muted" className="text-[10px]">{c.banco_escolhido}</Badge>}
            </span>
          </DialogDescription>
        </DialogHeader>

        {isLoading && <Skeleton className="h-40" />}

        {c && (
          <>
            {c.pausada_por_humano && (
              <div className="rounded-md bg-yellow-500/10 border border-yellow-500/30 p-3 flex items-center justify-between gap-2 flex-wrap">
                <div className="text-sm text-yellow-200">
                  <b>⏸ Conversa pausada</b> — humano está atendendo. IA não responde mais.
                </div>
                <Button size="sm" variant="outline" disabled={retomar.isPending}
                  onClick={() => retomar.mutate(telefone!)}
                  className="gap-1 border-primary/50 text-primary">
                  <Play className="w-3 h-3" />
                  {retomar.isPending ? 'Retomando...' : 'Retomar IA'}
                </Button>
              </div>
            )}

            {/* Histórico */}
            {c.historico && c.historico.length > 0 && (
              <div>
                <div className="text-[10px] uppercase font-bold text-muted-foreground mb-2">Últimas mensagens</div>
                <div className="max-h-[400px] overflow-auto space-y-1.5 border border-border rounded-md p-3 bg-background/30">
                  {c.historico.slice(-15).map((m, i) => (
                    <div key={i} className={cn(
                      'p-2 rounded text-xs',
                      m.role === 'user'
                        ? 'bg-secondary/50 ml-0 mr-12'
                        : 'bg-primary/10 ml-12 mr-0',
                    )}>
                      <div className="text-[9px] uppercase font-bold mb-0.5 flex items-center gap-1">
                        {m.role === 'user' ? <><User className="w-2.5 h-2.5" /> Cliente</> : <><Bot className="w-2.5 h-2.5" /> IA</>}
                        <span className="text-muted-foreground/50 normal-case">{formatDateBR(m.ts)}</span>
                      </div>
                      <div className="whitespace-pre-wrap">{m.content}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
