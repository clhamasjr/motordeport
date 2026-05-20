'use client';

import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import { useAuth } from '@/hooks/use-auth';
import { Loader2 } from 'lucide-react';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="aurora-bg" aria-hidden />
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen flex relative">
      <div className="aurora-bg" aria-hidden />
      <Sidebar user={user} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar user={user} />
        <main className="flex-1 overflow-auto scrollbar-thin">{children}</main>
      </div>
    </div>
  );
}
