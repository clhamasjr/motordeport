# 🎛️ GESTAO.md — Manual de Operação FlowForce/Volt

> Playbook de comandos prontos pra gestão geral do sistema. Use no Console F12 do FlowForce, no Supabase SQL Editor, ou via CLI. Cada bloco é copy-paste.

**Projeto Supabase**: `rirsmtyuyqxsoxqbgtpu`
**URL prod**: `https://flowforce.vercel.app`
**Repo**: `clhamasjr/motordeport`

---

## 📑 Sumário

1. [Gestão de Usuários](#1-gestão-de-usuários)
2. [Gestão de Parceiros](#2-gestão-de-parceiros)
3. [Configuração CLT (`clt_config`)](#3-configuração-clt)
4. [Catálogos Fed / Gov / Pref](#4-catálogos-fed--gov--pref)
5. [Auditoria e Sessões](#5-auditoria-e-sessões)
6. [Env Vars e Infra (healthchecks)](#6-env-vars-e-infra)
7. [Convenções de operação](#7-convenções-de-operação)

---

## Pré-requisitos

Todos os snippets `fetch(...)` neste documento assumem que você está logado no FlowForce com role `admin` e abriu o **Console F12** na aba `flowforce.vercel.app`. O token vem de `localStorage.getItem('ff_token')`.

Helper que vamos usar várias vezes:

```javascript
// Cole 1x no Console pra ter `api()` disponível
window.api = async (endpoint, body) => {
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + localStorage.getItem('ff_token')
    },
    body: JSON.stringify(body)
  });
  const j = await r.json();
  console.log(j);
  return j;
};
```

---

## 1. Gestão de Usuários

### 1.1 Listar todos os usuários (admin/gestor)

```javascript
api('/api/auth', { action: 'list' }).then(d => console.table(d.users));
```

### 1.2 Criar novo usuário

```javascript
api('/api/auth', {
  action: 'create',
  name: 'João Silva',
  user: 'joao@jvr.com',
  pass: 'SenhaForte123!',
  role: 'operador'  // admin | gestor | operador
});
```

### 1.3 Promover / rebaixar role

```javascript
api('/api/auth', {
  action: 'update_role',
  targetUser: 'joao@jvr.com',
  role: 'gestor'
});
```

### 1.4 Reset de senha (admin)

⚠️ **Mata todas as sessões ativas do usuário.**

```javascript
api('/api/auth', {
  action: 'reset_pw',
  targetUser: 'joao@jvr.com',
  newPass: 'NovaSenha2026'
});
```

### 1.5 Trocar própria senha (qualquer usuário logado)

```javascript
api('/api/auth', {
  action: 'change_pw',
  oldPass: 'SenhaAntiga',
  newPass: 'SenhaNova'
});
```

### 1.6 Soft delete (desativar usuário)

```javascript
api('/api/auth', { action: 'delete', targetUser: 'joao@jvr.com' });
```

Reativar (não tem action — UPDATE direto no Supabase):

```sql
update users set active = true where username = 'joao@jvr.com';
```

### 1.7 Configurar persona do agente (CLT)

```sql
update users
   set nome_vendedor = 'João',
       nome_parceiro = 'JVR Financeira'
 where username = 'joao@jvr.com';
```

### 1.8 Bank codes (códigos por banco)

Estrutura JSONB: `{facta:"93596", qitech:"...", daycoval:"..."}`.

```javascript
api('/api/auth', {
  action: 'update_bank_codes',
  targetUser: 'joao@jvr.com',
  codes: { facta: '93596', daycoval: '7766' }
});
```

Remover um código (passar string vazia):
```javascript
api('/api/auth', {
  action: 'update_bank_codes',
  targetUser: 'joao@jvr.com',
  codes: { facta: '' }
});
```

---

## 2. Gestão de Parceiros

### 2.1 Listar parceiros

```javascript
api('/api/auth', { action: 'list_parceiros' }).then(d => console.table(d.parceiros));
```

### 2.2 Criar parceiro (admin)

```javascript
api('/api/auth', {
  action: 'create_parceiro',
  nome: 'JVR Financeira',
  cnpj: '00.000.000/0001-00'
});
```

### 2.3 Vincular usuário a parceiro

```javascript
api('/api/auth', {
  action: 'assign_parceiro',
  targetUser: 'joao@jvr.com',
  parceiroId: 5
});
```

Desvincular (admin):
```javascript
api('/api/auth', {
  action: 'assign_parceiro',
  targetUser: 'joao@jvr.com',
  parceiroId: null
});
```

### 2.4 Atualizar / desativar parceiro

```javascript
api('/api/auth', {
  action: 'update_parceiro',
  parceiroId: 5,
  nome: 'JVR Financeira LTDA',
  active: true
});
```

```javascript
api('/api/auth', { action: 'delete_parceiro', parceiroId: 5 });
// Falha se houver users ativos vinculados
```

---

## 3. Configuração CLT

Tabela `clt_config` é singleton (`id=1`). Mudanças aplicam **na próxima conversa nova**, não em conversas em andamento.

### 3.1 Ver config atual

```sql
select * from clt_config where id = 1;
```

### 3.2 Mudar ordem dos bancos (prioridade de apresentação ao cliente)

```sql
update clt_config
   set ordem_bancos = array['c6','presencabank','joinbank','v8','handbank','mercantil']
 where id = 1;
```

### 3.3 Tom do agente

```sql
update clt_config set modo_insistencia = 'conciso' where id = 1;
-- valores: 'conciso' (default) | 'moderado' | 'insistente'
```

### 3.4 Plano de seguro C6 padrão

```sql
update clt_config set seguro_c6_default = 4 where id = 1;
-- 0 = sem seguro
-- 2 = 2 parcelas (manual antigo)
-- 4 = 4 parcelas (8.40%)
-- 6 = 6 parcelas (11.35%)
-- 9 = 9 parcelas (14.10%)
```

### 3.5 Horário de atendimento

```sql
update clt_config
   set horario_atendimento_inicio = '09:00',
       horario_atendimento_fim    = '20:00',
       timezone                   = 'America/Sao_Paulo'
 where id = 1;
```

### 3.6 Override total do prompt

```sql
update clt_config set prompt_override = '...seu prompt customizado...' where id = 1;
update clt_config set prompt_override = NULL where id = 1;  -- volta ao default
```

### 3.7 Pausar / retomar uma conversa específica

```sql
-- Pausar (transfere pra humano)
update clt_conversas
   set pausada_por_humano = true, escalada_para_humano = true
 where telefone = '5515999111111';

-- Retomar
update clt_conversas
   set pausada_por_humano = false, escalada_para_humano = false
 where telefone = '5515999111111';
```

Via API (mais limpo):

```javascript
api('/api/agente-clt', { action: 'retomarConversa', telefone: '5515999111111' });
```

### 3.8 Reiniciar conversa (zera estado, mantém histórico)

```sql
update clt_conversas
   set etapa = 'inicio',
       cpf = null, ofertas = '[]'::jsonb, banco_escolhido = null,
       dados = '{}'::jsonb
 where telefone = '5515999111111';
```

### 3.9 Conversas ativas / debug

```javascript
api('/api/agente-clt', { action: 'conversasAtivas' }).then(d => console.table(d.conversas));
api('/api/agente-clt', { action: 'getConversa', telefone: '5515999111111' });
api('/api/agente-clt', { action: 'debugConversa', telefone: '5515999111111' });
```

---

## 4. Catálogos Fed / Gov / Pref

Os 3 catálogos seguem o mesmo padrão: `{prefix}_bancos`, `{prefix}_convenios`, `{prefix}_banco_convenio`. Reseed via `/api/{prefix}-seed` consome o JSON da raiz do repo.

### 4.1 Listar convênios e regras

```javascript
api('/api/fed', { action: 'listConvenios' }).then(d => console.table(d.convenios));
api('/api/gov', { action: 'listConvenios' }).then(d => console.table(d.convenios));
api('/api/pref', { action: 'listConvenios' }).then(d => console.table(d.convenios));

api('/api/gov', { action: 'getConvenio', convenioId: 12 });
```

### 4.2 Editar banco × convênio (admin)

Disponível em `gov.js` e `pref.js`. **Marca `editado_manual = true` automaticamente** — o reseed não sobrescreve.

```javascript
api('/api/gov', {
  action: 'upsertBancoConvenio',
  bancoId: 3, convenioId: 12,
  opera_novo: true, opera_refin: true, opera_port: true,
  margem_utilizavel: 0.30, idade_min: 21, idade_max: 75,
  taxa_minima_port: 1.66
});
```

### 4.3 Reseed protegido (admin)

⚠️ **Confirmar antes** — sobrescreve tudo que **não** está marcado `editado_manual`.

```javascript
api('/api/fed-seed', {});
api('/api/gov-seed', {});
api('/api/pref-seed', {});
```

### 4.4 Auditoria do que foi editado manualmente

```sql
select b.nome as banco, c.nome as convenio, bc.atualizado_em
  from gov_banco_convenio bc
  join gov_bancos b   on b.id = bc.banco_id
  join gov_convenios c on c.id = bc.convenio_id
 where bc.editado_manual = true
 order by bc.atualizado_em desc;
```
(Trocar `gov_*` por `pref_*` ou `fed_*` conforme módulo.)

### 4.5 Análise de holerite por IA (histórico)

```javascript
api('/api/fed',  { action: 'listAnalises' });
api('/api/gov',  { action: 'listAnalises' });
api('/api/pref', { action: 'listAnalises' });
```

---

## 5. Auditoria e Sessões

### 5.1 Login history (últimas 24h)

```sql
select created_at, user_id, action, ip_address, details
  from audit_log
 where action = 'login' and created_at > now() - interval '24 hours'
 order by created_at desc;
```

### 5.2 Logins falhos / IPs suspeitos

```sql
select ip_address, count(*) as tentativas
  from audit_log
 where action = 'login_failed' and created_at > now() - interval '24 hours'
 group by ip_address
 order by tentativas desc;
```

### 5.3 Quem mudou role / bank_codes / parceiros

```sql
select created_at, u.username as autor, action, resource_id, details
  from audit_log al
  left join users u on u.id = al.user_id
 where action in ('update_role','update_bank_codes','create_parceiro',
                  'update_parceiro','delete_parceiro','assign_parceiro',
                  'reset_pw','create','delete')
 order by created_at desc
 limit 100;
```

### 5.4 Sessões ativas agora

```sql
select s.user_id, u.username, u.role, s.ip_address, s.expires_at, s.created_at
  from sessions s
  join users u on u.id = s.user_id
 where s.expires_at > now()
 order by s.created_at desc;
```

### 5.5 Matar todas as sessões de um usuário (force logout)

```sql
delete from sessions where user_id = (select id from users where username = 'joao@jvr.com');
```

Matar todas as sessões expiradas (limpeza periódica):

```sql
delete from sessions where expires_at < now();
```

### 5.6 Eventos do agente CLT (debug)

```sql
select e.created_at, c.telefone, e.tipo, e.detalhes
  from clt_conversas_eventos e
  join clt_conversas c on c.id = e.conversa_id
 where c.telefone = '5515999111111'
 order by e.created_at desc
 limit 50;
```

### 5.7 Esteira CLT — resumo por banco/status

```sql
select * from clt_esteira_resumo;
```

---

## 6. Env Vars e Infra

### 6.1 Healthcheck dos bancos

```javascript
// CLT
api('/api/c6',           { action: 'test' });
api('/api/presencabank', { action: 'test' });
api('/api/joinbank',     { action: 'test' });
api('/api/v8',           { action: 'test' });
api('/api/handbank',     { action: 'status' });
api('/api/mercantil',    { action: 'test' });

// INSS
api('/api/facta',        { action: 'test' });
api('/api/facta',        { action: 'diag' });   // mostra env vars + ping no proxy
api('/api/daycoval',     { action: 'test' });

// Agente
api('/api/agente-clt',   { action: 'test' });   // claude+supabase+evolution+config
```

### 6.2 FACTA proxy (Windows)

```javascript
// Diag completo: env vars + ping /health do proxy via CF Access
api('/api/facta', { action: 'diag' });
```

Se proxy estiver fora:
- Conferir que `server.js` tá rodando na máquina do escritório (`facta-proxy/`)
- Cloudflare Tunnel `facta-proxy.cbdw.com.br` ativo
- Vars Vercel: `FACTA_PROXY_URL`, `FACTA_PROXY_SECRET`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` (todas com `.trim()` automático)

### 6.3 Configurar webhook Evolution (CLT)

```javascript
// Configura webhook em todas as instâncias prefixadas 'clt'
api('/api/clt-config-webhook', {});

// Ou em uma instance específica
api('/api/agente-clt', { action: 'configureWebhook', instance: 'lhamas-clt' });
```

### 6.4 Listar instâncias WhatsApp

```javascript
api('/api/evolution', { action: 'list' });
api('/api/waha',      { action: 'list' });
```

### 6.5 Status Evolution

```javascript
api('/api/evolution', { action: 'status', instance: 'lhamas-clt' });
```

### 6.6 Renovar JWT Mercantil (banco bloqueia login auto)

1. Login manual no portal `bml.b.br`
2. Copiar JWT do request no F12
3. Cola via:

```javascript
api('/api/mercantil', { action: 'setJwt', jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6...' });
```

### 6.7 Vercel — gotchas permanentes

- ❌ `echo "valor" | vercel env add` → injeta `\n` no fim
- ✅ `printf "valor" | vercel env add NOME production`
- ✅ Sempre `cd` pro projeto antes de `vercel deploy --prod --yes`
- ❌ Bash cwd às vezes reseta pra `C:\Program Files\Git`

### 6.8 Supabase — projeto `rirsmtyuyqxsoxqbgtpu`

- Dashboard: https://supabase.com/dashboard/project/rirsmtyuyqxsoxqbgtpu
- SQL Editor: https://supabase.com/dashboard/project/rirsmtyuyqxsoxqbgtpu/sql
- Migrations versionadas no repo: `supabase_migration_*.sql`

---

## 7. Convenções de operação

| Severidade | Antes de executar | Exemplos |
|---|---|---|
| 🟢 Read-only | sem confirmação | `list`, `me`, queries `select`, `test`, `diag` |
| 🟡 Edit pontual | mostrar comando | `update_role`, `update_bank_codes`, `update clt_config` |
| 🟠 Reset / cancelamento | confirmar antes | `reset_pw`, `delete user`, pausar conversa |
| 🔴 Massivo / irreversível | confirmar 2× | reseed catálogo, drop column, delete em massa |

**Padrões**:
- Toda ação sensível é loggada em `audit_log` automaticamente.
- Soft delete em `users` mantém histórico (`active=false`); usuários nunca são apagados de verdade.
- Sessões expiram em 24h server-side. `change_pw` **não** invalida sessão atual; `reset_pw` invalida todas.
- `editado_manual = true` em catálogos protege contra reseed. Use sempre via `upsertBancoConvenio` que já marca o flag.

---

*Última atualização: 09/05/2026 — orquestrador assume manutenção contínua deste manual.*
