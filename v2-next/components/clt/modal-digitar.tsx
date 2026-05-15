'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useDigitarCLT, DigitacaoPayload } from '@/hooks/use-clt-digitacao';
import { FilaConsulta } from '@/lib/clt-types';
import { formatBRL } from '@/lib/utils';
import { Loader2, CheckCircle2, AlertCircle, ExternalLink, Send } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  banco: string | null;
  consulta: FilaConsulta | null;
}

export function ModalDigitar({ open, onClose, banco, consulta }: Props) {
  const digitar = useDigitarCLT();
  const cliente = consulta?.cliente || {};
  const vinculo = consulta?.vinculo;
  const ofertaBanco = banco ? consulta?.bancos?.[banco as keyof typeof consulta.bancos] : null;
  const dados = ofertaBanco?.dados;

  const [form, setForm] = useState<DigitacaoPayload>({
    banco: banco || '',
    cliente: { cpf: '', nome: '', dataNascimento: '' },
    endereco: {},
    bancario: { tipoConta: 'ContaCorrenteIndividual', formaCredito: '2', pixKeyType: 'cpf' },
    empregador: {},
    proposta: {},
    origem: 'consulta_unitaria',
  });

  // Pré-popula form quando abre
  useEffect(() => {
    if (!open || !consulta) return;
    setForm({
      banco: banco || '',
      cliente: {
        cpf: cliente.cpf || consulta.cpf,
        nome: cliente.nome || consulta.nome_manual || '',
        telefone: cliente.telefones?.[0]?.completo,
        ddd: cliente.telefones?.[0]?.ddd,
        dataNascimento: cliente.dataNascimento || '',
        sexo: cliente.sexo || 'M',
        nomeMae: cliente.nomeMae || '',
        email: cliente.emails?.[0] || '',
      },
      endereco: {},
      bancario: { tipoConta: 'ContaCorrenteIndividual', formaCredito: '2', pixKeyType: 'cpf' },
      empregador: {
        cnpj: vinculo?.cnpj || dados?.empregadorCnpj || '',
        nome: vinculo?.empregador || dados?.empregador || '',
        matricula: vinculo?.matricula || dados?.matricula || '',
        valorRenda: dados?.renda || '',
      },
      proposta: {
        valorLiquido: dados?.valorLiquido,
        parcelas: dados?.parcelas,
        valorParcela: dados?.valorParcela,
      },
      origem: 'consulta_unitaria',
    });
    digitar.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, banco, consulta?.id]);

  if (!banco) return null;

  const setCli = (k: string, v: string) => setForm((f) => ({ ...f, cliente: { ...f.cliente, [k]: v } }));
  const setEnd = (k: string, v: string) => setForm((f) => ({ ...f, endereco: { ...f.endereco, [k]: v } }));
  const setBnc = (k: string, v: string) => setForm((f) => ({ ...f, bancario: { ...f.bancario, [k]: v } }));
  const setEmp = (k: string, v: string) => setForm((f) => ({ ...f, empregador: { ...f.empregador, [k]: v } }));

  const result = digitar.data;
  const link = result?.linkFormalizacao || result?.formalizationUrl || result?.url || result?.link;
  const sucesso = result && (link || result.propostaNumero || result.propostaId || result.operationId);
  const portalManual = result?.portalUrl;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.cliente.cpf || !form.cliente.nome) {
      return;
    }
    digitar.mutate(form);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>📝 Digitar Proposta — {banco.toUpperCase()}</DialogTitle>
          {dados?.valorLiquido && (
            <DialogDescription>
              {formatBRL(dados.valorLiquido)} · {dados.parcelas || '?'}x {dados.valorParcela ? formatBRL(dados.valorParcela) : ''}
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Resultado da digitação */}
        {sucesso && (
          <div className="rounded-md bg-green-500/10 border border-green-500/30 p-4 space-y-3">
            <div className="flex items-center gap-2 font-bold text-green-400">
              <CheckCircle2 className="w-4 h-4" /> Proposta criada com sucesso!
            </div>
            {(result.propostaNumero || result.propostaId || result.operationId) && (
              <div className="text-sm">
                <b>Número:</b> {result.propostaNumero || result.propostaId || result.operationId}
              </div>
            )}
            {link && (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">Link de formalização pro cliente:</div>
                <div className="flex gap-2 flex-wrap">
                  <Button asChild size="sm" variant="outline">
                    <a href={link} target="_blank" rel="noreferrer" className="gap-2">
                      <ExternalLink className="w-3 h-3" /> Abrir link
                    </a>
                  </Button>
                  {form.cliente.telefone && (
                    <Button size="sm" className="gap-2 bg-green-500 hover:bg-green-600 text-black"
                      onClick={() => {
                        const tel = String(form.cliente.telefone).replace(/\D/g, '');
                        const msg = encodeURIComponent(
                          `Olá! Pra finalizar seu empréstimo CLT no ${banco.toUpperCase()}, acesse o link:\n\n${link}\n\nQualquer dúvida, me chama!`,
                        );
                        window.open(`https://wa.me/55${tel}?text=${msg}`, '_blank');
                      }}>
                      💬 Enviar via WhatsApp
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {portalManual && !sucesso && (
          <div className="rounded-md bg-yellow-500/10 border border-yellow-500/30 p-4 space-y-2">
            <div className="flex items-center gap-2 font-bold text-yellow-400">
              <AlertCircle className="w-4 h-4" /> Banco em modo manual
            </div>
            <div className="text-sm">{result?.error || result?.erro || 'Finalize a digitação no portal do banco.'}</div>
            <Button asChild size="sm" variant="outline">
              <a href={portalManual} target="_blank" rel="noreferrer" className="gap-2">
                <ExternalLink className="w-3 h-3" /> Abrir portal {banco}
              </a>
            </Button>
          </div>
        )}

        {result && !sucesso && !portalManual && (result.error || result.erro) && (
          <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
            <AlertCircle className="w-4 h-4 inline mr-1" />
            {result.error || result.erro}
          </div>
        )}

        {/* Form (esconde após sucesso) */}
        {!sucesso && (
          <form onSubmit={submit} className="space-y-4">
            <Section title="👤 Cliente">
              <Field label="Nome completo" colSpan={2}>
                <Input value={form.cliente.nome} onChange={(e) => setCli('nome', e.target.value)} required />
              </Field>
              <Field label="CPF">
                <Input value={form.cliente.cpf} onChange={(e) => setCli('cpf', e.target.value)} required />
              </Field>
              <Field label="Data Nasc">
                <Input type="date" value={form.cliente.dataNascimento}
                  onChange={(e) => setCli('dataNascimento', e.target.value)} required />
              </Field>
              <Field label="DDD">
                <Input value={form.cliente.ddd || ''} onChange={(e) => setCli('ddd', e.target.value)} maxLength={2} />
              </Field>
              <Field label="Telefone">
                <Input value={form.cliente.telefone || ''} onChange={(e) => setCli('telefone', e.target.value)} />
              </Field>
              <Field label="Sexo">
                <select value={form.cliente.sexo} onChange={(e) => setCli('sexo', e.target.value)}
                  className="h-10 px-3 text-sm rounded-md border border-input bg-background w-full">
                  <option value="M">Masculino</option>
                  <option value="F">Feminino</option>
                </select>
              </Field>
              <Field label="E-mail">
                <Input type="email" value={form.cliente.email || ''} onChange={(e) => setCli('email', e.target.value)} />
              </Field>
              <Field label="Nome da mãe" colSpan={2}>
                <Input value={form.cliente.nomeMae || ''} onChange={(e) => setCli('nomeMae', e.target.value)} />
              </Field>
            </Section>

            <Section title="📍 Endereço">
              <Field label="CEP">
                <Input value={form.endereco?.cep || ''} onChange={(e) => setEnd('cep', e.target.value)} />
              </Field>
              <Field label="Logradouro" colSpan={2}>
                <Input value={form.endereco?.logradouro || ''} onChange={(e) => setEnd('logradouro', e.target.value)} />
              </Field>
              <Field label="Número">
                <Input value={form.endereco?.numero || ''} onChange={(e) => setEnd('numero', e.target.value)} />
              </Field>
              <Field label="Bairro">
                <Input value={form.endereco?.bairro || ''} onChange={(e) => setEnd('bairro', e.target.value)} />
              </Field>
              <Field label="Cidade">
                <Input value={form.endereco?.cidade || ''} onChange={(e) => setEnd('cidade', e.target.value)} />
              </Field>
              <Field label="UF">
                <Input value={form.endereco?.uf || ''} onChange={(e) => setEnd('uf', e.target.value.toUpperCase())} maxLength={2} />
              </Field>
            </Section>

            {/* Empregador (PB/JoinBank/UY3 precisam) */}
            {['presencabank', 'joinbank', 'fintech_qi', 'fintech_celcoin', 'handbank'].includes(banco) && (
              <Section title="🏢 Empregador">
                <Field label="CNPJ">
                  <Input value={form.empregador?.cnpj || ''} onChange={(e) => setEmp('cnpj', e.target.value)} />
                </Field>
                <Field label="Razão social" colSpan={2}>
                  <Input value={form.empregador?.nome || ''} onChange={(e) => setEmp('nome', e.target.value)} />
                </Field>
                <Field label="Matrícula">
                  <Input value={form.empregador?.matricula || ''} onChange={(e) => setEmp('matricula', e.target.value)} />
                </Field>
                <Field label="Valor da renda">
                  <Input type="number" value={form.empregador?.valorRenda || ''}
                    onChange={(e) => setEmp('valorRenda', e.target.value)} />
                </Field>
              </Section>
            )}

            <Section title="🏦 Dados bancários">
              <Field label="Banco (cód)">
                <Input value={form.bancario?.numeroBanco || ''} onChange={(e) => setBnc('numeroBanco', e.target.value)} />
              </Field>
              <Field label="Agência">
                <Input value={form.bancario?.numeroAgencia || ''} onChange={(e) => setBnc('numeroAgencia', e.target.value)} />
              </Field>
              <Field label="Conta">
                <Input value={form.bancario?.numeroConta || ''} onChange={(e) => setBnc('numeroConta', e.target.value)} />
              </Field>
              <Field label="Dígito">
                <Input value={form.bancario?.digitoConta || ''} onChange={(e) => setBnc('digitoConta', e.target.value)}
                  maxLength={2} />
              </Field>
            </Section>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
              <Button type="submit" disabled={digitar.isPending} className="gap-2">
                {digitar.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {digitar.isPending ? 'Criando proposta...' : 'Criar Proposta'}
              </Button>
            </DialogFooter>
          </form>
        )}

        {sucesso && (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Fechar</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-bold text-muted-foreground/80 mb-2 uppercase tracking-wider">{title}</div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">{children}</div>
    </div>
  );
}

function Field({ label, children, colSpan }: { label: string; children: React.ReactNode; colSpan?: number }) {
  return (
    <div className={colSpan === 2 ? 'sm:col-span-2' : colSpan === 3 ? 'sm:col-span-3' : ''}>
      <Label className="text-[10px] uppercase text-muted-foreground tracking-wider">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
