# Módulo FEDERAIS — Deploy & Operação

Módulo novo que adiciona **Catálogo de Convênios Federais** (SIAPE / SERPRO / Forças Armadas) + **Análise de Contracheque** ao FlowForce. Espelha 100% os módulos Governos (`gov_*`) e Prefeituras (`pref_*`) — mesma arquitetura, prefixo `fed_*`, com 2 campos extras: `categoria` (civil|militar) e `orgao` (SIAPE/SERPRO/MARINHA/EXERCITO/AERONAUTICA).

| Camada | Arquivo |
|---|---|
| Migration SQL | `supabase_migration_fed.sql` (4 tabelas com prefixo `fed_*`) |
| Endpoint API principal | `api/fed.js` |
| Endpoint de seed | `api/fed-seed.js` |
| Seed de dados | `fed_seed.json` (raiz, ~0.6 MB — servido como estático) |
| UI | `index.html` (telas `fedCatalogo` e `fedHolerite`, botão de reseed no admin) |
| Parser/scripts | `scripts/fed/02_parse.py` + `05_compact_seed.py` |
| Planilha origem | `scripts/FEDERAIS_RESUMO.xlsx` |

---

## ✅ O que já está pronto

- Migration `supabase_migration_fed.sql` criada (4 tabelas `fed_*`).
- Parser rodado e `fed_seed.json` gerado:
  - **8 convênios** (4 SIAPE + SERPRO + Marinha + Exército + Aeronáutica)
  - **36 bancos únicos** (Daycoval, Pan, Facta, Quero+Crédito, Safra/Alfa, Banrisul, Futuro Previdência, CCB, Sabemi, Itaú, BMG, Presença Bank, AKI Capital, Paraná Banco, BRB, etc.)
  - Distribuição: **civil**=5 (4 SIAPE + SERPRO) · **militar**=3 (Marinha, Exército, Aeronáutica)
  - Top bancos: DAYCOVAL (8 convênios), PAN (6), FACTA (6), QUERO+CRÉDITO (6), SAFRA/ALFA (5)
- Endpoints `api/fed.js` e `api/fed-seed.js` criados (mesma arquitetura do `pref.js`).
- UI integrada no FlowForce:
  - Sidebar nova seção **🇧🇷 Federal** com 2 telas (Catálogo + Análise de Contracheque)
  - Botão **🔄 Reseed Catálogo Federal** no admin → Manutenção

**Falta apenas: aplicar a migration no Supabase + git push + reseed no admin.**

---

## 🚀 Como deployar (passo a passo)

### 1) Aplicar a migration no Supabase do FlowForce

```bash
# Pelo SQL Editor do Supabase (rirsmtyuyqxsoxqbgtpu / motordeport):
# Cola o conteúdo de supabase_migration_fed.sql e roda.

# OU via CLI (se preferir):
psql "<STRING_DE_CONEXAO>" -f supabase_migration_fed.sql
```

Cria 4 tabelas, todas com `if not exists` (idempotente):
- `fed_bancos`
- `fed_convenios`
- `fed_banco_convenio`
- `fed_holerite_analises`

### 2) Variáveis de ambiente na Vercel

Mesmas dos módulos Governos / Prefeituras — **não precisa adicionar nada novo**:

| Variável | Para quê |
|---|---|
| `SUPABASE_URL` | já existe |
| `SUPABASE_SERVICE_KEY` | já existe |
| `CLAUDE_API_KEY` | já existe (mesma do agente CLT/INSS/Gov/Pref) |
| `WEBHOOK_SECRET` | já existe |
| `APP_URL` | já existe |

### 3) Commit + push

```bash
cd C:\Users\clham\Documents\motordeport
git add supabase_migration_fed.sql api/fed.js api/fed-seed.js scripts/fed/ fed_seed.json index.html FEDERAIS_DEPLOY.md scripts/FEDERAIS_RESUMO.xlsx
git commit -m "feat(fed): catalogo federal SIAPE/SERPRO/Forcas Armadas + analise de contracheque por IA (8 convenios)"
git push
```

A Vercel deploya automaticamente. O `fed_seed.json` (~0.6MB) na raiz fica acessível em `https://flowforce.vercel.app/fed_seed.json`.

### 4) Popular `fed_banco_convenio` (1ª vez e quando atualizar a planilha)

**Opção A — Pelo painel admin (recomendada):**
1. Loga como admin no FlowForce
2. Vai em **Admin → Usuários & Bancos**
3. Rola até **🛠️ Manutenção** no fim da página
4. Clica em **🔄 Reseed** ao lado de **🇧🇷 Reseed Catálogo Federal**
5. Aguarda ~3-5 segundos. Aparece: `✓ Concluído em 4.2s · 36 bancos · 8 convênios · 99 relações`

**Opção B — Via curl:**
```bash
curl -X POST https://flowforce.vercel.app/api/fed-seed \
     -H "Content-Type: application/json" \
     -H "x-internal-secret: <WEBHOOK_SECRET>" \
     -d '{"action":"reseed"}'
```

### 5) Verificar que está funcionando

No FlowForce logado:
- **Sidebar → 🇧🇷 Federal → Catálogo de Convênios** → deve listar 8 convênios agrupados por categoria (Civis × Militares), com filtro por órgão (SIAPE/SERPRO/MARINHA/EXERCITO/AERONAUTICA) e busca livre
- **Sidebar → 🇧🇷 Federal → Análise de Contracheque** → upload de PDF/imagem deve extrair dados, identificar SIAPE × militar pelo contracheque, e listar bancos compatíveis

---

## 🔄 Workflow de atualização da planilha

Quando vocês atualizarem a planilha de federais (toda vez que o time atualizar regras):

```bash
# 1. Substitui a planilha mestre
cp "C:\Users\clham\Downloads\FEDERAIS - RESUMO OPERACIONAL CONVENIOS_<NOVO>.xlsx" \
   "C:\Users\clham\Documents\motordeport\scripts\FEDERAIS_RESUMO.xlsx"

# 2. Roda o parser
cd C:\Users\clham\Documents\motordeport\scripts\fed
python 02_parse.py            # gera scripts/fed/convenios.json
python 05_compact_seed.py     # gera fed_seed.json na raiz

# 3. Push
cd ../..
git add fed_seed.json scripts/FEDERAIS_RESUMO.xlsx
git commit -m "feat(fed): atualiza seed de convenios federais"
git push

# 4. Após deploy, clica "Reseed" no admin (passo 4.A acima)
```

> ⚠️ O reseed faz `DELETE FROM fed_banco_convenio` antes de re-inserir. **Não afeta** as análises de contracheque já feitas (essas ficam na tabela `fed_holerite_analises`, intocada).

---

## 📊 Arquitetura

### Convênios mapeados

A planilha origem tem ~32 abas, mas só 8 são convênios principais. As demais são auxiliares:
- **SKIPPED** (auxiliares): `Planilha1`, `Planilha2`, `FEDERAL` (capa), `SIAPE` (vazia), `UPAGS COM MARGEM DE SEGURANÇA`, `SIAPE PUBLICO ALVO`, `SIAPE LIMITE OPERACIONAL`, `FORÇAS ARMADAS` (capa), `PREC-CP`, `PREC - FUTURO PREV`, e todas as 14 abas `* UPAGs` (listagens auxiliares de UPAGs por banco).
- **CONVÊNIOS** (mapeados):

| Aba origem | Convênio | Categoria | Órgão | Operação |
|---|---|---|---|---|
| `SIAPE NOVO-REFIN` | SIAPE - Novo / Refinanciamento | civil | SIAPE | novo_refin |
| `SIAPE PORTABILIDADE` | SIAPE - Portabilidade | civil | SIAPE | portabilidade |
| `CARTÃO SIAPE` | SIAPE - Cartão Consignado (RMC) | civil | SIAPE | cartao_consignado |
| `CARTÃO BENEFICIO` | SIAPE - Cartão Benefício (RCC) | civil | SIAPE | cartao_beneficio |
| `SERPRO` | SERPRO | civil | SERPRO | completo |
| `AERONÁUTICA` | Forças Armadas - Aeronáutica | militar | AERONAUTICA | completo |
| `EXÉRCITO` | Forças Armadas - Exército | militar | EXERCITO | completo |
| `MARINHA` | Forças Armadas - Marinha | militar | MARINHA | completo |

### Fluxo: Parceiro consulta convênio
```
Parceiro abre /fedCatalogo
  → frontend chama POST /api/fed action:listConvenios (categoria?, orgao?, busca?)
  → backend lê fed_convenios + fed_banco_convenio (Supabase)
  → retorna agrupado por categoria (civil × militar)
Parceiro clica num convênio
  → frontend chama POST /api/fed action:getConvenio slug:xxx
  → mostra todas as regras + bancos que operam
```

### Fluxo: Análise de contracheque
```
Parceiro sobe contracheque (PDF/imagem) — pode ser SIAPE ou militar
  → frontend converte pra base64
  → POST /api/fed action:analisarHolerite + arquivo_base64
  → backend cria registro em fed_holerite_analises (status: processando)
  → backend chama Claude API (claude-sonnet-4-5) com PDF/imagem nativos
  → Claude retorna JSON estruturado: nome, idade, salário, margem,
       categoria_servidor (civil|militar), orgao_federal (SIAPE|SERPRO|MARINHA|...),
       patente/situacao_militar/prec_cp se for militar
  → backend identifica convênio:
      1. Se usuario forçou (convenio_slug), usa esse
      2. Senão busca por orgao + categoria (mais preciso)
      3. Senão busca por convenio_sugerido (nome)
      4. Prioriza operacao_tipo='novo_refin' sobre 'portabilidade'/'cartao' quando ha multiplos
  → backend cruza dados extraídos com fed_banco_convenio:
      - Filtra por idade (idade_min/max do banco)
      - Filtra por suspenso (descarta)
      - Filtra por opera_* (banco precisa operar pelo menos 1 produto)
  → atualiza fed_holerite_analises (status: concluido)
  → retorna lista de bancos atendem + bancos não atendem com motivo
```

### Tabelas
- **`fed_bancos`** — 36 bancos (Daycoval, Pan, Facta, etc.)
- **`fed_convenios`** — 8 convênios com:
  - `categoria` ('civil' | 'militar')
  - `orgao` ('SIAPE' | 'SERPRO' | 'MARINHA' | 'EXERCITO' | 'AERONAUTICA')
  - `operacao_tipo` ('novo_refin' | 'portabilidade' | 'cartao_consignado' | 'cartao_beneficio' | 'completo')
- **`fed_banco_convenio`** — relação N:N com regras parametrizadas (mesmo schema do gov/pref)
- **`fed_holerite_analises`** — auditoria das análises feitas (campos militares: patente, situacao_militar, prec_cp)

---

## 🔒 Permissões

- **Catálogo Federal**: todos os usuários logados
- **Análise de Contracheque**: todos (parceiro vê só as próprias análises; admin/gestor vê todas)
- **Reseed**: apenas admin/gestor (ou chamada interna com `x-internal-secret`)

---

## 🐛 Troubleshooting

**"Convênio não identificado"** na análise de contracheque
→ A IA não conseguiu casar o órgão extraído com nenhum convênio na base. Use o dropdown "Convênio" da tela pra forçar manualmente. Para SIAPE, costuma ser difícil pq o contracheque pode ser de qualquer um dos 4 sub-convênios — quase sempre você quer **SIAPE - Novo / Refinanciamento** (que é o caso geral).

**Reseed falha com "Falha ao carregar /fed_seed.json"**
→ Verifique que `fed_seed.json` está na **raiz** do repo (não em `/public/`). Vercel serve arquivos da raiz como estáticos junto com `index.html`.

**Análise de contracheque trava em "Analisando..."**
→ Vercel Edge tem timeout de 25s. PDFs muito grandes (>5MB) ou cheios podem demorar. Use imagem JPG/PNG quando possível.

**Contracheque militar identificado como SIAPE (ou vice-versa)**
→ A IA tenta inferir `categoria_servidor` (civil | militar) pelos campos do contracheque (patente, PREC-CP, posto militar). Se errar, force pelo dropdown.

**SIAPE: identificou o convênio errado entre os 4 sub-convênios**
→ O backend prioriza `operacao_tipo='novo_refin'` automaticamente. Se você quer port/cartão, force pelo dropdown.

---

## 📐 Diferenças vs Módulos Governos / Prefeituras

| Aspecto | Governos | Prefeituras | **Federais** |
|---|---|---|---|
| Total convênios | ~105 | ~418 | **8** |
| Total bancos | ~44 | ~38 | **36** |
| Granularidade | Por estado/órgão (ex: TJMG) | Por município (ex: PREF SOROCABA) | **Por órgão federal e tipo de operação (ex: SIAPE Novo/Refin)** |
| Campo extra | `uf` | `uf`, `municipio`, `tipo` | **`categoria` (civil/militar), `orgao`, `operacao_tipo`** |
| Identificação no holerite | Por nome do órgão | Por município + UF | **Por órgão federal + categoria militar/civil** |
| Tamanho seed | ~2.5 MB | ~5.7 MB | **~0.6 MB** |

---

## 📝 Histórico

- **2026-05-05** — Módulo criado (espelhando Governos/Prefeituras). Migration criada, parser rodado, seed gerado, UI integrada. Pronto pra aplicar migration + `git push` + reseed.
