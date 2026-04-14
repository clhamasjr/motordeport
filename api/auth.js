// ══════════════════════════════════════════════════════════════════
// api/auth.js — Autenticacao FlowForce com Supabase
// ══════════════════════════════════════════════════════════════════

import { dbSelect, dbInsert, dbUpdate, dbDelete, dbQuery } from './_lib/supabase.js';
import { json, jsonError, handleOptions, hashPassword, generateSalt, generateToken, verifySession, requireRole } from './_lib/auth.js';

const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);
  if (req.method !== 'POST') return jsonError('POST only', 405, req);

  let body;
  try { body = await req.json(); } catch { return jsonError('Invalid JSON', 400, req); }

  const { action } = body;

  // ── LOGIN ──────────────────────────────────────────────────
  if (action === 'login') {
    const { user, pass } = body;
    if (!user || !pass) return json({ ok: false, error: 'Preencha todos os campos' }, 400, req);

    const username = user.trim().toLowerCase();

    // Buscar usuario
    const { data: found, error } = await dbSelect('users', {
      filters: { username, active: true },
      select: 'id,username,name,role,password_hash,salt',
      single: true
    });

    if (error || !found) return json({ ok: false, error: 'Usuario ou senha incorretos' }, 401, req);

    // Handle primeiro login do admin (hash PENDING)
    if (found.password_hash === 'PENDING_FIRST_LOGIN') {
      const salt = generateSalt();
      const hash = await hashPassword(pass, salt);
      await dbUpdate('users', { id: found.id }, { password_hash: hash, salt });
    } else {
      // Verificar senha
      const hash = await hashPassword(pass, found.salt);
      if (hash !== found.password_hash) {
        return json({ ok: false, error: 'Usuario ou senha incorretos' }, 401, req);
      }
    }

    // Criar sessao
    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '';

    await dbInsert('sessions', {
      user_id: found.id,
      token,
      expires_at: expiresAt,
      ip_address: ip.split(',')[0].trim(),
      user_agent: (req.headers.get('user-agent') || '').substring(0, 200)
    });

    // Audit
    await dbInsert('audit_log', {
      user_id: found.id,
      action: 'login',
      ip_address: ip.split(',')[0].trim()
    });

    return json({
      ok: true,
      token,
      user: { id: found.id, user: found.username, name: found.name, role: found.role },
    }, 200, req);
  }

  // ── LOGOUT ─────────────────────────────────────────────────
  if (action === 'logout') {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token) await dbDelete('sessions', { token });
    return json({ ok: true, mensagem: 'Sessao encerrada' }, 200, req);
  }

  // ── VERIFY SESSION ─────────────────────────────────────────
  if (action === 'verify') {
    const user = await verifySession(req);
    if (!user) return json({ ok: false }, 200, req);
    return json({ ok: true, user }, 200, req);
  }

  // ── A partir daqui, requer sessao valida ───────────────────
  const currentUser = await verifySession(req);
  if (!currentUser) return jsonError('Sessao invalida', 401, req);

  // ── LIST USERS (admin/gestor) ──────────────────────────────
  if (action === 'list') {
    const roleErr = requireRole(currentUser, ['admin', 'gestor']);
    if (roleErr) return roleErr;

    const { data, error } = await dbSelect('users', {
      select: 'id,username,name,role,active,created_at',
      order: 'created_at.asc'
    });
    if (error) return jsonError('Erro ao buscar usuarios', 500, req);
    return json({ ok: true, users: data }, 200, req);
  }

  // ── CREATE USER (admin only) ───────────────────────────────
  if (action === 'create') {
    const roleErr = requireRole(currentUser, ['admin']);
    if (roleErr) return roleErr;

    const { name, user: newUser, pass, role } = body;
    if (!name || !newUser || !pass) return json({ ok: false, error: 'Preencha todos os campos' }, 400, req);
    if (pass.length < 4) return json({ ok: false, error: 'Senha min 4 caracteres' }, 400, req);

    const username = newUser.trim().toLowerCase();

    // Verificar duplicata
    const { data: existing } = await dbSelect('users', { filters: { username }, single: true });
    if (existing) return json({ ok: false, error: 'Usuario ja existe' }, 400, req);

    const salt = generateSalt();
    const hash = await hashPassword(pass, salt);

    const { data: created, error } = await dbInsert('users', {
      username,
      name: name.trim(),
      password_hash: hash,
      salt,
      role: role || 'operador'
    });

    if (error) return jsonError('Erro ao criar usuario', 500, req);

    await dbInsert('audit_log', {
      user_id: currentUser.id,
      action: 'create_user',
      details: { target: username, role: role || 'operador' }
    });

    return json({ ok: true, mensagem: 'Usuario criado', user: { id: created.id, user: created.username, name: created.name, role: created.role } }, 200, req);
  }

  // ── DELETE USER (admin only) ───────────────────────────────
  if (action === 'delete') {
    const roleErr = requireRole(currentUser, ['admin']);
    if (roleErr) return roleErr;

    const { targetUser } = body;
    if (targetUser === 'admin') return json({ ok: false, error: 'Nao pode excluir admin' }, 400, req);

    // Soft delete
    const { error } = await dbUpdate('users', { username: targetUser }, { active: false });
    if (error) return jsonError('Erro ao excluir', 500, req);

    // Invalidar sessoes
    const { data: targetData } = await dbSelect('users', { filters: { username: targetUser }, select: 'id', single: true });
    if (targetData) await dbDelete('sessions', { user_id: targetData.id });

    await dbInsert('audit_log', {
      user_id: currentUser.id,
      action: 'delete_user',
      details: { target: targetUser }
    });

    return json({ ok: true, mensagem: 'Usuario desativado' }, 200, req);
  }

  // ── UPDATE ROLE (admin only) ────────────────────────────────
  if (action === 'update_role') {
    const roleErr = requireRole(currentUser, ['admin']);
    if (roleErr) return roleErr;

    const { targetUser, role } = body;
    if (!targetUser || !role) return json({ ok: false, error: 'targetUser e role obrigatorios' }, 400, req);
    if (!['admin', 'gestor', 'operador'].includes(role)) return json({ ok: false, error: 'Role invalido' }, 400, req);

    const { data: target } = await dbSelect('users', { filters: { username: targetUser }, select: 'id', single: true });
    if (!target) return json({ ok: false, error: 'Usuario nao encontrado' }, 400, req);

    await dbUpdate('users', { id: target.id }, { role });

    await dbInsert('audit_log', { user_id: currentUser.id, action: 'update_role', details: { target: targetUser, role } });

    return json({ ok: true, mensagem: 'Role atualizado para ' + role }, 200, req);
  }

  // ── RESET PASSWORD (admin only) ────────────────────────────
  if (action === 'reset_pw') {
    const roleErr = requireRole(currentUser, ['admin']);
    if (roleErr) return roleErr;

    const { targetUser, newPass } = body;
    if (!newPass || newPass.length < 4) return json({ ok: false, error: 'Senha min 4 caracteres' }, 400, req);

    const { data: target } = await dbSelect('users', { filters: { username: targetUser }, select: 'id', single: true });
    if (!target) return json({ ok: false, error: 'Usuario nao encontrado' }, 400, req);

    const salt = generateSalt();
    const hash = await hashPassword(newPass, salt);
    await dbUpdate('users', { id: target.id }, { password_hash: hash, salt });

    // Invalidar sessoes do usuario
    await dbDelete('sessions', { user_id: target.id });

    return json({ ok: true, mensagem: 'Senha alterada' }, 200, req);
  }

  // ── CHANGE OWN PASSWORD ────────────────────────────────────
  if (action === 'change_pw') {
    const { oldPass, newPass } = body;

    // Buscar usuario completo
    const { data: me } = await dbSelect('users', {
      filters: { id: currentUser.id },
      select: 'id,password_hash,salt',
      single: true
    });

    const oldHash = await hashPassword(oldPass, me.salt);
    if (oldHash !== me.password_hash) return json({ ok: false, error: 'Senha atual incorreta' }, 400, req);
    if (!newPass || newPass.length < 4) return json({ ok: false, error: 'Nova senha min 4 caracteres' }, 400, req);

    const salt = generateSalt();
    const hash = await hashPassword(newPass, salt);
    await dbUpdate('users', { id: currentUser.id }, { password_hash: hash, salt });

    return json({ ok: true, mensagem: 'Senha alterada' }, 200, req);
  }

  return jsonError('action invalida', 400, req);
}

export const config = { runtime: 'edge' };
