'use client';

// ════════════════════════════════════════════════════════════════════
// Baixa Renda — Minhas Propostas (visão do vendedor)
//
// Sempre a carteira PESSOAL de quem está logado, qualquer que seja o papel
// (gestor também lança proposta e quer ver as dele). A visão da loja fica
// em /baixa-renda/gestao.
//
// Cada proposta mostra em que ponto está: fila → digitando → digitada →
// esteira da Crefisa (análise, pendência, aprovada, paga, cancelada).
// O destaque é o que precisa do vendedor: erro na digitação e pendência.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatBRL, formatCpf, formatDateBR } from '@/lib/utils';
import {
  useMinhasPropostas, useCancelarFila, STATUS_FILA_LABEL,
  type MinhaProposta, type EstagioEsteira,
} from '@/hooks/use-crefisa-fila';
import {
  ListChecks, Loader2, AlertCircle, X, RotateCcw, MessageCircle, Plus, Clock, FileText,
} from 'lucide-react';
import { toast } from 'sonner';

const PERIODOS = [
  { dias: 1, label: 'Hoje' },
  { dias: 7, label: '7 dias' },
  { dias: 30, label: '30 dias' },
  { dias: 90, label: '90 dias' },
];

type Filtro = 'todas' | 'atencao' | 'andamento' | 'pagas' | 'caidas';

const ESTAGIO_BADGE: Record<EstagioEsteira, 'success' | 'warning' | 'destructive' | 'info' | 'muted'> = {
  PAGA: 'success',
  FORMALIZADA: 'info',
  APROVADA: 'info',
  PENDENTE: 'warning',
  CANCELADA: 'destructive',
  EM_ANALISE: 'muted',
  OUTRO: 'muted',
};

const precisaDeMim = (p: MinhaProposta) =>
  p.status === 'ERRO' || p.esteira?.estagio === 'PENDENTE';
const caiu = (p: MinhaProposta) =>
  p.status === 'CANCELADA' || p.esteira?.estagio === 'CANCELADA';
const paga = (p: MinhaProposta) => p.esteira?.estagio === 'PAGA';
const andando = (p: MinhaProposta) => !precisaDeMim(p) && !caiu(p) && !paga(p);

const FILTROS: { k: Filtro; label: string; teste: (p: MinhaProposta) => boolean }[] = [
  { k: 'todas', label: 'Todas', teste: () => true },
  { k: 'atencao', label: 'Precisa de mim', teste: precisaDeMim },
  { k: 'andamento', label: 'Em andamento', teste: andando },
  { k: 'pagas', label: 'Pagas', teste: paga },
  { k: 'caidas', label: 'Canceladas', teste: caiu },
];

function Tile({ label, valor, sub, destaque = false }: { label: string; valor: string | number; sub?: string; destaque?: boolean }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[10px] uppercase text-muted-foreground tracking-wide">{label}</div>
        <div className={`text-xl font-bold mt-0.5 ${destaque ? 'text-primary' : ''}`}>{valor}</div>
        {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function linkWhats(tel: string | null) {
  const d = (tel || '').replace(/\D/g, '');
  if (d.length < 10) return null;
  return `https://wa.me/${d.startsWith('55') ? d : '55' + d}`;
}

function LinhaProposta({ p, onCancelar, cancelando }: { p: MinhaProposta; onCancelar: (p: MinhaProposta) => void; cancelando: boolean }) {
  const filaBadge = STATUS_FILA_LABEL[p.status] || STATUS_FILA_LABEL.NA_FILA;
  const whats = linkWhats(p.telefone);
  const refazer = `/baixa-renda/consultar?cpf=${p.cpf}${p.telefone ? `&tel=${p.telefone}` : ''}`;

  return (
    <div className={`py-3 px-4 border-b border-border last:border-b-0 ${precisaDeMim(p) ? 'bg-amber-500/5' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{p.nome_cliente || 'Cliente sem nome'}</div>
          <div className="text-[11px] text-muted-foreground font-mono">{formatCpf(p.cpf)}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            Lançada em {formatDateBR(p.criado_em)}
            {p.esteira?.contrato && <> · contrato {p.esteira.contrato}</>}
          </div>
        </div>
        <div className="text-right shrink-0">
          {p.valor > 0 && <div className="text-sm font-bold text-primary">{formatBRL(p.valor)}</div>}
          {p.prazo > 0 && (
            <div className="text-[10px] text-muted-foreground">{p.prazo}x {formatBRL(p.valorParcela)}</div>
          )}
        </div>
      </div>

      {/* Onde está */}
      <div className="flex items-center gap-2 flex-wrap mt-2">
        {p.status === 'DIGITADA' && p.esteira ? (
          <Badge variant={ESTAGIO_BADGE[p.esteira.estagio]}>{p.esteira.rotulo}</Badge>
        ) : (
          <Badge variant={filaBadge.variant} className="gap-1">
            {p.status === 'PROCESSANDO' && <Loader2 className="w-3 h-3 animate-spin" />}
            {filaBadge.label}
          </Badge>
        )}
        {p.status === 'NA_FILA' && p.posicao != null && (
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Clock className="size-3" /> {p.posicao}º da fila
          </span>
        )}
        {p.status === 'DIGITADA' && !p.esteira && (
          <span className="text-[11px] text-muted-foreground">aguardando retorno da esteira</span>
        )}
        {p.esteira?.em && (
          <span className="text-[11px] text-muted-foreground">atualizado {formatDateBR(p.esteira.em)}</span>
        )}
      </div>

      {/* O que fazer */}
      {p.status === 'ERRO' && (
        <div className="text-[11px] text-red-400 flex items-start gap-1 mt-1.5">
          <AlertCircle className="size-3 shrink-0 mt-0.5" />
          <span>{p.mensagem || 'A digitação falhou.'} Confira os dados e mande de novo.</span>
        </div>
      )}
      {p.esteira?.estagio === 'PENDENTE' && (
        <div className="text-[11px] text-amber-500 flex items-start gap-1 mt-1.5">
          <FileText className="size-3 shrink-0 mt-0.5" />
          <span>Pendência: {p.esteira.pendencia || p.esteira.situacao}. Fale com o cliente pra resolver.</span>
        </div>
      )}

      {(p.status === 'NA_FILA' || p.status === 'ERRO' || (whats && precisaDeMim(p))) && (
        <div className="flex gap-2 flex-wrap mt-2">
          {p.status === 'ERRO' && (
            <Button asChild size="sm" variant="outline" className="h-7 text-xs gap-1">
              <Link href={refazer}><RotateCcw className="size-3" /> Refazer</Link>
            </Button>
          )}
          {whats && precisaDeMim(p) && (
            <Button asChild size="sm" variant="outline" className="h-7 text-xs gap-1">
              <a href={whats} target="_blank" rel="noreferrer"><MessageCircle className="size-3" /> WhatsApp do cliente</a>
            </Button>
          )}
          {p.status === 'NA_FILA' && (
            <Button
              size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground"
              onClick={() => onCancelar(p)} disabled={cancelando}
            >
              <X className="size-3" /> Cancelar
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default function BaixaRendaMinhasPage() {
  const [dias, setDias] = useState(30);
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const minhas = useMinhasPropostas(dias);
  const cancelar = useCancelarFila();

  const d = minhas.data;
  const itens = d?.itens || [];
  const contagem = useMemo(
    () => Object.fromEntries(FILTROS.map((f) => [f.k, itens.filter(f.teste).length])) as Record<Filtro, number>,
    [itens],
  );
  const visiveis = itens.filter(FILTROS.find((f) => f.k === filtro)!.teste);

  const onCancelar = async (p: MinhaProposta) => {
    if (!window.confirm(`Tirar ${p.nome_cliente || formatCpf(p.cpf)} da fila?`)) return;
    const r = await cancelar.mutateAsync(p.id).catch(() => null);
    if (r?.success) toast.success('Proposta tirada da fila');
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ListChecks className="size-6 text-emerald-400" /> Minhas Propostas
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Bolsa Família (Crefisa). Onde está cada proposta que você lançou.
          </p>
        </div>
        <Button asChild size="sm" className="gap-1">
          <Link href="/baixa-renda/consultar"><Plus className="size-4" /> Nova consulta</Link>
        </Button>
      </div>

      {/* Período */}
      <div className="flex gap-1 flex-wrap">
        {PERIODOS.map((p) => (
          <Button key={p.dias} size="sm" variant={dias === p.dias ? 'default' : 'outline'} onClick={() => setDias(p.dias)}>
            {p.label}
          </Button>
        ))}
      </div>

      {minhas.isPending && (
        <Card><CardContent className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> carregando suas propostas…
        </CardContent></Card>
      )}

      {minhas.isError && (
        <div className="rounded-md border border-red-500/40 bg-red-500/5 p-3 text-xs text-red-400 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5" /> Não deu pra carregar suas propostas. Tente de novo em instantes.
        </div>
      )}

      {d && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile label="Digitadas" valor={d.total.digitadas} sub={formatBRL(d.total.valorDigitado)} destaque />
            <Tile label="Pagas" valor={d.total.pagas} sub={formatBRL(d.total.valorPago)} />
            <Tile label="Na fila" valor={d.total.naFila} sub="aguardando digitação" />
            <Tile label="Precisa de mim" valor={contagem.atencao} sub="erro ou pendência" />
          </div>

          {contagem.atencao > 0 && filtro !== 'atencao' && (
            <button
              onClick={() => setFiltro('atencao')}
              className="w-full text-left rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-500 flex items-center gap-2"
            >
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {contagem.atencao} proposta{contagem.atencao === 1 ? ' precisa' : 's precisam'} de você. Toque pra ver.
            </button>
          )}

          <Card>
            <CardContent className="p-0">
              <div className="p-3 border-b border-border flex gap-1 flex-wrap">
                {FILTROS.map((f) => (
                  <Button
                    key={f.k} size="sm" className="h-7 text-xs"
                    variant={filtro === f.k ? 'default' : 'ghost'}
                    onClick={() => setFiltro(f.k)}
                  >
                    {f.label}
                    <span className="ml-1 opacity-60">{contagem[f.k]}</span>
                  </Button>
                ))}
              </div>
              {visiveis.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground text-center">
                  {itens.length === 0 ? 'Você ainda não lançou proposta nesse período.' : 'Nada nesse filtro.'}
                </div>
              ) : (
                visiveis.map((p) => (
                  <LinhaProposta key={p.id} p={p} onCancelar={onCancelar} cancelando={cancelar.isPending} />
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
