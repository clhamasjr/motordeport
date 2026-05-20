import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Providers } from './providers';
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
  title: 'FlowForce — Plataforma de Crédito',
  description: 'Operação consignado INSS/CLT/Governos — LhamasCred',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={`dark ${fontSans.variable} ${fontMono.variable}`}>
      <body className="min-h-screen bg-background text-foreground antialiased font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
