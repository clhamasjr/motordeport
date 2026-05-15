// ──────────────────────────────────────────────────────────────────
// Admin — gestão global de usuários e parceiros do sistema.
// Não é específico do INSS — atende todos os módulos (CLT, Gov, Pref, INSS).
// Backend: /api/auth (mesma rota do login, mas com actions admin).
// ──────────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'gestor' | 'operador';

export interface User {
  id: number;
  username: string;
  name: string;
  role: UserRole;
  active?: boolean;
  bank_codes?: Record<string, string> | null;
  parceiro_id?: number | null;
  created_at?: string;
}

export interface Parceiro {
  id: number;
  nome: string;
  cnpj?: string | null;
  active: boolean;
  created_at?: string;
}

// ── Responses ──
export interface ListUsersResponse {
  ok: boolean;
  users?: User[];
  error?: string;
}

export interface ListParceirosResponse {
  ok: boolean;
  parceiros?: Parceiro[];
  error?: string;
}

export interface CreateUserParams {
  name: string;
  user: string;        // username (lowercase será forçado)
  pass: string;
  role: UserRole;
}

export interface UpdateUserParams {
  targetUser: string;  // username atual
  name?: string;
  newUsername?: string;
  role?: UserRole;
}

export interface UpdateRoleParams {
  targetUser: string;
  role: UserRole;
}

export interface UpdateBankCodesParams {
  targetUser: string;
  codes: Record<string, string>;
}

export interface AssignParceiroParams {
  targetUser: string;
  parceiroId: number | null;
}

export interface ResetPwParams {
  targetUser: string;
  newPass: string;
}

export interface CreateParceiroParams {
  nome: string;
  cnpj?: string;
}

export interface UpdateParceiroParams {
  parceiroId: number;
  nome?: string;
  cnpj?: string | null;
  active?: boolean;
}

export interface SimpleResponse {
  ok: boolean;
  mensagem?: string;
  error?: string;
}
