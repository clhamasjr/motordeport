// ══════════════════════════════════════════════════════════════════
// api/_lib/auth.js — Autenticacao e seguranca compartilhada
// ══════════════════════════════════════════════════════════════════

import { dbSelect, dbQuery } from './supabase.js';

// ── CORS seguro ───────────────────────────────────────────────
const ALLOWED_ORIGINS = () => {
  const origins = process.env.ALLOWED_ORIGINS || '';
  if (origins) return origins.split(',').map(o => o.trim());
  return ['*']; // fallback — configurar em producao!
};

export function getCORS(reqOrigin) {
  const allowed = ALLOWED_ORIGINS();
  const origin = allowed.includes('*') ? '*' : (allowed.includes(reqOrigin) ? reqOrigin : allowed[0]);
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}

// ── Response helpers ──────────────────────────────────────────
export function json(data, status = 200, req = null) {
  const origin = req?.headers?.get?.('origin') || '*';
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCORS(origin), 'Content-Type': 'application/json' },
  });
}

export function jsonError(message, status = 400, req = null) {
  return json({ ok: false, error: message }, status, req);
}

// ── CORS preflight ────────────────────────────────────────────
export function handleOptions(req) {
  const origin = req?.headers?.get?.('origin') || '*';
  return new Response(null, { status: 204, headers: getCORS(origin) });
}

// ── Password hashing (HMAC-SHA256 + salt) ─────────────────────
export async function hashPassword(password, salt) {
  const secret = process.env.SESSION_SECRET || 'flowforce-default-secret-CHANGE-ME';
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(salt + ':' + password));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function generateSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Session token ─────────────────────────────────────────────
export function generateToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Verify session ────────────────────────────────────────────
export async function verifySession(req) {
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  // Buscar sessao valida
  const { data, error } = await dbQuery(
    'sessions',
    `token=eq.${encodeURIComponent(token)}&expires_at=gt.${new Date().toISOString()}&select=id,user_id,expires_at`,
    { single: true }
  );

  if (error || !data) return null;

  // Buscar usuario
  const { data: user, error: userErr } = await dbSelect('users', {
    filters: { id: data.user_id, active: true },
    select: 'id,username,name,role',
    single: true
  });

  if (userErr || !user) return null;
  return user;
}

// ── Auth middleware — retorna user ou Response de erro ─────────
export async function requireAuth(req) {
  const user = await verifySession(req);
  if (!user) return jsonError('Sessao invalida ou expirada. Faca login novamente.', 401, req);
  return user;
}

// ── Check if user has role ────────────────────────────────────
export function requireRole(user, roles) {
  if (!roles.includes(user.role)) {
    return json({ ok: false, error: 'Sem permissao' }, 403);
  }
  return null;
}
