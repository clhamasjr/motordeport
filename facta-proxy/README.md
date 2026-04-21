# FACTA Proxy

Relay HTTP que roda no **computador do escritório** (com IP autorizado na FACTA) e repassa requisições vindas do Vercel.

## Fluxo

```
Usuario → FlowForce (Vercel)
          ↓ HTTPS
          Vercel api/facta.js
          ↓ POST /relay (X-Proxy-Key)
          Cloudflare Tunnel (HTTPS)
          ↓
          PC do escritorio (ESTE proxy)
          ↓ sai com IP fixo do escritorio
          FACTA webservice ✅
```

## 1 — Pré-requisitos na máquina do escritório

- **Node.js 18+** → https://nodejs.org
- **Cloudflare account** com domínio `cbdw.com.br` (já tem)
- PC ligado 24/7

## 2 — Instalar o proxy

```powershell
# Abra PowerShell como usuário normal
cd C:\
git clone https://github.com/clhamasjr/motordeport.git motordeport
cd motordeport\facta-proxy
npm install
copy .env.example .env
notepad .env
```

No `.env` edite:

```
FACTA_PROXY_SECRET=<gere uma chave longa — ver passo 3>
FACTA_BASE_URL=https://webservice.facta.com.br
```

## 3 — Gerar a chave secreta

No PowerShell rode:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copie o resultado e cole em `FACTA_PROXY_SECRET` no `.env`. **Guarde** essa chave — você vai usar ela também no Vercel.

## 4 — Testar localmente

```powershell
node server.js
```

Deve aparecer:
```
✅ FACTA Proxy rodando em http://localhost:3456
```

Em outro terminal, teste:
```powershell
curl http://localhost:3456/health
curl http://localhost:3456/ip
```

O `/ip` mostra o IP público de saída — confira se é o mesmo que está cadastrado na FACTA.

## 5 — Cloudflare Tunnel (exposição HTTPS segura)

### 5.1 Instalar cloudflared

Baixe o `.msi` em: https://github.com/cloudflare/cloudflared/releases  
Procure por `cloudflared-windows-amd64.msi` — instale normalmente.

### 5.2 Autenticar

```powershell
cloudflared tunnel login
```
Abre o navegador — faça login na Cloudflare e autorize o domínio `cbdw.com.br`.

### 5.3 Criar o túnel

```powershell
cloudflared tunnel create facta-proxy
```
Salva credenciais em `C:\Users\<seu-usuario>\.cloudflared\<uuid>.json`

### 5.4 Configurar o túnel

Crie `C:\Users\<seu-usuario>\.cloudflared\config.yml`:

```yaml
tunnel: facta-proxy
credentials-file: C:\Users\<seu-usuario>\.cloudflared\<uuid>.json

ingress:
  - hostname: facta-proxy.cbdw.com.br
    service: http://localhost:3456
  - service: http_status:404
```

### 5.5 Criar registro DNS

```powershell
cloudflared tunnel route dns facta-proxy facta-proxy.cbdw.com.br
```

### 5.6 Rodar o túnel

```powershell
cloudflared tunnel run facta-proxy
```

Testa de fora:
```powershell
curl https://facta-proxy.cbdw.com.br/health
```

## 6 — Rodar como serviço (24/7 sem abrir terminal)

### Proxy Node.js como serviço (NSSM)

Baixe NSSM: https://nssm.cc/download

```powershell
# Extraia, abra PowerShell como Administrador, entre na pasta nssm\win64
.\nssm.exe install FactaProxy

# Na janela que abre:
# Path:       C:\Program Files\nodejs\node.exe
# Startup:    C:\motordeport\facta-proxy
# Arguments:  server.js
# Aba "Environment": cole seu FACTA_PROXY_SECRET, FACTA_BASE_URL, PORT
# Clique Install Service

net start FactaProxy
```

### Túnel Cloudflared como serviço

Já incluído no instalador. Como Administrador:

```powershell
cloudflared service install
net start cloudflared
```

Pronto: tanto o proxy quanto o túnel sobem automaticamente no boot do Windows.

## 7 — Configurar o Vercel

No dashboard Vercel (**Project Settings → Environment Variables**) adicione:

| Nome | Valor |
|------|-------|
| `FACTA_PROXY_URL` | `https://facta-proxy.cbdw.com.br` |
| `FACTA_PROXY_SECRET` | `<mesma chave do .env>` |

Clique **Save** e **Redeploy**.

O código do Vercel (`api/facta.js`) detecta automaticamente se `FACTA_PROXY_URL` está setado e passa a rotear por ele.

## 8 — Testes finais

Abra o FlowForce, faça login, e na tela **Consulta Unitária** chame um CPF. Ver logs do proxy (`cloudflared` + `server.js`) — deve aparecer as requisições chegando.

## Manutenção

- **Atualizar o proxy**: `cd C:\motordeport && git pull && cd facta-proxy && npm install && net stop FactaProxy && net start FactaProxy`
- **Ver logs do proxy**: `C:\motordeport\facta-proxy` — ou use NSSM AppStdout/AppStderr pra arquivo
- **Ver logs do túnel**: `cloudflared tunnel info facta-proxy`

## Troubleshooting

- **curl /ip retorna IP errado** → o PC está saindo pela internet errada (verificar roteador/firewall). O IP cadastrado na FACTA tem que ser o do escritório.
- **Vercel retorna 401** → secret no `.env` diferente do configurado no Vercel.
- **Vercel retorna 502** → proxy não alcançável. Ver se `cloudflared` está rodando.
- **FACTA retorna 401/403** → o proxy está rodando mas o IP público do escritório mudou ou não é o cadastrado. Rode `curl https://facta-proxy.cbdw.com.br/ip` de qualquer lugar e confirme com a FACTA.
