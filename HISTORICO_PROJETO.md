# Histórico do Projeto MOTOR DE PORT (FlowForce → Volt)

Consolidado em 2026-04-21 a partir do claude-mem. Compilação de 80+ observations + 30+ sessions registradas.

**Repositório**: https://github.com/clhamasjr/motordeport.git
**Path local**: `C:\Users\clham\Documents\motordeport`
**Vercel**: `clhamasjrs-projects/motordeport` (prj_NwexkFHrNMWTZklx2BHMvfauqNRi)
**Team Vercel**: team_Fq8rLYi5Lwg3VwFonNcVjtRu

---

## ARQUITETURA (snapshot 2026-04-21)

- **Frontend**: single-file `index.html` (~3.952 linhas com CSS/JS inline)
- **Backend**: 12 Edge Functions em `api/`: agent.js, auth.js, cartao.js, chatwoot.js, datafast.js, digitacao.js, evolution.js, facta.js, gestao.js, joinbank.js, multicorban.js, waha.js
- **Pasta `_lib`**: utilitários compartilhados
- **Proxy Windows**: `facta-proxy/` (Node + Express + Cloudflare Tunnel)
- **Banco**: Supabase `rirsmtyuyqxsoxqbgtpu` (tabela `users`, `portabilidades`, `consig_proposals`, `sync_logs`)
- **localStorage keys (gotcha)**: mistura `ff_*` (token, active, tab, cart) e `lhm_*` (sess 24h, hist, data_{id}); sessionStorage `ff_ss` 4h TTL

---

## 14/ABR/2026 — Origem rastreada

### Roles e autenticação
- **#53/#56** `api/auth.js` só tinha `reset_pw`/`change_pw` (216 linhas); lógica de role estava em outro lugar
- **#57** Commit `9972a51`: nova action `update_role` publicada para admins editarem role de usuários

### Integração C6 Bank (#109, #111, #112)
- **Decisão**: XLSM `Simulador PortRfn_2025011.xlsm` + `ROTEIRO EMPRESTIMO INSS.pdf` são referências autoritativas. "Temos sempre que respeitar o simulador"
- **Commit `cad0e47`**: C6 Bank integrado ao motor
  - Tabelas de coeficientes: taxas 1.35% a 1.60% até 96 meses
  - Config: saldo mín R$2.000, parcela mín R$50, taxa [1.35, 1.85]
  - Blocks origem: Daycoval, Agibank, Inbursa, Safra, BRB, QI TECH
  - `espBlock: [87, 88]` bloqueia LOAS/BPC
  - `pgMinMap`: Facta 13 / Parana 13 / Pan 37 pagas antes de portar pro C6
  - Fix: `buildCartFromPort`/`buildCartFromElig` usavam banco de destino hardcoded — corrigido
  - `renderConsulta` agora passa `espN` para `testar()` para aplicar `espBlock` em consulta unitária
  - C6 renderizado em cyan na UI
- **#96** Inventário Vercel: 6 projetos (telosmanu, motordeport, opsmanager, lhamasvault, nexus-assistente-7ef7, nexus-assistente)

---

## 19/ABR/2026 — Regras de idade

### Invalidez — teto único (#434, #435)
- **Bug**: constante `IDADE_MAX_INV=67` rejeitava invalidez entre 68-72 anos incorretamente
- **Fix** (commit `6edb985`): removida `IDADE_MAX_INV`; agora só `IDADE_MAX=72` para todos
- Preservadas regras por banco: `invRules.minAge`, `invRules.dibAgeRange`
- C6 continua com `blockInv:true`
- QUALI mantém minAge 55, DIB≥15 anos se idade 55-57

### Idade mínima invalidez (#438)
- `invRules:{minAge:60}` adicionado em **FACTA**, **BRB**, **DIGIO**
- QUALI já tinha `{minAge:55, dibAgeRange:[55,57], dibMinYears:15}`
- C6 bloqueia todas espécies via `blockInv:true`
- Afeta espécies INSS: `ESP_INV = [4,5,6,32,33,34,51,83,92]`

---

## 20/ABR/2026 — Correções COEFS + nascimento do facta-proxy

### Correção do array COEFS (#479, #481)
- **Bug 1** (#479): COEFS incluía taxas de entrada (1.35%, 1.40%, 1.45%) misturadas com refin
- **Fix**: removidas 3 entradas < 1.50%; adicionada 1.879% (BRB); comentário "Coeficientes de REFIN (nao entrada). Taxas de 1.50% a 1.879% (96 meses)"
- **Bug 2** (#481): 1.879% não existe como taxa real
- **Fix**: removida 1.879%; COEFS agora vai de 1.50% a 1.85% (13 entradas); teto INSS = 1.85%

### Regra PICPAY (#487) — commit `d6def1a`
- Constante `PICPAY_CODE` + guarda em `B1P`
- PICPAY (cód 380) como origem:
  - QUALI, FACTA, C6, DIGIO: aceitam (1 paga)
  - BRB: BLOQUEIA (tem 380 no array de blocks)
  - DIGIO: pgMin 12 sobrescrito por 1 quando origem está em B1P

### Teto 72 anos (#504, #508) — commit `13385eb`
- Consulta unitária não passava `idade`/`invalidez`/`DIB` pro motor
- Fix: agora força validação de 72 anos em single-client como já fazia em batch
- Comentário: "Teto = 80 anos no fim → idade atual max 72 (todos os bancos, inclusive invalidez)"
- Contrato novo sempre 96 meses (8 anos)

### UI de usuários (#490)
- Não existe função dedicada tipo `addUser`/`novoUser` em index.html
- Lógica de criação está inline por volta da linha 963 (junto com "Novo Usuário", "Cadastrar", "reset_pw")

### Vercel setup (#465, #470, #472, #473, #475)
- Vercel CLI não estava no PATH
- Usado `npx vercel` v51.7.0
- Autenticado como `clhamasjr`
- Projeto linkado com `VERCEL_CLAUDE_PLUGIN=0 CI=1 npx vercel link` (bypass do Claude plugin)

### **FACTA-PROXY** nasce (#722, #727, #731, #737)
**Problema**: FACTA exige IP autorizado, Vercel Edge Functions usam IPs dinâmicos → impossível integrar direto

**Solução**: Proxy Express rodando na máquina do escritório (IP fixo autorizado) + Cloudflare Tunnel exponindo como `facta-proxy.cbdw.com.br`

**Arquitetura completa**:
```
FlowForce (Vercel) → api/facta.js → POST /relay → Cloudflare Tunnel → localhost:3456 → FACTA webservice
```

**server.js** (Express, porta 3456):
- Endpoints: `GET /health` (sem auth), `GET /ip` (via ipify.org), `POST /relay` (requer `X-Proxy-Key`)
- Auth Vercel↔proxy via header `X-Proxy-Key` (secret `FACTA_PROXY_SECRET`)
- Strip de hop-by-hop headers (Host, content-length)
- Logs: timestamp, method, path, status, latency ms
- `FACTA_BASE_URL` default: `https://webservice-homol.facta.com.br`

**README completo** documenta setup NSSM (Windows Service) + cloudflared service

**Commit `97bb9a3`**: 7 arquivos (354+/10−)
- Novos: `facta-proxy/server.js`, `package.json`, `.env.example`, `README.md`, `start.bat`, `.gitignore`
- Modificado: `api/facta.js`

**Vars Vercel necessárias**:
- `FACTA_PROXY_URL=https://facta-proxy.cbdw.com.br`
- `FACTA_PROXY_SECRET=<shared key>`

### Setup Windows do outro PC (PC-OK) (#765, #766, #771, #773, #774)
Problemas encontrados:
- Git não instalado / fora do PATH → usar https://git-scm.com/download/win
- `Invoke-WebRequest` em `C:\` falha por permissão → baixar em pasta do user
- `npm.ps1` bloqueado por ExecutionPolicy → `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` OU usar `cmd.exe`
- `npm install` funcionou: 65-69 packages, 0 vulnerabilidades
- Secret gerado: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- Valor gerado: `d75f8b52deaebbad9e48f6b5be3f7b8ad26f6ecb9eb6351d7d29a1db952a7ba6`

---

## 21/ABR/2026 — Batalha FACTA + rebrand + refactor multi-banco

### Madrugada — guerra do facta-proxy

#### `FACTA_PROXY_SECRET` obrigatório (#793, #812, #814)
- `node server.js` aborta com "❌ FACTA_PROXY_SECRET nao configurado. Abortando."
- Startup guard: `process.exit(1)` se não existir

#### Fix auto-load do .env (#796) — commit `bf49274`
- "fix: carrega .env automaticamente no proxy (sem depender de dotenv)"
- 21 inserções em `facta-proxy/server.js`

#### Deploy em produção (#784, #786, #857, #858, #859)
- `vercel --prod` gerava preview URLs em vez de promover → usar `vercel deploy --prod --yes`
- Erro 400 "project names must be lowercase" quando shell cwd era `C:\Program Files\Git` → sempre `cd` pro projeto primeiro
- 10+ deploys em ~57 min, todos Ready em 10-11s

#### FACTA 500 — JSON error (#842, #846, #849)
- **Root cause**: `echo "value" | vercel env add` injeta `\n` no valor
- `FACTA_PROXY_URL` virou `'https://facta-proxy.cbdw.com.br\n'` → URL malformada → HTML 404 → proxy retorna HTML em vez de JSON → 500
- **Fix**: `.trim()` em todas vars FACTA em `getConfig()` (commit `dd8cee6`)
- **Lição**: usar `printf` em vez de `echo` para vercel env add
- Antes (#842 commit `62dd588`): normalização de datas DD/MM/YYYY, CPF só dígitos, `Number()`/`parseInt()` explícitos, remoção de `valor_renda`+`contratos_refin` do payload, `console.log` de payload e resposta

#### Simulação FACTA (#842)
- `fmtDate()` converte ISO → DD/MM/YYYY
- Error extraction: `simD.mensagem || simD.erro || simD.error`
- Toast mostra até 200 chars

#### Cloudflare Access Service Token (#872, #873, #875)
- Motivo: Cloudflare Bot Fight Mode bloqueando Vercel → proxy
- `CF_ACCESS_CLIENT_ID` e `CF_ACCESS_CLIENT_SECRET` adicionados ao Vercel production
- Secret: `0ffd57f8550149b6f444d795f71f9e40c2e182fd34a11b1b9e39b3c2d7a3289a`
- `getConfig()` em api/facta.js expõe as duas vars (trim aplicado)
- Commit `30a565b`: "feat: Cloudflare Access Service Token nas requisicoes Vercel->proxy"

#### User-Agent fix (#861) — commit `4899a96`
- "fix: User-Agent no request pro facta-proxy (evita bloqueio Cloudflare Bot Fight)"

### Manhã — diagnóstico + fixes

#### Action `diag` (#879) — commit `31726cf`
- "debug: action=diag mostra env vars + faz ping no /health do proxy com headers CF-Access"
- 33 inserções

#### EADDRINUSE 3456 (#885)
- Nova instância do server.js falha porque já há processo na porta
- Fix: `netstat -ano | findstr :3456` + `taskkill /PID <pid> /F` OU mudar `PORT` env

#### Browser headers bypass (#883) — commit `7adf0c4`
- "fix: Proxy adiciona headers de navegador padrao pra bypass Cloudflare WAF da FACTA"
- 6 inserções em `facta-proxy/server.js`

#### WhatsApp backend (#900)
- Default em `getWppBackend()` trocado: `'waha'` → `'evolution'`
- Controlado pela chave localStorage `ff_wpp_backend`
- Endpoint switch: `/api/waha` ↔ `/api/evolution` via `wppCall()`

### Tarde — Refactor Option A + Rebrand Volt

#### Refactor bank_codes — Option A (#912-#919, #928) — commit `f29dbc3`
**Decisão**: remover campos Facta per-user; usar env vars pra master/gerente; JSONB pra código per-parceiro

**Migração Supabase** (`supabase_migration_facta_vendedor.sql`):
```sql
ALTER TABLE users DROP COLUMN IF EXISTS facta_vendedor;
ALTER TABLE users DROP COLUMN IF EXISTS facta_codigo_master;
ALTER TABLE users DROP COLUMN IF EXISTS facta_gerente_comercial;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_codes JSONB DEFAULT '{}'::jsonb;
CREATE INDEX idx_users_bank_codes ON users USING GIN (bank_codes);
```

**Estrutura**: `{facta: "93596", qitech: "xyz", daycoval: "abc", ...}`

**Backend `api/auth.js`**:
- Removidos 3 campos facta_* dos SELECTs em `list`, `me`
- Action `update_facta` → `update_bank_codes` (merge com `Object.assign`, remove null/empty)
- Audit log name: `'update_bank_codes'`

**Backend `api/facta.js`**:
- `getConfig()` lê `FACTA_CODIGO_MASTER` e `FACTA_GERENTE_COMERCIAL` do env (default "")
- `etapa1`: `fields.codigo_master = body.codigo_master || cfg.CODIGO_MASTER || ''`; igual para gerente; deleta se vazio
- `vendedor` continua vindo do frontend via `body.vendedor`

**Frontend `index.html`**:
- `_myFactaCodes` → `_myBankCodes`
- `factaGetMyCodes()` → `getMyBankCodes()` (lê `d.user.bank_codes`)
- `clearFactaCodesCache()` → `clearBankCodesCache()`
- Novo: `getMyBankCode(bank)` lookup por nome
- `digitarFactaPortFull` envia `vendedor` de `bank_codes.facta`
- `editBankCodes(u)`: prompt por banco via `BANK_CODE_LIST`

**Benefício**: adicionar QI Tech/Daycoval/C6 só requer estender `BANK_CODE_LIST`, sem migração

#### Inventário vars Vercel FACTA (#940)
| Var | Idade | Ambientes |
|---|---|---|
| FACTA_GERENTE_COMERCIAL | 2 min | Production |
| FACTA_CODIGO_MASTER | 4h | Production |
| FACTA_BASE_URL | 13h | Production |
| FACTA_PROXY_SECRET, FACTA_PROXY_URL | 14h | Production |
| FACTA_AUTH, FACTA_LOGIN_CERT | 12 dias | Dev/Preview/Prod |
| CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET | 13h | Production |

#### Rebrand FlowForce → Volt (#931)
- `<title>` mudou de "FlowForce" para "Volt"
- Favicon: quadrado arredondado com gradiente cyan→blue (`06B6D4→3B82F6`) e raio branco SVG
- **NÃO** mudou ainda: login screen "FlowForce" text, header "FF", WhatsApp templates, localStorage keys `ff_*`

#### Mapeamento APIs portabilidade (#934, #935, #936)
- **QI Tech** = **Quali** = **Qualibanking** (mesmo entity, rename)
- **C6**: SEM API de digitação de portabilidade
- **Daycoval**: COM API (portal `developer.daycoval.com.br/portal/#/docs/79f77b2f-3ee9-4fa6-aa07-c1c072fd7d2e`)
- Gerente Facta: **Rafael Vicente Silva** (valor da `FACTA_GERENTE_COMERCIAL`)
- API Key Daycoval: `2CSRq3x7jDr6lJPZVQoY+83Y` | Access Code: `575343`

#### Daycoval INSS REFIN PORT rules (#945)
Produtos 805990 (1.85%) a 806002 (1.56%) — 11 tiers
- Saldo mín portabilidade: R$500
- Parcela mín: R$20
- Troco mín: 2% ou R$100 (o maior)
- Taxa mín portabilidade: 1.34%; REFIN PORT: 1.66%
- Parcelas pagas mín: AGIBANK 15, INBURSA 13, FACTA 24, PAN 12, PINE/BRB/QI 0, outros 6
- Bancos NÃO portáveis: C6BANK, SAFRA, ALFA, MASTER, não-CIP
- Portabilidade pura NÃO oferecida — sempre com REFIN
- Unificação de parcelas NÃO permitida
- Margem negativa suportada (compensa via portabilidade)
- Arquivos: `DAYCOVAL-SIMULADORES-V-20042026.xlsx`, `INSS_0_1775753315217.pdf`

#### Carrinho de digitação (commits anteriores)
- `buildCartFromPort(pc, r)`, `buildCartFromMargem(r, tipo)`, `buildCartFromEleg(el)` (#834)
- Schema comum: cpf, nome, beneficio, tipo, banco, contrato_origem, valor_operacao
- Default banco: `FACTA`
- **#832** Op code `003500` = Portabilidade CIP + Refin
  - `isPortabilidade` inclui `['003500','3','4']`
  - Branch dedicado na linha 1313 em index.html
- **#831** commit `f4d0d9f`: "fix: carrinho de portabilidade — portContratos agora persiste via global"
  - Removida `var` redeclaração dentro de `renderConsulta`

---

## HISTÓRICO OPSMANAGER (relacionado, mesmo ecossistema)

**Path**: `C:\Users\clham\Documents\opsmanager\src\App.jsx`

### Partner filter fix (#926, #930, #932)
- **Bug**: parceiro via esteira completa (todas as propostas)
- **Descoberta**: `loadData` em App.jsx linha 1660 buscava de 2 fontes em paralelo:
  - QualiBanking → `portabilidades_enriched` (se tem effectiveParceiroId) ou `portabilidades`, filtrado `parceiro_id`
  - Consig360 → `consig_proposals`, filtrado só por `product ILIKE '%portab%'`, **sem scope de parceiro**
- **Fix**: adicionado `.ilike('squad_user_name', parceiroNomeFilter)` na q2 de Consig360
- `parceiroNomeFilter` resolvido via `parceiroInfo.nome` (parceiro logado) ou `allParceiros.find(p => p.id === effectiveParceiroId)` (admin)

### QI Tech → Quali rename em portabilidades (#921, #922, #937-#939, #943)
- Apenas `destination_bank_name` deve ser "Quali"; `origin_bank_name` mantém valor raw do `raw_data->originContract->lender->name`
- Revertido rename acidental em origin: 24 registros voltaram para "QI Tech"
- Outras origens: Agibank(14), Facta Financeira(3), Crefisa(2), Parati CFI(1), Santander(1), Mercantil(1), Sicredi(1), BCO Paulista(1)
- **Edge Function sync-qualibanking v13** deployada com `normalizeBankName()` embutido
- API base: `https://integration.ajin.io` / `QUALI_API_KEY`
- Endpoint: `/v3/loans/search` POST
- Dedup por `Map` keyed por `id`
- Retry 3x com backoff exp (2s, 4s, 6s) em 429
- Upsert em `portabilidades` com `onConflict: 'quali_id'`

### Divergência de contagem (#921, #922, #924)
- Abril/2026: `portabilidades` = 48 | `consig_proposals product ILIKE '%portab%'` = 30
- Distribuição mensal em consig_proposals: Jul/25(80) Ago(90) Set(87) Out(64) Nov(38) Dez(54) Jan/26(79) Fev(87) Mar(96) Abr(30)
- Gotcha do MCP `execute_sql`: múltiplas queries no mesmo call retornam só a última

### Identificação de digitadores Lhamascred (#952-#964)
**Problema inicial**: 1.113 de 1.251 propostas com user_id tinham `user_name` NULL

**Passos**:
1. **Enrich interno** (#954): UPDATE via CTE DISTINCT ON (user_id) propagou user_name conhecido; revelou top digitadores:
   - marines santos: 226
   - Taina Lucio da Luz: 214
   - Carlos Aurélio Saralegui Lhamas Júnior: 192 (3º — provavelmente dono da squad)
   - marina fernanda caldeira zeferino: 190
2. **Desagregação** (#955): UPDATE substituiu `squad_user_name='Lhamascred'` por `user_name` individual
3. **Edge Function sync-consig360 v7** (#956): dois lookups embutidos no sync
   - user_id → user_name (10k registros)
   - CPF → agente (80k da tabela `digitacoes`)
   - Hierarquia: lookup user_id → fallback CPF → label 'Lhamascred'
4. **Gap irredutível** (#960, #961, #962): 54 propostas ficaram com label genérico → 6 user_ids sem nome em lugar nenhum
   - Solução: chamada direta `GET https://api-prod.consig360.com.br/franchise/v1/users/{id}` com Bearer `carlos@lhamascred.com.br`
   - 6 nomes recuperados:
     - `802f4a00...` → Adrielle Pereira Carneiro (16)
     - `b8b6c831...` → NATHALIA FROMME FERREIRA LHAMAS (14) ← família
     - `e71ce090...` → THIAGO ALVES BARBOSA (13)
     - `a19aa9a0...` → Rafaela Melo de Souza (A.C) (6)
     - `cb61bedd...` → victoria valentini barazal luiz (A.R) (3)
     - `579d1089...` → ALDENIZE ARAUO ROCHA (2)
5. **Estado final** (#963, #964):
   - generico_restante = 0 (objetivo 100% cumprido)
   - com_digitador = 5.534 de 5.699 (97,1%)
   - 165 restantes = parceiros PJ (digitador individual não rastreado)
   - Duplicatas detectadas: "marines santos"(226) vs "MARINES SANTOS 98301365072"(207) — mesmo digitador, grafias diferentes (próximo passo: normalização)

---

## ESTADO ATUAL (2026-04-21 14:48 GMT-3)

### Uncommitted no working tree motordeport (#927)
- `api/auth.js`
- `api/facta.js`
- `index.html`
- `supabase_migration_facta_vendedor.sql`
(Commit `f29dbc3` cobre isso — ver #928)

### Gotchas permanentes
1. `echo "val" | vercel env add` → injeta `\n`. Usar `printf` sempre.
2. Bash cwd às vezes reseta para `C:\Program Files\Git` — sempre `cd` explícito antes de `vercel deploy`.
3. PowerShell interpreta emojis em stdout como comando. Usar cmd.exe ou redirecionar.
4. `npm.ps1` bloqueado por ExecutionPolicy — usar cmd.exe ou `Set-ExecutionPolicy RemoteSigned`.
5. LocalStorage tem dois prefixes (`ff_*` e `lhm_*`) — cuidado em refactors.
6. QI Tech = Quali = Qualibanking (rebrand, mesma entidade).
7. `execute_sql` multi-query retorna só última.
8. C6 não tem API de portabilidade; Daycoval tem.

### Próximos passos prováveis
- Completar rebrand Volt (login, header, WhatsApp templates)
- Normalizar duplicatas de digitador (nome vs nome+CPF)
- Onboarding banco novo via `BANK_CODE_LIST`
- Revisar mapeamento `parceiro_nome` vs `squad_user_name` na UI OpsManager (linha 2089)

---

## Commits principais (ordem cronológica)

| Hash | Data | Descrição |
|---|---|---|
| `cad0e47` | 14/abr | C6 Bank integration |
| `9972a51` | 14/abr | update_role action |
| `23875c3→9972a51` | 14/abr | Push auth update_role |
| `a50867a→6edb985` | 19/abr | Remove IDADE_MAX_INV |
| (invRules minAge 60) | 20/abr | FACTA/BRB/DIGIO minAge 60 |
| `13385eb` | 20/abr | Consulta unitaria passa idade/invalidez/DIB |
| `d6def1a` | 20/abr | PICPAY_CODE + guarda B1P |
| (COEFS refin) | 20/abr | Remove taxas entrada + 1.879% BRB |
| (COEFS teto) | 20/abr | Remove 1.879% (teto INSS 1.85%) |
| `97bb9a3` | 20/abr | FACTA Proxy complete (7 files) |
| `f87bc02→13385eb` | 20/abr | Age filter push |
| `dbab1f9→d6def1a` | 20/abr | PICPAY push |
| `ab11ad8→bf49274` | 21/abr | facta-proxy .env auto-load |
| `bf49274→62dd588` | 21/abr | simulacaoRapida normalização |
| `62dd588→197c387` | 21/abr | Debug: expor detalhe erro FACTA |
| `197c387→dd8cee6` | 21/abr | trim FACTA env vars |
| `cd8989e→4899a96` | 21/abr | User-Agent fix |
| `4899a96→30a565b` | 21/abr | CF Access Service Token |
| `30a565b→31726cf` | 21/abr | action=diag |
| `31726cf→7adf0c4` | 21/abr | Browser headers bypass |
| `bf49274→f4d0d9f` | 21/abr | portContratos scope fix |
| `f29dbc3` | 21/abr | bank_codes JSONB refactor (72+/51-) |

---

*Fim do histórico consolidado. Fontes: claude-mem observations #53, #56-57, #96, #109, #111-112, #434-435, #438, #465, #470, #472-473, #475, #479, #481, #487, #490, #504, #508, #722, #727, #731, #737, #765-766, #771, #773-774, #784, #786, #793, #796, #812, #814, #831-832, #834, #842, #846, #849, #857-859, #861, #872-873, #875, #879, #883, #885, #900, #912-919, #921-922, #924, #926-940, #943-945, #952-964 + sessions S29, S236, S241-S248, S250-S251, S256-S259, S263, S265-S273, S279, S281, S285-S286, S296.*
