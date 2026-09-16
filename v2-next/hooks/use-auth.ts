'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, getToken, clearToken, ApiError } from '@/lib/api';

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  role: 'admin' | 'gestor' | 'operador';
  parceiro_id?: number | null;
  nome_vendedor?: string | null;
  nome_parceiro?: string | null;
  bank_codes?: Record<string, string> | null;
}

interface MeResponse {
  ok: boolean;
  user: AuthUser;
}

export function useAuth(opts: { redirectTo?: string } = {}) {
  const router = useRouter();
  const { redirectTo = '/login' } = opts;
  const [hasToken, setHasToken] = useState<boolean | null>(null);

  useEffect(() => {
    setHasToken(!!getToken());
  }, []);

  const query = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const response = await api<MeResponse>('/api/auth', { action: 'me' });
      if (!response.ok || !response.user) throw new ApiError('Sessão expirada', 401);
      return response.user;
    },
    enabled: hasToken === true,
    staleTime: 10 * 60 * 1000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status < 500) return false;
      return failureCount < 1;
    },
  });

  const sessionInvalid = hasToken === false || (query.error instanceof ApiError && query.error.status === 401);

  useEffect(() => {
    if (!sessionInvalid || !redirectTo) return;
    if (query.error instanceof ApiError && query.error.status === 401) clearToken();
    router.replace(redirectTo);
  }, [query.error, redirectTo, router, sessionInvalid]);

  function logout() {
    clearToken();
    router.replace('/login');
  }

  return {
    user: query.data,
    isLoading: hasToken === null || (hasToken === true && query.isLoading),
    isRedirecting: sessionInvalid,
    isAuthenticated: !!query.data,
    error: sessionInvalid ? null : query.error,
    retry: query.refetch,
    logout,
  };
}
