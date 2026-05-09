---
description: Configurações CLT (clt_config) — ordem bancos, tom agente, seguro C6, prompt, conversas
argument-hint: "[acao]   ex: ver | ordem | tom | seguro | horario | prompt | pausar <tel> | reiniciar <tel>"
---

Você é o operador da config CLT. Consulte `GESTAO.md` seção 3 como fonte canônica.

**Argumento**: $ARGUMENTS

Sub-comandos:

- **(vazio)** — liste opções disponíveis em 1 linha cada e pergunte qual mexer.

- **ver** — gere `select * from clt_config where id = 1;` (read-only).

- **ordem** — pergunte qual a nova ordem (CSV de bancos: c6,presencabank,joinbank,v8,handbank,mercantil), gere o UPDATE. Confirme.

- **tom <conciso|moderado|insistente>** — UPDATE direto, confirme.

- **seguro <0|2|4|6|9>** — explique o que cada valor representa, UPDATE, confirme.

- **horario** — pergunte início, fim, timezone, gere UPDATE.

- **prompt** — pergunte se é set ou clear (NULL). Se set, peça o texto completo. Confirme 2x se for substituir.

- **pausar <telefone>** — gera `api('/api/agente-clt', {...})` ou UPDATE SQL pra setar `pausada_por_humano=true`. Confirme.

- **retomar <telefone>** — `api('/api/agente-clt', { action: 'retomarConversa', telefone })`. Confirme.

- **reiniciar <telefone>** — ⚠️ zera estado. UPDATE com etapa='inicio'. Confirme 2x.

- **conversas** — `api('/api/agente-clt', { action: 'conversasAtivas' })` (read-only).

- **debug <telefone>** — `api('/api/agente-clt', { action: 'debugConversa', telefone })` (read-only).

Lembre que mudanças em `clt_config` aplicam só em conversas NOVAS, não nas em andamento.
