/** @type {import('next').NextConfig} */
const nextConfig = {
  // Reescreve rotas /api do V2 pra Edge Functions do V1 (motordeport.vercel.app)
  // Backend permanece o mesmo durante a migração — apenas o frontend muda.
  async rewrites() {
    // Em prod, aponta pro deployment original (que tem as Edge Functions /api/*)
    // Em dev, usa local se você rodar `vercel dev` na pasta root simultaneamente.
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://motordeport.vercel.app';
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
  reactStrictMode: true,
  // Otimização: imagens externas que vamos usar (logos de bancos etc)
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
};

export default nextConfig;
