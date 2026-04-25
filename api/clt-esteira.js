// ══════════════════════════════════════════════════════════════════
// api/clt-esteira.js — Esteira CLT: lista propostas dos 4 bancos
// Tabela única: clt_propostas
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';
import { dbQuery, dbInsert, dbUpdate, dbSelect } from './_lib/supabase.js';

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  try {
    const body = req.method === 'POST' ? await req.json() : {};
    const action = body.action || 'list';

    // ─── LIST: retorna propostas com filtros ──────────────────
    if (action === 'list') {
      const filters = body.filters || {};
      const limit = body.limit || 100;
      const orderBy = body.orderBy || 'created_at.desc';

      let qs = `select=*&order=${orderBy}&limit=${limit}`;
      if (filters.banco) qs += `&banco=eq.${encodeURIComponent(filters.banco)}`;
      if (filters.status_interno) qs += `&status_interno=eq.${encodeURIComponent(filters.status_interno)}`;
      if (filters.cpf) {
        const cpf = String(filters.cpf).replace(/\D/g, '').padStart(11, '0');
        qs += `&cpf=eq.${cpf}`;
      }
      if (filters.user_id) qs += `&criada_por_user_id=eq.${filters.user_id}`;
      if (filters.dataInicial) qs += `&created_at=gte.${encodeURIComponent(filters.dataInicial)}`;
      if (filters.dataFinal) qs += `&created_at=lte.${encodeURIComponent(filters.dataFinal)}`;

      const { data, error } = await dbQuery('clt_propostas', qs);
      if (error) {
        // Tabela pode nao existir ainda
        return jsonResp({
          success: false, propostas: [], total: 0,
          error: 'Erro ao consultar clt_propostas. Aplicou a migration supabase_migration_clt_propostas.sql?',
          _detail: error
        }, 200, req);
      }
      return jsonResp({ success: true, propostas: data || [], total: (data || []).length }, 200, req);
    }

    // ─── RESUMO: KPIs agregados ───────────────────────────────
    if (action === 'resumo') {
      const { data, error } = await dbQuery('clt_esteira_resumo', 'select=*');
      if (error) return jsonResp({ success: false, error }, 200, req);
      return jsonResp({ success: true, resumo: data || [] }, 200, req);
    }

    // ─── INSERIR proposta na esteira ──────────────────────────
    // Usado por outros handlers (c6/pb/jb/v8/agente) quando criam proposta
    if (action === 'inserir') {
      if (!body.banco || !body.cpf) return jsonError('banco e cpf obrigatorios', 400, req);
      const payload = {
        banco: body.banco,
        proposta_id_externo: body.proposta_id_externo || null,
        externo_simulation_id: body.externo_simulation_id || null,
        externo_consult_id: body.externo_consult_id || null,
        cpf: String(body.cpf).replace(/\D/g, '').padStart(11, '0'),
        nome: body.nome || null,
        telefone: body.telefone || null,
        email: body.email || null,
        data_nascimento: body.data_nascimento || null,
        nome_mae: body.nome_mae || null,
        empregador_cnpj: body.empregador_cnpj || null,
        empregador_nome: body.empregador_nome || null,
        matricula: body.matricula || null,
        renda: body.renda || null,
        valor_solicitado: body.valor_solicitado || null,
        valor_liquido: body.valor_liquido || null,
        valor_parcela: body.valor_parcela || null,
        qtd_parcelas: body.qtd_parcelas || null,
        taxa_mensal: body.taxa_mensal || null,
        cet_mensal: body.cet_mensal || null,
        iof: body.iof || null,
        status_externo: body.status_externo || null,
        status_interno: body.status_interno || 'criada',
        link_formalizacao: body.link_formalizacao || null,
        contract_number: body.contract_number || null,
        criada_por_user_id: body.criada_por_user_id || user.id,
        conversa_id: body.conversa_id || null,
        origem: body.origem || 'manual',
        vendedor_nome: body.vendedor_nome || user.nome_vendedor || null,
        parceiro_nome: body.parceiro_nome || user.nome_parceiro || null
      };
      const { data, error } = await dbInsert('clt_propostas', payload);
      if (error) return jsonResp({ success: false, error }, 400, req);
      return jsonResp({ success: true, proposta: data }, 200, req);
    }

    // ─── UPDATE STATUS ────────────────────────────────────────
    if (action === 'atualizarStatus') {
      if (!body.id) return jsonError('id obrigatorio', 400, req);
      const patch = {};
      if (body.status_interno) patch.status_interno = body.status_interno;
      if (body.status_externo) patch.status_externo = body.status_externo;
      if (body.link_formalizacao) patch.link_formalizacao = body.link_formalizacao;
      if (body.contract_number) patch.contract_number = body.contract_number;
      if (body.status_interno === 'paga') patch.paid_at = new Date().toISOString();
      if (body.status_interno === 'cancelada') patch.canceled_at = new Date().toISOString();
      const { data, error } = await dbUpdate('clt_propostas', { id: body.id }, patch);
      if (error) return jsonResp({ success: false, error }, 400, req);
      return jsonResp({ success: true, proposta: data }, 200, req);
    }

    return jsonError('action invalida. Disponiveis: list, resumo, inserir, atualizarStatus', 400, req);
  } catch (err) {
    return jsonResp({ error: 'Erro interno', message: err.message }, 500, req);
  }
}
