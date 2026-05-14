'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useFilaStatus } from '@/hooks/use-clt-fila';
import { BancoSlug, FilaConsulta } from '@/lib/clt-types';
import { BancoOfertaCard } from './banco-oferta-card';
import { formatCpf, formatCnpj, formatDateBR } from '@/lib/utils';
import { X, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

// Ordem que os cards aparecem (mais usados primeiro)
const BANCOS_ORDEM: BancoSlug[] = [
  'fintech_qi', 'fintech_celcoin',
  'handbank', 'joinbank', 'mercantil',
  'c6', 'presencabank',
  'v8_qi', 'v8_celcoin',
];

interface Props {
  filaId: string;
  onClose?: () => void;
}

export function ConsultaCard({ filaId, onClose }: Props) {
  const { data: fila, isLoading, error } = useFilaStatus(filaId);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4 space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-48" />
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-2 mt-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !fila) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="p-4">
          <div className="text-destructive text-sm">Erro carregando consulta: {error?.message || 'desconhecido'}</div>
        </CardContent>
      </Card>
    );
  }

  const concluido = fila.status_geral === 'concluido';
  const cliente = fila.cliente || {};
  const vinculo = fila.vinculo;

  // Separa bancos em manutenção do resto
  const ofertas = BANCOS_ORDEM
    .filter((slug) => slug !== 'multicorban') // multicorban é enriquecimento, não banco
    .map((slug) => ({ slug, state: fila.bancos[slug] || { status: 'pending' as const } }));
  const parados = ofertas.filter((o) => o.state.emManutencao || o.state.status === 'em_manutencao');
  const operando = ofertas.filter((o) => !o.state.emManutencao && o.state.status !== 'em_manutencao');

  // Ordena operando: disponivel > processando > resto
  const prioridade = (s: typeof ofertas[number]) => {
    if (s.state.disponivel && s.state.status === 'ok') return 0;
    if (s.state.status === 'processando' || s.state.status === 'pending') return 1;
    return 2;
  };
  operando.sort((a, b) => prioridade(a) - prioridade(b));

  const totalDisponivel = ofertas.filter((o) => o.state.disponivel && o.state.status === 'ok').length;

  return (
    <Card className="border-2 border-primary/30">
      <CardContent className="p-0">
        {/* Header */}
        <div className="p-4 bg-gradient-to-br from-primary/5 to-accent/5 border-b border-border">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {concluido ? (
                  <Badge variant="success" className="gap-1">
                    <CheckCircle2 className="w-3 h-3" /> CONCLUÍDA
                  </Badge>
                ) : (
                  <Badge variant="info" className="gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> EM ANDAMENTO
                  </Badge>
                )}
                <span className="font-bold text-base truncate">{cliente.nome || '(sem nome)'}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                CPF {formatCpf(fila.cpf)}
                {cliente.idade && ` · ${cliente.idade} anos`}
                {cliente.sexo && ` · ${cliente.sexo === 'M' ? 'Masc' : 'Fem'}`}
              </div>

              {/* Telefones */}
              {cliente.telefones && cliente.telefones.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {cliente.telefones.slice(0, 4).map((t, i) => (
                    <a
                      key={i}
                      href={`https://wa.me/55${t.completo}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] px-2 py-0.5 rounded bg-green-500/10 text-green-400 hover:bg-green-500/20"
                    >
                      📱 {t.ddd} {t.numero}
                    </a>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-start gap-3">
              {vinculo && (
                <div className="text-right text-xs">
                  {vinculo.fonte === 'caged_2024' && (
                    <div className="text-yellow-500 uppercase font-bold text-[9px] mb-0.5">📊 Base CAGED 2024</div>
                  )}
                  {vinculo.empregador && (
                    <div className="font-bold text-bank-c6 text-xs">{vinculo.empregador.substring(0, 30)}</div>
                  )}
                  {vinculo.cnpj && (
                    <div className="text-muted-foreground">{formatCnpj(vinculo.cnpj)}</div>
                  )}
                </div>
              )}
              {onClose && (
                <Button variant="ghost" size="icon" onClick={onClose} title="Fechar">
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Bancos parados (manutenção) */}
        {parados.length > 0 && (
          <div className="p-3 pb-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
              🔧 Bancos parados ({parados.length})
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {parados.map(({ slug, state }) => (
                <BancoOfertaCard key={slug} banco={slug} state={state} />
              ))}
            </div>
          </div>
        )}

        {/* Bancos operando */}
        <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {operando.map(({ slug, state }) => (
            <BancoOfertaCard
              key={slug}
              banco={slug}
              state={state}
              onSimularDigitar={
                state.disponivel && state.status === 'ok'
                  ? () => toast.info('Modal de digitação será migrado no próximo deploy.')
                  : undefined
              }
            />
          ))}
        </div>

        {/* Resumo */}
        <div className="p-3 text-center text-xs border-t border-border bg-secondary/20">
          {totalDisponivel > 0 ? (
            <span className="text-green-400">
              ✅ <b>{totalDisponivel} banco(s) com oferta disponível</b>
            </span>
          ) : concluido ? (
            <span className="text-muted-foreground">⚠️ Nenhum banco retornou oferta pra esse CPF</span>
          ) : (
            <span className="text-muted-foreground">⏳ Aguardando bancos...</span>
          )}
          <span className="ml-3 text-[10px] text-muted-foreground/60">
            iniciada {formatDateBR(fila.iniciado_em)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
