'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Send, MessageCircle, ExternalLink, Phone, Loader2, Bot } from 'lucide-react';
import { InssParsedResult } from '@/lib/inss-types';
import { useSendMessage } from '@/hooks/use-inss-conversas';
import { toast } from 'sonner';

interface Props {
  parsed: InssParsedResult;
  cpf?: string;
  /** Linhas de oportunidade já formatadas (ex: "💰 Empréstimo novo: até R$ 12.000 em 108x") */
  linhas: string[];
  /** Instância Evolution pra envio via Sofia (opcional — sem ela, só wa.me) */
  instance?: string;
}

/**
 * Botão "Enviar oportunidades" — monta automaticamente um card com as
 * possibilidades de negócio identificadas e envia pro cliente (wa.me ou Evolution).
 * NÃO monta proposta — só comunica o que o cliente PODE fazer.
 */
export function EnviarOportunidadesButton({ parsed, cpf, linhas, instance }: Props) {
  const [open, setOpen] = useState(false);
  const telefones = parsed.telefones || [];
  const nome = parsed.beneficiario?.nome || '';
  const primeiroNome = nome.split(' ')[0] || 'tudo bem';
  const [telIdx, setTelIdx] = useState(0);
  const sendMsg = useSendMessage();

  const templatePadrao = useMemo(() => {
    const saud = `Olá ${primeiroNome}! 👋\n\nSou da *LhamasCred*. Analisei o seu benefício do INSS e separei estas oportunidades pra você:`;
    const corpo = linhas.length
      ? '\n\n' + linhas.map((l) => `• ${l}`).join('\n')
      : '\n\nNo momento não identifiquei oportunidades automáticas, mas posso fazer uma análise detalhada.';
    const fecho = `\n\nTudo isso sem sair de casa e *sem compromisso*. Quer que eu te explique melhor? 😊`;
    return saud + corpo + fecho;
  }, [primeiroNome, linhas]);

  const [mensagem, setMensagem] = useState(templatePadrao);
  // Re-sincroniza o texto quando reabre (linhas podem ter mudado)
  function abrir() {
    setMensagem(templatePadrao);
    setTelIdx(0);
    setOpen(true);
  }

  const temTelefone = telefones.length > 0;
  const telAtual = telefones[telIdx];
  const dddNum = telAtual
    ? `${(telAtual.ddd || '').replace(/\D/g, '')}${(telAtual.numero || '').replace(/\D/g, '')}`
    : '';
  const telValido = dddNum.length >= 10;

  function abrirWaMe() {
    if (!telValido) return;
    const url = `https://wa.me/55${dddNum}?text=${encodeURIComponent(mensagem)}`;
    window.open(url, '_blank');
    setOpen(false);
  }

  async function enviarEvolution() {
    if (!telValido) return;
    try {
      await sendMsg.mutateAsync({ telefone: dddNum, content: mensagem, instance });
      toast.success('Card enviado pelo WhatsApp da LhamasCred');
      setOpen(false);
    } catch {
      // toast no hook
    }
  }

  return (
    <>
      <Button
        size="sm"
        onClick={abrir}
        disabled={!temTelefone}
        className="bg-green-600 hover:bg-green-700 text-white"
        title={temTelefone ? 'Enviar card de oportunidades pro cliente' : 'Cliente sem telefone na consulta'}
      >
        <Send className="size-3.5" />
        Enviar oportunidades
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle className="size-5 text-green-400" />
              Enviar card de oportunidades
            </DialogTitle>
            <DialogDescription>
              Mensagem montada automaticamente com as oportunidades do cliente.
              Revise/edite e envie — sem montar proposta.
            </DialogDescription>
          </DialogHeader>

          {/* Telefone */}
          {telefones.length > 1 ? (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                Telefone ({telefones.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {telefones.map((t, i) => {
                  const dn = `${(t.ddd || '').replace(/\D/g, '')}${(t.numero || '').replace(/\D/g, '')}`;
                  return (
                    <button
                      key={`${dn}-${i}`}
                      type="button"
                      onClick={() => setTelIdx(i)}
                      className={`rounded-md border px-2.5 py-1 text-xs font-mono transition ${
                        i === telIdx
                          ? 'border-green-500/60 bg-green-500/15 text-green-300'
                          : 'border-border bg-card/50 hover:border-green-500/40'
                      }`}
                    >
                      ({t.ddd}) {t.numero}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : telAtual ? (
            <div className="flex items-center gap-1.5 text-sm">
              <Phone className="size-4 text-green-400" />
              <span className="font-mono">({telAtual.ddd}) {telAtual.numero}</span>
            </div>
          ) : null}

          {/* Mensagem editável */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
              Mensagem
            </div>
            <textarea
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
              rows={12}
              className="w-full rounded-md border border-border bg-background p-3 text-sm font-mono leading-relaxed resize-y focus:outline-none focus:border-green-500/60"
            />
            <div className="text-[10px] text-muted-foreground mt-1">
              {mensagem.length} caracteres
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} className="sm:mr-auto">
              Cancelar
            </Button>
            {instance && (
              <Button
                onClick={enviarEvolution}
                disabled={!telValido || sendMsg.isPending}
                className="bg-pink-600 hover:bg-pink-700 text-white"
                title="Envia direto pelo WhatsApp comercial (Sofia/Evolution) e registra na conversa"
              >
                {sendMsg.isPending ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
                Enviar pela Sofia
              </Button>
            )}
            <Button
              onClick={abrirWaMe}
              disabled={!telValido}
              className="bg-green-600 hover:bg-green-700 text-white"
              title="Abre o WhatsApp Web/app com a mensagem pronta"
            >
              <ExternalLink className="size-4" />
              Abrir no WhatsApp
            </Button>
          </DialogFooter>
          {!telValido && (
            <Badge variant="destructive" className="text-[10px] self-start">
              Telefone selecionado é inválido
            </Badge>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
