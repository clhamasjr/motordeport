# Entrega da sessão Crefisa pro FlowForce (passo final do robô)

O robô faz o login no portal Crefisa (captcha + 2FA — isso é do robô).
Depois de logado, o **último passo** dele é empurrar a sessão pro FlowForce.
A partir daí o motor do FlowForce opera sozinho (consulta, simulação, digitação).

## O que capturar, já logado no portal

Rodando no contexto da página do portal (`app1.gerencialcredito.com.br/CREFISA/...`):

```js
const cod = _SEGURANCA.cod;      // ex: 10431
const uId = _SEGURANCA.uId;
const bearer = localStorage.getItem(btoa('accessToken-' + cod + '-' + uId)); // token JWT
const cookie = document.cookie;  // contém o ASPSESSIONID
const versaoSistema = String(_SEGURANCA.versaoSistema || '');

// opcionais (o robô pode buscar, senão o FlowForce usa os defaults)
const vid = await fetch('/CREFISA/ajax_crefisa.asp?combo=GetVendedorId').then(r => r.json());
const us  = await fetch('/CREFISA/ajax_crefisa.asp?combo=GetUsuarios&nomeUsuario=&vendedorId=' + vid.vendedorId).then(r => r.json());
const vendedorId = vid.vendedorId;                       // ex: 439
const codigoUsuarioParceiro = us.usuarios?.[0]?.codigo;  // ex: "1287.36701754821"
```

## Empurrar pro FlowForce (1 chamada HTTP)

```
POST https://motordeport.vercel.app/api/crefisa-br
Content-Type: application/json
x-internal-secret: <WEBHOOK_SECRET da Vercel>

{
  "action": "setPortalSession",
  "bearer": "<token>",
  "cookie": "<document.cookie>",
  "versaoSistema": "<versao>",
  "cod": "10431",
  "vendedorId": 439,
  "codigoUsuarioParceiro": "1287.36701754821"
}
```

- Autentica pelo header `x-internal-secret` (não precisa de login de usuário).
  O valor é o `WEBHOOK_SECRET` que já existe nas env vars da Vercel.
- `bearer` e `cookie` são obrigatórios. O resto o FlowForce preenche com default
  se faltar.

## Resposta — confirma na hora se a sessão funciona

```json
{ "success": true, "viva": true, "salva": true,
  "mensagem": "✅ Sessão Crefisa salva e ativa — motor Baixa Renda operando",
  "quem": "robo" }
```

- `viva: true`  → sessão aceita pelo portal. Motor pronto. Fim do trabalho do robô.
- `viva: false` → sessão salva, mas o portal recusou (token/cookie errados ou IP
  do servidor bloqueado). O robô deve tratar como falha e tentar de novo.

## Ciclo contínuo

1. Robô loga → empurra a sessão (`setPortalSession`).
2. O heartbeat (`/api/crefisa-br-heartbeat`, cron 10min) mantém a sessão viva
   e avisa no WhatsApp quando ela cai.
3. Quando cair, o robô reloga e empurra de novo.

O FlowForce nunca pede captcha nem faz login — ele só usa a sessão que o robô entrega.
