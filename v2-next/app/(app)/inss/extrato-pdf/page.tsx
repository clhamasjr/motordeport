'use client';

import { useState, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatBRL } from '@/lib/utils';
import {
  parsePdfInssFromFile, analisarEnquadramento,
  type InssExtratoResultado, type AnaliseExtrato,
} from '@/lib/inss-pdf-parser';
import {
  FileText, Upload, X, CheckCircle2, AlertTriangle, XCircle,
  Scissors, RefreshCw, AlertCircle, CreditCard, Banknote, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';

export default function ExtratoPdfPage() {
  const [ext, setExt] = useState<InssExtratoResultado | null>(null);
  const [loading, setLoading] = useState(false);
  const [fname, setFname] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Suba um PDF do extrato INSS (gerado em meu.inss.gov.br)');
      return;
    }
    setLoading(true);
    setFname(file.name);
    try {
      const r = await parsePdfInssFromFile(file);
      setExt(r);
      if (r.tipo !== 'historico_consignado') {
        toast.error(r.motivo || 'PDF não é um Histórico de Empréstimo Consignado');
      } else {
        toast.success(`Extrato de ${r.beneficiario.nome || '(sem nome)'} lido — ${r.contratos.length} contrato(s), ${r.cartoes.length} cartão(ões)`);
      }
    } catch (e) {
      toast.error('Erro ao ler PDF: ' + (e instanceof Error ? e.message : 'desconhecido'));
    } finally {
      setLoading(false);
    }
  }

  const analise = ext ? analisarEnquadramento(ext) : null;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileText className="size-6 text-orange-400" />
          INSS — Leitor de Extrato PDF
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Suba o &quot;Histórico de Empréstimo Consignado&quot; do INSS (PDF de meu.inss.gov.br) e o sistema lê
          todo o extrato, identifica contratos + cartões + saldos devedores e analisa o enquadramento na
          NOVA regra de 40%.
        </p>
      </div>

      {!ext ? (
        <Card
          className="border-dashed border-2 cursor-pointer hover:bg-muted/30 transition-colors"
          onClick={() => inputRef.current?.click()}
        >
          <CardContent className="p-10 text-center">
            <Upload className="size-12 mx-auto mb-3 text-muted-foreground/50" />
            <div className="font-semibold text-lg mb-1">Carregar extrato PDF do INSS</div>
            <div className="text-sm text-muted-foreground mb-4">
              {loading ? 'Lendo PDF...' : 'Clique pra selecionar o arquivo'}
            </div>
            <Button disabled={loading} size="sm">
              {loading ? 'Processando...' : 'Selecionar PDF'}
            </Button>
            <div className="text-[10px] text-muted-foreground mt-3">
              Roda 100% no seu navegador — nenhum dado é enviado pra servidor.
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,application/pdf"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              className="hidden"
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Arquivo carregado */}
          <Card>
            <CardContent className="p-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <FileText className="size-5 text-green-400" />
                <div>
                  <div className="font-semibold text-sm">{fname}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {ext.geradoEm && `Extrato de ${ext.geradoEm} · `}
                    {ext.contratos.length} contrato(s) · {ext.cartoes.length} cartão(ões)
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
                  <Upload className="size-4" /> Outro PDF
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setExt(null)} className="text-destructive">
                  <X className="size-4" />
                </Button>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,application/pdf"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                className="hidden"
              />
            </CardContent>
          </Card>

          {/* Aviso: PDF é de outro tipo (não é histórico) */}
          {ext.tipo !== 'historico_consignado' && (
            <Card className="border-yellow-500/50 bg-yellow-500/5">
              <CardContent className="p-4 flex items-start gap-3">
                <AlertCircle className="size-6 text-yellow-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-bold text-yellow-400">⚠ PDF não é o &quot;Histórico de Empréstimo Consignado&quot;</div>
                  <div className="text-sm text-foreground mt-1">{ext.motivo}</div>
                  <div className="text-xs text-muted-foreground mt-2">
                    Como gerar o PDF certo:
                    <ol className="list-decimal list-inside mt-1 space-y-0.5">
                      <li>Acesse <span className="font-mono text-cyan-400">meu.inss.gov.br</span></li>
                      <li>Vá em <strong>&quot;Consignado&quot; → &quot;Solicitar Histórico de Empréstimo Consignado&quot;</strong></li>
                      <li>Baixe o PDF gerado e suba aqui</li>
                    </ol>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Cabeçalho beneficiário (só se for histórico válido) */}
          {ext.tipo === 'historico_consignado' && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-start justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-xl font-bold">{ext.beneficiario.nome || '(sem nome)'}</h2>
                  <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    <span className="font-mono">NB {ext.beneficiario.nb}</span>
                    {ext.beneficiario.especie && <span>{ext.beneficiario.especie}</span>}
                    {ext.beneficiario.situacao && (
                      <Badge variant={ext.beneficiario.situacao === 'ATIVO' ? 'success' : 'muted'} className="text-[10px]">
                        {ext.beneficiario.situacao}
                      </Badge>
                    )}
                    {ext.beneficiario.elegivel && <Badge variant="info" className="text-[10px]">Elegível</Badge>}
                    {ext.beneficiario.bloqueado && <Badge variant="warning" className="text-[10px]">Bloqueado p/ desbloqueio</Badge>}
                  </div>
                  {ext.beneficiario.bancoConta && (
                    <div className="text-[10px] text-muted-foreground mt-1">
                      Pago em: <strong>{ext.beneficiario.bancoConta}</strong>{' '}
                      {ext.beneficiario.agencia && ` · Ag. ${ext.beneficiario.agencia}`}
                      {ext.beneficiario.contaCorrente && ` · CC ${ext.beneficiario.contaCorrente}`}
                    </div>
                  )}
                </div>
              </div>

              {/* KPIs */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                <Kpi label="Base cálculo" value={formatBRL(ext.margens.baseCalculo)} cor="text-cyan-400" />
                <Kpi label="Total comprometido" value={formatBRL(ext.margens.totalComprometido)} cor="text-yellow-400" />
                <Kpi label="Máx. permitido" value={formatBRL(ext.margens.maxComprometimentoPermitido)} cor="text-foreground" />
                {ext.margens.margemExtrapoladaTotal > 0 ? (
                  <Kpi label="⚠ Extrapolado" value={formatBRL(ext.margens.margemExtrapoladaTotal)} cor="text-red-400" />
                ) : (
                  <Kpi label="✅ Folga" value={formatBRL(Math.max(0, ext.margens.maxComprometimentoPermitido - ext.margens.totalComprometido))} cor="text-green-400" />
                )}
              </div>
            </CardContent>
          </Card>
          )}

          {/* Análise enquadramento NOVA regra */}
          {ext.tipo === 'historico_consignado' && analise && <AnaliseCard analise={analise} ext={ext} />}

          {/* Tabelas de detalhes */}
          {ext.tipo === 'historico_consignado' && ext.contratos.length > 0 && <ContratosTable ext={ext} />}
          {ext.tipo === 'historico_consignado' && ext.cartoes.length > 0 && <CartoesTable ext={ext} />}
        </>
      )}
    </div>
  );
}

function AnaliseCard({ analise, ext }: { analise: AnaliseExtrato; ext: InssExtratoResultado }) {
  const inviavel = !analise.enquadraNovaRegra
    && analise.contratosQueResolvem.length === 0
    && !analise.cartoesQueResolvem.some((c) => c.resolve && c.podeCancelarSemPagar);

  const cor = analise.enquadraNovaRegra ? 'border-green-500/40 bg-green-500/5'
    : inviavel ? 'border-red-500/40 bg-red-500/5'
    : 'border-yellow-500/40 bg-yellow-500/5';

  return (
    <Card className={cor}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-cyan-400" />
            <h3 className="font-bold text-base">Enquadramento na NOVA regra do INSS (40%)</h3>
          </div>
          <Badge
            variant={inviavel ? 'destructive' : !analise.enquadraNovaRegra ? 'warning' : 'success'}
            className="text-xs"
          >
            {analise.compPctSobre40}% / 40%
          </Badge>
        </div>

        {analise.enquadraNovaRegra ? (
          <Banner cor="green" icon={<CheckCircle2 className="size-5 text-green-400" />} titulo="✅ Cliente ENQUADRADO na nova regra">
            Comprometimento <strong className="font-mono">{formatBRL(analise.totalComprometido)}</strong> dentro
            do teto de 40% (<strong className="font-mono">{formatBRL(analise.teto40)}</strong>).
            {analise.totalComprometido < analise.teto40 && (
              <> Sobra <strong className="font-mono text-green-400">{formatBRL(analise.teto40 - analise.totalComprometido)}</strong> de margem livre.</>
            )}
          </Banner>
        ) : inviavel ? (
          <Banner cor="red" icon={<XCircle className="size-5 text-red-400" />} titulo="❌ INVIÁVEL com 1 operação só">
            Cliente extrapola em <strong className="font-mono text-red-400">{formatBRL(analise.excedenteNovaRegra)}</strong>.
            Nenhum contrato sozinho reduz parcela suficiente E nenhum cartão pode ser cancelado sem custo.
            <div className="mt-1 text-red-400 font-semibold">→ Precisaria combinar várias operações.</div>
          </Banner>
        ) : (
          <Banner cor="yellow" icon={<AlertTriangle className="size-5 text-yellow-400" />} titulo={`⚠ VAI EXTRAPOLAR — excedente ${formatBRL(analise.excedenteNovaRegra)}`}>
            Precisa de UMA operação que cubra esse valor. Soluções abaixo:
          </Banner>
        )}

        {/* Soluções */}
        {!analise.enquadraNovaRegra && (
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
              Soluções pra enquadrar (escolha 1):
            </div>

            {/* Cancelar cartão — só mostra se RESOLVE */}
            {analise.cartoesQueResolvem.filter((c) => c.resolve).map((c) => {
              const cartao = ext.cartoes.find((x) => x.contrato === c.contrato);
              return (
                <div key={c.contrato} className={`rounded-md border p-3 ${
                  c.podeCancelarSemPagar
                    ? 'border-green-500/40 bg-green-500/5'
                    : 'border-yellow-500/40 bg-yellow-500/5'
                }`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Scissors className={`size-4 shrink-0 ${c.podeCancelarSemPagar ? 'text-green-400' : 'text-yellow-400'}`} />
                    <div className="flex-1 text-xs">
                      <div className={`font-semibold ${c.podeCancelarSemPagar ? 'text-green-400' : 'text-yellow-400'}`}>
                        Cancelar cartão {c.tipo} ({cartao?.bancoNome || '?'})
                      </div>
                      <div className="text-muted-foreground mt-0.5">
                        Libera <strong className="font-mono text-foreground">{formatBRL(c.valorReservado)}</strong>{' '}
                        (≥ excedente <strong className="font-mono">{formatBRL(analise.excedenteNovaRegra)}</strong>)
                      </div>
                    </div>
                    <Badge variant={c.podeCancelarSemPagar ? 'success' : 'warning'} className="text-[10px]">
                      {c.podeCancelarSemPagar ? '✅ RESOLVE (sem custo)' : '⚠ TEM DÍVIDA'}
                    </Badge>
                  </div>
                  {!c.podeCancelarSemPagar && c.saldoDevedor > 0 && (
                    <div className="mt-2 text-[10px] rounded-md bg-yellow-500/10 border border-yellow-500/30 p-2 flex items-start gap-1.5">
                      <AlertCircle className="size-3 text-yellow-400 shrink-0 mt-0.5" />
                      <div>
                        <strong className="text-yellow-400">Atenção:</strong> esse cartão tem saldo devedor de{' '}
                        <strong className="font-mono">{formatBRL(c.saldoDevedor)}</strong>. Cancelar exige
                        QUITAR a dívida primeiro — provavelmente via troco de port/refin ou novo emp.
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Refin de contrato — só mostra se RESOLVE */}
            {analise.contratosQueResolvem.map((c) => (
              <div key={c.contrato} className="rounded-md border border-green-500/40 bg-green-500/5 p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <RefreshCw className="size-4 text-green-400 shrink-0" />
                  <div className="flex-1 text-xs">
                    <div className="font-semibold text-green-400">
                      Refin contrato <span className="font-mono">{c.contrato}</span> ({c.bancoNome})
                    </div>
                    <div className="text-muted-foreground mt-0.5">
                      Nova parcela estim: <strong className="font-mono text-green-400">{formatBRL(c.novaParc)}</strong>{' '}
                      (reduz <strong className="font-mono">{formatBRL(c.reducaoEstim)}</strong>)
                    </div>
                  </div>
                  <Badge variant="success" className="text-[10px]">✅ RESOLVE</Badge>
                </div>
              </div>
            ))}

            {/* Se NÃO há soluções */}
            {inviavel && (
              <div className="text-xs text-muted-foreground italic mt-2">
                Cartões totais ({analise.cartoesQueResolvem.length}) e contratos elegíveis pra refin:
                nenhum cobre os {formatBRL(analise.excedenteNovaRegra)} sozinho.
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ContratosTable({ ext }: { ext: InssExtratoResultado }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="p-3 border-b border-border">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Banknote className="size-4 text-green-400" /> Contratos ativos ({ext.contratos.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left p-2 font-semibold">Contrato</th>
                <th className="text-left p-2 font-semibold">Banco</th>
                <th className="text-right p-2 font-semibold">Parcela</th>
                <th className="text-right p-2 font-semibold">Emprestado</th>
                <th className="text-right p-2 font-semibold">Taxa</th>
                <th className="text-center p-2 font-semibold">Prazo</th>
                <th className="text-left p-2 font-semibold">Período</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ext.contratos.map((c, i) => (
                <tr key={i} className="hover:bg-muted/20">
                  <td className="p-2 font-mono">{c.contrato}</td>
                  <td className="p-2"><span className="text-[10px]"><Badge variant="muted" className="font-mono text-[9px]">{c.bancoCodigo}</Badge> {c.bancoNome}</span></td>
                  <td className="p-2 text-right font-mono">{formatBRL(c.valorParcela)}</td>
                  <td className="p-2 text-right font-mono">{formatBRL(c.valorEmprestado)}</td>
                  <td className="p-2 text-right font-mono text-yellow-400">{c.taxaJurosMensal?.toFixed(2) || '—'}%</td>
                  <td className="p-2 text-center font-mono">{c.qtdParcelas}x</td>
                  <td className="p-2 text-[10px] font-mono">{c.inicioDesconto} → {c.fimDesconto}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function CartoesTable({ ext }: { ext: InssExtratoResultado }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="p-3 border-b border-border">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <CreditCard className="size-4 text-purple-400" /> Cartões ativos ({ext.cartoes.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left p-2 font-semibold">Tipo</th>
                <th className="text-left p-2 font-semibold">Banco</th>
                <th className="text-right p-2 font-semibold">Limite</th>
                <th className="text-right p-2 font-semibold">Reservado/mês</th>
                <th className="text-right p-2 font-semibold">Saldo devedor</th>
                <th className="text-center p-2 font-semibold">Cliente usa?</th>
                <th className="text-center p-2 font-semibold">Pode cancelar?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ext.cartoes.map((c, i) => (
                <tr key={i} className="hover:bg-muted/20">
                  <td className="p-2">
                    <Badge variant={c.tipo === 'RMC' ? 'info' : 'muted'} className="text-[10px]">{c.tipo}</Badge>
                  </td>
                  <td className="p-2 text-[10px]">{c.bancoNome}</td>
                  <td className="p-2 text-right font-mono">{formatBRL(c.valorLimite)}</td>
                  <td className="p-2 text-right font-mono">{formatBRL(c.valorReservado)}</td>
                  <td className={`p-2 text-right font-mono ${c.saldoDevedorAtual > 0 ? 'text-red-400 font-bold' : 'text-green-400'}`}>
                    {formatBRL(c.saldoDevedorAtual)}
                  </td>
                  <td className="p-2 text-center">
                    {c.estaUsando ? (
                      <Badge variant="warning" className="text-[10px]">⚠ SIM</Badge>
                    ) : (
                      <Badge variant="muted" className="text-[10px]">não</Badge>
                    )}
                  </td>
                  <td className="p-2 text-center">
                    {c.podeCancelar ? (
                      <Badge variant="success" className="text-[10px]">✅ SEM CUSTO</Badge>
                    ) : (
                      <Badge variant="destructive" className="text-[10px]">⚠ TEM DÍVIDA</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-3 border-t border-border text-[10px] text-muted-foreground">
          💡 <strong>Pode cancelar SEM CUSTO</strong> = cartão sem saldo devedor — pode bloquear e enquadrar o cliente.
          {' '}<strong>TEM DÍVIDA</strong> = precisa quitar antes (provavelmente com troco de port/refin).
        </div>
      </CardContent>
    </Card>
  );
}

function Banner({ titulo, children, cor, icon }: { titulo: string; children: React.ReactNode; cor: 'green' | 'red' | 'yellow'; icon: React.ReactNode }) {
  const corMap = {
    green: 'bg-green-500/10 border-green-500/40',
    red: 'bg-red-500/10 border-red-500/40',
    yellow: 'bg-yellow-500/10 border-yellow-500/40',
  };
  const corTxt = { green: 'text-green-400', red: 'text-red-400', yellow: 'text-yellow-400' };
  return (
    <div className={`rounded-md border p-3 text-sm ${corMap[cor]}`}>
      <div className="flex items-start gap-2">
        {icon}
        <div>
          <div className={`font-bold ${corTxt[cor]}`}>{titulo}</div>
          <div className="text-xs text-foreground mt-1">{children}</div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, cor }: { label: string; value: string; cor: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={`text-base font-mono font-bold mt-0.5 ${cor}`}>{value}</div>
    </div>
  );
}
