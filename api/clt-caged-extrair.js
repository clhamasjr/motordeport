// ══════════════════════════════════════════════════════════════════
// api/clt-caged-extrair.js
// Extrair / filtrar a base CAGED 2024 (43.6M CPFs) com filtros operacionais.
//
// Actions:
//  - contar: aplica filtros e retorna só o count (preview rápido)
//  - listar: aplica filtros e retorna primeiros N CPFs paginados
//  - exportarCsv: retorna CSV pronto pra download (max 50k linhas)
//  - higienizarLote: dispara consulta CLT em lote pros CPFs filtrados
//
// Filtros suportados:
//  - uf (estado), cidade (ilike), idade_min, idade_max, sexo (M/F)
//  - empregador_cnpj (exato), empregador_nome (ilike)
//  - cbo (exato ou ilike), cnae (exato ou ilike)
//  - tempo_empresa_min_meses, ativo (true/false), tem_telefone, tem_email
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';

const SUPA_URL = () => process.env.SUPABASE_URL;
const SUPA_KEY = () => process.env.SUPABASE_SERVICE_KEY;

// Monta filtros PostgREST a partir do body
function montarFiltros(body) {
  const params = new URLSearchParams();
  // CPF (eq exato OR in() pra batch lookup do v2 Analise em Lote)
  if (body.cpf) {
    const c = String(body.cpf).replace(/\D/g, '').padStart(11, '0').slice(-11);
    if (c.length === 11) params.append('cpf', `eq.${c}`);
  }
  if (Array.isArray(body.cpfs) && body.cpfs.length > 0) {
    const cs = body.cpfs.map((x) => String(x).replace(/\D/g, '').padStart(11, '0').slice(-11)).filter((x) => x.length === 11);
    if (cs.length) params.append('cpf', `in.(${cs.join(',')})`);
  }
  if (body.uf) params.append('uf', `eq.${body.uf.toUpperCase()}`);
  if (body.cidade) params.append('cidade', `ilike.*${body.cidade}*`);
  if (body.empregador_cnpj) {
    const cnpj = String(body.empregador_cnpj).replace(/\D/g, '');
    if (cnpj.length >= 8) params.append('empregador_cnpj', `eq.${cnpj}`);
  }
  if (body.empregador_nome) params.append('empregador_nome', `ilike.*${body.empregador_nome}*`);
  if (body.cbo) params.append('cbo', `eq.${body.cbo}`);
  if (body.cnae) params.append('cnae', `eq.${body.cnae}`);
  if (body.sexo === 'M' || body.sexo === 'F') params.append('sexo', `eq.${body.sexo}`);
  if (body.ativo === true) params.append('ativo', 'eq.true');
  if (body.ativo === false) params.append('ativo', 'eq.false');
  // Idade → faixa de data_nascimento
  if (body.idade_min || body.idade_max) {
    const hoje = new Date();
    if (body.idade_min) {
      const dMax = new Date(hoje); dMax.setFullYear(dMax.getFullYear() - parseInt(body.idade_min));
      params.append('data_nascimento', `lte.${dMax.toISOString().substring(0, 10)}`);
    }
    if (body.idade_max) {
      const dMin = new Date(hoje); dMin.setFullYear(dMin.getFullYear() - parseInt(body.idade_max) - 1);
      params.append('data_nascimento', `gte.${dMin.toISOString().substring(0, 10)}`);
    }
  }
  // Tempo na empresa → data_admissao
  if (body.tempo_empresa_min_meses) {
    const meses = parseInt(body.tempo_empresa_min_meses);
    const dMax = new Date(); dMax.setMonth(dMax.getMonth() - meses);
    params.append('data_admissao', `lte.${dMax.toISOString().substring(0, 10)}`);
  }
  // Tem telefone (ddd + telefone preenchidos)
  if (body.tem_telefone === true) {
    params.append('ddd', 'not.is.null');
    params.append('telefone', 'not.is.null');
  }
  // Tem email
  if (body.tem_email === true) {
    params.append('email', 'not.is.null');
  }
  return params;
}

// Headers PostgREST com count strategy
function headers(countMode) {
  const h = {
    apikey: SUPA_KEY(),
    Authorization: `Bearer ${SUPA_KEY()}`
  };
  if (countMode) h['Prefer'] = `count=${countMode}`;
  return h;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);
  const user = await requireAuth(req);
  if (user instanceof Response) return user;
  if (req.method !== 'POST') return jsonError('POST only', 405, req);

  // Apenas admin/gestor podem extrair (operador não baixa base nacional)
  const role = user.role || 'operador';
  if (role !== 'admin' && role !== 'gestor') {
    return jsonError('Sem permissão. Apenas admin/gestor podem extrair base.', 403, req);
  }

  let body;
  try { body = await req.json(); } catch { body = {}; }
  const action = body.action || 'contar';

  // ─── CONTAR: só count (rápido com count=planned, exato com count=exact) ─
  if (action === 'contar') {
    const params = montarFiltros(body);
    params.set('select', 'cpf');
    params.set('limit', '1');
    const exato = body.exato === true;
    const r = await fetch(
      `${SUPA_URL()}/rest/v1/clt_base_funcionarios?${params.toString()}`,
      { method: 'HEAD', headers: headers(exato ? 'exact' : 'planned') }
    );
    // Content-Range: 0-0/N
    const cr = r.headers.get('content-range') || '';
    const m = cr.match(/\/(\d+|\*)$/);
    const total = m ? (m[1] === '*' ? null : parseInt(m[1])) : null;
    return jsonResp({
      success: true,
      total,
      modo: exato ? 'exato' : 'estimado',
      filtros: body
    }, 200, req);
  }

  // ─── LISTAR: amostra paginada (max 1000 por chamada) ───────────────
  if (action === 'listar') {
    const params = montarFiltros(body);
    const limit = Math.min(parseInt(body.limit) || 200, 1000);
    const offset = parseInt(body.offset) || 0;
    params.set('select', 'cpf,nome,sexo,data_nascimento,empregador_cnpj,empregador_nome,cbo,data_admissao,ativo,cidade,uf,ddd,telefone,email');
    params.set('order', 'data_admissao.desc.nullslast');
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    const r = await fetch(
      `${SUPA_URL()}/rest/v1/clt_base_funcionarios?${params.toString()}`,
      { headers: headers() }
    );
    if (!r.ok) {
      const t = await r.text();
      return jsonError('Erro consultando CAGED: ' + t.substring(0, 200), 500, req);
    }
    const data = await r.json();
    return jsonResp({
      success: true,
      total_pagina: data.length,
      offset, limit,
      cpfs: data
    }, 200, req);
  }

  // ─── EXPORTAR CSV: download direto (max 50k linhas) ────────────────
  if (action === 'exportarCsv') {
    const params = montarFiltros(body);
    const limit = Math.min(parseInt(body.limit) || 10000, 50000);
    params.set('select', 'cpf,nome,sexo,data_nascimento,empregador_cnpj,empregador_nome,cbo,data_admissao,data_demissao,ativo,cidade,uf,cidade_empresa,ddd,telefone,email,cnae');
    params.set('order', 'data_admissao.desc.nullslast');
    params.set('limit', String(limit));
    const r = await fetch(
      `${SUPA_URL()}/rest/v1/clt_base_funcionarios?${params.toString()}`,
      { headers: { ...headers(), 'Accept': 'text/csv' } }
    );
    if (!r.ok) {
      const t = await r.text();
      return jsonError('Erro exportando CSV: ' + t.substring(0, 200), 500, req);
    }
    const csv = await r.text();
    // Retorna como JSON pra UI baixar (alternativa: stream direto, mas
    // edge precisa do download trigger no front)
    return jsonResp({
      success: true,
      filename: `caged-extrair-${new Date().toISOString().substring(0, 10)}.csv`,
      total_linhas: csv.split('\n').length - 1,
      csv
    }, 200, req);
  }

  // ─── HIGIENIZAR LOTE: dispara consulta CLT pros CPFs filtrados ─────
  // Esse endpoint apenas retorna o BATCH de CPFs. O front itera e chama
  // /api/clt-fila pra cada um (mesma lógica que clt-empresas-aprovadas).
  if (action === 'higienizarLote') {
    const params = montarFiltros(body);
    const limit = Math.min(parseInt(body.limit) || 1000, 5000);
    params.set('select', 'cpf,nome,sexo,data_nascimento,ddd,telefone,email,empregador_cnpj,empregador_nome');
    params.set('order', 'data_admissao.desc.nullslast');
    params.set('limit', String(limit));
    const r = await fetch(
      `${SUPA_URL()}/rest/v1/clt_base_funcionarios?${params.toString()}`,
      { headers: headers() }
    );
    if (!r.ok) {
      const t = await r.text();
      return jsonError('Erro buscando CPFs: ' + t.substring(0, 200), 500, req);
    }
    const cpfs = await r.json();
    return jsonResp({
      success: true,
      total: cpfs.length,
      cpfs
    }, 200, req);
  }

  return jsonError(`Action invalida: ${action}. Validas: contar, listar, exportarCsv, higienizarLote`, 400, req);
}
