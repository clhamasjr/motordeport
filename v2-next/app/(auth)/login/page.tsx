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
  Command,
  Eye,
  EyeOff,
  Fingerprint,
  Layers3,
  Loader2,
  LockKeyhole,
  Radio,
  ScanLine,
  ShieldCheck,
} from 'lucide-react';

interface LoginResponse {
  ok: boolean;
  token?: string;
  user?: { id: number; user: string; name: string; role: string };
  error?: string;
}

const CAPABILITIES = [
  {
    code: '01',
    icon: Layers3,
    title: 'Operação multiproduto',
    description: 'INSS, CLT, FGTS e convênios em uma única camada operacional.',
  },
  {
    code: '02',
    icon: ScanLine,
    title: 'Jornadas orientadas',
    description: 'Comandos, etapas e próximas ações organizados por contexto.',
  },
  {
    code: '03',
    icon: ShieldCheck,
    title: 'Acesso governado',
    description: 'Cada perfil visualiza somente as ferramentas autorizadas.',
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
    <main className="brand-login-bg relative flex min-h-screen items-center justify-center overflow-hidden px-6">
      <div className="flex items-center gap-3 font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground" role="status">
        <Loader2 className="size-5 animate-spin text-[hsl(var(--brand-orange))]" aria-hidden />
        Preparando portal seguro…
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
    <main className="brand-login-bg relative min-h-screen overflow-hidden">
      <div className="brand-login-grid" aria-hidden />
      <div className="brand-login-chevron" aria-hidden />

      <div className="relative grid min-h-screen lg:grid-cols-[minmax(0,1.18fr)_minmax(430px,.82fr)]">
        <section className="relative hidden min-h-screen flex-col justify-between overflow-hidden border-r border-border/75 px-10 py-8 lg:flex xl:px-16 xl:py-10" aria-labelledby="login-intro-title">
          <div className="brand-login-orbit" aria-hidden />

          <header className="relative z-10 flex items-center justify-between gap-6">
            <BrandSignature />
            <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.18em] text-[hsl(var(--brand-silver))]">
              <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_hsl(142_70%_50%/.8)]" aria-hidden />
              Secure node / online
            </div>
          </header>

          <div className="relative z-10 my-auto max-w-3xl py-12">
            <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[hsl(var(--brand-orange))]">
              <span className="h-px w-10 bg-[hsl(var(--brand-orange))]" aria-hidden />
              Operação LhamasCred
            </div>
            <h1 id="login-intro-title" className="mt-7 max-w-3xl text-5xl font-semibold leading-[1.02] tracking-[-0.06em] text-foreground xl:text-7xl">
              O centro de comando da sua <span className="text-[hsl(var(--brand-silver))]">operação de crédito.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground xl:text-lg">
              O FlowForce conecta produtos, jornadas e equipes em uma experiência operacional desenvolvida para a LhamasCred.
            </p>

            <div className="mt-12 max-w-3xl border-y border-border/70">
              {CAPABILITIES.map(({ code, icon: Icon, title, description }) => (
                <div key={code} className="grid min-h-[96px] grid-cols-[42px_42px_1fr] items-center gap-4 border-b border-border/60 py-4 last:border-b-0">
                  <span className="font-mono text-[10px] text-[hsl(var(--brand-orange))]">{code}</span>
                  <span className="flex size-10 items-center justify-center border border-border/80 bg-card/40 text-[hsl(var(--brand-silver))]">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-foreground">{title}</span>
                    <span className="mt-1 block text-sm leading-5 text-muted-foreground">{description}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <footer className="relative z-10 flex items-center justify-between gap-6 border-t border-border/65 pt-5 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            <span>FlowForce Command Center</span>
            <span className="text-[hsl(var(--brand-orange))]">Powered by LhamasCred</span>
          </footer>
        </section>

        <section className="relative flex min-h-screen items-center justify-center px-4 py-6 sm:px-8 lg:px-10 xl:px-16" aria-labelledby="login-title">
          <div className="w-full max-w-[480px]">
            <div className="mb-8 lg:hidden">
              <BrandSignature compact />
              <div className="mt-8 border-l-2 border-[hsl(var(--brand-orange))] pl-4">
                <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[hsl(var(--brand-orange))]">FlowForce Command Center</div>
                <p className="mt-2 text-lg font-semibold leading-6 text-foreground">O centro de comando da operação LhamasCred.</p>
              </div>
            </div>

            <div className="mb-5 flex items-center justify-between gap-4 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
              <span>Authentication gateway / 01</span>
              <span className="flex items-center gap-2 text-primary"><Radio className="size-3" aria-hidden />System live</span>
            </div>

            <div className="brand-auth-panel relative overflow-hidden border border-border/85 bg-[hsl(var(--card)/.82)]">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-[hsl(var(--brand-orange))] via-[hsl(var(--brand-silver))] to-primary" aria-hidden />
              <div className="border-b border-border/70 p-6 sm:p-8">
                <div className="flex items-center gap-4">
                  <div className="command-mark flex size-12 items-center justify-center bg-[hsl(var(--brand-orange))] text-black">
                    <Command className="size-5" aria-hidden />
                  </div>
                  <div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-lg font-extrabold uppercase tracking-[0.08em] text-foreground">FlowForce</span>
                      <span className="font-mono text-[9px] text-primary">CC</span>
                    </div>
                    <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">by LhamasCred</div>
                  </div>
                </div>

                <div className="mt-9">
                  <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.16em] text-[hsl(var(--brand-orange))]"><Fingerprint className="size-3.5" aria-hidden />Identificação segura</div>
                  <h2 id="login-title" className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-foreground">Acesse sua operação</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">Informe suas credenciais autorizadas para abrir o Command Center.</p>
                </div>
              </div>

              <form onSubmit={onSubmit} className="p-6 sm:p-8" aria-busy={isPending}>
                {formError && (
                  <div id="login-error" role="alert" className="mb-6 flex items-start gap-3 border border-destructive/35 bg-destructive/10 px-4 py-3 text-sm leading-5 text-destructive">
                    <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>{formError}</span>
                  </div>
                )}

                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor="username" className="font-mono text-[10px] uppercase tracking-[0.14em] text-[hsl(var(--brand-silver))]">01 / Usuário ou e-mail</Label>
                    <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Required</span>
                  </div>
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
                    className="h-13 rounded-none border-border/85 bg-background/65 px-4 text-base focus-visible:border-[hsl(var(--brand-orange))] focus-visible:ring-[hsl(var(--brand-orange))]"
                    autoFocus
                  />
                </div>

                <div className="mt-5 space-y-2.5">
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor="password" className="font-mono text-[10px] uppercase tracking-[0.14em] text-[hsl(var(--brand-silver))]">02 / Senha</Label>
                    <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Encrypted</span>
                  </div>
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
                      className="h-13 rounded-none border-border/85 bg-background/65 px-4 pr-12 text-base focus-visible:border-[hsl(var(--brand-orange))] focus-visible:ring-[hsl(var(--brand-orange))]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((visible) => !visible)}
                      className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--brand-orange))]"
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                      aria-pressed={showPassword}
                      disabled={isPending}
                    >
                      {showPassword ? <EyeOff className="size-4.5" aria-hidden /> : <Eye className="size-4.5" aria-hidden />}
                    </button>
                  </div>
                </div>

                <Button type="submit" size="lg" className="mt-7 h-13 w-full rounded-none bg-[hsl(var(--brand-orange))] font-semibold text-black shadow-none hover:bg-[hsl(var(--brand-orange)/.9)] hover:shadow-none" disabled={isPending}>
                  {isPending ? (
                    <><Loader2 className="size-4 animate-spin" aria-hidden />Validando acesso…</>
                  ) : (
                    <><span>Entrar no Command Center</span><ArrowRight className="size-4" aria-hidden /></>
                  )}
                </Button>

                <div className="mt-6 flex items-center justify-center gap-2 font-mono text-[9px] uppercase tracking-[0.13em] text-muted-foreground">
                  <Check className="size-3.5 text-emerald-400" aria-hidden />
                  Acesso restrito a usuários autorizados
                </div>
              </form>
            </div>

            <p className="mt-5 text-center text-[11px] leading-5 text-muted-foreground/70">Ao continuar, você confirma que está autorizado a acessar os dados desta operação.</p>
          </div>
        </section>
      </div>
    </main>
  );
}

function BrandSignature({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <Image src="/brand/lhamascred-mark.png" alt="" width={143} height={191} className={compact ? 'h-12 w-auto' : 'h-14 w-auto'} priority />
      <div>
        <div className="brand-wordmark text-xl font-black italic leading-none tracking-[-0.045em] sm:text-2xl">LHAMASCRED</div>
        <div className="mt-1 font-mono text-[8px] uppercase tracking-[0.22em] text-[hsl(var(--brand-silver))]">Promotora de crédito</div>
      </div>
    </div>
  );
}
