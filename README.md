# FlowForce v2 — React SPA

## Estrutura
```
flowforce/
├── api/                    ← COPIAR DO REPO ATUAL (motordeport)
│   ├── facta.js            (468 linhas, 16 actions)
│   ├── joinbank.js         (funcional)
│   ├── multicorban.js      (474 linhas, login + consulta)
│   ├── cartao.js           (DataConsulta BMG/Daycoval)
│   ├── agent.js            (Sofia v2.1)
│   └── evolution.js        (proxy WhatsApp)
├── src/
│   ├── main.jsx            (entry point)
│   ├── App.jsx             (router + layout + auth)
│   ├── lib/
│   │   ├── theme.js        (cores, tokens, helpers)
│   │   ├── auth.js         (login, sessão, users)
│   │   └── api.js          (fetch calls centralizadas)
│   └── pages/
│       ├── ConsultaPage.jsx  ✅ FUNCIONAL
│       ├── BasePage.jsx      ⏳ stub (migrar de index.html v1)
│       ├── CRMPage.jsx       ⏳ stub (migrar de index.html v1)
│       └── EsteiraPage.jsx   ⏳ stub (construir Digitação)
├── index.html
├── package.json
├── vite.config.js
├── vercel.json
└── README.md
```

## Deploy

### Opção 1 — Novo repo (recomendado)
```bash
# Criar novo repo: github.com/clhamasjr/flowforce
git init
git add .
git commit -m "FlowForce v2 — React SPA"
git remote add origin https://github.com/clhamasjr/flowforce.git
git push -u origin main

# Vercel: importar novo projeto → selecionar flowforce
# Framework: Vite, Build: npm run build, Output: dist
```

### Opção 2 — Substituir motordeport
```bash
# Apagar tudo EXCETO api/ folder
# Colar os novos arquivos
# Push
```

### Importante
- Copiar a pasta `api/` inteira do repo atual (motordeport) pra cá
- O `vercel.json` redireciona /api/* pro serverless e /* pro SPA
- Credenciais e auth ficam em localStorage (mesma estrutura do v1)
- O v1 (index.html monolito) continua funcionando em paralelo

## Módulos

| Módulo | Status | Descrição |
|--------|--------|-----------|
| 🔍 Consulta | ✅ Funcional | Consulta CPF/Benefício, IN100, Saque, ações |
| 📊 Base | ⏳ Migrar | Upload XLSX, motor portabilidade, dashboard |
| 📋 CRM | ⏳ Migrar | Campanhas, WhatsApp, etiquetas |
| 📝 Esteira | 🆕 Construir | Digitação multi-step, esteira FACTA |
