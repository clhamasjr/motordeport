'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { useCriarConsultaCLT } from '@/hooks/use-clt-fila';
import { Loader2, Search } from 'lucide-react';

interface Props {
  onCreated?: (filaId: string) => void;
}

export function ConsultaForm({ onCreated }: Props) {
  const [cpf, setCpf] = useState('');
  const [nome, setNome] = useState('');
  const [dataNasc, setDataNasc] = useState('');
  const [sexo, setSexo] = useState<'M' | 'F' | ''>('');
  const [tel, setTel] = useState('');

  const { mutate, isPending } = useCriarConsultaCLT();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cpfDigits = cpf.replace(/\D/g, '').padStart(11, '0').slice(-11);
    if (cpfDigits.length !== 11) return;
    mutate(
      {
        cpf: cpfDigits,
        nome: nome.trim() || undefined,
        dataNascimento: dataNasc || undefined,
        sexo: sexo || undefined,
        telefone: tel.replace(/\D/g, '').length >= 10 ? tel.replace(/\D/g, '') : undefined,
      },
      {
        onSuccess: (data) => {
          if (data.success && data.id) {
            onCreated?.(data.id);
            setCpf('');
            setNome('');
            setDataNasc('');
            setSexo('');
            setTel('');
          }
        },
      },
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-[2fr_3fr_auto] gap-3">
            <Input
              placeholder="CPF (só números)"
              maxLength={14}
              value={cpf}
              onChange={(e) => setCpf(e.target.value)}
              autoFocus
              disabled={isPending}
              className="h-11 text-base"
            />
            <Input
              placeholder="Nome completo (opcional)"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              disabled={isPending}
              className="h-11 text-base"
            />
            <Button type="submit" disabled={isPending} className="h-11 px-6">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Consultar
            </Button>
          </div>

          {/* Linha 2 — campos opcionais que destravam mais bancos */}
          <div className="flex flex-wrap gap-2 items-center text-xs">
            <Label className="text-muted-foreground uppercase tracking-wider">Caso falte:</Label>
            <Input
              type="date"
              placeholder="Data nasc"
              value={dataNasc}
              onChange={(e) => setDataNasc(e.target.value)}
              disabled={isPending}
              className="h-9 flex-1 min-w-[140px]"
            />
            <select
              value={sexo}
              onChange={(e) => setSexo(e.target.value as 'M' | 'F' | '')}
              disabled={isPending}
              className="h-9 px-3 text-sm rounded-md border border-input bg-background"
            >
              <option value="">Sexo</option>
              <option value="M">Masculino</option>
              <option value="F">Feminino</option>
            </select>
            <Input
              type="tel"
              inputMode="numeric"
              placeholder="📱 Celular (DDD+9)"
              maxLength={11}
              value={tel}
              onChange={(e) => setTel(e.target.value.replace(/\D/g, ''))}
              disabled={isPending}
              className="h-9 flex-1 min-w-[170px]"
            />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
