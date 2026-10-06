export const config = { runtime: 'edge' };

// ══════════════════════════════════════════════════════════════════
// api/crefisa-fila.js — BUFFER SERIAL de digitação Crefisa Baixa Renda
//
// A Crefisa aceita UM login por vez (sessão única compartilhada, alimentada
// pelo robô). Consulta e simulação podem rodar em paralelo nessa sessão —
// mas DIGITAÇÃO não pode colidir. Então cada vendedor ENFILEIRA a proposta
// e um worker processa UMA DE CADA VEZ, protegido por uma trava.
//
// Actions:
//   enfileirar      - vendedor joga uma proposta pronta na fila (status NA_FILA)
//   minhaFila       - lista a fila conforme o papel (vendedor/gestor/admin)
//   producao        - produção por vendedor (visão do gestor da loja)
//   cancelar        - cancela um item ainda não processado
//   processar       - WORKER: pega o próximo, digita na sessão única, atualiza
//   status          - contadores por status (painel)
//
// O worker delega a digitação ao /api/crefisa-br (action: digitar) via
// x-internal-secret — não duplica a lógica de proposta.
//
// Cron sugerido: */1 7-23 * * * (respeita horário da Crefisa). Env: APP_URL,
// WEBHOOK_SECRET.
// ══════════════════════════════════════════════════════════════════

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';
import { dbInsert, dbUpdate, dbQuery } from './_lib/supabase.js';

const j = (data, status = 200, req = null) => jsonResp(data, status, req);
const onlyDigits = (s) => String(s || '').replace(/\D/g, '');
const APP_URL = () => (process.env.APP_URL || 'https://flowforce.vercel.app').replace(/\/+$/, '');
const agora = () => new Date().toISOString();

// Horário comercial da Crefisa (America/Sao_Paulo, UTC-3): 7h–23h
function dentroDoHorario() {
  const h = (new Date().getUTCHours() - 3 + 24) % 24;
  return h >= 7 && h < 23;
}

// ── Trava da sessão única (crefisa_lock, singleton id=1) ──────────
// Adquire se estiver livre OU se o dono anterior expirou (worker caiu).
async function adquirirLock(dono, segundos = 120) {
  const expira = new Date(Date.now() + segundos * 1000).toISOString();
  // PATCH condicional: só pega se dono is null OU expira_em < agora
  const url = `crefisa_lock?id=eq.1&or=(dono.is.null,expira_em.lt.${encodeURIComponent(agora())})`;
  const { data, error } = await dbPatchRaw(url, { dono, expira_em: expira, atualizado_em: agora() });
  if (error) return false;
  return Array.isArray(data) && data.length > 0; // retornou linha = pegou a trava
}
async function liberarLock(dono) {
  await dbUpdate('crefisa_lock', { id: 1, dono }, { dono: null, expira_em: null, atualizado_em: agora() }).catch(() => {});
}
// PATCH cru com filtro composto (dbUpdate só faz eq simples)
async function dbPatchRaw(queryString, data) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const r = await fetch(`${base}/rest/v1/${queryString}`, {
    method: 'PATCH',
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: JSON.stringify(data),
  });
  if (!r.ok) return { error: await r.text(), data: null };
  return { error: null, data: await r.json() };
}

// ── Chama o /api/crefisa-br internamente (digitação) ──────────────
async function digitarInterno(payload) {
  const r = await fetch(APP_URL() + '/api/crefisa-br', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.WEBHOOK_SECRET || '' },
    body: JSON.stringify({ action: 'digitar', ...payload }),
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 800) }; }
  return { httpOk: r.ok, status: r.status, data: d };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  // Auth: usuário logado OU cron/interno (pro worker)
  const cronSecret = process.env.CRON_SECRET;
  const cronAuth = req.headers.get('authorization') || '';
  const internalSecret = req.headers.get('x-internal-secret') || '';
  const webhookSecret = process.env.WEBHOOK_SECRET || '';
  const isVercelCron = cronSecret && cronAuth === `Bearer ${cronSecret}`;
  const isInternal = webhookSecret && internalSecret === webhookSecret;

  let user = null;
  if (!isVercelCron && !isInternal) {
    user = await requireAuth(req);
    if (user instanceof Response) return user;
  }

  let body;
  try { body = req.method === 'POST' ? await req.json() : {}; } catch { body = {}; }
  const action = body.action || (isVercelCron ? 'processar' : 'minhaFila');

  try {
    // ── Vendedor enfileira uma proposta pronta ───────────────────
    if (action === 'enfileirar') {
      const cpf = onlyDigits(body.cpf);
      if (cpf.length !== 11) return jsonError('cpf obrigatorio (11 digitos)', 400, req);
      if (!body.payload || typeof body.payload !== 'object') {
        return jsonError('payload da proposta obrigatorio', 400, req);
      }
      // Não enfileira o mesmo CPF duas vezes se já tem um em aberto
      const { data: abertos } = await dbQuery(
        'crefisa_fila',
        `cpf=eq.${cpf}&status=in.(NA_FILA,PROCESSANDO)&select=id`,
      );
      if (Array.isArray(abertos) && abertos.length) {
        return j({ success: false, jaNaFila: true, mensagem: 'Esse CPF já está na fila' }, 200, req);
      }
      const { data, error } = await dbInsert('crefisa_fila', {
        cpf,
        nome_cliente: body.nomeCliente || body.payload?.nomeCompleto || body.payload?.cliente?.nome || null,
        telefone: onlyDigits(body.telefone) || null,
        status: 'NA_FILA',
        user_id: user?.id ?? body.userId ?? null,
        vendedor_nome: user?.nome_vendedor || user?.name || body.vendedorNome || null,
        parceiro_id: user?.parceiro_id ?? body.parceiroId ?? null,
        payload: body.payload,
        prioridade: body.prioridade || 0,
        criado_em: agora(),
        atualizado_em: agora(),
      });
      if (error) return jsonError('Erro ao enfileirar: ' + error, 500, req);
      const posicao = await posicaoNaFila(data.id);
      return j({ success: true, id: data.id, posicao, mensagem: `✅ Na fila — posição ${posicao}` }, 200, req);
    }

    // ── Lista a fila conforme o papel ────────────────────────────
    //   admin    → tudo
    //   gestor   → tudo da loja dele (parceiro_id)
    //   operador → só o que ele mesmo lançou
    if (action === 'minhaFila') {
      const escopo = escopoDoUsuario(user);
      let q = 'select=id,cpf,nome_cliente,telefone,status,mensagem,vendedor_nome,user_id,parceiro_id,guid,criado_em,processado_em&order=criado_em.desc&limit=200';
      if (escopo.tipo === 'loja') q += `&parceiro_id=eq.${escopo.parceiroId}`;
      else if (escopo.tipo === 'proprio') q += `&user_id=eq.${escopo.userId}`;
      const { data } = await dbQuery('crefisa_fila', q);
      return j({ success: true, escopo: escopo.tipo, itens: data || [] }, 200, req);
    }

    // ── Cancela item ainda não processado ────────────────────────
    if (action === 'cancelar') {
      if (!body.id) return jsonError('id obrigatorio', 400, req);
      const { data } = await dbQuery('crefisa_fila', `id=eq.${body.id}&select=user_id,parceiro_id,status`, { single: true });
      if (!data) return jsonError('item não encontrado', 404, req);
      if (!podeMexer(user, data)) return jsonError('esse item não é da sua carteira', 403, req);
      if (data.status !== 'NA_FILA') return jsonError(`não dá pra cancelar (status ${data.status})`, 400, req);
      await dbUpdate('crefisa_fila', { id: body.id }, { status: 'CANCELADA', atualizado_em: agora() });
      return j({ success: true, mensagem: 'Cancelado' }, 200, req);
    }

    // ── Produção por vendedor (visão do gestor da loja) ──────────
    // Gestor vê a loja dele; admin vê tudo (ou filtra por loja).
    // Vendedor comum não acessa — é visão de gestão.
    if (action === 'producao') {
      const escopo = escopoDoUsuario(user);
      if (escopo.tipo === 'proprio') {
        return jsonError('Visão de produção é do gestor da loja', 403, req);
      }
      const dias = Math.min(Math.max(parseInt(body.dias || 30), 1), 180);
      const desde = new Date(Date.now() - dias * 86400000).toISOString();

      let q = `criado_em=gte.${encodeURIComponent(desde)}&select=user_id,vendedor_nome,parceiro_id,status,payload,criado_em&order=criado_em.desc&limit=3000`;
      if (escopo.tipo === 'loja') q += `&parceiro_id=eq.${escopo.parceiroId}`;
      else if (body.parceiroId) q += `&parceiro_id=eq.${parseInt(body.parceiroId)}`;

      const { data, error } = await dbQuery('crefisa_fila', q);
      if (error) return jsonError('Erro ao ler produção: ' + error, 500, req);
      const linhas = Array.isArray(data) ? data : [];

      const valorDe = (p) => Number(p?.operacao?.valorPrincipal) || 0;
      const porVendedor = new Map();
      const total = { propostas: 0, digitadas: 0, naFila: 0, erros: 0, canceladas: 0, valorDigitado: 0 };

      for (const r of linhas) {
        const chave = r.user_id ?? `nome:${r.vendedor_nome || '—'}`;
        if (!porVendedor.has(chave)) {
          porVendedor.set(chave, {
            userId: r.user_id ?? null,
            vendedor: r.vendedor_nome || 'Sem nome',
            propostas: 0, digitadas: 0, naFila: 0, erros: 0, canceladas: 0, valorDigitado: 0,
          });
        }
        const v = porVendedor.get(chave);
        v.propostas++; total.propostas++;
        if (r.status === 'DIGITADA') {
          v.digitadas++; total.digitadas++;
          const val = valorDe(r.payload);
          v.valorDigitado += val; total.valorDigitado += val;
        } else if (r.status === 'ERRO') { v.erros++; total.erros++; }
        else if (r.status === 'CANCELADA') { v.canceladas++; total.canceladas++; }
        else { v.naFila++; total.naFila++; } // NA_FILA ou PROCESSANDO
      }

      // Taxa de êxito = digitadas / (digitadas + erros) — ignora o que ainda
      // está na fila, senão o número oscila só por causa do tempo de espera.
      const comTaxa = [...porVendedor.values()].map((v) => ({
        ...v,
        taxaExito: (v.digitadas + v.erros) > 0 ? Math.round((v.digitadas / (v.digitadas + v.erros)) * 100) : null,
        ticketMedio: v.digitadas > 0 ? Math.round((v.valorDigitado / v.digitadas) * 100) / 100 : 0,
      })).sort((a, b) => b.digitadas - a.digitadas || b.propostas - a.propostas);

      return j({
        success: true,
        escopo: escopo.tipo,
        dias,
        desde,
        total: {
          ...total,
          taxaExito: (total.digitadas + total.erros) > 0
            ? Math.round((total.digitadas / (total.digitadas + total.erros)) * 100) : null,
          ticketMedio: total.digitadas > 0 ? Math.round((total.valorDigitado / total.digitadas) * 100) / 100 : 0,
        },
        vendedores: comTaxa,
      }, 200, req);
    }

    // ── Contadores (painel) ──────────────────────────────────────
    if (action === 'status') {
      const { data } = await dbQuery('crefisa_fila', 'select=status');
      const cont = {};
      for (const r of (data || [])) cont[r.status] = (cont[r.status] || 0) + 1;
      return j({ success: true, contadores: cont, horarioAberto: dentroDoHorario() }, 200, req);
    }

    // ── WORKER: processa a próxima da fila (uma por vez) ─────────
    if (action === 'processar') {
      if (!dentroDoHorario()) {
        return j({ success: true, pulou: 'fora-do-horario', mensagem: 'Fora da janela 7h–23h da Crefisa' }, 200, req);
      }
      const pegou = await adquirirLock('worker-fila', 150);
      if (!pegou) {
        return j({ success: true, pulou: 'ocupado', mensagem: 'Já tem uma digitação em andamento' }, 200, req);
      }
      try {
        // Próximo NA_FILA, por prioridade e ordem de chegada
        const { data: fila } = await dbQuery(
          'crefisa_fila',
          'status=eq.NA_FILA&order=prioridade.desc,criado_em.asc&limit=1',
        );
        const item = Array.isArray(fila) ? fila[0] : null;
        if (!item) return j({ success: true, vazio: true, mensagem: 'Fila vazia' }, 200, req);

        await dbUpdate('crefisa_fila', { id: item.id }, {
          status: 'PROCESSANDO', iniciado_em: agora(), atualizado_em: agora(),
          tentativas: (item.tentativas || 0) + 1,
        });

        const r = await digitarInterno(item.payload);
        const ok = r.httpOk && r.data?.success && r.data?.etapa === 'DIGITADA';

        await dbUpdate('crefisa_fila', { id: item.id }, {
          status: ok ? 'DIGITADA' : 'ERRO',
          mensagem: r.data?.mensagem || (ok ? 'Digitada' : 'Falha na digitação'),
          resultado: r.data || null,
          guid: r.data?.guid || null,
          erro_ultimo: ok ? null : (r.data?.mensagem || `HTTP ${r.status}`),
          processado_em: agora(), atualizado_em: agora(),
        });

        return j({
          success: true,
          processado: item.id,
          cpf: item.cpf,
          resultado: ok ? 'DIGITADA' : 'ERRO',
          mensagem: r.data?.mensagem || '',
        }, 200, req);
      } finally {
        await liberarLock('worker-fila');
      }
    }

    return jsonError('Action invalida. Validas: enfileirar, minhaFila, producao, cancelar, status, processar', 400, req);
  } catch (e) {
    return jsonError('Erro fila Crefisa: ' + e.message, 500, req);
  }
}

// Escopo de visibilidade pelo papel do usuário.
//   admin/interno → 'tudo'
//   gestor        → 'loja' (todos os vendedores do mesmo parceiro_id)
//   operador      → 'proprio' (só o que ele lançou)
// Gestor sem parceiro_id definido cai pra 'proprio' (mais restritivo, por segurança).
function escopoDoUsuario(user) {
  if (!user || user._internal || user.role === 'admin') return { tipo: 'tudo' };
  if (user.role === 'gestor' && user.parceiro_id != null) {
    return { tipo: 'loja', parceiroId: user.parceiro_id };
  }
  return { tipo: 'proprio', userId: user.id };
}

// Pode mexer neste item? (cancelar/repriorizar)
function podeMexer(user, item) {
  const e = escopoDoUsuario(user);
  if (e.tipo === 'tudo') return true;
  if (e.tipo === 'loja') return item.parceiro_id === e.parceiroId;
  return item.user_id === e.userId;
}

// Posição do item na fila (quantos NA_FILA vieram antes)
async function posicaoNaFila(id) {
  const { data: alvo } = await dbQuery('crefisa_fila', `id=eq.${id}&select=prioridade,criado_em`, { single: true });
  if (!alvo) return null;
  const { data } = await dbQuery(
    'crefisa_fila',
    `status=eq.NA_FILA&or=(prioridade.gt.${alvo.prioridade},and(prioridade.eq.${alvo.prioridade},criado_em.lt.${encodeURIComponent(alvo.criado_em)}))&select=id`,
  );
  return (Array.isArray(data) ? data.length : 0) + 1;
}
