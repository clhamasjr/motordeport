# RUNBOOK — Atualizar o Catálogo FEDERAL do FlowForce a partir da planilha

> **Como usar (dono):** cole este arquivo inteiro como prompt no agente (Claude Code aberto na pasta
> `C:\Users\clham\Documents\motordeport`), troque só a linha **PLANILHA** abaixo pelo caminho da planilha
> nova e mande. O agente deve seguir os passos na ordem, **parar nos dois portões** (aprovar diff / push)
> e te devolver o relatório final. Validado de ponta a ponta em 17/09/2026.

```
PLANILHA: C:\Users\clham\Downloads\<nome do arquivo>.xlsx
```

---

## Você (agente) vai fazer

Atualizar o catálogo de convênios FEDERAIS (SIAPE novo/refin/portabilidade/RMC/RCC, SERPRO, Forças Armadas)
do FlowForce a partir da planilha acima, **removendo toda referência à LEV**, e publicar em produção.
Responda em português, direto. O dono não é programador: entregue pronto, mostre resultados, não explique código.

### Contexto que você precisa saber (não redescubra)
- Repo: `C:\Users\clham\Documents\motordeport`, branch `main`. Outra sessão pode publicar em `main` em paralelo.
- Catálogo = tabelas `fed_convenios` / `fed_bancos` / `fed_banco_convenio` no **Supabase**, lidas pela API
  `api/fed.js` que roda no **Vercel** (`motordeport.vercel.app`). O frontend V2 (`flowforce.tec.br`, Docker na
  VPS) só exibe — **não precisa de deploy na VPS** para esta mudança (o workflow da VPS nem dispara: só roda
  quando `v2-next/**` muda).
- Fonte da verdade: `scripts/FEDERAIS_RESUMO.xlsx` → pipeline Python em `scripts/fed/` → `fed_seed.json`
  (raiz, servido estático pelo Vercel) → endpoint `POST /api/fed-seed {"action":"reseed"}` grava no Supabase.
- **LEV = Lev Negócios, a averbadora** (não é banco). Aparece embutida em regras ("Reserva: LEV ou BANCO",
  "* Verificar também Regra LEV *", e-mails `@levnegocios.com.br`). A LhamasCred não opera mais via LEV: o
  passo `03_clean_lev.py` remove a menção **preservando a regra do banco ao redor**. Não reinvente essa limpeza.
- Pode haver alterações **não commitadas de outra frente** em `api/fed.js`, `v2-next/lib/fed-types.ts`,
  `v2-next/components/fed/enquadramento-card.tsx`. **Não toque, não commite, não descarte.**
- Requisitos locais: Python 3 + `openpyxl` (já instalados), Git.

---

## Passo a passo

### 0. Pré-checagem (1 min)
```bash
cd "C:/Users/clham/Documents/motordeport" && git fetch origin && git status -sb && python -c "import openpyxl;print('openpyxl ok')"
```
- Se houver arquivos modificados que não são do catálogo, anote e siga sem mexer neles.
- Confirme que a PLANILHA existe e tem as abas esperadas: `SIAPE NOVO-REFIN`, `SIAPE PORTABILIDADE`,
  `CARTÃO SIAPE`, `CARTÃO BENEFICIO`, `SERPRO`, `AERONÁUTICA`, `EXÉRCITO`, `MARINHA` (as abas de UPAGs e
  auxiliares são ignoradas pelo parser). Se apareceu uma aba/convênio novo, ele precisa ser adicionado em
  `SHEET_MAP` no `scripts/fed/02_parse.py` — pergunte ao dono antes.

### 1. Trocar a planilha (com backup)
```bash
cd "C:/Users/clham/Documents/motordeport" && mkdir -p scripts/_backup && cp scripts/FEDERAIS_RESUMO.xlsx "scripts/_backup/FEDERAIS_RESUMO_$(date +%Y-%m-%d).xlsx" && cp "<PLANILHA>" scripts/FEDERAIS_RESUMO.xlsx
```
(`scripts/_backup/` está no .gitignore; a versão anterior também fica no histórico do git.)

### 2. Rodar o pipeline (nesta ordem)
```bash
cd "C:/Users/clham/Documents/motordeport" && python scripts/fed/02_parse.py && python scripts/fed/03_clean_lev.py && python scripts/fed/05_compact_seed.py
```
Esperado: `02_parse` termina com **"Abas problemas: 0"** e lista 8 convênios; `03_clean_lev` termina com
**`Ocorrencias de "lev" restantes: 0`** (se não for 0 ele sai com erro — investigue o padrão novo e ajuste o
script); `05_compact_seed` gera `fed_seed.json` com `gerado_em` = hoje.

### 3. Mostrar o que mudou — 🛑 PORTÃO 1 (aprovação do dono)
```bash
cd "C:/Users/clham/Documents/motordeport" && python scripts/fed/04_diff_catalogo.py
```
Apresente ao dono, em tabela curta por convênio: bancos que **entraram/saíram**, **suspensos/reativados**,
mudanças de **taxa de port** e **margem**, e a confirmação **"LEV: 0"**. Destaque mudanças de margem (são as
mais sensíveis para a operação). **Espere o "ok" explícito antes de commitar.** Se o dono quiser ajustar algo,
ajuste na planilha e repita 1→3.

### 4. Commitar SÓ os arquivos do catálogo
```bash
cd "C:/Users/clham/Documents/motordeport" && git add fed_seed.json scripts/FEDERAIS_RESUMO.xlsx scripts/fed/convenios.json && git commit -m "feat(fed): atualiza catalogo federal (planilha <DATA>) — <resumo em 1 linha das mudancas>" && git status -sb
```
Se você alterou algum script em `scripts/fed/`, inclua-o no `git add`. **Nunca** inclua `api/fed.js`,
`v2-next/**` nem outros arquivos que não são seus.

### 5. Push — 🛑 PORTÃO 2 (é do dono)
O Claude Code **bloqueia `git push` para produção e bloqueia você de liberar essa permissão** — não insista,
não tente contornar. Antes de pedir o push, garanta que o commit está em cima do remoto:
```bash
cd "C:/Users/clham/Documents/motordeport" && git fetch origin && git status -sb
```
Se aparecer `behind`, rode `git rebase --autostash origin/main` (preserva o trabalho não commitado da outra
frente) e confira com `git show --stat HEAD` que o commit continua só com os arquivos do catálogo.
Então entregue ao dono este bloco e peça para clicar em **Run** (ou colar no painel Terminal do app):
```bash
git -C "C:/Users/clham/Documents/motordeport" push origin main
```
Avise: **vai abrir uma janela de login do GitHub** (não há credencial salva no PC) — ele entra com a conta
`clhamasjr`. Confirme que chegou: `git ls-remote origin refs/heads/main` deve mostrar o hash do seu commit.

### 6. Esperar o Vercel publicar (1–3 min)
```bash
curl -s https://motordeport.vercel.app/fed_seed.json | head -c 200
```
Pronto quando responder **HTTP 200** com o `"gerado_em"` de hoje (antes disso vem 307/HTML antigo).
Você pode vigiar em background: repetir a cada 15 s por até 10 min.

### 7. Recarregar o catálogo no Supabase (reseed)
O endpoint exige sessão de **admin/gestor** do FlowForce (ou `x-internal-secret`, que só existe no Vercel — não
há `.env` local). Duas formas, na ordem de preferência:

**a) Pela sessão do dono no Chrome (Claude in Chrome):** peça ao dono para estar logado em
`https://flowforce.tec.br` no Chrome dele; abra uma aba nova em `https://flowforce.tec.br/federal/catalogo`
(mesmo perfil = mesmo `localStorage.ff_token`) e execute via `javascript_tool`:
```js
const r = await fetch('/api/fed-seed',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('ff_token')},body:JSON.stringify({action:'reseed'})});
const d = await r.json();
`HTTP ${r.status} | ok=${d.ok} | stats=${JSON.stringify(d.stats)} | seed=${d.seed_meta?.gerado_em} | erro=${d.error ?? 'nenhum'}`
```
(Retorne **string**, não objeto com chave contendo "token" — a extensão redige isso.)

**b) O próprio dono, sem agente:** logado no `flowforce.tec.br`, aperta **F12 → aba Console**, cola e Enter:
```js
fetch('/api/fed-seed',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('ff_token')},body:JSON.stringify({action:'reseed'})}).then(r=>r.json()).then(console.log)
```
Esperado: `ok: true`, `stats: {bancos, convenios, banco_convenio}` batendo com o `04_diff`, ~3 s.
Se der `HTTP 500 ... 3xx` o `vercel.json` voltou a redirecionar `fed_seed.json`; se der 401/403 a sessão não é
admin. Rodar cedo demais (antes do passo 6) falha de forma segura — não apaga nada.

### 8. Prova real em produção
Na mesma aba/console, confira contagens e 2–3 mudanças concretas do diff, e que não há LEV:
```js
const H={'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('ff_token')};
const call=b=>fetch('/api/fed',{method:'POST',headers:H,body:JSON.stringify(b)}).then(r=>r.json());
const L=await call({action:'listConvenios'});
const D=await Promise.all(L.convenios.map(c=>call({action:'getConvenio',slug:c.slug})));
const js=JSON.stringify(D); const lev=(js.match(/\blev\b/gi)||[]).length+(js.match(/levnegocios/gi)||[]).length;
`convenios=${L.total} | relacoes=${D.reduce((s,d)=>s+d.bancos.length,0)} | LEV=${lev} | atualizado_em=${L.convenios[0].atualizado_em} | `+D.map(d=>d.convenio.slug+'='+d.bancos.length).join(', ')
```
Depois navegue a aba para `/federal/catalogo` (dados novos; o cache da tela dura 5 min — a navegação recarrega).

### 9. Relatório final ao dono (curto)
Tabela: commit/push ✔, reseed ✔ (números), LEV = 0, 3 provas em produção, e pendências. Sugira, se ainda não
existir: botão "Recarregar catálogo" (só admin) na tela Federal, para o passo 7 virar 1 clique.

---

## Armadilhas já conhecidas (não caia de novo)
- `vercel.json` redireciona tudo exceto `/api/` para `flowforce.tec.br`; os `*_seed.json` estão **excluídos** do
  redirect desde 17/09 — se alguém reescrever essa regra, o passo 6 volta a dar 307 e o reseed quebra.
- `api/fed-seed.js` lê o seed de `SEED_BASE_URL` (default `motordeport.vercel.app`), **não** do `origin/host`
  da request. `api/gov-seed.js` e `api/pref-seed.js` seguem o mesmo padrão desde 17/09/2026 (o runbook de
  Governos está em `scripts/gov/RUNBOOK_ATUALIZAR_CATALOGO_GOVERNOS.md`).
- O script `05_compact_seed.py` usa a data de hoje em `gerado_em` — é isso que vira "atualizado em" no catálogo.
- `git push` e a edição das próprias permissões são bloqueados pelo classificador do Claude Code, mesmo com
  autorização no chat. O push é sempre um clique do dono.
- Diferencie os navegadores: o **painel built-in** do app e o **Chrome do dono** são navegadores separados;
  a sessão dele normalmente está no Chrome. Não digite senhas dele em lugar nenhum.
- A tela é PWA com service worker: se o dono já estava com a página aberta, peça um F5 (ou Ctrl+Shift+R).

## Arquivos do pipeline
| Arquivo | Papel |
|---|---|
| `scripts/FEDERAIS_RESUMO.xlsx` | planilha-fonte (substituída a cada atualização) |
| `scripts/fed/02_parse.py` | planilha → `scripts/fed/convenios.json` (mapa de abas em `SHEET_MAP`) |
| `scripts/fed/03_clean_lev.py` | remove menções à LEV preservando regras; falha se sobrar alguma |
| `scripts/fed/04_diff_catalogo.py` | diff anterior (git) → novo, para o dono aprovar |
| `scripts/fed/05_compact_seed.py` | gera `fed_seed.json` (raiz) com `gerado_em` = hoje |
| `api/fed-seed.js` | endpoint `reseed` (UPSERT bancos/convênios + DELETE/INSERT relações) |
| `api/fed.js` | API do catálogo e da análise de contracheque (lida pelo V2) |
