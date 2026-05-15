# Admin (Usuários + Parceiros) — Migração V2

> **PRÉ-REQUISITO**: leia `v2-next/docs/MIGRATION_GUIDE.md` primeiro.

## Telas a migrar (2 stubs)

1. **`/admin/usuarios`** — CRUD de usuários (admin/gestor/operador)
2. **`/admin/parceiros`** — CRUD de parceiros hospedados (LhamasCred, MataoCred, CLA, etc)

## Permissões

- **Apenas `role === 'admin'`** acessa essas telas
- Sidebar já filtra (`needsRole: ['admin']` nos itens)
- Mas SEMPRE valide no componente também via `useAuth().user.role`

## Endpoints V1 disponíveis

`/api/auth` (já listado no MIGRATION_GUIDE) tem todas as actions:

| Action | Pra que |
|---|---|
| `list` | Lista usuários (admin vê todos, gestor vê do próprio parceiro) |
| `create` | Cria novo usuário |
| `delete` | Remove usuário |
| `update_user` | Atualiza nome/email/etc |
| `update_role` | Muda role (admin/gestor/operador) |
| `reset_pw` | Reseta senha (volta pra PENDING_FIRST_LOGIN) |
| `assign_parceiro` | Associa user a um parceiro |
| `update_bank_codes` | Códigos bancários por user |
| `list_parceiros` | Lista parceiros |
| `create_parceiro` | Cria parceiro |
| `update_parceiro` | Atualiza parceiro |
| `delete_parceiro` | Remove parceiro |
| `my_team` | Lista users do meu parceiro (gestor) |

Confirmar:
```bash
grep -nE "if \(action === " api/auth.js
```

## Tabelas Supabase

- `users` — { id, username, name, role, parceiro_id, password_hash, salt, bank_codes, active, created_at }
- `parceiros` — { id, nome, slug, ... }

## Modelo a copiar

| Pra essa tela Admin | Copie de |
|---|---|
| Lista CRUD com modal | `app/(app)/clt/empresas-aprovadas/page.tsx` (lista + modal Dialog) |
| Form em modal | `components/clt/modal-digitar.tsx` (sections + submit) |

## Sequência sugerida

### `/admin/usuarios`
1. Lista paginada com filtros (busca, role, parceiro)
2. Botão "Novo usuário" abre modal de criação
3. Cada linha: editar (modal), reset senha, mudar role, deletar
4. Badge colorida por role: admin=red, gestor=blue, operador=gray

### `/admin/parceiros`
1. Lista de parceiros (cards, não tabela — são poucos)
2. Cada card: nome + count de usuários + botões editar/deletar
3. Botão "Novo parceiro"

## Status migração ao escrever este doc

- ❌ Ambas stubs

## UX importante

- **Confirmações obrigatórias** em deletar (alert/confirm)
- **Reset de senha**: deixa claro que volta pra "primeiro login define"
- **Mudar role pra admin**: dupla confirmação
- **Deletar parceiro**: bloqueia se tem usuários associados (ou cascade com aviso forte)

## Observações finais

- Chat de Admin é mais sensível — manuseio de credenciais
- **NUNCA** mostre `password_hash` ou `salt` no front
- Sempre confirmar via `useAuth().user.role === 'admin'` antes de qualquer ação
- Loga audit (já tem tabela `audit_log` no V1) — V2 pode mostrar histórico
