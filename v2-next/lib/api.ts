// ════════════════════════════════════════════════════════════════════
// lib/api.ts — Client HTTP que aponta pras Edge Functions do V1 (/api/*)
//
// O backend permanece o mesmo durante a migração. next.config.mjs já tem
// rewrites: /api/:path* → motordeport.vercel.app/api/:path*
// Em prod, as rewrites preservam a session cookie.
// ════════════════════════════════════════════════════════════════════

const TOKEN_KEY = 'ff_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/**
 * POST padrão pras Edge Functions (formato action-based do V1).
 * Ex: api('/api/clt-fila', { action: 'criar', cpf: '...' })
 */
export async function api<T = unknown>(
  path: string,
  body: Record<string, unknown> = {},
  init: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const r = await fetch(path, {
    method: 'POST',
    ...init,
    headers,
    body: JSON.stringify(body),
  });

  let data: any;
  const text = await r.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.substring(0, 500) };
  }

  if (!r.ok) {
    const msg =
      data?.error || data?.message || data?.mensagem || `HTTP ${r.status}`;
    throw new ApiError(msg, r.status, data);
  }
  return data as T;
}
