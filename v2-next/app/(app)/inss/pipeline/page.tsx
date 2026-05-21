'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { formatCpf, formatBRL } from '@/lib/utils';
import { useInssBaseStore } from '@/hooks/use-inss-base-store';
import { Filter, MessageSquare, Phone, Search, Trash2, ShoppingCart } from 'lucide-react';
import { ElegivelRow } from '@/lib/inss-base-parser';
import { ImportTelefonesButton } from '@/components/inss/import-telefones';

type Stage = 'sel' | 'hig' | 'wpp';

export default function PipelineInssPage() {
  const { base, selectedCpfs, clearSelection, toggleSelected } = useInssBaseStore();
  const [stage, setStage] = useState<Stage>('sel');
  const [busca, setBusca] = useState('');

  if (!base) {
    return (
      <div className="max-w-5xl mx-auto p-6 space-y-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Filter className="size-6 text-yellow-400" />
          INSS — Pipeline
        </h1>
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <Filter className="size-12 mx-auto mb-2 opacity-30" />
            <div className="text-sm mb-3">Nenhuma base carregada.</div>
            <Link href="/inss/higienizacao">
              <Button size="sm">Ir para Higienização</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Agrupa CPFs selecionados (1 cliente por CPF)
  const selecionados = useMemo(() => {
    const elegiveis = base.elegiveis.filter((e) => selectedCpfs.has(e.cpf));
    const grupos: Record<string, { cpf: string; nome: string; t1: string; t2: string; t3: string; contratos: ElegivelRow[]; trocoTotal: number; vcTotal: number }> = {};
    for (const e of elegiveis) {
      if (!grupos[e.cpf]) {
        grupos[e.cpf] = { cpf: e.cpf, nome: e.nome, t1: e.t1, t2: e.t2, t3: e.t3, contratos: [], trocoTotal: 0, vcTotal: 0 };
      }
      grupos[e.cpf].contratos.push(e);
      grupos[e.cpf].trocoTotal += e.troco || 0;
      grupos[e.cpf].vcTotal += e.vc || 0;
    }
    return Object.values(grupos);
  }, [base, selectedCpfs]);

  // Filtros por stage
  const comTel = selecionados.filter((g) => {
    const t = (g.t1 || g.t2 || g.t3 || '').replace(/\D/g, '');
    return t.length >= 10;
  });
  const semTel = selecionados.filter((g) => {
    const t = (g.t1 || g.t2 || g.t3 || '').replace(/\D/g, '');
    return t.length < 10;
  });

  const list =
    stage === 'sel' ? selecionados
    : stage === 'hig' ? comTel
    : stage === 'wpp' ? semTel
    : selecionados;

  const filtered = useMemo(() => {
    if (!busca) return list;
    const q = busca.toLowerCase();
    const num = busca.replace(/\D/g, '');
    return list.filter((g) =>
      g.nome.toLowerCase().includes(q) || (num && g.cpf.includes(num)),
    );
  }, [list, busca]);

  // KPIs
  const totalCli = selecionados.length;
  const totalContratos = selecionados.reduce((s, g) => s + g.contratos.length, 0);
  const totalTroco = selecionados.reduce((s, g) => s + g.trocoTotal, 0);
  const totalVc = selecionados.reduce((s, g) => s + g.vcTotal, 0);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShoppingCart className="size-6 text-yellow-400" />
            INSS — Pipeline
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Funil dos <strong>{totalCli}</strong> clientes selecionados na Higienização — siga pra Sofia
            disparar.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <ImportTelefonesButton />
          {selectedCpfs.size > 0 && (
            <Button variant="outline" size="sm" onClick={clearSelection} className="text-destructive">
              <Trash2 className="size-4" />
              Limpar seleção
            </Button>
          )}
          <Link href="/inss/higienizacao">
            <Button size="sm" variant="default">↩ Voltar pra Higienização</Button>
          </Link>
        </div>
      </div>

      {/* Stages */}
      <div className="grid grid-cols-3 gap-2">
        <StageButton label="Selecionados" count={totalCli} active={stage === 'sel'} onClick={() => setStage('sel')} step={1} />
        <StageButton label="Com telefone" count={comTel.length} active={stage === 'hig'} onClick={() => setStage('hig')} step={2} />
        <StageButton label="Sem telefone" count={semTel.length} active={stage === 'wpp'} onClick={() => setStage('wpp')} step={3} variant="alert" />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Kpi label="Clientes" value={totalCli} cor="text-cyan-400" />
        <Kpi label="Contratos" value={totalContratos} cor="text-blue-400" />
        <Kpi label="Vlr Contrato" value={formatBRL(totalVc)} cor="text-yellow-400" isText />
        <Kpi label="Troco total" value={formatBRL(totalTroco)} cor="text-green-400" isText />
      </div>

      {selecionados.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <ShoppingCart className="size-12 mx-auto mb-2 opacity-30" />
            <div className="text-sm mb-3">Nenhum cliente selecionado ainda.</div>
            <Link href="/inss/higienizacao">
              <Button size="sm">Ir selecionar clientes</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {selecionados.length > 0 && (
        <>
          {/* Busca */}
          <Card>
            <CardContent className="p-3">
              <div className="relative">
                <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Buscar nome / CPF..." value={busca} onChange={(e) => setBusca(e.target.value)} className="pl-8" />
              </div>
            </CardContent>
          </Card>

          {/* Lista */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className="text-left p-2 font-semibold">Nome</th>
                      <th className="text-left p-2 font-semibold">CPF</th>
                      <th className="text-center p-2 font-semibold">Contratos</th>
                      <th className="text-right p-2 font-semibold">Vlr Contrato</th>
                      <th className="text-right p-2 font-semibold">Troco</th>
                      <th className="text-left p-2 font-semibold">Tel 1</th>
                      <th className="p-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filtered.map((g) => {
                      const tel = (g.t1 || g.t2 || g.t3 || '').replace(/\D/g, '');
                      const temTel = tel.length >= 10;
                      const telFmt = tel
                        ? (tel.length === 11
                          ? `(${tel.slice(0, 2)}) ${tel.slice(2, 7)}-${tel.slice(7)}`
                          : tel.length === 10
                          ? `(${tel.slice(0, 2)}) ${tel.slice(2, 6)}-${tel.slice(6)}`
                          : tel)
                        : '—';
                      return (
                        <tr key={g.cpf} className="hover:bg-muted/20">
                          <td className="p-2 font-medium">{g.nome}</td>
                          <td className="p-2 font-mono text-[10px]">{formatCpf(g.cpf)}</td>
                          <td className="p-2 text-center font-mono">{g.contratos.length}</td>
                          <td className="p-2 text-right font-mono text-cyan-400">{formatBRL(g.vcTotal)}</td>
                          <td className="p-2 text-right font-mono text-green-400 font-semibold">{formatBRL(g.trocoTotal)}</td>
                          <td className="p-2 font-mono text-[10px]">
                            {temTel ? (
                              <a href={`https://wa.me/55${tel}`} target="_blank" rel="noopener noreferrer" className="text-green-400 hover:underline flex items-center gap-1">
                                <Phone className="size-3" /> {telFmt}
                              </a>
                            ) : (
                              <span className="text-muted-foreground">sem telefone</span>
                            )}
                          </td>
                          <td className="p-2">
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-[10px]"
                                onClick={() => toggleSelected(g.cpf)}
                                title="Remover da seleção"
                              >
                                <Trash2 className="size-3" />
                              </Button>
                              {temTel && (
                                <Link href={`/inss/conversas`}>
                                  <Button variant="default" size="sm" className="h-7 px-2 text-[10px]">
                                    <MessageSquare className="size-3" />
                                    Chat
                                  </Button>
                                </Link>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {!filtered.length && (
                      <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">Nenhum cliente encontrado.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="p-3 border-t border-border text-xs text-muted-foreground">
                {filtered.length} cliente(s) {busca && '(filtrados)'} / {selecionados.length} no pipeline
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function StageButton({
  label, count, active, onClick, step, variant,
}: { label: string; count: number; active: boolean; onClick: () => void; step: number; variant?: 'alert' }) {
  return (
    <button
      onClick={onClick}
      className={`text-left p-3 rounded-lg border transition-colors ${
        active
          ? 'border-primary bg-primary/10'
          : variant === 'alert'
          ? 'border-yellow-500/30 bg-yellow-500/5 hover:bg-yellow-500/10'
          : 'border-border bg-card/50 hover:bg-muted/30'
      }`}
    >
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
        Etapa {step}
      </div>
      <div className="text-sm font-bold flex items-center gap-2">
        {label}
        <Badge variant={active ? 'default' : 'muted'} className="text-[10px]">{count}</Badge>
      </div>
    </button>
  );
}

function Kpi({ label, value, cor, isText }: { label: string; value: number | string; cor: string; isText?: boolean }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
        <div className={`${isText ? 'text-base' : 'text-2xl'} font-mono font-bold mt-1 ${cor}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
