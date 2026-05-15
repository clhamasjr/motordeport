'use client';

import { useMemo, useState } from 'react';
import {
  CagedFiltros,
  useCagedContar, useCagedListar, useCagedExportCsv, useCagedHigienizarLote,
} from '@/hooks/use-clt-caged';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatCpf, formatDateBR } from '@/lib/utils';
import { Download, Eye, Rocket, Loader2, Database } from 'lucide-react';

const BANCOS_DISP = [
  { slug: 'fintech_qi', label: 'Fintech (QI Tech)' },
  { slug: 'fintech_celcoin', label: 'Fintech (Celcoin)' },
  { slug: 'handbank', label: 'Handbank · UY3' },
  { slug: 'joinbank', label: 'JoinBank' },
  { slug: 'mercantil', label: 'Mercantil' },
  { slug: 'c6', label: 'C6 Bank' },
  { slug: 'presencabank', label: 'PresençaBank' },
];

export default function ExtrairCagedPage() {
  const [filtros, setFiltros] = useState<CagedFiltros>({ ativo: true });
  const [bancosDispara, setBancosDispara] = useState<Set<string>>(new Set());

  const setF = (k: keyof CagedFiltros, v: unknown) => {
    setFiltros((f) => {
      const novo = { ...f };
      if (v === '' || v === undefined || v === null) delete novo[k];
      else (novo as Record<string, unknown>)[k] = v;
      return novo;
    });
  };

  const contar = useCagedContar(filtros);
  const listar = useCagedListar();
  const exportar = useCagedExportCsv();
  const higienizar = useCagedHigienizarLote();

  const total = contar.data?.total;
  const modo = contar.data?.modo;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Database className="w-6 h-6 text-bank-c6" /> Extrair Base CAGED 2024
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          43,6 milhões de CPFs CLT do Brasil. Aplique filtros e baixe CSV ou envie em lote pra higienização CLT.
        </p>
      </div>

      {/* Grupo 1: Pessoa */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <Section title="👤 Pessoa">
            <Field label="Idade mín">
              <Input type="number" placeholder="ex: 25"
                value={filtros.idade_min ?? ''} onChange={(e) => setF('idade_min', e.target.value ? parseInt(e.target.value) : '')} />
            </Field>
            <Field label="Idade máx">
              <Input type="number" placeholder="ex: 60"
                value={filtros.idade_max ?? ''} onChange={(e) => setF('idade_max', e.target.value ? parseInt(e.target.value) : '')} />
            </Field>
            <Field label="Sexo">
              <select value={filtros.sexo || ''} onChange={(e) => setF('sexo', e.target.value)}
                className="h-10 px-3 text-sm rounded-md border border-input bg-background w-full">
                <option value="">Todos</option>
                <option value="M">Masculino</option>
                <option value="F">Feminino</option>
              </select>
            </Field>
            <Field label="Estado (UF)">
              <Input placeholder="SP, MG..." maxLength={2}
                value={filtros.uf || ''} onChange={(e) => setF('uf', e.target.value.toUpperCase())} />
            </Field>
            <Field label="Cidade">
              <Input placeholder="parte do nome"
                value={filtros.cidade || ''} onChange={(e) => setF('cidade', e.target.value)} />
            </Field>
          </Section>

          <Section title="🏢 Empresa">
            <Field label="CNPJ">
              <Input placeholder="só números"
                value={filtros.empregador_cnpj || ''} onChange={(e) => setF('empregador_cnpj', e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field label="Nome empresa">
              <Input placeholder="parte do nome"
                value={filtros.empregador_nome || ''} onChange={(e) => setF('empregador_nome', e.target.value)} />
            </Field>
            <Field label="Função (CBO)">
              <Input placeholder="ex: 354145"
                value={filtros.cbo || ''} onChange={(e) => setF('cbo', e.target.value)} />
            </Field>
            <Field label="Setor (CNAE)">
              <Input placeholder="ex: 2790299"
                value={filtros.cnae || ''} onChange={(e) => setF('cnae', e.target.value)} />
            </Field>
            <Field label="Tempo casa mín (meses)">
              <Input type="number" placeholder="ex: 12"
                value={filtros.tempo_empresa_min_meses ?? ''} onChange={(e) => setF('tempo_empresa_min_meses', e.target.value ? parseInt(e.target.value) : '')} />
            </Field>
          </Section>

          <Section title="📋 Situação e contato">
            <Field label="Situação">
              <select
                value={filtros.ativo === true ? 'true' : filtros.ativo === false ? 'false' : ''}
                onChange={(e) => setF('ativo', e.target.value === '' ? undefined : e.target.value === 'true')}
                className="h-10 px-3 text-sm rounded-md border border-input bg-background w-full"
              >
                <option value="true">Ativos (vínculo atual)</option>
                <option value="false">Demitidos</option>
                <option value="">Todos</option>
              </select>
            </Field>
            <CheckboxItem
              label="📱 Tem telefone"
              checked={!!filtros.tem_telefone}
              onChange={(c) => setF('tem_telefone', c || undefined)}
            />
            <CheckboxItem
              label="📧 Tem e-mail"
              checked={!!filtros.tem_email}
              onChange={(c) => setF('tem_email', c || undefined)}
            />
          </Section>
        </CardContent>
      </Card>

      {/* Filtro de bancos pra disparo */}
      <Card>
        <CardContent className="p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
            🎯 Disparar higienização em quais bancos? (vazio = todos)
          </div>
          <div className="flex flex-wrap gap-2">
            {BANCOS_DISP.map(b => (
              <button
                key={b.slug}
                onClick={() => setBancosDispara((s) => {
                  const novo = new Set(s);
                  if (novo.has(b.slug)) novo.delete(b.slug); else novo.add(b.slug);
                  return novo;
                })}
                className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                  bancosDispara.has(b.slug)
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:bg-secondary'
                }`}
              >
                {b.label}
              </button>
            ))}
            {bancosDispara.size > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setBancosDispara(new Set())}>Limpar</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Bloco contagem + ações */}
      <Card className="border-2 border-primary/30 bg-gradient-to-br from-primary/5 to-accent/5">
        <CardContent className="p-4 flex items-center justify-between flex-wrap gap-3">
          <div>
            {contar.isLoading ? (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Contando CPFs...
              </div>
            ) : total !== null && total !== undefined ? (
              <>
                <div className="text-3xl font-black text-primary leading-none">
                  {total.toLocaleString('pt-BR')}
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  CPFs encontrados {modo === 'estimado' ? '(estimativa)' : '(exato)'}
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">Aplique filtros pra ver a contagem.</div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={listar.isPending}
              onClick={() => listar.mutate(filtros)} className="gap-2">
              {listar.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
              Ver amostra
            </Button>
            <Button variant="outline" size="sm" disabled={exportar.isPending || !total}
              onClick={() => {
                if (!confirm('Vou gerar CSV com até 50.000 CPFs filtrados. Pode demorar 10-30s. Continuar?')) return;
                exportar.mutate(filtros);
              }} className="gap-2 border-green-500/50 text-green-400">
              {exportar.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Download CSV
            </Button>
            <Button size="sm" disabled={higienizar.isPending || !total}
              onClick={() => {
                const lim = Math.min(total || 0, 1000);
                const labelB = bancosDispara.size > 0
                  ? `nos bancos: ${[...bancosDispara].join(', ')}`
                  : 'em TODOS os bancos disponíveis';
                if (!confirm(`Vou enviar ${lim.toLocaleString('pt-BR')} CPFs (limite 1000) pra higienização CLT ${labelB}.\n\nContinuar?`)) return;
                higienizar.mutate({ filtros, bancos: bancosDispara.size > 0 ? [...bancosDispara] : undefined });
              }} className="gap-2">
              {higienizar.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
              Higienizar lote (1000)
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Amostra */}
      {listar.data?.cpfs && listar.data.cpfs.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold">📋 Amostra ({listar.data.cpfs.length} primeiros)</div>
              <Badge variant="muted" className="text-[10px]">{listar.data.total_pagina} carregados</Badge>
            </div>
            <div className="max-h-[60vh] overflow-auto border border-border rounded-md">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card border-b border-border">
                  <tr>
                    <th className="text-left p-2">CPF</th>
                    <th className="text-left p-2">Nome</th>
                    <th className="text-left p-2">Sexo</th>
                    <th className="text-left p-2">Nasc</th>
                    <th className="text-left p-2">Empresa</th>
                    <th className="text-left p-2">CBO</th>
                    <th className="text-left p-2">Cidade</th>
                    <th className="text-left p-2">📱</th>
                  </tr>
                </thead>
                <tbody>
                  {listar.data.cpfs.map((c) => (
                    <tr key={c.cpf} className="border-b border-border/50 hover:bg-secondary/30">
                      <td className="p-2 font-mono">{formatCpf(c.cpf)}</td>
                      <td className="p-2">{(c.nome || '').substring(0, 30)}</td>
                      <td className="p-2">{c.sexo || '-'}</td>
                      <td className="p-2">{formatDateBR(c.data_nascimento || '')}</td>
                      <td className="p-2">{(c.empregador_nome || '').substring(0, 25)}</td>
                      <td className="p-2">{c.cbo || '-'}</td>
                      <td className="p-2">{c.cidade || '-'}/{c.uf || '-'}</td>
                      <td className="p-2">{c.ddd && c.telefone ? '✓' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-2">{title}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-[10px] uppercase text-muted-foreground tracking-wider">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function CheckboxItem({ label, checked, onChange }: { label: string; checked: boolean; onChange: (c: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none mt-6 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded border-input" />
      {label}
    </label>
  );
}
