// ══════════════════════════════════════════════════════════════════
// api/clt-autorizacoes.js — Padrão unificado de autorização LGPD CLT
// Bancos suportados: C6 (ativo), FACTA (placeholder), PAN (placeholder)
//
// Fluxo padrão:
//  1. verificar(cpf, banco) → busca local + sync com banco
//  2. Se não tem ou expired → frontend chama gerar
//  3. gerar(cpf, banco, nome, telefone, dataNasc) → cria link no banco e salva
//  4. Frontend exibe link + botão WhatsApp
//  5. Cliente faz selfie → banco autoriza
//  6. verificarStatus → atualiza status local pra 'authorized'
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';
import { dbSelect, dbInsert, dbUpdate, dbQuery } from './_lib/supabase.js';

const APP_URL = () => process.env.APP_URL || 'https://flowforce.vercel.app';
const INTERNAL_TOKEN = () => process.env.INTERNAL_SERVICE_TOKEN || '';

const BANCOS_LGPD = ['c6', 'facta', 'pan']; // bancos que exigem autorização LGPD

function normalizeCPF(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits || digits.length > 11 || digits.length < 9) return null;
  return digits.padStart(11, '0');
}

async function callApi(path, payload, authHeader) {
  const opts = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader
    },
    body: JSON.stringify(payload)
  };
  try {
    const r = await fetch(APP_URL() + path, opts);
    const t = await r.text();
    let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 500) }; }
    return { ok: r.ok, status: r.status, data: d };
  } catch (e) {
    return { ok: false, status: 0, data: { error: e.message } };
  }
}

// ── Verifica status no banco específico (sync remoto) ─────────
async function syncStatusBanco(cpf, banco, authHeader) {
  if (banco === 'c6') {
    const r = await callApi('/api/c6', { action: 'statusAutorizacao', cpf }, authHeader);
    if (!r.ok) return null;
    const st = r.data?.statusAutorizacao;
    return {
      status: st === 'AUTORIZADO' ? 'authorized'
            : st === 'NAO_AUTORIZADO' ? 'denied'
            : st === 'AGUARDANDO_AUTORIZACAO' ? 'pending'
            : null,
      _raw: r.data
    };
  }
  if (banco === 'facta') {
    // TODO: implementar quando tiver doc do FACTA CLT
    return { status: 'pending', _raw: { todo: 'FACTA CLT integration pending' } };
  }
  if (banco === 'pan') {
    // TODO: implementar quando tiver doc do PAN CLT
    return { status: 'pending', _raw: { todo: 'PAN CLT doc not yet available' } };
  }
  return null;
}

// ── Gera link de autorização no banco específico ───────────────
async function gerarLinkBanco(banco, payload, authHeader) {
  if (banco === 'c6') {
    return await callApi('/api/c6', {
      action: 'gerarLinkAutorizacao',
      cpf: payload.cpf,
      nome: payload.nome,
      dataNascimento: payload.dataNascimento,
      ddd: payload.ddd,
      telefone: payload.telefone
    }, authHeader);
  }
  if (banco === 'facta') {
    return { ok: false, data: { error: 'FACTA CLT autorização ainda não implementada (aguardando doc)' } };
  }
  if (banco === 'pan') {
    return { ok: false, data: { error: 'PAN CLT autorização ainda não implementada (aguardando doc)' } };
  }
  return { ok: false, data: { error: `Banco ${banco} não suportado` } };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  try {
    const body = req.method === 'POST' ? await req.json() : {};
    const action = body.action || '';
    const auth = req.headers.get('Authorization') || '';

    // ─── VERIFICAR (busca local + opcional sync) ──────────────
    if (action === 'verificar') {
      const cpf = normalizeCPF(body.cpf);
      const banco = body.banco;
      if (!cpf || !banco) return jsonError('cpf e banco obrigatorios', 400, req);
      if (!BANCOS_LGPD.includes(banco)) return jsonError(`banco invalido. Validos: ${BANCOS_LGPD.join(',')}`, 400, req);

      // Busca local
      const { data: local } = await dbSelect('clt_autorizacoes_lgpd', {
        filters: { banco, cpf }, single: true
      });

      // Se sync=true, força chamar banco remoto pra atualizar
      const sync = body.sync !== false; // default true
      if (sync && local) {
        const remote = await syncStatusBanco(cpf, banco, auth);
        if (remote && remote.status && remote.status !== local.status) {
          const patch = { status: remote.status, _raw_response: remote._raw };
          if (remote.status === 'authorized') patch.autorizado_em = new Date().toISOString();
          if (remote.status === 'denied') patch.recusado_em = new Date().toISOString();
          await dbUpdate('clt_autorizacoes_lgpd', { id: local.id }, patch);
          local.status = remote.status;
        }
      } else if (sync && !local) {
        // Sem registro local — checa se o banco já tem autorização (caso autorizou antes)
        const remote = await syncStatusBanco(cpf, banco, auth);
        if (remote && remote.status) {
          const insert = await dbInsert('clt_autorizacoes_lgpd', {
            banco, cpf, status: remote.status,
            autorizado_em: remote.status === 'authorized' ? new Date().toISOString() : null,
            _raw_response: remote._raw,
            gerado_por_user_id: user.id
          });
          return jsonResp({ success: true, autorizacao: insert.data, criadoLocal: true }, 200, req);
        }
      }

      return jsonResp({
        success: true,
        autorizacao: local || null,
        existeLocal: !!local
      }, 200, req);
    }

    // ─── GERAR LINK ───────────────────────────────────────────
    if (action === 'gerar') {
      const cpf = normalizeCPF(body.cpf);
      const banco = body.banco;
      if (!cpf || !banco || !body.nome || !body.telefone || !body.dataNascimento) {
        return jsonError('cpf, banco, nome, telefone, dataNascimento obrigatorios', 400, req);
      }
      if (!BANCOS_LGPD.includes(banco)) return jsonError(`banco invalido`, 400, req);

      const tel = String(body.telefone).replace(/\D/g, '');
      const ddd = tel.substring(0, 2);
      const numero = tel.substring(2);

      const r = await gerarLinkBanco(banco, {
        cpf, nome: body.nome,
        dataNascimento: body.dataNascimento,
        ddd, telefone: numero
      }, auth);

      if (!r.ok || !r.data?.link) {
        return jsonResp({
          success: false,
          erro: r.data?.error || r.data?.message || `Falha ao gerar link no ${banco}`,
          _raw: r.data
        }, 200, req);
      }

      // Upsert no banco local (pode já existir registro pendente, atualiza)
      const { data: existing } = await dbSelect('clt_autorizacoes_lgpd', {
        filters: { banco, cpf }, single: true
      });
      const dados = {
        banco, cpf, status: 'pending',
        link_selfie: r.data.link,
        link_expira_em: r.data.dataExpiracao || null,
        nome: body.nome,
        telefone: tel,
        data_nascimento: body.dataNascimento,
        dados_gerar: { ddd, numero, ...(body.dadosExtra || {}) },
        gerado_em: new Date().toISOString(),
        gerado_por_user_id: user.id,
        conversa_id: body.conversaId || null,
        _raw_response: r.data
      };

      let saved;
      if (existing) {
        const u = await dbUpdate('clt_autorizacoes_lgpd', { id: existing.id }, dados);
        saved = Array.isArray(u.data) ? u.data[0] : u.data;
      } else {
        const i = await dbInsert('clt_autorizacoes_lgpd', dados);
        saved = i.data;
      }

      return jsonResp({
        success: true,
        autorizacao: saved,
        link: r.data.link,
        dataExpiracao: r.data.dataExpiracao,
        mensagemParaCliente: r.data.mensagemParaCliente ||
          `Pra prosseguir com sua oferta, acesse: ${r.data.link}\n\nVocê vai tirar uma selfie rápida pra confirmar sua identidade.`
      }, 200, req);
    }

    // ─── LISTAR (pendentes / por banco / por status) ──────────
    if (action === 'listar') {
      let qs = 'select=*&order=gerado_em.desc&limit=500';
      if (body.banco) qs += `&banco=eq.${encodeURIComponent(body.banco)}`;
      if (body.status) qs += `&status=eq.${encodeURIComponent(body.status)}`;
      if (body.cpf) {
        const c = normalizeCPF(body.cpf);
        if (c) qs += `&cpf=eq.${c}`;
      }
      const { data, error } = await dbQuery('clt_autorizacoes_lgpd', qs);
      if (error) return jsonResp({ success: false, error }, 200, req);
      return jsonResp({ success: true, autorizacoes: data || [], total: (data || []).length }, 200, req);
    }

    // ─── MARCAR ENVIO WHATSAPP ────────────────────────────────
    if (action === 'marcarEnvioWpp') {
      if (!body.id) return jsonError('id obrigatorio', 400, req);
      await dbUpdate('clt_autorizacoes_lgpd', { id: body.id }, {
        enviado_whatsapp_em: new Date().toISOString()
      });
      return jsonResp({ success: true }, 200, req);
    }

    return jsonError('action invalida. Disponiveis: verificar, gerar, listar, marcarEnvioWpp', 400, req);

  } catch (err) {
    console.error('clt-autorizacoes erro:', err);
    return jsonResp({ error: 'Erro interno', message: err.message }, 500, req);
  }
}
