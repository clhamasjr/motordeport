'use client';

// ════════════════════════════════════════════════════════════════════
// FGTS — V8 Sistema (antecipação saque-aniversário)
//
// Fluxo em 3 etapas (docs.v8sistema.com):
//  1. Saldo    — inicia consulta (async na Caixa) e faz polling até
//                success/fail. Retorna períodos anuais antecipáveis.
//  2. Simular  — escolhe tabela de taxa + períodos → valor líquido.
//  3. Proposta — dados do cliente + conta bancária → link de
//                formalização pro cliente assinar.
//
// Providers (bancarizadoras): QI, BMS, Cartos. O cliente precisa ter
// saque-aniversário ativo e autorizar a bancarizadora no app FGTS.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { formatBRL, formatCpf } from '@/lib/utils';
import {
  useV8FgtsIniciarConsulta, useV8FgtsSaldo, useV8FgtsLimparCache,
  useV8FgtsTabelas, useV8FgtsSimular, useV8Bancos, useV8FgtsCriarProposta,
  type V8FgtsProvider, type V8FgtsSimulacao,
} from '@/hooks/use-fgts';
import {
  Zap, Search, Loader2, RotateCw, Send, ExternalLink, Copy, AlertCircle, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

const selectClass = 'flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

function dataBR(iso?: string): string {
  if (!iso) return '—';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
}

function toIso(s: string): string {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.substring(0, 10);
  const m = t.match(/^(\d{2})[/\-](\d{2})[/\-](\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

export default function FgtsV8Page() {
  // ── Etapa 1: saldo ──
  const [cpfRaw, setCpfRaw] = useState('');
  const [provider, setProvider] = useState<V8FgtsProvider>('qi');
  const [cpfConsultado, setCpfConsultado] = useState<string | null>(null);
  const [periodosOff, setPeriodosOff] = useState<Set<string>>(new Set());

  // ── Etapa 2: simulação ──
  const [tabelaId, setTabelaId] = useState('');
  const [simulacao, setSimulacao] = useState<V8FgtsSimulacao | null>(null);

  // ── Etapa 3: proposta ──
  const [prop, setProp] = useState({
    nome: '', nascimento: '', telefone: '', email: '', nomeMae: '', rg: '',
    maritalStatus: 'single',
    cep: '', rua: '', numero: '', bairro: '', cidade: '', uf: '', complemento: '',
    bankId: '', accountType: 'checking_account', agencia: '', conta: '', digito: '',
  });
  const [proposta, setProposta] = useState<{ proposalId?: string | null; formalizationLink?: string | null; contractNumber?: string | null } | null>(null);

  const iniciar = useV8FgtsIniciarConsulta();
  const saldo = useV8FgtsSaldo(cpfConsultado);
  const limparCache = useV8FgtsLimparCache();
  const tabelas = useV8FgtsTabelas(!!saldo.data?.balanceId);
  const simular = useV8FgtsSimular();
  const bancos = useV8Bancos(!!simulacao?.simulationId);
  const criarProposta = useV8FgtsCriarProposta();

  const cpfDigits = cpfRaw.replace(/\D/g, '');
  const cpfValido = cpfDigits.length === 11;

  const saldoOk = saldo.data?.status === 'success' && !!saldo.data?.balanceId;
  const periods = useMemo(() => saldo.data?.periods || [], [saldo.data]);
  const periodosAtivos = periods.filter((p) => !periodosOff.has(p.dueDate));

  const handleIniciar = async () => {
    if (!cpfValido) return;
    setSimulacao(null);
    setProposta(null);
    await iniciar.mutateAsync({ cpf: cpfDigits, provider });
    setCpfConsultado(cpfDigits);
    toast.success('Consulta iniciada — aguardando retorno da Caixa…');
  };

  const handleBuscarExistente = () => {
    if (!cpfValido) return;
    setSimulacao(null);
    setProposta(null);
    setCpfConsultado(cpfDigits);
  };

  const handleLimparCache = async () => {
    if (!cpfValido) return;
    await limparCache.mutateAsync(cpfDigits);
    setCpfConsultado(null);
  };

  const togglePeriodo = (dueDate: string) => {
    setPeriodosOff((prev) => {
      const next = new Set(prev);
      if (next.has(dueDate)) next.delete(dueDate);
      else next.add(dueDate);
      return next;
    });
  };

  const handleSimular = async () => {
    if (!saldo.data?.balanceId || !tabelaId) {
      toast.error('Escolha uma tabela de taxa primeiro.');
      return;
    }
    if (periodosAtivos.length < 2) {
      toast.error('Selecione no mínimo 2 períodos pra antecipar.');
      return;
    }
    const r = await simular.mutateAsync({
      cpf: cpfDigits,
      simulationFeesId: tabelaId,
      balanceId: saldo.data.balanceId,
      desiredInstallments: periodosAtivos.map((p) => ({ totalAmount: p.amount, dueDate: p.dueDate })),
      provider,
    });
    setSimulacao(r);
    toast.success(`Simulação ok — líquido ${formatBRL(r.valorLiquido || 0)}`);
  };

  const handleCriarProposta = async () => {
    if (!simulacao?.simulationId) return;
    const nascIso = toIso(prop.nascimento);
    if (!prop.nome.trim() || !nascIso || prop.telefone.replace(/\D/g, '').length < 10) {
      toast.error('Preencha nome, data de nascimento e telefone.');
      return;
    }
    if (!prop.bankId || !prop.agencia || !prop.conta) {
      toast.error('Preencha os dados bancários (banco, agência e conta).');
      return;
    }
    const r = await criarProposta.mutateAsync({
      cpf: cpfDigits,
      nome: prop.nome.trim(),
      dataNascimento: nascIso,
      telefone: prop.telefone,
      email: prop.email || undefined,
      nomeMae: prop.nomeMae || undefined,
      rg: prop.rg || undefined,
      maritalStatus: prop.maritalStatus,
      fgtsSimulationId: simulacao.simulationId!,
      simulationFeesId: tabelaId,
      periods: periodosAtivos,
      address: {
        postalCode: prop.cep, state: prop.uf, city: prop.cidade,
        neighborhood: prop.bairro, street: prop.rua, number: prop.numero,
        complement: prop.complemento,
      },
      payment: {
        bankId: prop.bankId,
        accountType: prop.accountType as 'checking_account' | 'savings_account',
        agency: prop.agencia,
        account: prop.conta,
        digit: prop.digito,
      },
    });
    setProposta(r);
    toast.success('Proposta criada! Mande o link de formalização pro cliente.');
  };

  const copiar = (texto: string) => {
    navigator.clipboard.writeText(texto).then(
      () => toast.success('Copiado!'),
      () => toast.error('Não consegui copiar'),
    );
  };

  const set = (k: keyof typeof prop) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setProp((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Zap className="size-6 text-cyan-400" />
          FGTS — V8 Sistema
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Fluxo completo: saldo → simulação → proposta com link de formalização.
          Cliente precisa de saque-aniversário ativo + bancarizadora autorizada no app FGTS.
        </p>
      </div>

      {/* ETAPA 1 — SALDO */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <h2 className="font-bold text-sm">1️⃣ Consulta de saldo</h2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px]">
              <Label htmlFor="v8-cpf" className="text-xs uppercase tracking-wider text-muted-foreground">CPF do cliente</Label>
              <Input
                id="v8-cpf"
                value={cpfDigits.length === 11 ? formatCpf(cpfRaw) : cpfRaw}
                onChange={(e) => setCpfRaw(e.target.value.replace(/\D/g, '').slice(0, 11))}
                placeholder="000.000.000-00"
                inputMode="numeric"
                className="font-mono mt-1"
              />
            </div>
            <div className="w-36">
              <Label htmlFor="v8-provider" className="text-xs uppercase tracking-wider text-muted-foreground">Bancarizadora</Label>
              <select
                id="v8-provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value as V8FgtsProvider)}
                className={`${selectClass} mt-1`}
              >
                <option value="qi">QI Tech</option>
                <option value="bms">BMS</option>
                <option value="cartos">Cartos</option>
              </select>
            </div>
            <Button onClick={handleIniciar} disabled={!cpfValido || iniciar.isPending}>
              {iniciar.isPending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              Consultar saldo
            </Button>
            <Button variant="outline" onClick={handleBuscarExistente} disabled={!cpfValido}>
              <RotateCw className="size-4" /> Buscar existente
            </Button>
            <Button variant="ghost" onClick={handleLimparCache} disabled={!cpfValido || limparCache.isPending} title="Limpa o cache na V8 pra reconsultar">
              <Trash2 className="size-4" /> Limpar cache
            </Button>
          </div>

          {cpfConsultado && (
            <div className="space-y-3">
              {!saldo.data && saldo.isLoading && (
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" /> Buscando…
                </div>
              )}
              {saldo.data && !saldoOk && saldo.data.status !== 'fail' && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Badge variant="info" className="animate-pulse">⏳ processando na Caixa…</Badge>
                  <span className="text-xs">
                    A consulta é assíncrona — a tela atualiza sozinha a cada 6s.
                  </span>
                </div>
              )}
              {saldo.data?.status === 'fail' && (
                <div className="flex items-start gap-2 text-sm rounded-md border border-red-500/40 bg-red-500/5 p-3">
                  <AlertCircle className="size-4 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold text-red-400">Consulta falhou</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {saldo.data.erro || 'Confira: saque-aniversário ativo + bancarizadora autorizada no app FGTS.'}
                      {' '}Depois use &quot;Limpar cache&quot; e consulte de novo.
                    </div>
                  </div>
                </div>
              )}
              {saldoOk && (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div className="rounded-md bg-secondary/40 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Saldo antecipável</div>
                      <div className="text-lg font-bold text-primary">{formatBRL(saldo.data?.saldoTotal || 0)}</div>
                    </div>
                    <div className="rounded-md bg-secondary/40 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Períodos</div>
                      <div className="text-lg font-semibold">{periods.length}</div>
                    </div>
                    <div className="rounded-md bg-secondary/40 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Bancarizadora</div>
                      <div className="text-lg font-semibold uppercase">{saldo.data?.provider || provider}</div>
                    </div>
                  </div>
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/30">
                        <tr>
                          <th className="text-left p-2 font-semibold">Antecipar?</th>
                          <th className="text-left p-2 font-semibold">Vencimento (aniversário)</th>
                          <th className="text-right p-2 font-semibold">Valor</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {periods.map((p) => (
                          <tr key={p.dueDate}>
                            <td className="p-2">
                              <input
                                type="checkbox"
                                checked={!periodosOff.has(p.dueDate)}
                                onChange={() => togglePeriodo(p.dueDate)}
                                className="accent-[hsl(var(--primary))]"
                              />
                            </td>
                            <td className="p-2">{dataBR(p.dueDate)}</td>
                            <td className="p-2 text-right font-mono">{formatBRL(p.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ETAPA 2 — SIMULAÇÃO */}
      {saldoOk && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <h2 className="font-bold text-sm">2️⃣ Simulação</h2>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[220px]">
                <Label htmlFor="v8-tabela" className="text-xs uppercase tracking-wider text-muted-foreground">Tabela de taxa</Label>
                <select
                  id="v8-tabela"
                  value={tabelaId}
                  onChange={(e) => setTabelaId(e.target.value)}
                  className={`${selectClass} mt-1`}
                >
                  <option value="">— escolha —</option>
                  {(tabelas.data || []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome || t.id}{t.taxaMensal != null ? ` · ${t.taxaMensal}% a.m.` : ''}{t.padrao ? ' (padrão)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="text-xs text-muted-foreground pb-2">
                {periodosAtivos.length} período(s) selecionado(s) · mínimo 2
              </div>
              <Button onClick={handleSimular} disabled={simular.isPending || !tabelaId || periodosAtivos.length < 2}>
                {simular.isPending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                Simular
              </Button>
            </div>

            {simulacao && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-md bg-secondary/40 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Líquido pro cliente</div>
                  <div className="text-lg font-bold text-primary">{formatBRL(simulacao.valorLiquido || 0)}</div>
                </div>
                <div className="rounded-md bg-secondary/40 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Valor da operação</div>
                  <div className="text-lg font-semibold">{formatBRL(simulacao.valorOperacao || 0)}</div>
                </div>
                <div className="rounded-md bg-secondary/40 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">IOF</div>
                  <div className="text-lg font-semibold">{formatBRL(simulacao.iof || 0)}</div>
                </div>
                <div className="rounded-md bg-secondary/40 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Taxa / CET mês</div>
                  <div className="text-lg font-semibold">
                    {simulacao.taxaMensal ?? '—'}% / {simulacao.cetMensal ?? '—'}%
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ETAPA 3 — PROPOSTA */}
      {simulacao?.simulationId && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <h2 className="font-bold text-sm">3️⃣ Proposta (digitação)</h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2">
                <Label>Nome completo *</Label>
                <Input value={prop.nome} onChange={set('nome')} placeholder="Nome do cliente" />
              </div>
              <div>
                <Label>Nascimento *</Label>
                <Input value={prop.nascimento} onChange={set('nascimento')} placeholder="DD/MM/AAAA" />
              </div>
              <div>
                <Label>Telefone (DDD+número) *</Label>
                <Input value={prop.telefone} onChange={set('telefone')} placeholder="15999999999" inputMode="numeric" />
              </div>
              <div>
                <Label>E-mail</Label>
                <Input value={prop.email} onChange={set('email')} placeholder="cliente@email.com" />
              </div>
              <div>
                <Label>Nome da mãe</Label>
                <Input value={prop.nomeMae} onChange={set('nomeMae')} />
              </div>
              <div>
                <Label>RG</Label>
                <Input value={prop.rg} onChange={set('rg')} />
              </div>
              <div>
                <Label>Estado civil</Label>
                <select value={prop.maritalStatus} onChange={set('maritalStatus')} className={selectClass}>
                  <option value="single">Solteiro(a)</option>
                  <option value="married">Casado(a)</option>
                  <option value="divorced">Divorciado(a)</option>
                  <option value="widower">Viúvo(a)</option>
                </select>
              </div>
              <div>
                <Label>CEP</Label>
                <Input value={prop.cep} onChange={set('cep')} inputMode="numeric" />
              </div>
              <div className="md:col-span-2">
                <Label>Rua</Label>
                <Input value={prop.rua} onChange={set('rua')} />
              </div>
              <div>
                <Label>Número</Label>
                <Input value={prop.numero} onChange={set('numero')} />
              </div>
              <div>
                <Label>Bairro</Label>
                <Input value={prop.bairro} onChange={set('bairro')} />
              </div>
              <div>
                <Label>Cidade</Label>
                <Input value={prop.cidade} onChange={set('cidade')} />
              </div>
              <div>
                <Label>UF</Label>
                <Input value={prop.uf} onChange={set('uf')} maxLength={2} />
              </div>
              <div>
                <Label>Complemento</Label>
                <Input value={prop.complemento} onChange={set('complemento')} />
              </div>
            </div>

            <div className="pt-2 border-t border-border">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                💳 Conta pra receber (transferência)
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="col-span-2">
                  <Label>Banco *</Label>
                  <select value={prop.bankId} onChange={set('bankId')} className={selectClass}>
                    <option value="">— escolha —</option>
                    {(bancos.data || []).map((b) => (
                      <option key={b.id} value={b.id}>{b.codigo} — {b.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Tipo</Label>
                  <select value={prop.accountType} onChange={set('accountType')} className={selectClass}>
                    <option value="checking_account">Corrente</option>
                    <option value="savings_account">Poupança</option>
                  </select>
                </div>
                <div>
                  <Label>Agência *</Label>
                  <Input value={prop.agencia} onChange={set('agencia')} inputMode="numeric" />
                </div>
                <div className="grid grid-cols-[1fr_60px] gap-2">
                  <div>
                    <Label>Conta *</Label>
                    <Input value={prop.conta} onChange={set('conta')} inputMode="numeric" />
                  </div>
                  <div>
                    <Label>Díg.</Label>
                    <Input value={prop.digito} onChange={set('digito')} maxLength={2} />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleCriarProposta} disabled={criarProposta.isPending}>
                {criarProposta.isPending ? (
                  <><Loader2 className="size-4 animate-spin mr-2" /> Criando proposta…</>
                ) : (
                  <><Send className="size-4 mr-2" /> Criar proposta</>
                )}
              </Button>
            </div>

            {proposta && (
              <div className="rounded-md border border-green-500/40 bg-green-500/5 p-3 space-y-2">
                <div className="font-semibold text-green-400 text-sm">✅ Proposta criada!</div>
                <div className="text-xs text-muted-foreground">
                  {proposta.contractNumber && <>Contrato <span className="font-mono">{proposta.contractNumber}</span> · </>}
                  {proposta.proposalId && <>ID <span className="font-mono">{proposta.proposalId}</span></>}
                </div>
                {proposta.formalizationLink && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => copiar(proposta.formalizationLink!)}>
                      <Copy className="size-3 mr-1" /> Copiar link de formalização
                    </Button>
                    <a href={proposta.formalizationLink} target="_blank" rel="noreferrer">
                      <Button variant="secondary" size="sm" className="text-xs h-7">
                        <ExternalLink className="size-3 mr-1" /> Abrir
                      </Button>
                    </a>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
