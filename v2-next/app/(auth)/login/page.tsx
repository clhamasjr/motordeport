'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, setToken, ApiError } from '@/lib/api';
import { toast } from 'sonner';
import { Loader2, Zap } from 'lucide-react';

// V1 retorna { ok: true, token, user } — não { success: true }
interface LoginResponse {
  ok: boolean;
  token?: string;
  user?: { id: number; user: string; name: string; role: string };
  error?: string;
}

// Wrapper Suspense pra useSearchParams() — exigido pelo Next 14 no SSR
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const expired = searchParams?.get('expired') === '1';

  // Toast 1x quando chegar redirecionado por sessao expirada
  useEffect(() => {
    if (expired) toast.error('Sua sessao expirou. Faca login de novo.');
  }, [expired]);

  const loginMutation = useMutation({
    mutationFn: async (vars: { username: string; password: string }) => {
      // V1 espera body { action, user, pass } — NÃO username/password
      return api<LoginResponse>('/api/auth', {
        action: 'login',
        user: vars.username,
        pass: vars.password,
      });
    },
    onSuccess: (data) => {
      if (data.ok && data.token) {
        setToken(data.token);
        toast.success('Login realizado!');
        router.push('/inicio');
      } else {
        toast.error(data.error || 'Falha no login');
      }
    },
    onError: (err: ApiError) => {
      toast.error(err.message || 'Erro de conexão');
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) {
      toast.error('Preencha usuário e senha');
      return;
    }
    loginMutation.mutate({ username, password });
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Zap className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-2xl">FlowForce</CardTitle>
              <CardDescription>Plataforma de Crédito · LhamasCred</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {expired && (
            <div className="mb-4 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-200">
              ⚠ Sua sessao expirou. Entre novamente pra continuar.
            </div>
          )}
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Usuário ou e-mail</Label>
              <Input
                id="username"
                type="text"
                autoComplete="username"
                placeholder="seu.email@empresa.com.br"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loginMutation.isPending}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loginMutation.isPending}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loginMutation.isPending}>
              {loginMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Entrando...
                </>
              ) : (
                'Entrar'
              )}
            </Button>
            <p className="text-xs text-center text-muted-foreground pt-2">
              Mesma senha do{' '}
              <a href="https://motordeport.vercel.app" className="underline hover:text-primary">
                sistema V1
              </a>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
