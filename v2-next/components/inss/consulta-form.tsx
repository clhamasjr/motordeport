'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { formatCpf } from '@/lib/utils';
import { useConsultaInss, useConsultaBeneficio } from '@/hooks/use-inss-consulta';
import { Search, IdCard, Banknote } from 'lucide-react';
import { ConsultaInssView, InssBenefListItem } from '@/lib/inss-types';

interface Props {
  onResult: (cpfOuNb: string, view: ConsultaInssView) => void;
}

type Modo = 'cpf' | 'beneficio';

export function ConsultaForm({ onResult }: Props) {
  const [modo, setModo] = useState<Modo>('cpf');
  // raw = só dígitos. Preserva zeros à esquerda.
  const [raw, setRaw] = useState('');
  const [listaBenef, setListaBenef] = useState<{
    cpf: string;
    itens: InssBenefListItem[];
  } | null>(null);
  const mutCpf = useConsultaInss();
  const mutBenef = useConsultaBeneficio();

  const cpfValido = modo === 'cpf' && raw.length === 11;
  // Benefícios INSS têm 10 dígitos (com DV). Aceita 9-11.
  const benefValido = modo === 'beneficio' && raw.length >= 8 && raw.length <= 11;
  const podeConsultar = cpfValido || benefValido;
  const carregando = mutCpf.isPending || mutBenef.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!podeConsultar) return;
    try {
      if (modo === 'cpf') {
        const view = await mutCpf.mutateAsync(raw);
        // Se a API retornar lista (múltiplos benefícios) sem auto-seleção, mostra seletor
        if (view.lista && view.lista.length > 1 && !view.auto_selected) {
          setListaBenef({ cpf: raw, itens: view.lista });
          return;
        }
        onResult(raw, view);
      } else {
        const view = await mutBenef.mutateAsync(raw);
        onResult(raw, view);
      }
    } catch {
      // toast tratado no hook
    }
  }

  async function escolherBeneficio(nb: string) {
    try {
      const view = await mutBenef.mutateAsync(nb);
      onResult(listaBenef?.cpf || nb, view);
      setListaBenef(null);
    } catch {
      // toast tratado no hook
    }
  }

  // Display: CPF formatado quando 11 dígitos; senão mostra raw (com zeros)
  const displayValue =
    modo === 'cpf' && raw.length === 11 ? formatCpf(raw) : raw;

  return (
    <>
      <Card>
        <CardContent className="p-4">
          {/* Toggle CPF / Benefício */}
          <div className="flex items-center gap-2 mb-3">
            <button
              type="button"
              onClick={() => { setModo('cpf'); setRaw(''); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                modo === 'cpf'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'bg-muted/30 text-muted-foreground hover:bg-muted/50 border border-transparent'
              }`}
            >
              <IdCard className="size-3.5" /> CPF
            </button>
            <button
              type="button"
              onClick={() => { setModo('beneficio'); setRaw(''); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                modo === 'beneficio'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'bg-muted/30 text-muted-foreground hover:bg-muted/50 border border-transparent'
              }`}
            >
              <Banknote className="size-3.5" /> Nº Benefício
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <Label htmlFor="inss-input" className="text-xs uppercase tracking-wider text-muted-foreground">
                {modo === 'cpf' ? 'CPF do beneficiário' : 'Nº do benefício'}
              </Label>
              <Input
                id="inss-input"
                autoFocus
                placeholder={modo === 'cpf' ? '000.000.000-00' : '000.000.000-0'}
                value={displayValue}
                onChange={(e) => {
                  // Mantém apenas dígitos preservando zeros à esquerda
                  const digits = e.target.value.replace(/\D/g, '');
                  setRaw(digits.slice(0, modo === 'cpf' ? 11 : 11));
                }}
                inputMode="numeric"
                maxLength={modo === 'cpf' ? 14 : 14}
                className="font-mono mt-1"
              />
            </div>
            <Button type="submit" disabled={!podeConsultar || carregando}>
              <Search className="size-4" />
              {carregando ? 'Consultando...' : 'Consultar'}
            </Button>
          </form>
          <p className="text-[10px] text-muted-foreground mt-2">
            Consulta direta no INSS. Pode levar 5-15s na primeira consulta.
            {modo === 'cpf'
              ? ' Se o CPF tiver mais de 1 benefício, você poderá escolher qual abrir.'
              : ' Use o nº do benefício pra abrir direto (sem listagem).'}
          </p>
        </CardContent>
      </Card>

      {/* Modal de seleção de benefício */}
      {listaBenef && (
        <Card className="border-cyan-500/40 bg-cyan-500/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="font-bold text-sm">
                  CPF <span className="font-mono">{formatCpf(listaBenef.cpf)}</span> tem {listaBenef.itens.length} benefícios
                </h3>
                <p className="text-xs text-muted-foreground">
                  Escolha qual abrir:
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setListaBenef(null)}>
                Cancelar
              </Button>
            </div>
            <div className="grid gap-2">
              {listaBenef.itens.map((it, i) => {
                const nb = (it.nb || '').replace(/\D/g, '');
                return (
                  <button
                    key={`${nb}-${i}`}
                    type="button"
                    onClick={() => nb && escolherBeneficio(nb)}
                    disabled={!nb || carregando}
                    className="text-left rounded-md border border-border bg-card/50 p-3 hover:border-cyan-500/60 hover:bg-cyan-500/5 transition disabled:opacity-60"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-bold">{it.nb || '(s/ nº)'}</span>
                      {it.especie && (
                        <Badge variant="muted" className="text-[10px]">{it.especie}</Badge>
                      )}
                      {it.situacao && (
                        <Badge
                          variant={it.situacao === 'ATIVO' ? 'success' : 'warning'}
                          className="text-[10px]"
                        >
                          {it.situacao}
                        </Badge>
                      )}
                    </div>
                    {it.nome && (
                      <div className="text-[11px] text-muted-foreground mt-1">{it.nome}</div>
                    )}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
