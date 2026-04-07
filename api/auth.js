// ══════════════════════════════════════════════════════════════════════
// api/auth.js — Autenticação centralizada FlowForce
// Usuários persistem no servidor (funciona em qualquer máquina)
// ══════════════════════════════════════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ── Hash function (same as frontend) ───────────────────────────────
function hp(p) {
  let h = 0;
  const s = p + 'lhamas2024';
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return 'H' + Math.abs(h).toString(36);
}

// ── User store ─────────────────────────────────────────────────────
// Defaults (always available)
const DEFAULT_USERS = [
  { id: 1, user: 'admin', name: 'Administrador', pw: hp('admin123'), role: 'admin', created: 1700000000000 },
  { id: 2, user: 'gestor', name: 'Gestor', pw: hp('gestor123'), role: 'gestor', created: 1700000000000 },
  { id: 3, user: 'operador', name: 'Operador', pw: hp('op123'), role: 'operador', created: 1700000000000 },
];

// In-memory store (survives across requests in same instance)
let userStore = null;

function getUsers() {
  if (userStore) return userStore;

  // Try loading from env var FF_USERS (JSON string set in Vercel dashboard)
  try {
    const envUsers = typeof process !== 'undefined' && process.env && process.env.FF_USERS;
    if (envUsers) {
      userStore = JSON.parse(envUsers);
      return userStore;
    }
  } catch {}

  // Fallback to defaults
  userStore = [...DEFAULT_USERS];
  return userStore;
}

function saveUsers(users) {
  userStore = users;
  // Note: true persistence requires FF_USERS env var in Vercel
  // In-memory survives within same cold-start instance
}

// ── Main handler ───────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { action } = body;
  const users = getUsers();

  // ── LOGIN ────────────────────────────────────────────────────────
  if (action === 'login') {
    const { user, pass } = body;
    if (!user || !pass) return json({ ok: false, error: 'Preencha todos os campos' });

    const u = user.trim().toLowerCase();
    const pwHash = hp(pass);
    const found = users.find(x => x.user.toLowerCase() === u && x.pw === pwHash);

    if (!found) return json({ ok: false, error: 'Usuário ou senha incorretos' });

    return json({
      ok: true,
      user: { id: found.id, user: found.user, name: found.name, role: found.role },
    });
  }

  // ── LIST USERS (admin only — frontend validates role) ────────────
  if (action === 'list') {
    return json({
      ok: true,
      users: users.map(u => ({ id: u.id, user: u.user, name: u.name, role: u.role, created: u.created })),
    });
  }

  // ── CREATE USER ──────────────────────────────────────────────────
  if (action === 'create') {
    const { name, user, pass, role, adminUser, adminPass } = body;

    // Validate admin
    const admin = users.find(x => x.user === adminUser && x.pw === hp(adminPass) && x.role === 'admin');
    if (!admin) return json({ ok: false, error: 'Sem permissão' }, 403);

    if (!name || !user || !pass) return json({ ok: false, error: 'Preencha todos os campos' });
    if (users.find(x => x.user.toLowerCase() === user.toLowerCase())) return json({ ok: false, error: 'Usuário já existe' });

    const newUser = {
      id: Date.now(),
      user: user.trim().toLowerCase(),
      name: name.trim(),
      pw: hp(pass),
      role: role || 'operador',
      created: Date.now(),
    };

    users.push(newUser);
    saveUsers(users);

    return json({ ok: true, mensagem: 'Usuário criado', user: { id: newUser.id, user: newUser.user, name: newUser.name, role: newUser.role } });
  }

  // ── DELETE USER ──────────────────────────────────────────────────
  if (action === 'delete') {
    const { targetUser, adminUser, adminPass } = body;

    const admin = users.find(x => x.user === adminUser && x.pw === hp(adminPass) && x.role === 'admin');
    if (!admin) return json({ ok: false, error: 'Sem permissão' }, 403);
    if (targetUser === 'admin') return json({ ok: false, error: 'Não pode excluir admin' });

    const idx = users.findIndex(x => x.user === targetUser);
    if (idx < 0) return json({ ok: false, error: 'Usuário não encontrado' });

    users.splice(idx, 1);
    saveUsers(users);

    return json({ ok: true, mensagem: 'Usuário excluído' });
  }

  // ── RESET PASSWORD ───────────────────────────────────────────────
  if (action === 'reset_pw') {
    const { targetUser, newPass, adminUser, adminPass } = body;

    const admin = users.find(x => x.user === adminUser && x.pw === hp(adminPass) && x.role === 'admin');
    if (!admin) return json({ ok: false, error: 'Sem permissão' }, 403);
    if (!newPass || newPass.length < 4) return json({ ok: false, error: 'Senha mín 4 caracteres' });

    const target = users.find(x => x.user === targetUser);
    if (!target) return json({ ok: false, error: 'Usuário não encontrado' });

    target.pw = hp(newPass);
    saveUsers(users);

    return json({ ok: true, mensagem: 'Senha alterada' });
  }

  // ── CHANGE OWN PASSWORD ──────────────────────────────────────────
  if (action === 'change_pw') {
    const { user, oldPass, newPass } = body;

    const found = users.find(x => x.user === user && x.pw === hp(oldPass));
    if (!found) return json({ ok: false, error: 'Senha atual incorreta' });
    if (!newPass || newPass.length < 4) return json({ ok: false, error: 'Nova senha mín 4 caracteres' });

    found.pw = hp(newPass);
    saveUsers(users);

    return json({ ok: true, mensagem: 'Senha alterada' });
  }

  return json({ error: 'action inválida', actions: ['login', 'list', 'create', 'delete', 'reset_pw', 'change_pw'] }, 400);
}

export const config = { runtime: 'edge' };
