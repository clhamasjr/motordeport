'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Send, MessageCircle, ExternalLink, Phone, Loader2, Bot, Copy, Check, ImageDown } from 'lucide-react';
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
  const [copiado, setCopiado] = useState(false);
  const sendMsg = useSendMessage();

  // Identificação do benefício (importante quando o CPF tem mais de 1)
  const nb = (parsed.beneficiario?.nb || parsed.beneficio?.nb || '').toString().trim();
  const especie = (parsed.beneficio?.especie || '').toString().trim();
  const valorBenef = (parsed.beneficio?.valor || '').toString().trim();

  const templatePadrao = useMemo(() => {
    const saud = `Olá ${primeiroNome}! 👋\n\nSou da *LhamasCred*.`;
    const ident = nb
      ? ` Sobre o seu benefício *${nb}*${especie ? ` (${especie})` : ''}, analisei e separei estas oportunidades pra você:`
      : ` Analisei o seu benefício do INSS e separei estas oportunidades pra você:`;
    const corpo = linhas.length
      ? '\n\n' + linhas.map((l) => `• ${l}`).join('\n')
      : '\n\nNo momento não identifiquei oportunidades automáticas, mas posso fazer uma análise detalhada.';
    const fecho = `\n\nTudo isso sem sair de casa e *sem compromisso*. Quer que eu te explique melhor? 😊`;
    return saud + ident + corpo + fecho;
  }, [primeiroNome, nb, especie, linhas]);

  const [mensagem, setMensagem] = useState(templatePadrao);
  // Re-sincroniza o texto quando reabre (linhas podem ter mudado)
  function abrir() {
    setMensagem(templatePadrao);
    setTelIdx(0);
    setCopiado(false);
    setOpen(true);
  }

  async function copiarMensagem() {
    try {
      await navigator.clipboard.writeText(mensagem);
      setCopiado(true);
      toast.success('Mensagem copiada — é só colar no WhatsApp');
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // Fallback pra navegadores sem clipboard API (ou HTTP)
      const ta = document.createElement('textarea');
      ta.value = mensagem;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand('copy');
        setCopiado(true);
        toast.success('Mensagem copiada — é só colar no WhatsApp');
        setTimeout(() => setCopiado(false), 2500);
      } catch {
        toast.error('Não consegui copiar — selecione o texto e copie manualmente');
      }
      document.body.removeChild(ta);
    }
  }

  // ── Gera um JPG do card de oportunidades (canvas nativo, sem libs) ──
  function gerarImagem() {
    const W = 1080;
    const PADX = 72;
    const innerW = W - PADX * 2;

    const wrap = (ctx: CanvasRenderingContext2D, text: string, maxW: number) => {
      const words = text.split(' ');
      const out: string[] = [];
      let line = '';
      for (const w of words) {
        const test = line ? line + ' ' + w : w;
        if (ctx.measureText(test).width > maxW && line) { out.push(line); line = w; }
        else line = test;
      }
      if (line) out.push(line);
      return out;
    };
    const rr = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };

    // 1ª passada: medir
    const m = document.createElement('canvas').getContext('2d');
    if (!m) { toast.error('Navegador não suporta geração de imagem'); return; }
    const bulletPadX = 40;
    const bulletInnerW = innerW - bulletPadX - 24;
    m.font = '600 34px Arial';
    const itens = linhas.length ? linhas : ['Análise detalhada disponível — fale com a gente.'];
    const blocks = itens.map((l) => wrap(m, l, bulletInnerW));

    const lineH = 46;
    const blockGap = 22;
    let H = 64 + 64 + 44 + 44 + 58;       // top + logo + subtitulo + divisor + olá nome
    if (nb) H += 42;                       // linha benefício
    H += 36;                               // gap antes dos bullets
    for (const b of blocks) H += (28 + b.length * lineH + 28) + blockGap;
    H += 24 + 48 + 40 + 56;               // gap + rodapé linha1 + linha2 + bottom

    // 2ª passada: desenhar
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = Math.round(H);
    const ctx = cv.getContext('2d');
    if (!ctx) { toast.error('Navegador não suporta geração de imagem'); return; }

    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b1626');
    g.addColorStop(1, '#0a1f1a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#22d3ee';
    ctx.fillRect(0, 0, 12, H);

    ctx.textBaseline = 'top';
    let y = 64;
    ctx.fillStyle = '#22d3ee';
    ctx.font = '800 54px Arial';
    ctx.fillText('LhamasCred', PADX, y);
    y += 64;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '400 26px Arial';
    ctx.fillText('Oportunidades pro seu benefício INSS', PADX, y);
    y += 44;
    ctx.strokeStyle = 'rgba(148,163,184,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(PADX, y + 8); ctx.lineTo(W - PADX, y + 8); ctx.stroke();
    y += 44;
    ctx.fillStyle = '#f1f5f9';
    ctx.font = '700 44px Arial';
    ctx.fillText(`Olá, ${primeiroNome}!`, PADX, y);
    y += 58;
    if (nb) {
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '400 28px Arial';
      ctx.fillText(`Benefício ${nb}${especie ? ' • ' + especie : ''}`, PADX, y);
      y += 42;
    }
    y += 36;

    for (const b of blocks) {
      const bh = 28 + b.length * lineH + 28;
      ctx.fillStyle = 'rgba(34,211,238,0.08)';
      rr(ctx, PADX, y, innerW, bh, 18); ctx.fill();
      ctx.fillStyle = 'rgba(52,211,153,0.9)';
      rr(ctx, PADX, y, 8, bh, 4); ctx.fill();
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '600 34px Arial';
      let ty = y + 28;
      for (const ln of b) { ctx.fillText(ln, PADX + bulletPadX, ty); ty += lineH; }
      y += bh + blockGap;
    }
    y += 24;
    ctx.fillStyle = '#34d399';
    ctx.font = '700 30px Arial';
    ctx.fillText('Sem sair de casa e sem compromisso.', PADX, y);
    y += 48;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '400 26px Arial';
    ctx.fillText('Fale com a LhamasCred', PADX, y);

    const url = cv.toDataURL('image/jpeg', 0.92);
    const a = document.createElement('a');
    a.href = url;
    const safe = primeiroNome.replace(/[^a-zA-Z0-9]/g, '') || 'cliente';
    a.download = `oportunidades_${safe}${nb ? '_' + nb : ''}.jpg`;
    a.click();
    toast.success('Imagem JPG gerada — confira seus downloads');
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
        className="bg-green-600 hover:bg-green-700 text-white"
        title="Gerar mensagem de oportunidades pra copiar ou enviar"
      >
        <Send className="size-3.5" />
        Gerar mensagem
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
              Edite se quiser, copie e cole no WhatsApp — sem montar proposta.
            </DialogDescription>
          </DialogHeader>

          {!temTelefone && (
            <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-2 text-xs text-yellow-300">
              Cliente sem telefone na consulta — gere a mensagem, copie e cole no WhatsApp manualmente.
            </div>
          )}

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
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Mensagem
              </div>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={gerarImagem}
                  className="h-7"
                  title="Gerar um card em imagem (JPG) pra mandar pro cliente"
                >
                  <ImageDown className="size-3.5" />
                  Baixar JPG
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={copiarMensagem}
                  className={copiado ? 'border-green-500/60 text-green-400 h-7' : 'h-7'}
                >
                  {copiado ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copiado ? 'Copiado!' : 'Copiar'}
                </Button>
              </div>
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
