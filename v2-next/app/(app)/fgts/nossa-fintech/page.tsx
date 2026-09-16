'use client';

// ════════════════════════════════════════════════════════════════════
// FGTS — A Nossa Fintech (digitação completa)
//
// Fluxo (namespace /nossa/v1/, doc Spixii):
//  1. Saldo    — POST /nossa/v1/balance → key + eligible + max_loan_value + periods
//  2. Tabelas  — POST /nossa/v2/simulation → escolhe cod_produto
//  3. Simular  — POST /nossa/v1/simulation → simulation_key + líquido
//  4. Proposta — POST /nossa/v1/proposal → debt_key + link de assinatura
//
// service_type (bancarizadora): j17 | bmp | qi.
// eligibility: true = tabelas com TAC · false = tabelas com SEGURO.
// Cliente precisa ter saque-aniversário ativo + a instituição autorizada
// no app FGTS da Caixa.
// ════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { formatBRL, formatCpf } from '@/lib/utils';
import {
  useNossaFintechFgtsSaldo, useNossaFintechFgtsTabelas,
  useNossaFintechFgtsSimular, useNossaFintechFgtsProposta,
  type NossaFintechFgtsTabela, type NossaFintechFgtsSimulacao,
} from '@/hooks/use-fgts';
import {
  Landmark, Search, Loader2, Send, ExternalLink, Copy, AlertCircle, FileText,
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

export default function FgtsNossaFintechPage() {
  // ── Etapa 1: saldo ──
  const [cpfRaw, setCpfRaw] = useState('');
  const [serviceType, setServiceType] = useState<'j17' | 'bmp' | 'qi'>('j17');
  const [parcelas, setParcelas] = useState(4);
  const [comTac, setComTac] = useState(true); // eligibility: true=TAC, false=SEGURO
  const [saldoKey, setSaldoKey] = useState<string | null>(null);

  // ── Etapa 2: tabela + simulação ──
  const [codProduto, setCodProduto] = useState<number | ''>('');
  const [simulacao, setSimulacao] = useState<NossaFintechFgtsSimulacao | null>(null);

  // ── Etapa 3: proposta ──
  const [cli, setCli] = useState({
    person_name: '', mother_name: '', birth_date: '', marital_status: 'single',
    email: '', telefone: '',
    postal_code: '', street: '', number: '', neighborhood: '', city: '', state: '', complement: '',
    pixTipo: 'CPF', pixKey: '',
  });
  const [proposta, setProposta] = useState<{ debtKey?: string | null; linkForm?: string | null; ccbPdf?: string | null; numContrato?: string | null; valLiquido?: number | null; situacao?: string | null } | null>(null);

  const saldo = useNossaFintechFgtsSaldo();
  const tabelas = useNossaFintechFgtsTabelas();
  const simular = useNossaFintechFgtsSimular();
  const criarProposta = useNossaFintechFgtsProposta();

  const cpfDigits = cpfRaw.replace(/\D/g, '');
  const cpfValido = cpfDigits.length === 11;

  const s = saldo.data;
  const elegivel = !!s?.elegivel && (s?.maxLoanValue ?? 0) > 0;
  const listaTabelas = tabelas.data || [];

  const handleSaldo = async () => {
    if (!cpfValido) { toast.error('CPF inválido'); return; }
    setSaldoKey(null); setSimulacao(null); setProposta(null); setCodProduto('');
    const r = await saldo.mutateAsync({ cpf: cpfDigits, serviceType });
    if (r.elegivel && r.key) {
      setSaldoKey(r.key);
      // já busca as tabelas
      tabelas.mutate({ cpf: cpfDigits, key: r.key, numberOfInstallments: parcelas, eligibility: comTac, serviceType });
      toast.success('Saldo consultado — escolha a tabela');
    } else {
      toast.warning(r.erro || 'Cliente sem saldo/autorização nesta bancarizadora');
    }
  };

  const recarregarTabelas = () => {
    if (!saldoKey) return;
    setCodProduto(''); setSimulacao(null);
    tabelas.mutate({ cpf: cpfDigits, key: saldoKey, numberOfInstallments: parcelas, eligibility: comTac, serviceType });
  };

  const handleSimular = async () => {
    if (!saldoKey || !codProduto) { toast.error('Escolha uma tabela'); return; }
    const r = await simular.mutateAsync({
      cpf: cpfDigits, key: saldoKey, numberOfInstallments: parcelas,
      eligibility: comTac, codProduto: Number(codProduto), serviceType,
    });
    setSimulacao(r);
    setProposta(null);
    toast.success(`Simulado — líquido ${formatBRL(r.disbursedAmount || 0)}`);
  };

  const set = (k: keyof typeof cli) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setCli((p) => ({ ...p, [k]: e.target.value }));

  const handleProposta = async () => {
    if (!simulacao?.simulationKey) return;
    const nascIso = toIso(cli.birth_date);
    const tel = cli.telefone.replace(/\D/g, '');
    if (!cli.person_name.trim() || !nascIso || tel.length < 10) {
      toast.error('Preencha nome, nascimento e telefone.');
      return;
    }
    const pixKey = cli.pixKey.trim() || (cli.pixTipo === 'CPF' ? cpfDigits : '');
    if (!pixKey) { toast.error('Informe a chave PIX pra crédito.'); return; }

    const r = await criarProposta.mutateAsync({
      serviceType,
      simulationKey: simulacao.simulationKey,
      client: {
        person_name: cli.person_name.trim(),
        mother_name: cli.mother_name.trim() || 'NAO INFORMADO',
        birth_date: nascIso,
        profession: '',
        nationality: 'Brasileiro',
        marital_status: cli.marital_status,
        email: cli.email.trim() || `cliente${cpfDigits}@lead.lhamascred.com.br`,
        country_code: '55',
        area_code: tel.substring(0, 2),
        phone_number: tel.substring(2),
        street: cli.street.trim(),
        state: cli.state.trim().toUpperCase(),
        city: cli.city.trim(),
        neighborhood: cli.neighborhood.trim(),
        number: cli.number.trim() || '0',
        postal_code: cli.postal_code.replace(/\D/g, ''),
        complement: cli.complement.trim(),
        bank_account: [{ pix_transfer_type: 'key', pix_key: pixKey }],
      },
    });
    setProposta(r);
    toast.success('Proposta criada! Mande o link de assinatura pro cliente.');
  };

  const copiar = (t: string) => navigator.clipboard.writeText(t).then(
    () => toast.success('Copiado!'), () => toast.error('Não consegui copiar'));

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Landmark className="size-6 text-cyan-400" /> FGTS — A Nossa Fintech
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Antecipação saque-aniversário: saldo → tabela → simulação → proposta com link de assinatura.
        </p>
      </div>

      {/* ETAPA 1 — SALDO */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <h2 className="font-bold text-sm">1️⃣ Consulta de saldo</h2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[160px]">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">CPF</Label>
              <Input
                value={cpfDigits.length === 11 ? formatCpf(cpfRaw) : cpfRaw}
                onChange={(e) => setCpfRaw(e.target.value.replace(/\D/g, '').slice(0, 11))}
                placeholder="000.000.000-00" inputMode="numeric" className="font-mono mt-1"
              />
            </div>
            <div className="w-32">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Bancarizadora</Label>
              <select value={serviceType} onChange={(e) => setServiceType(e.target.value as 'j17' | 'bmp' | 'qi')} className={`${selectClass} mt-1`}>
                <option value="j17">J17</option>
                <option value="bmp">BMP</option>
                <option value="qi">QI</option>
              </select>
            </div>
            <div className="w-24">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Parcelas</Label>
              <select value={parcelas} onChange={(e) => setParcelas(Number(e.target.value))} className={`${selectClass} mt-1`}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="w-32">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Custo</Label>
              <select value={comTac ? 'tac' : 'seguro'} onChange={(e) => setComTac(e.target.value === 'tac')} className={`${selectClass} mt-1`}>
                <option value="tac">Com TAC</option>
                <option value="seguro">Com Seguro</option>
              </select>
            </div>
            <Button onClick={handleSaldo} disabled={!cpfValido || saldo.isPending}>
              {saldo.isPending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              Consultar saldo
            </Button>
          </div>

          {s && !elegivel && (
            <div className="flex items-start gap-2 text-sm rounded-md border border-yellow-500/40 bg-yellow-500/5 p-3">
              <AlertCircle className="size-4 text-yellow-500 shrink-0 mt-0.5" />
              <div className="text-muted-foreground">
                {s.erro || 'Sem saldo/autorização nesta bancarizadora.'} Confira se o cliente ativou o
                saque-aniversário e autorizou <b className="uppercase">{serviceType}</b> no app FGTS — ou troque a bancarizadora.
              </div>
            </div>
          )}

          {elegivel && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-md bg-secondary/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Máx. empréstimo</div>
                <div className="text-lg font-bold text-primary">{formatBRL(s?.maxLoanValue || 0)}</div>
              </div>
              <div className="rounded-md bg-secondary/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Períodos</div>
                <div className="text-lg font-semibold">{s?.periods?.length || 0}</div>
              </div>
              <div className="rounded-md bg-secondary/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Bancarizadora</div>
                <div className="text-lg font-semibold uppercase">{serviceType}</div>
              </div>
              <div className="rounded-md bg-secondary/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Elegível</div>
                <div className="text-lg font-semibold text-green-400">Sim</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ETAPA 2 — TABELA + SIMULAÇÃO */}
      {elegivel && saldoKey && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <h2 className="font-bold text-sm">2️⃣ Tabela + simulação</h2>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[240px]">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Tabela (produto)</Label>
                <select value={codProduto} onChange={(e) => setCodProduto(Number(e.target.value))} className={`${selectClass} mt-1`} disabled={tabelas.isPending}>
                  <option value="">{tabelas.isPending ? 'carregando…' : '— escolha —'}</option>
                  {listaTabelas.map((t: NossaFintechFgtsTabela) => (
                    <option key={t.cod_produto} value={t.cod_produto}>
                      {t.name} · {t.cod_tabela} · desemb. {formatBRL(t.disbursement_amount)}
                    </option>
                  ))}
                </select>
              </div>
              <Button variant="outline" onClick={recarregarTabelas} disabled={tabelas.isPending}>
                {tabelas.isPending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                Recarregar tabelas
              </Button>
              <Button onClick={handleSimular} disabled={simular.isPending || !codProduto}>
                {simular.isPending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                Simular
              </Button>
            </div>

            {simulacao && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rounded-md bg-secondary/40 p-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Líquido pro cliente</div>
                    <div className="text-lg font-bold text-primary">{formatBRL(simulacao.disbursedAmount || 0)}</div>
                  </div>
                  <div className="rounded-md bg-secondary/40 p-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Valor emissão</div>
                    <div className="text-lg font-semibold">{formatBRL(simulacao.issueAmount || 0)}</div>
                  </div>
                  <div className="rounded-md bg-secondary/40 p-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">IOF</div>
                    <div className="text-lg font-semibold">{formatBRL(simulacao.iof || 0)}</div>
                  </div>
                  <div className="rounded-md bg-secondary/40 p-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Parcelas</div>
                    <div className="text-lg font-semibold">{simulacao.installments?.length ?? parcelas}</div>
                  </div>
                </div>
                {!!simulacao.installments?.length && (
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/30">
                        <tr>
                          <th className="text-left p-2 font-semibold">#</th>
                          <th className="text-left p-2 font-semibold">Vencimento</th>
                          <th className="text-right p-2 font-semibold">Valor</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {simulacao.installments.map((it, i) => (
                          <tr key={i}>
                            <td className="p-2">{it.installment_number ?? i + 1}</td>
                            <td className="p-2">{dataBR(it.due_date)}</td>
                            <td className="p-2 text-right">{formatBRL(it.total_amount || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ETAPA 3 — PROPOSTA */}
      {simulacao?.simulationKey && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <h2 className="font-bold text-sm">3️⃣ Proposta (digitação)</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2">
                <Label>Nome completo *</Label>
                <Input value={cli.person_name} onChange={set('person_name')} placeholder="Nome do cliente" />
              </div>
              <div>
                <Label>Nascimento *</Label>
                <Input value={cli.birth_date} onChange={set('birth_date')} placeholder="DD/MM/AAAA" />
              </div>
              <div>
                <Label>Nome da mãe</Label>
                <Input value={cli.mother_name} onChange={set('mother_name')} />
              </div>
              <div>
                <Label>Telefone (DDD+número) *</Label>
                <Input value={cli.telefone} onChange={set('telefone')} placeholder="15999999999" inputMode="numeric" />
              </div>
              <div>
                <Label>E-mail</Label>
                <Input value={cli.email} onChange={set('email')} placeholder="cliente@email.com" />
              </div>
              <div>
                <Label>Estado civil</Label>
                <select value={cli.marital_status} onChange={set('marital_status')} className={selectClass}>
                  <option value="single">Solteiro(a)</option>
                  <option value="married">Casado(a)</option>
                  <option value="divorced">Divorciado(a)</option>
                  <option value="widowed">Viúvo(a)</option>
                  <option value="separated">Separado(a)</option>
                </select>
              </div>
              <div>
                <Label>CEP</Label>
                <Input value={cli.postal_code} onChange={set('postal_code')} inputMode="numeric" />
              </div>
              <div className="md:col-span-2">
                <Label>Rua</Label>
                <Input value={cli.street} onChange={set('street')} />
              </div>
              <div>
                <Label>Número</Label>
                <Input value={cli.number} onChange={set('number')} />
              </div>
              <div>
                <Label>Bairro</Label>
                <Input value={cli.neighborhood} onChange={set('neighborhood')} />
              </div>
              <div>
                <Label>Cidade</Label>
                <Input value={cli.city} onChange={set('city')} />
              </div>
              <div>
                <Label>UF</Label>
                <Input value={cli.state} onChange={set('state')} maxLength={2} />
              </div>
            </div>

            <div className="pt-2 border-t border-border">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                💳 Crédito via PIX
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <Label>Tipo de chave</Label>
                  <select value={cli.pixTipo} onChange={set('pixTipo')} className={selectClass}>
                    <option value="CPF">CPF</option>
                    <option value="PHONE">Telefone</option>
                    <option value="EMAIL">E-mail</option>
                    <option value="EVP">Aleatória</option>
                  </select>
                </div>
                <div className="md:col-span-3">
                  <Label>Chave PIX</Label>
                  <Input value={cli.pixKey} onChange={set('pixKey')} placeholder={cli.pixTipo === 'CPF' ? '(usa o CPF do cliente)' : 'Chave PIX'} />
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleProposta} disabled={criarProposta.isPending}>
                {criarProposta.isPending ? (
                  <><Loader2 className="size-4 animate-spin mr-2" /> Criando proposta…</>
                ) : (
                  <><Send className="size-4 mr-2" /> Criar proposta</>
                )}
              </Button>
            </div>

            {proposta && (
              <div className="rounded-md border border-green-500/40 bg-green-500/5 p-3 space-y-2">
                <div className="font-semibold text-green-400 text-sm">
                  ✅ Proposta criada! {proposta.situacao && <Badge variant="info" className="ml-1 text-[10px]">{proposta.situacao}</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {proposta.numContrato && <>Contrato <span className="font-mono">{proposta.numContrato}</span> · </>}
                  Líquido <b>{formatBRL(proposta.valLiquido || 0)}</b>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {proposta.linkForm && (
                    <>
                      <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => copiar(proposta.linkForm!)}>
                        <Copy className="size-3 mr-1" /> Link de assinatura
                      </Button>
                      <a href={proposta.linkForm} target="_blank" rel="noreferrer">
                        <Button variant="secondary" size="sm" className="text-xs h-7"><ExternalLink className="size-3 mr-1" /> Abrir</Button>
                      </a>
                    </>
                  )}
                  {proposta.ccbPdf && (
                    <a href={proposta.ccbPdf} target="_blank" rel="noreferrer">
                      <Button variant="ghost" size="sm" className="text-xs h-7"><FileText className="size-3 mr-1" /> CCB (PDF)</Button>
                    </a>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
