# RUNBOOK — Atualizar o Catálogo de GOVERNOS (estaduais) do FlowForce a partir da planilha

> **Como usar (dono):** cole este arquivo inteiro como prompt no agente (Claude Code aberto na pasta
> `C:\Users\clham\Documents\motordeport`), troque só a linha **PLANILHA** abaixo pelo caminho da planilha
> nova e mande. O agente segue os passos na ordem, **para nos dois portões** (aprovar diff / push) e devolve
> o relatório final. Validado de ponta a ponta em 17/09/2026 (planilha de set/2026: 107 convênios, 48 bancos).

```
PLANILHA: C:\Users\clham\Downloads\<GOVERNOS  RESUMO OPERACIONAL CONVENIOS_...>.xlsx
LEV: remover   (decisao do dono em 17/09/2026, igual ao federal; "manter" so se ele pedir)
```

---

## Você (agente) vai fazer

Atualizar o catálogo de convênios de **GOVERNOS ESTADUAIS** (Gov SP, MG, PR, BA, tribunais, assembleias,
institutos de previdência estaduais, cartão benefício etc.) do FlowForce a partir da planilha acima e publicar
em produção. Responda em português, direto. O dono não é programador: entregue pronto, mostre resultados.

### Contexto que você precisa saber (não redescubra)
- Repo: `C:\Users\clham\Documents\motordeport`, branch `main`. Outra sessão pode publicar em `main` em paralelo.
- Catálogo = tabelas `gov_convenios` / `gov_bancos` / `gov_banco_convenio` no **Supabase**, lidas pela API
  `api/gov.js` no **Vercel** (`motordeport.vercel.app`). O V2 (`flowforce.tec.br`, Docker na VPS) só exibe —
  **não precisa de deploy na VPS** (o workflow da VPS só roda quando `v2-next/**` muda).
- Fonte da verdade: `scripts/GOVERNOS_RESUMO.xlsx` → pipeline Python em `scripts/gov/` → `gov_seed.json`
  (raiz, servido estático pelo Vercel) → endpoint `POST /api/gov-seed {"action":"reseed"}` grava no Supabase.
- **O reseed de governos é conservador** (diferente do federal): só INSERE bancos/convênios novos (nome/UF dos
  existentes podem ter sido corrigidos na tela e não são sobrescritos), carimba `atualizado_em` nos que já
  existiam, apaga e recria as relações banco×convênio **exceto** as marcadas `editado_manual=true` (correções
  feitas pelo admin na tela). Convênios que sumiram da planilha **não são apagados** — ficam como estão.
- A planilha tem ~150 abas; ~30 são placeholders vazios ("sem colunas", "0 linhas") ou auxiliares (ADF,
  índices por estado). O parser ignora as auxiliares via `SKIP_SHEETS` e reporta as vazias como "problemas" —
  isso é normal. Só investigue uma aba-problema se ela **era convênio no seed anterior** (regressão).
- **LEV = Lev Negócios, a averbadora** (não é banco). Em governos ela aparece em ~70% dos convênios
  ("Quem faz a reserva de margem: LEV", "* Verificar também Regra LEV *", e-mails `@levnegocios.com.br`).
  No catálogo FEDERAL o dono decidiu remover toda menção (a LhamasCred não opera mais via LEV lá).
  Em 17/09/2026 o dono decidiu **remover também em governos**: o passo `03_clean_lev.py` roda sempre
  (757 campos limpos, 0 restantes na validação). Só mantenha a LEV se a linha **LEV:** do cabeçalho disser "manter".
- Pode haver alterações **não commitadas de outra frente** (ex.: `api/fed.js`, `v2-next/**`). **Não toque,
  não commite, não descarte.**
- Requisitos locais: Python 3 + `openpyxl` (já instalados), Git, Node.

---

## Passo a passo

### 0. Pré-checagem (1 min)
```bash
cd "C:/Users/clham/Documents/motordeport" && git fetch origin && git status -sb && python -c "import openpyxl;print('openpyxl ok')"
```
Anote arquivos modificados que não são do catálogo e siga sem mexer neles.

### 1. Trocar a planilha (com backup)
```bash
cd "C:/Users/clham/Documents/motordeport" && mkdir -p scripts/_backup && cp scripts/GOVERNOS_RESUMO.xlsx "scripts/_backup/GOVERNOS_RESUMO_$(date +%Y-%m-%d).xlsx" && cp "<PLANILHA>" scripts/GOVERNOS_RESUMO.xlsx
```
(`scripts/_backup/` está no .gitignore; a versão anterior também fica no histórico do git.)

### 2. Rodar o pipeline (nesta ordem — a planilha tem 13 MB, o parse leva 2–4 min)
```bash
cd "C:/Users/clham/Documents/motordeport" && python scripts/gov/02_parse.py && python scripts/gov/05_compact_seed.py
```
Com **LEV: remover** (padrão), rode `python scripts/gov/03_clean_lev.py` **entre** os dois (ele falha se sobrar
alguma menção — aí investigue o padrão novo em `scripts/fed/03_clean_lev.py`, que é o motor reaproveitado).
Esperado: `02_parse` lista ~107 convênios / ~48 bancos e ~29 abas-problema (placeholders); `05_compact_seed`
gera `gov_seed.json` (~2,7 MB) com `gerado_em` = hoje.

### 3. Mostrar o que mudou — 🛑 PORTÃO 1 (aprovação do dono)
```bash
cd "C:/Users/clham/Documents/motordeport" && python scripts/gov/04_diff_catalogo.py
```
(`--resumo` mostra só totais + convênios que entram/saem.) Apresente ao dono, curto: totais, convênios
novos/removidos, bancos que **entraram/saíram**, **suspensos/reativados**, mudanças de **taxa de port** e
**margem** (as mais sensíveis), contagem de LEV. Antes de mostrar, confira e corrija no parser:
- linha `! CONVENIOS SEM UF` → adicionar a aba em `OVERRIDES_EXATOS` do `detect_uf` em `02_parse.py`;
- mudanças estranhas de idade/margem → olhar o texto bruto em `scripts/gov/convenios.json`
  (`atributos`): pode ser formato novo de texto (ajuste o parser) ou célula `#VALUE!` na planilha (avise o
  dono; o parser já trata erro de Excel como vazio);
- grafias duplicadas de banco (ex.: `QUERO + CRÉDITO` × `QUERO MAIS CRÉDITO`, `KARDBANK` × `KARD BANK`) são
  como estão na planilha — **não unifique por conta própria**, só liste pro dono.
**Espere o "ok" explícito antes de commitar.**

### 4. Commitar SÓ os arquivos do catálogo
```bash
cd "C:/Users/clham/Documents/motordeport" && git add gov_seed.json scripts/GOVERNOS_RESUMO.xlsx scripts/gov/*.py scripts/gov/RUNBOOK_ATUALIZAR_CATALOGO_GOVERNOS.md && git commit -m "feat(gov): atualiza catalogo de governos (planilha <DATA>) — <resumo em 1 linha>" && git status -sb
```
(`scripts/gov/convenios.json` é gitignored — o diff compara `gov_seed.json`, que é versionado.) **Nunca**
inclua `api/fed.js`, `v2-next/**` nem arquivos de outra frente.

### 5. Push — 🛑 PORTÃO 2 (é do dono)
O Claude Code **bloqueia `git push` para produção e bloqueia você de liberar essa permissão** — não insista.
```bash
cd "C:/Users/clham/Documents/motordeport" && git fetch origin && git status -sb
```
Se `behind`: `git rebase --autostash origin/main` e confira com `git show --stat HEAD` que o commit continua só
com os arquivos do catálogo. Então entregue ao dono este bloco e peça para clicar em **Run**:
```bash
git -C "C:/Users/clham/Documents/motordeport" push origin main
```
Avise que **abre a janela de login do GitHub** (conta `clhamasjr`). Confirme com
`git ls-remote origin refs/heads/main` que o hash é o do seu commit.

### 6. Esperar o Vercel publicar (1–3 min)
```bash
curl -s https://motordeport.vercel.app/gov_seed.json | head -c 200
```
Pronto quando responder **HTTP 200** com o `"gerado_em"` de hoje (antes vem o JSON antigo ou 307).

### 7. Recarregar o catálogo no Supabase (reseed)
Exige sessão **admin/gestor** do FlowForce (ou `x-internal-secret`, que só existe no Vercel — não há `.env`
local). Três formas, na ordem de preferência:

**a) Botão na tela (1 clique, sem agente):** logado no `flowforce.tec.br` como admin →
`/admin/manutencao` → card **"Reseed Catálogo de Governos"** → **Reseed** → confirmar. Mostra
bancos/convênios/relações e a duração.

**b) Pela sessão do dono no Chrome (Claude in Chrome):** dono logado em `https://flowforce.tec.br` no Chrome
dele; abra uma aba nova em `https://flowforce.tec.br/governos/catalogo` e execute via `javascript_tool`:
```js
const r = await fetch('/api/gov-seed',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('ff_token')},body:JSON.stringify({action:'reseed'})});
const d = await r.json();
`HTTP ${r.status} | ok=${d.ok} | stats=${JSON.stringify(d.stats)} | seed=${d.seed_meta?.gerado_em} | erro=${d.error ?? 'nenhum'}`
```
(Retorne **string**, não objeto com chave contendo "token" — a extensão redige isso.)

**c) O próprio dono no console (F12 → Console):**
```js
fetch('/api/gov-seed',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('ff_token')},body:JSON.stringify({action:'reseed'})}).then(r=>r.json()).then(console.log)
```
Esperado: `ok: true`, `stats: {bancos: <só novos>, convenios: <só novos>, convenios_atualizados: ~107,
banco_convenio: ~420 menos as protegidas}`, alguns segundos. `HTTP 500 ... 3xx` = `vercel.json` voltou a
redirecionar `gov_seed.json`; 401/403 = sessão não é admin. Rodar antes do passo 6 falha de forma segura.

### 8. Prova real em produção
Na mesma aba/console:
```js
const H={'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('ff_token')};
const call=b=>fetch('/api/gov',{method:'POST',headers:H,body:JSON.stringify(b)}).then(r=>r.json());
const L=await call({action:'listConvenios'});
const g=await call({action:'getConvenio',slug:'gov-sp-novo-refin'});
`convenios=${L.total ?? L.convenios?.length} | atualizado_em(1o)=${L.convenios?.[0]?.atualizado_em} | GovSP bancos=${g.bancos?.length} | `+(g.bancos||[]).map(b=>b.gov_bancos?.nome+(b.suspenso?'[S]':'')+' port='+b.taxa_minima_port).join(', ')
```
Confira 2–3 mudanças concretas do diff (ex.: taxa port nova do PAN/DAYCOVAL, banco que entrou, suspenso).
Depois navegue para `/governos/catalogo` (cache da tela: 5 min; a navegação recarrega).

### 9. Relatório final ao dono (curto)
Tabela: commit/push ✔, reseed ✔ (números), LEV (mantida/removida), 3 provas em produção, pendências
(célula `#VALUE!`, grafias duplicadas, convênios sem UF que você tratou).

---

## Armadilhas já conhecidas
- `vercel.json` redireciona tudo exceto `/api/` para `flowforce.tec.br`; os `*_seed.json` estão **excluídos**
  do redirect — se alguém reescrever essa regra, o passo 6 dá 307 e o reseed quebra.
- `api/gov-seed.js` e `api/pref-seed.js` lêem o seed de `SEED_BASE_URL` (default `motordeport.vercel.app`),
  **não** do origin/host da request (corrigido em 17/09/2026, mesmo padrão do `fed-seed.js`).
- O parser abre a planilha inteira (13 MB) — não rode duas vezes ao mesmo tempo.
- `git push` e a edição das próprias permissões são bloqueados pelo classificador do Claude Code, mesmo com
  autorização no chat. O push é sempre um clique do dono.
- **Painel built-in** do app e **Chrome do dono** são navegadores separados; a sessão dele está no Chrome.
  Nunca digite senhas dele.
- A tela é PWA com service worker: se o dono já estava com a página aberta, peça F5 (ou Ctrl+Shift+R).

## Arquivos do pipeline
| Arquivo | Papel |
|---|---|
| `scripts/GOVERNOS_RESUMO.xlsx` | planilha-fonte (substituída a cada atualização) |
| `scripts/gov/02_parse.py` | planilha → `scripts/gov/convenios.json` (abas ignoradas em `SKIP_SHEETS`, UF em `detect_uf`) |
| `scripts/gov/03_clean_lev.py` | (opcional) remove menções à LEV reaproveitando o motor do federal |
| `scripts/gov/04_diff_catalogo.py` | diff `gov_seed.json` publicado (git) → novo, para o dono aprovar |
| `scripts/gov/05_compact_seed.py` | gera `gov_seed.json` (raiz) com `gerado_em` = hoje |
| `api/gov-seed.js` | endpoint `reseed` (insere novos, carimba `atualizado_em`, recria relações não editadas) |
| `api/gov.js` | API do catálogo + análise de holerite (lida pelo V2) |
| `v2-next/app/(app)/admin/manutencao/page.tsx` | botão "Reseed Catálogo de Governos" (admin) |
