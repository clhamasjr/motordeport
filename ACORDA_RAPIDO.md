# ☀️ Acorda Rápido — F3 pronta pra subir

**Última revisão:** 24/abr madrugada — incorporei suas orientações: persona dinâmica (sem "Volt"), LGPD conversacional, ordem C6→PresençaBank→JoinBank configurável, enriquecimento via PresençaBank, suporte a imagem nativo do Claude, áudio via Evolution.

## 📦 O que foi entregue (local, commit pendente)

| Arquivo | O que é |
|---|---|
| `supabase_migration_clt.sql` | Migration: `clt_conversas` + `clt_conversas_eventos` + `clt_config` (global) + colunas `nome_vendedor`/`nome_parceiro` em `users` e `clt_conversas` |
| `api/agente-clt.js` | Agente vendedor CLT — persona dinâmica, LGPD inline, consolida 3 bancos, suporta texto/imagem/áudio transcrito |
| `ENV_VARS.md` | +4 vars novas, APP_URL atualizada pra `flowforce.vercel.app` |
| `HISTORICO_PROJETO.md` | F3 documentada |
| `ACORDA_RAPIDO.md` | Este arquivo |

## ✅ Passo 1 — Autorizar o push (1 min)

```bash
cd C:\Users\clham\Documents\motordeport
git log --oneline -3
```

Se tiver 2 commits F3, me autoriza "pode pushar f3" e eu subo.

## ✅ Passo 2 — Aplicar migration no Supabase (2 min)

1. https://supabase.com/dashboard/project/rirsmtyuyqxsoxqbgtpu/sql
2. Cola o conteúdo de `supabase_migration_clt.sql`
3. **Run**
4. Deve criar: 3 tabelas (`clt_conversas`, `clt_conversas_eventos`, `clt_config`), inserir 1 linha em `clt_config`, adicionar colunas em `users`
5. Verifica: `select * from clt_config;` → deve retornar 1 linha com `ordem_bancos = {c6,presencabank,joinbank}`

## ✅ Passo 3 — Configurar persona dos usuários vendedores (2 min)

Pra cada usuário que vai atender via agente, preenche os 2 campos novos em `users`:

```sql
-- Exemplo: usuário da JVR
update users set
  nome_vendedor = 'João',
  nome_parceiro = 'JVR Financeira'
where username = 'joao@jvr.com';

-- Exemplo: usuário da Lhamas
update users set
  nome_vendedor = 'Carol',
  nome_parceiro = 'LhamasCred'
where username = 'carol@lhamascred.com.br';
```

**IMPORTANTE**: no primeiro teste, popule pelo menos 1 usuário. Se não preencher, o agente usa default "LhamasCred da LhamasCred".

## ✅ Passo 4 — Criar instance Evolution dedicada (3 min)

No FlowForce logado:
1. Aba WhatsApp → **Nova Instance**
2. Nome: `lhamas-clt` (ou outro — anota)
3. Escaneia QR com o chip que vai atender CLT
4. Aguarda status "connected"

## ✅ Passo 5 — Configurar 4 env vars na Vercel (4 min)

https://vercel.com → projeto `flowforce` → Settings → Environment Variables → **Import .env**:

```env
APP_URL=https://flowforce.vercel.app
CLT_EVOLUTION_INSTANCE=lhamas-clt
CLT_WHATSAPP_WHITELIST=5515SEUNUMERO
INTERNAL_SERVICE_TOKEN=<GERAR_PASSO_6>
```

### Sobre `INTERNAL_SERVICE_TOKEN`:
1. Login no FlowForce com usuário admin (ou cria `agente-clt@lhamascred.com.br`)
2. F12 → Application → Local Storage → `flowforce.vercel.app` → copia o valor de `ff_token`
3. Cola em `INTERNAL_SERVICE_TOKEN`

**Atenção**: sessão expira. Quando acontecer, renova ou me pede pra fazer um bypass com `WEBHOOK_SECRET` (F3.1).

## ✅ Passo 6 — Redeploy (1 min)

Deployments → último → ⋯ → Redeploy.

## ✅ Passo 7 — Configurar webhook no Evolution (1 min)

No FlowForce F12 → Console:

```javascript
(async () => {
  const r = await fetch('/api/agente-clt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('ff_token') },
    body: JSON.stringify({ action: 'configureWebhook', instance: 'lhamas-clt' })
  });
  console.log(await r.json());
})();
```

Deve retornar `success: true`.

## ✅ Passo 8 — Healthcheck (1 min)

```javascript
(async () => {
  const r = await fetch('/api/agente-clt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('ff_token') },
    body: JSON.stringify({ action: 'test' })
  });
  console.log(await r.json());
})();
```

Esperado: `claude: ok`, `supabase: ok`, `clt_config: {ordem_bancos: [...]}`, `evolution: ok`, `internal_token_set: true`.

## ✅ Passo 9 — Primeira conversa real (2 min)

Do **seu celular** (que está em `CLT_WHATSAPP_WHITELIST`), manda **"oi"** pro número do WhatsApp CLT.

Esperado:
1. Agente responde se apresentando como `[nome_vendedor] da [nome_parceiro]`
2. Pede consentimento LGPD
3. Você responde "SIM AUTORIZO"
4. Agente pede CPF
5. Você manda CPF
6. Agente roda simulações (C6 + PresençaBank em paralelo)
7. Se C6 tem oferta, te pede selfie de autorização
8. Depois te apresenta a oferta do **C6 PRIMEIRO** (ordem definida em `clt_config`)

## 🎯 Pontos pra você decidir/ajustar quando quiser

### Ordem dos bancos do dia
```sql
update clt_config set
  ordem_bancos = array['presencabank','c6','joinbank']
where id = 1;
```
Muda o default a qualquer hora. Agente passa a apresentar nessa ordem na próxima conversa (conversas em andamento não são afetadas).

### Tom do agente
```sql
update clt_config set modo_insistencia = 'conciso' where id = 1;
-- valores: 'conciso' (default) | 'moderado' | 'insistente'
```

### Plano de seguro C6 preferido
```sql
update clt_config set seguro_c6_default = 4 where id = 1;
-- 0 = sem seguro, 2 = 2 parcelas, 4 = 4p (8.40%), 6 = 6p (11.35%), 9 = 9p (14.10%)
```

### Override total do prompt (se quiser trocar tudo)
```sql
update clt_config set prompt_override = '...seu prompt customizado aqui...' where id = 1;
-- deixa NULL pra voltar ao padrão
```

## 🔍 Acompanhar conversas no dia-a-dia

```javascript
// Conversas ativas
fetch('/api/agente-clt', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('ff_token') },
  body: JSON.stringify({ action: 'conversasAtivas' })
}).then(r=>r.json()).then(d => console.table(d.conversas));

// Detalhes de uma conversa
fetch('/api/agente-clt', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('ff_token') },
  body: JSON.stringify({ action: 'getConversa', telefone: '5515999111111' })
}).then(r=>r.json()).then(console.log);
```

## 🚨 Limitações conhecidas (pra F3.1, F4, F5)

1. **Follow-up automático de status** — ainda não implementado. Quando cliente assina e proposta entra em análise, não há cron checando status nos bancos pra avisar cliente. Próxima iteração: criar `api/cron-clt-followup.js` rodando a cada hora.
2. **Áudio do Evolution** — se Evolution não estiver com transcrição nativa ligada, agente vai responder "não consegui ouvir". Me avisa se cair nesse caso que eu plugo Whisper.
3. **Multicorban PF** — não disponível. Enriquecimento roda só via PresençaBank (já é bem rico).
4. **Dashboard CLT no frontend** — F5. Por enquanto você acompanha via Console ou Supabase direto.
5. **Prata Digital + V8** — F6/F7.

## 📞 Pra próxima conversa comigo

**Opção A — "pode pushar f3"** → eu subo.
**Opção B — "leia o SYSTEM_PROMPT"** → te colo aqui as ~150 linhas pra você revisar palavra por palavra.
**Opção C — "muda X"** → me fala o ajuste antes do push.

Bom dia! 🌅
