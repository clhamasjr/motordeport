export const config = { runtime: 'edge' };

// ══════════════════════════════════════════════════════════════════
// api/gestao.js — Painel de Gestao — visao geral de atividades
// ══════════════════════════════════════════════════════════════════

import { json, jsonError, handleOptions, requireAuth, requireRole } from './_lib/auth.js';
import { dbQuery } from './_lib/supabase.js';

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);
  if (req.method !== 'POST') return jsonError('POST only', 405, req);

  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  // Apenas admin e gestor
  const roleErr = requireRole(user, ['admin', 'gestor']);
  if (roleErr) return roleErr;

  let body;
  try { body = await req.json(); } catch { return jsonError('Invalid JSON', 400, req); }
  const { action } = body;

  try {
    // ── DASHBOARD: overview completo ─────────────────────────
    if (action === 'dashboard') {
      const now = new Date().toISOString();

      // 1. Usuarios ativos (sessoes nao expiradas)
      const { data: sessions } = await dbQuery('sessions',
        `select=user_id,created_at,ip_address&expires_at=gt.${encodeURIComponent(now)}&order=created_at.desc`
      );

      // 2. Lista de usuarios
      const { data: users } = await dbQuery('users',
        'select=id,username,name,role,active,created_at&order=created_at.asc'
      );

      // 3. Digitacao stats
      const { data: digitacao } = await dbQuery('digitacao',
        'select=id,user_id,status,tipo,banco,valor_operacao,created_at&order=created_at.desc&limit=500'
      );

      // 4. Audit log recente (ultimos 50)
      const { data: audit } = await dbQuery('audit_log',
        'select=id,user_id,action,details,ip_address,created_at&order=created_at.desc&limit=50'
      );

      // 5. Consultas recentes
      const { data: consultas } = await dbQuery('consultas',
        'select=id,user_id,tipo,cpf,nome,fonte,created_at&order=created_at.desc&limit=50'
      );

      // 6. Chats WhatsApp
      const { data: chats } = await dbQuery('wpp_chats',
        'select=id,instance,jid,name,phone,status,last_message,last_message_at,assigned_to,unread_count&order=last_message_at.desc&limit=100'
      );

      // Build user map
      const userMap = {};
      for (const u of (users || [])) userMap[u.id] = u;

      // Build active sessions per user
      const activeUsers = {};
      for (const s of (sessions || [])) {
        if (!activeUsers[s.user_id]) activeUsers[s.user_id] = { count: 0, lastAt: s.created_at, ip: s.ip_address };
        activeUsers[s.user_id].count++;
      }

      // Digitacao stats per user
      const digPerUser = {};
      const digPerStatus = {};
      let totalValor = 0;
      for (const d of (digitacao || [])) {
        const uid = d.user_id;
        if (!digPerUser[uid]) digPerUser[uid] = { total: 0, pendente: 0, enviada: 0, aprovada: 0, paga: 0, valor: 0 };
        digPerUser[uid].total++;
        digPerUser[uid][d.status] = (digPerUser[uid][d.status] || 0) + 1;
        digPerUser[uid].valor += (d.valor_operacao || 0);
        digPerStatus[d.status] = (digPerStatus[d.status] || 0) + 1;
        totalValor += (d.valor_operacao || 0);
      }

      // Consultas per user (today)
      const today = new Date().toISOString().split('T')[0];
      const consultasHoje = (consultas || []).filter(c => c.created_at && c.created_at.startsWith(today));
      const consultasPerUser = {};
      for (const c of consultasHoje) {
        consultasPerUser[c.user_id] = (consultasPerUser[c.user_id] || 0) + 1;
      }

      // Format users with activity data
      const usersWithActivity = (users || []).filter(u => u.active).map(u => ({
        id: u.id,
        user: u.username,
        name: u.name,
        role: u.role,
        online: !!activeUsers[u.id],
        sessions: activeUsers[u.id]?.count || 0,
        lastIp: activeUsers[u.id]?.ip || '',
        digitacoes: digPerUser[u.id]?.total || 0,
        digValor: digPerUser[u.id]?.valor || 0,
        digPendente: digPerUser[u.id]?.pendente || 0,
        digAprovada: digPerUser[u.id]?.aprovada || 0,
        digPaga: digPerUser[u.id]?.paga || 0,
        consultasHoje: consultasPerUser[u.id] || 0
      }));

      // Format audit log
      const auditFormatted = (audit || []).map(a => ({
        ...a,
        userName: userMap[a.user_id]?.name || userMap[a.user_id]?.username || '?'
      }));

      // Format consultas
      const consultasFormatted = (consultas || []).map(c => ({
        ...c,
        userName: userMap[c.user_id]?.name || userMap[c.user_id]?.username || '?'
      }));

      return json({
        ok: true,
        users: usersWithActivity,
        onlineCount: Object.keys(activeUsers).length,
        digitacao: {
          total: (digitacao || []).length,
          perStatus: digPerStatus,
          totalValor
        },
        consultas: {
          hoje: consultasHoje.length,
          total: (consultas || []).length,
          recentes: consultasFormatted.slice(0, 20)
        },
        audit: auditFormatted,
        chats: {
          total: (chats || []).length,
          abertos: (chats || []).filter(c => c.status === 'aberto').length,
          unread: (chats || []).reduce((s, c) => s + (c.unread_count || 0), 0),
          recentes: (chats || []).slice(0, 10)
        }
      }, 200, req);
    }

    return jsonError('action invalida. Use: dashboard', 400, req);
  } catch (e) {
    return json({ error: 'Erro interno' }, 500, req);
  }
}
