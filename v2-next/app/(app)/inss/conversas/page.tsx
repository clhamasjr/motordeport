'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCpf } from '@/lib/utils';
import {
  useListConversas, useConversa, useSendMessage, useToggleAgente, useSetStatusConversa,
  type ConversaResumo, type MensagemHist,
} from '@/hooks/use-inss-conversas';
import {
  MessageSquare, Search, Send, Bot, User, Phone, CheckCircle2, Clock,
  AlertCircle, X, RefreshCw,
} from 'lucide-react';

export default function ConversasInssPage() {
  const [statusFilter, setStatusFilter] = useState<'open' | 'pending' | 'resolved' | 'all'>('open');
  const [busca, setBusca] = useState('');
  const [activeTel, setActiveTel] = useState<string | null>(null);
  const { data: conversas = [], isLoading, refetch, isFetching } = useListConversas({
    status: statusFilter === 'all' ? undefined : statusFilter,
    scope: 'mine',
  });

  const filtered = useMemo(() => {
    if (!busca) return conversas;
    const q = busca.toLowerCase();
    const num = busca.replace(/\D/g, '');
    return conversas.filter(
      (c) =>
        (c.nome || '').toLowerCase().includes(q) ||
        (num && c.telefone.includes(num)) ||
        (c.cpf || '').includes(num),
    );
  }, [conversas, busca]);

  const counts = useMemo(() => {
    const open = conversas.filter((c) => c.status === 'open').length;
    const pending = conversas.filter((c) => c.status === 'pending').length;
    const resolved = conversas.filter((c) => c.status === 'resolved').length;
    return { open, pending, resolved, total: conversas.length };
  }, [conversas]);

  return (
    <div className="max-w-7xl mx-auto p-4 h-[calc(100vh-80px)]">
      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-3 h-full">
        {/* Lista de conversas */}
        <Card className="flex flex-col min-h-0">
          <CardContent className="p-3 flex flex-col gap-2 h-full overflow-hidden">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold flex items-center gap-1.5">
                <MessageSquare className="size-4 text-pink-400" />
                Sofia — Conversas
              </h2>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => refetch()}>
                <RefreshCw className={`size-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              </Button>
            </div>

            <div className="relative">
              <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar nome / CPF / telefone..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>

            <div className="flex gap-1 text-[10px]">
              <FilterPill label={`Abertas (${counts.open})`} active={statusFilter === 'open'} onClick={() => setStatusFilter('open')} />
              <FilterPill label={`Pendentes (${counts.pending})`} active={statusFilter === 'pending'} onClick={() => setStatusFilter('pending')} />
              <FilterPill label={`Todas`} active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
            </div>

            <div className="flex-1 overflow-y-auto -mx-2 px-2">
              {isLoading ? (
                <div className="space-y-1">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-10 text-xs text-muted-foreground">
                  Nenhuma conversa {statusFilter !== 'all' && statusFilter}.
                </div>
              ) : (
                <div className="space-y-1">
                  {filtered.map((c) => (
                    <ConversaListItem
                      key={c.telefone}
                      c={c}
                      active={c.telefone === activeTel}
                      onClick={() => setActiveTel(c.telefone)}
                    />
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Chat ativo */}
        <Card className="flex flex-col min-h-0">
          <CardContent className="p-0 flex flex-col h-full overflow-hidden">
            {activeTel ? (
              <ChatPainel telefone={activeTel} onClose={() => setActiveTel(null)} />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-muted-foreground">
                <MessageSquare className="size-16 opacity-20 mb-3" />
                <div className="text-sm">Selecione uma conversa</div>
                <div className="text-xs mt-1">
                  As mensagens da Sofia + cliente aparecem aqui em tempo real.
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-2 py-1 rounded-md font-semibold transition-colors ${
        active ? 'bg-primary text-primary-foreground' : 'bg-muted/40 hover:bg-muted'
      }`}
    >
      {label}
    </button>
  );
}

function ConversaListItem({
  c, active, onClick,
}: { c: ConversaResumo; active: boolean; onClick: () => void }) {
  const ag = !!c.agente_ativo;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-2 rounded-md transition-colors ${
        active ? 'bg-muted ring-1 ring-primary/40' : 'hover:bg-muted/40'
      }`}
    >
      <div className="flex items-center justify-between mb-0.5">
        <div className="font-semibold text-xs truncate flex items-center gap-1">
          {c.unread && c.unread > 0 ? (
            <Badge variant="destructive" className="text-[9px] h-4 px-1">{c.unread}</Badge>
          ) : null}
          {c.nome || '(sem nome)'}
        </div>
        <Badge variant={ag ? 'success' : 'warning'} className="text-[9px] h-4 px-1">
          {ag ? '🤖' : '👤'}
        </Badge>
      </div>
      <div className="text-[10px] font-mono text-muted-foreground">{c.telefone}</div>
      {c.last_msg_preview && (
        <div className="text-[10px] text-muted-foreground truncate mt-0.5">
          {c.last_msg_role === 'sofia' && '🤖 '}
          {c.last_msg_role === 'me' && '💼 '}
          {c.last_msg_preview}
        </div>
      )}
      {c.lead_score != null && c.lead_score > 0 && (
        <div className="flex gap-1 mt-1 flex-wrap">
          <Badge variant="muted" className="text-[9px] h-4 px-1 font-mono">🔥 {c.lead_score}</Badge>
          {c.intencao && <Badge variant="info" className="text-[9px] h-4 px-1">{c.intencao}</Badge>}
        </div>
      )}
    </button>
  );
}

function ChatPainel({ telefone, onClose }: { telefone: string; onClose: () => void }) {
  const { data: conv, isLoading, error } = useConversa(telefone);
  const send = useSendMessage();
  const toggle = useToggleAgente();
  const setStatus = useSetStatusConversa();
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll para baixo quando nova msg chega
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conv?.historico?.length]);

  if (isLoading) return <div className="p-4"><Skeleton className="h-full" /></div>;
  if (error) return <div className="p-4 text-destructive flex items-center gap-2"><AlertCircle className="size-4" />{(error as Error).message}</div>;
  if (!conv) return null;

  const hist = conv.historico || [];
  const ag = !!conv.agente_ativo;

  return (
    <>
      {/* Header */}
      <div className="border-b border-border p-3 flex items-center gap-2 flex-wrap">
        <div className="size-9 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold">
          {(conv.nome || '?')[0].toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{conv.nome || '(sem nome)'}</div>
          <div className="text-[10px] text-muted-foreground font-mono flex items-center gap-1">
            <Phone className="size-3" />{conv.telefone}
            {conv.cpf && <span>· CPF {formatCpf(conv.cpf)}</span>}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className={ag ? 'border-green-500/40 text-green-400' : 'border-orange-500/40 text-orange-400'}
          onClick={() => toggle.mutate({ telefone, ativar: !ag })}
          disabled={toggle.isPending}
        >
          {ag ? <><Bot className="size-3.5" />Sofia ativa</> : <><User className="size-3.5" />Humano</>}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setStatus.mutate({ telefone, status: conv.status === 'open' ? 'resolved' : 'open' })}
        >
          {conv.status === 'open' ? <CheckCircle2 className="size-3.5" /> : <Clock className="size-3.5" />}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </div>

      {/* Tags Insights */}
      {(conv.intencao || conv.sentimento || conv.lead_score != null || conv.handoff_motivo) && (
        <div className="border-b border-border px-3 py-1.5 flex flex-wrap gap-1 bg-purple-500/5">
          {conv.lead_score != null && conv.lead_score > 0 && (
            <Badge variant="muted" className="text-[10px] font-mono">🔥 {conv.lead_score}</Badge>
          )}
          {conv.intencao && <Badge variant="info" className="text-[10px]">{conv.intencao}</Badge>}
          {conv.sentimento && <Badge variant="muted" className="text-[10px]">{conv.sentimento}</Badge>}
          {conv.handoff_motivo && <Badge variant="destructive" className="text-[10px]">⚠ {conv.handoff_motivo}</Badge>}
        </div>
      )}

      {/* Mensagens */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {hist.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-10">
            Sem mensagens ainda. Mande a primeira.
          </div>
        )}
        {hist.map((m, i) => <MsgBubble key={i} msg={m} />)}
      </div>

      {/* Aviso quando Sofia está pausada */}
      {!ag && (
        <div className="border-t border-border px-3 py-1.5 bg-orange-500/5 text-[10px] text-orange-400 font-semibold">
          👤 Você assumiu — Sofia pausada. Suas mensagens vão direto pro cliente.
        </div>
      )}

      {/* Input */}
      <div className="border-t border-border p-2 flex gap-2">
        <Input
          placeholder="Digite uma mensagem..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && text.trim()) {
              e.preventDefault();
              send.mutate({ telefone, content: text.trim(), instance: conv.instance });
              setText('');
            }
          }}
          className="text-sm"
        />
        <Button
          onClick={() => {
            if (!text.trim()) return;
            send.mutate({ telefone, content: text.trim(), instance: conv.instance });
            setText('');
          }}
          disabled={!text.trim() || send.isPending}
        >
          <Send className="size-4" />
        </Button>
      </div>
    </>
  );
}

function MsgBubble({ msg }: { msg: MensagemHist }) {
  const left = msg.role === 'cliente';
  const styles = {
    cliente: { bg: 'bg-muted', label: 'Cliente', cor: 'text-muted-foreground' },
    sofia: { bg: 'bg-purple-500/15 ring-1 ring-purple-500/30', label: '🤖 Sofia', cor: 'text-purple-400' },
    me: { bg: 'bg-green-500/15 ring-1 ring-green-500/30', label: '💼 Você', cor: 'text-green-400' },
  };
  const st = styles[msg.role as keyof typeof styles] || styles.me;
  const time = msg.ts ? new Date(msg.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <div className={`flex ${left ? 'justify-start' : 'justify-end'}`}>
      <div className={`max-w-[80%] ${st.bg} rounded-lg p-2.5 text-xs`}>
        <div className={`text-[9px] font-bold uppercase tracking-wider mb-0.5 ${st.cor}`}>
          {st.label}
        </div>
        <div className="text-foreground whitespace-pre-wrap break-words">{msg.content}</div>
        <div className="text-[9px] text-muted-foreground text-right mt-1">{time}</div>
      </div>
    </div>
  );
}
