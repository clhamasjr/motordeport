# RUNBOOK — Atualizar o Catálogo de PREFEITURAS (municipais) do FlowForce a partir da planilha

> **Como usar (dono):** cole este arquivo inteiro como prompt no agente (Claude Code aberto na pasta
> `C:\Users\clham\Documents\motordeport`), troque só a linha **PLANILHA** abaixo pelo caminho da planilha
> nova e mande. O agente segue os passos na ordem, **para nos dois portões** (aprovar diff / push) e devolve
> o relatório final. Validado de ponta a ponta em 17/09/2026 (planilha de set/2026: 453 convênios, 46 bancos,
> 1.069 relações, 668 abas).

```
PLANILHA: C:\Users\clham\Downloads\<PREFEITURAS - RESUMO OPERACIONAL CONVENIOS_...>.xlsx
LEV: remover   (decisao do dono em 17/09/2026, igual a federal e governos; "manter" so se ele pedir)
```

---

## Você (agente) vai fazer

Atualizar o catálogo de convênios de **PREFEITURAS** (prefeituras municipais, institutos de previdência
municipais, cartão benefício municipal) do FlowForce a partir da planilha acima e publicar em produção.
Responda em português, direto. O dono não é programador: entregue pronto, mostre resultados.

### Contexto que você precisa saber (não redescubra)
- Repo: `C:\Users\clham\Documents\motordeport`, branch `main`. Outra sessão pode publicar em `main` em paralelo.
- Catálogo = tabelas `pref_convenios` / `pref_bancos` / `pref_banco_convenio` no **Supabase**, lidas pela API
  `api/pref.js` no **Vercel** (`motordeport.vercel.app`). O V2 (`flowforce.tec.br`, Docker na VPS) só exibe
  (`/prefeituras`) — **não precisa de deploy na VPS** (o workflow da VPS só roda quando `v2-next/**` muda).
- Fonte da verdade: `scripts/PREFEITURAS_RESUMO.xlsx` → pipeline Python em `scripts/pref/` → `pref_seed.json`
  (raiz, ~6,3 MB, servido estático pelo Vercel) → endpoint `POST /api/pref-seed` grava no Supabase.
- **O reseed de prefeituras tem dois modos** (mesmo desenho do de governos, `api/gov-seed.js`). Em ambos: só
  INSERE bancos/convênios novos (nome/UF/município/**tipo** dos existentes podem ter sido corrigidos na tela
  ou classificados no Postgres e não são sobrescritos) e carimba `atualizado_em` nos que já existiam.
  - `{"action":"reseed"}` = **conservador**: apaga e recria só as relações banco×convênio com
    `editado_manual` false/null e pula as `true` (cadastros manuais feitos na tela pelo admin, feat de 06/05/2026).
  - `{"action":"reseed","modo":"planilha"}` = **planilha manda** (é o que o dono quer nas atualizações):
    para os convênios presentes no seed, apaga tudo **exceto** relações editadas de verdade na tela depois de
    `preservar_desde` (default `2026-05-06`; critério `editado_manual=true` E `updated_at >` essa data) e recria
    a partir do seed com `editado_manual=false`. Com `"excluir_fora_da_planilha":true` também **exclui os
    convênios que não estão na planilha** (decisão do dono em 17/09/2026: a planilha é a lista completa; abas
    renomeadas na planilha aparecem como "saiu + entrou" — o convênio antigo é excluído e o novo criado).
    Rode antes `{"action":"diagnostico"}`: mostra relações preservadas e `convenios_fora_da_planilha`.
  - **Até 17/09/2026 o endpoint fazia UPSERT de tudo e apagava TODAS as relações** — apagava cadastros manuais
    e trocava o `tipo` classificado por 'pendente'. Foi reescrito nesse dia; não volte ao comportamento antigo.
- A planilha tem ~670 abas, 1 por município/instituto/cartão benefício, **agrupadas por UF**: abas pequenas
  ("AC", "AL", "BAHIA", "CIDADES_SP"…) são **separadores** e definem a UF das abas seguintes
  (`UF_SEPARATORS` no `02_parse.py`). Se uma aba vier ANTES do separador da sua UF, o parser usa o sufixo
  "- XX" do nome do convênio (lista `uf_pelo_nome` no log do parse). ~80 abas são placeholders vazios
  ("so 0/1 linhas com dados", "sem colunas") ou índices (`SKIP_SHEETS`) — isso é normal. Só investigue uma
  aba-problema se ela **era convênio no seed anterior** (aparece em "CONVENIOS QUE SAIRAM" do diff).
- `tipo` do convênio (`prefeitura` | `instituto_previdencia` | `cartao_beneficio`): o parser manda
  `pendente`; o endpoint classifica só os **novos** pelo nome da aba/convênio (`classificarTipo` em
  `api/pref-seed.js`); os existentes mantêm o que está no banco.
- **LEV = Lev Negócios, a averbadora** (não é banco). Em prefeituras aparecia ~2.000x ("Reserva de margem: LEV",
  "* Verificar também Regra LEV *", e-mails `@levnegocios.com.br`). Decisão do dono (17/09/2026): **remover
  também em prefeituras** — o passo `03_clean_lev.py` roda sempre (2.056 campos limpos, 0 restantes).
  Só mantenha a LEV se a linha **LEV:** do cabeçalho disser "manter".
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
cd "C:/Users/clham/Documents/motordeport" && mkdir -p scripts/_backup && cp scripts/PREFEITURAS_RESUMO.xlsx "scripts/_backup/PREFEITURAS_RESUMO_$(date +%Y-%m-%d).xlsx" && cp "<PLANILHA>" scripts/PREFEITURAS_RESUMO.xlsx
```
(`scripts/_backup/` está no .gitignore; a versão anterior também fica no histórico do git.)

### 2. Rodar o pipeline (nesta ordem — a planilha tem ~58 MB, o parse leva 5–10 min; rode em background)
```bash
cd "C:/Users/clham/Documents/motordeport" && python scripts/pref/02_parse.py && python scripts/pref/03_clean_lev.py && python scripts/pref/05_compact_seed.py
```
Com **LEV: manter**, pule o `03_clean_lev.py`. O `03_clean_lev.py` falha se sobrar alguma menção — aí
investigue o padrão novo em `scripts/fed/03_clean_lev.py` (motor reaproveitado).
Esperado: `02_parse` lista ~450 convênios / ~46 bancos e ~80 abas-problema; `05_compact_seed` gera
`pref_seed.json` (~6,3 MB) com `gerado_em` = hoje. Não rode o parse duas vezes ao mesmo tempo.

### 3. Mostrar o que mudou — 🛑 PORTÃO 1 (aprovação do dono)
```bash
cd "C:/Users/clham/Documents/motordeport" && python scripts/pref/04_diff_catalogo.py --resumo
```
(sem `--resumo` detalha convênio a convênio; `--uf SP` detalha só uma UF.) Apresente ao dono, curto: totais,
convênios novos/removidos (separe **aba renomeada** de **convênio que sumiu de verdade**), bancos que
**entraram/saíram** do catálogo, **suspensos/reativados**, mudanças de **taxa de port** e **margem** (as mais
sensíveis), contagem de LEV. Antes de mostrar, confira:
- linha `! CONVENIOS SEM UF` → adicionar a aba-separador em `UF_SEPARATORS` do `02_parse.py`;
- convênio que "saiu": abra a aba na planilha (openpyxl `read_only=True`, 6 primeiras linhas). Se a aba está
  vazia/sem bancos, é a planilha (avise o dono); se tem bancos, é o parser (ex.: `is_valid_banco_name`);
- mudanças estranhas de margem/taxa → olhar o texto bruto em `scripts/pref/convenios.json`
  (`atributos.margem_utilizavel`, `atributos.port_taxa_minima`): pode ser texto novo ("Adiantamento
  Salarial: 90%") ou célula `#VALUE!` (o parser trata erro de Excel como vazio);
- grafias duplicadas de banco (`KARDBANK` × `KARD BANK` × `KARD SUPER CRÉDITO`, `CAPITAL CONSIG` ×
  `CAITAL CONSIG`, `MEU CASHCARD` × `MEUCASHCARD` × `MEU CASCARD`) são como estão na planilha — **não
  unifique por conta própria**, só liste pro dono.
**Espere o "ok" explícito antes de commitar.**

### 4. Commitar SÓ os arquivos do catálogo
```bash
cd "C:/Users/clham/Documents/motordeport" && git add pref_seed.json scripts/PREFEITURAS_RESUMO.xlsx scripts/pref/*.py scripts/pref/RUNBOOK_ATUALIZAR_CATALOGO_PREFEITURAS.md api/pref-seed.js && git commit -m "feat(pref): atualiza catalogo de prefeituras (planilha <DATA>) — <resumo em 1 linha>" && git status -sb
```
(`scripts/pref/convenios.json` é gitignored — o diff compara `pref_seed.json`, que é versionado. Só inclua
`api/pref-seed.js` se você mexeu nele.) **Nunca** inclua `api/fed.js`, `v2-next/**` nem arquivos de outra frente.

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
curl -s https://motordeport.vercel.app/pref_seed.json | head -c 200
```
Pronto quando responder **HTTP 200** com o `"gerado_em"` de hoje (antes vem o JSON antigo ou 307).

### 7. Recarregar o catálogo no Supabase (reseed)
Exige sessão **admin/gestor** do FlowForce (ou `x-internal-secret`, que só existe no Vercel — não há `.env`
local). **Não existe botão de reseed de prefeituras na tela** (só o de governos em `/admin/manutencao`).
Duas formas:

**a) Pela sessão do dono no Chrome (Claude in Chrome):** dono logado em `https://flowforce.tec.br` no Chrome
dele; abra uma aba nova em `https://flowforce.tec.br/prefeituras` e execute via `javascript_tool`.
Primeiro o diagnóstico (mostre ao dono o que será preservado e o que será excluído):
```js
const d=await fetch('/api/pref-seed',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('ff_token')},body:JSON.stringify({action:'diagnostico'})}).then(r=>r.json());
`relacoes=${JSON.stringify(d.relacoes)} | seed=${d.seed_gerado_em} | preservadas no modo planilha: `+d.editadas_na_tela.map(e=>e.convenio+'/'+e.banco+' ('+e.editado_em.slice(0,10)+')').join(', ')+` | fora da planilha (serao excluidos): `+d.convenios_fora_da_planilha.map(c=>c.slug+' ('+c.relacoes+' rel)').join(', ')
```
Depois o reseed:
```js
const r = await fetch('/api/pref-seed',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('ff_token')},body:JSON.stringify({action:'reseed',modo:'planilha',excluir_fora_da_planilha:true})});
const d = await r.json();
`HTTP ${r.status} | ok=${d.ok} | stats=${JSON.stringify(d.stats)} | seed=${d.seed_meta?.gerado_em} | erro=${d.error ?? 'nenhum'}`
```
(Retorne **string**, não objeto com chave contendo "token" — a extensão redige isso.)

**b) O próprio dono no console (F12 → Console) em `flowforce.tec.br`:**
```js
fetch('/api/pref-seed',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('ff_token')},body:JSON.stringify({action:'reseed',modo:'planilha',excluir_fora_da_planilha:true})}).then(r=>r.json()).then(console.log)
```
Esperado (modo planilha): `ok: true`, `stats: {modo:'planilha', bancos: <só novos>, convenios: <só novos>,
convenios_atualizados: ~420, convenios_excluidos: <os do diagnóstico>, relacoes_apagadas: ~970,
relacoes_preservadas: <as do diagnóstico>, banco_convenio: ~1069 menos as preservadas}`, 10–30 s (o seed tem
6 MB e são ~1.000 relações em lotes de 50). `HTTP 500 ... 3xx` = `vercel.json` voltou a redirecionar
`pref_seed.json`; 401/403 = sessão não é admin. Rodar antes do passo 6 falha de forma segura.

### 8. Prova real em produção
Na mesma aba/console:
```js
const H={'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('ff_token')};
const call=b=>fetch('/api/pref',{method:'POST',headers:H,body:JSON.stringify(b)}).then(r=>r.json());
const L=await call({action:'listConvenios',uf:'SP'});
const g=await call({action:'getConvenio',slug:'prefeitura-de-sao-paulo'});
`SP convenios=${L.total ?? L.convenios?.length} | atualizado_em(1o)=${L.convenios?.[0]?.atualizado_em} | PrefSP bancos=${g.bancos?.length} | `+(g.bancos||[]).map(b=>(b.pref_bancos?.nome||b.banco?.nome)+(b.suspenso?'[S]':'')+' port='+b.taxa_minima_port).join(', ')
```
Confira 2–3 mudanças concretas do diff (ex.: taxa port nova do DAYCOVAL em Salvador, banco que entrou, suspenso).
Depois navegue para `/prefeituras` (cache da tela: 5 min; a navegação recarrega).

### 9. Relatório final ao dono (curto)
Tabela: commit/push ✔, reseed ✔ (números), LEV (mantida/removida), 3 provas em produção, pendências
(abas vazias que eram convênio, grafias duplicadas, UF corrigida pelo nome, abas renomeadas).

---

## Armadilhas já conhecidas
- `vercel.json` redireciona tudo exceto `/api/` para `flowforce.tec.br`; os `*_seed.json` estão **excluídos**
  do redirect — se alguém reescrever essa regra, o passo 6 dá 307 e o reseed quebra.
- `api/pref-seed.js` lê o seed de `SEED_BASE_URL` (default `motordeport.vercel.app`), **não** do origin/host
  da request (corrigido em 17/09/2026, mesmo padrão do `fed-seed.js`).
- O parser abre a planilha inteira (58 MB, `read_only=False` porque abas como PREFEITURA DE SÃO PAULO têm
  colunas vazadas) — leva 5–10 min e usa bastante memória; não rode duas vezes ao mesmo tempo.
- Abas com o **mesmo nome de convênio em UFs diferentes** (ex.: "SÃO MIGUEL DOS CAMPOS" em AL) podem estar
  fora da ordem da planilha — o parser corrige pela UF do nome; confira `uf_pelo_nome` no log.
- Uma aba pode ter **nome de convênio copiado errado** (em set/2026 a aba "PREF SÃO BERNARDO" [MA] veio com o
  nome "POLÍTICA DE CARTÃO BENEFÍCIO PREF SÃO LUIS - MA") — é a planilha; só avise o dono.
- `git push` e a edição das próprias permissões são bloqueados pelo classificador do Claude Code, mesmo com
  autorização no chat. O push é sempre um clique do dono.
- **Painel built-in** do app e **Chrome do dono** são navegadores separados; a sessão dele está no Chrome.
  Nunca digite senhas dele.
- A tela é PWA com service worker: se o dono já estava com a página aberta, peça F5 (ou Ctrl+Shift+R).

## Arquivos do pipeline
| Arquivo | Papel |
|---|---|
| `scripts/PREFEITURAS_RESUMO.xlsx` | planilha-fonte (substituída a cada atualização) |
| `scripts/pref/02_parse.py` | planilha → `scripts/pref/convenios.json` (índices em `SKIP_SHEETS`, UF em `UF_SEPARATORS` + sufixo do nome) |
| `scripts/pref/03_clean_lev.py` | remove menções à LEV reaproveitando o motor do federal |
| `scripts/pref/04_diff_catalogo.py` | diff `pref_seed.json` publicado (git) → novo, para o dono aprovar |
| `scripts/pref/05_compact_seed.py` | gera `pref_seed.json` (raiz) com `gerado_em` = hoje |
| `api/pref-seed.js` | endpoint `diagnostico` / `reseed` (conservador ou planilha) |
| `api/pref.js` | API do catálogo + análise de holerite + cadastro manual de bancos (lida pelo V2) |
| `v2-next/app/(app)/prefeituras` | tela do catálogo (só leitura; sem botão de reseed) |
