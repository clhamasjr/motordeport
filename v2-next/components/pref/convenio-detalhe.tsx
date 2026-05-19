'use client';

import { useState } from 'react';
import { usePrefConvenio, useDeleteBancoConvenio } from '@/hooks/use-pref-catalogo';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft, AlertCircle, Plus, Pencil, Trash2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { tipoIcone, tipoLabel } from '@/lib/pref-types';
import type { BancoConvenioPref } from '@/lib/pref-types';
import { AdminBancoModal } from './admin-banco-modal';

interface Props {
  slug: string;
  onVoltar: () => void;
}

export function ConvenioDetalhe({ slug, onVoltar }: Props) {
  const { data, isLoading, error } = usePrefConvenio(slug);
  const { user } = useAuth();
  const [editando, setEditando] = useState<BancoConvenioPref | null>(null);
  const [criandoNovo, setCriandoNovo] = useState(false);
  const ehAdmin = !!user && (user.role === 'admin' || user.role === 'gestor');
  const deleteMut = useDeleteBancoConvenio(slug);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={onVoltar} className="gap-1">
          <ChevronLeft className="w-4 h-4" /> Voltar
        </Button>
        <Skeleton className="h-24" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={onVoltar} className="gap-1">
          <ChevronLeft className="w-4 h-4" /> Voltar
        </Button>
        <Card className="border-destructive/50">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            <div className="text-sm">{(error as Error)?.message || 'Convênio não encontrado'}</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const conv = data.convenio;
  const bancos = data.bancos || [];

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onVoltar} className="gap-1">
        <ChevronLeft className="w-4 h-4" /> Voltar
      </Button>

      {/* Header do convênio */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          {tipoIcone(conv.tipo)} {conv.nome}
        </h2>
        <div className="text-xs text-muted-foreground mt-1">
          {conv.uf} {conv.estado_nome && `— ${conv.estado_nome}`}
          {conv.municipio && ` · 📍 ${conv.municipio}`} · {tipoLabel(conv.tipo)}
        </div>
        <div className="text-[11px] text-muted-foreground/70 mt-0.5">
          Aba: {conv.sheet_origem || '-'}
          {conv.atualizado_em && ` · 📅 ${conv.atualizado_em}`}
        </div>
      </div>

      {/* Header da lista de bancos + botão admin */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-sm text-muted-foreground">
          {bancos.length} banco(s) operam este convênio
        </span>
        {ehAdmin && (
          <Button size="sm" onClick={() => setCriandoNovo(true)} className="gap-1">
            <Plus className="w-4 h-4" /> Adicionar banco
          </Button>
        )}
      </div>

      {/* Lista de bancos */}
      {bancos.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Nenhum banco cadastrado neste convênio ainda.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {bancos.map((b) => (
            <BancoVinculoCard
              key={b.id}
              vinculo={b}
              ehAdmin={ehAdmin}
              onEditar={() => setEditando(b)}
              onRemover={() => {
                if (confirm(`Remover "${b.banco_nome}" deste convênio?`)) {
                  deleteMut.mutate(b.id);
                }
              }}
            />
          ))}
        </div>
      )}

      {/* Modal admin */}
      {ehAdmin && (criandoNovo || editando) && (
        <AdminBancoModal
          convenio={conv}
          vinculo={editando}
          onClose={() => {
            setCriandoNovo(false);
            setEditando(null);
          }}
        />
      )}
    </div>
  );
}

// ── Card de cada banco no convênio ──────────────────────────────
function BancoVinculoCard({
  vinculo,
  ehAdmin,
  onEditar,
  onRemover,
}: {
  vinculo: BancoConvenioPref;
  ehAdmin: boolean;
  onEditar: () => void;
  onRemover: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const v = vinculo;
  const ops = v.operacoes;
  const opsList = [
    ops.novo && 'Novo',
    ops.refin && 'Refin',
    ops.port && 'Portabilidade',
    ops.cartao && 'Cartão',
  ].filter(Boolean) as string[];

  return (
    <Card className={v.suspenso ? 'opacity-60 border-l-4 border-l-destructive/50' : 'border-l-4 border-l-primary/40'}>
      <div className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <div className="font-bold flex items-center gap-2 flex-wrap">
            🏦 {v.banco_nome}
            {v.suspenso && <Badge variant="destructive" className="text-[10px]">⛔ Suspenso</Badge>}
            {v.regime_atendido !== 'RPPS' && (
              <Badge variant="muted" className="text-[10px]" title="Regime previdenciário atendido">
                {v.regime_atendido}
              </Badge>
            )}
            {v.criado_por_admin && (
              <Badge variant="muted" className="text-[10px]" title="Cadastrado manualmente">
                ✋ ADM
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {opsList.map((o) => (
              <Badge key={o} variant="success" className="text-[10px]">{o}</Badge>
            ))}
            {ehAdmin && (
              <>
                <Button variant="ghost" size="sm" onClick={onEditar} title="Editar" className="h-7 w-7 p-0">
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="sm" onClick={onRemover} title="Remover" className="h-7 w-7 p-0 text-destructive hover:text-destructive">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Quick stats */}
        <div className="flex gap-4 flex-wrap text-xs text-muted-foreground mt-2">
          {v.margem_utilizavel != null && (
            <div><span className="text-foreground font-semibold">Margem:</span> {(v.margem_utilizavel * 100).toFixed(1)}%</div>
          )}
          {(v.idade_min || v.idade_max) && (
            <div><span className="text-foreground font-semibold">Idade:</span> {v.idade_min || '?'}-{v.idade_max || '?'} anos</div>
          )}
          {v.taxa_minima_port != null && (
            <div><span className="text-foreground font-semibold">Taxa Port:</span> {(v.taxa_minima_port * 100).toFixed(2)}% a.m.</div>
          )}
          {v.data_corte && (
            <div><span className="text-foreground font-semibold">Corte:</span> {v.data_corte}</div>
          )}
          {v.prazo_max_meses && (
            <div><span className="text-foreground font-semibold">Prazo máx:</span> {v.prazo_max_meses}x</div>
          )}
        </div>

        {/* Públicos */}
        <div className="flex gap-2 flex-wrap mt-2 text-[11px]">
          {v.publico_ativo && <span className="px-2 py-0.5 rounded bg-green-500/10 text-green-500">Ativo</span>}
          {v.publico_aposentado && <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-500">Aposentado</span>}
          {v.publico_pensionista && <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-500">Pensionista</span>}
        </div>

        {v.observacoes_admin && (
          <div className="mt-3 text-xs italic text-muted-foreground border-l-2 border-yellow-500 pl-2">
            💡 {v.observacoes_admin}
          </div>
        )}

        <Button variant="ghost" size="sm" onClick={() => setAberto(!aberto)} className="mt-2 h-7 text-xs">
          {aberto ? '▾ Esconder roteiro completo' : '▸ Ver roteiro completo'}
        </Button>

        {aberto && (
          <div className="mt-3 border-t border-border pt-3 space-y-3">
            {(['principal', 'portabilidade', 'cartao', 'publico_alvo'] as const).map((sec) => {
              const items = (v.atributos_brutos || []).filter((a) => a.secao === sec);
              if (items.length === 0) return null;
              const lab =
                sec === 'principal' ? '📋 Operação' :
                sec === 'portabilidade' ? '🔄 Portabilidade' :
                sec === 'cartao' ? '💳 Cartão Benefício' :
                '👥 Público-Alvo';
              return (
                <div key={sec}>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1">{lab}</div>
                  <div className="space-y-1 text-xs">
                    {items.map((a, i) => (
                      <div key={i} className="grid grid-cols-[160px_1fr] gap-2 py-1 border-b border-dashed border-border/50">
                        <div className="text-muted-foreground">{a.label}</div>
                        <div className="whitespace-pre-line">{a.valor}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
