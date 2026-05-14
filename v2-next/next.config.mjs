/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone: build minimo pra Docker (server.js + node_modules necessarios)
  // Reduz imagem Docker de ~1GB pra ~150MB.
  output: 'standalone',

  // Durante a migração, /api/* aponta pras Edge Functions do V1 ainda no
  // Vercel (motordeport.vercel.app). Quando migrarmos o backend pra Next.js
  // API routes na propria VPS, removemos essa reescrita.
  async rewrites() {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://motordeport.vercel.app';
    return [
      { source: '/api/:path*', destination: `${backendUrl}/api/:path*` },
    ];
  },

  reactStrictMode: true,
  poweredByHeader: false,

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
};

export default nextConfig;
