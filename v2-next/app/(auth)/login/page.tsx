'use client';

import Image from 'next/image';
import { FormEvent, Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, setToken, ApiError } from '@/lib/api';
import { toast } from 'sonner';
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
} from 'lucide-react';

interface LoginResponse {
  ok: boolean;
  token?: string;
  user?: { id: number; user: string; name: string; role: string };
  error?: string;
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginLoading />}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginLoading() {
  return (
    <main className="brand-login-bg relative flex min-h-screen items-center justify-center px-6">
      <div className="flex items-center gap-3 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-5 animate-spin text-[hsl(var(--brand-orange))]" aria-hidden />
        Preparando acesso…
      </div>
    </main>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const expired = searchParams?.get('expired') === '1';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState(
    expired ? 'Sua sessão expirou. Entre novamente para continuar.' : '',
  );

  const loginMutation = useMutation({
    mutationFn: async (vars: { username: string; password: string }) => {
      return api<LoginResponse>('/api/auth', {
        action: 'login',
        user: vars.username,
        pass: vars.password,
      });
    },
    onSuccess: (data) => {
      if (data.ok && data.token) {
        setToken(data.token);
        toast.success('Acesso autorizado');
        router.replace('/inicio');
        return;
      }
      setFormError(data.error || 'Não foi possível entrar. Confira seus dados.');
    },
    onError: (error: ApiError) => {
      if (error.status >= 500) {
        setFormError('O serviço está temporariamente indisponível. Tente novamente em instantes.');
        return;
      }
      setFormError(error.message || 'Não foi possível conectar ao serviço.');
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedUsername = username.trim();

    if (!normalizedUsername || !password) {
      setFormError('Informe seu usuário e sua senha para continuar.');
      return;
    }

    setFormError('');
    loginMutation.mutate({ username: normalizedUsername, password });
  }

  const isPending = loginMutation.isPending;

  return (
    <main className="brand-login-bg relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8 sm:px-6">
      <div className="login-clean-glow" aria-hidden />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[hsl(var(--brand-orange)/.8)] to-transparent" aria-hidden />

      <section className="relative w-full max-w-[440px]" aria-labelledby="login-title">
        <header className="mb-8 flex flex-col items-center text-center">
          <Image
            src="/brand/lhamascred-logo.png"
            alt="LhamasCred — Promotora de Crédito"
            width={687}
            height={368}
            className="h-auto w-[190px] sm:w-[210px]"
            priority
          />
          <div className="mt-5 flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            <span className="h-px w-7 bg-[hsl(var(--brand-orange)/.65)]" aria-hidden />
            Plataforma operacional
            <span className="h-px w-7 bg-[hsl(var(--brand-orange)/.65)]" aria-hidden />
          </div>
        </header>

        <div className="brand-auth-panel overflow-hidden border border-border/85 bg-[hsl(var(--card)/.88)] backdrop-blur-xl">
          <div className="h-0.5 bg-gradient-to-r from-[hsl(var(--brand-orange))] via-[hsl(var(--brand-gold))] to-[hsl(var(--brand-silver)/.6)]" aria-hidden />

          <div className="p-6 sm:p-8">
            <div>
              <p className="text-sm font-medium text-[hsl(var(--brand-orange))]">FlowForce</p>
              <h1 id="login-title" className="mt-1 text-3xl font-semibold tracking-[-0.045em] text-foreground">
                Entrar no FlowForce
              </h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Use suas credenciais para acessar sua operação.
              </p>
            </div>

            <form onSubmit={onSubmit} className="mt-7 space-y-5" aria-busy={isPending}>
              {formError && (
                <div
                  id="login-error"
                  role="alert"
                  className="flex items-start gap-3 border border-destructive/35 bg-destructive/10 px-4 py-3 text-sm leading-5 text-destructive"
                >
                  <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{formError}</span>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="username">Usuário ou e-mail</Label>
                <Input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="Digite seu usuário"
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    if (formError) setFormError('');
                  }}
                  disabled={isPending}
                  aria-describedby={formError ? 'login-error' : undefined}
                  className="h-12 rounded-md border-border/90 bg-background/65 px-4 text-base focus-visible:ring-[hsl(var(--brand-orange))]"
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="Digite sua senha"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      if (formError) setFormError('');
                    }}
                    disabled={isPending}
                    aria-describedby={formError ? 'login-error' : undefined}
                    className="h-12 rounded-md border-border/90 bg-background/65 px-4 pr-12 text-base focus-visible:ring-[hsl(var(--brand-orange))]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--brand-orange))]"
                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    aria-pressed={showPassword}
                    disabled={isPending}
                  >
                    {showPassword ? <EyeOff className="size-4.5" aria-hidden /> : <Eye className="size-4.5" aria-hidden />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                size="lg"
                className="h-12 w-full bg-[hsl(var(--brand-orange))] font-semibold text-black shadow-none hover:bg-[hsl(var(--brand-orange)/.9)] hover:shadow-none"
                disabled={isPending}
              >
                {isPending ? (
                  <><Loader2 className="size-4 animate-spin" aria-hidden />Entrando…</>
                ) : (
                  <>Entrar <ArrowRight className="size-4" aria-hidden /></>
                )}
              </Button>
            </form>

            <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Check className="size-3.5 text-emerald-400" aria-hidden />
              Ambiente seguro e restrito
            </div>
          </div>
        </div>

        <footer className="mt-6 text-center text-[11px] leading-5 text-muted-foreground/65">
          FlowForce Command Center · Uma plataforma LhamasCred
        </footer>
      </section>
    </main>
  );
}
