'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { formatBRL, formatCpf } from '@/lib/utils';
import { useDigitarFinanto, type DigitarFinantoInput } from '@/hooks/use-finanto';
import type { InssParsedResult, InssContrato } from '@/lib/inss-types';
import { parseBR } from '@/lib/inss-motor';
import {
  Send, Copy, Check, AlertCircle, ExternalLink, ChevronDown, ChevronRight,
  User, MapPin, CreditCard, Banknote, RotateCw,
} from 'lucide-react';
import { toast } from 'sonner';

interface OportunidadeBase {
  banco?: string;
  valor?: number;
  novaParc?: number;
  prazo?: number;
  taxa?: number;
}

interface OportNovo extends OportunidadeBase {
  tipo: 'emprestimo_novo';
}

interface OportPort extends OportunidadeBase {
  tipo: 'portabilidade';
  contrato: InssContrato; // contrato origem (do Multicorban)
  troco: number;
  reducao: number;
}

type OportEntrada = OportNovo | OportPort;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cpf: string;
  parsed: InssParsedResult;
  oportunidade: OportEntrada;
  /** telefone (E164 sem +, com DDD) pra futura msg WhatsApp */
  telefone?: string;
}

// ── Deduz sexo pelo primeiro nome (mesma heurística do agent.js) ────
function deduzirSexo(nome?: string): 'M' | 'F' | undefined {
  if (!nome) return undefined;
  const primeiro = nome.trim().split(/\s+/)[0]?.toLowerCase();
  if (!primeiro) return undefined;
  const masc = ['jose','andre','felipe','vicente','jaime','joel','isaque','enrique','henrique','davi','levi','noe','aristides','silas','dione','gilmar','edgar','ricardo','eduardo','fernando','leonardo','gustavo','mauricio','fabricio','patricio'];
  if (masc.includes(primeiro)) return 'M';
  const fem = ['carmen','mirian','miriam','jaqueline','jacqueline','helen','ester','esther','raquel','beatris','beatriz','alis','iris','ines','mercedes','rute'];
  if (fem.includes(primeiro)) return 'F';
  const u = primeiro.slice(-1);
  return (u === 'a' || u === 'e') ? 'F' : 'M';
}

// ── Extrai número do endereço ───────────────────────────────────────
function extrairNumero(end?: string): string {
  if (!end) return '';
  const m = end.match(/[,\s](?:n\s*[º°.]?\s*|num\s*[º°.]?\s*)?(\d{1,6})\b/i)
    || end.match(/(\d{1,6})\s*$/);
  return m && m[1] ? m[1] : '';
}

// ── Converte data BR (DD/MM/YYYY) pra ISO (YYYY-MM-DD) ──────────────
function toIso(s?: string): string {
  if (!s) return '';
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.substring(0, 10);
  const m = t.match(/^(\d{2})[/\-](\d{2})[/\-](\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

export function DigitarFinantoModal({ open, onOpenChange, cpf, parsed, oportunidade, telefone }: Props) {
  const mut = useDigitarFinanto();
  const cpfDigits = (cpf || '').replace(/\D/g, '');

  // ── Pré-preenche o formulário a partir do parsed (Multicorban) ──
  const initial = useMemo(() => {
    const b = parsed.beneficiario || {};
    const ben = parsed.beneficio || {};
    const e = parsed.endereco || {};
    const bp = parsed.banco || {};
    const t = parsed.telefones?.[0];
    const telE164 = telefone || (t ? `55${t.ddd || ''}${t.numero || ''}`.replace(/\D/g, '') : '');
    return {
      cpf: cpfDigits,
      nome_completo: b.nome || '',
      data_nascimento: toIso(b.data_nascimento),
      beneficio: b.nb || ben.nb || '',
      especie: ben.especie || '',
      rg_numero: b.rg || '',
      rg_orgao: 'SSP',
      rg_uf: e.uf || '',
      rg_data: '',
      nome_mae: b.nome_mae || '',
      sexo: deduzirSexo(b.nome) || 'M',
      estado_civil: 'Solteiro',
      email: cpfDigits ? `cliente${cpfDigits}@gmail.com` : '',
      telefone: telE164,
      cep: e.cep || '',
      endereco: e.endereco || '',
      numero_end: extrairNumero(e.endereco),
      complemento: '',
      bairro: e.bairro || '',
      cidade: e.municipio || '',
      uf: e.uf || '',
      banco_deposito: bp.nome || '',
      agencia: bp.agencia || '',
      conta: bp.conta || '',
      conta_digito: '',
      tipo_conta: (bp.tipo || '').toLowerCase().includes('pou') ? 'savings' : 'checking',
    };
  }, [parsed, cpfDigits, telefone]);

  const [form, setForm] = useState(initial);
  const [openSec, setOpenSec] = useState({ cliente: false, endereco: false, conta: false, oportunidade: true });
  const [resultado, setResultado] = useState<{ simulationId: string; code?: string; signatureUrl?: string | null } | null>(null);
  const [copiado, setCopiado] = useState(false);

  // Reseta quando reabrir
  function reset() {
    setForm(initial);
    setResultado(null);
    setCopiado(false);
    mut.reset();
  }

  function f<K extends keyof typeof form>(key: K, v: typeof form[K]) {
    setForm((p) => ({ ...p, [key]: v }));
  }

  // ── Constrói o payload exato que /api/sofia-digitar-finanto espera ──
  function buildPayload(): DigitarFinantoInput {
    const oport: DigitarFinantoInput['oportunidade'] = {
      tipo: oportunidade.tipo,
      banco: oportunidade.banco || 'FINANTO',
      valor: oportunidade.valor,
      novaParc: oportunidade.novaParc,
      prazo: oportunidade.prazo || 108,
      taxa: oportunidade.taxa || 1.85,
    };
    if (oportunidade.tipo === 'portabilidade') {
      const ct = oportunidade.contrato || {};
      oport.troco = oportunidade.troco;
      oport.reducao = oportunidade.reducao;
      oport.contrato = ct.contrato;
      oport.origem = {
        cod: ct.banco_codigo,
        banco: ct.banco_nome || ct.banco,
        contrato: ct.contrato,
        taxa: parseBR(ct.taxa),
        parcela: parseBR(ct.parcela),
        saldo: parseBR(ct.saldo || ct.saldo_quitacao),
        prazoRestante: parseInt(ct.prazo || '0', 10) || 0,
        prazoTotal: parseInt(ct.prazo_original || '0', 10) || 0,
      };
    }
    return { convData: form, oportunidade: oport, telefone: form.telefone };
  }

  async function digitar() {
    const camposCriticos: Array<keyof typeof form> = [
      'cpf', 'nome_completo', 'data_nascimento', 'beneficio',
    ];
    const faltam = camposCriticos.filter((k) => !form[k]);
    if (faltam.length) {
      toast.error(`Faltam campos obrigatórios: ${faltam.join(', ')}`);
      return;
    }
    if (oportunidade.tipo === 'portabilidade' && !oportunidade.contrato?.contrato) {
      toast.error('Contrato origem ausente — não dá pra digitar portabilidade');
      return;
    }
    try {
      const r = await mut.mutateAsync(buildPayload());
      setResultado({
        simulationId: r.simulationId || '',
        code: r.code,
        signatureUrl: r.signatureUrl,
      });
    } catch {
      // toast no hook
    }
  }

  async function copiarLink() {
    if (!resultado?.signatureUrl) return;
    try {
      await navigator.clipboard.writeText(resultado.signatureUrl);
      setCopiado(true);
      toast.success('Link copiado!');
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      toast.error('Falha ao copiar — selecione o link manualmente');
    }
  }

  // ── Computa título do dialog conforme tipo ──
  const tituloTipo = oportunidade.tipo === 'portabilidade' ? 'Portabilidade + Refin' : 'Empréstimo Novo';
  const iconeTipo = oportunidade.tipo === 'portabilidade' ? '🔄' : '💰';

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="size-5 text-orange-400" />
            Digitar na FINANTO — {iconeTipo} {tituloTipo}
          </DialogTitle>
          <DialogDescription>
            Revise os dados e clique em <strong>Digitar agora</strong>. O termo INSS/DATAPREV é assinado
            automaticamente e você recebe o link de assinatura do cliente.
          </DialogDescription>
        </DialogHeader>

        {/* ─── RESULTADO (depois de digitar) ─────────────────────────────── */}
        {resultado && (
          <div className="rounded-lg border border-green-500/50 bg-green-500/10 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Check className="size-5 text-green-400" />
              <span className="font-bold text-green-300">Proposta digitada com sucesso!</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {resultado.code && (
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Código</div>
                  <div className="font-mono font-bold">{resultado.code}</div>
                </div>
              )}
              <div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Simulation ID</div>
                <div className="font-mono text-[10px] break-all">{resultado.simulationId}</div>
              </div>
            </div>
            {resultado.signatureUrl ? (
              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Link de assinatura</div>
                <div className="rounded bg-background border border-border p-2 font-mono text-[10px] break-all">
                  {resultado.signatureUrl}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" variant="default" onClick={copiarLink}>
                    {copiado ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copiado ? 'Copiado!' : 'Copiar link'}
                  </Button>
                  <a href={resultado.signatureUrl} target="_blank" rel="noopener noreferrer">
                    <Button size="sm" variant="outline">
                      <ExternalLink className="size-3.5" /> Abrir
                    </Button>
                  </a>
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                Aguardando link de assinatura — a FINANTO está gerando. Atualize em 1 minuto.
              </div>
            )}
          </div>
        )}

        {/* ─── ERRO ─────────────────────────────────────────────────────── */}
        {mut.error && !resultado && (
          <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 flex items-start gap-2">
            <AlertCircle className="size-5 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-bold text-red-300 text-sm">Falha ao digitar</div>
              <div className="text-xs mt-1 break-words">{(mut.error as Error).message}</div>
              <Button size="sm" variant="outline" className="mt-2" onClick={digitar}>
                <RotateCw className="size-3.5" /> Tentar de novo
              </Button>
            </div>
          </div>
        )}

        {/* ─── FORMULÁRIO (escondido depois de digitar com sucesso) ──────── */}
        {!resultado && (
          <div className="space-y-3">
            {/* ── OPORTUNIDADE (sempre aberta no topo) ── */}
            <Section
              icon={<Banknote className="size-4 text-orange-400" />}
              title="Oportunidade escolhida"
              open={openSec.oportunidade}
              onToggle={() => setOpenSec((p) => ({ ...p, oportunidade: !p.oportunidade }))}
            >
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                <KV label="Tipo" value={tituloTipo} />
                <KV label="Banco" value={oportunidade.banco || 'FINANTO'} />
                <KV label="Prazo" value={`${oportunidade.prazo || 108}m`} mono />
                <KV label="Taxa" value={`${(oportunidade.taxa || 1.85).toFixed(2)}% a.m.`} mono />
                {oportunidade.tipo === 'emprestimo_novo' && (
                  <>
                    <KV label="Valor liberado" value={formatBRL(oportunidade.valor || 0)} cor="text-green-400" mono />
                    <KV label="Parcela" value={formatBRL(oportunidade.novaParc || 0)} mono />
                  </>
                )}
                {oportunidade.tipo === 'portabilidade' && (
                  <>
                    <KV label="Troco" value={formatBRL(oportunidade.troco || 0)} cor="text-green-400" mono />
                    <KV label="Nova parcela" value={formatBRL(oportunidade.novaParc || 0)} mono />
                    <KV label="Redução" value={formatBRL(oportunidade.reducao || 0)} cor="text-cyan-400" mono />
                    <KV label="Contrato origem" value={oportunidade.contrato?.contrato || '—'} mono />
                    <KV label="Banco origem" value={oportunidade.contrato?.banco_nome || oportunidade.contrato?.banco || '—'} />
                    <KV label="Saldo devedor" value={formatBRL(parseBR(oportunidade.contrato?.saldo || oportunidade.contrato?.saldo_quitacao || 0))} mono />
                  </>
                )}
              </div>
            </Section>

            {/* ── CLIENTE ── */}
            <Section
              icon={<User className="size-4 text-cyan-400" />}
              title="Dados do cliente"
              badge={form.nome_completo ? `${form.nome_completo.substring(0, 30)}${form.nome_completo.length > 30 ? '…' : ''}` : undefined}
              open={openSec.cliente}
              onToggle={() => setOpenSec((p) => ({ ...p, cliente: !p.cliente }))}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Field label="Nome completo *" value={form.nome_completo} onChange={(v) => f('nome_completo', v)} />
                <Field label="CPF *" value={formatCpf(form.cpf)} onChange={(v) => f('cpf', v.replace(/\D/g, ''))} mono />
                <Field label="Data nascimento *" type="date" value={form.data_nascimento} onChange={(v) => f('data_nascimento', v)} />
                <Field label="Benefício INSS (NB) *" value={form.beneficio} onChange={(v) => f('beneficio', v.replace(/\D/g, ''))} mono />
                <Field label="Espécie" value={form.especie} onChange={(v) => f('especie', v)} mono />
                <Field label="Nome da mãe" value={form.nome_mae} onChange={(v) => f('nome_mae', v)} />
                <Field label="RG" value={form.rg_numero} onChange={(v) => f('rg_numero', v)} mono />
                <Field label="Órgão emissor" value={form.rg_orgao} onChange={(v) => f('rg_orgao', v)} />
                <Field label="UF do RG" value={form.rg_uf} onChange={(v) => f('rg_uf', v.toUpperCase().slice(0, 2))} mono />
                <Field label="Data emissão RG" type="date" value={form.rg_data} onChange={(v) => f('rg_data', v)} />
                <SelectField label="Sexo" value={form.sexo} onChange={(v) => f('sexo', v as 'M' | 'F')} opts={[
                  { value: 'M', label: 'Masculino' }, { value: 'F', label: 'Feminino' },
                ]} />
                <SelectField label="Estado civil" value={form.estado_civil} onChange={(v) => f('estado_civil', v)} opts={[
                  { value: 'Solteiro', label: 'Solteiro(a)' },
                  { value: 'Casado', label: 'Casado(a)' },
                  { value: 'Divorciado', label: 'Divorciado(a)' },
                  { value: 'Viuvo', label: 'Viúvo(a)' },
                  { value: 'Uniao Estavel', label: 'União estável' },
                ]} />
                <Field label="E-mail" type="email" value={form.email} onChange={(v) => f('email', v)} />
                <Field label="Telefone (5511999999999)" value={form.telefone} onChange={(v) => f('telefone', v.replace(/\D/g, ''))} mono />
              </div>
            </Section>

            {/* ── ENDEREÇO ── */}
            <Section
              icon={<MapPin className="size-4 text-purple-400" />}
              title="Endereço"
              badge={form.endereco ? `${form.endereco.substring(0, 35)}${form.endereco.length > 35 ? '…' : ''}` : 'preencher'}
              open={openSec.endereco}
              onToggle={() => setOpenSec((p) => ({ ...p, endereco: !p.endereco }))}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Field label="CEP" value={form.cep} onChange={(v) => f('cep', v.replace(/\D/g, '').slice(0, 8))} mono />
                <Field label="Endereço" value={form.endereco} onChange={(v) => f('endereco', v)} />
                <Field label="Número" value={form.numero_end} onChange={(v) => f('numero_end', v)} mono />
                <Field label="Complemento" value={form.complemento} onChange={(v) => f('complemento', v)} />
                <Field label="Bairro" value={form.bairro} onChange={(v) => f('bairro', v)} />
                <Field label="Cidade" value={form.cidade} onChange={(v) => f('cidade', v)} />
                <Field label="UF" value={form.uf} onChange={(v) => f('uf', v.toUpperCase().slice(0, 2))} mono />
              </div>
            </Section>

            {/* ── CONTA DEPÓSITO ── */}
            <Section
              icon={<CreditCard className="size-4 text-green-400" />}
              title="Conta de crédito (depósito)"
              badge={form.banco_deposito ? `${form.banco_deposito} ag ${form.agencia} cc ${form.conta}` : 'preencher'}
              open={openSec.conta}
              onToggle={() => setOpenSec((p) => ({ ...p, conta: !p.conta }))}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Field label="Banco (código 3 dígitos)" value={form.banco_deposito} onChange={(v) => f('banco_deposito', v)} mono />
                <Field label="Agência" value={form.agencia} onChange={(v) => f('agencia', v.replace(/\D/g, ''))} mono />
                <Field label="Conta" value={form.conta} onChange={(v) => f('conta', v.replace(/\D/g, ''))} mono />
                <Field label="Dígito" value={form.conta_digito} onChange={(v) => f('conta_digito', v)} mono />
                <SelectField label="Tipo conta" value={form.tipo_conta} onChange={(v) => f('tipo_conta', v)} opts={[
                  { value: 'checking', label: 'Corrente' },
                  { value: 'savings', label: 'Poupança' },
                ]} />
              </div>
              <div className="text-[10px] text-muted-foreground mt-2">
                💡 Por padrão usamos a conta onde o cliente recebe o INSS (mais segura — DATAPREV confirma).
              </div>
            </Section>
          </div>
        )}

        <DialogFooter className="flex sm:justify-between gap-2 pt-2 border-t border-border">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mut.isPending}>
            {resultado ? 'Fechar' : 'Cancelar'}
          </Button>
          {!resultado && (
            <Button onClick={digitar} disabled={mut.isPending} className="bg-orange-500 hover:bg-orange-600">
              {mut.isPending ? (
                <><RotateCw className="size-4 animate-spin" /> Digitando na FINANTO...</>
              ) : (
                <><Send className="size-4" /> Digitar agora</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── HELPERS ────────────────────────────────────────────────────────

function Section({
  icon, title, badge, open, onToggle, children,
}: {
  icon: React.ReactNode; title: string; badge?: string;
  open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/30">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-muted/30 transition-colors"
      >
        {open ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
        {icon}
        <span className="font-semibold text-sm">{title}</span>
        {badge && !open && (
          <span className="text-[10px] text-muted-foreground truncate ml-auto max-w-[60%]">{badge}</span>
        )}
      </button>
      {open && <div className="px-3 pb-3 pt-1">{children}</div>}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', mono }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; mono?: boolean;
}) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-0.5 h-8 text-xs ${mono ? 'font-mono' : ''}`}
      />
    </div>
  );
}

function SelectField({ label, value, onChange, opts }: {
  label: string; value: string; onChange: (v: string) => void;
  opts: Array<{ value: string; label: string }>;
}) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 h-8 text-xs w-full rounded-md border border-input bg-transparent px-2"
      >
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function KV({ label, value, cor, mono }: { label: string; value: string; cor?: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-card/50 p-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={`text-sm font-bold mt-0.5 ${cor || 'text-foreground'} ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}
