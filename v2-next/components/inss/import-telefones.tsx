'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useInssBaseStore } from '@/hooks/use-inss-base-store';
import { Upload, Phone, AlertCircle, CheckCircle2, X, FileText } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Importa telefones via XLSX/CSV.
 * Aceita planilha com colunas (case-insensitive, qualquer ordem):
 *   - CPF (obrigatória) — aceita com pontuação ou só dígitos
 *   - Tel1 / Telefone1 / Telefone / Celular (pelo menos 1)
 *   - Tel2 / Telefone2 (opcional)
 *   - Tel3 / Telefone3 (opcional)
 *
 * Casa CPF→telefones e atualiza todos os contratos da base com mesmo CPF.
 */
export function ImportTelefonesButton() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{ cpf: string; t1?: string; t2?: string; t3?: string }[] | null>(null);
  const [fname, setFname] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { importTelefones, base } = useInssBaseStore();

  function normalize(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  }
  function findCol(header: string[], names: string[]): number {
    for (const nm of names) {
      const n = normalize(nm);
      for (let i = 0; i < header.length; i++) {
        const h = normalize(String(header[i] || ''));
        if (h === n) return i;
      }
    }
    return -1;
  }
  function cleanTel(v: unknown): string {
    if (!v) return '';
    return String(v).replace(/\D/g, '');
  }

  async function handleFile(file: File) {
    setLoading(true);
    setErro(null);
    setFname(file.name);
    setPreview(null);
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
      if (!data || data.length < 2) throw new Error('Planilha vazia ou sem cabeçalho.');
      const header = data[0].map((h) => (h ? String(h).trim() : ''));
      const cCpf = findCol(header, ['CPF', 'Cpf', 'CPF do Cliente']);
      const cT1 = findCol(header, ['Tel1', 'Telefone1', 'Telefone 1', 'Telefone', 'Celular', 'Celular 1']);
      const cT2 = findCol(header, ['Tel2', 'Telefone2', 'Telefone 2', 'Celular 2']);
      const cT3 = findCol(header, ['Tel3', 'Telefone3', 'Telefone 3', 'Celular 3']);
      if (cCpf < 0) throw new Error('Coluna CPF não encontrada. Adicione cabeçalho "CPF" na primeira linha.');
      if (cT1 < 0 && cT2 < 0 && cT3 < 0) {
        throw new Error('Nenhuma coluna de telefone encontrada. Use "Telefone1", "Tel1", "Celular" ou similar.');
      }

      const rows = data.slice(1);
      const items: { cpf: string; t1?: string; t2?: string; t3?: string }[] = [];
      for (const r of rows) {
        const cpfRaw = String(r[cCpf] || '').replace(/\D/g, '');
        if (!cpfRaw || cpfRaw.length < 9) continue;
        const cpf = cpfRaw.padStart(11, '0');
        const t1 = cT1 >= 0 ? cleanTel(r[cT1]) : '';
        const t2 = cT2 >= 0 ? cleanTel(r[cT2]) : '';
        const t3 = cT3 >= 0 ? cleanTel(r[cT3]) : '';
        if (!t1 && !t2 && !t3) continue;
        items.push({ cpf, t1: t1 || undefined, t2: t2 || undefined, t3: t3 || undefined });
      }
      if (items.length === 0) throw new Error('Nenhuma linha válida (CPF + telefone) encontrada.');
      setPreview(items);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao processar planilha');
    } finally {
      setLoading(false);
    }
  }

  function confirmar() {
    if (!preview) return;
    const mapa: Record<string, { t1?: string; t2?: string; t3?: string }> = {};
    for (const it of preview) mapa[it.cpf] = { t1: it.t1, t2: it.t2, t3: it.t3 };
    const n = importTelefones(mapa);
    if (n > 0) {
      toast.success(`Telefones importados em ${n} contrato(s).`);
    } else {
      toast.warning('Nenhum contrato da base bateu com os CPFs da planilha.');
    }
    setOpen(false);
    setPreview(null);
    setFname('');
  }

  function fechar() {
    setOpen(false);
    setPreview(null);
    setFname('');
    setErro(null);
  }

  const disabled = !base || !base.elegiveis.length;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? 'Carregue uma base primeiro' : 'Importar telefones via XLSX/CSV'}
        className="border-green-500/40 text-green-300 hover:bg-green-500/10"
      >
        <Phone className="size-4" />
        Importar telefones
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (!v) fechar(); else setOpen(true); }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Phone className="size-5 text-green-400" />
              Importar telefones
            </DialogTitle>
            <DialogDescription>
              Suba uma planilha (.xlsx / .csv) com colunas <strong>CPF</strong> + <strong>Tel1</strong> (e opcional Tel2, Tel3).
              Os telefones serão casados pelo CPF e atualizados em todos os contratos do cliente.
            </DialogDescription>
          </DialogHeader>

          {/* Upload */}
          {!preview && !loading && (
            <div
              className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:bg-muted/30"
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="size-10 mx-auto mb-2 text-muted-foreground/50" />
              <div className="font-semibold">Selecionar planilha</div>
              <div className="text-xs text-muted-foreground mt-1">.xlsx, .xls ou .csv</div>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                className="hidden"
              />
            </div>
          )}

          {loading && (
            <div className="text-center py-8">
              <div className="text-2xl mb-2 animate-pulse">⏳</div>
              <div className="text-sm text-muted-foreground">Lendo planilha...</div>
            </div>
          )}

          {erro && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 flex items-start gap-2">
              <AlertCircle className="size-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-red-400 text-sm">Erro ao processar</div>
                <div className="text-xs text-foreground mt-0.5">{erro}</div>
              </div>
            </div>
          )}

          {/* Preview */}
          {preview && (
            <div className="space-y-2">
              <div className="rounded-md border border-green-500/40 bg-green-500/5 p-3 flex items-center gap-2">
                <CheckCircle2 className="size-5 text-green-400 shrink-0" />
                <div className="flex-1">
                  <div className="font-semibold text-sm text-green-400">
                    {preview.length} CPF(s) prontos pra importar
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <FileText className="size-3" /> {fname}
                  </div>
                </div>
              </div>
              <div className="rounded-md border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className="text-left p-2 font-semibold">CPF</th>
                      <th className="text-left p-2 font-semibold">Tel 1</th>
                      <th className="text-left p-2 font-semibold">Tel 2</th>
                      <th className="text-left p-2 font-semibold">Tel 3</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {preview.slice(0, 10).map((it, i) => (
                      <tr key={i}>
                        <td className="p-2 font-mono">{it.cpf}</td>
                        <td className="p-2 font-mono">{it.t1 || '—'}</td>
                        <td className="p-2 font-mono">{it.t2 || '—'}</td>
                        <td className="p-2 font-mono">{it.t3 || '—'}</td>
                      </tr>
                    ))}
                    {preview.length > 10 && (
                      <tr><td colSpan={4} className="p-2 text-center text-muted-foreground italic">
                        ... e mais {preview.length - 10} linha(s)
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <Badge variant="muted" className="text-[10px]">
                Telefones serão atualizados em todos os contratos da base com mesmo CPF
              </Badge>
            </div>
          )}

          <DialogFooter className="flex sm:justify-between gap-2">
            <div>
              {preview && (
                <Button variant="outline" size="sm" onClick={() => { setPreview(null); setFname(''); }}>
                  <X className="size-3.5" />
                  Outra planilha
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={fechar}>Cancelar</Button>
              {preview && (
                <Button onClick={confirmar} className="bg-green-600 hover:bg-green-700">
                  <CheckCircle2 className="size-4" />
                  Importar {preview.length} CPF(s)
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
