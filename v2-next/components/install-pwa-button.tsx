'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Smartphone, X, Share } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

/** Evento de "beforeinstallprompt" do Chrome — interface nao tipada por default. */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

function isiOS() {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent || '';
  // iPad recente reporta como Mac — checa touch points
  const isIPad = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/.test(ua) || isIPad;
}

function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}

const DISMISSED_KEY = 'lhamas_pwa_install_dismissed_v1';

export function InstallPwaButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosDialog, setShowIosDialog] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setMounted(true);
    setDismissed(localStorage.getItem(DISMISSED_KEY) === '1');

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferredPrompt(null);
      localStorage.setItem(DISMISSED_KEY, '1');
      setDismissed(true);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall as EventListener);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall as EventListener);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!mounted) return null;
  if (isStandalone()) return null; // ja instalado
  if (dismissed && !isiOS()) return null;

  const podeInstalarChrome = !!deferredPrompt;
  const podeMostrarIos = isiOS() && !dismissed;

  // Nada pra mostrar (browser sem suporte e nao iOS)
  if (!podeInstalarChrome && !podeMostrarIos) return null;

  const onInstalar = async () => {
    if (podeInstalarChrome && deferredPrompt) {
      await deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      if (result.outcome === 'accepted') {
        localStorage.setItem(DISMISSED_KEY, '1');
      }
      setDeferredPrompt(null);
    } else if (podeMostrarIos) {
      setShowIosDialog(true);
    }
  };

  const onDispensar = () => {
    localStorage.setItem(DISMISSED_KEY, '1');
    setDismissed(true);
    setDeferredPrompt(null);
  };

  return (
    <>
      <div className="flex items-center gap-1">
        <Button onClick={onInstalar} size="sm" variant="outline" className="gap-1.5 h-8">
          <Smartphone className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Instalar app</span>
          <span className="sm:hidden">Instalar</span>
        </Button>
        <button
          onClick={onDispensar}
          className="text-muted-foreground hover:text-foreground transition-colors p-1"
          title="Dispensar"
          aria-label="Dispensar"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Dialog explicando como instalar no iPhone */}
      <Dialog open={showIosDialog} onOpenChange={setShowIosDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="w-5 h-5" /> Instalar no iPhone/iPad
            </DialogTitle>
            <DialogDescription>
              O Safari não tem botão automático. Faça assim:
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-3 text-sm pl-4 list-decimal">
            <li>
              Toque no botão <Share className="inline w-4 h-4 mx-0.5" /> <b>Compartilhar</b>
              {' '}na barra inferior do Safari.
            </li>
            <li>
              Role a lista e toque em <b>“Adicionar à Tela de Início”</b>.
            </li>
            <li>
              Confirme em <b>Adicionar</b>. O ícone aparece na tela inicial e abre
              em tela cheia, igual app nativo.
            </li>
          </ol>
          <div className="text-xs text-muted-foreground border-t border-border pt-3 mt-2">
            Funciona offline parcialmente e atualiza sozinho quando a gente faz deploy.
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
