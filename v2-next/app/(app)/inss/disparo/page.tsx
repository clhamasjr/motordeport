'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatCpf, formatBRL } from '@/lib/utils';
import { useInssBaseStore } from '@/hooks/use-inss-base-store';
import { useBulkDispatch, type DispatchClientData } from '@/hooks/use-inss-disparo';
import { Send, ShoppingCart, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

type CampaignType = 'completa' | 'portabilidade' | 'novo' | 'cartao' | 'saque';

function canonicalPhone(value?: string) {
  const digits = (value || '').replace(/\D/g, '');
  return digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
}

export default function DisparoInssPage() {
  const { base, selectedCpfs } = useInssBaseStore();
  const [instance, setInstance] = useState('testesofia');
  const [campaignType, setCampaignType] = useState<CampaignType>('completa');
  const [resultados, setResultados] = useState<{ nome: string; phone?: string; ok: boolean; message?: string; error?: string }[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const bulk = useBulkDispatch();

  // Constrói clientes elegíveis a partir da base + seleção
  const clientes = useMemo<DispatchClientData[]>(() => {
    if (!base) return [];
    const grupos: Record<string, DispatchClientData & { contratos: number }> = {};
    for (const e of base.elegiveis) {
      if (!selectedCpfs.has(e.cpf)) continue;
      const tel = (e.t1 || e.t2 || e.t3 || '').replace(/\D/g, '');
      if (tel.length < 10) continue; // sem telefone, não dispara
      if (!grupos[e.cpf]) {
        grupos[e.cpf] = {
          nome: e.nome,
          cpf: e.cpf,
          beneficio: e.ben,
          phone: tel.length === 11 ? tel : '55' + tel,
          t1: tel,
          banco_origem: e.cod,
          parcela_atual: e.par,
          troco: 0,
          margem_disponivel: 0,
          margem_emprestimo: 0,
          margem_cartao: 0,
          contratos: 0,
        };
      }
      grupos[e.cpf].contratos++;
      grupos[e.cpf].troco = (grupos[e.cpf].troco || 0) + (e.troco || 0);
    }
    // Anexa rmc-rcc se houver
    if (base.rmcRcc) {
      for (const r of base.rmcRcc) {
        if (!grupos[r.cpf]) continue;
        grupos[r.cpf].margem_emprestimo = r.mrgEmpNova || 0;
        grupos[r.cpf].margem_cartao = r.mrgCartNova || 0;
        grupos[r.cpf].margem_disponivel = r.mrgCart || 0;
      }
    }
    return Object.values(grupos);
  }, [base, selectedCpfs]);

  const semTel = useMemo(() => {
    if (!base) return 0;
    let count = 0;
    const cpfs = new Set<string>();
    for (const e of base.elegiveis) {
      if (!selectedCpfs.has(e.cpf) || cpfs.has(e.cpf)) continue;
      cpfs.add(e.cpf);
      const tel = (e.t1 || e.t2 || e.t3 || '').replace(/\D/g, '');
      if (tel.length < 10) count++;
    }
    return count;
  }, [base, selectedCpfs]);

  async function disparar() {
    if (clientes.length === 0) return;
    setReviewOpen(false);
    setResultados([]);
    try {
      const r = await bulk.mutateAsync({ instance, campaignType, clients: clientes });
      setResultados(r.results || []);
    } catch { /* toast no hook */ }
  }

  if (!base) {
    return (
      <div className="max-w-5xl mx-auto p-6 space-y-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Send className="size-6 text-cyan-400" />
          INSS — Disparo em Massa
        </h1>
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <Send className="size-12 mx-auto mb-2 opacity-30" />
            <div className="text-sm mb-3">Nenhuma base carregada.</div>
            <Button asChild size="sm"><Link href="/inss/higienizacao">Ir para Higienização</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Send className="size-6 text-cyan-400" />
          INSS — Disparo em Massa (Sofia)
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          A Sofia personaliza uma mensagem de abordagem por cliente usando os dados da base + tipo de campanha.
        </p>
      </div>

      {/* Config */}
      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="dispatch-instance" className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Instance Evolution
            </Label>
            <Input id="dispatch-instance" value={instance} onChange={(e) => setInstance(e.target.value)} placeholder="testesofia" className="font-mono mt-1" disabled={bulk.isPending} />
          </div>
          <div>
            <Label htmlFor="dispatch-campaign" className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Tipo de campanha
            </Label>
            <select
              id="dispatch-campaign"
              value={campaignType}
              onChange={(e) => setCampaignType(e.target.value as CampaignType)}
              disabled={bulk.isPending}
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="completa">Completa (oferece tudo: melhor oportunidade primeiro)</option>
              <option value="portabilidade">Portabilidade (só port + troco)</option>
              <option value="novo">Empréstimo novo</option>
              <option value="cartao">Cartão consignado</option>
              <option value="saque">Saque complementar</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Resumo */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Kpi label="Selecionados" value={clientes.length + semTel} cor="text-foreground" />
        <Kpi label="Com telefone" value={clientes.length} cor="text-green-400" />
        <Kpi label="Sem telefone" value={semTel} cor="text-yellow-400" />
        <Kpi label="Troco potencial" value={formatBRL(clientes.reduce((s, c) => s + (c.troco || 0), 0))} cor="text-cyan-400" isText />
      </div>

      {semTel > 0 && (
        <Card className="border-yellow-500/40 bg-yellow-500/5">
          <CardContent className="p-3 text-xs flex items-center gap-2">
            <AlertCircle className="size-4 text-yellow-400 shrink-0" />
            <span>
              <strong>{semTel}</strong> cliente(s) sem telefone na base — NÃO serão disparados.
              Vá em <Link href="/inss/pipeline" className="underline">Pipeline</Link> pra higienizar antes.
            </span>
          </CardContent>
        </Card>
      )}

      {clientes.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <ShoppingCart className="size-12 mx-auto mb-2 opacity-30" />
            <div className="text-sm mb-3">Nenhum cliente selecionado com telefone.</div>
            <Button asChild size="sm"><Link href="/inss/higienizacao">Ir selecionar clientes</Link></Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Botão disparo */}
          <Card>
            <CardContent className="p-4">
              <Button
                type="button"
                onClick={() => setReviewOpen(true)}
                disabled={bulk.isPending || !instance}
                size="lg"
                className="w-full"
              >
                {bulk.isPending ? (
                  <><Loader2 className="size-4 animate-spin" />Disparando {clientes.length} mensagens... pode levar 1-3min</>
                ) : (
                  <><Send className="size-4" />Revisar disparo para {clientes.length} clientes</>
                )}
              </Button>
              <div className="text-[10px] text-muted-foreground text-center mt-2">
                ⏱ A Sofia adiciona pausa randomizada entre envios (~3-5s) pra evitar bloqueio do WhatsApp.
              </div>
            </CardContent>
          </Card>

          {/* Lista de quem vai receber */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-xs">
                  <caption className="sr-only">Destinatários incluídos no disparo e estado do envio</caption>
                  <thead className="bg-muted/30 sticky top-0">
                    <tr>
                      <th scope="col" className="text-left p-2 font-semibold">Nome</th>
                      <th scope="col" className="text-left p-2 font-semibold">CPF</th>
                      <th scope="col" className="text-left p-2 font-semibold">Telefone</th>
                      <th scope="col" className="text-right p-2 font-semibold">Troco</th>
                      <th scope="col" className="text-right p-2 font-semibold">Margem emp.</th>
                      <th scope="col" className="text-center p-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {clientes.map((c, i) => {
                      const res = resultados.find((r) => canonicalPhone(r.phone) === canonicalPhone(c.phone));
                      return (
                        <tr key={`${c.cpf}-${i}`} className="hover:bg-muted/20">
                          <td className="p-2 font-medium">{c.nome}</td>
                          <td className="p-2 font-mono text-[10px]">{c.cpf ? formatCpf(c.cpf) : '—'}</td>
                          <td className="p-2 font-mono text-[10px]">{c.phone || '—'}</td>
                          <td className="p-2 text-right font-mono text-green-400">{formatBRL(c.troco || 0)}</td>
                          <td className="p-2 text-right font-mono text-yellow-400">{formatBRL(c.margem_emprestimo || 0)}</td>
                          <td className="p-2 text-center" aria-live="polite">
                            {res ? (
                              res.ok ? (
                                <Badge variant="success" className="text-[10px]"><CheckCircle2 className="size-3" /> enviado</Badge>
                              ) : (
                                <Badge variant="destructive" className="text-[10px]" title={res.error}><AlertCircle className="size-3" /> falhou</Badge>
                              )
                            ) : bulk.isPending ? (
                              <Badge variant="info" className="text-[10px]"><Loader2 className="size-3 animate-spin" /></Badge>
                            ) : (
                              <Badge variant="muted" className="text-[10px]">aguardando</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {resultados.length > 0 && (
            <Card className="border-green-500/40 bg-green-500/5">
              <CardContent className="p-3 text-sm">
                ✅ Disparo finalizado: <strong className="text-green-400">{resultados.filter((r) => r.ok).length}</strong> enviadas,{' '}
                <strong className="text-red-400">{resultados.filter((r) => !r.ok).length}</strong> falharam.
                Acompanhe respostas em <Link href="/inss/conversas" className="underline">Conversas</Link>.
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Revisar disparo</DialogTitle>
            <DialogDescription>
              Esta ação enviará mensagens reais pelo WhatsApp. Confira o escopo antes de confirmar.
            </DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 rounded-xl border border-border bg-secondary/20 p-4 text-sm">
            <dt className="text-muted-foreground">Instance</dt>
            <dd className="break-all text-right font-mono font-semibold">{instance}</dd>
            <dt className="text-muted-foreground">Campanha</dt>
            <dd className="text-right font-semibold capitalize">{campaignType}</dd>
            <dt className="text-muted-foreground">Destinatários</dt>
            <dd className="text-right font-semibold text-emerald-400">{clientes.length} com telefone</dd>
            <dt className="text-muted-foreground">Não incluídos</dt>
            <dd className="text-right font-semibold text-amber-300">{semTel} sem telefone</dd>
          </dl>
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-5 text-amber-200">
            Após confirmar, mantenha esta página aberta. Um resultado ausente não deve ser interpretado como falha segura para reenvio.
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReviewOpen(false)} disabled={bulk.isPending}>Cancelar</Button>
            <Button type="button" variant="destructive" onClick={() => void disparar()} disabled={bulk.isPending || !instance}>
              {bulk.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
              Confirmar e enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Kpi({ label, value, cor, isText }: { label: string; value: number | string; cor: string; isText?: boolean }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
        <div className={`${isText ? 'text-base' : 'text-2xl'} font-mono font-bold mt-1 ${cor}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
