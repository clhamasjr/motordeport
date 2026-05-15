'use client';

import { useMemo, useState } from 'react';
import {
  useAdminUsers,
  useCreateUser,
  useUpdateUser,
  useUpdateRole,
  useUpdateBankCodes,
  useAssignParceiro,
  useResetPassword,
  useDeleteUser,
} from '@/hooks/use-admin-users';
import { useAdminParceiros } from '@/hooks/use-admin-parceiros';
import { useAuth } from '@/hooks/use-auth';
import { User, UserRole } from '@/lib/admin-types';
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
  Users,
  Plus,
  Edit2,
  Trash2,
  Key,
  Building2,
  AlertCircle,
  RefreshCw,
  Search,
} from 'lucide-react';

const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Admin',
  gestor: 'Gestor',
  operador: 'Vendedor',
};

const ROLE_VARIANT: Record<UserRole, 'destructive' | 'warning' | 'info'> = {
  admin: 'destructive',
  gestor: 'warning',
  operador: 'info',
};

export default function UsuariosAdminPage() {
  const { data: users = [], isLoading, error, refetch, isFetching } = useAdminUsers();
  const { data: parceiros = [] } = useAdminParceiros();
  const { user: currentUser } = useAuth();

  const [busca, setBusca] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | ''>('');
  const [parceiroFilter, setParceiroFilter] = useState<string>('');

  const [createOpen, setCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [resetPwUser, setResetPwUser] = useState<User | null>(null);
  const [bankCodesUser, setBankCodesUser] = useState<User | null>(null);

  const parceirosAtivos = useMemo(
    () => parceiros.filter((p) => p.active !== false),
    [parceiros],
  );
  const parceiroById = useMemo(() => {
    const acc: Record<number, string> = {};
    for (const p of parceiros) acc[p.id] = p.nome;
    return acc;
  }, [parceiros]);

  const filtered = useMemo(() => {
    let arr = users;
    if (roleFilter) arr = arr.filter((u) => u.role === roleFilter);
    if (parceiroFilter === 'none') {
      arr = arr.filter((u) => !u.parceiro_id && u.role !== 'admin');
    } else if (parceiroFilter) {
      const pid = Number(parceiroFilter);
      arr = arr.filter((u) => u.parceiro_id === pid);
    }
    if (busca) {
      const q = busca.toLowerCase();
      arr = arr.filter(
        (u) =>
          u.username.toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q),
      );
    }
    // Ordena: admin > gestor > operador, agrupados por parceiro
    return [...arr].sort((a, b) => {
      const order = { admin: 0, gestor: 1, operador: 2 };
      const ra = order[a.role] ?? 9;
      const rb = order[b.role] ?? 9;
      if (ra !== rb) return ra - rb;
      return (a.parceiro_id || 0) - (b.parceiro_id || 0);
    });
  }, [users, busca, roleFilter, parceiroFilter]);

  const stats = useMemo(() => {
    const admins = users.filter((u) => u.role === 'admin').length;
    const gestores = users.filter((u) => u.role === 'gestor').length;
    const vendedores = users.filter((u) => u.role === 'operador').length;
    const semParceiro = users.filter((u) => !u.parceiro_id && u.role !== 'admin').length;
    return { total: users.length, admins, gestores, vendedores, semParceiro };
  }, [users]);

  const isAdmin = currentUser?.role === 'admin';

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="size-6 text-cyan-400" />
            Admin — Usuários
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gestão de admins, gestores e vendedores. Vincula usuários a parceiros (agências).
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => refetch()} variant="outline" size="sm" disabled={isFetching}>
            <RefreshCw className={`size-4 ${isFetching ? 'animate-spin' : ''}`} />
            Recarregar
          </Button>
          {isAdmin && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              Novo usuário
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <KpiCard label="Total" value={stats.total} cor="text-foreground" />
        <KpiCard label="Admins" value={stats.admins} cor="text-red-400" />
        <KpiCard label="Gestores" value={stats.gestores} cor="text-yellow-400" />
        <KpiCard label="Vendedores" value={stats.vendedores} cor="text-blue-400" />
        {stats.semParceiro > 0 && (
          <KpiCard label="Sem parceiro" value={stats.semParceiro} cor="text-yellow-500" />
        )}
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Buscar (nome ou login)
            </Label>
            <div className="relative mt-1">
              <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="ex: carlos"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Perfil
            </Label>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as UserRole | '')}
              className="mt-1 h-10 rounded-md border border-input bg-background px-3 text-sm block"
            >
              <option value="">Todos</option>
              <option value="admin">Admin</option>
              <option value="gestor">Gestor</option>
              <option value="operador">Vendedor</option>
            </select>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Parceiro
            </Label>
            <select
              value={parceiroFilter}
              onChange={(e) => setParceiroFilter(e.target.value)}
              className="mt-1 h-10 rounded-md border border-input bg-background px-3 text-sm block"
            >
              <option value="">Todos</option>
              <option value="none">⚠ Sem parceiro</option>
              {parceirosAtivos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </div>
          {(busca || roleFilter || parceiroFilter) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setBusca('');
                setRoleFilter('');
                setParceiroFilter('');
              }}
            >
              Limpar
            </Button>
          )}
        </CardContent>
      </Card>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      )}

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 flex items-center gap-3 text-destructive">
            <AlertCircle className="size-5" />
            <div>
              <div className="font-semibold">Erro ao carregar usuários</div>
              <div className="text-sm">{(error as Error).message}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <Users className="size-12 mx-auto mb-2 opacity-30" />
            <div className="text-sm">
              {busca || roleFilter || parceiroFilter
                ? 'Nenhum usuário com esses filtros.'
                : 'Nenhum usuário cadastrado.'}
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs">
                  <tr>
                    <th className="text-left p-3 font-semibold">Nome</th>
                    <th className="text-left p-3 font-semibold">Login</th>
                    <th className="text-left p-3 font-semibold">Perfil</th>
                    <th className="text-left p-3 font-semibold">Parceiro</th>
                    <th className="text-left p-3 font-semibold">Códigos</th>
                    <th className="text-right p-3 font-semibold">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((u) => (
                    <UserRow
                      key={u.id}
                      user={u}
                      isAdmin={isAdmin}
                      parceiroNome={u.parceiro_id ? parceiroById[u.parceiro_id] : null}
                      onEdit={() => setEditingUser(u)}
                      onResetPw={() => setResetPwUser(u)}
                      onBankCodes={() => setBankCodesUser(u)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-3 border-t border-border text-xs text-muted-foreground">
              Mostrando <strong className="text-foreground">{filtered.length}</strong> de{' '}
              {users.length} usuários
            </div>
          </CardContent>
        </Card>
      )}

      <CreateUserModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <EditUserModal
        user={editingUser}
        onClose={() => setEditingUser(null)}
      />
      <ResetPwModal user={resetPwUser} onClose={() => setResetPwUser(null)} />
      <BankCodesModal user={bankCodesUser} onClose={() => setBankCodesUser(null)} />
    </div>
  );
}

function UserRow({
  user,
  isAdmin,
  parceiroNome,
  onEdit,
  onResetPw,
  onBankCodes,
}: {
  user: User;
  isAdmin: boolean;
  parceiroNome: string | null;
  onEdit: () => void;
  onResetPw: () => void;
  onBankCodes: () => void;
}) {
  const del = useDeleteUser();
  const isMaster = user.username === 'admin';
  const bankKeys = Object.keys(user.bank_codes || {}).filter((k) => user.bank_codes![k]);

  return (
    <tr className="hover:bg-muted/20">
      <td className="p-3 font-medium">{user.name}</td>
      <td className="p-3 font-mono text-xs">{user.username}</td>
      <td className="p-3">
        <Badge variant={ROLE_VARIANT[user.role]} className="text-[10px]">
          {ROLE_LABEL[user.role]}
        </Badge>
      </td>
      <td className="p-3 text-xs">
        {user.role === 'admin' ? (
          <span className="text-muted-foreground">—</span>
        ) : parceiroNome ? (
          <span className="inline-flex items-center gap-1">
            <Building2 className="size-3 text-muted-foreground" />
            {parceiroNome}
          </span>
        ) : (
          <span className="text-yellow-500">⚠ sem parceiro</span>
        )}
      </td>
      <td className="p-3">
        {bankKeys.length > 0 ? (
          <div className="flex gap-1 flex-wrap">
            {bankKeys.slice(0, 3).map((k) => (
              <Badge key={k} variant="muted" className="text-[9px] font-mono">
                {k}:{String(user.bank_codes![k]).slice(0, 6)}
              </Badge>
            ))}
            {bankKeys.length > 3 && (
              <Badge variant="muted" className="text-[9px]">
                +{bankKeys.length - 3}
              </Badge>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </td>
      <td className="p-3 text-right">
        {isMaster ? (
          <span className="text-muted-foreground text-xs">—</span>
        ) : (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={onEdit} title="Editar">
              <Edit2 className="size-3.5" />
            </Button>
            {isAdmin && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onResetPw}
                title="Redefinir senha"
                className="text-yellow-400"
              >
                <Key className="size-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onBankCodes}
              title="Códigos de banco"
              className="text-green-400"
            >
              📋
            </Button>
            {isAdmin && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (confirm(`Desativar usuário "${user.username}"?`)) {
                    del.mutate(user.username);
                  }
                }}
                disabled={del.isPending}
                title="Desativar"
                className="text-destructive"
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

function CreateUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateUser();
  const assign = useAssignParceiro();
  const { data: parceiros = [] } = useAdminParceiros();
  const [name, setName] = useState('');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [role, setRole] = useState<UserRole>('operador');
  const [parceiroId, setParceiroId] = useState<string>('');

  const handleOpenChange = (o: boolean) => {
    if (o) {
      setName('');
      setUser('');
      setPass('');
      setRole('operador');
      setParceiroId('');
    } else {
      onClose();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !user.trim() || !pass) return;
    try {
      await create.mutateAsync({
        name: name.trim(),
        user: user.trim().toLowerCase(),
        pass,
        role,
      });
      if (role !== 'admin' && parceiroId) {
        await assign.mutateAsync({
          targetUser: user.trim().toLowerCase(),
          parceiroId: Number(parceiroId),
        });
      }
      onClose();
    } catch {
      /* toast no hook */
    }
  };

  const loading = create.isPending || assign.isPending;
  const parceirosAtivos = parceiros.filter((p) => p.active !== false);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo usuário</DialogTitle>
          <DialogDescription>Crie um admin, gestor ou vendedor.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label>Nome completo *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div>
            <Label>Login *</Label>
            <Input
              value={user}
              onChange={(e) => setUser(e.target.value.toLowerCase())}
              placeholder="ex: carlos.silva"
              className="font-mono"
              required
            />
          </div>
          <div>
            <Label>Senha * (mín. 4 caracteres)</Label>
            <Input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              minLength={4}
              required
            />
          </div>
          <div>
            <Label>Perfil</Label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="operador">Vendedor</option>
              <option value="gestor">Gestor</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          {role !== 'admin' && (
            <div>
              <Label>Parceiro (vincular agora)</Label>
              <select
                value={parceiroId}
                onChange={(e) => setParceiroId(e.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">— Sem parceiro —</option>
                {parceirosAtivos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Criando...' : 'Criar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditUserModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const update = useUpdateUser();
  const updateRole = useUpdateRole();
  const assign = useAssignParceiro();
  const { data: parceiros = [] } = useAdminParceiros();
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin';
  const [name, setName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [role, setRole] = useState<UserRole>('operador');
  const [parceiroId, setParceiroId] = useState<string>('');

  const handleOpenChange = (o: boolean) => {
    if (o && user) {
      setName(user.name || '');
      setNewUsername(user.username);
      setRole(user.role);
      setParceiroId(user.parceiro_id ? String(user.parceiro_id) : '');
    } else {
      onClose();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    try {
      const patch: Record<string, unknown> = { targetUser: user.username };
      if (name.trim() && name !== user.name) patch.name = name.trim();
      if (newUsername.trim() && newUsername.toLowerCase() !== user.username) {
        patch.newUsername = newUsername.trim().toLowerCase();
      }
      // role só admin
      if (isAdmin && role !== user.role) patch.role = role;
      if (Object.keys(patch).length > 1) {
        await update.mutateAsync(patch as Parameters<typeof update.mutateAsync>[0]);
      }
      // assign parceiro (separado)
      const novoPid = parceiroId ? Number(parceiroId) : null;
      const atualPid = user.parceiro_id || null;
      if (novoPid !== atualPid && user.role !== 'admin') {
        await assign.mutateAsync({ targetUser: user.username, parceiroId: novoPid });
      }
      onClose();
    } catch {
      /* toast no hook */
    }
  };

  const loading = update.isPending || updateRole.isPending || assign.isPending;
  const parceirosAtivos = parceiros.filter((p) => p.active !== false);

  return (
    <Dialog open={!!user} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar usuário</DialogTitle>
          <DialogDescription>{user?.username}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label>Nome completo</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Login</Label>
            <Input
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value.toLowerCase())}
              className="font-mono"
            />
          </div>
          {isAdmin && (
            <div>
              <Label>Perfil</Label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="operador">Vendedor</option>
                <option value="gestor">Gestor</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          )}
          {role !== 'admin' && (
            <div>
              <Label>Parceiro</Label>
              <select
                value={parceiroId}
                onChange={(e) => setParceiroId(e.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">— Sem parceiro —</option>
                {parceirosAtivos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPwModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const reset = useResetPassword();
  const [newPass, setNewPass] = useState('');

  const handleOpenChange = (o: boolean) => {
    if (o) setNewPass('');
    else onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newPass || newPass.length < 4) return;
    try {
      await reset.mutateAsync({ targetUser: user.username, newPass });
      onClose();
    } catch {
      /* toast no hook */
    }
  };

  return (
    <Dialog open={!!user} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Redefinir senha</DialogTitle>
          <DialogDescription>{user?.username}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label>Nova senha (mín. 4 caracteres)</Label>
            <Input
              type="password"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              minLength={4}
              autoFocus
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={reset.isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={newPass.length < 4 || reset.isPending}>
              {reset.isPending ? 'Salvando...' : 'Redefinir'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const BANK_KEYS = ['FACTA', 'QUALI', 'BRB', 'ICRED', 'C6', 'DIGIO', 'DAYCOVAL', 'MERCANTIL', 'WPP'];

function BankCodesModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const update = useUpdateBankCodes();
  const [codes, setCodes] = useState<Record<string, string>>({});

  const handleOpenChange = (o: boolean) => {
    if (o && user) {
      setCodes({ ...(user.bank_codes || {}) });
    } else {
      onClose();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    try {
      await update.mutateAsync({ targetUser: user.username, codes });
      onClose();
    } catch {
      /* toast no hook */
    }
  };

  return (
    <Dialog open={!!user} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Códigos de banco</DialogTitle>
          <DialogDescription>
            {user?.username} — preencha apenas os bancos que o usuário tem código próprio. Vazio
            remove o código.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {BANK_KEYS.map((k) => (
              <div key={k}>
                <Label className="text-[10px] uppercase">{k}</Label>
                <Input
                  value={codes[k] || ''}
                  onChange={(e) => setCodes({ ...codes, [k]: e.target.value })}
                  placeholder="—"
                  className="font-mono text-xs"
                />
              </div>
            ))}
          </div>
          <DialogFooter className="mt-3">
            <Button type="button" variant="outline" onClick={onClose} disabled={update.isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? 'Salvando...' : 'Salvar'}
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
