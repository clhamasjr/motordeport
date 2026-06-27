'use client';

import { Fragment, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { BancoOfertaCard } from './banco-oferta-card';
import { BANCO_LABEL } from '@/lib/clt-bancos';
import { formatBRL } from '@/lib/utils';
import { ChevronDown, ChevronRight } from 'lucide-react';
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

// Resume o estado de um banco numa linha: situação + margem + ordem de exibição.
function resumir(slug: BancoSlug, state: BancoState): Resumo {
  const margem = state.dados?.margemDisponivel || 0;
  const base = state.dados?.margemBase || 0;

  if (state.emManutencao || state.status === 'em_manutencao')
    return { txt: 'Manutenção', variant: 'warning', margem: 0, base, ordem: 7 };

  if (state.status === 'ok' && state.disponivel) {
    if (margem > 0) return { txt: 'Disponível', variant: 'success', margem, base, ordem: 0 };
    if (base > 0) return { txt: 'Base, sem livre', variant: 'warning', margem: 0, base, ordem: 2 };
    return { txt: 'Disponível', variant: 'success', margem: 0, base, ordem: 1 };
  }
  if (state.jaTemContrato) return { txt: 'Já contratado', variant: 'muted', margem: 0, base, ordem: 5 };
  if (state.status === 'bloqueado' || state.status === 'manual_aguardando' || state.precisaAutorizacao)
    return { txt: slug === 'c6' ? 'Aguarda selfie' : 'Aguarda autorização', variant: 'warning', margem: 0, base, ordem: 3 };
  if (state.status === 'processando' || state.status === 'pending')
    return { txt: 'Processando', variant: 'info', margem: 0, base, ordem: 4 };
  if (state.status === 'falha') {
    const semVinc = /v[íi]nculo/i.test(typeof state.mensagem === 'string' ? state.mensagem : '');
    return { txt: semVinc ? 'Sem vínculo' : 'Indisponível', variant: 'muted', margem: 0, base, ordem: 6 };
  }
  return { txt: '—', variant: 'muted', margem: 0, base, ordem: 8 };
}

export function BancoLinhas({ ofertas, cliente, filaId, onSimularDigitar }: Props) {
  const [aberto, setAberto] = useState<Set<string>>(new Set());

  const linhas = ofertas
    .map((o) => ({ ...o, resumo: resumir(o.slug, o.state) }))
    .sort((a, b) => a.resumo.ordem - b.resumo.ordem || b.resumo.margem - a.resumo.margem);

  const toggle = (slug: string) =>
    setAberto((prev) => {
      const n = new Set(prev);
      n.has(slug) ? n.delete(slug) : n.add(slug);
      return n;
    });

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left p-2 pl-3">Banco</th>
            <th className="text-left p-2">Situação</th>
            <th className="text-right p-2">Margem</th>
            <th className="w-8 p-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {linhas.map(({ slug, state, resumo }) => {
            const expandido = aberto.has(slug);
            const margemTxt =
              resumo.margem > 0
                ? formatBRL(resumo.margem)
                : resumo.base > 0
                ? <span className="text-muted-foreground">base {formatBRL(resumo.base)}</span>
                : <span className="text-muted-foreground">—</span>;
            return (
              <Fragment key={slug}>
                <tr
                  className="hover:bg-muted/20 cursor-pointer"
                  onClick={() => toggle(slug)}
                >
                  <td className="p-2 pl-3 font-medium">{BANCO_LABEL[slug] || slug}</td>
                  <td className="p-2">
                    <Badge variant={resumo.variant} className="text-[10px]">
                      {resumo.txt}
                    </Badge>
                  </td>
                  <td className="p-2 text-right font-bold text-green-500">
                    {resumo.margem > 0 ? margemTxt : <span className="font-normal">{margemTxt}</span>}
                  </td>
                  <td className="p-2 text-muted-foreground">
                    {expandido ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
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
                          state.disponivel && state.status === 'ok' && onSimularDigitar
                            ? () => onSimularDigitar(slug)
                            : undefined
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
  );
}
