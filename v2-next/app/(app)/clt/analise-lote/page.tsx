'use client';

import { useMemo, useState } from 'react';
import { useBulkLookupCAGED, useHigienizarLoteComBancos, CpfCagedInfo } from '@/hooks/use-clt-analise-lote';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCpf, formatCnpj, formatDateBR } from '@/lib/utils';
import { ListChecks, Loader2, Rocket, Upload, Search } from 'lucide-react';

const BANCOS = [
  { slug: 'fintech_qi', label: 'Fintech (QI Tech)' },
  { slug: 'fintech_celcoin', label: 'Fintech (Celcoin)' },
  { slug: 'handbank', label: 'Handbank · UY3' },
  { slug: 'joinbank', label: 'JoinBank/QualiBanking' },
  { slug: 'mercantil', label: 'Mercantil' },
  { slug: 'c6', label: 'C6 Bank' },
  { slug: 'presencabank', label: 'PresençaBank' },
  { slug: 'v8_qi', label: 'V8 (QI Tech)' },
  { slug: 'v8_celcoin', label: 'V8 (Celcoin)' },
];

export default function AnaliseLotePage() {
  const [textoCpfs, setTextoCpfs] = useState('');
  const [bancosSelecionados, setBancosSelecionados] = useState<Set<string>>(new Set());
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  const lookup = useBulkLookupCAGED();
  const higienizar = useHigienizarLoteComBancos();

  // Extrai CPFs do textarea (1 por linha)
  const cpfs = useMemo(() => {
    return textoCpfs
      .split(/[\n,;]+/)
      .map(s => s.replace(/\D/g, ''))
      .filter(c => c.length >= 9 && c.length <= 11)
      .map(c => c.padStart(11, '0').slice(-11));
  }, [textoCpfs]);

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => setTextoCpfs(String(ev.target?.result || ''));
    reader.readAsText(f);
  }

  function toggleBanco(slug: string) {
    setBancosSelecionados((s) => {
      const novo = new Set(s);
      if (novo.has(slug)) novo.delete(slug); else novo.add(slug);
      return novo;
    });
  }

  function toggleCpf(cpf: string) {
    setSelecionados((s) => {
      const novo = new Set(s);
      if (novo.has(cpf)) novo.delete(cpf); else novo.add(cpf);
      return novo;
    });
  }

  function toggleAll() {
    if (selecionados.size === lookup.data?.encontrados.length) {
      setSelecionados(new Set());
    } else {
      setSelecionados(new Set(lookup.data?.encontrados.map(c => c.cpf) || []));
    }
  }

  function disparar() {
    const encontrados = lookup.data?.encontrados || [];
    const escolhidos = encontrados.filter(c => selecionados.has(c.cpf));
    if (!escolhidos.length) return;
    const labelBancos = bancosSelecionados.size > 0
      ? `nos bancos: ${[...bancosSelecionados].join(', ')}`
      : 'em TODOS os bancos disponíveis';
    if (!confirm(`Vou higienizar ${escolhidos.length} CPFs ${labelBancos}.\n\nContinuar?`)) return;
    higienizar.mutate({
      cpfs: escolhidos.map(c => ({
        cpf: c.cpf, nome: c.nome, ddd: c.ddd, telefone: c.telefone,
      })),
      bancos: bancosSelecionados.size > 0 ? [...bancosSelecionados] : undefined,
    });
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ListChecks className="w-6 h-6 text-primary" /> CLT — Análise em Lote
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cole uma lista de CPFs (1 por linha), veja quem tem vínculo no CAGED e dispare higienização em banco específico ou todos.
        </p>
      </div>

      {/* Form: input de CPFs */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground tracking-wider">
              Lista de CPFs (1 por linha — aceita também separados por vírgula ou ponto-e-vírgula)
            </Label>
            <textarea
              className="mt-1 w-full min-h-[160px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
              placeholder="12345678901&#10;98765432100&#10;..."
              value={textoCpfs}
              onChange={(e) => setTextoCpfs(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 text-xs cursor-pointer text-muted-foreground hover:text-foreground">
              <Upload className="w-4 h-4" />
              <span>Upload TXT/CSV</span>
              <input type="file" accept=".txt,.csv" className="hidden" onChange={onUpload} />
            </label>
            <Badge variant="muted" className="ml-auto">{cpfs.length} CPFs válidos</Badge>
            <Button
              size="sm"
              disabled={!cpfs.length || lookup.isPending}
              onClick={() => lookup.mutate(cpfs)}
              className="gap-2"
            >
              {lookup.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Buscar no CAGED
            </Button>
          </div>
        </CardContent>
      </Card>

      {lookup.isPending && (
        <div className="space-y-2">
          <Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" />
        </div>
      )}

      {lookup.data && (
        <>
          {/* Resumo */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <Kpi label="Total enviado" valor={cpfs.length} />
            <Kpi label="Encontrados no CAGED" valor={lookup.data.encontrados.length} cor="text-green-400" />
            <Kpi label="Não encontrados" valor={lookup.data.nao_encontrados.length} cor="text-yellow-500" />
          </div>

          {/* Filtro de bancos pra higienização */}
          {lookup.data.encontrados.length > 0 && (
            <Card className="border-primary/30">
              <CardContent className="p-4 space-y-3">
                <div>
                  <div className="text-sm font-bold mb-1">🎯 Disparar higienização</div>
                  <div className="text-xs text-muted-foreground">
                    Selecione quais bancos consultar (vazio = todos) e os CPFs do resultado abaixo.
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {BANCOS.map(b => (
                    <button
                      key={b.slug}
                      onClick={() => toggleBanco(b.slug)}
                      className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                        bancosSelecionados.has(b.slug)
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-border hover:bg-secondary'
                      }`}
                    >
                      {b.label}
                    </button>
                  ))}
                  {bancosSelecionados.size > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => setBancosSelecionados(new Set())}>
                      Limpar
                    </Button>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-border">
                  <div className="text-xs text-muted-foreground">
                    {selecionados.size} CPFs selecionados
                    {bancosSelecionados.size > 0
                      ? ` · ${bancosSelecionados.size} banco(s)`
                      : ' · TODOS bancos'}
                  </div>
                  <Button
                    size="sm"
                    disabled={!selecionados.size || higienizar.isPending}
                    onClick={disparar}
                    className="gap-2"
                  >
                    {higienizar.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
                    Higienizar {selecionados.size} CPFs
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tabela CPFs encontrados */}
          {lookup.data.encontrados.length > 0 && (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-secondary/30 border-b border-border">
                    <tr>
                      <th className="text-left p-2 w-8">
                        <input type="checkbox"
                          checked={selecionados.size === lookup.data.encontrados.length}
                          onChange={toggleAll} />
                      </th>
                      <th className="text-left p-2">CPF</th>
                      <th className="text-left p-2">Nome</th>
                      <th className="text-left p-2">Empresa</th>
                      <th className="text-left p-2">CNPJ</th>
                      <th className="text-left p-2">Cidade</th>
                      <th className="text-left p-2">Admissão</th>
                      <th className="text-center p-2">📱</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lookup.data.encontrados.map((c) => (
                      <tr key={c.cpf} className="border-b border-border/50 hover:bg-secondary/20">
                        <td className="p-2">
                          <input type="checkbox" checked={selecionados.has(c.cpf)} onChange={() => toggleCpf(c.cpf)} />
                        </td>
                        <td className="p-2 font-mono">{formatCpf(c.cpf)}</td>
                        <td className="p-2">{(c.nome || '').substring(0, 30)}</td>
                        <td className="p-2 text-muted-foreground">{(c.empregador_nome || '-').substring(0, 25)}</td>
                        <td className="p-2 font-mono text-muted-foreground text-[10px]">
                          {c.empregador_cnpj ? formatCnpj(c.empregador_cnpj) : '-'}
                        </td>
                        <td className="p-2 text-muted-foreground">{c.cidade || '-'}/{c.uf || '-'}</td>
                        <td className="p-2 text-muted-foreground">{formatDateBR(c.data_admissao || '')}</td>
                        <td className="p-2 text-center">{c.ddd && c.telefone ? '✓' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* Não encontrados */}
          {lookup.data.nao_encontrados.length > 0 && (
            <Card className="border-yellow-500/30">
              <CardContent className="p-3">
                <details>
                  <summary className="cursor-pointer text-sm font-bold text-yellow-500">
                    ⚠️ {lookup.data.nao_encontrados.length} CPFs sem vínculo no CAGED 2024
                  </summary>
                  <div className="mt-2 max-h-[200px] overflow-auto text-xs font-mono space-y-0.5">
                    {lookup.data.nao_encontrados.map(cpf => (
                      <div key={cpf} className="text-muted-foreground">{formatCpf(cpf)}</div>
                    ))}
                  </div>
                </details>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({ label, valor, cor }: { label: string; valor: number; cor?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`text-2xl font-black mt-0.5 ${cor || ''}`}>{valor.toLocaleString('pt-BR')}</div>
      </CardContent>
    </Card>
  );
}
