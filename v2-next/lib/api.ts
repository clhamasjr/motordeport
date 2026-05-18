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
  code?: string;
  constructor(message: string, status: number, data?: unknown, code?: string) {
    super(message);
    this.status = status;
    this.data = data;
    this.code = code;
  }
}

/**
 * Detecta se a resposta indica sessao expirada — o V1 retorna 400 (nao 401)
 * com {ok:false, error: 'Sessao invalida ou expirada. Faca login novamente.'}
 * em varios endpoints. Trata isso como AUTH_EXPIRED.
 */
function isSessionExpired(status: number, data: any): boolean {
  if (status === 401 || status === 403) return true;
  if (!data || typeof data !== 'object') return false;
  if (data.ok === false || data.success === false) {
    const msg = String(data.error || data.message || '').toLowerCase();
    if (/sess[aã]o.*(inv[aá]lid|expirad)/.test(msg)) return true;
    if (/token.*(inv[aá]lid|expirad|ausente)/.test(msg)) return true;
    if (/fa[çc]a.*login.*novamente/.test(msg)) return true;
  }
  return false;
}

let redirecting = false;
function redirectToLogin(reason: string) {
  if (typeof window === 'undefined') return;
  if (redirecting) return;
  redirecting = true;
  console.warn(`[auth] ${reason} — redirecionando pro /login`);
  clearToken();
  // hard redirect garante que TanStack Query / pilhas em memoria sao limpas
  // e nao ficam batendo no backend com token velho
  const onLogin = window.location.pathname === '/login';
  if (!onLogin) window.location.replace('/login?expired=1');
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

  // Sessao expirada (V1 retorna 400 com mensagem em vez de 401):
  // disparar redirect global UMA vez, em vez de cada hook ficar batendo
  // 400 em loop ate notar.
  if (isSessionExpired(r.status, data)) {
    redirectToLogin('Sessao expirada (detectada via api())');
    throw new ApiError(
      data?.error || data?.message || 'Sessao expirada — faca login de novo',
      401,
      data,
      'AUTH_EXPIRED',
    );
  }

  if (!r.ok) {
    const msg =
      data?.error || data?.message || data?.mensagem || `HTTP ${r.status}`;
    throw new ApiError(msg, r.status, data);
  }
  return data as T;
}
