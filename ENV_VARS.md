# Environment Variables — FlowForce (motordeport)

Configure todas no Vercel Dashboard:
**Settings > Environment Variables**

## OBRIGATORIAS

### Supabase
| Variavel | Valor | Onde encontrar |
|----------|-------|----------------|
| `SUPABASE_URL` | `https://SEU-PROJETO.supabase.co` | Supabase > Settings > API > Project URL |
| `SUPABASE_SERVICE_KEY` | `[configurado fora do repositório]` | Supabase > Settings > API > service_role (secret) |

### Seguranca
| Variavel | Valor | Descricao |
|----------|-------|-----------|
| `SESSION_SECRET` | `[configurado fora do repositório]` | Usado pra hash de senhas. Ex: `openssl rand -hex 32` |

### Multicorban
| Variavel | Valor antigo (remover do codigo) | Descricao |
|----------|----------------------------------|-----------|
| `MULTICORBAN_USER` | `[configurado fora do repositório]` | Login do Multicorban |
| `MULTICORBAN_PASS` | `[configurado fora do repositório]` | Senha do Multicorban |

### FACTA Financeira
| Variavel | Valor antigo | Descricao |
|----------|-------------|-----------|
| `FACTA_BASE_URL` | `https://webservice-homol.facta.com.br` | URL base (homol ou prod) |
| `FACTA_AUTH` | `Basic OTM1OTY6ZDNtNXFxMXM0dmp5cDJ2YjZqdnk=` | Header Authorization Basic |
| `FACTA_LOGIN_CERT` | `[configurado fora do repositório]` | Codigo login certificado |

### JoinBank / QualiConsig
| Variavel | Valor antigo | Descricao |
|----------|-------------|-----------|
| `JOINBANK_URL` | `https://integration.ajin.io` | URL base da API |
| `JOINBANK_KEY` | `[configurado fora do repositório]` | API Key |

### FINANTO (plataforma Ajin — loja separada) — novo mai/2026
| Variavel | Valor | Descricao |
|----------|-------|-----------|
| `FINANTO_URL` | `https://api.ajin.io` | URL base produção (Ajin v3). Use `https://integration.ajin.io` pra homologação |
| `FINANTO_KEY` | `[configurado fora do repositório]` | apikey fornecida pela FINANTO (header `apikey`) |
| `FINANTO_DRIVE_URL` | `https://api-drive.ajin.io` | (Opcional) URL do Ajin Drive pra upload de docs |
| `FINANTO_WEBHOOK_SECRET` | `[configurado fora do repositório]` | Shared secret pra validar webhooks Ajin em `?s=<secret>` (fallback usa `WEBHOOK_SECRET`) |
| `SOFIA_DIGITACAO_FINANTO_ATIVA` | `true` | Feature flag: se `false`, Sofia passa o contrato pro consultor humano em vez de digitar automaticamente na FINANTO. Padrão: ativo. |
| `INSS_DIGITACAO_WHITELIST` | *(vazio = todos)* | Números de WhatsApp (separados por vírgula, só dígitos) que podem receber digitação automática da Sofia. Vazio = todos os clientes. Ex: `5515999990001,5515999990002` |

**Webhook receiver**: a URL publica `/api/finanto-webhook` recebe eventos da Ajin (port aceita/rejeitada, contrato pago/cancelado, saldo INSS pronto) e atualiza o status da proposta + avisa o cliente via WhatsApp automaticamente.

Cadastre essa URL no painel Ajin (Configurações → Webhooks):
```
https://flowforce.vercel.app/api/finanto-webhook?s=[REDACTED]
```

Eventos suportados:
- `credit_transfer.proposal` (status accepted/rejected) → Sofia avisa cliente que saldo foi liberado ou rejeitado
- `loan.status` (signed/paid/canceled/in_analysis/rejected) → Sofia avisa mudanças do contrato
- `query_inss_balance.completed` → grava saldo INSS quando chega async

**Setup**: a FINANTO usa a mesma plataforma Ajin do JoinBank, mas como loja/parceiro separado. Por isso ganhou env vars próprias (`FINANTO_*`) e endpoint `/api/finanto` próprio. Cobre INSS (todas as operações 1–6 incluindo portabilidade + refin da port + margem complementar), FGTS e Consignado Privado (providers QITech 950002 e 321Bank 950703).

Endpoint base: `POST /api/finanto` com `{ action, ...payload }`. Lista de actions disponíveis:
- **Diagnóstico**: `test`, `about`, `diag`
- **Catálogo**: `listProducts`, `listRules`, `getRule`
- **INSS**: `contratosRefinanciaveis`, `calculate`, `createProposal`, `getSimulation`, `updateSimulation`, `copySimulation`, `getAuthTerm`, `signTerm`, `in100`, `in100Sync`, `getBalance`, `generateContracts`, `getLoansBySimulation`, `getLoan`, `getLoanByContract`, `searchLoans`, `recalculate`, `acceptLoan`, `reformalize`, `getCreditAnalysis`
- **FGTS**: `fgtsCreateSimulation`, `fgtsGetSimulation`, `fgtsActions`, `fgtsCopy`
- **CLT (Consignado Privado)**: `cltCreateSimulation`, `cltAuthTerm`, `cltSignTerm`, `cltCalculate`, `cltSelectCondition`, `cltCreateLoans`, `cltCheckEligibility`
- **Drive**: `driveUploadByUrl`, `driveGetFile`
- **Admin**: `listBrokers`, `listAccounts`, `listPartners`, `listStores`
- **Escape hatch**: `rawCall` (passa `method` + `path` + `payload` direto na API Ajin)

### Evolution API (WhatsApp)
| Variavel | Valor antigo | Descricao |
|----------|-------------|-----------|
| `EVOLUTION_URL` | `https://evo.cbdw.com.br` | URL da instancia Evolution |
| `EVOLUTION_KEY` | `[configurado fora do repositório]` | API Key da Evolution |

### Claude API (Sofia IA)
| Variavel | Valor antigo | Descricao |
|----------|-------------|-----------|
| `CLAUDE_API_KEY` | `[configurado fora do repositório]` | Chave API Anthropic |

### DataConsulta (Cartao)
| Variavel | Valor antigo | Descricao |
|----------|-------------|-----------|
| `DATACONSULTA_KEY` | `[configurado fora do repositório]` | API Key DataConsulta |

### C6 Bank Marketplace (Consignado Trabalhador CLT) — novo abr/2026
| Variavel | Valor | Descricao |
|----------|-------|-----------|
| `C6_BASE_URL` | `https://marketplace-proposal-service-api-p.c6bank.info` | URL base produção |
| `C6_USERNAME` | `[configurado fora do repositório]` | Username (CPF_certificado + codigo_promotora) |
| `C6_PASSWORD` | `[configurado fora do repositório]` | Senha do usuario marketplace |
| `C6_PROMOTER_CODE` | `004684` | Código da promotora LhamasCred no C6 |
| `C6_CODIGO_ORIGEM` | `004684` | codigo_origem_6 (código do digitador) |
| `C6_CPF_CERTIFICADO` | `33117876847` | CPF de quem tem o certificado digital da corban |

**Validado em produção em 2026-04-24**: auth HTTP 200, subject `C6BankMarketplaceProd`. Token vive ~20min (cacheado no handler).

### V8 Sistema (Crédito Privado CLT - provedor QI) — novo abr/2026
| Variavel | Valor | Descricao |
|----------|-------|-----------|
| `V8_AUTH_URL` | `https://auth.v8sistema.com/oauth/token` | OAuth endpoint (default no codigo) |
| `V8_BFF_URL` | `https://bff.v8sistema.com` | API base (default no codigo) |
| `V8_CLIENT_ID` | `[configurado fora do repositório]` | Client ID OAuth |
| `V8_AUDIENCE` | *(SOLICITAR a gerente comercial V8 por email)* | OBRIGATORIO. Sem isso auth da 401 |
| `V8_USERNAME` | `[configurado fora do repositório]` | Email do usuario V8 |
| `V8_PASSWORD` | `[configurado fora do repositório]` | Senha V8 |

**IMPORTANTE**: o `V8_AUDIENCE` precisa ser solicitado por email a sua gerente comercial V8 ou ti@v8sistema.online. Sem ele, o `getToken()` lanca erro `V8_AUDIENCE nao configurado`.

Webhooks: registrar via action `registrarWebhooks` (registra automaticamente em `/user/webhook/private-consignment/consult` e `/operation` apontando pra `/api/v8`).

### PresençaBank (Consignado Privado CLT) — novo abr/2026
| Variavel | Valor | Descricao |
|----------|-------|-----------|
| `PRESENCABANK_BASE_URL` | `https://presenca-bank-api.azurewebsites.net` | URL base produção (Azure) |
| `PRESENCABANK_LOGIN` | `[configurado fora do repositório]` | Login LhamasCred |
| `PRESENCABANK_SENHA` | `[configurado fora do repositório]` | Senha do usuario |
| `PRESENCABANK_PRODUTO_ID` | `28` | ID do produto Consignado Privado (default 28) |

Rate limit: 30 req/min (recomendado 1 req a cada 2s).

### Crefaz On (Credito Pessoal Energia / Debito em Conta / Boleto) — novo mai/2026
| Variavel | Valor | Descricao |
|----------|-------|-----------|
| `CREFAZ_ENV` | `stag` ou `prod` | Ambiente ativo. Mude pra `prod` quando a Crefaz liberar a apiKey de producao |
| `CREFAZ_BASE_STAG` | `https://app2-crefaz-api-external-stag.azurewebsites.net/api` | URL homologacao (default no codigo) |
| `CREFAZ_BASE_PROD` | `https://api-externo.crefazon.com.br/api` | URL producao (default no codigo) |
| `CREFAZ_API_KEY_STAG` | `[configurado fora do repositório]` | apiKey de homologacao fornecida pela Crefaz |
| `CREFAZ_API_KEY_PROD` | `[configurado fora do repositório]` | apiKey de producao. Em mai/2026 a Crefaz so liberou Stag |
| `CREFAZ_LOGIN` | `[configurado fora do repositório]` | Codigo do parceiro (mesmo do painel Crefaz On) |
| `CREFAZ_SENHA` | `[configurado fora do repositório]` | Senha do usuario Crefaz On |
| `CREFAZ_WEBHOOK_SECRET` | `[configurado fora do repositório]` | Shared secret pra validar callbacks Crefaz em `?secret=...` |

**Status mai/2026**: usuario `CC030137862` retorna `Usuario ou senha invalidos` em Stag (pendente habilitacao em homologacao pela Crefaz) e ambas apiKeys retornam `ApiKey Invalida` em Prod (pendente entrega da chave Prod). Pedido aberto com a Crefaz.

Webhook publico: `https://motordeport.vercel.app/api/crefaz-webhook?secret=[REDACTED]` — registrar essa URL no campo `urlNotificacaoParceiro` ao criar proposta via `POST /Proposta`.

### Fintech do Corban (Super Simples — Consignado Privado CLT) — novo jun/2026
Integrador que dá acesso a 2 bancarizadoras CLT: **QI Tech** e **Celcoin**.
Doc: https://docs.fintechdocorban.com.br/ · Auth: header `Subscription: <api_key>`.

| Variavel | Valor | Descricao |
|----------|-------|-----------|
| `FINTECH_API_KEY_PRD` | `[configurado fora do repositório]` | Chave de API de PRODUCAO (fornecida pelo Fintech do Corban) |
| `FINTECH_API_KEY_HML` | `[configurado fora do repositório]` | Chave de homologacao |
| `FINTECH_AMBIENTE` | `PRD` ou `HML` | Ambiente ativo. Default `PRD` |

> Endpoint base: `POST /api/fintechdocorban` com `{ action, provider, ... }`. provider = `qi` (default) ou `celcoin`.
> Actions: `test`, `testHeaders`, `consultarPorCPF`, `enviarLinkAutorizacao`, `autorizacaoSimples`, `consultarVinculos`, `simular`, `criarOperacao`, `cltCheckEligibility`, `rawCall`.
> As **regras/tabelas (taxa, prazo, valor)** vêm da plataforma deles — listadas em `GET /Api/V1/CommissionTableCorban/Get-All-To-Partner` (action `listarTabelas`). Tabelas de INSS têm "INSS" no nome.
> **INSS** (mesma key): `consultarSaldoInss` (margem), `listarTabelas` (regras), simulação via `Operation/Simulation-FGTS` + `Operation/Online-Hiring`.
> Tela: **INSS → Fintech do Corban** (`/inss/fintech-corban`).

### JoinBank/QualiBanking CLT — reutiliza credenciais INSS existentes
Não precisa nenhuma env var nova. Usa `JOINBANK_URL` e `JOINBANK_KEY` já configuradas. Os endpoints CLT usam o prefixo `/v3/loan-private-payroll-simulations/...` em vez do INSS `/v3/loan-inss-simulations/...`.

Providers CLT:
- QITech: `950002` (default)
- 321 Bank: `950703`

### Claude API — Agente Vendedor CLT (novo abr/2026)
Pode reutilizar a `CLAUDE_API_KEY` existente OU criar uma separada:

| Variavel | Valor | Descricao |
|----------|-------|-----------|
| `CLAUDE_API_KEY_AGENTE_CLT` | `[configurado fora do repositório]` | (Opcional) Chave dedicada ao agente CLT. Se nao setada, `api/agente-clt.js` usa `CLAUDE_API_KEY` |

### Bot INSS Parceiro (WhatsApp B2B — consulta por CPF) — novo mai/2026

| Variavel | Valor exemplo | Descricao |
|----------|---------------|-----------|
| `INSS_PARCEIRO_INSTANCE` | `lhamas-inss-bot` | Nome da instance Evolution dedicada ao bot de consulta INSS para parceiros |

> **Dependência**: requer `WEBHOOK_SECRET` (já configurada) e `APP_URL` (já configurada).
> Parceiros precisam ter `phone_whatsapp` preenchido em `users` (rodar `supabase_migration_inss_parceiro.sql`).

---

### Agente Vendedor CLT — Evolution + Whitelist (F3, novo abr/2026)

| Variavel | Valor exemplo | Descricao |
|----------|---------------|-----------|
| `CLT_EVOLUTION_INSTANCE` | `lhamas-clt` | Nome da instance Evolution dedicada ao agente CLT (WhatsApp B2C) |
| `CLT_WHATSAPP_WHITELIST` | `5515999111111,5515999222222` | CSV de numeros autorizados a conversar com o agente em modo simulacao. Vazio ou `*` = aberto pra todo mundo (producao) |
| `WEBHOOK_SECRET` | `[configurado fora do repositório]` | **RECOMENDADO**. Token fixo nunca expira. Usado por agente-clt e workers internos no header `x-internal-secret` pra autenticar chamadas a `/api/c6`, `/api/presencabank`, `/api/v8`, `/api/multicorban`. Tambem valida webhooks externos (Evolution, V8) |
| `INTERNAL_SERVICE_TOKEN` | `[configurado fora do repositório]` | Alternativa ao WEBHOOK_SECRET. Token de sessao do FlowForce. Se WEBHOOK_SECRET nao tiver setado, agente usa esse Bearer token. **Expira** — preferir WEBHOOK_SECRET |
| `APP_URL` | `https://flowforce.vercel.app` | URL publica do app. Usada pra webhooks Evolution apontarem de volta pra ca |

## OPCIONAIS

| Variavel | Default | Descricao |
|----------|---------|-----------|
| `ALLOWED_ORIGINS` | `*` | Origens permitidas CORS (separadas por virgula). Em prod: `https://flowforce.vercel.app` |
| `APP_URL` | `https://flowforce.vercel.app` | URL publica do app (usada nos webhooks) |
| `WEBHOOK_SECRET` | `[configurado fora do repositório]` | Secret para validar webhooks do Evolution |

## TOTAL: 17 variaveis (com FINANTO)

### Passo a passo:
1. Abra https://vercel.com > seu projeto motordeport > Settings > Environment Variables
2. Adicione cada variavel acima
3. Marque **Production**, **Preview** e **Development**
4. Clique em Save
5. Faca um novo deploy (Deployments > Redeploy)

### IMPORTANTE:
- Depois de configurar as env vars e fazer redeploy, as credenciais antigas no codigo nao serao mais usadas
- Recomendo REVOGAR e GERAR NOVAS chaves para: FACTA, JoinBank, Claude API, DataConsulta, Evolution
- O `SESSION_SECRET` deve ser unico e nunca compartilhado
