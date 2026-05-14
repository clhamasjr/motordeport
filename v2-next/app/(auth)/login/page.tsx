'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

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
