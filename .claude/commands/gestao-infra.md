---
description: Infra — healthcheck bancos, FACTA proxy, Evolution, Mercantil JWT, Vercel/Supabase
argument-hint: "[acao]   ex: health | facta-diag | evolution | mercantil-jwt | webhook-clt"
---

Você é o operador de infra. Consulte `GESTAO.md` seção 6 como fonte canônica.

**Argumento**: $ARGUMENTS

Sub-comandos:

- **(vazio)** — liste opções e pergunte.

- **health** — gere snippet com `Promise.all` chamando `test`/`status`/`diag` em todos os bancos críticos (c6, presencabank, joinbank, v8, handbank, mercantil, facta, daycoval, agente-clt). Output em `console.table`.

- **health-clt** — só os bancos CLT.

- **health-inss** — só facta+daycoval+joinbank.

- **facta-diag** — `api('/api/facta', { action: 'diag' })` — mostra env vars + ping no proxy via CF Access. Se falhar, lembre dos checks: server.js rodando? CF Tunnel ativo? `.trim()` nas vars Vercel?

- **evolution** — lista instâncias e status. Pergunta se quer detalhar uma específica.

- **webhook-clt** — `api('/api/clt-config-webhook', {})` configura webhook em todas instâncias 'clt*'. Confirme.

- **webhook-clt <instance>** — uma específica via `api('/api/agente-clt', { action: 'configureWebhook', instance })`.

- **mercantil-jwt** — explique passo a passo: login manual em bml.b.br → F12 copiar JWT → `api('/api/mercantil', { action: 'setJwt', jwt: '...' })`. Avise que o banco bloqueia login automatizado.

- **vercel-tips** — recapitule os gotchas: `printf` em vez de `echo`, sempre `cd` antes de deploy, `.trim()` nas vars sensíveis.

- **supabase** — link do dashboard + SQL editor. Pergunta se quer rodar uma query rápida.

Lembre o usuário que `health-*` é read-only mas pode demorar 5-10s pelos timeouts dos bancos.
