export const config = { runtime: 'edge' };

// ══════════════════════════════════════════════════════════════════
// api/crefisa-esteira.js — FOLLOW-UP da Esteira de Análise (Baixa Renda)
//
// Depois de digitada, a proposta anda na esteira da Crefisa até pagar ou
// cair. Este worker, por cron, confere as propostas DIGITADA, detecta
// mudança de situação, registra o histórico e avisa quem precisa agir.
//
// ⚠️ PEÇA A PLUGAR: `lerEsteira()` — o endpoint real da esteira ainda não
// foi mapeado (precisa do cookie do portal vivo pra ler o JS da tela
// EsteiraAnaliseContrato.asp). Enquanto ROTA_ESTEIRA for null, o worker
// não quebra: ele só reporta 'aguardando-mapeamento' e não faz nada.
// Quando o endpoint for confirmado, preenche ROTA_ESTEIRA e o resto já roda.
//
// Cron sugerido: 0 */3 * * * (de 3 em 3h). Env: APP_URL, WEBHOOK_SECRET,
// CREFISA_BR_ALERTA_WHATSAPP (número que recebe os avisos).
// ══════════════════════════════════════════════════════════════════

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';
import { dbInsert, dbUpdate, dbQuery } from './_lib/supabase.js';

const j = (data, status = 200, req = null) => jsonResp(data, status, req);
const APP_URL = () => (process.env.APP_URL || 'https://flowforce.vercel.app').replace(/\/+$/, '');
const agora = () => new Date().toISOString();

// ── Normaliza a situação crua da Crefisa num estágio do funil ─────
// Por palavra-chave: aguenta variação de texto sem precisar da lista exata.
// cada estágio diz se é final (para de conferir) e se merece aviso.
function classificarSituacao(bruto) {
  const s = String(bruto || '').toLowerCase();
  const tem = (...ks) => ks.some((k) => s.includes(k));

  if (tem('pago', 'paga', 'liberad', 'creditad', 'desembols')) {
    return { estagio: 'PAGA', final: true, avisar: 'sucesso', rotulo: 'Paga' };
  }
  if (tem('averbad', 'contrato efetiv', 'formaliz')) {
    return { estagio: 'FORMALIZADA', final: false, avisar: null, rotulo: 'Formalizada' };
  }
  if (tem('aprovad', 'deferid')) {
    return { estagio: 'APROVADA', final: false, avisar: null, rotulo: 'Aprovada' };
  }
  if (tem('pendent', 'pendência', 'pendencia', 'aguardando doc', 'documento')) {
    return { estagio: 'PENDENTE', final: false, avisar: 'pendencia', rotulo: 'Pendente' };
  }
  if (tem('cancelad', 'reprovad', 'recusad', 'indeferid', 'negad')) {
    return { estagio: 'CANCELADA', final: true, avisar: 'queda', rotulo: 'Cancelada/Reprovada' };
  }
  if (tem('anális', 'analise', 'em andamento', 'digitad')) {
    return { estagio: 'EM_ANALISE', final: false, avisar: null, rotulo: 'Em análise' };
  }
  return { estagio: 'OUTRO', final: false, avisar: null, rotulo: bruto || 'Situação desconhecida' };
}

// ── PEÇA A PLUGAR: leitura da esteira ─────────────────────────────
// Quando o endpoint estiver mapeado, troca ROTA_ESTEIRA e o parse abaixo.
// Deve retornar { ok, situacao, pendencia, contrato } pra um guid/cpf.
const ROTA_ESTEIRA = null; // ex: (guid) => `/captura/esteira/${guid}`

async function lerEsteira(item) {
  if (!ROTA_ESTEIRA) return { configurado: false };
  const r = await fetch(APP_URL() + '/api/crefisa-br', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.WEBHOOK_SECRET || '' },
    body: JSON.stringify({ action: 'rawCall', path: ROTA_ESTEIRA(item.guid || item.cpf), method: 'GET' }),
  }).then((x) => x.json()).catch(() => null);

  if (!r || r.data?._semSessao) return { configurado: true, ok: false, semSessao: true };
  const o = r.data?.objeto || r.data || {};
  return {
    configurado: true,
    ok: !!r.success,
    situacao: o.situacao || o.status || o.descricaoSituacao || null,
    pendencia: o.pendencia || o.motivoPendencia || o.observacao || null,
    contrato: o.numeroContrato || o.contrato || item.esteira_contrato || null,
  };
}

// ── Aviso no WhatsApp (via Evolution) ─────────────────────────────
async function avisar(texto) {
  const numero = (process.env.CREFISA_BR_ALERTA_WHATSAPP || '').trim();
  if (!numero) return false;
  await fetch(APP_URL() + '/api/evolution', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.WEBHOOK_SECRET || '' },
    body: JSON.stringify({ action: 'send', number: numero, text: texto }),
  }).catch(() => {});
  return true;
}

function montarAviso(item, cls, pendencia) {
  const cpf = String(item.cpf || '').replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  const quem = item.vendedor_nome ? ` (vendedor: ${item.vendedor_nome})` : '';
  const cliente = item.nome_cliente ? ` — ${item.nome_cliente}` : '';
  if (cls.avisar === 'pendencia') {
    return `⚠️ Baixa Renda — PENDÊNCIA\nCPF ${cpf}${cliente}${quem}\nMotivo: ${pendencia || 'ver na esteira da Crefisa'}`;
  }
  if (cls.avisar === 'queda') {
    return `❌ Baixa Renda — ${cls.rotulo}\nCPF ${cpf}${cliente}${quem}`;
  }
  if (cls.avisar === 'sucesso') {
    return `✅ Baixa Renda — PAGA\nCPF ${cpf}${cliente}${quem}`;
  }
  return null;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  // Auth: cron / interno / admin
  const cronSecret = process.env.CRON_SECRET;
  const cronAuth = req.headers.get('authorization') || '';
  const internalSecret = req.headers.get('x-internal-secret') || '';
  const webhookSecret = process.env.WEBHOOK_SECRET || '';
  const isVercelCron = cronSecret && cronAuth === `Bearer ${cronSecret}`;
  const isInternal = webhookSecret && internalSecret === webhookSecret;
  if (!isVercelCron && !isInternal) {
    const u = await requireAuth(req).catch(() => null);
    const ok = u && !(u instanceof Response) && (u.role === 'admin' || u.role === 'gestor' || u._internal);
    if (!ok) return jsonError('Não autorizado', 401, req);
  }

  try {
    if (!ROTA_ESTEIRA) {
      return j({
        success: true,
        pulou: 'aguardando-mapeamento',
        mensagem: 'Follow-up pronto — falta mapear o endpoint da Esteira de Análise (precisa do cookie do portal vivo). Preencher ROTA_ESTEIRA em api/crefisa-esteira.js.',
      }, 200, req);
    }

    // Propostas digitadas que ainda não finalizaram na esteira,
    // priorizando as que estão há mais tempo sem conferir.
    const { data: itens } = await dbQuery(
      'crefisa_fila',
      "status=eq.DIGITADA&esteira_finalizada=not.is.true&select=id,cpf,nome_cliente,vendedor_nome,user_id,parceiro_id,guid,esteira_situacao,esteira_contrato&order=esteira_conferida_em.asc.nullsfirst&limit=40",
    );
    const lista = Array.isArray(itens) ? itens : [];
    let conferidas = 0, mudancas = 0, avisos = 0;

    for (const item of lista) {
      const e = await lerEsteira(item);
      if (!e.configurado || !e.ok) continue;
      conferidas++;

      await dbUpdate('crefisa_fila', { id: item.id }, { esteira_conferida_em: agora() });
      if (!e.situacao) continue;

      const cls = classificarSituacao(e.situacao);
      const mudou = (item.esteira_situacao || '') !== e.situacao;
      if (!mudou) continue;
      mudancas++;

      await dbUpdate('crefisa_fila', { id: item.id }, {
        esteira_situacao: e.situacao,
        esteira_situacao_em: agora(),
        esteira_pendencia: cls.estagio === 'PENDENTE' ? (e.pendencia || null) : null,
        esteira_contrato: e.contrato || item.esteira_contrato || null,
        esteira_finalizada: cls.final,
      });

      const { data: ev } = await dbInsert('crefisa_esteira_evento', {
        fila_id: item.id, cpf: item.cpf, contrato: e.contrato || null,
        situacao_de: item.esteira_situacao || null, situacao_para: e.situacao,
        pendencia: cls.estagio === 'PENDENTE' ? (e.pendencia || null) : null,
        criado_em: agora(),
      });

      if (cls.avisar) {
        const texto = montarAviso(item, cls, e.pendencia);
        if (texto && await avisar(texto)) {
          avisos++;
          if (ev?.id) await dbUpdate('crefisa_esteira_evento', { id: ev.id }, { avisou_gestor: true });
        }
      }
    }

    return j({ success: true, conferidas, mudancas, avisos, total: lista.length }, 200, req);
  } catch (e) {
    return jsonError('Erro follow-up esteira: ' + e.message, 500, req);
  }
}
