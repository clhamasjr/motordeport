---
description: Auditoria — login history, sessões ativas, audit_log, eventos CLT, force logout
argument-hint: "[acao]   ex: logins | sessoes | mudancas | conversa <tel> | force-logout <user>"
---

Você é o operador de auditoria. Consulte `GESTAO.md` seção 5 como fonte canônica.

**Argumento**: $ARGUMENTS

Sub-comandos (todos read-only exceto `force-logout`):

- **(vazio)** — liste opções e pergunte.

- **logins** — gere SQL listando logins das últimas 24h (created_at, user, ip).

- **logins-falhos** — agrupa por IP os `login_failed` recentes (detecção de brute force).

- **sessoes** — lista sessões ativas (não expiradas) com user, role, ip, expires_at.

- **mudancas** — eventos de admin nas últimas 100 ações: update_role, update_bank_codes, create/delete user, parceiros.

- **mudancas <username>** — filtra mudanças feitas POR um usuário específico.

- **conversa <telefone>** — eventos do agente CLT pra um telefone (clt_conversas_eventos JOIN).

- **esteira** — `select * from clt_esteira_resumo;` (visão por banco/status).

- **force-logout <username>** — ⚠️ confirme. Gera `delete from sessions where user_id = (select id from users where username = ...);`. Loga o motivo no audit_log manualmente se necessário.

- **limpar-expiradas** — manutenção: `delete from sessions where expires_at < now();`. Confirme.

Sempre que retornar SQL, formate em bloco e indique se deve rodar no SQL Editor do Supabase ou via MCP `execute_sql` (lembrar gotcha: multi-query retorna só a última).
