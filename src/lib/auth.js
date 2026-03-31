// ══════ AUTH ══════
function hp(p) {
  let h = 0;
  const s = p + 'lhamas2024';
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return 'H' + Math.abs(h).toString(36);
}

const DEFAULT_USERS = [
  { id: 1, user: 'admin', name: 'Administrador', pw: hp('admin123'), role: 'admin', created: Date.now() },
  { id: 2, user: 'gestor', name: 'Gestor', pw: hp('gestor123'), role: 'gestor', created: Date.now() },
  { id: 3, user: 'operador', name: 'Operador', pw: hp('op123'), role: 'operador', created: Date.now() },
];

export function getUsers() {
  try { return JSON.parse(localStorage.getItem('lhm_users')); } catch { return null; }
}
export function saveUsers(u) { localStorage.setItem('lhm_users', JSON.stringify(u)); }

export function initUsers() {
  let u = getUsers();
  if (!u) { u = DEFAULT_USERS; saveUsers(u); }
  let changed = false;
  for (let x of u) if (x.role === 'user') { x.role = 'operador'; changed = true; }
  if (changed) saveUsers(u);
  return u;
}

export function getSession() {
  try {
    let s = JSON.parse(localStorage.getItem('lhm_sess'));
    if (!s || Date.now() - s.ts > 864e5) return null;
    return s;
  } catch { return null; }
}

export function login(username, password) {
  const users = initUsers();
  const f = users.find(x => x.user.toLowerCase() === username.toLowerCase() && x.pw === hp(password));
  if (!f) return null;
  localStorage.setItem('lhm_sess', JSON.stringify({ user: f.user, name: f.name, role: f.role, ts: Date.now() }));
  return f;
}

export function logout() {
  localStorage.removeItem('lhm_sess');
}

export function changePassword(currentUser, oldPw, newPw) {
  if (hp(oldPw) !== currentUser.pw) return 'Senha atual incorreta';
  if (newPw.length < 4) return 'Mínimo 4 caracteres';
  let users = getUsers();
  let i = users.findIndex(u => u.user === currentUser.user);
  if (i >= 0) { users[i].pw = hp(newPw); saveUsers(users); }
  return null; // success
}

export function addUser(name, username, password, role) {
  let users = getUsers() || [];
  if (users.find(x => x.user === username.toLowerCase())) return 'Já existe';
  users.push({ id: Date.now(), user: username.toLowerCase(), name, pw: hp(password), role, created: Date.now() });
  saveUsers(users);
  return null;
}

export function deleteUser(username) {
  saveUsers((getUsers() || []).filter(x => x.user !== username));
}

export function resetPassword(username, newPw) {
  let users = getUsers();
  let i = users.findIndex(x => x.user === username);
  if (i >= 0) { users[i].pw = hp(newPw); saveUsers(users); }
}

export function isAdmin(user) { return user?.role === 'admin'; }
export function isGestor(user) { return user?.role === 'gestor' || user?.role === 'admin'; }
export function isOperador(user) { return user?.role === 'operador'; }
export function roleLabel(r) { return r === 'admin' ? 'Admin' : r === 'gestor' ? 'Gestor' : 'Operador'; }
