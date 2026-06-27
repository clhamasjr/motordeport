'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useFilaStatus, useReprocessarBanco } from '@/hooks/use-clt-fila';
import { BancoSlug, FilaConsulta } from '@/lib/clt-types';
import { BancoOfertaCard } from './banco-oferta-card';
import { BancoLinhas } from './banco-linhas';
import { ModalDigitar } from './modal-digitar';
import { formatCpf, formatCnpj, formatDateBR } from '@/lib/utils';
import { X, Loader2, CheckCircle2, AlertCircle, List, LayoutGrid, RefreshCw } from 'lucide-react';
import { ApiError } from '@/lib/api';

// Ordem que os cards aparecem — vem do catalogo central (lib/clt-bancos).
// Bancos OCULTOS (V8, JoinBank) nao aparecem aqui.
import { BANCOS_VISIVEIS } from '@/lib/clt-bancos';
const BANCOS_ORDEM: BancoSlug[] = BANCOS_VISIVEIS;

interface Props {
  filaId: string;
  onClose?: () => void;
  /** Leitura pool-comum (cliente aberto a partir do Pipeline CLT). */
  pool?: boolean;
}

const VISAO_KEY = 'flowforce_clt_visao';

export function ConsultaCard({ filaId, onClose, pool = false }: Props) {
  const { data: fila, isLoading, error } = useFilaStatus(filaId, pool);
  const [bancoDigitar, setBancoDigitar] = useState<string | null>(null);
  // Visão dos bancos: 'linhas' (tabela, padrão) ou 'cards'. Persiste a escolha.
  const [visao, setVisao] = useState<'linhas' | 'cards'>('linhas');
  useEffect(() => {
    try {
      const v = localStorage.getItem(VISAO_KEY);
      if (v === 'cards' || v === 'linhas') setVisao(v);
    } catch { /* ignore */ }
  }, []);
  const trocarVisao = (v: 'linhas' | 'cards') => {
    setVisao(v);
    try { localStorage.setItem(VISAO_KEY, v); } catch { /* ignore */ }
  };
  const reprocessar = useReprocessarBanco();

  // Se backend retorna 4xx (id antigo no localStorage que ja sumiu), avisa o pai
  // pra remover da pilha automaticamente — evita "card de erro" eterno na tela.
  useEffect(() => {
    if (!error || !onClose) return;
    const status = (error as ApiError)?.status;
    if (status && status >= 400 && status < 500) {
      // Espera 2s pra usuario ver a mensagem antes de auto-fechar
      const t = setTimeout(() => onClose(), 2000);
      return () => clearTimeout(t);
    }
  }, [error, onClose]);

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
    const status = (error as ApiError)?.status;
    const isExpiraId = status === 400 || status === 404;
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent className="p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="w-4 h-4 text-destructive" />
            {isExpiraId ? (
              <span>Consulta antiga não encontrada — fechando automaticamente.</span>
            ) : (
              <span>Erro carregando consulta: {error?.message || 'desconhecido'}</span>
            )}
          </div>
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose} className="h-7 gap-1">
              <X className="w-3.5 h-3.5" /> Fechar
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const concluido = fila.status_geral === 'concluido';
  const standby = fila.status_geral === 'standby';
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
                {standby ? (
                  <Badge variant="warning" className="gap-1">
                    ⏸️ AGENDADA 26/06
                  </Badge>
                ) : concluido ? (
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

        {/* Banner STANDBY — consulta agendada pra 26/06 */}
        {standby && (
          <div className="m-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-600">
            ⏸️ <b>Consulta agendada.</b> Os bancos serão consultados automaticamente em
            {' '}<b>26/06 às 07h</b>. Não precisa fazer nada — o resultado aparece aqui depois.
          </div>
        )}

        {/* Toggle Linhas / Cards + Re-tentar todos — escondido em standby */}
        {!standby && (
          <div className="px-3 pt-3 flex items-center justify-between gap-2 flex-wrap">
            {(() => {
              const falhas = operando.filter((o) => o.state.status === 'falha');
              return falhas.length > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  disabled={reprocessar.isPending}
                  onClick={() => falhas.forEach((o) => reprocessar.mutate({ filaId: fila.id, banco: o.slug }))}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${reprocessar.isPending ? 'animate-spin' : ''}`} />
                  Re-tentar todos ({falhas.length})
                </Button>
              ) : <span />;
            })()}
            <div className="flex items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">Visão</span>
            <Button
              variant={visao === 'linhas' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => trocarVisao('linhas')}
            >
              <List className="w-3.5 h-3.5" /> Linhas
            </Button>
            <Button
              variant={visao === 'cards' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => trocarVisao('cards')}
            >
              <LayoutGrid className="w-3.5 h-3.5" /> Cards
            </Button>
            </div>
          </div>
        )}

        {/* VISÃO LINHAS — tabela única (manutenção/sem vínculo afundam) */}
        {!standby && visao === 'linhas' && (
          <div className="p-3">
            <BancoLinhas
              ofertas={[...operando, ...parados]}
              cliente={cliente}
              filaId={fila.id}
              onSimularDigitar={(slug) => setBancoDigitar(slug)}
            />
          </div>
        )}

        {/* VISÃO CARDS — bancos parados (manutenção) */}
        {!standby && visao === 'cards' && parados.length > 0 && (
          <div className="p-3 pb-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
              🔧 Bancos parados ({parados.length})
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {parados.map(({ slug, state }) => (
                <BancoOfertaCard key={slug} banco={slug} state={state} cliente={cliente} filaId={fila.id} />
              ))}
            </div>
          </div>
        )}

        {/* VISÃO CARDS — bancos operando */}
        {!standby && visao === 'cards' && (
          <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {operando.map(({ slug, state }) => (
              <BancoOfertaCard
                key={slug}
                banco={slug}
                state={state}
                cliente={cliente}
                filaId={fila.id}
                onSimularDigitar={
                  state.disponivel && state.status === 'ok'
                    ? () => setBancoDigitar(slug)
                    : undefined
                }
              />
            ))}
          </div>
        )}

        {/* Resumo — escondido em standby */}
        {!standby && (
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
        )}
      </CardContent>

      {/* Modal Digitar Proposta */}
      <ModalDigitar
        open={!!bancoDigitar}
        onClose={() => setBancoDigitar(null)}
        banco={bancoDigitar}
        consulta={fila}
      />
    </Card>
  );
}
