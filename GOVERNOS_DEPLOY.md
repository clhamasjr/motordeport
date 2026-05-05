# Módulo GOVERNOS — Deploy & Operação

Módulo novo que adiciona **Catálogo de Convênios de Governo** + **Análise de Holerite** ao FlowForce. Resumo do que foi criado:

| Camada | Arquivo |
|---|---|
| Migration SQL | `supabase_migration_gov.sql` (4 tabelas com prefixo `gov_*`) |
| Endpoint API principal | `api/gov.js` |
| Endpoint de seed | `api/gov-seed.js` |
| Seed de dados | `gov_seed.json` (raiz, ~2.5 MB — servido como estático) |
| UI | `index.html` (telas `govCatalogo` e `govHolerite`, botão de reseed no admin) |
| Parser/scripts | `scripts/gov/01..05_*.py` |

---

## ✅ Já feito automaticamente

- Migration aplicada no Supabase `xtyvnocvckbvhwvdwdpo` (motordeport):
  - `gov_bancos` ✓
  - `gov_convenios` ✓
  - `gov_banco_convenio` ✓
  - `gov_holerite_analises` ✓
- 44 bancos populados
- 105 convênios populados
- **Falta apenas popular `gov_banco_convenio`** (409 relações) — ver seção a seguir

---

## 🚀 Como deployar (passo a passo)

### 1) Conferir variáveis de ambiente na Vercel

Em **Vercel → motordeport → Settings → Environment Variables**, garanta que existam:

| Variável | Para quê |
|---|---|
| `SUPABASE_URL` | já existe (mesma do INSS/CLT) |
| `SUPABASE_SERVICE_KEY` | já existe |
| `CLAUDE_API_KEY` | já existe (mesma usada pelo agente CLT/INSS) |
| `WEBHOOK_SECRET` | já existe — usado pra autenticar o reseed via curl |
| `APP_URL` | já existe (`https://flowforce.vercel.app` ou similar) |

**Não precisa adicionar nada novo.**

### 2) Commit + push

```bash
cd C:\Users\clham\Documents\motordeport
git add -A
git commit -m "feat(gov): catalogo de convenios + analise de holerite por IA"
git push
```

A Vercel deploya automaticamente. O `gov_seed.json` na raiz fica acessível em `https://flowforce.vercel.app/gov_seed.json`.

### 3) Popular `gov_banco_convenio` (1ª vez e quando atualizar a planilha)

**Opção A — Pelo painel admin (recomendada):**
1. Loga como admin no FlowForce
2. Vai em **Admin → Usuários & Bancos**
3. Rola até **🛠️ Manutenção** no fim da página
4. Clica em **🔄 Reseed**
5. Aguarda ~5 segundos. Aparece: `✓ Concluído em 4.2s · 44 bancos · 105 convênios · 409 relações`

**Opção B — Via curl:**
```bash
curl -X POST https://flowforce.vercel.app/api/gov-seed \
     -H "Content-Type: application/json" \
     -H "x-internal-secret: SEU_WEBHOOK_SECRET_AQUI" \
     -d '{"action":"reseed"}'
```

### 4) Verificar que está funcionando

No FlowForce logado:
- **Sidebar → 🏛️ Governos → Catálogo de Convênios** → deve listar 105 convênios agrupados por UF
- **Sidebar → 🏛️ Governos → Análise de Holerite** → upload de PDF/imagem deve extrair dados e listar bancos compatíveis

---

## 🔄 Workflow de atualização da planilha

Quando vocês atualizarem a planilha de convênios:

```bash
cd C:\Users\clham\Documents\motordeport\scripts\gov

# 1. Coloca a planilha nova no caminho hardcoded de 02_parse.py
#    OU edita o XLSX path no script
python 02_parse.py            # gera convenios.json
python 05_compact_seed.py     # gera ../../gov_seed.json (raiz do repo)

# 2. Push
cd ../..
git add gov_seed.json
git commit -m "feat(gov): atualiza seed de convenios"
git push

# 3. Após deploy, clica "Reseed" no admin (passo 3.A acima)
```

> ⚠️ O reseed faz `DELETE FROM gov_banco_convenio` antes de re-inserir. **Não afeta** as análises de holerite já feitas (essas ficam na tabela `gov_holerite_analises`, intocada).

---

## 📊 Arquitetura

### Fluxo: Parceiro consulta convênio
```
Parceiro abre /govCatalogo
  → frontend chama POST /api/gov action:listConvenios
  → backend lê gov_convenios + gov_banco_convenio (Supabase)
  → retorna agrupado por UF
Parceiro clica num convênio
  → frontend chama POST /api/gov action:getConvenio slug:xxx
  → mostra todas as regras + bancos que operam
```

### Fluxo: Análise de holerite
```
Parceiro sobe holerite (PDF/imagem)
  → frontend converte pra base64
  → POST /api/gov action:analisarHolerite + arquivo_base64
  → backend cria registro em gov_holerite_analises (status: processando)
  → backend chama Claude API (claude-sonnet-4-5) com PDF/imagem nativos
  → Claude retorna JSON estruturado com nome, idade, salário, margem, órgão
  → backend identifica convênio (por nome/UF) ou usa o forçado pelo usuário
  → backend cruza dados extraídos com gov_banco_convenio:
      - Filtra por idade (idade_min/max do banco)
      - Filtra por suspenso (descarta)
      - Filtra por opera_* (banco precisa operar pelo menos 1 produto)
  → atualiza gov_holerite_analises (status: concluido)
  → retorna lista de bancos atendem + bancos não atendem com motivo
```

### Tabelas
- **`gov_bancos`** — 44 bancos (Daycoval, Pan, Olé, Hope etc.)
- **`gov_convenios`** — 105 convênios (estados, tribunais, ministérios)
- **`gov_banco_convenio`** — relação N:N com regras parametrizadas:
  - Booleanos: `opera_novo`, `opera_refin`, `opera_port`, `opera_cartao`, `suspenso`
  - Numéricos: `margem_utilizavel`, `idade_min/max`, `taxa_minima_port`
  - Texto livre: `data_corte`, `valor_minimo`, `qtd_contratos`
  - JSONB: `atributos` (slugs canônicos) + `atributos_brutos` (labels originais por seção)
- **`gov_holerite_analises`** — auditoria das análises feitas (UUID, dados extraídos, bancos atendem/não, duração, modelo IA)

---

## 🔒 Permissões

- **Catálogo de Convênios**: todos os usuários logados
- **Análise de Holerite**: todos os usuários logados (parceiro vê só as próprias análises; admin/gestor vê todas)
- **Reseed**: apenas admin/gestor (ou chamada interna com `x-internal-secret`)

---

## 🐛 Troubleshooting

**"Convênio não identificado"** na análise de holerite
→ A IA não conseguiu casar o órgão extraído com nenhum convênio na base. Use o dropdown "Convênio" da tela pra forçar manualmente.

**Reseed falha com "Falha ao carregar /gov_seed.json"**
→ Verifique que `gov_seed.json` está na **raiz** do repo (não em `/public/`). Vercel serve arquivos da raiz como estáticos junto com `index.html`.

**Análise de holerite trava em "Analisando..."**
→ Vercel Edge tem timeout de 25s. PDFs muito grandes (>5MB) ou cheios podem demorar. Use imagem JPG/PNG quando possível.

**`CLAUDE_API_KEY` não funciona**
→ É a mesma chave do agente CLT. Confirme na Vercel que está em ambiente Production e Preview.
