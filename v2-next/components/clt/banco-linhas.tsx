'use client';

import { Fragment, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BancoOfertaCard } from './banco-oferta-card';
import { useReprocessarBanco } from '@/hooks/use-clt-fila';
import { BANCO_LABEL } from '@/lib/clt-bancos';
import { formatBRL } from '@/lib/utils';
import { ChevronDown, ChevronRight, RefreshCw, FileText } from 'lucide-react';
import type { BancoSlug, BancoState, ClienteData } from '@/lib/clt-types';

interface Oferta {
  slug: BancoSlug;
  state: BancoState;
}
interface Props {
  ofertas: Oferta[];
  cliente: ClienteData;
  filaId: string;
  onSimularDigitar?: (slug: BancoSlug) => void;
}

type Variant = 'success' | 'warning' | 'info' | 'muted';
interface Resumo {
  txt: string;
  variant: Variant;
  margem: number;
  base: number;
  ordem: number;
}

// Coage a mensagem do banco a string (backend já sanitiza, mas defensivo).
function msgStr(m: unknown): string {
  if (typeof m === 'string') return m;
  if (m == null) return '';
  return '';
}

// Resume um retorno grande num texto curto (ex: recusa da UY3 com várias
// restrições) — pega o começo + "…". Mantém a linha enxuta.
function resumirMsg(m: string, max = 90): string {
  const s = m.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max).trim() + '…' : s;
}

// Resume o estado de um banco numa linha: situação + margem + ordem de exibição.
function resumir(slug: BancoSlug, state: BancoState): Resumo {
  const margem = state.dados?.margemDisponivel || 0;
  const base = state.dados?.margemBase || 0;

  if (state.emManutencao || state.status === 'em_manutencao')
    return { txt: 'Manutenção', variant: 'warning', margem: 0, base, ordem: 7 };

  if (state.status === 'ok' && state.disponivel) {
    if (margem > 0) return { txt: 'Disponível', variant: 'success', margem, base, ordem: 0 };
    if (base > 0) return { txt: 'Base, sem margem livre', variant: 'warning', margem: 0, base, ordem: 2 };
    return { txt: 'Disponível', variant: 'success', margem: 0, base, ordem: 1 };
  }
  if (state.jaTemContrato) return { txt: 'Já tem contrato na UY3', variant: 'muted', margem: 0, base, ordem: 5 };
  if (state.status === 'bloqueado' || state.status === 'manual_aguardando' || state.precisaAutorizacao)
    return { txt: slug === 'c6' ? 'Aguarda selfie' : 'Aguarda autorização', variant: 'warning', margem: 0, base, ordem: 3 };
  if (state.status === 'processando' || state.status === 'pending')
    return { txt: 'Processando', variant: 'info', margem: 0, base, ordem: 4 };
  if (state.status === 'falha') {
    const semVinc = /v[íi]nculo/i.test(msgStr(state.mensagem));
    return { txt: semVinc ? 'Sem vínculo' : 'Indisponível', variant: 'muted', margem: 0, base, ordem: 6 };
  }
  return { txt: '—', variant: 'muted', margem: 0, base, ordem: 8 };
}

// Borda esquerda sutil por situação (verde=disponível, amarelo=aguardando, etc).
const BORDA_VARIANT: Record<Variant, string> = {
  success: 'border-l-green-500',
  warning: 'border-l-yellow-500',
  info: 'border-l-cyan-500',
  muted: 'border-l-border',
};

export function BancoLinhas({ ofertas, cliente, filaId, onSimularDigitar }: Props) {
  const [aberto, setAberto] = useState<Set<string>>(new Set());
  const [soComMargem, setSoComMargem] = useState(false);
  const reprocessar = useReprocessarBanco();

  const todas = ofertas
    .map((o) => ({ ...o, resumo: resumir(o.slug, o.state) }))
    .sort((a, b) => a.resumo.ordem - b.resumo.ordem || b.resumo.margem - a.resumo.margem);

  const comMargem = todas.filter((l) => l.resumo.margem > 0);
  const maiorMargem = comMargem.length ? comMargem[0].resumo.margem : 0;
  const linhas = soComMargem ? comMargem : todas;

  const toggle = (slug: string) =>
    setAberto((prev) => {
      const n = new Set(prev);
      n.has(slug) ? n.delete(slug) : n.add(slug);
      return n;
    });

  return (
    <div className="space-y-2">
      {/* Resumo + filtro */}
      <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
        <div className="text-muted-foreground">
          {comMargem.length > 0 ? (
            <span>
              <b className="text-green-500">{comMargem.length}</b> com margem
              {maiorMargem > 0 && <> · maior <b className="text-green-500">{formatBRL(maiorMargem)}</b></>}
            </span>
          ) : (
            <span>Nenhum banco com margem disponível ainda</span>
          )}
        </div>
        {comMargem.length > 0 && (
          <button
            onClick={() => setSoComMargem((v) => !v)}
            className={`px-2 py-1 rounded border text-[11px] ${soComMargem ? 'border-green-500 text-green-500 bg-green-500/10' : 'border-border text-muted-foreground hover:bg-muted/30'}`}
          >
            {soComMargem ? '✓ Só com margem' : 'Só com margem'}
          </button>
        )}
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left p-2 pl-3">Banco / retorno</th>
            <th className="text-left p-2 w-32">Situação</th>
            <th className="text-right p-2 w-24">Margem disp.</th>
            <th className="text-right p-2 w-40">Ação</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {linhas.map(({ slug, state, resumo }) => {
            const expandido = aberto.has(slug);
            const msg = resumirMsg(msgStr(state.mensagem));
            const disponivel = state.disponivel && state.status === 'ok';
            const precisaAutz = state.precisaAutorizacao && !state.linkAutorizacao;
            const podeRetentar = state.status === 'falha';
            const rodando = state.status === 'processando' || state.status === 'pending';
            // ↻ atualizar: re-consulta a margem mesmo quando já está OK (a margem
            // muda com o tempo). Não mostra quando já há Re-tentar/Liberar ou rodando.
            const podeAtualizar = !rodando && !podeRetentar && !precisaAutz;
            const carregando = reprocessar.isPending;

            const fazerRetentar = (e: React.MouseEvent) => {
              e.stopPropagation();
              reprocessar.mutate({ filaId, banco: slug });
            };

            return (
              <Fragment key={slug}>
                <tr
                  className={`hover:bg-muted/20 cursor-pointer align-top border-l-2 ${BORDA_VARIANT[resumo.variant]}`}
                  onClick={() => toggle(slug)}
                >
                  {/* Banco + retorno resumido */}
                  <td className="p-2 pl-3">
                    <div className="font-medium">{BANCO_LABEL[slug] || slug}</div>
                    {msg && !disponivel && (
                      <div className="text-[11px] text-muted-foreground leading-snug mt-0.5">{msg}</div>
                    )}
                  </td>
                  {/* Situação */}
                  <td className="p-2">
                    <Badge variant={resumo.variant} className="text-[10px]">{resumo.txt}</Badge>
                  </td>
                  {/* Margem */}
                  <td className="p-2 text-right">
                    {resumo.margem > 0 ? (
                      <b className="text-green-500">{formatBRL(resumo.margem)}</b>
                    ) : resumo.base > 0 ? (
                      <span className="text-xs text-muted-foreground">base {formatBRL(resumo.base)}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  {/* Ação inline + expandir */}
                  <td className="p-2">
                    <div className="flex items-center justify-end gap-1">
                      {disponivel && onSimularDigitar && (
                        <Button
                          size="sm"
                          className="h-7 text-[11px] px-2"
                          onClick={(e) => { e.stopPropagation(); onSimularDigitar(slug); }}
                        >
                          <FileText className="w-3 h-3 mr-1" /> Digitar
                        </Button>
                      )}
                      {!disponivel && precisaAutz && (
                        <Button
                          variant="outline" size="sm" className="h-7 text-[11px] px-2"
                          onClick={fazerRetentar} disabled={carregando}
                        >
                          <RefreshCw className={cn3(carregando)} /> Liberar
                        </Button>
                      )}
                      {!disponivel && !precisaAutz && podeRetentar && (
                        <Button
                          variant="outline" size="sm" className="h-7 text-[11px] px-2"
                          onClick={fazerRetentar} disabled={carregando}
                        >
                          <RefreshCw className={cn3(carregando)} /> Re-tentar
                        </Button>
                      )}
                      {podeAtualizar && (
                        <Button
                          variant="ghost" size="sm" className="h-7 w-7 p-0"
                          title="Atualizar margem (re-consultar)"
                          onClick={fazerRetentar} disabled={carregando}
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${carregando ? 'animate-spin' : ''}`} />
                        </Button>
                      )}
                      {expandido ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                    </div>
                  </td>
                </tr>
                {expandido && (
                  <tr className="bg-muted/10">
                    <td colSpan={4} className="p-2">
                      <BancoOfertaCard
                        banco={slug}
                        state={state}
                        cliente={cliente}
                        filaId={filaId}
                        onSimularDigitar={
                          disponivel && onSimularDigitar ? () => onSimularDigitar(slug) : undefined
                        }
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function cn3(spin: boolean): string {
  return 'w-3 h-3 mr-1' + (spin ? ' animate-spin' : '');
}
