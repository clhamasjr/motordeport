// ══════════════════════════════════════════════════════════════════
// api/clt-simular-detalhe.js
// Simulacao detalhada sob demanda pra UM banco especifico
// (chamado pelo frontend em paralelo apos consulta basica retornar)
//
// Backend pesado (5-15s) que estoura no orquestrador, mas OK aqui
// porque cada chamada eh isolada por banco.
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';

const APP_URL = () => process.env.APP_URL || 'https://flowforce.vercel.app';

async function callApi(path, payload, authHeader, internalSecret) {
  const headers = { 'Content-Type': 'application/json' };
  if (internalSecret) headers['x-internal-secret'] = internalSecret;
  if (authHeader) headers['Authorization'] = authHeader;
  try {
    const r = await fetch(APP_URL() + path, { method: 'POST', headers, body: JSON.stringify(payload) });
    const t = await r.text();
    let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 500) }; }
    return { ok: r.ok, status: r.status, data: d };
  } catch (e) {
    return { ok: false, status: 0, data: { error: e.message } };
  }
}

function normalizeCPF(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d || d.length > 11 || d.length < 9) return null;
  return d.padStart(11, '0');
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  try {
    const body = req.method === 'POST' ? await req.json() : {};
    const banco = body.banco;
    const cpf = normalizeCPF(body.cpf);
    if (!banco || !cpf) return jsonError('banco e cpf obrigatorios', 400, req);

    const auth = req.headers.get('Authorization') || '';
    const secret = process.env.WEBHOOK_SECRET || '';

    // ─── PRESENÇABANK: fluxoCompleto (gera termo + assina + vinculos + margem + tabelas) ─
    if (banco === 'presencabank') {
      if (!body.nome || !body.telefone) return jsonError('nome e telefone obrigatorios pra PB', 400, req);
      const r = await callApi('/api/presencabank', {
        action: 'fluxoCompleto',
        cpf, nome: body.nome, telefone: body.telefone
      }, auth, secret);
      const d = r.data || {};
      if (d.success && d.melhorTabela) {
        const t = d.melhorTabela;
        return jsonResp({
          success: true, banco,
          detalhes: {
            valorLiquido: t.valorLiquido,
            parcelas: t.quantidadeParcelas,
            valorParcela: t.valorParcela,
            taxaMensal: t.taxa,
            cetMensal: t.cet,
            totalTabelas: d.tabelas?.length || 0
          },
          idSimulacao: t.tabelaId,
          type: t.type,
          empregador: d.vinculo?.empregador,
          margemDisponivel: d.margemDisponivel
        }, 200, req);
      }
      return jsonResp({
        success: false, banco,
        mensagem: d.mensagem || 'Falha ao simular tabela PresencaBank',
        _raw: d
      }, 200, req);
    }

    // ─── V8: simularConfigs + simular pra um provider (QI ou CELCOIN) ───
    if (banco === 'v8') {
      const provider = body.provider || 'QI';
      const consultId = body.consultId;
      const margem = parseFloat(body.margem || 0);
      // Parâmetros opcionais pra re-simulação customizada:
      const valorDesejado = parseFloat(body.valorDesejado || 0);     // disbursed_amount
      const valorParcelaDesejado = parseFloat(body.valorParcelaDesejado || 0); // installment_face_value
      const numParcelasCustom = parseInt(body.numeroParcelasDesejado || 0);

      if (!consultId) {
        return jsonResp({
          success: false, banco, provider,
          mensagem: 'consultId obrigatorio (vem da consulta basica V8)'
        }, 200, req);
      }

      const cfgs = await callApi('/api/v8', { action: 'simularConfigs' }, auth, secret);
      const lista = cfgs.data?.configs || [];
      if (!lista.length) {
        return jsonResp({ success: false, banco, provider, mensagem: 'Sem tabelas V8 disponiveis' }, 200, req);
      }
      const cfg = lista[0];
      const parcelasOpts = (cfg.number_of_installments || ['24']).map(n => parseInt(n)).filter(n => !isNaN(n));
      // Se cliente pediu N parcelas e está disponível, usa. Senão pega o maior.
      const numInst = (numParcelasCustom > 0 && parcelasOpts.includes(numParcelasCustom))
        ? numParcelasCustom
        : Math.max(...parcelasOpts) || 24;

      // V8 EXIGE installment_face_value XOR disbursed_amount (nao pode mandar ambos!)
      // Prioridade: valorDesejado > valorParcelaDesejado > margem (default)
      const payloadV8 = {
        action: 'simular',
        provider, consultId,
        configId: cfg.id,
        numberOfInstallments: numInst
      };
      if (valorDesejado > 0) {
        payloadV8.disbursedAmount = valorDesejado;
      } else if (valorParcelaDesejado > 0) {
        payloadV8.installmentFaceValue = valorParcelaDesejado;
      } else if (margem > 0) {
        payloadV8.installmentFaceValue = margem;
      } else {
        payloadV8.disbursedAmount = 1000;
      }
      const sim = await callApi('/api/v8', payloadV8, auth, secret);
      const d = sim.data;
      if (d?.idSimulation) {
        return jsonResp({
          success: true, banco, provider,
          detalhes: {
            valorLiquido: d.valorDesembolso || d.valorOperacao,
            parcelas: d.qtdParcelas,
            valorParcela: d.valorParcela,
            taxaMensal: cfg.monthly_interest_rate,
            cetMensal: d.cet
          },
          idSimulacao: d.idSimulation,
          consultId
        }, 200, req);
      }
      return jsonResp({ success: false, banco, provider, mensagem: 'V8 nao retornou simulacao', _raw: d }, 200, req);
    }

    // ─── C6: tenta /simulation POR_VALOR_MAXIMO (precisa cliente autorizado) ─
    if (banco === 'c6') {
      const r = await callApi('/api/c6', {
        action: 'simular',
        cpf,
        tipoSimulacao: 'POR_VALOR_MAXIMO',
        skipAuthCheck: false
      }, auth, secret);
      const d = r.data || {};
      const planos = (d.planos || []).filter(p => p.valido);
      if (planos.length > 0) {
        const m = planos.sort((a,b) => (b.valorCliente||0) - (a.valorCliente||0))[0];
        return jsonResp({
          success: true, banco,
          detalhes: {
            valorLiquido: m.valorCliente,
            parcelas: m.qtdParcelas,
            valorParcela: m.valorParcela,
            taxaMensal: m.taxaClienteMensal,
            cetMensal: m.cetMensal
          },
          idSimulacao: m.idSimulacao,
          totalPlanos: planos.length
        }, 200, req);
      }
      return jsonResp({ success: false, banco, mensagem: d.mensagem || 'C6 sem planos disponiveis', _raw: d }, 200, req);
    }

    return jsonError(`Banco invalido: ${banco}. Validos: presencabank, v8, c6`, 400, req);

  } catch (err) {
    return jsonResp({ error: 'Erro interno', message: err.message }, 500, req);
  }
}
