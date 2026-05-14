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
 *
 * IMPORTANTE: hasToken usa estado tri-state (null/false/true) pra evitar
 * race condition durante hydration:
 *   null  = ainda não checou localStorage (1º render no client)
 *   false = checou e NÃO tem token  → redireciona
 *   true  = checou e TEM token       → busca user via 'me'
 *
 * Sem isso, o redirect rodava com hasToken=false (initial useState) ANTES
 * do useEffect ler o localStorage — kicked out instantâneo após login.
 */
export function useAuth(opts: { redirectTo?: string } = {}) {
  const router = useRouter();
  const { redirectTo = '/login' } = opts;
  const [hasToken, setHasToken] = useState<boolean | null>(null);

  // Verifica token no client após mount (evita SSR mismatch)
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
    enabled: hasToken === true, // só roda quando confirmado que tem token
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  // Redireciona APENAS quando explicitamente false (não null) ou erro 401
  useEffect(() => {
    if (hasToken === false && redirectTo) {
      router.replace(redirectTo);
      return;
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
    // Loading enquanto: ainda não checou token (null) OU checou e tem token mas query rodando
    isLoading: hasToken === null || (hasToken === true && query.isLoading),
    isAuthenticated: !!query.data,
    logout,
  };
}
