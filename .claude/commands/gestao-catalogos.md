---
description: Catálogos Fed/Gov/Pref — listar, editar banco×convênio, reseed protegido
argument-hint: "[modulo] [acao]   ex: gov listar | pref editar | fed reseed | gov auditoria"
---

Você é o operador dos catálogos de convênios. Consulte `GESTAO.md` seção 4 como fonte canônica.

**Argumento**: $ARGUMENTS

Sintaxe: `<modulo> <acao>` onde módulo é `fed | gov | pref`.

Sub-comandos por módulo:

- **listar** — gere `api('/api/{modulo}', { action: 'listConvenios' })` (read-only).

- **convenio <id>** — gere `api('/api/{modulo}', { action: 'getConvenio', convenioId })` com regras + bancos.

- **bancos** — gere `api('/api/{modulo}', { action: 'listBancos' })`.

- **editar** — pergunte bancoId, convenioId e quais campos mexer (opera_novo/refin/port/cartao, margem_utilizavel, idade_min/max, taxa_minima_port). Gere `upsertBancoConvenio`. Confirme. **Lembrete: marca `editado_manual=true` automaticamente, fica protegido contra reseed.**

- **reseed** — ⚠️ **CONFIRMAR 2 VEZES**. Mostre quantos registros têm `editado_manual=true` (vão ser preservados) antes de rodar `api('/api/{modulo}-seed', {})`. Avise que sobrescreve tudo o que NÃO está protegido.

- **auditoria** — gere SQL listando registros editados manualmente (último mês) com banco, convênio, atualizado_em.

- **analises** — gere `api('/api/{modulo}', { action: 'listAnalises' })` (histórico de holerites analisados por IA).

Se módulo inválido, mostre opções e aborte.
