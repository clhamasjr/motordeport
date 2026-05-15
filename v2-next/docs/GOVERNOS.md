# Governos (Federal/Estaduais/Municipais) — Migração V2

> **PRÉ-REQUISITO**: leia `v2-next/docs/MIGRATION_GUIDE.md` primeiro.

## Telas a migrar (todas hoje stub)

1. **`/governos/federal`** — SIAPE (servidor federal civil)
2. **`/governos/estaduais`** — Servidores estaduais (catálogo por UF)
3. **`/governos/municipais`** — Servidores municipais (catálogo por prefeitura)

## Endpoints V1 disponíveis

```bash
ls api/ | grep -iE "gov|federal|estad|munici|siape" | head -10
```

Provavelmente:

| Endpoint | Pra que |
|---|---|
| `/api/gov-federal` (ou similar) | SIAPE — consulta servidor federal |
| `/api/gov-estaduais` | UF + órgão |
| `/api/gov-municipais` | Cidade + órgão |
| `/api/gov-catalogo` (se existir) | Lista de convênios disponíveis |

Pra confirmar:
```bash
ls api/ | grep -iE "^gov\|federal\|estadu\|munici" 
grep -nE "if \(action === " api/gov*.js
```

## Tabelas Supabase relevantes

```sql
select table_name from information_schema.tables
where table_schema='public'
  and (table_name like 'gov_%' or table_name like 'fed_%' or table_name like 'pref_%' or table_name like 'siape_%');
```

## Particularidades

- **Federal (SIAPE)**: 1 só convênio nacional. Usa CPF + matrícula SIAPE.
- **Estaduais**: 1 convênio por UF (cada banco trabalha com um subset). Catálogo em `references/[sigla].md` no V1.
- **Municipais**: 1 convênio por prefeitura. Catálogo em `references/[cidade]_[uf].md` no V1.

Os arquivos `references/` estão na raiz do repo:
```bash
ls scripts/gov/ scripts/pref/ scripts/fed/ 2>/dev/null
```

E os seeds:
```
gov_seed.json   - estaduais
pref_seed.json  - municipais  
fed_seed.json   - federal
```

## Modelo a copiar

| Pra essa tela Governos | Copie de |
|---|---|
| Catálogo de bancos por convênio | `app/(app)/clt/catalogo/page.tsx` |
| Filtro por UF/cidade | adapta `clt/extrair-caged/page.tsx` |
| Consulta + simulação | `app/(app)/clt/consulta/page.tsx` |

## Sequência sugerida

1. **Mapear o catálogo**: que convênios existem em cada nível (federal/estadual/municipal)?
2. **Federal primeiro** (mais simples, 1 convênio só)
3. **Estaduais** depois (UF como filtro)
4. **Municipais** por último (lista grande)

## Status migração ao escrever este doc

- ❌ Nenhuma tela Governos migrada (3 stubs)

## Notas de UX

- Operador escolhe primeiro o **nível** (Fed/Est/Mun)
- Depois o **convênio** específico
- Aí entra com CPF do servidor
- Sistema mostra qual banco atende esse convênio + simulação

## Checklist do commit final

Igual o CLT — ver `MIGRATION_GUIDE.md` seção "Checklist".
