export const config = { runtime: 'edge' };

// ══════════════════════════════════════════════════════════════════
// api/digitacao.js — CRUD Esteira de Digitacao — FlowForce
// ══════════════════════════════════════════════════════════════════

import { json, jsonError, handleOptions, requireAuth } from './_lib/auth.js';
import { dbSelect, dbInsert, dbUpdate, dbDelete, dbQuery } from './_lib/supabase.js';

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);
  if (req.method !== 'POST') return jsonError('POST only', 405, req);

  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  let body;
  try { body = await req.json(); } catch { return jsonError('Invalid JSON', 400, req); }
  const { action } = body;

  try {
    // ── LIST ──────────────────────────────────────────────────
    if (action === 'list') {
      const status = body.status || '';
      const limit = body.limit || 100;
      let qs = `select=*&order=created_at.desc&limit=${limit}`;

      // Admin/gestor ve tudo, operador ve so os seus
      if (user.role === 'operador') qs += `&user_id=eq.${user.id}`;
      if (status) qs += `&status=eq.${encodeURIComponent(status)}`;
      if (body.cpf) qs += `&cpf=eq.${encodeURIComponent(body.cpf.replace(/\D/g, ''))}`;

      const { data, error } = await dbQuery('digitacao', qs);
      if (error) return jsonError('Erro ao buscar', 500, req);
      return json({ ok: true, items: data || [] }, 200, req);
    }

    // ── CREATE ────────────────────────────────────────────────
    if (action === 'create') {
      const record = buildRecord(body, user.id);
      if (!record.cpf) return jsonError('CPF obrigatorio', 400, req);
      if (!record.tipo) return jsonError('tipo obrigatorio', 400, req);

      const { data, error } = await dbInsert('digitacao', record);
      if (error) return jsonError('Erro ao criar: ' + error, 500, req);
      return json({ ok: true, id: data?.id, item: data }, 200, req);
    }

    // ── BATCH CREATE ─────────────────────────────────────────
    if (action === 'batchCreate') {
      const items = body.items || [];
      if (!items.length) return jsonError('items vazio', 400, req);

      const results = [];
      for (const item of items) {
        const record = buildRecord(item, user.id);
        if (!record.cpf || !record.tipo) { results.push({ ok: false, error: 'cpf/tipo faltando' }); continue; }
        const { data, error } = await dbInsert('digitacao', record);
        results.push(error ? { ok: false, error } : { ok: true, id: data?.id });
      }
      return json({ ok: true, total: items.length, created: results.filter(r => r.ok).length, results }, 200, req);
    }

    // ── UPDATE ────────────────────────────────────────────────
    if (action === 'update') {
      const { id } = body;
      if (!id) return jsonError('id obrigatorio', 400, req);

      // Verificar permissao
      const { data: existing } = await dbSelect('digitacao', { filters: { id }, single: true });
      if (!existing) return jsonError('Registro nao encontrado', 404, req);
      if (user.role === 'operador' && existing.user_id !== user.id) return jsonError('Sem permissao', 403, req);

      const updates = {};
      const allowed = ['status', 'codigo_af', 'id_simulador', 'simulation_id', 'loan_id',
        'url_formalizacao', 'valor_operacao', 'valor_parcela', 'taxa_nova', 'prazo_novo',
        'valor_troco', 'codigo_tabela', 'dados_pessoais', 'dados_simulacao', 'observacoes',
        'banco', 'saldo_devedor'];
      for (const k of allowed) {
        if (body[k] !== undefined) updates[k] = body[k];
      }

      if (Object.keys(updates).length === 0) return jsonError('Nada pra atualizar', 400, req);

      const { data, error } = await dbUpdate('digitacao', { id }, updates);
      if (error) return jsonError('Erro ao atualizar: ' + error, 500, req);
      return json({ ok: true, item: data?.[0] || null }, 200, req);
    }

    // ── DELETE ────────────────────────────────────────────────
    if (action === 'delete') {
      const { id } = body;
      if (!id) return jsonError('id obrigatorio', 400, req);

      const { data: existing } = await dbSelect('digitacao', { filters: { id }, single: true });
      if (!existing) return jsonError('Registro nao encontrado', 404, req);
      if (user.role === 'operador' && existing.user_id !== user.id) return jsonError('Sem permissao', 403, req);
      if (!['pendente', 'cancelada'].includes(existing.status)) return jsonError('So pode excluir pendente ou cancelada', 400, req);

      const { error } = await dbDelete('digitacao', { id });
      if (error) return jsonError('Erro ao excluir: ' + error, 500, req);
      return json({ ok: true, mensagem: 'Excluido' }, 200, req);
    }

    // ── STATS ─────────────────────────────────────────────────
    if (action === 'stats') {
      let qs = 'select=status&limit=1000';
      if (user.role === 'operador') qs += `&user_id=eq.${user.id}`;
      const { data } = await dbQuery('digitacao', qs);
      const counts = {};
      for (const r of (data || [])) { counts[r.status] = (counts[r.status] || 0) + 1; }
      return json({ ok: true, total: data?.length || 0, counts }, 200, req);
    }

    return jsonError('action invalida', 400, req);
  } catch (e) {
    return json({ error: 'Erro interno' }, 500, req);
  }
}

function buildRecord(body, userId) {
  return {
    user_id: userId,
    cpf: (body.cpf || '').replace(/\D/g, ''),
    nome: body.nome || null,
    beneficio: body.beneficio || null,
    tipo: body.tipo || null,
    banco: body.banco || 'MANUAL',
    status: body.status || 'pendente',
    contrato_origem: body.contrato_origem || null,
    banco_origem: body.banco_origem || null,
    parcela_origem: body.parcela_origem ? parseFloat(String(body.parcela_origem).replace(',', '.')) : null,
    saldo_devedor: body.saldo_devedor ? parseFloat(String(body.saldo_devedor).replace(',', '.')) : null,
    taxa_origem: body.taxa_origem ? parseFloat(String(body.taxa_origem).replace(',', '.')) : null,
    prazo_restante: body.prazo_restante ? parseInt(body.prazo_restante) : null,
    valor_operacao: body.valor_operacao ? parseFloat(String(body.valor_operacao).replace(',', '.')) : null,
    valor_parcela: body.valor_parcela ? parseFloat(String(body.valor_parcela).replace(',', '.')) : null,
    taxa_nova: body.taxa_nova ? parseFloat(String(body.taxa_nova).replace(',', '.')) : null,
    prazo_novo: body.prazo_novo ? parseInt(body.prazo_novo) : null,
    valor_troco: body.valor_troco ? parseFloat(String(body.valor_troco).replace(',', '.')) : null,
    codigo_tabela: body.codigo_tabela || null,
    codigo_af: body.codigo_af || null,
    id_simulador: body.id_simulador || null,
    simulation_id: body.simulation_id || null,
    loan_id: body.loan_id || null,
    url_formalizacao: body.url_formalizacao || null,
    dados_pessoais: body.dados_pessoais || null,
    dados_simulacao: body.dados_simulacao || null,
    observacoes: body.observacoes || null
  };
}
