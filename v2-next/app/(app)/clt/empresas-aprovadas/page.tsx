'use client';

import { useState } from 'react';
import { useEmpresasAprovadas, useCpfsDessaEmpresa, useHigienizarLote } from '@/hooks/use-clt-empresas';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { formatCnpj, formatDateBR } from '@/lib/utils';
import { Trophy, Search, Building2, MapPin, Users, Rocket } from 'lucide-react';

const BANCO_LABEL: Record<string, string> = {
  handbank: 'UY3',
  joinbank: 'QualiBanking',
  presencabank: 'PresençaBank',
  v8_qi: 'V8 QI',
  v8_celcoin: 'V8 Celcoin',
  c6: 'C6',
  mercantil: 'Mercantil',
  fintech_qi: 'Fintech QI',
  fintech_celcoin: 'Fintech Celcoin',
};

export default function EmpresasAprovadasPage() {
  const [busca, setBusca] = useState('');
  const [banco, setBanco] = useState('');
  const [uf, setUf] = useState('');
  const [orderBy, setOrderBy] = useState<'total_aprovacoes' | 'ultima_aprovacao_em' | 'empregador_nome'>('total_aprovacoes');
  const [empresaAberta, setEmpresaAberta] = useState<{ cnpj: string; nome: string } | null>(null);

  const { data, isLoading, error } = useEmpresasAprovadas({
    busca: busca || undefined,
    banco: banco || undefined,
    uf: uf || undefined,
    orderBy,
  });

  const empresas = data?.empresas || [];

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Trophy className="w-6 h-6 text-yellow-500" /> CLT — Empresas Aprovadas
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Empresas (CNPJs) que já tiveram pelo menos 1 aprovação CLT em algum banco. Use pra puxar outros CPFs da mesma empresa do CAGED 2024 — alta probabilidade de aprovação.
        </p>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-3 grid grid-cols-1 md:grid-cols-4 gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Nome ou CNPJ..." value={busca} onChange={(e) => setBusca(e.target.value)} className="pl-9" />
          </div>
          <select value={banco} onChange={(e) => setBanco(e.target.value)}
            className="h-10 px-3 text-sm rounded-md border border-input bg-background">
            <option value="">Todos os bancos</option>
            {Object.entries(BANCO_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <Input placeholder="UF (SP, MG...)" maxLength={2}
            value={uf} onChange={(e) => setUf(e.target.value.toUpperCase())} />
          <select value={orderBy} onChange={(e) => setOrderBy(e.target.value as 'total_aprovacoes' | 'ultima_aprovacao_em' | 'empregador_nome')}
            className="h-10 px-3 text-sm rounded-md border border-input bg-background">
            <option value="total_aprovacoes">Mais aprovações</option>
            <option value="ultima_aprovacao_em">Mais recentes</option>
            <option value="empregador_nome">Nome A-Z</option>
          </select>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      )}

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 text-destructive text-sm">{(error as Error).message}</CardContent>
        </Card>
      )}

      {!isLoading && !error && empresas.length === 0 && (
        <Card><CardContent className="p-8 text-center text-muted-foreground">
          Nenhuma empresa encontrada. Quando consultas CLT começarem a aprovar, aparecem aqui.
        </CardContent></Card>
      )}

      {!isLoading && empresas.length > 0 && (
        <>
          <div className="text-xs text-muted-foreground">📊 {empresas.length} empresas</div>
          <div className="space-y-2">
            {empresas.map((e) => (
              <Card key={e.cnpj} className="border-l-4 border-l-green-500/50">
                <CardContent className="p-4 flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-[250px]">
                    <div className="font-bold flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-bank-c6 flex-shrink-0" />
                      {e.empregador_nome || '(Nome não disponível)'}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span>CNPJ {formatCnpj(e.cnpj)}</span>
                      {e.cidade_empresa && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" /> {e.cidade_empresa}/{e.uf || '?'}
                        </span>
                      )}
                      {e.cnae && <span>CNAE {e.cnae}</span>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {e.bancos_aprovam.map((b, i) => (
                        <Badge key={i} variant="success" className="text-[10px]"
                          title={`${b.total_aprovacoes || 1} aprovação(ões) — última ${formatDateBR(b.ultima_aprovacao_em || '')}`}>
                          {BANCO_LABEL[b.banco] || b.banco} · {b.total_aprovacoes || 1}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-2xl font-black text-green-400 leading-none">{e.total_aprovacoes}</div>
                    <div className="text-[10px] uppercase text-muted-foreground">aprovações</div>
                    <div className="text-[10px] text-muted-foreground/80 mt-1">
                      Última: {formatDateBR(e.ultima_aprovacao_em || '')}
                    </div>
                    {(e.cpfs_no_caged ?? 0) > 0 && (
                      <div className="text-xs font-bold text-bank-c6 mt-1.5">
                        📊 {e.cpfs_no_caged?.toLocaleString('pt-BR')} CPFs no CAGED
                      </div>
                    )}
                  </div>

                  {(e.cpfs_no_caged ?? 0) > 0 && (
                    <div className="w-full pt-2 border-t border-border">
                      <Button size="sm" className="gap-2"
                        onClick={() => setEmpresaAberta({ cnpj: e.cnpj, nome: e.empregador_nome || '' })}>
                        <Users className="w-4 h-4" />
                        Ver CPFs no CAGED ({e.cpfs_no_caged?.toLocaleString('pt-BR')})
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Modal CPFs */}
      <ModalCpfs empresa={empresaAberta} onClose={() => setEmpresaAberta(null)} />
    </div>
  );
}

const BANCOS_HIG = [
  { slug: 'fintech_qi', label: 'Fintech (QI)' },
  { slug: 'fintech_celcoin', label: 'Fintech (Celcoin)' },
  { slug: 'handbank', label: 'UY3' },
  { slug: 'joinbank', label: 'JoinBank' },
  { slug: 'mercantil', label: 'Mercantil' },
  { slug: 'c6', label: 'C6' },
];

function ModalCpfs({ empresa, onClose }: { empresa: { cnpj: string; nome: string } | null; onClose: () => void }) {
  const { data, isLoading } = useCpfsDessaEmpresa(empresa?.cnpj || null);
  const higienizar = useHigienizarLote();
  const [bancosHig, setBancosHig] = useState<Set<string>>(new Set());

  return (
    <Dialog open={!!empresa} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-bank-c6" />
            {empresa?.nome || 'Empresa'}
          </DialogTitle>
          <DialogDescription>CNPJ {empresa ? formatCnpj(empresa.cnpj) : ''}</DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8" />)}
          </div>
        )}

        {data && (
          <>
            <div className="space-y-3 pb-2">
              <div className="text-sm">
                📊 <b>{data.cpfs.length.toLocaleString('pt-BR')}</b> CPFs ativos no CAGED 2024
              </div>

              {/* Filtro de bancos pra disparar */}
              <div className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                  🎯 Bancos pra higienizar (vazio = todos)
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {BANCOS_HIG.map(b => (
                    <button
                      key={b.slug}
                      onClick={() => setBancosHig((s) => {
                        const novo = new Set(s);
                        if (novo.has(b.slug)) novo.delete(b.slug); else novo.add(b.slug);
                        return novo;
                      })}
                      className={`px-2.5 py-1 text-[11px] rounded-md border transition-colors ${
                        bancosHig.has(b.slug)
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-border hover:bg-secondary'
                      }`}
                    >
                      {b.label}
                    </button>
                  ))}
                  {bancosHig.size > 0 && (
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]"
                      onClick={() => setBancosHig(new Set())}>Limpar</Button>
                  )}
                </div>
              </div>

              <Button
                size="sm"
                className="gap-2 w-full sm:w-auto"
                disabled={higienizar.isPending || data.cpfs.length === 0}
                onClick={() => {
                  const total = data.cpfs.length;
                  const labelB = bancosHig.size > 0
                    ? `nos bancos: ${[...bancosHig].join(', ')}`
                    : 'em TODOS os bancos disponíveis';
                  if (!confirm(`Vou enviar ${total} CPFs pra higienização CLT ${labelB}.\n\nContinuar?`)) return;
                  higienizar.mutate({
                    cpfs: data.cpfs,
                    bancos: bancosHig.size > 0 ? [...bancosHig] : undefined,
                  });
                }}
              >
                <Rocket className="w-4 h-4" />
                {higienizar.isPending ? 'Enviando...' : `Higienizar ${data.cpfs.length} CPFs`}
              </Button>
            </div>

            <div className="max-h-[50vh] overflow-auto border border-border rounded-md">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card border-b border-border">
                  <tr>
                    <th className="text-left p-2">CPF</th>
                    <th className="text-left p-2">Nome</th>
                    <th className="text-left p-2">Admissão</th>
                    <th className="text-left p-2">CBO</th>
                    <th className="text-left p-2">Cidade</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cpfs.slice(0, 200).map((c) => (
                    <tr key={c.cpf} className="border-b border-border/50 hover:bg-secondary/30">
                      <td className="p-2 font-mono">{c.cpf}</td>
                      <td className="p-2">{(c.nome || '').substring(0, 35)}</td>
                      <td className="p-2">{formatDateBR(c.data_admissao || '')}</td>
                      <td className="p-2">{c.cbo || '-'}</td>
                      <td className="p-2">{c.cidade || '-'}/{c.uf || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.cpfs.length > 200 && (
                <div className="p-2 text-center text-[11px] text-muted-foreground border-t border-border">
                  Mostrando 200 de {data.cpfs.length}. Higienização processa todos.
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
