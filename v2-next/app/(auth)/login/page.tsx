'use client';

import { FormEvent, Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { api, setToken, ApiError } from '@/lib/api';
import { toast } from 'sonner';
import {
  ArrowRight,
  BriefcaseBusiness,
  Check,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';

interface LoginResponse {
  ok: boolean;
  token?: string;
  user?: { id: number; user: string; name: string; role: string };
  error?: string;
}

const BENEFITS = [
  {
    icon: BriefcaseBusiness,
    title: 'Operação multiproduto',
    description: 'INSS, CLT, FGTS e convênios em um só ambiente.',
  },
  {
    icon: Sparkles,
    title: 'Fluxos mais rápidos',
    description: 'Consulte, analise e acompanhe propostas com menos etapas.',
  },
  {
    icon: ShieldCheck,
    title: 'Acesso protegido',
    description: 'Ambiente restrito para a equipe e parceiros autorizados.',
  },
];

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginLoading />}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginLoading() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6">
      <div className="aurora-bg" aria-hidden />
      <div className="flex items-center gap-3 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
        Preparando acesso seguro…
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
    <main className="relative min-h-screen overflow-hidden">
      <div className="aurora-bg" aria-hidden />
      <div className="login-grid" aria-hidden />

      <div className="relative mx-auto grid min-h-screen w-full max-w-7xl items-center gap-10 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(380px,440px)] lg:gap-16 lg:px-12 xl:px-16">
        <section className="hidden max-w-2xl lg:block" aria-labelledby="login-intro-title">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            <Zap className="size-3.5" aria-hidden />
            Plataforma de crédito LhamasCred
          </div>

          <h1 id="login-intro-title" className="max-w-xl text-4xl font-semibold tracking-[-0.035em] text-foreground xl:text-5xl xl:leading-[1.08]">
            Sua operação financeira, <span className="text-gradient">mais simples e conectada.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground xl:text-lg">
            Centralize consultas, análises e acompanhamento comercial em uma experiência criada para a rotina da sua equipe.
          </p>

          <div className="mt-10 grid max-w-xl gap-3">
            {BENEFITS.map(({ icon: Icon, title, description }) => (
              <div key={title} className="flex items-start gap-4 rounded-2xl border border-border/60 bg-card/35 p-4 backdrop-blur-sm">
                <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
                  <Icon className="size-4.5" aria-hidden />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">{title}</h2>
                  <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-md" aria-labelledby="login-title">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-aurora shadow-[0_12px_36px_-14px_hsl(var(--primary)/.9)] ring-1 ring-primary/30">
              <Zap className="size-5 text-primary-foreground" aria-hidden />
            </div>
            <div>
              <div className="text-lg font-bold leading-tight text-gradient">FlowForce</div>
              <div className="text-xs text-muted-foreground">Plataforma de crédito LhamasCred</div>
            </div>
          </div>

          <Card variant="strong" className="overflow-hidden border-border/80 shadow-2xl shadow-black/35">
            <CardContent className="p-6 sm:p-8">
              <div className="hidden items-center gap-3 lg:flex">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-aurora shadow-[0_12px_36px_-14px_hsl(var(--primary)/.9)] ring-1 ring-primary/30">
                  <Zap className="size-5 text-primary-foreground" aria-hidden />
                </div>
                <div>
                  <div className="text-lg font-bold leading-tight text-gradient">FlowForce</div>
                  <div className="text-xs text-muted-foreground">LhamasCred</div>
                </div>
              </div>

              <div className="mt-1 lg:mt-8">
                <h2 id="login-title" className="text-2xl font-semibold tracking-tight text-foreground">
                  Acesse sua operação
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Use as mesmas credenciais cadastradas na plataforma.
                </p>
              </div>

              <form onSubmit={onSubmit} className="mt-7 space-y-5" aria-busy={isPending}>
                {formError && (
                  <div
                    id="login-error"
                    role="alert"
                    className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm leading-5 text-destructive"
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
                    placeholder="seu.email@empresa.com.br"
                    value={username}
                    onChange={(event) => {
                      setUsername(event.target.value);
                      if (formError) setFormError('');
                    }}
                    disabled={isPending}
                    aria-describedby={formError ? 'login-error' : undefined}
                    className="h-12 bg-background/55 px-4"
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
                      className="h-12 bg-background/55 px-4 pr-12"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((visible) => !visible)}
                      className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                      aria-pressed={showPassword}
                      disabled={isPending}
                    >
                      {showPassword ? <EyeOff className="size-4.5" aria-hidden /> : <Eye className="size-4.5" aria-hidden />}
                    </button>
                  </div>
                </div>

                <Button type="submit" variant="gradient" size="lg" className="w-full" disabled={isPending}>
                  {isPending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      Validando acesso…
                    </>
                  ) : (
                    <>
                      Entrar na plataforma
                      <ArrowRight className="size-4" aria-hidden />
                    </>
                  )}
                </Button>
              </form>

              <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Check className="size-3.5 text-emerald-400" aria-hidden />
                Acesso restrito a usuários autorizados
              </div>
            </CardContent>
          </Card>

          <p className="mt-5 text-center text-[11px] leading-5 text-muted-foreground/70">
            Ao continuar, você confirma que está autorizado a acessar os dados desta operação.
          </p>
        </section>
      </div>
    </main>
  );
}
