'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAnalisarHolerite, fileToBase64 } from '@/hooks/use-gov-holerite';
import { useGovConvenios } from '@/hooks/use-gov-convenios';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, FileUp, Trash2, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { AnalisarHoleriteResponse, DadosExtraidosHolerite, BancoAtende, BancoNaoAtende } from '@/lib/gov-types';
import { formatBRL } from '@/lib/utils';

const MAX_BYTES = 10 * 1024 * 1024;

export default function GovHoleritePage() {
  const sp = useSearchParams();
  const slugInicial = sp.get('convenio') || '';
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [convenioSlug, setConvenioSlug] = useState<string>(slugInicial);
  const [resultado, setResultado] = useState<AnalisarHoleriteResponse | null>(null);

  const conveniosQ = useGovConvenios();
  const mut = useAnalisarHolerite();

  useEffect(() => {
    if (slugInicial) setConvenioSlug(slugInicial);
  }, [slugInicial]);

  const onPickFile = (f: File | null | undefined) => {
    if (!f) return;
    if (f.size > MAX_BYTES) {
      alert('Arquivo > 10MB. Reduza ou comprima.');
      return;
    }
    const tipo = f.type;
    const ok = tipo === 'application/pdf' || tipo.startsWith('image/');
    if (!ok) {
      alert('Tipo não suportado. Use PDF ou imagem (JPG/PNG/WEBP).');
      return;
    }
    setArquivo(f);
    setResultado(null);
  };

  const onAnalisar = async () => {
    if (!arquivo) return;
    try {
      const base64 = await fileToBase64(arquivo);
      const r = await mut.mutateAsync({
        arquivo_base64: base64,
        arquivo_nome: arquivo.name,
        arquivo_tipo: arquivo.type,
        ...(convenioSlug ? { convenio_slug: convenioSlug } : {}),
      });
      setResultado(r);
    } catch (e) {
      // erro fica visível pelo mut.error
    }
  };

  const onLimpar = () => {
    setArquivo(null);
    setResultado(null);
    mut.reset();
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">📄 Análise de Holerite</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Sobe o holerite (PDF ou foto). A IA extrai os dados e cruza com a base
          de bancos do convênio para mostrar quais atendem.
        </p>
      </div>

      {/* Upload */}
      <Card>
        <CardContent className="p-6 text-center border-2 border-dashed border-border rounded-md">
          {!arquivo ? (
            <>
              <FileUp className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              <div className="text-sm text-muted-foreground mb-3">
                Arraste o arquivo aqui ou clique no botão
              </div>
              <input
                type="file"
                id="govHolFile"
                accept="application/pdf,image/*"
                className="hidden"
                onChange={(e) => onPickFile(e.target.files?.[0])}
              />
              <Button onClick={() => document.getElementById('govHolFile')?.click()}>
                📎 Selecionar arquivo
              </Button>
              <div className="text-[11px] text-muted-foreground mt-2">
                PDF, JPG, PNG ou WEBP — máx 10MB
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-bold">📎 {arquivo.name}</div>
              <div className="text-[11px] text-muted-foreground mt-1">
                {(arquivo.size / 1024).toFixed(0)} KB · {arquivo.type}
              </div>
              <Button variant="outline" size="sm" onClick={onLimpar} className="mt-3 gap-1">
                <Trash2 className="w-3.5 h-3.5" /> Trocar arquivo
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Convênio (opcional) */}
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="text-xs text-muted-foreground">
            Convênio (opcional — se não escolher, a IA tenta detectar):
          </div>
          <select
            value={convenioSlug}
            onChange={(e) => setConvenioSlug(e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
          >
            <option value="">— Detectar automaticamente —</option>
            {conveniosQ.data?.grupos.map((g) => (
              <optgroup key={g.uf} label={`${g.uf} — ${g.estado_nome || ''}`}>
                {g.convenios.map((c) => (
                  <option key={c.slug} value={c.slug}>{c.nome}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </CardContent>
      </Card>

      <div className="text-center">
        <Button
          onClick={onAnalisar}
          disabled={!arquivo || mut.isPending}
          size="lg"
          className="gap-2"
        >
          {mut.isPending ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Analisando com IA… (pode levar 10-30s)</>
          ) : (
            <>🔍 Analisar Holerite</>
          )}
        </Button>
      </div>

      {mut.error && !mut.isPending && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 flex gap-3 text-destructive">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <div className="text-sm">{(mut.error as Error).message}</div>
          </CardContent>
        </Card>
      )}

      {resultado && <ResultadoAnalise resultado={resultado} />}
    </div>
  );
}

function ResultadoAnalise({ resultado }: { resultado: AnalisarHoleriteResponse }) {
  const dados = resultado.dados_extraidos;
  const conv = resultado.convenio;
  const atendem = resultado.bancos_atendem || [];
  const naoAtendem = resultado.bancos_nao_atendem || [];

  return (
    <div className="space-y-4">
      {/* Dados Extraidos */}
      <Card>
        <CardContent className="p-4">
          <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-2">
            📊 Dados Extraídos
          </div>
          <DadosGrid dados={dados} />
          {dados.observacoes && (
            <div className="mt-3 p-2.5 rounded-md bg-yellow-500/10 text-xs text-yellow-200">
              <b>Obs IA:</b> {dados.observacoes}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Convenio sugerido */}
      {conv ? (
        <Card>
          <CardContent className="p-4 flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                Convênio identificado
              </div>
              <div className="font-bold">{conv.nome}</div>
              {conv.uf && <div className="text-xs text-muted-foreground">{conv.uf}</div>}
            </div>
            <Badge variant={resultado.convenio_confianca === 'alta' || resultado.convenio_confianca === 'usuario' ? 'success' : 'muted'}>
              Confiança: {resultado.convenio_confianca || 'baixa'}
            </Badge>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-yellow-500/50 bg-yellow-500/5">
          <CardContent className="p-4 text-sm text-yellow-200">
            ⚠️ Convênio não identificado. Selecione manualmente no dropdown e clique novamente em Analisar.
          </CardContent>
        </Card>
      )}

      {/* Bancos que atendem */}
      <Card className="border-green-500/40">
        <CardContent className="p-4">
          <div className="text-sm font-bold text-green-400 mb-3 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            {atendem.length} banco(s) atendem este cliente
          </div>
          {atendem.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              Nenhum banco do convênio atende com os dados extraídos.
            </div>
          ) : (
            <div className="space-y-2">
              {atendem.map((b) => <BancoAtendeCard key={b.banco_id} b={b} />)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Nao atendem */}
      {naoAtendem.length > 0 && (
        <details className="rounded-md border border-border bg-card">
          <summary className="p-4 cursor-pointer text-xs text-muted-foreground font-bold flex items-center gap-2">
            <XCircle className="w-4 h-4" /> {naoAtendem.length} banco(s) NÃO atendem (clique pra ver)
          </summary>
          <div className="p-4 pt-0 space-y-2">
            {naoAtendem.map(b => <BancoNaoAtendeCard key={b.banco_id} b={b} />)}
          </div>
        </details>
      )}
    </div>
  );
}

function DadosGrid({ dados }: { dados: DadosExtraidosHolerite }) {
  const campos: [string, string | null][] = [
    ['Nome', dados.nome],
    ['CPF', dados.cpf],
    ['Matrícula', dados.matricula],
    ['Cargo', dados.cargo],
    ['Órgão', dados.orgao],
    ['UF', dados.uf],
    ['Data nasc.', dados.data_nascimento],
    ['Idade', dados.idade ? `${dados.idade} anos` : null],
    ['Competência', dados.competencia],
    ['Salário bruto', dados.salario_bruto ? formatBRL(dados.salario_bruto) : null],
    ['Salário líquido', dados.salario_liquido ? formatBRL(dados.salario_liquido) : null],
    ['Total descontos', dados.total_descontos ? formatBRL(dados.total_descontos) : null],
    ['Margem consig. disp.', dados.margem_consignavel_disponivel ? formatBRL(dados.margem_consignavel_disponivel) : null],
    ['Margem cartão disp.', dados.margem_cartao_disponivel ? formatBRL(dados.margem_cartao_disponivel) : null],
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
      {campos.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => (
        <div key={k}>
          <div className="text-[10px] uppercase text-muted-foreground font-bold">{k}</div>
          <div className="font-semibold">{v}</div>
        </div>
      ))}
    </div>
  );
}

function BancoAtendeCard({ b }: { b: BancoAtende }) {
  const r = b.regras;
  const ops = [];
  if (r.opera_novo) ops.push('Novo');
  if (r.opera_refin) ops.push('Refin');
  if (r.opera_port) ops.push('Port');
  if (r.opera_cartao) ops.push('Cartão');
  return (
    <div className="rounded-md border border-border bg-background/50 p-3">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <div className="font-bold text-sm">{b.banco_nome || '?'}</div>
        <div className="flex flex-wrap gap-1">
          {ops.map(o => <Badge key={o} variant="success" className="text-[10px]">{o}</Badge>)}
        </div>
      </div>
      {b.observacoes && b.observacoes.length > 0 && (
        <ul className="list-disc pl-4 text-[11px] text-muted-foreground space-y-0.5 mt-1">
          {b.observacoes.map((o, i) => <li key={i}>{o}</li>)}
        </ul>
      )}
    </div>
  );
}

function BancoNaoAtendeCard({ b }: { b: BancoNaoAtende }) {
  return (
    <div className="rounded-md bg-background/50 p-2.5 text-xs">
      <b>{b.banco_nome || '?'}</b> <span className="text-muted-foreground">— {b.motivo}</span>
    </div>
  );
}
