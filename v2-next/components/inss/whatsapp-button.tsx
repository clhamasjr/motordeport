'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { MessageCircle, ExternalLink, Phone } from 'lucide-react';
import { InssTelefone } from '@/lib/inss-types';

interface Props {
  telefones?: InssTelefone[];
  nome?: string;
  cpf?: string;
  /** Botão compacto na toolbar (default) */
  compact?: boolean;
}

/**
 * Botão WhatsApp — abre o wa.me/{telefone} no novo tab.
 * Se houver mais de 1 telefone, mostra modal pra escolher qual.
 * Pré-preenche mensagem inicial personalizada.
 */
export function WhatsAppButton({ telefones, nome, cpf, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const lista = telefones || [];
  const temTelefone = lista.length > 0;
  const primeiroNome = (nome || '').split(' ')[0] || '';

  function montarUrl(t: InssTelefone, msg?: string): string {
    const ddd = (t.ddd || '').replace(/\D/g, '');
    const num = (t.numero || '').replace(/\D/g, '');
    if (!ddd || !num) return '#';
    const fullPhone = `55${ddd}${num}`;
    const texto = msg || `Olá ${primeiroNome}, tudo bem? Sou da LhamasCred e identifiquei algumas oportunidades pro seu benefício INSS. Posso te explicar?`;
    return `https://wa.me/${fullPhone}?text=${encodeURIComponent(texto)}`;
  }

  function abrirDireto() {
    if (lista.length === 1) {
      window.open(montarUrl(lista[0]), '_blank');
      return;
    }
    setOpen(true);
  }

  if (!temTelefone) {
    return (
      <Button
        variant="outline"
        size={compact ? 'sm' : 'default'}
        disabled
        title="Cliente sem telefone na consulta"
        className="border-green-500/20 text-muted-foreground"
      >
        <MessageCircle className="size-4" />
        WhatsApp
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        size={compact ? 'sm' : 'default'}
        onClick={abrirDireto}
        className="border-green-500/40 text-green-300 hover:bg-green-500/10"
        title={lista.length === 1
          ? `Abrir WhatsApp pra ${lista[0].ddd} ${lista[0].numero}`
          : `${lista.length} telefones — escolher qual`}
      >
        <MessageCircle className="size-4" />
        WhatsApp{lista.length > 1 ? ` (${lista.length})` : ''}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle className="size-5 text-green-400" />
              Escolha o telefone
            </DialogTitle>
            <DialogDescription>
              {nome || cpf} tem {lista.length} telefones cadastrados no INSS.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            {lista.map((t, i) => {
              const ddd = (t.ddd || '').replace(/\D/g, '');
              const num = (t.numero || '').replace(/\D/g, '');
              const valido = ddd && num;
              return (
                <button
                  key={`${ddd}-${num}-${i}`}
                  type="button"
                  disabled={!valido}
                  onClick={() => {
                    window.open(montarUrl(t), '_blank');
                    setOpen(false);
                  }}
                  className="w-full text-left rounded-md border border-border bg-card/50 p-3 hover:border-green-500/60 hover:bg-green-500/5 transition disabled:opacity-50"
                >
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <Phone className="size-4 text-green-400" />
                      <span className="font-mono text-base">
                        ({ddd}) {num}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-green-400">
                      <ExternalLink className="size-3" />
                      Abrir wa.me
                    </div>
                  </div>
                  {!valido && (
                    <Badge variant="destructive" className="text-[10px] mt-1">
                      Telefone inválido
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
