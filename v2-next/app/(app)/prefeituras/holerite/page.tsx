'use client';

import { useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Upload, FileText, AlertCircle, CheckCircle2, XCircle, Search } from 'lucide-react';
import { formatBRL } from '@/lib/utils';
import {
  useAnalisarHolerite,
  usePrefConvenios,
  type HoleriteDadosExtraidos,
  type BancoCruzado,
  type AnalisarHoleriteResponse,
} from '@/hooks/use-pref-catalogo';
import type { PrefConvenio } from '@/lib/pref-types';

const MAX_BYTES = 10 * 1024 * 1024;

interface Arquivo {
  base64: string;
  nome: string;
  tipo: string;
  tamanho: number;
}

export default function HoleritePage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<Arquivo | null>(null);
  const [convenioForcado, setConvenioForcado] = useState<string>('');
  const [resultado, setResultado] = useState<AnalisarHoleriteResponse | null>(null);

  const { data: catalogo } = usePrefConvenios();
  const analisar = useAnalisarHolerite();

  function onSelecionarArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_BYTES) {
      alert('Arquivo > 10MB. Reduza ou comprima.');
      return;
    }
    if (!(f.type === 'application/pdf' || f.type.startsWith('image/'))) {
      alert('Tipo não suportado. Use PDF ou imagem (JPG/PNG/WEBP).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const b64 = dataUrl.split(',')[1] || '';
      setArquivo({ base64: b64, nome: f.name, tipo: f.type, tamanho: f.size });
      setResultado(null);
    };
    reader.onerror = () => alert('Falha ao ler arquivo');
    reader.readAsDataURL(f);
  }

  function trocarArquivo() {
    setArquivo(null);
    setResultado(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function rodarAnalise() {
    if (!arquivo) return;
    const r = await analisar.mutateAsync({
      arquivo_base64: arquivo.base64,
      arquivo_nome: arquivo.nome,
      arquivo_tipo: arquivo.tipo,
      convenio_slug: convenioForcado || undefined,
    });
    setResultado(r);
  }

  // Lista de convênios pra dropdown (agrupado por UF)
  const conveniosPorUf = (() => {
    const map = new Map<string, { uf: string; estado_nome: string | null; convenios: PrefConvenio[] }>();
    for (const c of catalogo?.convenios || []) {
      const uf = c.uf || 'OUTROS';
      let g = map.get(uf);
      if (!g) { g = { uf, estado_nome: c.estado_nome, convenios: [] }; map.set(uf, g); }
      g.convenios.push(c);
    }
    return Array.from(map.values()).sort((a, b) => (a.uf || 'ZZ').localeCompare(b.uf || 'ZZ'));
  })();

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">📄 Análise de Holerite — Prefeituras</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Suba o holerite do servidor (PDF ou foto). A IA extrai os dados, identifica o município e cruza com os bancos que atendem aquele convênio.
        </p>
      </div>

      {/* Upload */}
      <Card>
        <CardContent className="p-6">
          {!arquivo ? (
            <div className="border-2 border-dashed border-border rounded-lg p-8 text-center space-y-3">
              <Upload className="w-10 h-10 mx-auto text-muted-foreground" />
              <div className="text-sm text-muted-foreground">Arraste o arquivo ou clique no botão</div>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,image/*"
                className="hidden"
                onChange={onSelecionarArquivo}
              />
              <Button onClick={() => fileRef.current?.click()} className="gap-2">
                <Upload className="w-4 h-4" /> Selecionar arquivo
              </Button>
              <div className="text-[11px] text-muted-foreground">PDF, JPG, PNG ou WEBP — máx 10MB</div>
            </div>
          ) : (
            <div className="border border-border rounded-lg p-4 flex items-center gap-3 flex-wrap">
              <FileText className="w-8 h-8 text-primary flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate">{arquivo.nome}</div>
                <div className="text-[11px] text-muted-foreground">
                  {(arquivo.tamanho / 1024).toFixed(0)} KB · {arquivo.tipo}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={trocarArquivo}>🗑 Trocar arquivo</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Forçar convênio (opcional) */}
      <Card>
        <CardContent className="p-4">
          <div className="text-xs text-muted-foreground mb-2">
            Convênio (opcional — se não escolher, a IA tenta detectar pelo holerite):
          </div>
          <select
            value={convenioForcado}
            onChange={(e) => setConvenioForcado(e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
          >
            <option value="">— Detectar automaticamente —</option>
            {conveniosPorUf.map((g) => (
              <optgroup key={g.uf} label={`${g.uf} - ${g.estado_nome || ''}`}>
                {g.convenios.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.nome}{c.municipio ? ` (${c.municipio})` : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </CardContent>
      </Card>

      {/* Botão analisar */}
      <div className="flex justify-center">
        <Button
          size="lg"
          onClick={rodarAnalise}
          disabled={!arquivo || analisar.isPending}
          className="gap-2 px-8"
        >
          {analisar.isPending ? (
            <>⏳ Analisando com IA…</>
          ) : (
            <><Search className="w-4 h-4" /> Analisar Holerite</>
          )}
        </Button>
      </div>

      {/* Loading skeleton */}
      {analisar.isPending && (
        <div className="space-y-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-40" />
        </div>
      )}

      {/* Erro */}
      {analisar.error && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-bold text-destructive">Erro na análise</div>
              <div className="text-muted-foreground mt-1">{(analisar.error as Error).message}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Resultado */}
      {resultado && <ResultadoBlocos r={resultado} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
function ResultadoBlocos({ r }: { r: AnalisarHoleriteResponse }) {
  const d = r.dados_extraidos || {};
  const c = r.convenio || null;
  const atendem = r.bancos_atendem || [];
  const naoAtendem = r.bancos_nao_atendem || [];

  return (
    <div className="space-y-4">
      <DadosExtraidos d={d} />
      <ConvenioBox convenio={c} confianca={r.convenio_confianca} />

      {/* Bancos que atendem */}
      <Card className="border-green-500/40">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-5 h-5 text-green-500" />
            <span className="font-bold text-green-500">
              {atendem.length} banco(s) atendem este servidor
            </span>
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

      {/* Não atendem */}
      {naoAtendem.length > 0 && (
        <details className="rounded-md border border-border">
          <summary className="cursor-pointer p-3 text-xs font-bold text-muted-foreground flex items-center gap-2">
            <XCircle className="w-4 h-4" />
            {naoAtendem.length} banco(s) NÃO atendem (clique pra ver motivo)
          </summary>
          <div className="p-3 pt-0 space-y-1">
            {naoAtendem.map((b) => (
              <div key={b.banco_id} className="text-xs p-2 bg-background/50 rounded">
                <b>{b.banco_nome}</b> — <span className="text-muted-foreground">{b.motivo}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function DadosExtraidos({ d }: { d: HoleriteDadosExtraidos }) {
  const campos: Array<[string, string | null | undefined]> = [
    ['Nome', d.nome],
    ['CPF', d.cpf],
    ['Matrícula', d.matricula],
    ['Cargo', d.cargo],
    ['Órgão', d.orgao],
    ['Município', d.municipio],
    ['UF', d.uf],
    ['Regime', d.regime_previdenciario],
    ['Vínculo', d.tipo_vinculo],
    ['Data nasc.', d.data_nascimento],
    ['Idade', d.idade ? `${d.idade} anos` : null],
    ['Competência', d.competencia],
    ['Salário bruto', d.salario_bruto ? formatBRL(d.salario_bruto) : null],
    ['Salário líquido', d.salario_liquido ? formatBRL(d.salario_liquido) : null],
    ['Total descontos', d.total_descontos ? formatBRL(d.total_descontos) : null],
    ['Margem consig. disp.', d.margem_consignavel_disponivel ? formatBRL(d.margem_consignavel_disponivel) : null],
    ['Margem cartão disp.', d.margem_cartao_disponivel ? formatBRL(d.margem_cartao_disponivel) : null],
  ];

  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-3">
          📊 Dados Extraídos
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-sm">
          {campos.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([lab, v]) => (
            <div key={lab}>
              <div className="text-[10px] uppercase text-muted-foreground">{lab}</div>
              <div className="font-semibold truncate">{String(v)}</div>
            </div>
          ))}
        </div>
        {d.observacoes && (
          <div className="mt-3 p-2 bg-yellow-500/10 rounded text-xs text-foreground/80 border-l-2 border-yellow-500">
            <b>Obs IA:</b> {d.observacoes}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConvenioBox({ convenio, confianca }: { convenio: PrefConvenio | null; confianca?: string }) {
  if (!convenio) {
    return (
      <Card className="border-yellow-500/50 bg-yellow-500/5">
        <CardContent className="p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-bold text-yellow-500">Convênio não identificado</div>
            <div className="text-muted-foreground mt-1">
              Selecione manualmente acima e re-analise para ver os bancos que atendem.
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }
  const conf = (confianca || 'baixa').toLowerCase();
  const corPill = conf === 'alta' || conf === 'usuario' ? 'success' : conf === 'media' ? 'muted' : 'destructive';
  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] uppercase text-muted-foreground">Convênio identificado</div>
          <div className="font-bold text-base">{convenio.nome}</div>
          <div className="text-[11px] text-muted-foreground">
            {convenio.uf}{convenio.municipio ? ` · 📍 ${convenio.municipio}` : ''}
          </div>
        </div>
        <Badge variant={corPill as 'success' | 'muted' | 'destructive'} className="text-[10px]">
          Confiança: {conf}
        </Badge>
      </CardContent>
    </Card>
  );
}

function BancoAtendeCard({ b }: { b: BancoCruzado }) {
  const obs = b.observacoes || [];
  return (
    <div className="rounded-md border border-border bg-background/50 p-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="font-semibold">🏦 {b.banco_nome}</div>
      </div>
      {obs.length > 0 && (
        <ul className="mt-2 pl-4 text-[11px] text-muted-foreground list-disc space-y-0.5">
          {obs.map((o, i) => <li key={i}>{o}</li>)}
        </ul>
      )}
    </div>
  );
}
