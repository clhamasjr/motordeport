import type { MetadataRoute } from 'next';

/**
 * Web App Manifest — torna o V2 instalavel como PWA.
 *
 * Pra trocar nome/cor/icones:
 *  - Texto: edita aqui
 *  - Icones: substitui PNGs em public/icons/ (mantem nomes)
 *  - Logo: rode novamente o script Python em scripts/gerar-icones.py
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'LhamasCred — FlowForce',
    short_name: 'LhamasCred',
    description: 'Plataforma de operação consignado: INSS, CLT, Governos e Prefeituras.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#0f172a',
    theme_color: '#3b82f6',
    lang: 'pt-BR',
    categories: ['business', 'finance', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
