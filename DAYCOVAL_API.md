# Daycoval Consignado API — Referência de integração

Fonte: portal do Daycoval Developer + OpenAPI 3.0 fornecido pelo banco.

## Base URLs
- **Sandbox**: `https://apigwsandbox.daycoval.com.br/varejo/consignado`
- **Produção**: `https://apigw.daycoval.com.br/varejo/consignado` (assumido — confirmar)

## Autenticação
Todas as requisições exigem **2 headers**:
| Header | Valor | Origem |
|---|---|---|
| `apikey` | `2CSRq3x7jDr6lJPZVQoY+83Y` | Env var `DAYCOVAL_API_KEY` (empresa) |
| `Login-Usuario` | username do digitador | **Per-user**, de `users.bank_codes.daycoval` |

Sem OAuth, sem refresh token — API Key é estática.

## Produtos disponíveis (prefixos)
| Prefixo | Produto |
|---|---|
| `/margem` | Empréstimo novo com margem |
| `/refin` | Refinanciamento puro |
| `/port` | **Portabilidade** (nosso foco) |
| `/refinport` | **Refin da portabilidade** (casado com port) |
| `/fgts` | Empréstimo FGTS |
| `/dominio` | Listas estáticas (bancos, UFs, etc.) |

---

## Fluxo Port + Refin (13 passos)

Daycoval **não aceita portabilidade pura** — sempre Port+Refin.

```
┌─ PORT ────────────────────────────────────────────────────────┐
│  1. GET  /port/produtos-disponiveis/{cpf}                     │
│     ↓ (se 404 → passo 2, senão perguntar "mesma matrícula?")  │
│  2. POST /port/produtos-disponiveis                           │
│     Body: {Cpf, DataNascimento, Matricula, CodEmpregador}     │
│  3. GET  /port/empregadores-consignados/{codEmpInt}           │
│     → retorna CodEmpregadorExterno                            │
│  4. GET  /port/orgaos-consignado/{cpf}/{codEmpExt}            │
│     → retorna CodOrgaoExterno                                 │
│  5. GET  /port/prazos-consignado/{codEmpExt}/portabilidade    │
│     → valida QtdParcela desejada                              │
│  6. GET  /port/parametros-averbacao/portabilidade/{codEmp}    │
│     → se 200, precisa CodVerba/CodServico/SenhaAverbacao      │
│     → se 404, pular                                           │
│  7. POST /port/simula-proposta-consignado/portabilidade       │
│     Body completo (ver schema Simulacao.Portabilidade)        │
│  8. POST /port/inclui-simulacoes/portabilidade                │
│     → retorna CodProposta                                     │
│  9. PUT  /port/cliente/pagamento/{codProposta}                │
│     Body: dados cadastrais (nome, docs, endereço, telefones)  │
│ 10. PUT  /port/pagamento/resumo/{codProposta}                 │
│     Body: dados complementares (digitador, conta bancária)    │
│ 11. POST /port/inclui-proposta                                │
│     → cria a proposta na esteira                              │
└───────────────────────────────────────────────────────────────┘
                              ↓
┌─ REFIN DA PORT (obrigatório no Daycoval) ─────────────────────┐
│ 12. POST /refinport/simula-proposta-consignado/               │
│           refin-portabilidade                                 │
│ 13. POST /refinport/inclui-proposta/refin-portabilidade       │
└───────────────────────────────────────────────────────────────┘
                              ↓
┌─ FORMALIZAÇÃO ────────────────────────────────────────────────┐
│ 14. POST /port/formaliza/proposta                             │
│     Body: {CodProposta, Telefone}                             │
│     → envia SMS com link pro cliente assinar                  │
└───────────────────────────────────────────────────────────────┘
```

## Schema crítico — Simulação Portabilidade

```json
POST /port/simula-proposta-consignado/portabilidade
Headers: apikey, Login-Usuario

{
  "Cpf": "12345678900",
  "Matricula": "1234567890",
  "DataNascimento": "1960-05-15T00:00:00",

  "Financiamento": {
    "CodConvenio": "<retornado em /empregadores-consignados>",
    "VlrFinanciado": 10000.00,
    "VlrParcela": 300.00,
    "QtdParcela": 84
  },

  "PortabilidadeSimulacao": {
    "CodBancoOriginal": "237",
    "CodContrato": "<nº CIP do contrato origem>",
    "CodLiberacao": "278",  // ⚠️ 278=INSS | 277=demais empregadores
    "QtdParcelaContrato": 84,
    "SaldoDevedorContrato": 10000.00,
    "VlrParcelaContrato": 300.00,
    "DataBaseContrato": "2026-04-15T00:00:00"
  },

  "Origem": {
    "CodEmpregadorExterno": "<do passo 3>",
    "CodOrgaoExterno": "<do passo 4>"
  }
}
```

## Domínios (GETs estáticos — cachear 24h)
- `/dominio/bancos` — `{CodBanco, DscBanco}[]`
- `/dominio/contas-bancarias` — `{CodTipoContaBancaria, CodBanco, ...}[]`
- `/dominio/documentos-identificacao` — `{CodTipoDocumentoIdentificacao, DscTipoDocumento}[]`
- `/dominio/estados-civis` — `{CodEstadoCivil, DscEstadoCivil}[]`
- `/dominio/nacionalidades` — `{CodNacionalidade, DscNacionalidade}[]`
- `/dominio/naturezas-relacionamentos` — usada no objeto `Digitador`
- `/dominio/sexos` — `{SglSexo, NmeSexo}[]`
- `/dominio/unidades-federativas` — `{Uf, Dsc}[]`

## Códigos mágicos
| Campo | Valor | Uso |
|---|---|---|
| `CodLiberacao` | `278` | INSS na dados bancários + simulação |
| `CodLiberacao` | `277` | Demais empregadores |
| `CodTipoEndereco` | `1/2/3` | Comercial/Residencial/Correspondência |
| `CodTipoLogradouro` | `1/2` | Rua/Avenida |
| `CodTipoTelefone` | `1/2/3/4` | Residencial/Comercial/Celular/Recado |
| `CodRedeSocial` | `1/2/3` | Facebook/Twitter/Instagram |
| `TipoOperacao` (Refin) | `2` | Refin |

## Env vars no Vercel (produção do motordeport)
```
DAYCOVAL_API_KEY=2CSRq3x7jDr6lJPZVQoY+83Y
DAYCOVAL_BASE_URL=https://apigwsandbox.daycoval.com.br/varejo/consignado
```
(Prod: trocar `apigwsandbox` por `apigw` quando for validar com banco.)

## Frontend
`Login-Usuario` é per-user, armazenado em `users.bank_codes.daycoval` (coluna JSONB adicionada no refactor Option A). O frontend passa via `getMyBankCode('daycoval')`.
