# FlowForce V2 — Guia de Migração (LEIA PRIMEIRO)

> **Cole este arquivo + o doc do módulo específico** no início de cada chat novo. O Claude vai ter o contexto completo pra continuar a migração sem precisar redescobrir nada.

## TL;DR

- **Repo**: `clhamasjr/motordeport`
- **V1 (legacy)**: `index.html` + `/api/*.js` Edge Functions Vercel rodando em `https://motordeport.vercel.app`
- **V2 (em migração)**: pasta `v2-next/` (Next.js 14 + TS + Tailwind + shadcn) deployado em `https://flowforce.tec.br` (Hostinger Docker Swarm)
- **Backend NÃO muda** — V2 usa rewrites pras Edge Functions do V1 (`next.config.mjs`)
- **Deploy automático**: `git push main` em arquivos `v2-next/**` → GitHub Actions builda Docker → ghcr.io → Watchtower (na VPS) puxa em ~60s

## Stack do V2

| Camada | Tech | Onde |
|---|---|---|
| Framework | Next.js 14 App Router + TypeScript estrito | `v2-next/` |
| UI | Tailwind CSS + shadcn/ui + Radix | `components/ui/` |
| Data fetching | TanStack Query 5 (cache + refetch on focus) | `hooks/` |
| Auth | Token V1 no localStorage (`ff_token`) + hook `useAuth` | `lib/api.ts` + `hooks/use-auth.ts` |
| Forms | react-hook-form + Zod (quando precisar) | -- |
| Toasts | sonner | já configurado em `app/providers.tsx` |
| Realtime | Supabase Realtime (futuro, ainda não usado) | -- |
| Deploy | Docker Swarm + Traefik + Let's Encrypt | `Dockerfile` + `docker-compose.yml` |

## Convenções obrigatórias (NÃO viole)

### Estrutura de pastas
```
v2-next/
├── app/(app)/MODULO/TELA/page.tsx   # cada tela
├── components/MODULO/X.tsx          # componentes específicos do módulo
├── components/ui/X.tsx              # shadcn primitives (NÃO criar novos sem necessidade real)
├── hooks/use-MODULO-X.ts            # 1 arquivo por feature (não juntar tudo num só)
├── lib/MODULO-types.ts              # interfaces TS espelhando tabelas/responses
└── lib/api.ts                       # NÃO mexer — cliente HTTP padrão
```

### Padrões de código
1. **NUNCA** use `fetch` direto. Use `api()` do `lib/api.ts` (já trata token + erros)
2. **NUNCA** use `useState` pra dados de servidor — TanStack Query (`useQuery`/`useMutation`)
3. **Polling**: use `refetchInterval` condicional (para quando concluído):
   ```ts
   refetchInterval: (query) => {
     return query.state.data?.status === 'concluido' ? false : 2000;
   }
   ```
4. **Mutations**: SEMPRE `onSuccess: invalidateQueries` + toast.success
5. **Loading state**: `<Skeleton>` (não spinner desorganizado)
6. **Erros**: card com `border-destructive/50` + ícone `AlertCircle`
7. **Cores**: Tailwind tokens (`text-green-400`, `text-bank-c6` etc — ver `tailwind.config.ts`)
8. **Formato de número/data**: helpers em `lib/utils.ts` (`formatCpf`, `formatBRL`, `formatCnpj`, `formatDateBR`, `cn`)

### Padrão de page.tsx
```tsx
'use client';
import { useState } from 'react';
import { useMinhaQuery } from '@/hooks/use-minha-feature';
import { Card, CardContent } from '@/components/ui/card';
// ... outros imports

export default function MinhaPage() {
  const { data, isLoading, error } = useMinhaQuery();

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">📚 Título</h1>
        <p className="text-sm text-muted-foreground mt-1">Descrição.</p>
      </div>
      {isLoading && <Skeleton className="h-20" />}
      {error && <Card className="border-destructive/50">...</Card>}
      {/* conteúdo */}
    </div>
  );
}
```

## Como rodar e deployar

### Local (dev)
```bash
cd v2-next
npm install
cp .env.example .env.local   # preencha NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run dev                  # http://localhost:3000
```

### Deploy automático
1. Faz commit em `v2-next/**`
2. Push pra `main`
3. **GitHub Actions** builda Docker (~3 min) → `ghcr.io/clhamasjr/flowforce-v2:latest`
4. **Watchtower** (na VPS) detecta nova imagem em ~60s e atualiza service Swarm
5. Total: ~5-7 min do push até estar no ar

### Forçar deploy manual (se Watchtower demorar)
```bash
ssh root@168.231.99.208
docker pull ghcr.io/clhamasjr/flowforce-v2:latest
docker service update --force --with-registry-auth --image ghcr.io/clhamasjr/flowforce-v2:latest flowforce_app
```

## Modelo a seguir: CLT (100% migrado)

Use estes arquivos como **referência absoluta** quando criar features novas:

| Padrão | Arquivo |
|---|---|
| Lista com filtros + KPIs + tabela | `app/(app)/clt/esteira/page.tsx` |
| Cards expansíveis | `app/(app)/clt/catalogo/page.tsx` + `components/clt/banco-card.tsx` |
| Form de busca → resultado | `app/(app)/clt/analise/page.tsx` |
| Polling inteligente em consulta | `app/(app)/clt/consulta/page.tsx` + `hooks/use-clt-fila.ts` |
| Lista + Modal Dialog | `app/(app)/clt/empresas-aprovadas/page.tsx` |
| Form modal pesado (sections) | `components/clt/modal-digitar.tsx` |
| Hooks de query/mutation | `hooks/use-clt-empresas.ts` (com mutation), `hooks/use-clt-bancos.ts` (só query) |
| Tipos | `lib/clt-types.ts`, `lib/clt-bancos-types.ts` |

## Sidebar e roteamento

Sidebar definida em `components/sidebar.tsx`. Pra adicionar nova rota:
1. Cria `app/(app)/MODULO/TELA/page.tsx`
2. Adiciona item no array `NAV` da sidebar
3. (opcional) `needsRole: ['admin', 'gestor']` se for restrito

Páginas atuais que são **stub "Em construção"** (precisam migrar):
- /clt/conversas ✅ migrada
- /inss/consulta · /inss/esteira · /inss/propostas
- /governos/federal · /governos/estaduais · /governos/municipais
- /prefeituras/catalogo
- /admin/usuarios · /admin/parceiros

## Auth — como funciona hoje

- Login em `/login` chama `/api/auth { action: 'login', user, pass }`
- Backend retorna `{ ok: true, token }` → `setToken(token)` no localStorage
- Todas as chamadas via `api()` enviam `Authorization: Bearer <token>` automaticamente
- `useAuth()` em `app/(app)/layout.tsx` valida via `action: 'me'` na 1ª carga
- Quem é o user: `useAuth().user` retorna `{ id, username, name, role, parceiro_id, ... }`

## Helpers prontos em `lib/`

- `api(path, body)` — chama Edge Function V1 (`POST` + token)
- `getToken()` / `setToken()` / `clearToken()`
- `cn(...classes)` — merge de Tailwind classes
- `formatCpf('12345678901')` → `123.456.789-01`
- `formatCnpj('12345678000100')` → `12.345.678/0001-00`
- `formatBRL(1234.56)` → `R$ 1.234,56`
- `formatDateBR('2026-05-14')` → `14/05/2026`

## Variáveis de ambiente

| Var | Onde | Pra que |
|---|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | build-time | URL das Edge Functions V1 |
| `NEXT_PUBLIC_SUPABASE_URL` | build-time | Projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | build-time | Acesso público (futuro Realtime) |
| `SUPABASE_SERVICE_KEY` | server-side | Operações admin (não usado ainda no V2) |

## Quando o Claude do novo chat começar

1. Leia este `MIGRATION_GUIDE.md` inteiro
2. Leia o doc específico do módulo (INSS.md, etc)
3. Antes de criar arquivo novo, confira se algum padrão equivalente já existe em `v2-next/components/clt/` ou `v2-next/hooks/`
4. **Faça commits pequenos e focados** (1 tela = 1 commit)
5. Sempre adicione `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` no fim do commit
6. Sempre push pra `main` — V2 deploya automático via Watchtower
7. Avise o usuário pra recarregar `https://flowforce.tec.br` após ~7 min do push

## Backend — endpoints V1 do FlowForce

Todos em `https://motordeport.vercel.app/api/*` (acessíveis via rewrite do Next.js):

| Endpoint | Pra que |
|---|---|
| `/api/auth` | login/logout/me/list/create/etc |
| `/api/clt-fila` | criar consulta CLT + status (polling) |
| `/api/clt-bancos` | listar bancos + analisar cliente |
| `/api/clt-esteira` | propostas digitadas |
| `/api/clt-empresas-aprovadas` | tracking de aprovações |
| `/api/clt-caged-extrair` | filtro 43.6M CPFs CAGED |
| `/api/clt-digitacao` | criar proposta no banco |
| `/api/clt-painel-consultas` | KPIs operacionais |
| `/api/clt-autorizacoes` | LGPD |
| `/api/agente-clt` | conversas IA WhatsApp |
| `/api/multicorban` | INSS — enriquece beneficiários |
| `/api/facta`, `/api/joinbank`, `/api/c6`, ... | bancos individuais |
| `/api/handbank` | UY3 |
| `/api/v8`, `/api/fintechdocorban` | provedores QITech/Celcoin |

Pra ver os actions de cada endpoint: `grep -nE "action ===" api/NOME.js`

## Observações finais

- **NUNCA** mexa em `index.html` do V1 — operação de produção tá lá
- **NUNCA** mude o nome de campo de body (V1 usa `user/pass` no auth, `success` em alguns, `ok` em outros — confere o handler antes)
- **NUNCA** force push em `main`
- Se um endpoint V1 não fizer o que precisa, melhor adicionar action nova no V1 do que tentar workaround no V2
