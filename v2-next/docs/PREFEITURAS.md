# Prefeituras — Migração V2

> **PRÉ-REQUISITO**: leia `v2-next/docs/MIGRATION_GUIDE.md` primeiro.

## Telas a migrar (1 stub)

1. **`/prefeituras/catalogo`** — Catálogo de prefeituras conveniadas

## Endpoints V1 disponíveis

```bash
ls api/ | grep -iE "pref|munic" | head -10
```

Verificar endpoint atual:
```bash
grep -nE "if \(action === " api/pref*.js
```

## Tabelas Supabase relevantes

```sql
select table_name from information_schema.tables
where table_schema='public' and table_name like 'pref_%';
```

Provavelmente:
- `pref_convenios` (1 linha por prefeitura conveniada — Sorocaba, Campinas, etc)
- `pref_bancos` (bancos que operam aquele convênio)

## Catálogo manual

Os convênios municipais são cadastrados manualmente conforme aparecem
casos. O V1 tem `pref_seed.json` com os iniciais.

## Modelo a copiar

| Pra essa tela | Copie de |
|---|---|
| Catálogo expansível por prefeitura | `app/(app)/clt/catalogo/page.tsx` + `components/clt/banco-card.tsx` |

## Sequência sugerida

1. Listar prefeituras cadastradas
2. Cada card: nome cidade/UF + bancos que operam
3. Expandir = ver regras (idade, margem, valor, prazo, taxa)
4. Filtros: UF + busca por nome de cidade

## Status migração ao escrever este doc

- ❌ Tela Prefeituras stub

## UX simples

- Tela parecida com `/clt/catalogo` mas agrupada por **cidade** em vez de banco
- Cada cidade tem N bancos que operam ali
- Vendedor escolhe cidade → vê opções pra digitar
