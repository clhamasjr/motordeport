'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BancoState, BancoSlug } from '@/lib/clt-types';
import { formatBRL, formatCnpj, cn } from '@/lib/utils';
import { Loader2, Wrench, AlertCircle, CheckCircle2, Camera, FileText } from 'lucide-react';

const BANCO_LABEL: Record<BancoSlug, string> = {
  presencabank: 'PresençaBank',
  multicorban: 'Multicorban',
  v8_qi: 'V8 (QI Tech)',
  v8_celcoin: 'V8 (Celcoin)',
  joinbank: 'QualiBanking',
  mercantil: 'Mercantil',
  handbank: 'Handbank · UY3',
  c6: 'C6 Bank',
  fintech_qi: 'Fintech (QI Tech)',
  fintech_celcoin: 'Fintech (Celcoin)',
};

const BANCO_COR: Record<BancoSlug, string> = {
  presencabank: 'border-l-bank-pb',
  multicorban: 'border-l-muted',
  v8_qi: 'border-l-bank-v8',
  v8_celcoin: 'border-l-bank-v8',
  joinbank: 'border-l-bank-joinbank',
  mercantil: 'border-l-bank-mercantil',
  handbank: 'border-l-bank-handbank',
  c6: 'border-l-bank-c6',
  fintech_qi: 'border-l-bank-fintech_qi',
  fintech_celcoin: 'border-l-bank-fintech_celcoin',
};

interface Props {
  banco: BancoSlug;
  state: BancoState;
  onSimularDigitar?: () => void;
}

function StatusPill({ state }: { state: BancoState }) {
  if (state.emManutencao || state.status === 'em_manutencao') {
    return (
      <Badge variant="warning" className="gap-1">
        <Wrench className="w-3 h-3" />
        Manutenção
      </Badge>
    );
  }
  if (state.status === 'processando' || state.status === 'pending') {
    return (
      <Badge variant="info" className="gap-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        Processando
      </Badge>
    );
  }
  if (state.status === 'ok' && state.disponivel) {
    return (
      <Badge variant="success" className="gap-1">
        <CheckCircle2 className="w-3 h-3" />
        Disponível
      </Badge>
    );
  }
  if (state.status === 'bloqueado' || state.precisaAutorizacao) {
    return <Badge variant="warning">Aguarda autorização</Badge>;
  }
  return <Badge variant="muted">Indisponível</Badge>;
}

export function BancoOfertaCard({ banco, state, onSimularDigitar }: Props) {
  const label = BANCO_LABEL[banco] || banco;
  const cor = BANCO_COR[banco] || 'border-l-muted';
  const isManutencao = state.emManutencao || state.status === 'em_manutencao';
  const margem = state.dados?.margemDisponivel || 0;
  const empregador = state.dados?.empregador;
  const cnpj = state.dados?.empregadorCnpj;
  const valorLiquido = state.dados?.valorLiquido || 0;
  const parcelas = state.dados?.parcelas;
  const valorParcela = state.dados?.valorParcela;
  const disponivel = state.status === 'ok' && state.disponivel;

  return (
    <Card
      className={cn(
        'border-l-4 p-3 space-y-2',
        cor,
        isManutencao && 'opacity-65',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="font-bold text-sm flex items-center gap-1.5">
          🏦 {label}
        </div>
        <StatusPill state={state} />
      </div>

      {/* Mensagem principal */}
      {isManutencao ? (
        <div className="text-xs text-muted-foreground">{state.mensagem || '🔧 Em manutenção'}</div>
      ) : disponivel ? (
        <div className="space-y-1.5">
          {/* Valor liberado quando tem simulação detalhada */}
          {valorLiquido > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[10px] text-muted-foreground uppercase">Valor</div>
                <div className="text-xl font-black text-green-400">{formatBRL(valorLiquido)}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase">Parcelas</div>
                <div className="text-base font-bold">
                  {parcelas || '?'}x {valorParcela ? formatBRL(valorParcela) : ''}
                </div>
              </div>
            </div>
          )}

          {/* Margem real (sempre que tem) */}
          {margem > 0 && (
            <div className="text-sm">
              <span className="text-muted-foreground">Margem real:</span>{' '}
              <b>{formatBRL(margem)}</b>
            </div>
          )}

          {/* Empregador + CNPJ */}
          {empregador && (
            <div className="text-xs text-muted-foreground">
              <b>Empregador:</b> {empregador.substring(0, 40)}
            </div>
          )}
          {cnpj && (
            <div className="text-xs text-muted-foreground">
              CNPJ: {formatCnpj(cnpj)}
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">{state.mensagem || 'Aguardando bancos...'}</div>
      )}

      {/* Selo extras */}
      <div className="flex flex-wrap gap-1">
        {state.statusAutorizacao === 'AGUARDANDO_AUTORIZACAO' && (
          <Badge variant="warning" className="gap-1 text-[10px]">
            <Camera className="w-3 h-3" />
            Aguarda selfie
          </Badge>
        )}
        {state.precisaAutorizacao && state.linkAutorizacao && (
          <Badge variant="info" className="gap-1 text-[10px]">
            <FileText className="w-3 h-3" />
            Link autorização
          </Badge>
        )}
      </div>

      {/* Botão Simular & Digitar */}
      {disponivel && onSimularDigitar && (
        <Button onClick={onSimularDigitar} size="sm" className="w-full mt-2">
          {valorLiquido > 0 ? '📝 Digitar Proposta' : '📝 Simular & Digitar'}
        </Button>
      )}

      {/* Re-tentar quando falhou e é retryable */}
      {state.status === 'falha' && state.retryable && (
        <Button variant="outline" size="sm" className="w-full mt-2 gap-1">
          <AlertCircle className="w-3 h-3" />
          Re-tentar
        </Button>
      )}
    </Card>
  );
}
