'use client';

// ════════════════════════════════════════════════════════════════════
// FGTS — Antecipação Saque-Aniversário (via FINANTO/Ajin)
//
// Fluxo: form do cliente → cria simulação FGTS → Ajin consulta saldo
// na Caixa (async, a tela faz polling) → mostra parcelas antecipáveis
// e valor líquido → botão "Digitar" cria os contratos → exibe status
// + link de assinatura.
//
// Pré-requisito do cliente (Caixa): saque-aniversário ativo E
// autorização da instituição financeira no app FGTS.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatBRL, formatCpf } from '@/lib/utils';
import {
  useFinantoFgtsCriarSimulacao,
  useFinantoFgtsSimulacao,
  useFinantoFgtsCriarContratos,
  useFinantoFgtsContratos,
} from '@/hooks/use-finanto';
import type { FinantoBorrower, FinantoCreditBankAccount } from '@/lib/finanto-types';
import {
  Search, Send, RotateCw, ExternalLink, Copy, AlertCircle, X, Info,
} from 'lucide-react';
import { toast } from 'sonner';

// ── Recentes (localStorage — FINANTO não tem endpoint de listagem
//    de simulações FGTS, então guardamos localmente) ─────────────────
const RECENTES_KEY = 'flowforce_fgts_recentes_v1';
const RECENTES_MAX = 30;

interface RecenteFgts {
  id: string;
  nome: string;
  cpf: string;
  quando: string; // ISO
}

function lerRecentes(): RecenteFgts[] {
  if (typeof window === 'undefined') return [];
  try {
    const arr = JSON.parse(localStorage.getItem(RECENTES_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function salvarRecentes(list: RecenteFgts[]) {
  try { localStorage.setItem(RECENTES_KEY, JSON.stringify(list.slice(0, RECENTES_MAX))); } catch {}
}

// ── Helpers ──────────────────────────────────────────────────────────
function toIso(s: string): string {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.substring(0, 10);
  const m = t.match(/^(\d{2})[/\-](\d{2})[/\-](\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

function dataBR(iso?: string): string {
  if (!iso) return '—';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export default function FgtsSimulacaoPage() {
  // ── Form ──
  const [cpf, setCpf] = useState('');
  const [nome, setNome] = useState('');
  const [nascimento, setNascimento] = useState('');
  const [telefone, setTelefone] = useState('');
  const [pixTipo, setPixTipo] = useState('cpf');
  const [pixChave, setPixChave] = useState('');

  // ── Simulação aberta ──
  const [simId, setSimId] = useState<string | null>(null);
  const [digitou, setDigitou] = useState(false);
  const [recentes, setRecentes] = useState<RecenteFgts[]>([]);

  useEffect(() => { setRecentes(lerRecentes()); }, []);

  const criar = useFinantoFgtsCriarSimulacao();
  const sim = useFinantoFgtsSimulacao(simId);
  const criarContratos = useFinantoFgtsCriarContratos();
  const contratos = useFinantoFgtsContratos(simId, digitou);

  const cpfDigits = cpf.replace(/\D/g, '');

  // PIX CPF: preenche automático com o CPF do cliente se o campo estiver vazio
  const pixChaveEfetiva = pixTipo === 'cpf' && !pixChave ? cpfDigits : pixChave;

  const podeEnviar = cpfDigits.length === 11 && nome.trim().length >= 5 && !!toIso(nascimento);

  const handleCriar = async () => {
    if (!podeEnviar) {
      toast.error('Preencha CPF, nome completo e data de nascimento.');
      return;
    }
    const telDigits = telefone.replace(/\D/g, '');
    const borrower: FinantoBorrower = {
      name: nome.trim(),
      identity: cpfDigits,
      birthDate: toIso(nascimento),
      ...(telDigits.length >= 10
        ? { phones: [{ ddd: telDigits.substring(0, 2), number: telDigits.substring(2) }] }
        : {}),
    };
    const creditBankAccount: FinantoCreditBankAccount | undefined = pixChaveEfetiva
      ? { pixKey: pixChaveEfetiva, pixKeyType: pixTipo }
      : undefined;

    const r = await criar.mutateAsync({ borrower, creditBankAccount, items: [] });
    setDigitou(false);
    setSimId(r.simulationId);
    const novo: RecenteFgts = {
      id: r.simulationId!,
      nome: nome.trim(),
      cpf: cpfDigits,
      quando: new Date().toISOString(),
    };
    setRecentes((prev) => {
      const next = [novo, ...prev.filter((x) => x.id !== novo.id)];
      salvarRecentes(next);
      return next;
    });
    toast.success('Simulação FGTS criada — consultando saldo na Caixa…');
  };

  const handleDigitar = async () => {
    if (!simId) return;
    await criarContratos.mutateAsync(simId);
    setDigitou(true);
    toast.success('Contratos FGTS criados! Acompanhe o status abaixo.');
  };

  const abrirRecente = (r: RecenteFgts) => {
    setSimId(r.id);
    setDigitou(true); // simulação antiga pode já ter contrato — busca junto
  };

  const removerRecente = (id: string) => {
    setRecentes((prev) => {
      const next = prev.filter((x) => x.id !== id);
      salvarRecentes(next);
      return next;
    });
    if (simId === id) setSimId(null);
  };

  // ── Derivados da simulação ──
  const items = useMemo(() => sim.data?.items || [], [sim.data]);
  const calculado = items.some((it) => (it.netValue ?? it.loanValue ?? 0) > 0);
  const totalLiquido = items.reduce((acc, it) => acc + (it.netValue || 0), 0);
  const totalBruto = items.reduce((acc, it) => acc + (it.loanValue || it.simulationValue || 0), 0);
  const loans = contratos.data || [];

  const copiar = (texto: string) => {
    navigator.clipboard.writeText(texto).then(
      () => toast.success('Copiado!'),
      () => toast.error('Não consegui copiar'),
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">💰 FGTS — Antecipação Saque-Aniversário</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Simule e digite a antecipação via FINANTO. A consulta do saldo na Caixa é automática.
        </p>
      </div>

      {/* Pré-requisitos */}
      <Card className="border-primary/30">
        <CardContent className="p-3 flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-foreground">Antes de simular, o cliente precisa (no app FGTS da Caixa):</span>{' '}
            1) estar na modalidade <b>saque-aniversário</b> · 2) <b>autorizar a instituição financeira</b> a
            consultar o saldo (menu Autorizações). Sem isso a simulação volta sem valores.
          </div>
        </CardContent>
      </Card>

      {/* Form */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label htmlFor="fgts-cpf">CPF *</Label>
              <Input
                id="fgts-cpf"
                placeholder="000.000.000-00"
                value={cpf}
                onChange={(e) => setCpf(e.target.value)}
                maxLength={14}
              />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="fgts-nome">Nome completo *</Label>
              <Input
                id="fgts-nome"
                placeholder="Nome do cliente"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="fgts-nasc">Data de nascimento *</Label>
              <Input
                id="fgts-nasc"
                placeholder="DD/MM/AAAA"
                value={nascimento}
                onChange={(e) => setNascimento(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="fgts-tel">Telefone (DDD + número)</Label>
              <Input
                id="fgts-tel"
                placeholder="15999999999"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-[110px_1fr] gap-2">
              <div>
                <Label htmlFor="fgts-pix-tipo">PIX (crédito)</Label>
                <select
                  id="fgts-pix-tipo"
                  value={pixTipo}
                  onChange={(e) => setPixTipo(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="cpf">CPF</option>
                  <option value="phone">Telefone</option>
                  <option value="email">E-mail</option>
                  <option value="random">Aleatória</option>
                </select>
              </div>
              <div>
                <Label htmlFor="fgts-pix">Chave PIX</Label>
                <Input
                  id="fgts-pix"
                  placeholder={pixTipo === 'cpf' ? '(usa o CPF acima)' : 'Chave PIX do cliente'}
                  value={pixChave}
                  onChange={(e) => setPixChave(e.target.value)}
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleCriar} disabled={criar.isPending || !podeEnviar}>
              {criar.isPending ? (
                <><RotateCw className="w-4 h-4 mr-2 animate-spin" /> Criando simulação…</>
              ) : (
                <><Search className="w-4 h-4 mr-2" /> Simular FGTS</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Simulação aberta */}
      {simId && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  📄 Simulação
                </h2>
                {sim.data?.status?.name && (
                  <Badge variant="info">{sim.data.status.name}</Badge>
                )}
                {!calculado && sim.data && (
                  <Badge variant="muted" className="animate-pulse">⏳ consultando Caixa…</Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => copiar(simId)}>
                  <Copy className="w-3 h-3 mr-1" /> ID
                </Button>
                <Button
                  variant="outline" size="sm" className="text-xs h-7"
                  onClick={() => { sim.refetch(); if (digitou) contratos.refetch(); }}
                >
                  <RotateCw className="w-3 h-3 mr-1" /> Atualizar
                </Button>
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setSimId(null)}>
                  <X className="w-3 h-3 mr-1" /> Fechar
                </Button>
              </div>
            </div>

            {sim.isLoading && (
              <div className="space-y-2">
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
              </div>
            )}

            {sim.data && (
              <>
                {/* Cliente */}
                <div className="text-sm">
                  <span className="font-medium">{sim.data.borrower?.name || '(sem nome)'}</span>
                  <span className="text-muted-foreground">
                    {' '}· CPF {formatCpf(sim.data.borrower?.identity || '')}
                  </span>
                </div>

                {/* Valores */}
                {calculado ? (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="rounded-md bg-secondary/40 p-3">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Líquido pro cliente</div>
                        <div className="text-lg font-bold text-primary">{formatBRL(totalLiquido)}</div>
                      </div>
                      <div className="rounded-md bg-secondary/40 p-3">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Valor bruto</div>
                        <div className="text-lg font-semibold">{formatBRL(totalBruto)}</div>
                      </div>
                      <div className="rounded-md bg-secondary/40 p-3">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Parcelas (anos)</div>
                        <div className="text-lg font-semibold">{items[0]?.term ?? '—'}</div>
                      </div>
                      <div className="rounded-md bg-secondary/40 p-3">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Taxa a.m.</div>
                        <div className="text-lg font-semibold">
                          {items[0]?.monthlyRate != null ? `${items[0].monthlyRate}%` : (items[0]?.rate != null ? `${items[0].rate}%` : '—')}
                        </div>
                      </div>
                    </div>

                    {/* Itens */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                            <th className="py-1.5 pr-3">Produto</th>
                            <th className="py-1.5 pr-3">1º venc.</th>
                            <th className="py-1.5 pr-3">Último venc.</th>
                            <th className="py-1.5 pr-3 text-right">Bruto</th>
                            <th className="py-1.5 text-right">Líquido</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {items.map((it, i) => (
                            <tr key={i}>
                              <td className="py-1.5 pr-3">{it.product?.name || it.rule?.name || 'Antecipação FGTS'}</td>
                              <td className="py-1.5 pr-3">{dataBR(it.firstDueDate)}</td>
                              <td className="py-1.5 pr-3">{dataBR(it.lastDueDate)}</td>
                              <td className="py-1.5 pr-3 text-right">{formatBRL(it.loanValue || it.simulationValue || 0)}</td>
                              <td className="py-1.5 text-right font-medium">{formatBRL(it.netValue || 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Digitar */}
                    {!digitou && (
                      <div className="flex justify-end">
                        <Button onClick={handleDigitar} disabled={criarContratos.isPending}>
                          {criarContratos.isPending ? (
                            <><RotateCw className="w-4 h-4 mr-2 animate-spin" /> Digitando…</>
                          ) : (
                            <><Send className="w-4 h-4 mr-2" /> Digitar — criar contratos</>
                          )}
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    Aguardando retorno da Caixa. Se demorar mais de ~2 min, confira se o cliente
                    ativou o saque-aniversário e autorizou a instituição no app FGTS.
                  </div>
                )}
              </>
            )}

            {/* Contratos digitados */}
            {digitou && (
              <div className="space-y-2 pt-2 border-t border-border">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  📝 Contratos
                </h3>
                {contratos.isLoading && <Skeleton className="h-10" />}
                {!contratos.isLoading && loans.length === 0 && (
                  <div className="text-sm text-muted-foreground">
                    Nenhum contrato encontrado ainda — clique em Atualizar em alguns segundos.
                  </div>
                )}
                {loans.map((loan) => (
                  <div key={loan.id} className="flex items-center justify-between gap-3 rounded-md bg-secondary/40 p-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        {loan.code || loan.contractNumber || loan.id}
                        {loan.status?.name && <Badge variant="info" className="ml-2 text-[10px]">{loan.status.name}</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Bruto {formatBRL(loan.loanValue || 0)} · Líquido {formatBRL(loan.netValue || 0)}
                      </div>
                    </div>
                    {loan.signature?.url && (
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => copiar(loan.signature!.url!)}>
                          <Copy className="w-3 h-3 mr-1" /> Link assinatura
                        </Button>
                        <a href={loan.signature.url} target="_blank" rel="noreferrer">
                          <Button variant="secondary" size="sm" className="text-xs h-7">
                            <ExternalLink className="w-3 h-3 mr-1" /> Abrir
                          </Button>
                        </a>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Recentes */}
      <Card>
        <CardContent className="p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            📋 Simulações recentes (deste navegador)
          </h2>
          {recentes.length === 0 && (
            <div className="text-sm text-muted-foreground py-6 text-center">
              Nenhuma simulação ainda. Preencha os dados do cliente acima.
            </div>
          )}
          {recentes.length > 0 && (
            <div className="divide-y divide-border">
              {recentes.map((r) => (
                <div key={r.id} className="flex items-center justify-between py-2 gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm truncate">{r.nome || '(sem nome)'}</div>
                    <div className="text-xs text-muted-foreground">
                      CPF {formatCpf(r.cpf)} · {dataBR(r.quando.substring(0, 10))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant={simId === r.id ? 'secondary' : 'outline'}
                      size="sm"
                      onClick={() => abrirRecente(r)}
                    >
                      {simId === r.id ? 'Aberta' : 'Abrir'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => removerRecente(r.id)}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
