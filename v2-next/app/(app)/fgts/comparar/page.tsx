'use client';

// ════════════════════════════════════════════════════════════════════
// FGTS — Consulta comparativa (mesmo padrão do Consulta CLT)
//
// Form no topo → cada CPF vira um CARD de consulta com cabeçalho do
// cliente e os bancos como LINHAS que preenchem sozinhas:
//   - Fintech do Corban → QI SCD + J17 (saldo/autorização)
//   - V8 Sistema        → saldo async + auto-simulação do líquido
//   - FINANTO           → simulação (precisa nome + nascimento)
// Rodapé do card mostra a melhor oferta. A pilha de consultas abertas
// persiste em localStorage (sobrevive F5), igual ao CLT.
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { formatBRL, formatCpf, formatDateBR } from '@/lib/utils';
import {
  useFintechFgtsSaldo, useFactaFgtsSaldo,
  useV8FgtsIniciarConsulta, useV8FgtsSaldo, useV8FgtsTabelas, useV8FgtsSimular,
  useNovoSaqueFgtsIniciar, useNovoSaqueFgtsContrato,
  type V8FgtsProvider,
} from '@/hooks/use-fgts';
import { useFinantoFgtsCriarSimulacao, useFinantoFgtsSimulacao } from '@/hooks/use-finanto';
import { usePrecheckCpf } from '@/hooks/use-clt-fila';
import { Label } from '@/components/ui/label';
import {
  PiggyBank, Search, Loader2, Landmark, Zap, AlertCircle, CheckCircle2,
  ArrowRight, Trophy, Copy, X,
} from 'lucide-react';
import { toast } from 'sonner';

// ── Pilha persistida (não temos fila no backend, guardamos local) ──
const PILHA_KEY = 'flowforce_fgts_pilha_v1';

interface ConsultaFgts {
  id: string;      // cpf + timestamp
  cpf: string;
  nome: string;
  nascimento: string;
  telefone: string;
  quando: string;  // ISO
}

function lerPilha(): ConsultaFgts[] {
  if (typeof window === 'undefined') return [];
  try {
    const arr = JSON.parse(localStorage.getItem(PILHA_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

// ── Resultado que cada linha reporta pro card (pra achar o melhor) ──
type Fonte = 'fintech' | 'v8' | 'finanto' | 'facta' | 'novosaque';
interface Resultado {
  fonte: Fonte;
  label: string;
  liquido: number | null;
  tipoValor: 'líquido' | 'bruto' | null;
  status: 'processando' | 'ok' | 'indisponivel' | 'faltam_dados';
}

function toIso(s: string): string {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.substring(0, 10);
  const m = t.match(/^(\d{2})[/\-](\d{2})[/\-](\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

// ── Linha genérica (mesmo layout pra todos os bancos) ──
// operarHref opcional: bancos sem página de digitação própria não mostram o botão.
function Linha({
  icon, nome, sub, children, operarHref,
}: {
  icon: React.ReactNode; nome: string; sub?: string;
  children: React.ReactNode; operarHref?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 px-3 border-b border-border last:border-b-0">
      <div className="flex items-center gap-2 min-w-0">
        {icon}
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{nome}</div>
          {sub && <div className="text-[10px] text-muted-foreground truncate">{sub}</div>}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {children}
        {operarHref && (
          <Link href={operarHref}>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
              Operar <ArrowRight className="size-3" />
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// LINHA FINTECH DO CORBAN — QI SCD + J17 (2 sub-linhas)
// ════════════════════════════════════════════════════════════════════
function LinhaFintech({ cpf, onResult }: { cpf: string; onResult: (r: Resultado) => void }) {
  const saldo = useFintechFgtsSaldo();
  const disparado = useRef(false);

  useEffect(() => {
    if (!disparado.current && cpf) { disparado.current = true; saldo.mutate(cpf); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cpf]);

  useEffect(() => {
    if (saldo.isPending) { onResult({ fonte: 'fintech', label: 'Fintech do Corban', liquido: null, tipoValor: null, status: 'processando' }); return; }
    if (saldo.data?.consultas) {
      const algumLiberado = saldo.data.consultas.some((c) => /complet|success|conclu|ok/i.test(String(c.statusConsulta || '')));
      onResult({ fonte: 'fintech', label: 'Fintech do Corban', liquido: null, tipoValor: null, status: algumLiberado ? 'ok' : 'indisponivel' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saldo.isPending, saldo.data]);

  const consultas = saldo.data?.consultas || [
    { typeQuery: 1, instituicao: 'QI Sociedade de Crédito Direto', statusConsulta: null, ok: false },
    { typeQuery: 3, instituicao: 'J17 SCD', statusConsulta: null, ok: false },
  ];

  return (
    <>
      {consultas.map((c) => {
        const liberado = /complet|success|conclu|ok/i.test(String(c.statusConsulta || ''));
        return (
          <Linha
            key={c.typeQuery}
            icon={<Landmark className="size-4 text-cyan-400 shrink-0" />}
            nome={c.instituicao}
            sub="Fintech do Corban"
            operarHref="/fgts/fintech-corban"
          >
            {saldo.isPending ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : liberado ? (
              <Badge variant="success" className="text-[10px]">liberado</Badge>
            ) : (
              <Badge variant="warning" className="text-[10px]">{c.statusConsulta || 'sem autorização'}</Badge>
            )}
          </Linha>
        );
      })}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════
// LINHA V8 — saldo async + auto-simulação do líquido
// ════════════════════════════════════════════════════════════════════
function LinhaV8({ cpf, onResult }: { cpf: string; onResult: (r: Resultado) => void }) {
  const [provider] = useState<V8FgtsProvider>('qi');
  const iniciar = useV8FgtsIniciarConsulta();
  const saldo = useV8FgtsSaldo(cpf);
  const iniciado = useRef(false);
  const simDisparada = useRef(false);
  const [erroIniciar, setErroIniciar] = useState<string | null>(null);

  const saldoOk = saldo.data?.status === 'success' && !!saldo.data?.balanceId;
  const tabelas = useV8FgtsTabelas(saldoOk);
  const simular = useV8FgtsSimular();

  useEffect(() => {
    if (iniciado.current || !cpf) return;
    iniciado.current = true;
    iniciar.mutateAsync({ cpf, provider }).catch((e: Error) => setErroIniciar(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cpf]);

  useEffect(() => {
    if (simDisparada.current) return;
    if (!saldoOk || !saldo.data?.balanceId) return;
    const tabela = (tabelas.data || []).find((t) => t.padrao) || (tabelas.data || [])[0];
    const periods = saldo.data.periods || [];
    if (!tabela || periods.length < 2) return;
    simDisparada.current = true;
    simular.mutate({
      cpf, simulationFeesId: tabela.id, balanceId: saldo.data.balanceId,
      desiredInstallments: periods.map((p) => ({ totalAmount: p.amount, dueDate: p.dueDate })),
      provider,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saldoOk, tabelas.data]);

  useEffect(() => {
    if (erroIniciar || saldo.data?.status === 'fail') {
      onResult({ fonte: 'v8', label: 'V8 Sistema', liquido: null, tipoValor: null, status: 'indisponivel' });
    } else if (simular.data?.valorLiquido != null) {
      onResult({ fonte: 'v8', label: 'V8 Sistema', liquido: simular.data.valorLiquido, tipoValor: 'líquido', status: 'ok' });
    } else if (saldoOk) {
      onResult({ fonte: 'v8', label: 'V8 Sistema', liquido: saldo.data?.saldoTotal ?? null, tipoValor: 'bruto', status: 'ok' });
    } else {
      onResult({ fonte: 'v8', label: 'V8 Sistema', liquido: null, tipoValor: null, status: 'processando' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [erroIniciar, saldo.data, saldoOk, simular.data]);

  const processando = !erroIniciar && saldo.data?.status !== 'fail' && !saldoOk;
  const falhou = !!erroIniciar || saldo.data?.status === 'fail';

  return (
    <Linha
      icon={<Zap className="size-4 text-cyan-400 shrink-0" />}
      nome="V8 Sistema"
      sub="QI Tech"
      operarHref="/fgts/v8"
    >
      {processando && <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> consultando…</span>}
      {falhou && (
        <span className="text-xs text-red-400 flex items-center gap-1 max-w-[220px] truncate" title={erroIniciar || saldo.data?.erro || ''}>
          <AlertCircle className="size-3.5 shrink-0" /> indisponível
        </span>
      )}
      {saldoOk && (
        simular.data?.valorLiquido != null ? (
          <div className="text-right">
            <div className="text-sm font-bold text-primary">{formatBRL(simular.data.valorLiquido)}</div>
            <div className="text-[9px] text-muted-foreground uppercase">líquido</div>
          </div>
        ) : simular.isPending ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> simulando…</span>
        ) : (
          <div className="text-right">
            <div className="text-sm font-bold">{formatBRL(saldo.data?.saldoTotal || 0)}</div>
            <div className="text-[9px] text-muted-foreground uppercase">bruto</div>
          </div>
        )
      )}
    </Linha>
  );
}

// ════════════════════════════════════════════════════════════════════
// LINHA FINANTO — precisa nome + nascimento
// ════════════════════════════════════════════════════════════════════
function LinhaFinanto({
  cpf, nome, nascimento, onResult,
}: { cpf: string; nome: string; nascimento: string; onResult: (r: Resultado) => void }) {
  const criar = useFinantoFgtsCriarSimulacao();
  const [simId, setSimId] = useState<string | null>(null);
  const sim = useFinantoFgtsSimulacao(simId);
  const disparado = useRef(false);

  const nascIso = toIso(nascimento);
  const temDados = !!nome.trim() && !!nascIso;

  useEffect(() => {
    if (disparado.current || !cpf || !temDados) return;
    disparado.current = true;
    criar.mutateAsync({
      borrower: { name: nome.trim(), identity: cpf, birthDate: nascIso },
      items: [],
    }).then((r) => setSimId(r.simulationId)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cpf, temDados]);

  const items = useMemo(() => sim.data?.items || [], [sim.data]);
  const liquido = items.reduce((acc, it) => acc + (it.netValue || 0), 0);
  const calculado = items.some((it) => (it.netValue ?? it.loanValue ?? 0) > 0);

  useEffect(() => {
    if (!temDados) { onResult({ fonte: 'finanto', label: 'FINANTO', liquido: null, tipoValor: null, status: 'faltam_dados' }); return; }
    if (calculado) onResult({ fonte: 'finanto', label: 'FINANTO', liquido, tipoValor: 'líquido', status: 'ok' });
    else if (criar.isError) onResult({ fonte: 'finanto', label: 'FINANTO', liquido: null, tipoValor: null, status: 'indisponivel' });
    else onResult({ fonte: 'finanto', label: 'FINANTO', liquido: null, tipoValor: null, status: 'processando' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [temDados, calculado, liquido, criar.isError]);

  return (
    <Linha
      icon={<PiggyBank className="size-4 text-cyan-400 shrink-0" />}
      nome="FINANTO"
      sub="Ajin / QI Tech"
      operarHref="/fgts/simulacao"
    >
      {!temDados ? (
        <span className="text-[11px] text-yellow-500">preencha nome + nascimento</span>
      ) : calculado ? (
        <div className="text-right">
          <div className="text-sm font-bold text-primary">{formatBRL(liquido)}</div>
          <div className="text-[9px] text-muted-foreground uppercase">líquido</div>
        </div>
      ) : criar.isError ? (
        <span className="text-xs text-red-400 flex items-center gap-1"><AlertCircle className="size-3.5" /> indisponível</span>
      ) : (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> consultando…</span>
      )}
    </Linha>
  );
}

// ════════════════════════════════════════════════════════════════════
// LINHA FACTA — saldo/base FGTS (via proxy do escritório)
// ════════════════════════════════════════════════════════════════════
function LinhaFacta({ cpf, onResult }: { cpf: string; onResult: (r: Resultado) => void }) {
  const saldo = useFactaFgtsSaldo();
  const disparado = useRef(false);

  useEffect(() => {
    if (!disparado.current && cpf) { disparado.current = true; saldo.mutate(cpf); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cpf]);

  const temSaldo = (saldo.data?.saldoTotal ?? 0) > 0;

  useEffect(() => {
    if (saldo.isPending) { onResult({ fonte: 'facta', label: 'FACTA', liquido: null, tipoValor: null, status: 'processando' }); return; }
    if (saldo.isError) { onResult({ fonte: 'facta', label: 'FACTA', liquido: null, tipoValor: null, status: 'indisponivel' }); return; }
    if (saldo.data) {
      // saldoTotal aqui é a base FGTS (bruto); o líquido vem do simulador (fase 2)
      onResult({ fonte: 'facta', label: 'FACTA', liquido: saldo.data.saldoTotal ?? null, tipoValor: temSaldo ? 'bruto' : null, status: temSaldo || saldo.data.success ? 'ok' : 'indisponivel' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saldo.isPending, saldo.isError, saldo.data]);

  return (
    <Linha
      icon={<Landmark className="size-4 text-cyan-400 shrink-0" />}
      nome="FACTA"
      sub="Financeira"
    >
      {saldo.isPending ? (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> consultando…</span>
      ) : saldo.isError ? (
        <span className="text-xs text-red-400 flex items-center gap-1"><AlertCircle className="size-3.5" /> indisponível</span>
      ) : temSaldo ? (
        <div className="text-right">
          <div className="text-sm font-bold">{formatBRL(saldo.data?.saldoTotal || 0)}</div>
          <div className="text-[9px] text-muted-foreground uppercase">base FGTS</div>
        </div>
      ) : (
        <span className="text-xs text-yellow-500 flex items-center gap-1 max-w-[220px] truncate" title={saldo.data?.mensagem || ''}>
          <AlertCircle className="size-3.5 shrink-0" /> {saldo.data?.mensagem ? 'sem saldo/autorização' : 'sem retorno'}
        </span>
      )}
    </Linha>
  );
}

// ════════════════════════════════════════════════════════════════════
// LINHA NOVOSAQUE — inicia simulação + polling do contrato → líquido
// ════════════════════════════════════════════════════════════════════
function LinhaNovoSaque({ cpf, onResult }: { cpf: string; onResult: (r: Resultado) => void }) {
  const iniciar = useNovoSaqueFgtsIniciar();
  const [tid, setTid] = useState<string | null>(null);
  const contrato = useNovoSaqueFgtsContrato(tid);
  const disparado = useRef(false);
  const [erroIniciar, setErroIniciar] = useState<string | null>(null);

  useEffect(() => {
    if (disparado.current || !cpf) return;
    disparado.current = true;
    iniciar.mutateAsync(cpf)
      .then((r) => setTid(r.transactionId))
      .catch((e: Error) => setErroIniciar(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cpf]);

  const liquido = contrato.data?.simulacao?.liquido ?? null;
  const ofertaPronta = !!contrato.data?.ofertaPronta && (liquido ?? 0) > 0;
  const semOferta = !!contrato.data?.semOferta && !ofertaPronta;
  const falhou = !!erroIniciar || (!!contrato.data?.falhou && !semOferta);

  useEffect(() => {
    if (ofertaPronta) onResult({ fonte: 'novosaque', label: 'NovoSaque', liquido, tipoValor: 'líquido', status: 'ok' });
    else if (falhou || semOferta) onResult({ fonte: 'novosaque', label: 'NovoSaque', liquido: null, tipoValor: null, status: 'indisponivel' });
    else onResult({ fonte: 'novosaque', label: 'NovoSaque', liquido: null, tipoValor: null, status: 'processando' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [falhou, semOferta, ofertaPronta, liquido]);

  const processando = !falhou && !semOferta && !ofertaPronta;

  return (
    <Linha
      icon={<PiggyBank className="size-4 text-cyan-400 shrink-0" />}
      nome="NovoSaque"
      sub="Sandbox"
    >
      {processando ? (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> consultando…</span>
      ) : ofertaPronta ? (
        <div className="text-right">
          <div className="text-sm font-bold text-primary">{formatBRL(liquido || 0)}</div>
          <div className="text-[9px] text-muted-foreground uppercase">líquido</div>
        </div>
      ) : semOferta ? (
        <span className="text-xs text-yellow-500 flex items-center gap-1"><AlertCircle className="size-3.5" /> sem oferta</span>
      ) : (
        <span className="text-xs text-red-400 flex items-center gap-1 max-w-[220px] truncate" title={erroIniciar || contrato.data?.summaryStatus || ''}>
          <AlertCircle className="size-3.5 shrink-0" /> indisponível
        </span>
      )}
    </Linha>
  );
}

// ════════════════════════════════════════════════════════════════════
// CARD DE CONSULTA (um por CPF) — cabeçalho + linhas + rodapé
// ════════════════════════════════════════════════════════════════════
function FgtsConsultaCard({ consulta, onClose }: { consulta: ConsultaFgts; onClose: () => void }) {
  const [resultados, setResultados] = useState<Record<Fonte, Resultado | undefined>>({} as Record<Fonte, Resultado | undefined>);
  const onResult = useCallback((r: Resultado) => {
    setResultados((prev) => ({ ...prev, [r.fonte]: r }));
  }, []);

  const melhor = useMemo(() => {
    const comLiquido = Object.values(resultados).filter(
      (r): r is Resultado => !!r && r.status === 'ok' && r.tipoValor === 'líquido' && (r.liquido ?? 0) > 0,
    );
    if (!comLiquido.length) return null;
    return comLiquido.reduce((a, b) => ((b.liquido ?? 0) > (a.liquido ?? 0) ? b : a));
  }, [resultados]);

  const processando = Object.values(resultados).some((r) => r?.status === 'processando')
    || Object.keys(resultados).length < 5;

  const telDigits = consulta.telefone.replace(/\D/g, '');

  const copiarWhats = () => {
    const t = melhor
      ? `Boa notícia! Consegui liberar pra você um valor de FGTS de ${formatBRL(melhor.liquido || 0)} (via ${melhor.label}). Quer que eu já adiante pra sua conta?`
      : `Oi! Pra eu consultar seu FGTS, preciso que você autorize no app FGTS da Caixa. Te explico rapidinho?`;
    navigator.clipboard.writeText(t).then(
      () => toast.success('Mensagem copiada'),
      () => toast.error('Não consegui copiar'),
    );
  };

  return (
    <Card className="border-2 border-primary/30">
      <CardContent className="p-0">
        {/* Cabeçalho do cliente */}
        <div className="p-4 bg-gradient-to-br from-primary/5 to-accent/5 border-b border-border">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {processando ? (
                  <Badge variant="info" className="gap-1"><Loader2 className="w-3 h-3 animate-spin" /> CONSULTANDO</Badge>
                ) : (
                  <Badge variant="success" className="gap-1"><CheckCircle2 className="w-3 h-3" /> CONCLUÍDA</Badge>
                )}
                <span className="font-bold text-base truncate">{consulta.nome || '(sem nome)'}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                CPF {formatCpf(consulta.cpf)} · {formatDateBR(consulta.quando)}
              </div>
              {telDigits.length >= 10 && (
                <div className="mt-2">
                  <a
                    href={`https://wa.me/55${telDigits}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] px-2 py-0.5 rounded bg-green-500/10 text-green-400 hover:bg-green-500/20"
                  >
                    📱 {telDigits}
                  </a>
                </div>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} title="Fechar">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Linhas dos bancos */}
        <div>
          <LinhaFintech cpf={consulta.cpf} onResult={onResult} />
          <LinhaFacta cpf={consulta.cpf} onResult={onResult} />
          <LinhaNovoSaque cpf={consulta.cpf} onResult={onResult} />
          <LinhaV8 cpf={consulta.cpf} onResult={onResult} />
          <LinhaFinanto cpf={consulta.cpf} nome={consulta.nome} nascimento={consulta.nascimento} onResult={onResult} />
        </div>

        {/* Rodapé — melhor oferta */}
        <div className="p-3 border-t border-border bg-secondary/20 flex items-center justify-between gap-3 flex-wrap">
          {melhor ? (
            <span className="flex items-center gap-2 text-sm">
              <Trophy className="size-4 text-green-400" />
              Melhor líquido: <b>{formatBRL(melhor.liquido || 0)}</b>
              <span className="text-muted-foreground">via {melhor.label}</span>
            </span>
          ) : processando ? (
            <span className="text-xs text-muted-foreground">⏳ Aguardando bancos…</span>
          ) : (
            <span className="text-xs text-muted-foreground">⚠️ Nenhum banco retornou oferta líquida — confira autorização no app FGTS</span>
          )}
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={copiarWhats}>
            <Copy className="size-3 mr-1" /> Msg pro cliente
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════
// PÁGINA
// ════════════════════════════════════════════════════════════════════
export default function FgtsCompararPage() {
  const [cpf, setCpf] = useState('');
  const [nome, setNome] = useState('');
  const [nascimento, setNascimento] = useState(''); // YYYY-MM-DD (input date)
  const [telefone, setTelefone] = useState('');
  const [pilha, setPilha] = useState<ConsultaFgts[]>([]);
  const [hidratada, setHidratada] = useState(false);

  // Quando a nossa base não traz nome/nascimento, abre o bloco obrigatório.
  const [exigirDados, setExigirDados] = useState(false);
  const [faltam, setFaltam] = useState<string[]>([]);

  const precheck = usePrecheckCpf();

  useEffect(() => { setPilha(lerPilha()); setHidratada(true); }, []);
  useEffect(() => {
    if (!hidratada) return;
    try { localStorage.setItem(PILHA_KEY, JSON.stringify(pilha)); } catch { /* ignore */ }
  }, [pilha, hidratada]);

  const cpfDigits = cpf.replace(/\D/g, '');
  const cpfValido = cpfDigits.length === 11;

  function abrirConsulta(dados: { nome: string; nascimento: string; telefone: string }) {
    const nova: ConsultaFgts = {
      id: `${cpfDigits}-${Date.now()}`,
      cpf: cpfDigits, nome: dados.nome, nascimento: dados.nascimento, telefone: dados.telefone,
      quando: new Date().toISOString(),
    };
    setPilha((prev) => [nova, ...prev].slice(0, 30));
    setCpf(''); setNome(''); setNascimento(''); setTelefone('');
    setExigirDados(false); setFaltam([]);
    toast.success('Consultando nos 3 bancos…');
  }

  async function consultar(e: React.FormEvent) {
    e.preventDefault();
    if (!cpfValido) { toast.error('CPF inválido'); return; }

    // Se o bloco obrigatório já está aberto, valida o que o operador digitou.
    if (exigirDados) {
      const faltando: string[] = [];
      if (!nome.trim()) faltando.push('nome');
      if (!nascimento) faltando.push('data de nascimento');
      if (faltando.length) { toast.error(`Preencha: ${faltando.join(', ')}`); return; }
      abrirConsulta({ nome: nome.trim(), nascimento, telefone });
      return;
    }

    // 1ª etapa: procura na NOSSA base (mesmo precheck do CLT — Nova Vida TI por CPF)
    const r = await precheck.mutateAsync(cpfDigits).catch(() => null);
    if (!r) { toast.error('Erro ao buscar o CPF na base — tente de novo'); return; }

    const nomeBase = r.dados.nome || '';
    const nascBase = r.dados.dataNascimento || '';
    const telBase = r.dados.telefone || '';
    if (nomeBase) setNome(nomeBase);
    if (nascBase) setNascimento(nascBase);
    if (telBase) setTelefone(telBase);

    // Precisa de nome + nascimento (CPF já temos). Telefone é bônus.
    if (r.temNome && r.temDataNascimento) {
      abrirConsulta({ nome: nomeBase, nascimento: nascBase, telefone: telBase });
    } else {
      const f: string[] = [];
      if (!r.temNome) f.push('nome');
      if (!r.temDataNascimento) f.push('data de nascimento');
      setFaltam(f);
      setExigirDados(true);
      toast.warning('Nossa base não trouxe todos os dados — complete abaixo pra continuar');
    }
  }

  const fechar = (id: string) => setPilha((prev) => prev.filter((c) => c.id !== id));
  const isPending = precheck.isPending;
  const precisa = (campo: string) => exigirDados && faltam.includes(campo);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <PiggyBank className="size-6 text-cyan-400" /> FGTS — Consulta comparativa
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Digite o CPF — a gente busca nome e nascimento na nossa base. Os 3 bancos consultam em paralelo,
          cada linha atualiza sozinha.
        </p>
      </div>

      {/* Form */}
      <Card>
        <CardContent className="p-4">
          <form onSubmit={consultar} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-[2fr_auto] gap-3">
              <Input
                placeholder="CPF (só números)"
                maxLength={14}
                value={cpfDigits.length === 11 ? formatCpf(cpf) : cpf}
                onChange={(e) => {
                  setCpf(e.target.value.replace(/\D/g, '').slice(0, 11));
                  if (exigirDados) { setExigirDados(false); setFaltam([]); }
                }}
                inputMode="numeric"
                autoFocus
                disabled={isPending}
                className="h-11 text-base font-mono"
              />
              <Button type="submit" disabled={!cpfValido || isPending} className="h-11 px-6">
                {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                {exigirDados ? 'Continuar' : 'Consultar'}
              </Button>
            </div>

            {/* Bloco obrigatório — só aparece quando a base não trouxe tudo */}
            {exigirDados && (
              <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                <div className="flex items-center gap-2 text-xs text-amber-500 font-medium">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Não achamos tudo na nossa base — complete pra continuar
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">
                      Nome completo {precisa('nome') && <span className="text-amber-500">*</span>}
                    </Label>
                    <Input placeholder="Nome completo" value={nome} onChange={(e) => setNome(e.target.value)} className="h-10" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">
                      Data de nascimento {precisa('data de nascimento') && <span className="text-amber-500">*</span>}
                    </Label>
                    <Input type="date" value={nascimento} onChange={(e) => setNascimento(e.target.value)} className="h-10" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">Telefone (opcional)</Label>
                    <Input placeholder="DDD + número" value={telefone} onChange={(e) => setTelefone(e.target.value)} inputMode="numeric" className="h-10" />
                  </div>
                </div>
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Pilha de consultas abertas */}
      {pilha.length > 0 && (
        <div className="space-y-4">
          <div className="text-xs text-muted-foreground">
            📌 {pilha.length} consulta(s) aberta(s) — fica salvo aqui mesmo se atualizar a tela
          </div>
          {pilha.map((c) => (
            <FgtsConsultaCard key={c.id} consulta={c} onClose={() => fechar(c.id)} />
          ))}
        </div>
      )}

      {pilha.length === 0 && (
        <div className="text-sm text-muted-foreground text-center py-10">
          Digite um CPF acima e clique em <b>Consultar</b>.
          <div className="text-xs mt-1">Preencha nome + nascimento pra incluir a FINANTO na comparação.</div>
        </div>
      )}
    </div>
  );
}
