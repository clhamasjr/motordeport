# INSS — Migração V2

> **PRÉ-REQUISITO**: leia `v2-next/docs/MIGRATION_GUIDE.md` primeiro.

## Telas a migrar (todas hoje stub)

1. **`/inss/consulta`** — Consulta de benefícios INSS por CPF (Multicorban + bancos)
2. **`/inss/esteira`** — Propostas/portabilidades em andamento
3. **`/inss/propostas`** — Histórico de propostas digitadas

## Endpoints V1 disponíveis

Roda na VPS (V1):
```bash
ls api/ | grep -iE "inss|multicorban|facta|joinbank|qualibanking" | head -10
```

Principais:

| Endpoint | Actions principais |
|---|---|
| `/api/multicorban` | `consult_inss`, `consult_clt`, `parse_html` (lê HTML cards) |
| `/api/facta` | `simular`, `simularRefin`, `etapa1/2/3`, `criarProposta`, `liberar` |
| `/api/joinbank` | `simulateInss`, `iN100`, `criarProposta`, `signTerm` |
| `/api/c6` | `oferta`, `simularRefin`, `incluir`, `formalizacao`, `consultarProposta` |
| `/api/portabilidades` | listar/atualizar (tabela `portabilidades_enriched`) |
| `/api/consig-proposals` | listar propostas QualiBanking sincronizadas |

Pra ver actions de um endpoint:
```bash
grep -nE "if \(action === " api/multicorban.js | head -20
```

## Tabelas Supabase relevantes

Projeto: `xtyvnocvckbvhwvdwdpo`

- `inss_consultas_fila` (se houver — espelha o padrão CLT)
- `portabilidades_enriched` (propostas de portabilidade)
- `consig_proposals` (propostas QualiBanking)
- `inss_clientes` ou `clientes` (cache de dados enriquecidos)

Verifique:
```sql
select table_name from information_schema.tables
where table_schema='public' and table_name like '%inss%' or table_name like '%portab%';
```

## Modelo a copiar (CLT já feito)

| Pra essa tela INSS | Copie de |
|---|---|
| `/inss/consulta` | `app/(app)/clt/consulta/page.tsx` + `components/clt/consulta-card.tsx` (multi-banco em paralelo) |
| `/inss/esteira` | `app/(app)/clt/esteira/page.tsx` (lista + KPIs + filtros) |
| `/inss/propostas` | `app/(app)/clt/esteira/page.tsx` (mesmo padrão tabela) |

## Sequência sugerida

1. **Mapear endpoints**: ver quais actions o V1 expõe pra INSS — começa com
   ```bash
   for f in api/inss-* api/multicorban.js api/facta.js api/joinbank.js api/c6.js; do
     echo "=== $f ==="
     grep -nE "if \(action === " "$f" 2>/dev/null | head -10
   done
   ```
2. **Identificar tabela de fila** (se a operação INSS usa fila tipo `clt_consultas_fila`). Se não houver, ver como V1 cacheia consultas.
3. **Criar `lib/inss-types.ts`** com Beneficio, ConsultaInss, Proposta etc
4. **Criar hooks**:
   - `hooks/use-inss-consulta.ts` (criar consulta + status com polling)
   - `hooks/use-inss-esteira.ts` (lista propostas)
   - `hooks/use-inss-multicorban.ts` (enriquecimento)
5. **Migrar `/inss/consulta`** primeiro (mais usada)
6. **Migrar `/inss/esteira`** depois
7. **Migrar `/inss/propostas`** por último

## Particularidades INSS vs CLT

- **INSS é mais antigo** no V1 → endpoints podem ter sintaxe diferente
- **Beneficiário pode ter MÚLTIPLOS benefícios** (NB) — diferente do CLT (1 CPF = 1 vínculo)
- **Margens separadas**: empréstimo, cartão (RMC), cartão benefício (RCC)
- **Portabilidade + Refinanciamento** são fluxos próprios (port + refin = port-rfn)
- **IN100** é a consulta DataPrev (autorização do beneficiário) — equivalente ao DataPrev/eSocial do CLT
- **Multicorban** é a fonte primária — scraping do portal (login session-based)

## Bancos no INSS

- C6 Bank
- Facta Financeira (port + refin completo)
- JoinBank/QualiBanking (provider 950002 QITech)
- BMG (talvez via Multicorban)
- Mercantil
- Outros conforme env vars

## Status migração ao escrever este doc

- ❌ Nenhuma tela INSS migrada (3 stubs)

## Checklist do commit final

- [ ] `lib/inss-types.ts` criado
- [ ] Pelo menos 1 hook em `hooks/use-inss-*.ts`
- [ ] Página em `app/(app)/inss/CONSULTA-OU-ESTEIRA/page.tsx` substituindo o stub
- [ ] Componentes em `components/inss/` se houver lógica reutilizável
- [ ] Polling inteligente (`refetchInterval` condicional)
- [ ] Loading com `<Skeleton>`
- [ ] Erro com card border-destructive
- [ ] Toast em mutations
- [ ] Commit message descritivo + Co-Authored-By
- [ ] `git push origin main` → Watchtower em ~7 min

## Observações finais

- INSS é a **operação principal** da LhamasCred → cuidado redobrado
- Antes de mudar comportamento, **valide que o endpoint V1 retorna o que você espera** (pode rodar `curl` direto)
- Se faltar alguma action no backend, MELHOR adicionar nova em `api/inss-*.js` do que improvisar no V2
