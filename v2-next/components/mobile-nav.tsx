'use client';

// ════════════════════════════════════════════════════════════════════
// components/mobile-nav.tsx
//
// Botão hamburger + drawer lateral pra navegação em mobile (telas <lg).
// Reusa `<SidebarContent>` (mesmo conteúdo da sidebar desktop) dentro
// de um `<Sheet side="left">`.
//
// Comportamento:
//  - Só aparece em <lg (className="lg:hidden")
//  - Fecha automaticamente quando a rota muda (useEffect)
//  - Botão de 44x44px (Apple HIG mínimo pra touch)
// ════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { SidebarContent } from '@/components/sidebar';
import type { AuthUser } from '@/hooks/use-auth';

export function MobileNav({ user }: { user: AuthUser }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Fecha o drawer automaticamente quando a rota muda — UX padrão de
  // navegação mobile (clicou no link, o menu some).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden h-11 w-11 -ml-2"
          aria-label="Abrir menu"
        >
          <Menu className="w-5 h-5" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="p-0 w-72 sm:w-80"
        hideCloseButton
      >
        {/* Título invisível pra a11y (Radix exige) */}
        <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
        <SidebarContent user={user} />
      </SheetContent>
    </Sheet>
  );
}
