// ══════════════════════════════════════════════════════════════════
// api/clt-empresas-aprovadas.js
// CRUD + queries da tabela clt_empresas_aprovadas
//
// Actions:
//  - listar: lista paginada com filtros (banco, uf, busca)
//  - cpfsDessaEmpresa: retorna CPFs do CAGED por empregador_cnpj
//  - higienizarEmpresa: dispara consulta CLT em lote pros CPFs da empresa
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';
import { dbSelect, dbQuery } from './_lib/supabase.js';

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  if (req.method !== 'POST') return jsonError('POST only', 405, req);

  let body;
  try { body = await req.json(); } catch { body = {}; }
  const action = body.action || 'listar';

  // ─── LISTAR: empresas com filtros ────────────────────────────────
  if (action === 'listar') {
    const limit = Math.min(parseInt(body.limit) || 50, 200);
    const offset = parseInt(body.offset) || 0;
    const busca = (body.busca || '').trim();
    const banco = body.banco || null; // 'handbank' | 'joinbank' | 'presencabank' | null=todos
    const uf = body.uf || null;
    const orderBy = body.orderBy || 'total_aprovacoes'; // 'total_aprovacoes' | 'ultima_aprovacao_em' | 'empregador_nome'

    // Monta query string PostgREST
    const params = new URLSearchParams();
    params.set('select', '*');
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    // Order
    if (orderBy === 'empregador_nome') {
      params.set('order', 'empregador_nome.asc.nullslast');
    } else if (orderBy === 'ultima_aprovacao_em') {
      params.set('order', 'ultima_aprovacao_em.desc.nullslast');
    } else {
      params.set('order', 'total_aprovacoes.desc');
    }
    // Filtro UF
    if (uf) params.append('uf', `eq.${uf}`);
    // Filtro banco — usa contém JSONB
    if (banco) params.append('bancos_aprovam', `cs.[{"banco":"${banco}"}]`);
    // Filtro busca: nome OR cnpj
    if (busca) {
      const cnpjBusca = busca.replace(/\D/g, '');
      if (cnpjBusca && cnpjBusca.length >= 4) {
        params.append('or', `(empregador_nome.ilike.*${busca}*,cnpj.ilike.*${cnpjBusca}*)`);
      } else {
        params.append('empregador_nome', `ilike.*${busca}*`);
      }
    }

    const { data, error } = await dbQuery('clt_empresas_aprovadas', params.toString());
    if (error) return jsonError(error, 500, req);

    // Pra cada empresa, conta quantos CPFs existem no CAGED dessa empresa
    // (Limita a 1 query agregada pra todos os CNPJs de uma vez)
    const cnpjs = (data || []).map(e => e.cnpj).filter(Boolean);
    let cagedCounts = {};
    if (cnpjs.length > 0) {
      // PostgREST nao tem GROUP BY direto. Usa supabase RPC ou query manual.
      // Por simplicidade, faz N queries (max 50 — ok pra paginacao). TODO: rpc.
      const r = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/clt_base_funcionarios?select=empregador_cnpj&empregador_cnpj=in.(${cnpjs.join(',')})&limit=10000`,
        { headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_KEY } }
      );
      if (r.ok) {
        const rows = await r.json();
        for (const row of rows) {
          const c = row.empregador_cnpj;
          cagedCounts[c] = (cagedCounts[c] || 0) + 1;
        }
      }
    }

    const empresas = (data || []).map(e => ({
      ...e,
      cpfs_no_caged: cagedCounts[e.cnpj] || 0
    }));

    return jsonResp({
      success: true,
      total: empresas.length,
      offset, limit,
      empresas
    }, 200, req);
  }

  // ─── CPFS DESSA EMPRESA: lista CPFs do CAGED por CNPJ empregador ─
  // Use pra higienizar em massa: pega CPFs ATIVOS (sem demissao) do CAGED 2024
  // que trabalharam pra esse empregador.
  if (action === 'cpfsDessaEmpresa') {
    const cnpj = (body.cnpj || '').replace(/\D/g, '');
    if (!cnpj || cnpj.length < 8) return jsonError('cnpj obrigatorio', 400, req);
    const limit = Math.min(parseInt(body.limit) || 1000, 10000);
    const apenasAtivos = body.apenasAtivos !== false; // default true

    const params = new URLSearchParams();
    params.set('select', 'cpf,nome,sexo,data_nascimento,ddd,telefone,email,data_admissao,data_demissao,ativo,cbo,cidade,uf');
    params.append('empregador_cnpj', `eq.${cnpj}`);
    if (apenasAtivos) params.append('ativo', 'eq.true');
    params.set('order', 'data_admissao.desc.nullslast');
    params.set('limit', String(limit));

    const { data, error } = await dbQuery('clt_base_funcionarios', params.toString());
    if (error) return jsonError(error, 500, req);

    return jsonResp({
      success: true,
      cnpj,
      total: (data || []).length,
      apenasAtivos,
      cpfs: data || []
    }, 200, req);
  }

  // ─── DETALHE de uma empresa específica ───────────────────────────
  if (action === 'detalhe') {
    const cnpj = (body.cnpj || '').replace(/\D/g, '');
    if (!cnpj) return jsonError('cnpj obrigatorio', 400, req);
    const { data: emp } = await dbSelect('clt_empresas_aprovadas', {
      filters: { cnpj }, single: true
    });
    if (!emp) return jsonResp({ success: false, mensagem: 'Empresa não encontrada' }, 404, req);

    // Conta CPFs no CAGED + uma amostra
    const params = new URLSearchParams();
    params.set('select', 'cpf,nome,ativo,data_admissao,data_demissao');
    params.append('empregador_cnpj', `eq.${cnpj}`);
    params.set('order', 'data_admissao.desc.nullslast');
    params.set('limit', '20');
    const { data: amostra } = await dbQuery('clt_base_funcionarios', params.toString());

    return jsonResp({
      success: true,
      empresa: emp,
      amostraCpfs: amostra || []
    }, 200, req);
  }

  return jsonError(`Action invalida: ${action}. Validas: listar, detalhe, cpfsDessaEmpresa`, 400, req);
}
