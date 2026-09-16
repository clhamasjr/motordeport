'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import { EmptyState, ErrorState, LoadingState } from '@/components/system-state';
import { useAuth } from '@/hooks/use-auth';
import { canAccessItem, itemDoPath } from '@/lib/nav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, isLoading, isRedirecting, error, retry } = useAuth();

  if (isLoading || isRedirecting) {
    return (
      <div className="command-shell relative min-h-screen">
        <div className="command-bg" aria-hidden />
        <LoadingState
          className="min-h-screen"
          title={isRedirecting ? 'Redirecionando para o acesso' : 'Carregando sua sessão'}
          description={isRedirecting ? 'Aguarde enquanto preparamos uma nova autenticação.' : 'Estamos validando seu acesso e preparando a operação.'}
        />
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="command-shell relative flex min-h-screen items-center justify-center p-5">
        <div className="command-bg" aria-hidden />
        <ErrorState
          className="relative w-full max-w-lg"
          title="Não foi possível carregar sua sessão"
          description="Verifique sua conexão e tente novamente. Seus dados de acesso não foram alterados."
          onRetry={() => void retry()}
        />
      </div>
    );
  }

  const currentItem = itemDoPath(pathname);
  if (currentItem && !canAccessItem(currentItem, user.role)) {
    return (
      <div className="command-shell relative flex min-h-screen items-center justify-center p-5">
        <div className="command-bg" aria-hidden />
        <EmptyState
          className="relative w-full max-w-lg"
          title="Acesso não disponível"
          description="Seu perfil não possui permissão para esta ferramenta. Nenhum dado da página foi carregado."
          action={
            <Link href="/inicio" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
              <ArrowLeft className="size-4" aria-hidden />
              Voltar ao início
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="command-shell relative flex min-h-screen">
      <div className="command-bg" aria-hidden />
      <a
        href="#conteudo-principal"
        className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform focus:translate-y-0"
      >
        Ir para o conteúdo
      </a>
      <Sidebar user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} />
        <main id="conteudo-principal" className="command-main flex-1 overflow-auto scrollbar-thin">
          {children}
        </main>
      </div>
    </div>
  );
}
