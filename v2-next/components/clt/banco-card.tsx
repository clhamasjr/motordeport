'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Banco, BancoConvenio, Convenio } from '@/lib/clt-bancos-types';
import { ChevronDown, Camera, FileText, Wifi, Hand, Wrench, AlertCircle } from 'lucide-react';
import { cn, formatBRL } from '@/lib/utils';

interface Props {
  banco: Banco;
  convenios: Convenio[];
  vinculos: BancoConvenio[];
}

const STATUS_API = {
  ativa: { icon: Wifi, color: 'text-green-500 bg-green-500/10 border-green-500/30', label: 'No FlowForce' },
  manual: { icon: Hand, color: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/30', label: 'No portal do banco' },
  manutencao: { icon: Wrench, color: 'text-red-400 bg-red-500/10 border-red-500/30', label: 'Em manutenção' },
} as const;

export function BancoCard({ banco, convenios, vinculos }: Props) {
  const [aberto, setAberto] = useState(false);
  const status = STATUS_API[banco.api_status] || STATUS_API.manutencao;
  const StatusIcon = status.icon;
  const convPorId = new Map(convenios.map(c => [c.id, c]));
  const vincDoBanco = vinculos.filter(v => v.banco_id === banco.id);

  return (
    <Card className="border-l-4 border-l-primary/40 overflow-hidden">
      {/* Header clicável */}
      <button
        onClick={() => setAberto(!aberto)}
        className="w-full p-4 flex items-center justify-between gap-3 hover:bg-secondary/30 transition-colors text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="font-bold text-base flex items-center gap-2">
            🏦 {banco.nome}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 font-mono">{banco.slug}</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <span
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border',
              status.color,
            )}
            title="Onde o vendedor digita: aqui no FlowForce ou no portal próprio do banco"
          >
            <StatusIcon className="w-3 h-3" /> {status.label}
          </span>
          {banco.exige_selfie && (
            <Badge variant="muted" className="gap-1 text-[10px]" title="Cliente precisa fazer selfie">
              <Camera className="w-3 h-3" /> Selfie
            </Badge>
          )}
          {banco.exige_termo && (
            <Badge variant="muted" className="gap-1 text-[10px]" title="Cliente precisa aceitar termo">
              <FileText className="w-3 h-3" /> Termo
            </Badge>
          )}
          <Badge variant={banco.ativo ? 'success' : 'destructive'} className="text-[10px]">
            {banco.ativo ? 'Operando' : 'Parado'}
          </Badge>
          <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', aberto && 'rotate-180')} />
        </div>
      </button>

      {/* Detalhes expandidos */}
      {aberto && (
        <div className="border-t border-border p-4 space-y-3 bg-background/30">
          {banco.como_funciona && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1">
                ▶️ Como o vendedor opera
              </div>
              <div className="text-sm leading-relaxed text-foreground/90">{banco.como_funciona}</div>
            </div>
          )}

          {banco.observacoes && (
            <div className="rounded-md border-l-2 border-yellow-500 bg-yellow-500/5 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-yellow-500 font-bold flex items-center gap-1 mb-0.5">
                <AlertCircle className="w-3 h-3" /> Atenção / detalhes importantes
              </div>
              <div className="text-xs text-foreground/80">{banco.observacoes}</div>
            </div>
          )}

          {/* Convênios e regras */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-2">
              📋 O que esse banco aceita
            </div>
            {vincDoBanco.length === 0 ? (
              <div className="text-xs text-muted-foreground">Sem convênios cadastrados.</div>
            ) : (
              <div className="space-y-2">
                {vincDoBanco.map(v => {
                  const conv = convPorId.get(v.convenio_id);
                  const ops = [];
                  if (v.opera_novo) ops.push('Novo');
                  if (v.opera_refin) ops.push('Refinanciamento');
                  if (v.opera_port) ops.push('Portabilidade');
                  if (v.opera_cartao) ops.push('Cartão');
                  return (
                    <div key={v.id} className="rounded-md border border-border bg-background/50 p-3">
                      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                        <div className="font-semibold text-sm">{conv?.nome || '?'}</div>
                        <div className="flex flex-wrap gap-1">
                          {ops.map(o => (
                            <Badge key={o} variant="success" className="text-[10px]">{o}</Badge>
                          ))}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs text-muted-foreground">
                        {(v.idade_min || v.idade_max) && (
                          <div><b className="text-foreground">Idade:</b> de {v.idade_min || '?'} a {v.idade_max || '?'} anos</div>
                        )}
                        {v.tempo_admissao_min_meses && (
                          <div>
                            <b className="text-foreground">Tempo na empresa:</b> mín. {v.tempo_admissao_min_meses} meses
                            {v.tempo_admissao_min_meses >= 12 && ` (${(v.tempo_admissao_min_meses / 12).toFixed(0)} ano${v.tempo_admissao_min_meses >= 24 ? 's' : ''})`}
                          </div>
                        )}
                        {v.margem_minima && <div><b className="text-foreground">Parcela mínima:</b> {formatBRL(v.margem_minima)}</div>}
                        {(v.valor_minimo || v.valor_maximo) && (
                          <div><b className="text-foreground">Valor liberado:</b> {formatBRL(v.valor_minimo || 0)} a {formatBRL(v.valor_maximo || 0)}</div>
                        )}
                        {(v.prazo_min || v.prazo_max) && (
                          <div><b className="text-foreground">Parcelas:</b> de {v.prazo_min || 0}x a {v.prazo_max || '?'}x</div>
                        )}
                        {(v.taxa_minima || v.taxa_maxima) && (
                          <div><b className="text-foreground">Taxa:</b> {v.taxa_minima || '?'}% a {v.taxa_maxima || '?'}% ao mês</div>
                        )}
                      </div>
                      {v.documentos_obrigatorios && v.documentos_obrigatorios.length > 0 && (
                        <div className="mt-2 text-[11px] text-muted-foreground">
                          📄 <b>Documentos:</b> {v.documentos_obrigatorios.join(' · ')}
                        </div>
                      )}
                      {v.observacoes && (
                        <div className="mt-1.5 text-[11px] italic text-muted-foreground/90">{v.observacoes}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
