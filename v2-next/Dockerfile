# ════════════════════════════════════════════════════════════════════
# FlowForce V2 — Dockerfile multi-stage
# Build: ~1GB → Final image: ~150MB (standalone Next.js)
# Roda na VPS Hostinger via Docker Swarm + Traefik.
# ════════════════════════════════════════════════════════════════════

# ─── Stage 1: dependencies ──────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Apenas instala deps — separado pra cache Docker reusar quando só
# código mudou (sem mexer em package.json).
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev=false

# ─── Stage 2: build ─────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Variáveis NEXT_PUBLIC_* são embarcadas no build — pegamos do build arg
ARG NEXT_PUBLIC_BACKEND_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_BACKEND_URL=${NEXT_PUBLIC_BACKEND_URL}
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ─── Stage 3: runner (imagem final, mínima) ─────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Cria user nao-root pra rodar (security)
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Copia apenas o build standalone + assets publicos
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# Healthcheck pra Traefik/Swarm saber se container tá vivo
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

CMD ["node", "server.js"]
