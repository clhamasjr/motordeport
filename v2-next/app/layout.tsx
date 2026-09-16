import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Providers } from './providers';
import { ServiceWorkerRegister } from './sw-register';
import './globals.css';

const fontSans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const fontMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'FlowForce — LhamasCred',
  description: 'Plataforma de operação de crédito da LhamasCred.',
  applicationName: 'FlowForce',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'FlowForce',
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  // `apple-mobile-web-app-capable` (gerado por `appleWebApp.capable`) foi
  // marcado como deprecated pelo Chrome em 2024 — o padrão atual é
  // `mobile-web-app-capable`. Mantemos os dois pra cobrir iOS Safari (antigo)
  // e Chrome (novo).
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f1eb' },
    { media: '(prefers-color-scheme: dark)', color: '#101116' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={`${fontSans.variable} ${fontMono.variable}`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var r=document.documentElement,k='flowforce-workspace-theme',s=localStorage.getItem(k),t=s==='light'||s==='dark'?s:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');r.dataset.workspaceTheme=t;r.classList.toggle('dark',t==='dark');r.style.colorScheme=t;r.dataset.sidebarCollapsed=localStorage.getItem('flowforce-sidebar-collapsed')==='1'?'1':'0';}catch(e){var r=document.documentElement;r.dataset.workspaceTheme='light';r.classList.remove('dark');r.style.colorScheme='light';r.dataset.sidebarCollapsed='0';}})();`,
          }}
        />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased font-sans">
        <ServiceWorkerRegister />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
