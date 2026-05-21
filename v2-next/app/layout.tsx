import type { Metadata, Viewport } from 'next';
import { Providers } from './providers';
import { ServiceWorkerRegister } from './sw-register';
import './globals.css';

export const metadata: Metadata = {
  title: 'FlowForce — LhamasCred',
  description: 'Operação consignado INSS/CLT/Governos — LhamasCred',
  applicationName: 'LhamasCred',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'LhamasCred',
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
};

export const viewport: Viewport = {
  themeColor: '#3b82f6',
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
    <html lang="pt-BR" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ServiceWorkerRegister />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
