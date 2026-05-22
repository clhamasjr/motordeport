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
    // Cor da barra de status do app standalone — casa com o background dark
    // do tema. Antes era #3b82f6 (azul primary), trocado pra ficar consistente
    // com `viewport.themeColor` em app/layout.tsx.
    background_color: '#0a0e1a',
    theme_color: '#0a0e1a',
    lang: 'pt-BR',
    categories: ['business', 'finance', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // Atalhos rápidos no long-press do ícone (Android/Chrome). iOS ignora.
    // Mantém a lista curta: mais que 4 fica caótico e nem todos OS exibem todos.
    shortcuts: [
      {
        name: 'Consulta INSS',
        short_name: 'INSS',
        description: 'Consulta unitária de aposentado/pensionista',
        url: '/inss/consulta',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Consulta CLT',
        short_name: 'CLT',
        description: 'Consulta multi-banco para trabalhador CLT',
        url: '/clt/consulta',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Sofia — Conversas',
        short_name: 'Sofia',
        description: 'Atendimento INSS no WhatsApp',
        url: '/inss/conversas',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Orquestrador',
        short_name: 'Orquestrador',
        description: 'Painel de governança (admin)',
        url: '/orquestrador',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
    // TODO (Fase 2.1 — requer PNGs):
    //   - screenshots: 1 mobile (narrow) + 1 desktop (wide) pra Chrome
    //     mostrar preview no diálogo de instalação
    //   - splash screens iOS: PNGs por resolução fixa (iPhone X, 14 Pro,
    //     iPad, iPad Pro etc.). Sem isso, iOS mostra splash branco.
  };
}
