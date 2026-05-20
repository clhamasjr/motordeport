'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BancoConvenio, Banco } from '@/lib/gov-types';
import { useUpsertBancoConvenio, useUpsertBanco } from '@/hooks/use-gov-admin';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onClose: () => void;
  convenioId: number;
  bancosCatalogo: Banco[];
  /** Se null = criando novo, senão = editando */
  banco: BancoConvenio | null;
}

interface FormState {
  banco_id: number | '';
  banco_novo_nome: string;
  opera_novo: boolean;
  opera_refin: boolean;
  opera_port: boolean;
  opera_cartao: boolean;
  suspenso: boolean;
  margem_utilizavel: string;
  idade_min: string;
  idade_max: string;
  taxa_minima_port: string;
  data_corte: string;
  valor_minimo: string;
  qtd_contratos: string;
}

function emptyForm(): FormState {
  return {
    banco_id: '',
    banco_novo_nome: '',
    opera_novo: false, opera_refin: false, opera_port: false, opera_cartao: false,
    suspenso: false,
    margem_utilizavel: '', idade_min: '', idade_max: '', taxa_minima_port: '',
    data_corte: '', valor_minimo: '', qtd_contratos: '',
  };
}

function fromBanco(b: BancoConvenio): FormState {
  return {
    banco_id: b.banco_id,
    banco_novo_nome: '',
    opera_novo: !!b.operacoes?.novo,
    opera_refin: !!b.operacoes?.refin,
    opera_port: !!b.operacoes?.port,
    opera_cartao: !!b.operacoes?.cartao,
    suspenso: !!b.suspenso,
    margem_utilizavel: b.margem_utilizavel == null ? '' : String(b.margem_utilizavel),
    idade_min: b.idade_min == null ? '' : String(b.idade_min),
    idade_max: b.idade_max == null ? '' : String(b.idade_max),
    taxa_minima_port: b.taxa_minima_port == null ? '' : String(b.taxa_minima_port),
    data_corte: b.data_corte || '',
    valor_minimo: b.valor_minimo || '',
    qtd_contratos: b.qtd_contratos || '',
  };
}

export function ModalEditarBanco({ open, onClose, convenioId, bancosCatalogo, banco }: Props) {
  const novo = banco === null;
  const [form, setForm] = useState<FormState>(() => banco ? fromBanco(banco) : emptyForm());
  const upsertBC = useUpsertBancoConvenio();
  const upsertB = useUpsertBanco();
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(s => ({ ...s, [k]: v }));

  const handleOpenChange = (o: boolean) => {
    if (!o) onClose();
  };

  const salvar = async () => {
    let bancoId = form.banco_id;
    if (novo) {
      if (form.banco_novo_nome.trim()) {
        try {
          const r = await upsertB.mutateAsync({ nome: form.banco_novo_nome.trim() });
          if (r.banco?.id) bancoId = r.banco.id;
        } catch (e) {
          toast.error('Erro ao criar banco: ' + (e as Error).message);
          return;
        }
      }
      if (!bancoId) {
        toast.error('Selecione um banco existente OU digite o nome de um novo');
        return;
      }
    }
    try {
      await upsertBC.mutateAsync({
        id: banco?.id,
        banco_id: bancoId as number,
        convenio_id: convenioId,
        opera_novo: form.opera_novo,
        opera_refin: form.opera_refin,
        opera_port: form.opera_port,
        opera_cartao: form.opera_cartao,
        suspenso: form.suspenso,
        margem_utilizavel: form.margem_utilizavel === '' ? null : form.margem_utilizavel,
        idade_min: form.idade_min === '' ? null : form.idade_min,
        idade_max: form.idade_max === '' ? null : form.idade_max,
        taxa_minima_port: form.taxa_minima_port === '' ? null : form.taxa_minima_port,
        data_corte: form.data_corte || null,
        valor_minimo: form.valor_minimo || null,
        qtd_contratos: form.qtd_contratos || null,
      });
      onClose();
    } catch {
      /* toast ja foi pelo hook */
    }
  };

  const bancoNomeAtual = !novo
    ? (bancosCatalogo.find(b => b.id === form.banco_id)?.nome || banco?.banco_nome || '?')
    : '';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{novo ? '➕ Adicionar Banco' : '✏️ Editar Banco'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Banco */}
          {novo ? (
            <div className="space-y-2">
              <div>
                <Label className="text-[11px] uppercase font-bold text-muted-foreground">Banco existente</Label>
                <select
                  value={form.banco_id}
                  onChange={(e) => set('banco_id', e.target.value ? Number(e.target.value) : '')}
                  className="w-full mt-1 px-3 py-2 rounded-md border border-input bg-background text-sm"
                >
                  <option value="">— selecione ou digite novo abaixo —</option>
                  {bancosCatalogo.map(b => (
                    <option key={b.id} value={b.id}>{b.nome}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-[11px] uppercase font-bold text-muted-foreground">OU novo banco (digite o nome)</Label>
                <Input
                  value={form.banco_novo_nome}
                  onChange={(e) => set('banco_novo_nome', e.target.value)}
                  placeholder="Nome do novo banco"
                  className="mt-1"
                />
              </div>
            </div>
          ) : (
            <div className="rounded-md bg-secondary/30 p-3 text-sm">
              Banco: <b>{bancoNomeAtual}</b>
            </div>
          )}

          {/* Operacoes */}
          <div>
            <Label className="text-[11px] uppercase font-bold text-muted-foreground block mb-2">Operações</Label>
            <div className="flex gap-4 flex-wrap">
              {([
                ['opera_novo', 'Novo'],
                ['opera_refin', 'Refin'],
                ['opera_port', 'Port'],
                ['opera_cartao', 'Cartão'],
              ] as const).map(([k, lab]) => (
                <label key={k} className="flex items-center gap-1.5 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={form[k]}
                    onChange={(e) => set(k, e.target.checked)}
                    className="rounded"
                  />
                  {lab}
                </label>
              ))}
            </div>
          </div>

          {/* Suspenso */}
          <label className="flex items-center gap-1.5 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={form.suspenso}
              onChange={(e) => set('suspenso', e.target.checked)}
              className="rounded"
            />
            <span className="font-bold">⛔ Suspenso</span>
          </label>

          {/* Campos numericos/texto */}
          <div className="grid grid-cols-2 gap-3">
            {([
              ['margem_utilizavel', 'Margem (decimal, ex 0.35)', '0.35'],
              ['taxa_minima_port', 'Taxa Port (decimal, ex 0.0185)', '0.0185'],
              ['idade_min', 'Idade mín', '21'],
              ['idade_max', 'Idade máx', '75'],
              ['data_corte', 'Data de corte', 'Dia 02'],
              ['valor_minimo', 'Valor mínimo', 'R$ 250'],
            ] as const).map(([k, lab, ph]) => (
              <div key={k}>
                <Label className="text-[11px] uppercase font-bold text-muted-foreground">{lab}</Label>
                <Input
                  value={form[k]}
                  onChange={(e) => set(k, e.target.value)}
                  placeholder={ph}
                  className="mt-1"
                />
              </div>
            ))}
          </div>

          <div>
            <Label className="text-[11px] uppercase font-bold text-muted-foreground">Qtde contratos</Label>
            <Input
              value={form.qtd_contratos}
              onChange={(e) => set('qtd_contratos', e.target.value)}
              placeholder="Livre / 10 contratos / margem"
              className="mt-1"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={upsertBC.isPending || upsertB.isPending}>
            {upsertBC.isPending ? 'Salvando…' : '💾 Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
