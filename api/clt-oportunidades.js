// ══════════════════════════════════════════════════════════════════
// api/clt-oportunidades.js
// Orquestrador de Consulta CLT — só CPF, retorna ofertas dos bancos
//
// VERSÃO ENXUTA (2026-04-26):
//  - JoinBank temporariamente fora (operação parada)
//  - Removidas chamadas pesadas (fluxoCompleto PB, gerarTermo V8 sync)
//    pra evitar 504 timeout. Detalhes detalhados são feitos sob demanda
//    no momento da digitação (modal).
//  - Mantém: PresençaBank básico, Multicorban enriquece, C6, V8 status
//
// Tempo esperado: 5-8s (era 30-60s).
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';

const APP_URL = () => process.env.APP_URL || 'https://flowforce.vercel.app';

async function callApi(path, payload, authHeader, internalSecret) {
  const headers = { 'Content-Type': 'application/json' };
  if (internalSecret) headers['x-internal-secret'] = internalSecret;
  if (authHeader) headers['Authorization'] = authHeader;
  const opts = { method: 'POST', headers, body: JSON.stringify(payload) };
  try {
    const r = await fetch(APP_URL() + path, opts);
    const t = await r.text();
    let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 500) }; }
    return { ok: r.ok, status: r.status, data: d };
  } catch (e) {
    return { ok: false, status: 0, data: { error: e.message } };
  }
}

function normalizeCPF(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits || digits.length > 11 || digits.length < 9) return null;
  return digits.padStart(11, '0');
}

function ddMmYyToIso(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  try {
    const body = req.method === 'POST' ? await req.json() : {};
    const cpf = normalizeCPF(body.cpf);
    if (!cpf) return jsonError('CPF invalido (digite 9-11 numeros)', 400, req);

    // C6 só consulta se opt-in (default false) — exige autorização LGPD via selfie,
    // que cliente precisa fazer primeiro. Frontend libera o C6 explicitamente.
    const incluirC6 = body.incluirC6 === true;

    const auth = req.headers.get('Authorization') || '';
    // Se temos WEBHOOK_SECRET, usa ele nas chamadas internas (mais robusto)
    const secret = process.env.WEBHOOK_SECRET || '';

    // ─── ETAPA ÚNICA: chamadas básicas em paralelo ─
    // Padrão: V8 (QI + CELCOIN) + PresençaBank + Multicorban (enriquece)
    // C6 só entra se incluirC6=true (cliente autorizou)
    const tarefas = [
      callApi('/api/presencabank', { action: 'oportunidadesPorCPF', cpf }, auth, secret),
      callApi('/api/multicorban',   { action: 'consult_clt', cpf },         auth, secret),
      callApi('/api/v8',            { action: 'consultarPorCPF', cpf, provider: 'QI' },     auth, secret).catch(() => ({ ok: false })),
      callApi('/api/v8',            { action: 'consultarPorCPF', cpf, provider: 'CELCOIN' }, auth, secret).catch(() => ({ ok: false })),
      incluirC6
        ? callApi('/api/c6', { action: 'oferta', cpf }, auth, secret)
        : Promise.resolve({ ok: false, data: { _bloqueado: true } })
    ];
    const [pbOpor, mcClt, v8QI, v8Celcoin, c6Of] = await Promise.all(tarefas);

    // ─── Mescla dados do cliente (PresençaBank prioritário) ─────
    const pb = pbOpor.data || {};
    const mc = mcClt.data?.parsed || {};

    const cliente = {
      nome: mc.nome || null,
      cpf,
      dataNascimento: pb.dadosCliente?.dataNascimento || (mc.dataNascimento ? ddMmYyToIso(mc.dataNascimento) : null),
      sexo: pb.dadosCliente?.sexo || mc.sexo || null,
      nomeMae: pb.dadosCliente?.nomeMae || mc.nomeMae || null,
      nomePai: mc.nomePai || null,
      idade: mc.idade || null,
      telefones: (mc.telefones || []).map(t => ({
        ddd: t.ddd, numero: t.numero, completo: t.completo, whatsapp: t.whatsapp
      }))
    };

    const vinculo = pb.temVinculo ? {
      matricula: pb.vinculo?.matricula,
      cnpj: pb.vinculo?.cnpj,
      empregador: pb.vinculo?.empregador || mc.empresa?.razaoSocial || null,
      dataAdmissao: pb.vinculo?.dataAdmissao || (mc.trabalhista?.dataAdmissao ? ddMmYyToIso(mc.trabalhista.dataAdmissao) : null),
      tempoContribuicaoMeses: mc.trabalhista?.tempoContribuicaoMeses || null,
      renda: mc.trabalhista?.renda || null,
      saldoAproximadoFgts: mc.trabalhista?.saldoAproximado || null
    } : null;

    const margem = pb.margem || null;

    // ─── Monta cards de ofertas ────────────────────────────────
    // Ordem: PresençaBank, V8 QI, V8 CELCOIN, C6 (último, só se incluído)
    const ofertas = [];

    // PresençaBank — só elegibilidade (tabela detalhada vem na digitação)
    if (pb.temVinculo) {
      ofertas.push({
        banco: 'presencabank',
        label: 'PresençaBank',
        disponivel: true,
        detalhes: null, // tabela vem sob demanda no modal de digitação
        elegibilidade: {
          margemDisponivel: pb.margem?.disponivel,
          margemBase: pb.margem?.base,
          empregador: pb.vinculo?.empregador
        },
        mensagem: pb.margem?.disponivel
          ? `Cliente elegível — margem R$ ${parseFloat(pb.margem.disponivel).toFixed(2)}. Clique Digitar pra simular tabela exata.`
          : 'Cliente elegível mas sem margem disponível'
      });
    } else {
      ofertas.push({
        banco: 'presencabank',
        label: 'PresençaBank',
        disponivel: false,
        mensagem: pb.mensagem || 'Sem vínculo CLT elegível'
      });
    }

    // V8 QI Tech — só status (sem auto-criar termo)
    function montarCardV8(provider, label, existing) {
      if (!existing?.encontrado) {
        ofertas.push({
          banco: 'v8', provider, label,
          disponivel: false,
          podeGerarTermo: !!(cliente.nome && cliente.dataNascimento && cliente.sexo && cliente.telefones?.[0]),
          mensagem: cliente.nome
            ? 'Sem termo V8 ainda — clique Digitar pra criar termo + simular'
            : 'Faltam dados básicos pra criar termo V8'
        });
        return;
      }
      const st = existing.status;
      if (st === 'SUCCESS') {
        ofertas.push({
          banco: 'v8', provider, label,
          disponivel: true,
          consultId: existing.consultId,
          elegibilidade: {
            margemDisponivel: parseFloat(existing.availableMarginValue || 0)
          },
          mensagem: `Cliente elegível — margem R$ ${parseFloat(existing.availableMarginValue || 0).toFixed(2)}. Clique Digitar pra simular.`
        });
      } else if (st === 'REJECTED' || st === 'FAILED') {
        ofertas.push({
          banco: 'v8', provider, label,
          disponivel: false,
          mensagem: `❌ ${st}: ${existing.descricao || 'rejeitado'}`
        });
      } else {
        ofertas.push({
          banco: 'v8', provider, label,
          disponivel: false,
          processando: true,
          consultId: existing.consultId,
          mensagem: `V8 ${provider}: ${st} — aguardando webhook (pode levar até 5min)`
        });
      }
    }
    montarCardV8('QI', 'V8 (QI Tech)', v8QI?.data);
    montarCardV8('CELCOIN', 'V8 (CELCOIN)', v8Celcoin?.data);

    // C6 — só se incluirC6=true OU se já foi consultado por estar autorizado
    const c6 = c6Of.data || {};
    if (incluirC6) {
      ofertas.push({
        banco: 'c6',
        label: 'C6 Bank',
        disponivel: !!(c6.success && c6.temOferta),
        requiresLiveness: !!c6.requiresLiveness,
        statusAutorizacao: c6.statusAutorizacao || null,
        detalhes: c6.temOferta ? {
          valorLiquido: c6.oferta?.valorCliente,
          parcelas: c6.oferta?.qtdParcelas,
          valorParcela: c6.oferta?.valorParcela,
          seguroSugerido: c6.oferta?.valorSeguroSugerido
        } : null,
        mensagem: c6.mensagem || null
      });
    } else {
      // Card "bloqueado" — cliente precisa autorizar primeiro
      ofertas.push({
        banco: 'c6',
        label: 'C6 Bank',
        disponivel: false,
        bloqueado: true,
        mensagem: 'C6 exige selfie de autorização DataPrev. Clique pra liberar e enviar link ao cliente via WhatsApp.'
      });
    }

    const totalDisponivel = ofertas.filter(o => o.disponivel).length;
    const telefonePrincipal = cliente.telefones?.[0]?.completo || null;
    const temNomeETel = !!(cliente.nome && telefonePrincipal);

    return jsonResp({
      success: true,
      cpf,
      cliente,
      vinculo,
      margemPresencaBank: margem,
      enriquecimento: {
        presencaBankOk: pbOpor.ok && pb.temVinculo,
        multicorbanOk: mcClt.ok && !!mc.nome,
        nomeOrigem: mc.nome ? 'multicorban' : null,
        telefoneOrigem: telefonePrincipal ? 'multicorban' : null
      },
      ofertas,
      totalBancosDisponiveis: totalDisponivel,
      mensagem: totalDisponivel > 0
        ? `${totalDisponivel} de 4 bancos com oferta disponível`
        : 'Nenhum banco retornou oferta disponível pra esse CPF',
      _raw: {
        presencabank: pb,
        multicorban: mc,
        c6,
        v8QI: v8QI?.data,
        v8Celcoin: v8Celcoin?.data
      }
    }, 200, req);

  } catch (err) {
    console.error('clt-oportunidades erro:', err);
    return jsonResp({ error: 'Erro interno', message: err.message }, 500, req);
  }
}
