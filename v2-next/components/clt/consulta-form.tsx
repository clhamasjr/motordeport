'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { useCriarConsultaCLT, usePrecheckCpf } from '@/hooks/use-clt-fila';
import { Loader2, Search, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  onCreated?: (filaId: string) => void;
}

// Fluxo:
//  1. Operador digita CPF e clica "Consultar"
//  2. precheck verifica se as bases têm nome + dataNasc + telefone
//  3a. Se tem tudo → cria a consulta direto
//  3b. Se falta algo → abre os campos obrigatórios (pré-preenchidos com o
//      que já existe) e OBRIGA o operador a completar antes de seguir.
export function ConsultaForm({ onCreated }: Props) {
  const [cpf, setCpf] = useState('');
  const [nome, setNome] = useState('');
  const [dataNasc, setDataNasc] = useState('');
  const [sexo, setSexo] = useState<'M' | 'F' | ''>('');
  const [tel, setTel] = useState('');

  // Quando precheck diz que faltam dados, abre o bloco obrigatório.
  const [exigirDados, setExigirDados] = useState(false);
  const [faltam, setFaltam] = useState<string[]>([]);

  const precheck = usePrecheckCpf();
  const criar = useCriarConsultaCLT();
  const isPending = precheck.isPending || criar.isPending;

  function resetForm() {
    setCpf(''); setNome(''); setDataNasc(''); setSexo(''); setTel('');
    setExigirDados(false); setFaltam([]);
  }

  function dispararCriacao(cpfDigits: string) {
    criar.mutate(
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
            resetForm();
          }
        },
      },
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cpfDigits = cpf.replace(/\D/g, '').padStart(11, '0').slice(-11);
    if (cpfDigits.length !== 11) {
      toast.error('CPF inválido');
      return;
    }

    // Se o bloco obrigatório já está aberto, valida e cria.
    if (exigirDados) {
      const faltando: string[] = [];
      if (!nome.trim()) faltando.push('nome');
      if (!dataNasc) faltando.push('data de nascimento');
      if (tel.replace(/\D/g, '').length < 10) faltando.push('telefone');
      if (faltando.length > 0) {
        toast.error(`Preencha: ${faltando.join(', ')}`);
        return;
      }
      dispararCriacao(cpfDigits);
      return;
    }

    // 1ª etapa: precheck nas bases
    const r = await precheck.mutateAsync(cpfDigits).catch(() => null);
    if (!r) {
      toast.error('Erro ao verificar CPF — tente de novo');
      return;
    }

    // Pré-preenche com o que veio das bases
    if (r.dados.nome) setNome(r.dados.nome);
    if (r.dados.dataNascimento) setDataNasc(r.dados.dataNascimento);
    if (r.dados.sexo) setSexo(r.dados.sexo);
    if (r.dados.telefone) setTel(r.dados.telefone);

    if (r.completo) {
      // Tem tudo nas bases → segue direto
      dispararCriacao(cpfDigits);
    } else {
      // Falta dado → obriga o operador a completar
      setExigirDados(true);
      setFaltam(r.faltam);
      toast.warning('Bases não trouxeram todos os dados — preencha os campos abaixo pra continuar');
    }
  }

  const precisa = (campo: string) => exigirDados && faltam.includes(campo);

  return (
    <Card>
      <CardContent className="p-4">
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-[2fr_auto] gap-3">
            <Input
              placeholder="CPF (só números)"
              maxLength={14}
              value={cpf}
              onChange={(e) => {
                setCpf(e.target.value);
                // Se mudou o CPF, reseta o estado de "exigir dados"
                if (exigirDados) { setExigirDados(false); setFaltam([]); }
              }}
              autoFocus
              disabled={isPending}
              className="h-11 text-base"
            />
            <Button type="submit" disabled={isPending} className="h-11 px-6">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {exigirDados ? 'Continuar' : 'Consultar'}
            </Button>
          </div>

          {/* Bloco obrigatório — só aparece quando as bases não trouxeram tudo */}
          {exigirDados && (
            <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
              <div className="flex items-center gap-2 text-xs text-amber-500 font-medium">
                <AlertCircle className="w-3.5 h-3.5" />
                Dados não encontrados nas bases — preencha pra continuar
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">
                    Nome completo {precisa('nome') && <span className="text-amber-500">*</span>}
                  </Label>
                  <Input
                    placeholder="Nome completo"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    disabled={isPending}
                    className="h-10"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">
                    Data de nascimento {precisa('dataNascimento') && <span className="text-amber-500">*</span>}
                  </Label>
                  <Input
                    type="date"
                    value={dataNasc}
                    onChange={(e) => setDataNasc(e.target.value)}
                    disabled={isPending}
                    className="h-10"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">
                    Telefone {precisa('telefone') && <span className="text-amber-500">*</span>}
                  </Label>
                  <Input
                    type="tel"
                    inputMode="numeric"
                    placeholder="DDD + número (ex: 15998583505)"
                    maxLength={11}
                    value={tel}
                    onChange={(e) => setTel(e.target.value.replace(/\D/g, ''))}
                    disabled={isPending}
                    className="h-10"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Sexo</Label>
                  <select
                    value={sexo}
                    onChange={(e) => setSexo(e.target.value as 'M' | 'F' | '')}
                    disabled={isPending}
                    className="h-10 w-full px-3 text-sm rounded-md border border-input bg-background"
                  >
                    <option value="">Sexo</option>
                    <option value="M">Masculino</option>
                    <option value="F">Feminino</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
