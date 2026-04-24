# ☀️ Acorda Rápido — 15 min pra deixar a F3 no ar

Seguinte, dono. Enquanto você dormia eu entreguei a F3 **completa e local**. Nada foi pushado, nada foi deployado, nada foi aplicado no Supabase. Quando você confirmar, em **15 minutos** tá no ar.

## 📦 O que foi entregue (local, commit pendente)

| Arquivo | O que é | Status |
|---|---|---|
| `supabase_migration_clt.sql` | Migration: tabela `clt_conversas` + `clt_conversas_eventos` | Arquivo pronto, não aplicado |
| `api/agente-clt.js` | Cérebro do agente — recebe webhook Evolution, chama Claude 4.5, chama os 3 bancos, responde cliente | Arquivo pronto, não pushado |
| `ENV_VARS.md` | Atualizado com 4 env vars novas da F3 | Pronto, não commitado |
| `HISTORICO_PROJETO.md` | F3 documentada | Pronto, não commitado |
| `ACORDA_RAPIDO.md` | Este arquivo | Pronto |

## ✅ Passo 1 — Revisar o commit local (1 min)

```bash
cd C:\Users\clham\Documents\motordeport
git status
git diff --stat
```

Se tudo parecer OK, me autoriza **"pode pushar f3"** e eu subo.

## ✅ Passo 2 — Aplicar migration no Supabase (2 min)

1. Abre https://supabase.com/dashboard/project/rirsmtyuyqxsoxqbgtpu/sql
2. Cola o conteúdo de `supabase_migration_clt.sql`
3. Clica **Run**
4. Deve criar 2 tabelas (`clt_conversas` + `clt_conversas_eventos`), 5 indexes e 1 trigger
5. Verifica: `select count(*) from clt_conversas;` → deve retornar `0`

## ✅ Passo 3 — Criar instance Evolution dedicada CLT (3 min)

No FlowForce logado:
1. Aba WhatsApp → **Nova Instance**
2. Nome: `lhamas-clt` (ou outro, mas anote)
3. Escaneia o QR com o chip/número que vai atender os leads CLT
4. Aguarda status "connected"

## ✅ Passo 4 — Configurar 4 env vars novas na Vercel (5 min)

Abre https://vercel.com → `flowforce` → Settings → Environment Variables → **Import .env** (atalho):

```env
APP_URL=https://flowforce.vercel.app
CLT_EVOLUTION_INSTANCE=lhamas-clt
CLT_WHATSAPP_WHITELIST=<SEU_NUMERO_PRA_TESTAR,ex:5515999111111>
INTERNAL_SERVICE_TOKEN=<GERAR_PASSO_5>
```

### ⚠️ Sobre o `INTERNAL_SERVICE_TOKEN` (passo 5)

O agente precisa chamar `/api/c6`, `/api/presencabank`, `/api/joinbank` internamente, e esses endpoints exigem sessão autenticada. A solução mais segura:

1. **Faz login normal no FlowForce** (com um usuário admin ou cria um usuário dedicado `agente-clt@lhamascred.com.br`)
2. **F12 → Application → Local Storage → seleciona `flowforce.vercel.app` → copia o valor de `ff_token`**
3. Cola em `INTERNAL_SERVICE_TOKEN` na Vercel
4. **Atenção**: se esse token expirar (sessão tem TTL), o agente para de funcionar. Renova quando acontecer, ou me pede pra fazer um refresh automático.

**Alternativa mais robusta (pra depois)**: crio uma rota `/api/agente-clt?action=healthcheck` que autentica via `WEBHOOK_SECRET` (header) em vez de `Bearer`. Aí não depende de sessão. Anoto como F3.1 e faço quando você pedir.

## ✅ Passo 5 — Redeploy (1 min)

Deployments → último deploy → ⋯ → Redeploy.

## ✅ Passo 6 — Configurar o webhook no Evolution (1 min)

No FlowForce (ainda logado), F12 → Console, cola:

```javascript
(async () => {
  const r = await fetch('/api/agente-clt', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + localStorage.getItem('ff_token')
    },
    body: JSON.stringify({ action: 'configureWebhook', instance: 'lhamas-clt' })
  });
  console.log(await r.json());
})();
```

Deve retornar `success: true` com o webhookUrl apontando pra `https://flowforce.vercel.app/api/agente-clt`.

## ✅ Passo 7 — Teste end-to-end (2 min)

### 7.a — Healthcheck:
```javascript
(async () => {
  const r = await fetch('/api/agente-clt', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + localStorage.getItem('ff_token')
    },
    body: JSON.stringify({ action: 'test' })
  });
  console.log(await r.json());
})();
```

Esperado: `claude: ok`, `supabase: ok`, `evolution: ok`.

### 7.b — Primeira conversa real:
1. Pega o seu celular (ou o número que você colocou em `CLT_WHATSAPP_WHITELIST`)
2. Manda "oi" pro número do WhatsApp CLT (o que você conectou no passo 3)
3. Aguarda ~3s
4. O agente deve responder se apresentando como **Volt** e pedindo seu CPF

### 7.c — Simular fluxo completo:
- Você manda: CPF → agente chama C6/PresençaBank/JoinBank → se algum tem oferta, apresenta
- Se for C6, agente manda link de autorização LGPD antes de simular detalhes
- Depois da sua autorização, agente mostra a melhor oferta ordenada por valor líquido
- Você aceita, ele pede dados faltantes (endereço, conta etc.)
- Quando tiver tudo, cria proposta e manda o link de formalização

### 7.d — Acompanhar no dashboard:
```javascript
(async () => {
  const r = await fetch('/api/agente-clt', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + localStorage.getItem('ff_token')
    },
    body: JSON.stringify({ action: 'conversasAtivas' })
  });
  console.table((await r.json()).conversas);
})();
```

## 🚨 Pontos que eu quero que você valide comigo antes de abrir pra leads reais

1. **Tom do Volt** — leia o SYSTEM_PROMPT em `api/agente-clt.js` (linha ~30-130). Se quiser mudar tom, nome, argumentos, me fala.
2. **Priorização de ofertas** — hoje tá "maior valor líquido pro cliente". Quer trocar pra "maior comissão Lhamas"? Me fala.
3. **Número WhatsApp CLT** — confirma qual número vai atender
4. **Whitelist de teste** — quais 2-3 números podem conversar com o agente antes de abrir geral?

## 🛑 Limitações conhecidas da F3 (pra F3.1)

1. **INTERNAL_SERVICE_TOKEN é frágil** — token de sessão expira. Idealmente migrar pra header `x-webhook-secret` nos handlers bancários quando chamados internamente. Fácil de fazer, mas preferi deixar a F3 mais segura e compatível primeiro.
2. **Sem dashboard visual ainda** — a aba "CLT" no frontend é a **F5**. Por enquanto você acompanha via Console (snippets acima) ou Supabase direto.
3. **JoinBank CLT precisa de mais dados pra simular** — a higienização não é separada. O Volt vai pedir empregador + matrícula + salário antes de incluir o JoinBank na comparação. É esperado.
4. **Prata Digital ainda não está** — é F6 (RPA, precisa Playwright na VPS). Só quando você decidir atacar.

## 📞 O que fazer agora

**Opção A — "Pode pushar f3"** → eu subo o commit na main.
**Opção B — "Revisar primeiro o prompt"** → eu te mostro o SYSTEM_PROMPT em bloco e você ajusta.
**Opção C — "Muda X"** → me fala o que mudar, eu ajusto antes do push.

Bom dia. 🌅
