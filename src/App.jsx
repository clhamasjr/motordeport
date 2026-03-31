import React, { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { C, globalCSS, R$, N } from './lib/theme';
import { login, logout, getSession, initUsers, isAdmin, isGestor, roleLabel, changePassword } from './lib/auth';
import ConsultaPage from './pages/ConsultaPage';
import BasePage from './pages/BasePage';
import CRMPage from './pages/CRMPage';
import EsteiraPage from './pages/EsteiraPage';

// ── Auth Context
const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

// ── Inject global CSS
const style = document.createElement('style');
style.textContent = globalCSS;
document.head.appendChild(style);

// ══════ LOGIN ══════
function LoginScreen({ onLogin }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');

  const go = () => {
    if (!user || !pass) { setError('Preencha todos os campos'); return; }
    initUsers();
    const u = login(user.trim(), pass);
    if (!u) { setError('Usuário ou senha incorretos'); return; }
    onLogin(u);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: `radial-gradient(ellipse at top, rgba(59,130,246,.06), transparent 60%)` }}>
      <div style={{ width: '100%', maxWidth: 440, animation: 'fadeIn .5s ease' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, justifyContent: 'center', marginBottom: 40 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: 'linear-gradient(135deg,#0EA5E9,#3B82F6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 900, color: '#fff', letterSpacing: -1, boxShadow: '0 8px 32px rgba(59,130,246,.3)' }}>FF</div>
          <div><div style={{ fontSize: 26, fontWeight: 800 }}>FlowForce</div><div style={{ fontSize: 13, color: C.t3 }}>Motor de Operações</div></div>
        </div>
        <div style={{ background: C.sf, border: `1px solid ${C.brd}`, borderRadius: 20, padding: '40px 36px', boxShadow: '0 0 20px rgba(59,130,246,.08)' }}>
          <div style={{ fontSize: 20, fontWeight: 700, textAlign: 'center', marginBottom: 4 }}>Bem-vindo</div>
          <div style={{ fontSize: 12, color: C.t2, textAlign: 'center', marginBottom: 28 }}>Entre com suas credenciais</div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.t2, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Usuário</label>
            <input value={user} onChange={e => setUser(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} placeholder="Usuário"
              style={{ width: '100%', padding: '13px 16px', borderRadius: 10, border: `1px solid ${C.brd}`, background: C.card, color: C.t1, fontSize: 14 }} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.t2, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Senha</label>
            <input type="password" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} placeholder="Senha"
              style={{ width: '100%', padding: '13px 16px', borderRadius: 10, border: `1px solid ${C.brd}`, background: C.card, color: C.t1, fontSize: 14 }} />
          </div>
          <button onClick={go} style={{ width: '100%', padding: 14, borderRadius: 10, background: 'linear-gradient(135deg,#0EA5E9,#3B82F6)', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginTop: 8, boxShadow: '0 4px 12px rgba(59,130,246,.3)' }}>Entrar</button>
          {error && <div style={{ color: C.red, fontSize: 13, textAlign: 'center', marginTop: 16 }}>{error}</div>}
        </div>
      </div>
    </div>
  );
}

// ══════ SIDEBAR ══════
const NAV = [
  { to: '/consulta', icon: '🔍', label: 'Consulta', roles: ['admin', 'gestor', 'operador'] },
  { to: '/base', icon: '📊', label: 'Base & Análise', roles: ['admin', 'gestor'] },
  { to: '/crm', icon: '📋', label: 'CRM & Disparo', roles: ['admin', 'gestor', 'operador'] },
  { to: '/esteira', icon: '📝', label: 'Esteira', roles: ['admin', 'gestor', 'operador'] },
];

function Sidebar() {
  const { user } = useAuth();
  const linkStyle = (isActive) => ({
    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderRadius: 10,
    textDecoration: 'none', fontSize: 13, fontWeight: 700, transition: 'all .15s',
    color: isActive ? '#fff' : C.t2,
    background: isActive ? 'linear-gradient(135deg,#0EA5E9,#3B82F6)' : 'transparent',
    boxShadow: isActive ? '0 4px 12px rgba(59,130,246,.3)' : 'none',
  });

  return (
    <aside style={{ width: 220, minWidth: 220, background: C.sf, borderRight: `1px solid ${C.brd}`, display: 'flex', flexDirection: 'column', padding: '20px 12px', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px', marginBottom: 28 }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg,#0EA5E9,#3B82F6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900, color: '#fff', letterSpacing: -1 }}>FF</div>
        <div><div style={{ fontSize: 15, fontWeight: 800, color: C.t1 }}>FlowForce</div><div style={{ fontSize: 9, color: C.t3, fontWeight: 600 }}>Motor de Operações v2</div></div>
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.t3, textTransform: 'uppercase', letterSpacing: '.08em', padding: '0 14px', marginBottom: 8 }}>Módulos</div>
      {NAV.filter(n => n.roles.includes(user?.role)).map(n => (
        <NavLink key={n.to} to={n.to} style={({ isActive }) => linkStyle(isActive)}>
          <span style={{ fontSize: 16 }}>{n.icon}</span>
          <span>{n.label}</span>
        </NavLink>
      ))}
      <div style={{ flex: 1 }} />
      <div style={{ fontSize: 9, color: C.t3, textAlign: 'center', padding: 8 }}>FlowForce v2.0 — LhamasCred</div>
    </aside>
  );
}

// ══════ HEADER ══════
function Header() {
  const { user, doLogout } = useAuth();
  return (
    <header style={{ background: 'rgba(10,17,32,.9)', backdropFilter: 'blur(12px)', borderBottom: `1px solid ${C.brd}`, padding: '0 28px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px', borderRadius: 10, background: C.card, border: `1px solid ${C.brd}` }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#0EA5E9,#3B82F6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: '#fff' }}>{user?.name?.[0] || '?'}</div>
        <div><div style={{ fontSize: 11, fontWeight: 600 }}>{user?.name}</div><div style={{ fontSize: 9, color: C.t3 }}>{roleLabel(user?.role)}</div></div>
      </div>
      <button onClick={doLogout} style={{ padding: '5px 12px', borderRadius: 6, border: `1px solid ${C.red}`, color: C.red, fontSize: 11, fontWeight: 700 }}>Sair</button>
    </header>
  );
}

// ══════ LAYOUT ══════
function Layout({ children }) {
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Header />
        <main style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          {children}
        </main>
      </div>
    </div>
  );
}

// ══════ APP ══════
export default function App() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    initUsers();
    const sess = getSession();
    if (sess) {
      const users = JSON.parse(localStorage.getItem('lhm_users') || '[]');
      const found = users.find(u => u.user === sess.user);
      if (found) setUser(found);
    }
  }, []);

  const doLogout = () => { logout(); setUser(null); };

  if (!user) return <LoginScreen onLogin={setUser} />;

  const defaultRoute = isGestor(user) ? '/base' : '/consulta';

  return (
    <AuthCtx.Provider value={{ user, doLogout }}>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/consulta" element={<ConsultaPage />} />
            <Route path="/base" element={<BasePage />} />
            <Route path="/crm" element={<CRMPage />} />
            <Route path="/esteira" element={<EsteiraPage />} />
            <Route path="*" element={<Navigate to={defaultRoute} replace />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </AuthCtx.Provider>
  );
}
