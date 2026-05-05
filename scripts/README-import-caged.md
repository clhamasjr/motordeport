# Como rodar o import do CAGED 2024

## Passo 1 — Pegar a SERVICE_ROLE_KEY do Supabase

1. Vai em [supabase.com/dashboard/project/xtyvnocvckbvhwvdwdpo/settings/api](https://supabase.com/dashboard/project/xtyvnocvckbvhwvdwdpo/settings/api)
2. Em "Project API Keys", copia o **`service_role`** (NÃO é o `anon` — precisa da service_role pra ter permissão de UPSERT em massa)
3. **Não compartilha esse key com ninguém** — ele dá acesso total ao banco

## Passo 2 — Configurar variáveis e rodar

Abre o **PowerShell** (Win+X → "Windows PowerShell" ou "Terminal"), e roda:

```powershell
cd C:\Users\clham\Documents\motordeport

# Configura as env vars (cola seu service_role aqui)
$env:SUPABASE_URL = "https://xtyvnocvckbvhwvdwdpo.supabase.co"
$env:SUPABASE_SERVICE_KEY = "cole_aqui_o_service_role_key"

# Roda o arquivo principal (19 GB) — vai demorar 1-3 horas
node scripts\import-caged.js "C:\Users\clham\Downloads\Caged-2024.txt"

# Depois roda o complementar (8 GB)
node scripts\import-caged.js "C:\Users\clham\Downloads\Caged-2024-complementar.txt"
```

## O que vai acontecer

- O script lê linha por linha (não carrega tudo na RAM)
- Decodifica acentos (Latin-1 → UTF-8)
- Pra cada CPF, mantém só o **último estado conhecido** (mais recente entre admissão e demissão)
- A cada 50 mil CPFs novos, faz UPSERT em batch no Supabase
- Mostra progresso a cada 30 segundos

## Saída esperada (exemplo)

```
📂 C:\Users\clham\Downloads\Caged-2024.txt
   17.85 GB
🚀 Iniciando import — destino: clt_base_funcionarios

   📊 1.234.567 linhas lidas | 45.678 no buffer | 8.234 l/s | pulados: 12.345
   💾 flush: +50000 CPFs (3.5s) | total upsert: 50.000
   📊 2.567.890 linhas lidas | 47.234 no buffer | 8.547 l/s | pulados: 24.567
   ...

✅ CONCLUÍDO em 65.4 minutos
   85.234.123 linhas processadas
   2.345.678 linhas puladas (CPF inválido / formato ruim)
   28.567.890 CPFs upsertados (deduplicados pelo último estado)
```

## Posso interromper?

**Sim** — Ctrl+C a qualquer momento. Os CPFs que já foram upsertados ficam salvos. Quando você re-rodar, o sistema continua de onde parou (não duplica nada porque CPF é PK).

## Posso fechar o computador no meio?

Melhor não. Se fechar, perde os ~50k que estavam em buffer ainda não flushados. Mas dá pra re-rodar depois e vai pegar tudo de novo (só não vai dar erro nem duplicar).

**Dica**: deixa o laptop rodando à noite com a tela bloqueada (Ctrl+Alt+Del → "Bloquear"). O Node continua mesmo bloqueado.

## E se der erro de rede?

O script tem retry automático (3 tentativas com delay crescente). Se falhar mesmo, você vê o erro e basta re-rodar.

## Como verificar quanto entrou?

No Supabase Dashboard → SQL Editor:

```sql
select count(*) as total_cpfs from clt_base_funcionarios;
select count(*) filter (where ativo) as ativos,
       count(*) filter (where not ativo) as demitidos,
       count(distinct empregador_cnpj) as empresas_unicas,
       count(distinct uf) as ufs
from clt_base_funcionarios;
```
