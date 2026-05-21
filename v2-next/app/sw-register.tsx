'use client';

import { useEffect } from 'react';

/**
 * Registra o Service Worker (PWA). So roda em producao pra nao atrapalhar dev.
 * Pra forcar update local: DevTools > Application > Service Workers > Unregister.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    const register = async () => {
      try {
        await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      } catch (e) {
        // silencia falha (sem internet, etc) — PWA continua funcional sem SW
      }
    };

    // Espera carregar o resto da pagina pra nao competir por banda
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
