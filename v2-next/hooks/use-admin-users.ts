'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  AssignParceiroParams,
  CreateUserParams,
  ListUsersResponse,
  ResetPwParams,
  SimpleResponse,
  UpdateBankCodesParams,
  UpdateRoleParams,
  UpdateUserParams,
  User,
} from '@/lib/admin-types';
import { toast } from 'sonner';

/**
 * Lista todos os usuários (admin vê tudo; gestor só os do próprio parceiro).
 */
export function useAdminUsers() {
  return useQuery({
    queryKey: ['admin', 'users'],
    queryFn: async () => {
      const r = await api<ListUsersResponse>('/api/auth', { action: 'list' });
      if (!r.ok) throw new Error(r.error || 'Erro ao listar usuários');
      return r.users || [];
    },
    staleTime: 30 * 1000,
  });
}

function inv(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['admin', 'users'] });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: CreateUserParams) => {
      const r = await api<SimpleResponse & { user?: User }>('/api/auth', {
        action: 'create',
        ...params,
      });
      if (!r.ok) throw new Error(r.error || 'Erro ao criar usuário');
      return r;
    },
    onSuccess: () => {
      inv(qc);
      toast.success('Usuário criado');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: UpdateUserParams) => {
      const r = await api<SimpleResponse>('/api/auth', {
        action: 'update_user',
        ...params,
      });
      if (!r.ok) throw new Error(r.error || 'Erro ao atualizar usuário');
      return r;
    },
    onSuccess: () => {
      inv(qc);
      toast.success('Usuário atualizado');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useUpdateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: UpdateRoleParams) => {
      const r = await api<SimpleResponse>('/api/auth', {
        action: 'update_role',
        ...params,
      });
      if (!r.ok) throw new Error(r.error || 'Erro ao atualizar role');
      return r;
    },
    onSuccess: () => {
      inv(qc);
      toast.success('Perfil atualizado');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useUpdateBankCodes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: UpdateBankCodesParams) => {
      const r = await api<SimpleResponse & { bank_codes?: Record<string, string> }>(
        '/api/auth',
        { action: 'update_bank_codes', ...params },
      );
      if (!r.ok) throw new Error(r.error || 'Erro ao atualizar códigos');
      return r;
    },
    onSuccess: () => {
      inv(qc);
      toast.success('Códigos atualizados');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useAssignParceiro() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: AssignParceiroParams) => {
      const r = await api<SimpleResponse>('/api/auth', {
        action: 'assign_parceiro',
        ...params,
      });
      if (!r.ok) throw new Error(r.error || 'Erro ao vincular parceiro');
      return r;
    },
    onSuccess: () => {
      inv(qc);
      toast.success('Vínculo atualizado');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useResetPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: ResetPwParams) => {
      const r = await api<SimpleResponse>('/api/auth', {
        action: 'reset_pw',
        targetUser: params.targetUser,
        newPass: params.newPass,
      });
      if (!r.ok) throw new Error(r.error || 'Erro ao redefinir senha');
      return r;
    },
    onSuccess: () => {
      inv(qc);
      toast.success('Senha redefinida');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (targetUser: string) => {
      const r = await api<SimpleResponse>('/api/auth', {
        action: 'delete',
        targetUser,
      });
      if (!r.ok) throw new Error(r.error || 'Erro ao desativar usuário');
      return r;
    },
    onSuccess: () => {
      inv(qc);
      toast.success('Usuário desativado');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
