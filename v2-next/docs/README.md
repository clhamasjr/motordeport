# Como usar estes docs

Cada arquivo aqui é um **prompt completo** pra colar no início de um chat novo do Claude (Claude.ai ou Claude Code) que vai migrar uma parte específica do FlowForce V2.

## Fluxo recomendado

1. Abre chat novo
2. Cola o conteúdo de **`MIGRATION_GUIDE.md`** primeiro (contexto geral)
3. Em seguida cola o doc do **módulo específico** (INSS.md, GOVERNOS.md, etc)
4. Diz pro Claude: "Migre [TELA]" — ele vai ter contexto pra começar

## Docs disponíveis

| Arquivo | Pra qual chat |
|---|---|
| `MIGRATION_GUIDE.md` | Sempre primeiro — contexto técnico + padrões |
| `INSS.md` | Chat de migração INSS (3 telas) |
| `GOVERNOS.md` | Chat de migração Governos Federal/Estaduais/Municipais (3 telas) |
| `PREFEITURAS.md` | Chat de migração Prefeituras (1 tela) |
| `ADMIN.md` | Chat de migração Admin Usuários/Parceiros (2 telas) |

## Atalho — texto pronto pra colar no chat

> Olá! Vou migrar o módulo **[INSS / Governos / Prefeituras / Admin]** do FlowForce V2.
> 
> Contexto técnico completo do projeto:
> 
> [COLA aqui o conteúdo de `MIGRATION_GUIDE.md`]
> 
> ---
> 
> Específico deste módulo:
> 
> [COLA aqui o conteúdo de `[MODULO].md`]
> 
> ---
> 
> Pode começar pela tela `[NOME DA TELA]`.

## Como atualizar estes docs

Quando uma tela for migrada, marca como ✅ no doc do módulo. Se descobrir algum padrão novo durante a migração, atualiza o `MIGRATION_GUIDE.md`. Mantém os docs sempre alinhados com o estado real do código.
