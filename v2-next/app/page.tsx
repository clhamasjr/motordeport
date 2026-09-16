'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Zap } from 'lucide-react';
import { getToken } from '@/lib/api';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(getToken() ? '/inicio' : '/login');
  }, [router]);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6">
      <div className="aurora-bg" aria-hidden />
      <div className="flex flex-col items-center gap-4 text-center" role="status" aria-live="polite">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-aurora shadow-[0_12px_36px_-14px_hsl(var(--primary)/.9)] ring-1 ring-primary/30">
          <Zap className="size-5 text-primary-foreground" aria-hidden />
        </div>
        <div>
          <div className="font-semibold text-foreground">FlowForce</div>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
            Preparando seu ambiente…
          </div>
        </div>
      </div>
    </main>
  );
}
