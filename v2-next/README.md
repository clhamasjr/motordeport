# FlowForce V2 — Next.js Migration

Migração do FlowForce (`index.html` JavaScript vanilla na pasta root) pro stack moderno.

## Stack

- **Next.js 14** App Router
- **TypeScript** estrito
- **Tailwind CSS** + **shadcn/ui** + **Radix UI**
- **TanStack Query (React Query)** — cache + revalidate (mata polling)
- **Supabase Realtime** — WebSocket pra eventos do banco
- **react-hook-form + Zod** — forms + validação
- **sonner** — toasts

## Como rodar local

```bash
cd v2-next
npm install
cp .env.example .env.local
# preencha NEXT_PUBLIC_SUPABASE_ANON_KEY no .env.local
npm run dev
```

Abre http://localhost:3000

## Como deploy Vercel

Cria um novo projeto Vercel apontando pra esta pasta:

1. Vercel Dashboard → New Project → Import repo `clhamasjr/motordeport`
2. **Root Directory**: `v2-next/`
3. Framework Preset: Next.js (auto-detectado)
4. Environment Variables (importar do .env.example):
   - `NEXT_PUBLIC_BACKEND_URL=https://motordeport.vercel.app`
   - `NEXT_PUBLIC_SUPABASE_URL=https://xtyvnocvckbvhwvdwdpo.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>` (do Supabase → Settings → API)
5. Deploy

Domain inicial: `motordeport-v2.vercel.app` (ou nome que escolher).
Quando V2 estiver estável, redirecionar `motordeport.vercel.app` pra cá.

## Arquitetura

```
v2-next/
├── app/                         # App Router (Next.js 14+)
│   ├── (auth)/login/page.tsx    # Login (em construção)
│   ├── (app)/                   # Rotas autenticadas com sidebar
│   │   ├── clt/                 # CLT (consulta, esteira, catálogo, etc)
│   │   ├── inss/                # INSS (consulta, esteira, propostas)
│   │   ├── governos/            # SIAPE/Estaduais/Municipais
│   │   └── layout.tsx           # Sidebar + topbar
│   ├── layout.tsx               # Root + providers
│   ├── providers.tsx            # TanStack Query, Toaster
│   ├── globals.css              # Tailwind base + dark mode
│   └── page.tsx                 # Landing
├── components/
│   ├── ui/                      # shadcn/ui components
│   └── clt/                     # Componentes específicos CLT
├── lib/
│   ├── api.ts                   # Client HTTP pras Edge Functions V1
│   ├── supabase.ts              # Supabase client + auth
│   ├── realtime.ts              # WebSocket Realtime
│   └── utils.ts                 # Helpers (cn, formatCpf, formatBRL...)
└── hooks/                       # Custom hooks (useAuth, useFila, etc)
```

## Estratégia de migração

1. **Backend não muda** — Edge Functions `/api/*.js` permanecem no V1.
   `next.config.mjs` tem `rewrites` apontando `/api/*` pro deployment V1.
2. **Frontend migra tela por tela.**
3. **V1 continua rodando** — parceiros operam no V1 até V2 estar estável.
4. **Cutover**: quando V2 estável + auth integrado, redirecionar domínio.

## Status da migração

- [x] Setup base (Next.js + TS + Tailwind + TanStack Query)
- [x] Layout root + providers
- [ ] Auth (login com Supabase)
- [ ] Layout autenticado (sidebar + topbar)
- [ ] Consulta Unitária CLT (tela mais usada)
- [ ] Esteira CLT
- [ ] Catálogo de Bancos CLT
- [ ] Empresas Aprovadas CLT
- [ ] Extrair Base CAGED
- [ ] Painel de Consultas CLT
- [ ] Digitação CLT (modal por banco)
- [ ] INSS (todas as telas)
- [ ] Governos / SIAPE
- [ ] Prefeituras
- [ ] Cutover do domínio principal
