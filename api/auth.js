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

  // ── SESSOES ATIVAS (qualquer usuario logado) ───────────────
  // Conta sessoes nao expiradas. Usado pelo painel /orquestrador.
  // Nao expoe nomes/tokens — so o numero, e qualquer usuario logado pode ver.
  if (action === 'sessoesAtivas') {
    const nowIso = new Date().toISOString();
    const { data, error } = await dbQuery(
      'sessions',
      `select=id&expires_at=gt.${encodeURIComponent(nowIso)}`,
    );
    if (error) return jsonError('Erro consultando sessoes: ' + error, 500, req);
    return json({ ok: true, count: Array.isArray(data) ? data.length : 0 }, 200, req);
  }

  // ── LIST USERS (admin/gestor) ──────────────────────────────
  // Admin ve todos. Gestor ve apenas o proprio + vendedores do seu time (parceiro_id = seu id)
  if (action === 'list') {
    const roleErr = requireRole(currentUser, ['admin', 'gestor']);
    if (roleErr) return roleErr;

    const { data, error } = await dbSelect('users', {
      select: 'id,username,name,role,active,created_at,bank_codes,parceiro_id',
      order: 'created_at.asc'
    });
    if (error) return jsonError('Erro ao buscar usuarios', 500, req);

    // Gestor so ve users do MESMO parceiro (time da agencia dele)
    let filtered = data;
    if (currentUser.role === 'gestor' && currentUser.parceiro_id) {
      filtered = data.filter(u => u.parceiro_id === currentUser.parceiro_id);
    } else if (currentUser.role === 'gestor') {
      // gestor sem parceiro_id: so ve si mesmo
      filtered = data.filter(u => u.id === currentUser.id);
    }
    return json({ ok: true, users: filtered }, 200, req);
  }

  // ── GET CURRENT USER (inclui codigos por banco + parceiro_id) ──
  if (action === 'me') {
    const { data } = await dbSelect('users', {
      filters: { id: currentUser.id },
      select: 'id,username,name,role,bank_codes,parceiro_id',
      single: true
    });
    return json({ ok: true, user: data }, 200, req);
  }

  // ── MY TEAM — Lista users do parceiro do gestor atual ───
  // Util pra aplicar filtro "ver so meu time" em consultas/esteira/CRM
  if (action === 'my_team') {
    let teamIds = [currentUser.id];
    if (currentUser.role === 'admin') {
      const { data } = await dbSelect('users', { select: 'id' });
      teamIds = (data || []).map(u => u.id);
      return json({ ok: true, team: [], teamIds }, 200, req);
    }
    if (currentUser.role === 'gestor' && currentUser.parceiro_id) {
      // Gestor ve todos users do mesmo parceiro (incluindo si mesmo)
      const { data } = await dbSelect('users', { filters: { parceiro_id: currentUser.parceiro_id }, select: 'id,username,name,role' });
      teamIds = (data || []).map(u => u.id);
      return json({ ok: true, team: data || [], teamIds }, 200, req);
    }
    return json({ ok: true, team: [], teamIds }, 200, req);
  }

  // ── LIST PARCEIROS ──────────────────────────────────────
  if (action === 'list_parceiros') {
    const roleErr = requireRole(currentUser, ['admin', 'gestor']);
    if (roleErr) return roleErr;
    const { data, error } = await dbSelect('parceiros', {
      select: 'id,nome,cnpj,active,created_at,responsavel,telefone,email,endereco,cidade,uf,comissao_padrao,observacoes,updated_at',
      order: 'nome.asc',
    });
    if (error) return jsonError('Erro ao buscar parceiros', 500, req);
    return json({ ok: true, parceiros: data || [] }, 200, req);
  }

  // ── CREATE PARCEIRO (admin only) ────────────────────────
  if (action === 'create_parceiro') {
    const roleErr = requireRole(currentUser, ['admin']);
    if (roleErr) return roleErr;
    const { nome, cnpj, responsavel, telefone, email, endereco, cidade, uf, comissao_padrao, observacoes } = body;
    if (!nome || !nome.trim()) return json({ ok: false, error: 'Nome obrigatorio' }, 400, req);
    const row = {
      nome: nome.trim(),
      cnpj: cnpj || null,
      active: true,
      created_by: currentUser.id,
      responsavel: responsavel?.trim() || null,
      telefone: telefone?.replace(/\D/g, '') || null,
      email: email?.trim().toLowerCase() || null,
      endereco: endereco?.trim() || null,
      cidade: cidade?.trim() || null,
      uf: uf ? String(uf).toUpperCase().slice(0, 2) : null,
      comissao_padrao: comissao_padrao !== undefined && comissao_padrao !== null && comissao_padrao !== '' ? Number(comissao_padrao) : null,
      observacoes: observacoes?.trim() || null,
    };
    const { data, error } = await dbInsert('parceiros', row);
    if (error) return jsonError('Erro ao criar parceiro', 500, req);
    await dbInsert('audit_log', { user_id: currentUser.id, action: 'create_parceiro', details: { nome: row.nome } });
    return json({ ok: true, parceiro: data }, 200, req);
  }

  // ── UPDATE PARCEIRO (admin only) ────────────────────────
  if (action === 'update_parceiro') {
    const roleErr = requireRole(currentUser, ['admin']);
    if (roleErr) return roleErr;
    const { parceiroId, nome, cnpj, active, responsavel, telefone, email, endereco, cidade, uf, comissao_padrao, observacoes } = body;
    if (!parceiroId) return json({ ok: false, error: 'parceiroId obrigatorio' }, 400, req);
    const patch = {};
    if (nome !== undefined) patch.nome = String(nome).trim();
    if (cnpj !== undefined) patch.cnpj = cnpj || null;
    if (active !== undefined) patch.active = !!active;
    if (responsavel !== undefined) patch.responsavel = responsavel ? String(responsavel).trim() : null;
    if (telefone !== undefined) patch.telefone = telefone ? String(telefone).replace(/\D/g, '') : null;
    if (email !== undefined) patch.email = email ? String(email).trim().toLowerCase() : null;
    if (endereco !== undefined) patch.endereco = endereco ? String(endereco).trim() : null;
    if (cidade !== undefined) patch.cidade = cidade ? String(cidade).trim() : null;
    if (uf !== undefined) patch.uf = uf ? String(uf).toUpperCase().slice(0, 2) : null;
    if (comissao_padrao !== undefined) {
      patch.comissao_padrao = comissao_padrao === null || comissao_padrao === '' ? null : Number(comissao_padrao);
    }
    if (observacoes !== undefined) patch.observacoes = observacoes ? String(observacoes).trim() : null;
    if (!Object.keys(patch).length) return json({ ok: true, mensagem: 'Nada para atualizar' }, 200, req);
    await dbUpdate('parceiros', { id: parceiroId }, patch);
    await dbInsert('audit_log', { user_id: currentUser.id, action: 'update_parceiro', details: { parceiroId, patch } });
    return json({ ok: true, mensagem: 'Parceiro atualizado' }, 200, req);
  }

  // ── DELETE PARCEIRO (admin only — soft via active=false) ──
  if (action === 'delete_parceiro') {
    const roleErr = requireRole(currentUser, ['admin']);
    if (roleErr) return roleErr;
    const { parceiroId } = body;
    if (!parceiroId) return json({ ok: false, error: 'parceiroId obrigatorio' }, 400, req);
    // Conta users vinculados
    const { data: users } = await dbSelect('users', { filters: { parceiro_id: parceiroId }, select: 'id' });
    if (users && users.length) {
      return json({ ok: false, error: `Parceiro tem ${users.length} user(s) vinculado(s). Desvincule antes de excluir.` }, 400, req);
    }
    await dbUpdate('parceiros', { id: parceiroId }, { active: false });
    await dbInsert('audit_log', { user_id: currentUser.id, action: 'delete_parceiro', details: { parceiroId } });
    return json({ ok: true, mensagem: 'Parceiro desativado' }, 200, req);
  }

  // ── ASSIGN PARCEIRO (vincula gestor ou vendedor a um parceiro) ──
  // body: { targetUser: username, parceiroId: number|null }
  if (action === 'assign_parceiro') {
    const roleErr = requireRole(currentUser, ['admin', 'gestor']);
    if (roleErr) return roleErr;
    const { targetUser, parceiroId } = body;
    if (!targetUser) return json({ ok: false, error: 'targetUser obrigatorio' }, 400, req);
    const { data: target } = await dbSelect('users', { filters: { username: targetUser }, select: 'id,username,role', single: true });
    if (!target) return json({ ok: false, error: 'Usuario nao encontrado' }, 400, req);
    if (target.role === 'admin') return json({ ok: false, error: 'Admin nao tem parceiro' }, 400, req);
    // Gestor so pode vincular ao proprio parceiro
    if (currentUser.role === 'gestor') {
      if (parceiroId !== null && parceiroId !== currentUser.parceiro_id) {
        return json({ ok: false, error: 'Gestor so pode vincular ao proprio parceiro' }, 403, req);
      }
    }
    // Valida parceiroId existe se fornecido
    if (parceiroId !== null && parceiroId !== undefined) {
      const { data: parceiro } = await dbSelect('parceiros', { filters: { id: parceiroId }, select: 'id,nome', single: true });
      if (!parceiro) return json({ ok: false, error: 'Parceiro nao encontrado' }, 400, req);
    }
    await dbUpdate('users', { id: target.id }, { parceiro_id: parceiroId || null });
    await dbInsert('audit_log', { user_id: currentUser.id, action: 'assign_parceiro', details: { target: targetUser, parceiroId: parceiroId || null } });
    return json({ ok: true, mensagem: parceiroId ? 'Vinculado ao parceiro' : 'Desvinculado' }, 200, req);
  }

  // ── UPDATE BANK CODES (admin only) ─────────────────────
  // body.codes = { facta: 'XXX', qitech: 'YYY', ... }
  if (action === 'update_bank_codes') {
    const roleErr = requireRole(currentUser, ['admin']);
    if (roleErr) return roleErr;
    const { targetUser, codes } = body;
    if (!targetUser) return json({ ok: false, error: 'targetUser obrigatorio' }, 400, req);
    if (!codes || typeof codes !== 'object') return json({ ok: false, error: 'codes deve ser objeto' }, 400, req);
    const { data: target } = await dbSelect('users', { filters: { username: targetUser }, select: 'id,bank_codes', single: true });
    if (!target) return json({ ok: false, error: 'Usuario nao encontrado' }, 400, req);
    // Merge com codigos existentes
    const merged = Object.assign({}, target.bank_codes || {}, codes);
    // Remove chaves vazias/null
    Object.keys(merged).forEach(k => { if (!merged[k]) delete merged[k]; });
    await dbUpdate('users', { id: target.id }, { bank_codes: merged });
    await dbInsert('audit_log', { user_id: currentUser.id, action: 'update_bank_codes', details: { target: targetUser, codes: merged } });
    return json({ ok: true, mensagem: 'Codigos atualizados', bank_codes: merged }, 200, req);
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

  // ── UPDATE USER (admin OR gestor — gestor so do proprio parceiro) ──
  if (action === 'update_user') {
    const roleErr = requireRole(currentUser, ['admin', 'gestor']);
    if (roleErr) return roleErr;

    const { targetUser, name, role, newUsername } = body;
    if (!targetUser) return json({ ok: false, error: 'targetUser obrigatorio' }, 400, req);
    if (targetUser === 'admin') return json({ ok: false, error: 'Nao pode editar o admin master' }, 400, req);

    const { data: target } = await dbSelect('users', {
      filters: { username: targetUser },
      select: 'id, username, name, role, parceiro_id, active',
      single: true
    });
    if (!target) return json({ ok: false, error: 'Usuario nao encontrado' }, 400, req);

    // Gestor so pode editar usuarios do proprio parceiro, e nao pode mexer em admins
    if (currentUser.role === 'gestor') {
      if (target.role === 'admin') return json({ ok: false, error: 'Gestor nao edita admin' }, 403, req);
      if (target.parceiro_id !== currentUser.parceiro_id) return json({ ok: false, error: 'Usuario fora do seu parceiro' }, 403, req);
      // Gestor nao promove ninguem a admin, e nao mexe em outros gestores acima dele
      if (role && role === 'admin') return json({ ok: false, error: 'Gestor nao promove a admin' }, 403, req);
    }

    const patch = {};
    if (name && name.trim()) patch.name = name.trim();
    if (role && ['admin', 'gestor', 'operador'].includes(role)) {
      // Gestor so pode definir roles dentro do espectro permitido
      if (currentUser.role === 'gestor' && role === 'admin') return json({ ok: false, error: 'Gestor nao promove a admin' }, 403, req);
      patch.role = role;
    }
    if (newUsername && newUsername.trim() && newUsername.toLowerCase() !== target.username) {
      const u2 = newUsername.trim().toLowerCase();
      if (u2 === 'admin') return json({ ok: false, error: 'Username reservado' }, 400, req);
      const { data: dup } = await dbSelect('users', { filters: { username: u2 }, single: true });
      if (dup && dup.id !== target.id) return json({ ok: false, error: 'Username ja existe' }, 400, req);
      patch.username = u2;
    }
    if (!Object.keys(patch).length) return json({ ok: true, mensagem: 'Nada pra atualizar' }, 200, req);

    const { error } = await dbUpdate('users', { id: target.id }, patch);
    if (error) return jsonError('Erro ao atualizar usuario', 500, req);

    await dbInsert('audit_log', {
      user_id: currentUser.id,
      action: 'update_user',
      details: { target: targetUser, patch }
    });

    return json({ ok: true, mensagem: 'Usuario atualizado', patch }, 200, req);
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
