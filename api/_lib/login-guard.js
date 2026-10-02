// ══════════════════════════════════════════════════════════════════
// api/_lib/login-guard.js — DISJUNTOR DE LOGIN por banco.
//
// Quando o banco recusa a credencial (401/403: senha errada, usuário inativo
// ou bloqueado), tentar de novo a cada chamada NÃO resolve e AGRAVA: a V8
// bloqueou o usuário por excesso de tentativas ("user is blocked") porque
// cada consulta refazia o login dezenas de vezes. Depois da recusa, o banco
// fica em pausa (default 30min): as chamadas falham na hora com o motivo
// claro, sem bater no login do banco.
//
// Estado em memória da instância + tabela healthcheck_estado (modulo
// 'login_<banco>') pra valer em todas as instâncias Edge.
// ══════════════════════════════════════════════════════════════════
import { dbSelect, dbUpsert } from './supabase.js';

const _mem = new Map(); // banco -> { ate, motivo, httpStatus, lidoEm }
const RELER_DB_MS = 5 * 60 * 1000;

function fmtHora(ms) {
  try { return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }); }
  catch { return new Date(ms).toISOString().slice(11, 16); }
}

export async function loginBloqueado(banco) {
  const agora = Date.now();
  let m = _mem.get(banco);
  if (!m || (m.ate <= agora && agora - (m.lidoEm || 0) > RELER_DB_MS)) {
    m = { ate: 0, lidoEm: agora };
    try {
      const { data } = await dbSelect('healthcheck_estado', { filters: { modulo: 'login_' + banco }, single: true });
      if (data?.status === 'down' && data?.detalhe) {
        try { m = { ...JSON.parse(data.detalhe), lidoEm: agora }; } catch { /* detalhe antigo */ }
      }
    } catch { /* tabela indisponível: segue sem bloqueio */ }
    _mem.set(banco, m);
  }
  if (m.ate > agora) {
    return { bloqueado: true, motivo: m.motivo || 'credencial recusada', httpStatus: m.httpStatus || 403, ate: m.ate, ateStr: fmtHora(m.ate) };
  }
  return { bloqueado: false };
}

export async function marcarLoginBloqueado(banco, motivo, minutos = 30, httpStatus = 403) {
  const agora = Date.now();
  const m = { ate: agora + minutos * 60 * 1000, motivo: String(motivo || 'credencial recusada').substring(0, 200), httpStatus, lidoEm: agora };
  _mem.set(banco, m);
  try {
    await dbUpsert('healthcheck_estado', {
      modulo: 'login_' + banco,
      label: 'Login ' + banco.toUpperCase(),
      status: 'down',
      detalhe: JSON.stringify({ ate: m.ate, motivo: m.motivo, httpStatus }),
      desde: new Date(agora).toISOString(),
      ultimo_check: new Date(agora).toISOString(),
    }, 'modulo');
  } catch { /* sem persistência: vale só nesta instância */ }
  return m;
}

export async function liberarLogin(banco) {
  const m = _mem.get(banco);
  const agora = Date.now();
  _mem.set(banco, { ate: 0, lidoEm: agora });
  if (!m || !m.ate) return;
  try {
    await dbUpsert('healthcheck_estado', {
      modulo: 'login_' + banco, label: 'Login ' + banco.toUpperCase(), status: 'ok', detalhe: null,
      desde: new Date(agora).toISOString(), ultimo_check: new Date(agora).toISOString(),
    }, 'modulo');
  } catch { /* ok */ }
}
