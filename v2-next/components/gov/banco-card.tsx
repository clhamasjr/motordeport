'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BancoConvenio } from '@/lib/gov-types';

interface Props {
  banco: BancoConvenio;
  isAdmin?: boolean;
  onEditar?: (b: BancoConvenio) => void;
  onExcluir?: (id: number, nome: string) => void;
}

const SECOES_LABELS: Record<string, string> = {
  principal: '📋 Operação',
  portabilidade: '🔄 Portabilidade',
  cartao: '💳 Cartão Benefício',
  publico_alvo: '👥 Público-Alvo',
};

/** Formata decimais como percentual BR: 0.0125 -> "1,25%". */
function fmtPct(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v);
  return s.replace(/\b0[.,]\d{2,5}\b/g, (m) => {
    const f = parseFloat(m.replace(',', '.'));
    if (!isNaN(f) && f > 0 && f < 1) return (f * 100).toFixed(2).replace('.', ',') + '%';
    return m;
  });
}

export function BancoCard({ banco, isAdmin, onEditar, onExcluir }: Props) {
  const [aberto, setAberto] = useState(false);
  const ops = banco.operacoes || ({} as Record<string, boolean>);
  const opsAtivas = Object.entries({ novo: 'Novo', refin: 'Refin', port: 'Port', cartao: 'Cartão' })
    .filter(([k]) => ops[k as keyof typeof ops])
    .map(([, lab]) => lab);

  const margem = banco.margem_utilizavel != null
    ? (banco.margem_utilizavel * 100).toFixed(2).replace('.', ',') + '%'
    : null;
  const taxa = banco.taxa_minima_port != null
    ? (banco.taxa_minima_port * 100).toFixed(2).replace('.', ',') + '%'
    : null;

  const brutos = banco.atributos_brutos || [];
  const porSecao: Record<string, typeof brutos> = {
    principal: [], portabilidade: [], cartao: [], publico_alvo: [],
  };
  for (const a of brutos) {
    (porSecao[a.secao] || porSecao.principal).push(a);
  }

  return (
    <Card className={cn('overflow-hidden', banco.suspenso && 'opacity-60')}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
          <div className="flex-1 min-w-0">
            <div className="font-bold text-base flex items-center gap-2 flex-wrap">
              🏦 {banco.banco_nome || '?'}
              {banco.suspenso && (
                <Badge variant="destructive" className="text-[10px]">⛔ Suspenso</Badge>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-1 justify-end">
            {opsAtivas.length === 0 ? (
              <span className="text-xs text-muted-foreground italic">sem operações cadastradas</span>
            ) : opsAtivas.map(o => (
              <Badge key={o} variant="success" className="text-[10px]">{o}</Badge>
            ))}
          </div>
        </div>

        {/* Metricas resumidas */}
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          {margem && <div><b className="text-foreground">Margem:</b> {margem}</div>}
          {(banco.idade_min || banco.idade_max) && (
            <div><b className="text-foreground">Idade:</b> {banco.idade_min || '?'}-{banco.idade_max || '?'}</div>
          )}
          {taxa && <div><b className="text-foreground">Taxa Port:</b> {taxa}</div>}
          {banco.data_corte && <div><b className="text-foreground">Corte:</b> {banco.data_corte}</div>}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setAberto(!aberto)} className="gap-1">
            <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', aberto && 'rotate-180')} />
            {aberto ? 'Esconder detalhes' : 'Ver todos os campos do roteiro'}
          </Button>
          {isAdmin && onEditar && (
            <Button variant="outline" size="sm" onClick={() => onEditar(banco)} className="gap-1 text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/10 hover:text-cyan-400">
              <Pencil className="w-3.5 h-3.5" /> Editar
            </Button>
          )}
          {isAdmin && onExcluir && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onExcluir(banco.id, banco.banco_nome || '?')}
              className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {aberto && (
        <div className="border-t border-border p-4 space-y-3 bg-background/30">
          {(['principal', 'portabilidade', 'cartao', 'publico_alvo'] as const).map((k) => {
            const items = porSecao[k] || [];
            if (items.length === 0) return null;
            return (
              <div key={k}>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1.5">
                  {SECOES_LABELS[k]}
                </div>
                <div className="space-y-1">
                  {items.map((a, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-[160px_1fr] gap-3 text-xs py-1 border-b border-dashed border-border/50 last:border-0"
                    >
                      <div className="text-muted-foreground">{a.label}</div>
                      <div className="whitespace-pre-line">{fmtPct(a.valor)}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
