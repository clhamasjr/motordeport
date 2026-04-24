# Environment Variables — FlowForce (motordeport)

Configure todas no Vercel Dashboard:
**Settings > Environment Variables**

## OBRIGATORIAS

### Supabase
| Variavel | Valor | Onde encontrar |
|----------|-------|----------------|
| `SUPABASE_URL` | `https://SEU-PROJETO.supabase.co` | Supabase > Settings > API > Project URL |
| `SUPABASE_SERVICE_KEY` | `eyJhbGciOiJI...` (longa) | Supabase > Settings > API > service_role (secret) |

### Seguranca
| Variavel | Valor | Descricao |
|----------|-------|-----------|
| `SESSION_SECRET` | (gere uma string aleatoria de 32+ chars) | Usado pra hash de senhas. Ex: `openssl rand -hex 32` |

### Multicorban
| Variavel | Valor antigo (remover do codigo) | Descricao |
|----------|----------------------------------|-----------|
| `MULTICORBAN_USER` | `lhamascred` | Login do Multicorban |
| `MULTICORBAN_PASS` | `*Lhamas24` | Senha do Multicorban |

### FACTA Financeira
| Variavel | Valor antigo | Descricao |
|----------|-------------|-----------|
| `FACTA_BASE_URL` | `https://webservice-homol.facta.com.br` | URL base (homol ou prod) |
| `FACTA_AUTH` | `Basic OTM1OTY6ZDNtNXFxMXM0dmp5cDJ2YjZqdnk=` | Header Authorization Basic |
| `FACTA_LOGIN_CERT` | `93596` | Codigo login certificado |

### JoinBank / QualiConsig
| Variavel | Valor antigo | Descricao |
|----------|-------------|-----------|
| `JOINBANK_URL` | `https://integration.ajin.io` | URL base da API |
| `JOINBANK_KEY` | `a8UhKEOC85SS+dMTWkWwKfl7mAYde9hR2UJ/p52yAYOt0Urx4vpFqmsXWGQNHPyj` | API Key |

### Evolution API (WhatsApp)
| Variavel | Valor antigo | Descricao |
|----------|-------------|-----------|
| `EVOLUTION_URL` | `https://evo.cbdw.com.br` | URL da instancia Evolution |
| `EVOLUTION_KEY` | `CBDW_EVO_KEY_2026` | API Key da Evolution |

### Claude API (Sofia IA)
| Variavel | Valor antigo | Descricao |
|----------|-------------|-----------|
| `CLAUDE_API_KEY` | `sk-ant-api03-OAuHLiik6ntd...` | Chave API Anthropic |

### DataConsulta (Cartao)
| Variavel | Valor antigo | Descricao |
|----------|-------------|-----------|
| `DATACONSULTA_KEY` | `dak_8a4b38fd181b6784a6718bc2bf5fbb62_4d066b97` | API Key DataConsulta |

### C6 Bank Marketplace (Consignado Trabalhador CLT) — novo abr/2026
| Variavel | Valor | Descricao |
|----------|-------|-----------|
| `C6_BASE_URL` | `https://marketplace-proposal-service-api-p.c6bank.info` | URL base produção |
| `C6_USERNAME` | `33117876847_004684` | Username (CPF_certificado + codigo_promotora) |
| `C6_PASSWORD` | *(passar via Vercel, nao commitar)* | Senha do usuario marketplace |
| `C6_PROMOTER_CODE` | `004684` | Código da promotora LhamasCred no C6 |
| `C6_CODIGO_ORIGEM` | `004684` | codigo_origem_6 (código do digitador) |
| `C6_CPF_CERTIFICADO` | `33117876847` | CPF de quem tem o certificado digital da corban |

**Validado em produção em 2026-04-24**: auth HTTP 200, subject `C6BankMarketplaceProd`. Token vive ~20min (cacheado no handler).

### Claude API — Agente Vendedor CLT (novo abr/2026)
Pode reutilizar a `CLAUDE_API_KEY` existente OU criar uma separada:

| Variavel | Valor | Descricao |
|----------|-------|-----------|
| `CLAUDE_API_KEY_AGENTE_CLT` | *(passar via Vercel, nao commitar)* | (Opcional) Chave dedicada ao agente CLT. Se nao setada, `api/agente-clt.js` usa `CLAUDE_API_KEY` |

## OPCIONAIS

| Variavel | Default | Descricao |
|----------|---------|-----------|
| `ALLOWED_ORIGINS` | `*` | Origens permitidas CORS (separadas por virgula). Em prod: `https://motordeport.vercel.app` |
| `APP_URL` | `https://motordeport.vercel.app` | URL publica do app (usada nos webhooks) |
| `WEBHOOK_SECRET` | (vazio) | Secret para validar webhooks do Evolution |

## TOTAL: 14 variaveis

### Passo a passo:
1. Abra https://vercel.com > seu projeto motordeport > Settings > Environment Variables
2. Adicione cada variavel acima
3. Marque **Production**, **Preview** e **Development**
4. Clique em Save
5. Faca um novo deploy (Deployments > Redeploy)

### IMPORTANTE:
- Depois de configurar as env vars e fazer redeploy, as credenciais antigas no codigo nao serao mais usadas
- Recomendo REVOGAR e GERAR NOVAS chaves para: FACTA, JoinBank, Claude API, DataConsulta, Evolution
- O `SESSION_SECRET` deve ser unico e nunca compartilhado
