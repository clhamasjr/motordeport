# FlowForce V2 — Next.js + Hostinger Swarm

Migração do FlowForce (`index.html` JavaScript vanilla) pro stack moderno
**hospedado na VPS Hostinger própria** (CBDW: 168.231.99.208), aproveitando
a infra Docker Swarm + Traefik + Postgres já rodando.

## Por que Hostinger e não Vercel

- ✅ **Custo R$ 0 adicional** — VPS já tá paga (Evolution, Chatwoot, N8N
  rodam aí)
- ✅ Sem cold start, sem timeout de função (60s/300s do Vercel não atrapalha)
- ✅ WebSocket nativo (não depende de Supabase Realtime obrigatório)
- ✅ Mesma rede que Evolution/N8N → latência 1ms entre serviços
- ✅ Deploy git push igual Vercel (via GitHub Actions)

## Stack

- **Next.js 14** App Router + standalone build
- **TypeScript** estrito
- **Tailwind CSS** + **shadcn/ui** + **Radix UI**
- **TanStack Query** — cache + revalidate (mata polling)
- **Supabase** (auth + Postgres + Realtime)
- **react-hook-form + Zod** — forms + validação
- **sonner** — toasts
- **Docker** multi-stage build → image final ~150MB
- **Traefik** v2/v3 — SSL automático Let's Encrypt
- **GitHub Actions** — deploy automático on push

## Domínio

- **Produção**: `flowforce.tec.br` (a adquirir)
- **Apontamento DNS** (registrar no provedor do domínio):
  ```
  A     @     168.231.99.208
  A     www   168.231.99.208
  ```
- Traefik gera certificado SSL automaticamente após DNS propagar.

## Deploy automático (GitHub Actions)

Toda mudança em `v2-next/**` na branch main dispara:
1. Build da Docker image multi-stage
2. Push pra GitHub Container Registry (`ghcr.io/clhamasjr/flowforce-v2`)
3. SSH na VPS → `docker service update` (zero-downtime, start-first)

### Secrets a configurar no GitHub

Em `Settings > Secrets and variables > Actions`:

| Secret | Valor |
|---|---|
| `VPS_HOST` | `168.231.99.208` |
| `VPS_USER` | `root` |
| `VPS_SSH_KEY` | chave privada SSH (gerar com `ssh-keygen -t ed25519`, colar a privada aqui e adicionar a pública em `~/.ssh/authorized_keys` da VPS) |
| `SUPABASE_ANON_KEY` | anon public key do Supabase (Settings > API) |

## Setup inicial na VPS (1 vez só)

SSH na VPS:

```bash
ssh root@168.231.99.208
```

### 1. Garantir que Swarm está ativo
```bash
docker info | grep "Swarm: active" || docker swarm init
```

### 2. Garantir que rede traefik-public existe
```bash
docker network ls | grep traefik-public || \
  docker network create -d overlay --attachable traefik-public
```

### 3. Configurar variáveis de ambiente do stack
```bash
mkdir -p /opt/flowforce
cat > /opt/flowforce/.env <<'EOF'
SUPABASE_ANON_KEY=<cola aqui a anon key do Supabase>
SUPABASE_SERVICE_KEY=<cola aqui a service_role key do Supabase>
EOF
chmod 600 /opt/flowforce/.env
```

### 4. Login no GitHub Container Registry
Cria um Personal Access Token (PAT) em https://github.com/settings/tokens
com escopo `read:packages`. Depois:
```bash
echo "<seu_token_PAT>" | docker login ghcr.io -u clhamasjr --password-stdin
```

### 5. Deploy inicial
```bash
cd /opt/flowforce
curl -O https://raw.githubusercontent.com/clhamasjr/motordeport/main/v2-next/docker-compose.yml
docker stack deploy --with-registry-auth -c docker-compose.yml flowforce
```

### 6. Verificar
```bash
docker service ls | grep flowforce
docker service logs -f flowforce_app
```

Após o DNS propagar, abre `https://flowforce.tec.br` — Traefik gera SSL na primeira requisição.

## Como rodar local (dev)

```bash
cd v2-next
npm install
cp .env.example .env.local
# preencha NEXT_PUBLIC_SUPABASE_ANON_KEY no .env.local
npm run dev
```

Abre http://localhost:3000

## Estrutura

```
v2-next/
├── app/                          # App Router
│   ├── (auth)/login/page.tsx     # Login
│   ├── (app)/                    # Rotas autenticadas
│   │   ├── clt/                  # CLT
│   │   ├── inss/                 # INSS
│   │   ├── governos/             # Federal/Estadual/Municipal
│   │   └── layout.tsx            # Sidebar + topbar
│   ├── layout.tsx                # Root + providers
│   ├── providers.tsx             # TanStack Query, Toaster
│   └── globals.css               # Tailwind + dark mode
├── components/                   # ui/ (shadcn) + clt/ + inss/
├── lib/
│   ├── api.ts                    # Cliente HTTP pras Edge Functions V1
│   ├── supabase.ts               # Supabase client + auth
│   └── utils.ts                  # cn, formatCpf, formatBRL...
├── Dockerfile                    # Multi-stage build (~150MB final)
├── docker-compose.yml            # Stack Swarm com labels Traefik
└── next.config.mjs               # standalone + rewrites /api
```

## Status da migração

- [x] Setup base (Next.js + TS + Tailwind + TanStack Query)
- [x] Dockerfile + docker-compose Swarm + GitHub Actions
- [ ] Auth (login com Supabase)
- [ ] Layout autenticado (sidebar + topbar)
- [ ] Consulta Unitária CLT
- [ ] Esteira CLT
- [ ] Catálogo de Bancos CLT
- [ ] Empresas Aprovadas CLT
- [ ] Extrair Base CAGED
- [ ] Painel de Consultas CLT
- [ ] Digitação CLT (modal por banco)
- [ ] INSS (todas as telas)
- [ ] Governos / SIAPE / Estaduais / Municipais
- [ ] Prefeituras
- [ ] Migração do backend Edge Functions → Next.js API routes (autonomia total)
- [ ] Cutover do domínio (V2 vira primário)
