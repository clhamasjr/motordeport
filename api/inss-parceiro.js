// ══════════════════════════════════════════════════════════════════
// api/inss-parceiro.js — Bot WhatsApp B2B para parceiros INSS
// ──────────────────────────────────────────────────────────────────
// Parceiro envia CPF via WhatsApp → sistema consulta Multicorban →
// retorna situação completa: benefício, margem, contratos + oportunidades de port.
//
// Somente parceiros com phone_whatsapp cadastrado em users são atendidos.
// ══════════════════════════════════════════════════════════════════
export const config = { runtime: 'edge' };

import { json, jsonError, handleOptions, requireAuth } from './_lib/auth.js';
import { dbSelect } from './_lib/supabase.js';

// ─── Config ───────────────────────────────────────────────────────
const EVO_URL   = () => process.env.EVOLUTION_URL   || '';
const EVO_KEY   = () => process.env.EVOLUTION_KEY   || '';
const INSTANCE  = () => process.env.INSS_PARCEIRO_INSTANCE || '';
const APP_URL   = () => (process.env.APP_URL || 'https://flowforce.vercel.app').replace(/\/$/, '');
const WH_SECRET = () => process.env.WEBHOOK_SECRET  || '';

// ─── Evolution helper ─────────────────────────────────────────────
async function evo(method, path, body, ms = 12000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(EVO_URL() + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'apikey': EVO_KEY() },
      body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    });
    clearTimeout(timer);
    const t = await r.text();
    let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 300) }; }
    return { ok: r.ok, status: r.status, data: d };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message };
  }
}

async function sendMsg(instance, phone, text) {
  if (!EVO_URL() || !EVO_KEY()) return { ok: false, error: 'Evolution nao configurada' };
  return evo('POST', '/message/sendText/' + instance, { number: phone, text }, 10000);
}

// ─── Multicorban (chamada interna) ───────────────────────────────
async function consultarCPF(cpf) {
  const secret = WH_SECRET();
  if (!secret) return { ok: false, error: 'WEBHOOK_SECRET nao configurado — impossivel chamar Multicorban internamente.' };
  const r = await fetch(`${APP_URL()}/api/multicorban`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': secret
    },
    body: JSON.stringify({ action: 'consult_cpf', cpf })
  });
  if (!r.ok) {
    const t = await r.text();
    return { ok: false, error: `Multicorban HTTP ${r.status}: ${t.substring(0, 200)}` };
  }
  return r.json();
}

// ─── CPF utils ───────────────────────────────────────────────────
function cleanCPF(s) { return (s || '').replace(/\D/g, ''); }

function validarCPF(cpf) {
  const c = cleanCPF(cpf);
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += parseInt(c[i]) * (10 - i);
  let r = (s * 10) % 11; if (r >= 10) r = 0;
  if (r !== parseInt(c[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += parseInt(c[i]) * (11 - i);
  r = (s * 10) % 11; if (r >= 10) r = 0;
  return r === parseInt(c[10]);
}

function fmtCPF(cpf) {
  const c = cleanCPF(cpf);
  if (c.length !== 11) return c;
  return `${c.slice(0,3)}.${c.slice(3,6)}.${c.slice(6,9)}-${c.slice(9)}`;
}

// ─── Monetário ───────────────────────────────────────────────────
function parseMoney(s) {
  if (!s) return 0;
  return parseFloat(String(s).replace(/\./g, '').replace(',', '.')) || 0;
}

function fmtMoney(val) {
  return 'R$ ' + Number(val).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Bancos ───────────────────────────────────────────────────────
const BANCOS = {
  '001': 'Banco do Brasil', '033': 'Santander', '041': 'Banrisul',
  '047': 'Banese',          '070': 'BRB',        '077': 'Inter',
  '104': 'Caixa',           '133': 'Cresol',     '149': 'FACTA',
  '212': 'Banco Original',  '237': 'Bradesco',   '260': 'Nubank',
  '318': 'BMG',             '321': '321 Bank',   '329': 'QI Tech',
  '336': 'C6',              '380': 'PicPay',     '422': 'Safra',
  '623': 'PAN',             '655': 'Votorantim', '707': 'Daycoval',
  '739': 'BCA',             '748': 'Sicredi',    '756': 'Sicoob',
  '029': 'Itaú Consig',     '341': 'Itaú',       '950': 'QI Tech'
};
function nomeBanco(cod) { return BANCOS[cod] || (cod ? `Banco ${cod}` : '?'); }

// ─── Oportunidades de portabilidade (regras simplificadas) ────────
// Parcelas mínimas pagas por banco de ORIGEM para portar
const PG_MIN_ORIGEM = {
  '029': 13,  // Itaú Consig/BMG
  '149': 13,  // FACTA
  '623': 12,  // PAN
  '380': 1,   // PicPay
  '070': 0,   // BRB
  '329': 0,   // QI Tech
  '950': 0,   // QI Tech
  'default': 6
};
const SALDO_MIN_PORT = 500; // R$

function verificarPort(c) {
  const saldo = parseMoney(c.saldo);
  const total = parseInt(c.prazo_original) || 0;
  const rest  = parseInt(c.prazo)          || 0;
  const pagas = total > 0 ? total - rest : 0;
  const pgMin = PG_MIN_ORIGEM[c.banco_codigo] ?? PG_MIN_ORIGEM.default;
  return {
    porta: saldo >= SALDO_MIN_PORT && (pagas >= pgMin || pgMin === 0),
    pagas,
    pgMin,
    saldo
  };
}

// ─── Formatar resposta WhatsApp ───────────────────────────────────
function formatarResposta(parsed, cpf, lista) {
  const ben  = parsed.beneficiario || {};
  const info = parsed.beneficio    || {};
  const marg = parsed.margem       || {};
  const contratos = (parsed.contratos || []).filter(c => c.contrato && !c._parcial);
  const cartoes   = parsed.cartoes || [];

  const L = [];

  // Header
  const nome = ben.nome || '—';
  const nb   = ben.nb   || '—';
  L.push(`✅ *${nome}*`);
  L.push(`CPF: ${fmtCPF(cpf)}  |  Benef: ${nb}`);

  // Avisa se selecionou automaticamente entre vários benefícios
  if (lista && lista.length > 1) {
    L.push(`_*${lista.length} benefícios encontrados — exibindo o ativo (${nb})*_`);
  }
  L.push('');

  // Benefício
  L.push('📋 *BENEFÍCIO*');
  if (info.especie)     L.push(`Espécie: ${info.especie}`);
  if (info.ddb)         L.push(`DDB: ${info.ddb}`);
  if (info.situacao)    L.push(`Situação: ${info.situacao}`);
  if (info.desbloqueio && info.desbloqueio !== '0' && info.desbloqueio !== '') {
    L.push(`Desbloqueio: ${info.desbloqueio}`);
  }
  if (info.valor) L.push(`Valor bruto: *${fmtMoney(parseMoney(info.valor))}*`);
  L.push('');

  // Margem
  L.push('📊 *MARGEM DISPONÍVEL*');
  const mEmp = parseMoney(marg.disponivel || marg.parcelas);
  const mRmc = parseMoney(marg.rmc);
  const mRcc = parseMoney(marg.rcc);
  if (mEmp > 0) L.push(`• Empréstimo: *${fmtMoney(mEmp)}/mês*`);
  else          L.push(`• Empréstimo: sem margem livre`);
  if (mRmc > 0) L.push(`• Cartão RMC: *${fmtMoney(mRmc)}/mês*`);
  if (mRcc > 0) L.push(`• Cartão RCC: *${fmtMoney(mRcc)}/mês*`);
  if (cartoes.length > 0) {
    for (const ct of cartoes) {
      const margCtStr = parseMoney(ct.margem) > 0 ? fmtMoney(parseMoney(ct.margem)) : 'R$ 0,00';
      L.push(`• ${ct.tipo}${ct.banco ? ' (' + ct.banco + ')' : ''}: margem ${margCtStr}`);
    }
  }
  L.push('');

  // Contratos ativos
  if (contratos.length > 0) {
    L.push(`💳 *CONTRATOS (${contratos.length})*`);
    for (const c of contratos) {
      const banco   = nomeBanco(c.banco_codigo);
      const parcela = c.parcela ? `R$ ${c.parcela}/mês` : '';
      const saldo   = c.saldo   ? `Saldo R$ ${c.saldo}` : '';
      const taxa    = c.taxa    ? c.taxa                 : '';
      const total   = parseInt(c.prazo_original) || 0;
      const rest    = parseInt(c.prazo)          || 0;
      const prazoStr = total > 0 ? `${total - rest}/${total} pagas` : '';
      const partes  = [banco, parcela, saldo, taxa, prazoStr].filter(Boolean);
      L.push(`• ${partes.join(' | ')}`);
    }
    L.push('');
  } else {
    L.push('💳 *Sem contratos ativos*');
    L.push('');
  }

  // Oportunidades de port
  const portaveis = contratos
    .map(c => ({ c, p: verificarPort(c) }))
    .filter(x => x.p.porta);

  if (portaveis.length > 0) {
    L.push(`🚀 *PORT DISPONÍVEL (${portaveis.length} contrato${portaveis.length > 1 ? 's' : ''})*`);
    for (const { c, p } of portaveis) {
      L.push(`• ${nomeBanco(c.banco_codigo)} | Saldo ${fmtMoney(p.saldo)} | ${p.pagas} parcelas pagas`);
    }
    L.push(`_Simule no FlowForce para valores precisos_`);
  } else if (contratos.length > 0) {
    L.push(`ℹ️ _Nenhum contrato portável no momento_`);
  }

  // Rodapé
  const agora = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  L.push('');
  L.push(`_FlowForce INSS • ${agora}_`);

  return L.join('\n');
}

// ─── Handler principal ────────────────────────────────────────────
export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);
  if (req.method !== 'POST')   return jsonError('POST only', 405, req);

  let body;
  try { body = await req.json(); } catch { return jsonError('JSON inválido', 400, req); }

  const action = body.action || '';

  // ══════════════════════════════════════════════════════════════
  // AÇÕES ADMIN (requerem autenticação JWT ou WEBHOOK_SECRET)
  // ══════════════════════════════════════════════════════════════
  if (['test', 'status', 'configureWebhook'].includes(action)) {
    const user = await requireAuth(req);
    if (user instanceof Response) return user;

    // Diagnóstico básico
    if (action === 'test') {
      return json({
        ok: true,
        instance: INSTANCE(),
        appUrl: APP_URL(),
        webhookSecretSet: !!WH_SECRET(),
        evolutionUrlSet:  !!EVO_URL()
      }, 200, req);
    }

    // Status da instância Evolution
    if (action === 'status') {
      const inst = body.instance || INSTANCE();
      if (!inst) return jsonError('INSS_PARCEIRO_INSTANCE nao configurada', 400, req);
      const r = await evo('GET', '/instance/connectionState/' + inst, null, 5000);
      return json({ instance: inst, ...r.data }, 200, req);
    }

    // Configura webhook da instância Evolution pra apontar aqui
    if (action === 'configureWebhook') {
      const inst = body.instance || INSTANCE();
      if (!inst) return jsonError('instance obrigatorio (ou configure INSS_PARCEIRO_INSTANCE)', 400, req);
      const webhookUrl = `${APP_URL()}/api/inss-parceiro`;
      const r = await evo('POST', '/webhook/set/' + inst, {
        webhook: { url: webhookUrl, events: ['MESSAGES_UPSERT'], webhook_by_events: false }
      });
      return json({
        ok: r.ok,
        instance: inst,
        webhookUrl,
        message: r.ok ? 'Webhook configurado! Parceiros com phone_whatsapp cadastrado já podem consultar.' : 'Falha ao configurar webhook',
        detail: r.data
      }, 200, req);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // WEBHOOK DO EVOLUTION (sem auth — validamos pelo telefone)
  // ══════════════════════════════════════════════════════════════
  const event = body.event || '';
  if (!event.toLowerCase().includes('messages')) {
    return json({ ok: true, ignored: true }, 200, req);
  }

  const data = body.data || {};
  const msg  = data.message || data;
  const key  = msg.key || {};
  const jid  = key.remoteJid || '';
  const inst = data.instance || INSTANCE();

  // Ignora grupos, mensagens próprias e sem JID
  if (!jid || jid.includes('@g.us') || key.fromMe) {
    return json({ ok: true, ignored: true }, 200, req);
  }

  const phone = jid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
  const text  = (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    ''
  ).trim();

  if (!text) return json({ ok: true, ignored: true }, 200, req);

  // ── Verificar se é parceiro cadastrado ────────────────────────
  const { data: parceiro } = await dbSelect('users', {
    filters: { phone_whatsapp: phone, active: true },
    select: 'id,name,username,role',
    single: true
  });

  if (!parceiro) {
    await sendMsg(inst, phone,
      '❌ *Número não autorizado*\n\n' +
      'Seu número não está cadastrado no FlowForce INSS.\n\n' +
      'Fale com o administrador da LhamasCred para liberar acesso.'
    );
    return json({ ok: true }, 200, req);
  }

  // ── Extrair e validar CPF ─────────────────────────────────────
  const cpfRaw = text.replace(/\D/g, '');

  // Mensagem que não parece um CPF — manda instrução
  if (cpfRaw.length !== 11) {
    await sendMsg(inst, phone,
      `📱 *FlowForce INSS*\n\n` +
      `Olá, *${parceiro.name || 'parceiro'}*! 👋\n\n` +
      `Envie o *CPF* do cliente para consultar a situação no INSS.\n\n` +
      `Exemplo:\n` +
      `*123.456.789-01*\nou\n*12345678901*`
    );
    return json({ ok: true }, 200, req);
  }

  // CPF com 11 dígitos mas inválido
  if (!validarCPF(cpfRaw)) {
    await sendMsg(inst, phone,
      `❌ CPF inválido: *${fmtCPF(cpfRaw)}*\n\nVerifique os dígitos e tente novamente.`
    );
    return json({ ok: true }, 200, req);
  }

  // ── Avisar que está consultando ───────────────────────────────
  await sendMsg(inst, phone,
    `🔍 Consultando CPF *${fmtCPF(cpfRaw)}*...\n\n_Aguarde alguns segundos._`
  );

  // ── Consultar Multicorban ─────────────────────────────────────
  let resultado;
  try {
    resultado = await consultarCPF(cpfRaw);
  } catch (e) {
    await sendMsg(inst, phone,
      `⚠️ Erro de comunicação com o Multicorban.\n\nTente novamente em instantes.`
    );
    return json({ ok: true }, 200, req);
  }

  if (!resultado || !resultado.ok) {
    const err = resultado?.error || 'Erro desconhecido';
    await sendMsg(inst, phone,
      `⚠️ Não foi possível consultar *${fmtCPF(cpfRaw)}*\n\n_${err}_`
    );
    return json({ ok: true }, 200, req);
  }

  // ── Formatar e enviar resposta ────────────────────────────────
  const resposta = formatarResposta(resultado.parsed, cpfRaw, resultado.lista);
  await sendMsg(inst, phone, resposta);

  return json({ ok: true }, 200, req);
}
