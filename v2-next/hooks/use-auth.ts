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
}

// V1 retorna { ok: true, user } — não { success: true }
interface MeResponse {
  ok: boolean;
  user: AuthUser;
}

/**
 * Hook que gerencia auth state. Faz POST /api/auth { action: 'me' } na
 * primeira carga, redireciona pra /login se não autenticado.
 */
export function useAuth(opts: { redirectTo?: string } = {}) {
  const router = useRouter();
  const { redirectTo = '/login' } = opts;
  const [hasToken, setHasToken] = useState(false);

  // Verifica token no client (evita chamada inútil sem token)
  useEffect(() => {
    setHasToken(!!getToken());
  }, []);

  const query = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const r = await api<MeResponse>('/api/auth', { action: 'me' });
      if (!r.ok || !r.user) throw new ApiError('Sessão expirada', 401);
      return r.user;
    },
    enabled: hasToken,
    staleTime: 10 * 60 * 1000, // 10min
    retry: false,
  });

  // Redireciona se 401/sem token
  useEffect(() => {
    if (!hasToken && redirectTo) {
      router.replace(redirectTo);
    }
    if (query.error instanceof ApiError && query.error.status === 401) {
      clearToken();
      router.replace(redirectTo);
    }
  }, [hasToken, query.error, redirectTo, router]);

  function logout() {
    clearToken();
    router.replace('/login');
  }

  return {
    user: query.data,
    isLoading: hasToken && query.isLoading,
    isAuthenticated: !!query.data,
    logout,
  };
}
