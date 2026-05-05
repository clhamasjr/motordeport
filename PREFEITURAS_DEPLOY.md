# Módulo PREFEITURAS — Deploy & Operação

Módulo novo que adiciona **Catálogo de Convênios de Prefeituras** + **Análise de Holerite** ao FlowForce. Espelha 100% o módulo Governos (`gov_*`) mas com prefixo `pref_` e adiciona campos `municipio` e `tipo` nos convênios.

| Camada | Arquivo |
|---|---|
| Migration SQL | `supabase_migration_pref.sql` (4 tabelas com prefixo `pref_*`) |
| Endpoint API principal | `api/pref.js` |
| Endpoint de seed | `api/pref-seed.js` |
| Seed de dados | `pref_seed.json` (raiz, ~5.7 MB — servido como estático) |
| UI | `index.html` (telas `prefCatalogo` e `prefHolerite`, botão de reseed no admin) |
| Parser/scripts | `scripts/pref/02_parse.py` + `05_compact_seed.py` |

---

## ✅ Já feito automaticamente

- Migration aplicada no Supabase `xtyvnocvckbvhwvdwdpo` (motordeport):
  - `pref_bancos` ✓
  - `pref_convenios` ✓
  - `pref_banco_convenio` ✓
  - `pref_holerite_analises` ✓
- Parser rodado e `pref_seed.json` gerado:
  - **418 convênios** (prefeituras + institutos previdência + cartões benefício)
  - **38 bancos únicos** (Daycoval, Amigoz, Hope, Master, Bradesco, AKI Capital, VemCard, etc.)
  - Distribuição: SP=130, PR=37, MG=36, RJ=25, RS=19, GO=17, CE=16, ES=16, MA=15, SC=14...
  - Tipos: 221 prefeituras, 111 cartões benefício, 54 institutos previdência, 32 outros
- UI integrada no FlowForce:
  - Sidebar nova seção **🏙️ Prefeituras** com 2 telas
  - Botão **🔄 Reseed Catálogo de Prefeituras** no admin → Manutenção
- Endpoints `api/pref.js` e `api/pref-seed.js` criados (mesma arquitetura do `gov.js`)

**Falta apenas: git push + reseed no admin.**

---

## 🚀 Como deployar (passo a passo)

### 1) Variáveis de ambiente na Vercel

Mesmas do módulo Governos — **não precisa adicionar nada novo**:

| Variável | Para quê |
|---|---|
| `SUPABASE_URL` | já existe |
| `SUPABASE_SERVICE_KEY` | já existe |
| `CLAUDE_API_KEY` | já existe (mesma do agente CLT/INSS/Gov) |
| `WEBHOOK_SECRET` | já existe |
| `APP_URL` | já existe |

### 2) Commit + push

```bash
cd C:\Users\clham\Documents\motordeport
git add supabase_migration_pref.sql api/pref.js api/pref-seed.js scripts/pref/ pref_seed.json index.html PREFEITURAS_DEPLOY.md
git commit -m "feat(pref): catalogo de prefeituras + analise de holerite por IA (418 convenios)"
git push
```

A Vercel deploya automaticamente. O `pref_seed.json` (~5.7MB) na raiz fica acessível em `https://flowforce.vercel.app/pref_seed.json`.

### 3) Popular `pref_banco_convenio` (1ª vez e quando atualizar a planilha)

**Opção A — Pelo painel admin (recomendada):**
1. Loga como admin no FlowForce
2. Vai em **Admin → Usuários & Bancos**
3. Rola até **🛠️ Manutenção** no fim da página
4. Clica em **🔄 Reseed** ao lado de **🏙️ Reseed Catálogo de Prefeituras**
5. Aguarda ~30-60 segundos (são 400+ convênios e ~3000 relações). Aparece: `✓ Concluído em 45.2s · 38 bancos · 418 convênios · 3127 relações`

**Opção B — Via curl:**
```bash
curl -X POST https://flowforce.vercel.app/api/pref-seed \
     -H "Content-Type: application/json" \
     -H "x-internal-secret: SEU_WEBHOOK_SECRET" \
     -d '{"action":"reseed"}'
```

### 4) Verificar que está funcionando

No FlowForce logado:
- **Sidebar → 🏙️ Prefeituras → Catálogo de Convênios** → deve listar 418 convênios agrupados por UF, com filtro por tipo (prefeitura / instituto previdência / cartão benefício) e busca por município
- **Sidebar → 🏙️ Prefeituras → Análise de Holerite** → upload de PDF/imagem deve extrair dados, identificar prefeitura por município+UF e listar bancos compatíveis

---

## 🔄 Workflow de atualização da planilha

Quando vocês atualizarem a planilha de prefeituras:

```bash
cd C:\Users\clham\Documents\motordeport\scripts\pref

# 1. Edita o caminho XLSX em 02_parse.py se mudou de arquivo
python 02_parse.py            # gera scripts/pref/convenios.json
python 05_compact_seed.py     # gera pref_seed.json na raiz

# 2. Push
cd ../..
git add pref_seed.json
git commit -m "feat(pref): atualiza seed de convenios de prefeitura"
git push

# 3. Após deploy, clica "Reseed" no admin (passo 3.A acima)
```

> ⚠️ O reseed faz `DELETE FROM pref_banco_convenio` antes de re-inserir. **Não afeta** as análises de holerite já feitas (essas ficam na tabela `pref_holerite_analises`, intocada).

---

## 📊 Arquitetura

### Fluxo: Parceiro consulta convênio
```
Parceiro abre /prefCatalogo
  → frontend chama POST /api/pref action:listConvenios (uf?, tipo?, busca?)
  → backend lê pref_convenios + pref_banco_convenio (Supabase)
  → retorna agrupado por UF
Parceiro clica num convênio
  → frontend chama POST /api/pref action:getConvenio slug:xxx
  → mostra todas as regras + bancos que operam
```

### Fluxo: Análise de holerite
```
Parceiro sobe holerite (PDF/imagem)
  → frontend converte pra base64
  → POST /api/pref action:analisarHolerite + arquivo_base64
  → backend cria registro em pref_holerite_analises (status: processando)
  → backend chama Claude API (claude-sonnet-4-5) com PDF/imagem nativos
  → Claude retorna JSON estruturado: nome, idade, salário, margem, MUNICIPIO, UF, órgão
  → backend identifica convênio:
      1. Se usuario forçou (convenio_slug), usa esse
      2. Senão busca por municipio+UF (mais preciso pra prefeituras)
      3. Senão busca por convenio_sugerido (nome)
      4. Prioriza tipo=prefeitura sobre cartao_beneficio quando ha multiplos
  → backend cruza dados extraídos com pref_banco_convenio:
      - Filtra por idade (idade_min/max do banco)
      - Filtra por suspenso (descarta)
      - Filtra por opera_* (banco precisa operar pelo menos 1 produto)
  → atualiza pref_holerite_analises (status: concluido)
  → retorna lista de bancos atendem + bancos não atendem com motivo
```

### Tabelas
- **`pref_bancos`** — 38 bancos (Daycoval, Amigoz, Hope, Master, Bradesco, etc.)
- **`pref_convenios`** — 418 convênios com:
  - `municipio` (ex: 'Sorocaba', 'Belo Horizonte', 'Recife')
  - `tipo` ('prefeitura' | 'instituto_previdencia' | 'cartao_beneficio' | 'outro')
  - `uf` (sigla 2 letras)
- **`pref_banco_convenio`** — relação N:N com regras parametrizadas (mesmo schema do gov)
- **`pref_holerite_analises`** — auditoria das análises feitas

---

## 🔒 Permissões

- **Catálogo de Convênios**: todos os usuários logados
- **Análise de Holerite**: todos (parceiro vê só as próprias análises; admin/gestor vê todas)
- **Reseed**: apenas admin/gestor (ou chamada interna com `x-internal-secret`)

---

## 🐛 Troubleshooting

**"Convênio não identificado"** na análise de holerite
→ A IA não conseguiu casar o município/órgão extraído com nenhum convênio na base. Use o dropdown "Convênio" da tela pra forçar manualmente.

**Reseed falha com "Falha ao carregar /pref_seed.json"**
→ Verifique que `pref_seed.json` está na **raiz** do repo (não em `/public/`). Vercel serve arquivos da raiz como estáticos junto com `index.html`.

**Reseed timeout (Vercel Edge limita a 25s)**
→ O reseed faz upserts em batch — pode demorar mais com 400+ convênios. Se timeoutar, rode 2x: a 1ª popula bancos+convênios, a 2ª completa as relações (idempotente).

**Análise de holerite trava em "Analisando..."**
→ Vercel Edge tem timeout de 25s. PDFs muito grandes (>5MB) ou cheios podem demorar. Use imagem JPG/PNG quando possível.

**Convênio errado identificado (ex: pegou Cartão Benefício ao invés da Prefeitura)**
→ O código já prioriza `tipo=prefeitura` sobre `cartao_beneficio`, mas se mesmo assim errar, force pelo dropdown.

---

## 📐 Diferenças vs Módulo Governos

| Aspecto | Governos | Prefeituras |
|---|---|---|
| Total convênios | ~105 | ~418 |
| Total bancos | ~44 | ~38 |
| Granularidade | Por estado/órgão (ex: TJMG, GOV PA) | Por município (ex: PREF SOROCABA, IPREM CAMPINAS) |
| Detecção de UF | Por nome da aba (regex) | Por **contexto** — abas separadoras (1x1) marcam início de cada UF na ordem |
| Campo extra | — | `municipio`, `tipo` (prefeitura/instituto/CB/outro) |
| Identificação no holerite | Por nome do órgão | Por **município + UF** primeiro (mais preciso), fallback por nome |
| Tamanho seed | ~2.5 MB | ~5.7 MB |

---

## 📝 Histórico

- **2026-05-05** — Módulo criado (espelhando Governos). Migration aplicada, parser rodado, seed gerado, UI integrada. Pronto pra `git push` + reseed.
