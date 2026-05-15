'use client';

import { useMemo, useState } from 'react';
import {
  useAdminParceiros,
  useCreateParceiro,
  useUpdateParceiro,
  useToggleParceiroActive,
  useDeleteParceiro,
} from '@/hooks/use-admin-parceiros';
import { useAdminUsers } from '@/hooks/use-admin-users';
import { Parceiro } from '@/lib/admin-types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Building2,
  Plus,
  Edit2,
  Pause,
  Play,
  Trash2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { formatCnpj } from '@/lib/utils';

export default function ParceirosAdminPage() {
  const { data: parceiros = [], isLoading, error, refetch, isFetching } = useAdminParceiros();
  const { data: users = [] } = useAdminUsers();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Parceiro | null>(null);

  const usersByParceiro = useMemo(() => {
    const acc: Record<number, { gestores: number; vendedores: number; total: number }> = {};
    for (const u of users) {
      if (!u.parceiro_id) continue;
      const pid = u.parceiro_id;
      if (!acc[pid]) acc[pid] = { gestores: 0, vendedores: 0, total: 0 };
      acc[pid].total++;
      if (u.role === 'gestor') acc[pid].gestores++;
      else if (u.role === 'operador') acc[pid].vendedores++;
    }
    return acc;
  }, [users]);

  const stats = useMemo(() => {
    const ativos = parceiros.filter((p) => p.active !== false).length;
    const inativos = parceiros.filter((p) => p.active === false).length;
    return { total: parceiros.length, ativos, inativos };
  }, [parceiros]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (p: Parceiro) => {
    setEditing(p);
    setModalOpen(true);
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="size-6 text-purple-400" />
            Admin — Parceiros
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Agências/correspondentes parceiros da operação. Vincule usuários a cada parceiro.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => refetch()} variant="outline" size="sm" disabled={isFetching}>
            <RefreshCw className={`size-4 ${isFetching ? 'animate-spin' : ''}`} />
            Recarregar
          </Button>
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            Novo parceiro
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <KpiCard label="Total" value={stats.total} cor="text-foreground" />
        <KpiCard label="Ativos" value={stats.ativos} cor="text-green-400" />
        <KpiCard label="Inativos" value={stats.inativos} cor="text-muted-foreground" />
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      )}

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 flex items-center gap-3 text-destructive">
            <AlertCircle className="size-5" />
            <div>
              <div className="font-semibold">Erro ao carregar parceiros</div>
              <div className="text-sm">{(error as Error).message}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && parceiros.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <Building2 className="size-12 mx-auto mb-2 opacity-30" />
            <div className="text-sm mb-3">Nenhum parceiro cadastrado.</div>
            <Button onClick={openCreate} size="sm">
              <Plus className="size-4" />
              Criar primeiro parceiro
            </Button>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && parceiros.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs">
                  <tr>
                    <th className="text-left p-3 font-semibold">Nome</th>
                    <th className="text-left p-3 font-semibold">CNPJ</th>
                    <th className="text-left p-3 font-semibold">Usuários</th>
                    <th className="text-left p-3 font-semibold">Status</th>
                    <th className="text-right p-3 font-semibold">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {parceiros.map((p) => (
                    <ParceiroRow
                      key={p.id}
                      parceiro={p}
                      users={usersByParceiro[p.id]}
                      onEdit={() => openEdit(p)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <ParceiroModal open={modalOpen} onClose={() => setModalOpen(false)} parceiro={editing} />
    </div>
  );
}

function ParceiroRow({
  parceiro,
  users,
  onEdit,
}: {
  parceiro: Parceiro;
  users?: { gestores: number; vendedores: number; total: number };
  onEdit: () => void;
}) {
  const isActive = parceiro.active !== false;
  const toggle = useToggleParceiroActive();
  const del = useDeleteParceiro();

  return (
    <tr className="hover:bg-muted/20">
      <td className="p-3 font-medium">{parceiro.nome}</td>
      <td className="p-3 text-xs font-mono text-muted-foreground">
        {parceiro.cnpj ? formatCnpj(parceiro.cnpj) : '—'}
      </td>
      <td className="p-3 text-xs">
        {users && users.total > 0 ? (
          <>
            <strong>{users.total}</strong> users
            <span className="text-muted-foreground ml-1">
              ({users.gestores}G + {users.vendedores}V)
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="p-3">
        {isActive ? (
          <Badge variant="success" className="text-[10px]">
            ATIVO
          </Badge>
        ) : (
          <Badge variant="muted" className="text-[10px]">
            INATIVO
          </Badge>
        )}
      </td>
      <td className="p-3 text-right">
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={onEdit} title="Editar">
            <Edit2 className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => toggle.mutate({ parceiroId: parceiro.id, active: !isActive })}
            disabled={toggle.isPending}
            title={isActive ? 'Desativar' : 'Reativar'}
            className={isActive ? 'text-yellow-400' : 'text-green-400'}
          >
            {isActive ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (
                confirm(
                  `Desativar "${parceiro.nome}"?\n\nSó funciona se nenhum user estiver vinculado.`,
                )
              ) {
                del.mutate(parceiro.id);
              }
            }}
            disabled={del.isPending}
            title="Excluir"
            className="text-destructive"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

function ParceiroModal({
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
  const create = useCreateParceiro();
  const update = useUpdateParceiro();

  const handleOpenChange = (o: boolean) => {
    if (o) {
      setNome(parceiro?.nome || '');
      setCnpj(parceiro?.cnpj || '');
    } else {
      onClose();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) return;
    try {
      if (isEdit && parceiro) {
        await update.mutateAsync({
          parceiroId: parceiro.id,
          nome: nome.trim(),
          cnpj: cnpj.trim() || null,
        });
      } else {
        await create.mutateAsync({ nome: nome.trim(), cnpj: cnpj.trim() || undefined });
      }
      onClose();
    } catch {
      // toast no hook
    }
  };

  const loading = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar parceiro' : 'Novo parceiro'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Atualize os dados da agência.' : 'Cadastre uma nova agência/correspondente.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
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
            <Label htmlFor="parc-cnpj">CNPJ (opcional)</Label>
            <Input
              id="parc-cnpj"
              value={cnpj}
              onChange={(e) => setCnpj(e.target.value)}
              placeholder="00.000.000/0000-00"
              className="font-mono"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!nome.trim() || loading}>
              {loading ? 'Salvando...' : isEdit ? 'Salvar' : 'Criar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function KpiCard({ label, value, cor }: { label: string; value: number; cor: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          {label}
        </div>
        <div className={`text-2xl font-mono font-bold mt-1 ${cor}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
