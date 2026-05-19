'use client';

import { useState } from 'react';
import { Parceiro } from '@/lib/admin-types';
import { useCreateParceiro, useUpdateParceiro } from '@/hooks/use-admin-parceiros';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';

/**
 * Modal de criar/editar perfil de parceiro.
 * Usado em /admin/parceiros (cadastro/edicao direta) e em /admin/usuarios
 * (atalho pra editar perfil do parceiro vinculado ao user).
 *
 * Campos: identificacao (nome, cnpj), contato (responsavel, tel, email),
 * endereco (logradouro, cidade, uf), comercial (comissao_padrao, observacoes).
 */
export function ParceiroModal({
  open,
  onClose,
  parceiro,
}: {
  open: boolean;
  onClose: () => void;
  parceiro: Parceiro | null;
}) {
  const isEdit = !!parceiro;
  const [nome, setNome] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [endereco, setEndereco] = useState('');
  const [cidade, setCidade] = useState('');
  const [uf, setUf] = useState('');
  const [comissao, setComissao] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const create = useCreateParceiro();
  const update = useUpdateParceiro();

  const handleOpenChange = (o: boolean) => {
    if (o) {
      setNome(parceiro?.nome || '');
      setCnpj(parceiro?.cnpj || '');
      setResponsavel(parceiro?.responsavel || '');
      setTelefone(parceiro?.telefone || '');
      setEmail(parceiro?.email || '');
      setEndereco(parceiro?.endereco || '');
      setCidade(parceiro?.cidade || '');
      setUf(parceiro?.uf || '');
      setComissao(parceiro?.comissao_padrao != null ? String(parceiro.comissao_padrao) : '');
      setObservacoes(parceiro?.observacoes || '');
    } else {
      onClose();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) return;
    const comissaoNum = comissao.trim() ? Number(comissao.replace(',', '.')) : null;
    try {
      if (isEdit && parceiro) {
        await update.mutateAsync({
          parceiroId: parceiro.id,
          nome: nome.trim(),
          cnpj: cnpj.trim() || null,
          responsavel: responsavel.trim() || null,
          telefone: telefone.trim() || null,
          email: email.trim() || null,
          endereco: endereco.trim() || null,
          cidade: cidade.trim() || null,
          uf: uf.trim() || null,
          comissao_padrao: comissaoNum,
          observacoes: observacoes.trim() || null,
        });
      } else {
        await create.mutateAsync({
          nome: nome.trim(),
          cnpj: cnpj.trim() || undefined,
          responsavel: responsavel.trim() || undefined,
          telefone: telefone.trim() || undefined,
          email: email.trim() || undefined,
          endereco: endereco.trim() || undefined,
          cidade: cidade.trim() || undefined,
          uf: uf.trim() || undefined,
          comissao_padrao: comissaoNum ?? undefined,
          observacoes: observacoes.trim() || undefined,
        });
      }
      onClose();
    } catch {
      // toast no hook
    }
  };

  const loading = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Editar parceiro: ${parceiro?.nome}` : 'Novo parceiro'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Atualize os dados da agência/correspondente.' : 'Cadastre uma nova agência/correspondente.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* ─── Identificação ─── */}
          <div className="space-y-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Identificação</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <Label htmlFor="parc-nome">Nome *</Label>
                <Input
                  id="parc-nome"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="LhamasCred"
                  autoFocus
                  required
                />
              </div>
              <div>
                <Label htmlFor="parc-cnpj">CNPJ</Label>
                <Input
                  id="parc-cnpj"
                  value={cnpj}
                  onChange={(e) => setCnpj(e.target.value)}
                  placeholder="00.000.000/0000-00"
                  className="font-mono"
                />
              </div>
            </div>
          </div>

          {/* ─── Contato ─── */}
          <div className="space-y-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Contato</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="parc-resp">Responsável</Label>
                <Input
                  id="parc-resp"
                  value={responsavel}
                  onChange={(e) => setResponsavel(e.target.value)}
                  placeholder="Quem responde pelo parceiro"
                />
              </div>
              <div>
                <Label htmlFor="parc-tel">Telefone / WhatsApp</Label>
                <Input
                  id="parc-tel"
                  value={telefone}
                  onChange={(e) => setTelefone(e.target.value)}
                  placeholder="15998583505"
                  className="font-mono"
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="parc-email">E-mail</Label>
                <Input
                  id="parc-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="contato@parceiro.com.br"
                />
              </div>
            </div>
          </div>

          {/* ─── Endereço ─── */}
          <div className="space-y-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Endereço</div>
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
              <div className="sm:col-span-6">
                <Label htmlFor="parc-end">Logradouro</Label>
                <Input
                  id="parc-end"
                  value={endereco}
                  onChange={(e) => setEndereco(e.target.value)}
                  placeholder="Rua, número, complemento"
                />
              </div>
              <div className="sm:col-span-5">
                <Label htmlFor="parc-cidade">Cidade</Label>
                <Input
                  id="parc-cidade"
                  value={cidade}
                  onChange={(e) => setCidade(e.target.value)}
                  placeholder="Sorocaba"
                />
              </div>
              <div>
                <Label htmlFor="parc-uf">UF</Label>
                <Input
                  id="parc-uf"
                  value={uf}
                  onChange={(e) => setUf(e.target.value.toUpperCase().slice(0, 2))}
                  maxLength={2}
                  placeholder="SP"
                  className="font-mono uppercase"
                />
              </div>
            </div>
          </div>

          {/* ─── Comercial ─── */}
          <div className="space-y-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Comercial</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label htmlFor="parc-comissao">Comissão padrão (%)</Label>
                <Input
                  id="parc-comissao"
                  type="text"
                  inputMode="decimal"
                  value={comissao}
                  onChange={(e) => setComissao(e.target.value.replace(/[^0-9.,]/g, ''))}
                  placeholder="ex: 1.5"
                  className="font-mono"
                />
              </div>
              <div className="sm:col-span-3">
                <Label htmlFor="parc-obs">Observações</Label>
                <textarea
                  id="parc-obs"
                  value={observacoes}
                  onChange={(e) => setObservacoes(e.target.value)}
                  rows={3}
                  placeholder="Notas internas sobre esse parceiro — vencimento de contrato, particularidades, etc."
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!nome.trim() || loading}>
              {loading ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Criar parceiro'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
