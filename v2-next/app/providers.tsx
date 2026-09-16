'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import {
  getWorkspaceTheme,
  WORKSPACE_THEME_EVENT,
  type WorkspaceTheme,
} from '@/lib/workspace-theme';

export function Providers({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<WorkspaceTheme>('light');
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Cache padrão: 5min em memória, revalida ao focar janela
            staleTime: 5 * 60 * 1000,
            gcTime: 30 * 60 * 1000, // 30min sem uso → garbage collect
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
            retry: (failureCount, error: unknown) => {
              // Não retry em 401/403/404 — só erros de rede
              const status = typeof error === 'object' && error !== null && 'status' in error
                ? (error as { status?: unknown }).status
                : undefined;
              if (status === 401 || status === 403 || status === 404) {
                return false;
              }
              return failureCount < 2;
            },
          },
        },
      }),
  );

  useEffect(() => {
    setTheme(getWorkspaceTheme());

    function onThemeChange(event: Event) {
      setTheme((event as CustomEvent<WorkspaceTheme>).detail);
    }

    window.addEventListener(WORKSPACE_THEME_EVENT, onThemeChange);
    return () => window.removeEventListener(WORKSPACE_THEME_EVENT, onThemeChange);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster position="top-right" theme={theme} richColors closeButton />
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}
