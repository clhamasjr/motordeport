// ══════════════════════════════════════════════════════════════════
// api/clt-painel-consultas.js
// Painel de consultas CLT — agregacoes pra dashboard:
// - Total de consultas (hoje, semana, mes)
// - Consultas por operador (quem mais consultou)
// - Oportunidades geradas (clientes elegiveis em pelo menos 1 banco)
// - Conversao por operador (consulta → oferta disponivel)
// - Bancos mais elegiveis no periodo
// - Lista de consultas com filtros
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';
import { dbQuery } from './_lib/supabase.js';

const SUPA_URL = () => process.env.SUPABASE_URL;
const SUPA_KEY = () => process.env.SUPABASE_SERVICE_KEY;

// Roda SQL custom via PostgREST RPC seria ideal, mas usamos fetch direto
// pra ter agregacao com SQL nativo
async function runSql(sql) {
  // PostgREST nao executa SQL bruto. Vou usar dbSelect com filtros parametrizados
  // OU criar uma function PL/pgSQL no banco. Pra MVP, vou agregar em memoria
  // a partir de SELECT * com filtros de periodo.
  return null;
}

// Busca consultas no periodo (ultimas N consultas, ate 500)
// Aplica isolamento multi-tenant:
//  - admin                             → ve tudo
//  - gestor SEM parceiro_id (casa)     → ve tudo
//  - gestor COM parceiro_id (hospedado)→ ve so do proprio parceiro
//  - operador                          → ve so as proprias consultas
async function fetchConsultas(filtros = {}, user = {}) {
  const url = SUPA_URL();
  const key = SUPA_KEY();
  let query = `${url}/rest/v1/clt_consultas_fila?select=id,cpf,nome_manual,status_geral,bancos,cliente,vinculo,ofertas_count,iniciado_em,concluido_em,criada_por_user_id,criada_por_nome,parceiro_id&order=iniciado_em.desc&limit=500`;
  if (filtros.desdeISO) query += `&iniciado_em=gte.${encodeURIComponent(filtros.desdeISO)}`;

  // Filtro de isolamento por role
  const role = user.role || 'operador';
  if (role === 'admin' || (role === 'gestor' && !user.parceiro_id)) {
    // admin/gestor-da-casa: sem filtro adicional
  } else if (role === 'gestor' && user.parceiro_id) {
    // gestor de parceiro hospedado: filtra por parceiro
    query += `&parceiro_id=eq.${user.parceiro_id}`;
  } else {
    // operador (ou qualquer outro role): so as proprias consultas
    query += `&criada_por_user_id=eq.${user.id || 0}`;
  }

  // Filtro adicional opcional (admin/gestor pode escolher ver de 1 user especifico)
  if (filtros.userId) query += `&criada_por_user_id=eq.${filtros.userId}`;

  const r = await fetch(query, { headers: { apikey: key, Authorization: `Bearer ${key}` }});
  if (!r.ok) return [];
  return await r.json();
}

// Conta ofertas disponiveis num registro
function contarBancosDisponiveis(bancos) {
  if (!bancos) return 0;
  let n = 0;
  for (const k of ['presencabank', 'multicorban', 'v8_qi', 'v8_celcoin', 'joinbank', 'mercantil', 'handbank', 'c6']) {
    if (bancos[k]?.disponivel === true) n++;
  }
  return n;
}

function ehOportunidade(bancos) {
  return contarBancosDisponiveis(bancos) > 0;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);
  const user = await requireAuth(req);
  if (user instanceof Response) return user;
  if (req.method !== 'POST') return jsonError('POST only', 405, req);

  let body;
  try { body = await req.json(); } catch { body = {}; }
  const action = body.action || 'resumo';

  // ─── RESUMO ─── agregacoes gerais (cards do dashboard)
  if (action === 'resumo') {
    const periodo = body.periodo || 'mes'; // hoje | semana | mes
    let desdeISO;
    const agora = new Date();
    if (periodo === 'hoje') {
      const d = new Date(agora); d.setHours(0,0,0,0);
      desdeISO = d.toISOString();
    } else if (periodo === 'semana') {
      const d = new Date(agora); d.setDate(d.getDate() - 7);
      desdeISO = d.toISOString();
    } else {
      const d = new Date(agora); d.setDate(d.getDate() - 30);
      desdeISO = d.toISOString();
    }

    const consultas = await fetchConsultas({ desdeISO }, user);

    // Agregacoes
    const total = consultas.length;
    const concluidas = consultas.filter(c => c.status_geral === 'concluido').length;
    const oportunidades = consultas.filter(c => ehOportunidade(c.bancos)).length;
    const taxaOportunidade = total > 0 ? (oportunidades / total * 100).toFixed(1) : 0;

    // Por operador
    const porOperador = {};
    for (const c of consultas) {
      const uid = c.criada_por_user_id || 0;
      const nome = c.criada_por_nome || (uid === 0 ? 'Sistema/API' : `User #${uid}`);
      if (!porOperador[uid]) porOperador[uid] = { user_id: uid, nome, total: 0, oportunidades: 0, concluidas: 0 };
      porOperador[uid].total++;
      if (ehOportunidade(c.bancos)) porOperador[uid].oportunidades++;
      if (c.status_geral === 'concluido') porOperador[uid].concluidas++;
    }
    const operadores = Object.values(porOperador).map(o => ({
      ...o,
      taxa_oportunidade: o.total > 0 ? +(o.oportunidades / o.total * 100).toFixed(1) : 0
    })).sort((a, b) => b.total - a.total);

    // Por banco — quantos clientes elegiveis em cada um
    const porBanco = { presencabank: 0, multicorban: 0, v8_qi: 0, v8_celcoin: 0, joinbank: 0, mercantil: 0, handbank: 0, c6: 0 };
    for (const c of consultas) {
      for (const k of Object.keys(porBanco)) {
        if (c.bancos?.[k]?.disponivel === true) porBanco[k]++;
      }
    }

    // Funil
    const semVinculo = consultas.filter(c => !ehOportunidade(c.bancos)).length;

    return jsonResp({
      success: true,
      periodo,
      desdeISO,
      kpis: {
        total,
        concluidas,
        oportunidades,
        taxa_oportunidade_pct: +taxaOportunidade,
        sem_vinculo: semVinculo
      },
      operadores,
      por_banco: porBanco
    }, 200, req);
  }

  // ─── LISTAR ─── lista detalhada de consultas com filtros
  if (action === 'listar') {
    const periodo = body.periodo || 'mes';
    const userId = body.user_id || null;
    let desdeISO;
    const agora = new Date();
    if (periodo === 'hoje') { const d = new Date(agora); d.setHours(0,0,0,0); desdeISO = d.toISOString(); }
    else if (periodo === 'semana') { const d = new Date(agora); d.setDate(d.getDate() - 7); desdeISO = d.toISOString(); }
    else { const d = new Date(agora); d.setDate(d.getDate() - 30); desdeISO = d.toISOString(); }

    const consultas = await fetchConsultas({ desdeISO, userId }, user);
    const lista = consultas.map(c => ({
      id: c.id,
      cpf: c.cpf,
      nome: c.cliente?.nome || c.nome_manual || '(sem nome)',
      status_geral: c.status_geral,
      iniciado_em: c.iniciado_em,
      concluido_em: c.concluido_em,
      operador_id: c.criada_por_user_id,
      operador_nome: c.criada_por_nome || (c.criada_por_user_id ? `User #${c.criada_por_user_id}` : 'Sistema'),
      bancos_disponiveis: contarBancosDisponiveis(c.bancos),
      empregador: c.vinculo?.empregador || c.bancos?.joinbank?.dados?.empregador || c.bancos?.presencabank?.dados?.empregador || null,
      eh_oportunidade: ehOportunidade(c.bancos),
      bancos_status: {
        pb: c.bancos?.presencabank?.status,
        mc: c.bancos?.multicorban?.status,
        qi: c.bancos?.v8_qi?.status,
        cc: c.bancos?.v8_celcoin?.status,
        jb: c.bancos?.joinbank?.status,
        mer: c.bancos?.mercantil?.status,
        c6: c.bancos?.c6?.status
      }
    }));
    return jsonResp({ success: true, total: lista.length, items: lista }, 200, req);
  }

  return jsonError('action invalida. Validas: resumo, listar', 400, req);
}
