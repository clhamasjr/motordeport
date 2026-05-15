'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatCpf } from '@/lib/utils';
import { useConsultaInss } from '@/hooks/use-inss-consulta';
import { Search } from 'lucide-react';
import { ConsultaInssView } from '@/lib/inss-types';

interface Props {
  onResult: (cpf: string, view: ConsultaInssView) => void;
}

export function ConsultaForm({ onResult }: Props) {
  const [cpf, setCpf] = useState('');
  const mut = useConsultaInss();

  const cpfClean = cpf.replace(/\D/g, '');
  const cpfValido = cpfClean.length === 11;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cpfValido) return;
    try {
      const view = await mut.mutateAsync(cpfClean);
      onResult(cpfClean, view);
    } catch {
      // toast já tratado no hook
    }
  }

  return (
    <Card>
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <Label htmlFor="inss-cpf" className="text-xs uppercase tracking-wider text-muted-foreground">
              CPF do beneficiário
            </Label>
            <Input
              id="inss-cpf"
              autoFocus
              placeholder="000.000.000-00"
              value={cpfClean ? formatCpf(cpfClean) : cpf}
              onChange={(e) => setCpf(e.target.value)}
              maxLength={14}
              className="font-mono mt-1"
            />
          </div>
          <Button type="submit" disabled={!cpfValido || mut.isPending}>
            <Search className="size-4" />
            {mut.isPending ? 'Consultando...' : 'Consultar'}
          </Button>
        </form>
        <p className="text-[10px] text-muted-foreground mt-2">
          Consulta direto no Multicorban. Pode levar 5-15s na primeira consulta (login do scraper).
        </p>
      </CardContent>
    </Card>
  );
}
