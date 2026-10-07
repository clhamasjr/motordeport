'use client';

// ════════════════════════════════════════════════════════════════════
// Digitação Baixa Renda (Crefisa) — formulário completo
//
// Abre depois que o operador escolhe um prazo contratável. Coleta tudo
// que a Crefisa exige (cliente, RG, endereço, conta, documentos), sobe
// os documentos como PDF e envia a proposta. Sempre pede confirmação
// antes do envio — isso cria proposta de verdade no banco.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { formatBRL, formatCpf } from '@/lib/utils';
import { montarPdfBase64 } from '@/lib/pdf-montar';
import { useCrefisaCep, useCrefisaUploadDocumento } from '@/hooks/use-crefisa-br';
import { useEnfileirarDigitacao } from '@/hooks/use-crefisa-fila';
import type { DocumentoBR, FluxoBR, RegrasBR, SimulacaoBR } from '@/lib/crefisa-br-types';
import { Loader2, Search, Paperclip, Send, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { toast } from 'sonner';

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

// Limite de corpo da função na Vercel (~4.5MB) já com base64 (+33%)
const MAX_PDF_BYTES = 3.2 * 1024 * 1024;

const selectCls = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';

interface Props {
  cpf: string;
  telefone: string;
  tipoSimulacao: 1 | 2;
  dados: FluxoBR;
  regras: RegrasBR;
  oferta: SimulacaoBR;
  onCancelar: () => void;
  onDigitada: (msg: string) => void;
}

function Campo({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1 ${className}`}>
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

export function DigitacaoForm({ cpf, telefone, tipoSimulacao, dados, regras, oferta, onCancelar, onDigitada }: Props) {
  const cep = useCrefisaCep();
  const upload = useCrefisaUploadDocumento();
  const enfileirar = useEnfileirarDigitacao();

  // ── Cliente ──
  const [nome, setNome] = useState('');
  const [nascimento, setNascimento] = useState('');
  const [sexo, setSexo] = useState('');
  const [estadoCivil, setEstadoCivil] = useState('');
  const [escolaridade, setEscolaridade] = useState('');
  const [nomeMae, setNomeMae] = useState('');
  const [maeNadaConsta, setMaeNadaConsta] = useState(false);
  const [nomePai, setNomePai] = useState('');
  const [email, setEmail] = useState('');
  // ── RG / naturalidade ──
  const [rg, setRg] = useState('');
  const [digitoRg, setDigitoRg] = useState('');
  const [emissaoRg, setEmissaoRg] = useState('');
  const [orgaoRg, setOrgaoRg] = useState('SSP');
  const [ufRg, setUfRg] = useState('SP');
  const [ufNasc, setUfNasc] = useState('SP');
  const [naturalidade, setNaturalidade] = useState('');
  // ── Endereço ──
  const [cepTxt, setCepTxt] = useState('');
  const [logradouro, setLogradouro] = useState('');
  const [numero, setNumero] = useState('');
  const [complemento, setComplemento] = useState('');
  const [bairro, setBairro] = useState('');
  const [cidade, setCidade] = useState('');
  const [uf, setUf] = useState('');
  // ── Conta ──
  const [banco, setBanco] = useState('104'); // Bolsa Família costuma cair na Caixa
  const [agencia, setAgencia] = useState('');
  const [digitoAgencia, setDigitoAgencia] = useState('');
  const [conta, setConta] = useState('');
  const [digitoConta, setDigitoConta] = useState('');
  // ── Documentos ──
  const docsObrig = useMemo(
    () => String(dados.docsObrigatorios || 'RG/CPF;Extrato Bancário').split(';').map((s) => s.trim()).filter(Boolean),
    [dados.docsObrigatorios],
  );
  const [arquivos, setArquivos] = useState<Record<string, File[]>>({});

  const [confirmar, setConfirmar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [etapaEnvio, setEtapaEnvio] = useState('');
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);

  const buscarCep = async () => {
    const r = await cep.mutateAsync(cepTxt).catch(() => null);
    if (!r?.success || !r.endereco) { toast.error(r?.mensagem || 'CEP não encontrado'); return; }
    setLogradouro(r.endereco.logradouro); setBairro(r.endereco.bairro);
    setCidade(r.endereco.cidade); setUf(r.endereco.uf);
  };

  const anexar = (tipo: string, lista: FileList | null) => {
    if (!lista?.length) return;
    setArquivos((prev) => ({ ...prev, [tipo]: [...(prev[tipo] || []), ...Array.from(lista)] }));
  };
  const limparAnexo = (tipo: string) => setArquivos((prev) => ({ ...prev, [tipo]: [] }));

  // Checagem local antes de abrir a confirmação
  const pendencias = (): string[] => {
    const f: string[] = [];
    if (!nome.trim()) f.push('nome');
    if (!nascimento) f.push('nascimento');
    if (!sexo) f.push('sexo');
    if (!estadoCivil) f.push('estado civil');
    if (!escolaridade) f.push('escolaridade');
    if (!maeNadaConsta && !nomeMae.trim()) f.push('nome da mãe');
    if (!rg) f.push('RG');
    if (!emissaoRg) f.push('emissão do RG');
    if (!naturalidade.trim()) f.push('naturalidade');
    if (!cepTxt || !logradouro || !numero || !bairro || !cidade || !uf) f.push('endereço completo');
    if (!agencia || !conta || !digitoConta) f.push('agência/conta');
    docsObrig.forEach((d) => { if (!(arquivos[d] || []).length) f.push(`anexo: ${d}`); });
    return f;
  };

  const abrirConfirmacao = () => {
    const f = pendencias();
    if (f.length) { toast.error(`Faltou: ${f.join(', ')}`); return; }
    setErroEnvio(null);
    setConfirmar(true);
  };

  const enviar = async () => {
    setEnviando(true);
    setErroEnvio(null);
    const guid = crypto.randomUUID();
    try {
      // 1) documentos → PDF → storage da Crefisa
      const documentos: DocumentoBR[] = [];
      const tipos = [...docsObrig, ...((arquivos['Outros'] || []).length ? ['Outros'] : [])];
      for (const tipo of tipos) {
        setEtapaEnvio(`Montando e enviando ${tipo}…`);
        const pdf = await montarPdfBase64(arquivos[tipo] || []);
        if (pdf.bytes > MAX_PDF_BYTES) throw new Error(`${tipo} ficou grande demais (${(pdf.bytes / 1048576).toFixed(1)}MB) — use menos fotos`);
        const r = await upload.mutateAsync({ guid, tipo, base64: pdf.base64 });
        if (!r.success || !r.documento) throw new Error(r.mensagem || `Falha ao enviar ${tipo}`);
        documentos.push(r.documento);
      }

      // 2) proposta entra na FILA — a Crefisa tem uma sessão só, então a
      //    digitação é serial: o worker tira da fila e digita uma de cada vez.
      setEtapaEnvio('Colocando a proposta na fila de digitação…');
      const proposta = {
        cpf,
        guid,
        tipoSimulacao,
        telefone,
        cliente: {
          nome, dataNascimento: nascimento, sexo, estadoCivil, escolaridade,
          nomeMae, nomeMaeNadaConsta: maeNadaConsta, nomePai, nomePaiNadaConsta: !nomePai.trim(),
          email, rg, digitoRg, dataEmissaoRg: emissaoRg, orgaoEmissorRg: orgaoRg,
          ufRg, ufNascimento: ufNasc, naturalidade, autorizaSms: true,
        },
        endereco: { cep: cepTxt, logradouro, numero, complemento, bairro, cidade, uf },
        dadosBancarios: { codigoBanco: Number(banco), agencia, digitoAgencia, contaCorrente: conta, digitoConta },
        operacao: {
          valorPrincipal: oferta.valorSolicitado,
          valorParcela: oferta.valorParcela,
          quantidadeParcelas: oferta.quantidadeParcelas,
        },
        matriculaRenda: dados.matriculaRenda,
        digito: dados.digito,
        dataPagamento: dados.dataPagamento,
        valorRenda: dados.valorBeneficio,
        dataPrimeiraParcela: oferta.dataPrimeiroVencimento,
        docsObrigatorios: docsObrig.join(';'),
        documentos,
      };
      const r = await enfileirar.mutateAsync({
        cpf,
        telefone,
        nomeCliente: nome,
        payload: proposta,
      });
      if (!r.success) throw new Error(r.mensagem || 'Não consegui colocar na fila');
      setConfirmar(false);
      onDigitada(
        r.posicao && r.posicao > 1
          ? `✅ Na fila de digitação — posição ${r.posicao}`
          : '✅ Na fila de digitação — já é a próxima',
      );
    } catch (e) {
      setErroEnvio((e as Error).message);
    } finally {
      setEnviando(false);
      setEtapaEnvio('');
    }
  };

  const tiposAnexo = [...docsObrig, 'Outros'];

  return (
    <div className="space-y-4 rounded-md border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">
          Digitar {formatBRL(oferta.valorSolicitado)} em {oferta.quantidadeParcelas}x de {formatBRL(oferta.valorParcela)}
        </div>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onCancelar}><X className="size-4" /></Button>
      </div>

      {/* ── Cliente ── */}
      <div className="space-y-2">
        <div className="text-[11px] uppercase text-muted-foreground font-medium">Cliente</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Campo label="Nome completo" className="md:col-span-2"><Input value={nome} onChange={(e) => setNome(e.target.value.toUpperCase())} className="h-10" /></Campo>
          <Campo label="Nascimento"><Input type="date" value={nascimento} onChange={(e) => setNascimento(e.target.value)} className="h-10" /></Campo>
          <Campo label="Sexo">
            <select className={selectCls} value={sexo} onChange={(e) => setSexo(e.target.value)}>
              <option value="">Selecione</option><option value="F">Feminino</option><option value="M">Masculino</option>
            </select>
          </Campo>
          <Campo label="Estado civil">
            <select className={selectCls} value={estadoCivil} onChange={(e) => setEstadoCivil(e.target.value)}>
              <option value="">Selecione</option>
              {regras.estadosCivis.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
            </select>
          </Campo>
          <Campo label="Escolaridade">
            <select className={selectCls} value={escolaridade} onChange={(e) => setEscolaridade(e.target.value)}>
              <option value="">Selecione</option>
              {regras.escolaridades.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
            </select>
          </Campo>
          <Campo label="Nome da mãe" className="md:col-span-2">
            <div className="flex items-center gap-2">
              <Input value={nomeMae} disabled={maeNadaConsta} onChange={(e) => setNomeMae(e.target.value.toUpperCase())} className="h-10" />
              <label className="flex items-center gap-1 text-[11px] text-muted-foreground whitespace-nowrap">
                <input type="checkbox" checked={maeNadaConsta} onChange={(e) => setMaeNadaConsta(e.target.checked)} /> nada consta
              </label>
            </div>
          </Campo>
          <Campo label="Nome do pai (opcional)"><Input value={nomePai} onChange={(e) => setNomePai(e.target.value.toUpperCase())} className="h-10" /></Campo>
          <Campo label="E-mail (opcional)" className="md:col-span-3"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" /></Campo>
        </div>
      </div>

      {/* ── RG ── */}
      <div className="space-y-2">
        <div className="text-[11px] uppercase text-muted-foreground font-medium">RG e naturalidade</div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Campo label="RG" className="col-span-2"><Input value={rg} onChange={(e) => setRg(e.target.value.replace(/\D/g, '').slice(0, 13))} inputMode="numeric" className="h-10 font-mono" /></Campo>
          <Campo label="Dígito"><Input value={digitoRg} onChange={(e) => setDigitoRg(e.target.value.replace(/[^\dxX]/g, '').slice(0, 2))} className="h-10 font-mono" /></Campo>
          <Campo label="Emissão"><Input type="date" value={emissaoRg} onChange={(e) => setEmissaoRg(e.target.value)} className="h-10" /></Campo>
          <Campo label="Órgão"><Input value={orgaoRg} onChange={(e) => setOrgaoRg(e.target.value.toUpperCase().slice(0, 10))} className="h-10" /></Campo>
          <Campo label="UF do RG">
            <select className={selectCls} value={ufRg} onChange={(e) => setUfRg(e.target.value)}>{UFS.map((u) => <option key={u}>{u}</option>)}</select>
          </Campo>
          <Campo label="UF nascimento">
            <select className={selectCls} value={ufNasc} onChange={(e) => setUfNasc(e.target.value)}>{UFS.map((u) => <option key={u}>{u}</option>)}</select>
          </Campo>
          <Campo label="Cidade de nascimento" className="col-span-2 md:col-span-3"><Input value={naturalidade} onChange={(e) => setNaturalidade(e.target.value.toUpperCase())} className="h-10" /></Campo>
        </div>
      </div>

      {/* ── Endereço ── */}
      <div className="space-y-2">
        <div className="text-[11px] uppercase text-muted-foreground font-medium">Endereço</div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Campo label="CEP" className="col-span-2">
            <div className="flex gap-1">
              <Input value={cepTxt} onChange={(e) => setCepTxt(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" className="h-10 font-mono" />
              <Button type="button" variant="outline" size="icon" onClick={buscarCep} disabled={cepTxt.length !== 8 || cep.isPending}>
                {cep.isPending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              </Button>
            </div>
          </Campo>
          <Campo label="Logradouro" className="col-span-2 md:col-span-3"><Input value={logradouro} onChange={(e) => setLogradouro(e.target.value.toUpperCase())} className="h-10" /></Campo>
          <Campo label="Número"><Input value={numero} onChange={(e) => setNumero(e.target.value)} className="h-10" /></Campo>
          <Campo label="Complemento" className="col-span-2"><Input value={complemento} onChange={(e) => setComplemento(e.target.value.toUpperCase())} className="h-10" /></Campo>
          <Campo label="Bairro" className="col-span-2"><Input value={bairro} onChange={(e) => setBairro(e.target.value.toUpperCase().slice(0, 35))} className="h-10" /></Campo>
          <Campo label="Cidade"><Input value={cidade} onChange={(e) => setCidade(e.target.value.toUpperCase())} className="h-10" /></Campo>
          <Campo label="UF">
            <select className={selectCls} value={uf} onChange={(e) => setUf(e.target.value)}><option value="">—</option>{UFS.map((u) => <option key={u}>{u}</option>)}</select>
          </Campo>
        </div>
      </div>

      {/* ── Conta ── */}
      <div className="space-y-2">
        <div className="text-[11px] uppercase text-muted-foreground font-medium">Conta pra receber</div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Campo label="Banco (código)" className="col-span-2">
            <Input
              list="bancos-br"
              value={banco}
              onChange={(e) => setBanco(e.target.value.replace(/\D/g, '').slice(0, 3))}
              inputMode="numeric"
              placeholder="104"
              className="h-10 font-mono"
            />
            <datalist id="bancos-br">
              {regras.bancosSugeridos?.map((b) => (
                <option key={b.codigo} value={b.codigo}>{String(b.codigo).padStart(3, '0')} – {b.nome}</option>
              ))}
            </datalist>
          </Campo>
          <Campo label="Agência"><Input value={agencia} onChange={(e) => setAgencia(e.target.value.replace(/\D/g, '').slice(0, 5))} inputMode="numeric" className="h-10 font-mono" /></Campo>
          <Campo label="Díg. ag."><Input value={digitoAgencia} onChange={(e) => setDigitoAgencia(e.target.value.slice(0, 1))} className="h-10 font-mono" /></Campo>
          <Campo label="Conta"><Input value={conta} onChange={(e) => setConta(e.target.value.replace(/\D/g, '').slice(0, 13))} inputMode="numeric" className="h-10 font-mono" /></Campo>
          <Campo label="Díg. conta"><Input value={digitoConta} onChange={(e) => setDigitoConta(e.target.value.slice(0, 2))} className="h-10 font-mono" /></Campo>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Informe o código do banco (ex: 104 = Caixa). Quem valida a conta é a Crefisa, na hora de enviar.
          Conta Caixa Tem vai <b>sem</b> a operação 1288.
        </p>
      </div>

      {/* ── Documentos ── */}
      <div className="space-y-2">
        <div className="text-[11px] uppercase text-muted-foreground font-medium">Documentos (foto ou PDF)</div>
        <div className="rounded-md border border-border overflow-hidden">
          {tiposAnexo.map((tipo) => {
            const lista = arquivos[tipo] || [];
            const obrigatorio = tipo !== 'Outros';
            return (
              <div key={tipo} className="flex items-center justify-between gap-3 py-2 px-3 border-b border-border last:border-b-0">
                <div className="text-xs flex items-center gap-2">
                  {lista.length ? <CheckCircle2 className="size-3.5 text-green-400" /> : <Paperclip className="size-3.5 text-muted-foreground" />}
                  <span className="font-medium">{tipo}</span>
                  {obrigatorio && !lista.length && <span className="text-[10px] text-amber-500">obrigatório</span>}
                  {lista.length > 0 && <span className="text-[10px] text-muted-foreground">{lista.length} arquivo(s)</span>}
                </div>
                <div className="flex items-center gap-1">
                  {lista.length > 0 && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => limparAnexo(tipo)}>limpar</Button>
                  )}
                  <label className="cursor-pointer">
                    <input type="file" multiple accept="image/*,.pdf" className="hidden" onChange={(e) => { anexar(tipo, e.target.files); e.target.value = ''; }} />
                    <span className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-input text-xs hover:bg-secondary/40">
                      <Paperclip className="size-3" /> anexar
                    </span>
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onCancelar}>Cancelar</Button>
        <Button onClick={abrirConfirmacao}><Send className="w-4 h-4" /> Revisar e enviar</Button>
      </div>

      {/* ── Confirmação (cria proposta de verdade) ── */}
      <Dialog open={confirmar} onOpenChange={(v) => { if (!enviando) setConfirmar(v); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar proposta pra fila de digitação</DialogTitle>
            <DialogDescription>A proposta entra na fila e é digitada de verdade na Crefisa, uma de cada vez.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 text-sm">
            <div><span className="text-muted-foreground">Cliente:</span> {nome} — {formatCpf(cpf)}</div>
            <div><span className="text-muted-foreground">Operação:</span> {tipoSimulacao === 1 ? 'NOVO' : 'REFIN'} · {formatBRL(oferta.valorSolicitado)} em {oferta.quantidadeParcelas}x de {formatBRL(oferta.valorParcela)}</div>
            <div><span className="text-muted-foreground">Crédito em:</span> banco {banco}{regras.bancosSugeridos?.find((b) => String(b.codigo) === banco) ? ` (${regras.bancosSugeridos.find((b) => String(b.codigo) === banco)!.nome})` : ''} · ag {agencia}{digitoAgencia ? `-${digitoAgencia}` : ''} · cc {conta}-{digitoConta}</div>
            <div><span className="text-muted-foreground">Documentos:</span> {tiposAnexo.filter((t) => (arquivos[t] || []).length).join(', ')}</div>
          </div>
          {etapaEnvio && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> {etapaEnvio}</div>
          )}
          {erroEnvio && (
            <div className="rounded-md border border-red-500/40 bg-red-500/5 p-2 text-xs text-red-400 flex items-start gap-1.5">
              <AlertCircle className="size-3.5 shrink-0 mt-0.5" /> {erroEnvio}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmar(false)} disabled={enviando}>Voltar</Button>
            <Button onClick={enviar} disabled={enviando}>
              {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Confirmar e enviar pra fila
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
