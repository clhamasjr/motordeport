'use client';

// ════════════════════════════════════════════════════════════════════
// Baixa Renda (Bolsa Família) — Consulta e fila
//
// Digita o CPF → o motor diz em que ponto está e o que fazer.
// Na maioria dos CPFs o NIS vem direto do Portal da Transparência e já
// libera a simulação. Quando o Portal não tem o dado, a Crefisa pede Open
// Finance: aí o card fica VIVO, manda o link e consulta sozinho até o
// cliente autorizar. A fila fica salva no navegador, aguenta recarregar.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { formatBRL, formatCpf } from '@/lib/utils';
import {
  useCrefisaFluxo,
  useCrefisaEnviarOpenFinance,
  useCrefisaStatusOpenFinance,
  useCrefisaSimular,
  useCrefisaSessao,
} from '@/hooks/use-crefisa-br';
import { ETAPA_BR_LABEL, type EtapaBR, type FluxoBR, type SimulacaoBR } from '@/lib/crefisa-br-types';
import { DigitacaoForm } from '@/components/baixa-renda/digitacao-form';
import {
  HandCoins, Search, Loader2, AlertCircle, CheckCircle2, X, Send,
  RefreshCw, ArrowRight, ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';

// ── Fila persistida (não temos fila no backend, guardamos local) ──
const FILA_KEY = 'flowforce_baixarenda_fila_v1';

interface ItemFila {
  id: string;        // cpf + timestamp
  cpf: string;
  telefone: string;
  quando: string;    // ISO
}

function lerFila(): ItemFila[] {
  if (typeof window === 'undefined') return [];
  try {
    const arr = JSON.parse(localStorage.getItem(FILA_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

// ══════════════════════════════════════════════════════════════
// Card de um CPF na fila
// ══════════════════════════════════════════════════════════════
function CardBaixaRenda({ item, onClose }: { item: ItemFila; onClose: () => void }) {
  const fluxo = useCrefisaFluxo();
  const enviarOf = useCrefisaEnviarOpenFinance();
  const simular = useCrefisaSimular();

  const [dados, setDados] = useState<FluxoBR | null>(null);
  const [linkEnviado, setLinkEnviado] = useState(false);
  const [valor, setValor] = useState('500');
  const [tipo, setTipo] = useState<1 | 2>(1);
  const [ofertaEscolhida, setOfertaEscolhida] = useState<SimulacaoBR | null>(null);
  const [digitada, setDigitada] = useState<string | null>(null);
  const consultado = useRef(false);

  // Enquanto estiver esperando o Open Finance, fica olhando sozinho
  const esperandoOf = dados?.etapa === 'AGUARDA_OPENFINANCE';
  const statusOf = useCrefisaStatusOpenFinance(item.cpf, esperandoOf);

  const consultar = async () => {
    const r = await fluxo.mutateAsync(item.cpf).catch(() => null);
    if (r) setDados(r);
  };

  useEffect(() => {
    if (consultado.current) return;
    consultado.current = true;
    consultar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cliente autorizou → reconsulta pra pegar o NIS
  useEffect(() => {
    if (statusOf.data?.compartilhado && dados?.etapa === 'AGUARDA_OPENFINANCE') {
      toast.success(`${formatCpf(item.cpf)} autorizou — consultando o benefício`);
      consultar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusOf.data?.compartilhado]);

  const etapa: EtapaBR = digitada ? 'DIGITADA' : (dados?.etapa || 'SEM_RETORNO');
  const badge = ETAPA_BR_LABEL[etapa] || ETAPA_BR_LABEL.SEM_RETORNO;
  const carregando = fluxo.isPending;

  const regra = useMemo(
    () => dados?.regras?.operacoes.find((o) => o.tipoSimulacao === tipo),
    [dados, tipo],
  );

  const ofertas: SimulacaoBR[] = simular.data?.simulacoes || [];

  const enviarLink = async () => {
    const r = await enviarOf.mutateAsync({ cpf: item.cpf, telefone: item.telefone }).catch(() => null);
    if (r?.success) {
      setLinkEnviado(true);
      toast.success('Link enviado — assim que o cliente autorizar, o card segue sozinho');
    } else if (r) {
      toast.error(r.mensagem || 'Não consegui enviar o link');
    }
  };

  const rodarSimulacao = async () => {
    const v = parseFloat(valor.replace(',', '.'));
    if (!v || Number.isNaN(v)) { toast.error('Informe o valor'); return; }
    setOfertaEscolhida(null);
    if (regra && (v < regra.valorMin || v > regra.valorMax)) {
      toast.error(`${regra.nome}: valor tem que ficar entre ${formatBRL(regra.valorMin)} e ${formatBRL(regra.valorMax)}`);
      return;
    }
    await simular.mutateAsync({
      cpf: item.cpf,
      tipoSimulacao: tipo,
      valorTomador: v,
      dataPagamento: dados?.dataPagamento ?? null,
      digito: dados?.digito,
      ddd: item.telefone.slice(0, 2),
      telefone: item.telefone.slice(2),
    }).catch(() => null);
  };

  return (
    <Card className="border-2 border-primary/30">
      <CardContent className="p-0">
        {/* ── Cabeçalho ── */}
        <div className="p-4 bg-gradient-to-br from-primary/5 to-accent/5 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="font-mono font-bold text-base">{formatCpf(item.cpf)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {dados?.mensagem || (carregando ? 'consultando…' : '—')}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {carregando ? (
              <Badge variant="info" className="gap-1"><Loader2 className="w-3 h-3 animate-spin" /> CONSULTANDO</Badge>
            ) : (
              <Badge variant={badge.variant} className="gap-1">
                {badge.variant === 'success' && <CheckCircle2 className="w-3 h-3" />}
                {badge.label}
              </Badge>
            )}
            <Button size="icon" variant="ghost" onClick={onClose} className="h-7 w-7">
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* ── Próximo passo ── */}
        {dados?.proximoPasso && (
          <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 text-xs">
            <ArrowRight className="size-3.5 text-primary shrink-0" />
            <span className="text-muted-foreground">Próximo passo:</span>
            <span className="font-medium">{dados.proximoPasso}</span>
          </div>
        )}

        {/* ── Etapa: esperando o Open Finance ── */}
        {esperandoOf && (
          <div className="p-4 space-y-3">
            <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
              <div className="flex items-center gap-2 text-xs text-amber-500 font-medium">
                <ShieldCheck className="w-3.5 h-3.5" />
                O Portal da Transparência não trouxe o benefício — a Crefisa pede Open Finance
              </div>
              <p className="text-[11px] text-muted-foreground">
                O cliente precisa compartilhar os dados bancários dele. Manda o link,
                que este card acompanha sozinho e segue pra simulação quando ele autorizar.
              </p>
              {dados?.docsObrigatorios && (
                <p className="text-[10px] text-muted-foreground">
                  Documentos que a Crefisa vai pedir: {dados.docsObrigatorios.split(';').join(' · ')}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <Button size="sm" onClick={enviarLink} disabled={enviarOf.isPending}>
                {enviarOf.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {linkEnviado ? 'Reenviar link' : 'Enviar link pro cliente'}
              </Button>
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> aguardando autorização…
              </span>
            </div>
          </div>
        )}

        {/* ── Etapa: elegível, pode simular ── */}
        {etapa === 'ELEGIVEL' && (
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs text-green-400">
              <CheckCircle2 className="size-3.5" />
              {dados?.descricaoBeneficio || 'Benefício'} confirmado
              {dados?.valorBeneficio != null && <> — recebe {formatBRL(dados.valorBeneficio)}/mês</>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[auto_1fr_auto] gap-3 items-end">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Operação</Label>
                <div className="flex gap-1">
                  <Button size="sm" variant={tipo === 1 ? 'default' : 'outline'} onClick={() => { setTipo(1); setOfertaEscolhida(null); }}>NOVO</Button>
                  <Button size="sm" variant={tipo === 2 ? 'default' : 'outline'} onClick={() => { setTipo(2); setOfertaEscolhida(null); }}>REFIN</Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">
                  Valor{regra ? ` (${formatBRL(regra.valorMin)} a ${formatBRL(regra.valorMax)})` : ''}
                </Label>
                <Input
                  value={valor}
                  onChange={(e) => setValor(e.target.value.replace(/[^\d,.]/g, ''))}
                  inputMode="decimal"
                  className="h-10 font-mono"
                />
              </div>
              <Button onClick={rodarSimulacao} disabled={simular.isPending} className="h-10">
                {simular.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Simular
              </Button>
            </div>

            {/* Ofertas */}
            {simular.data && !simular.data.approved && (
              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                <AlertCircle className="size-3.5" /> {simular.data.mensagem}
              </div>
            )}
            {ofertas.length > 0 && (
              <div className="space-y-1.5">
                {regra && (
                  <div className="text-[10px] text-muted-foreground">
                    Parcela precisa ficar entre {formatBRL(regra.parcelaMin)} e {formatBRL(regra.parcelaMax)} — os prazos fora disso aparecem apagados.
                  </div>
                )}
                <div className="rounded-md border border-border overflow-hidden">
                  {ofertas.map((o) => (
                    <div
                      key={o.quantidadeParcelas}
                      className={`flex items-center justify-between gap-3 py-2 px-3 border-b border-border last:border-b-0 ${o.contratavel ? '' : 'opacity-40'}`}
                    >
                      <div className="text-xs flex items-center gap-2">
                        <span className="font-medium w-7">{o.quantidadeParcelas}x</span>
                        <span className="text-muted-foreground">de</span>
                        <span className="font-medium">{formatBRL(Number(o.valorParcela) || 0)}</span>
                        {!o.contratavel && <span className="text-[10px] text-red-400">acima do limite</span>}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className={`text-sm font-bold ${o.contratavel ? 'text-primary' : 'text-muted-foreground'}`}>
                            {formatBRL(Number(o.valorCreditado) || 0)}
                          </div>
                          <div className="text-[9px] text-muted-foreground uppercase">
                            1º venc. {o.dataPrimeiroVencimento ? new Date(o.dataPrimeiroVencimento).toLocaleDateString('pt-BR') : '—'}
                          </div>
                        </div>
                        {o.contratavel && (
                          <Button
                            size="sm"
                            variant={ofertaEscolhida?.quantidadeParcelas === o.quantidadeParcelas ? 'default' : 'outline'}
                            className="h-7 text-xs"
                            onClick={() => setOfertaEscolhida(o)}
                          >
                            Digitar
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Digitação ── */}
        {etapa === 'ELEGIVEL' && ofertaEscolhida && dados?.regras && !digitada && (
          <div className="px-4 pb-4">
            <DigitacaoForm
              cpf={item.cpf}
              telefone={item.telefone}
              tipoSimulacao={tipo}
              dados={dados}
              regras={dados.regras}
              oferta={ofertaEscolhida}
              onCancelar={() => setOfertaEscolhida(null)}
              onDigitada={(msg) => { setDigitada(msg); setOfertaEscolhida(null); toast.success(msg); }}
            />
          </div>
        )}
        {digitada && (
          <div className="p-4 text-xs text-green-400 flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5" /> {digitada} — acompanhe na Esteira de Análise do portal.
          </div>
        )}

        {/* ── Etapas terminais ── */}
        {(etapa === 'NAO_ELEGIVEL' || etapa === 'BLOQUEADO' || etapa === 'SEM_RETORNO') && !carregando && (
          <div className="p-4 text-xs text-muted-foreground flex items-center gap-1.5">
            <AlertCircle className="size-3.5" /> {dados?.mensagem}
          </div>
        )}

        {/* ── Rodapé ── */}
        <div className="p-3 border-t border-border bg-secondary/20 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[10px] text-muted-foreground">
            {new Date(item.quando).toLocaleString('pt-BR')}
          </span>
          <Button size="sm" variant="ghost" onClick={consultar} disabled={carregando} className="h-7 text-xs">
            <RefreshCw className={`size-3 ${carregando ? 'animate-spin' : ''}`} /> Reconsultar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════
// Página
// ══════════════════════════════════════════════════════════════
export default function BaixaRendaConsultarPage() {
  const [cpf, setCpf] = useState('');
  const [telefone, setTelefone] = useState('');
  const [fila, setFila] = useState<ItemFila[]>([]);
  const [hidratada, setHidratada] = useState(false);
  const sessao = useCrefisaSessao();

  useEffect(() => {
    const inicial = lerFila();
    // Link pré-preenchido: /baixa-renda/consultar?cpf=...&tel=... entra na fila sozinho
    try {
      const q = new URLSearchParams(window.location.search);
      const qCpf = (q.get('cpf') || '').replace(/\D/g, '');
      const qTel = (q.get('tel') || q.get('telefone') || '').replace(/\D/g, '');
      if (qCpf.length === 11 && !inicial.some((f) => f.cpf === qCpf)) {
        inicial.unshift({ id: `${qCpf}-${Date.now()}`, cpf: qCpf, telefone: qTel, quando: new Date().toISOString() });
        window.history.replaceState(null, '', window.location.pathname); // limpa a URL
      }
    } catch { /* ignore */ }
    setFila(inicial);
    setHidratada(true);
  }, []);
  useEffect(() => {
    if (!hidratada) return;
    try { localStorage.setItem(FILA_KEY, JSON.stringify(fila)); } catch { /* ignore */ }
  }, [fila, hidratada]);

  const cpfDigits = cpf.replace(/\D/g, '');
  const cpfValido = cpfDigits.length === 11;
  const telDigits = telefone.replace(/\D/g, '');

  function adicionar(e: React.FormEvent) {
    e.preventDefault();
    if (!cpfValido) { toast.error('CPF inválido'); return; }
    if (telDigits.length < 10) { toast.error('Informe o telefone com DDD — é por ele que vai o link do Open Finance'); return; }
    if (fila.some((f) => f.cpf === cpfDigits)) { toast.warning('Esse CPF já está na fila'); return; }

    setFila((prev) => [{
      id: `${cpfDigits}-${Date.now()}`,
      cpf: cpfDigits,
      telefone: telDigits,
      quando: new Date().toISOString(),
    }, ...prev].slice(0, 30));
    setCpf(''); setTelefone('');
  }

  const fechar = (id: string) => setFila((prev) => prev.filter((f) => f.id !== id));

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <HandCoins className="size-6 text-emerald-400" /> Baixa Renda — Bolsa Família
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Crefisa. Empréstimo de {formatBRL(101)} a {formatBRL(750)} em até 12x.
          Se a Crefisa pedir Open Finance pro cliente, o card manda o link e acompanha sozinho.
        </p>
      </div>

      {/* Aviso de sessão */}
      {sessao.data && !sessao.data.viva && (
        <div className="space-y-1 rounded-md border border-red-500/40 bg-red-500/5 p-3">
          <div className="flex items-center gap-2 text-xs text-red-400 font-medium">
            <AlertCircle className="w-3.5 h-3.5" /> Sessão do portal Crefisa não está ativa
          </div>
          <p className="text-[11px] text-muted-foreground">
            O portal exige 2FA, então a sessão é colada manualmente e vence junto com a do navegador.
            Abra o portal, rode o capturador e cole de novo.
          </p>
        </div>
      )}

      <Card>
        <CardContent className="p-4">
          <form onSubmit={adicionar} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-[2fr_2fr_auto] gap-3">
              <Input
                placeholder="CPF (só números)"
                maxLength={14}
                value={cpfDigits.length === 11 ? formatCpf(cpf) : cpf}
                onChange={(e) => setCpf(e.target.value.replace(/\D/g, '').slice(0, 11))}
                inputMode="numeric"
                autoFocus
                className="h-11 text-base font-mono"
              />
              <Input
                placeholder="Telefone com DDD"
                maxLength={11}
                value={telefone}
                onChange={(e) => setTelefone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                inputMode="numeric"
                className="h-11 text-base font-mono"
              />
              <Button type="submit" disabled={!cpfValido} className="h-11 px-6">
                <Search className="w-4 h-4" /> Consultar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {fila.length > 0 ? (
        <div className="space-y-4">
          <div className="text-xs text-muted-foreground">
            📌 {fila.length} CPF(s) na fila — fica salvo aqui mesmo se atualizar a tela
          </div>
          {fila.map((f) => (
            <CardBaixaRenda key={f.id} item={f} onClose={() => fechar(f.id)} />
          ))}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground text-center py-10">
          Digite um CPF acima e clique em <b>Consultar</b>.
          <div className="text-xs mt-1">O telefone é obrigatório — é por ele que sai o link do Open Finance, quando a Crefisa pedir.</div>
        </div>
      )}
    </div>
  );
}
