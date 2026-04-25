// ══════════════════════════════════════════════════════════════════
// api/clt-oportunidades.js
// Orquestrador de Consulta CLT — só CPF, retorna ofertas dos 3 bancos
//
// Fluxo:
// 1. PresençaBank oportunidadesPorCPF (paralelo) — fonte primária:
//    vínculo + margem + dados pessoais (data nasc, mãe, sexo)
// 2. Multicorban consult_clt (paralelo) — completa: NOME + TELEFONES
//    + empresa + dados trabalhistas
// 3. C6 oferta (paralelo) — higienização (oferta pré-aprovada)
// 4. Mescla os 3 (PresençaBank prioritário pra dados pessoais)
// 5. Se conseguiu nome+telefone, roda PresençaBank fluxoCompleto
//    (pra ter as TABELAS reais de crédito) + JoinBank cltCreateSimulation
// 6. Retorna lista unificada de ofertas
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';

const APP_URL = () => process.env.APP_URL || 'https://flowforce.vercel.app';
const INTERNAL_TOKEN = () => process.env.INTERNAL_SERVICE_TOKEN || '';

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

    // Pega o token da sessão atual do usuário pra repassar internamente
    const auth = req.headers.get('Authorization') || '';

    // ─── Etapa 1: chamadas em paralelo (info básica de cada fonte) ───
    // V8: tenta achar consulta existente nos últimos 30 dias (pra não duplicar termo)
    const [pbOpor, mcClt, c6Of, v8Existing] = await Promise.all([
      callApi('/api/presencabank', { action: 'oportunidadesPorCPF', cpf }, auth),
      callApi('/api/multicorban',   { action: 'consult_clt', cpf },         auth),
      callApi('/api/c6',            { action: 'oferta', cpf },              auth),
      callApi('/api/v8',            { action: 'consultarPorCPF', cpf },     auth).catch(() => ({ ok: false }))
    ]);

    // ─── Etapa 2: mescla dados do cliente ───
    // PresençaBank é prioridade pra dados pessoais (mais confiável)
    // Multicorban completa nome + telefones + empresa
    const pb = pbOpor.data || {};
    const mc = mcClt.data?.parsed || {};

    const cliente = {
      nome: mc.nome || null,                                          // Multicorban
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
      // PresençaBank tem matricula + cnpj
      matricula: pb.vinculo?.matricula,
      cnpj: pb.vinculo?.cnpj,
      empregador: pb.vinculo?.empregador || mc.empresa?.razaoSocial || null,
      dataAdmissao: pb.vinculo?.dataAdmissao || (mc.trabalhista?.dataAdmissao ? ddMmYyToIso(mc.trabalhista.dataAdmissao) : null),
      tempoContribuicaoMeses: mc.trabalhista?.tempoContribuicaoMeses || null,
      renda: mc.trabalhista?.renda || null,
      saldoAproximadoFgts: mc.trabalhista?.saldoAproximado || null
    } : null;

    const margem = pb.margem || null;

    // ─── Etapa 3: pega telefone principal pra chamadas detalhadas ───
    const telefonePrincipal = cliente.telefones[0]?.completo || null;
    const temNomeETel = !!(cliente.nome && telefonePrincipal);

    // ─── Etapa 4: ofertas detalhadas (precisa nome+tel) — só se conseguiu enriquecer ───
    let pbTabelas = null, jbSim = null, v8Sim = null;
    if (temNomeETel) {
      // V8: se ainda não tem consulta SUCCESS, gera termo + auto-autoriza
      let v8ConsultId = null;
      const v8Found = v8Existing?.data;
      if (v8Found?.encontrado && v8Found.status === 'SUCCESS') {
        v8ConsultId = v8Found.consultId;
      } else if (cliente.dataNascimento && cliente.sexo) {
        // Tenta gerar termo no V8
        const v8Term = await callApi('/api/v8', {
          action: 'gerarTermo',
          cpf, nome: cliente.nome,
          dataNascimento: cliente.dataNascimento,
          email: 'cliente@lhamascred.com.br', // placeholder — V8 exige email
          telefone: telefonePrincipal,
          sexo: cliente.sexo
        }, auth);
        if (v8Term.ok && v8Term.data?.consultId) {
          v8ConsultId = v8Term.data.consultId;
          // Auto-autoriza
          await callApi('/api/v8', { action: 'autorizarTermo', consultId: v8ConsultId }, auth).catch(() => {});
          // Aguarda 2s pra processar status
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      const [pbFull, jbRes, v8Configs] = await Promise.all([
        callApi('/api/presencabank', {
          action: 'fluxoCompleto', cpf, nome: cliente.nome, telefone: telefonePrincipal
        }, auth),
        callApi('/api/joinbank', {
          action: 'cltCreateSimulation', providerCode: '950002',
          borrower: { identity: cpf, name: cliente.nome, phone: telefonePrincipal }
        }, auth),
        v8ConsultId
          ? callApi('/api/v8', { action: 'simularConfigs' }, auth)
          : Promise.resolve({ ok: false, data: { configs: [] } })
      ]);

      pbTabelas = pbFull.data;
      jbSim = jbRes.data;

      // V8: se tem configs disponíveis, simula com a primeira (taxa default)
      if (v8ConsultId && v8Configs.ok && v8Configs.data?.configs?.length > 0) {
        const cfg = v8Configs.data.configs[0];
        const numInst = parseInt((cfg.number_of_installments || ['24'])[0]) || 24;
        const v8SimRes = await callApi('/api/v8', {
          action: 'simular',
          consultId: v8ConsultId,
          configId: cfg.id,
          numberOfInstallments: numInst,
          installmentFaceValue: 0,
          disbursedAmount: 1000 // valor exemplo — pode ser ajustado depois
        }, auth);
        v8Sim = { ...v8SimRes.data, _consultId: v8ConsultId, _configUsada: cfg };
      }
    }

    // ─── Etapa 5: monta array de ofertas ───
    const ofertas = [];

    // C6
    const c6 = c6Of.data || {};
    ofertas.push({
      banco: 'c6',
      label: 'C6 Bank',
      disponivel: !!(c6.success && c6.temOferta),
      detalhes: c6.temOferta ? {
        valorLiquido: c6.oferta?.valorCliente,
        parcelas: c6.oferta?.qtdParcelas,
        valorParcela: c6.oferta?.valorParcela,
        seguroSugerido: c6.oferta?.valorSeguroSugerido
      } : null,
      mensagem: c6.mensagem || null
    });

    // PresençaBank
    if (pbTabelas?.success && pbTabelas.melhorTabela) {
      const t = pbTabelas.melhorTabela;
      ofertas.push({
        banco: 'presencabank',
        label: 'PresençaBank',
        disponivel: true,
        detalhes: {
          valorLiquido: t.valorLiquido,
          parcelas: t.quantidadeParcelas,
          valorParcela: t.valorParcela,
          taxaMensal: t.taxa,
          totalTabelas: pbTabelas.tabelas?.length || 0
        },
        margemDisponivel: pbTabelas.margemDisponivel,
        empregador: pbTabelas.vinculo?.empregador
      });
    } else if (pb.temVinculo) {
      // Tem vínculo mas sem nome+tel pra simular tabelas → mostra elegibilidade
      ofertas.push({
        banco: 'presencabank',
        label: 'PresençaBank',
        disponivel: true,
        detalhes: null,
        elegibilidade: {
          margemDisponivel: pb.margem?.disponivel,
          margemBase: pb.margem?.base,
          empregador: pb.vinculo?.empregador
        },
        mensagem: temNomeETel
          ? (pbTabelas?.mensagem || 'Vínculo elegível, mas erro ao simular tabelas')
          : 'Elegível — pra simular tabela exata, faltou nome ou telefone do cliente'
      });
    } else {
      ofertas.push({
        banco: 'presencabank',
        label: 'PresençaBank',
        disponivel: false,
        mensagem: pb.mensagem || 'Sem vínculo CLT elegível'
      });
    }

    // JoinBank CLT
    if (jbSim?.success && jbSim.temVinculo) {
      const emp = jbSim.employmentRelationships?.[0];
      ofertas.push({
        banco: 'joinbank',
        label: 'JoinBank CLT',
        disponivel: true,
        detalhes: {
          empregador: emp?.employerName,
          margemDisponivel: emp?.availableMarginValue,
          simulationId: jbSim.simulationId
        }
      });
    } else {
      ofertas.push({
        banco: 'joinbank',
        label: 'JoinBank CLT',
        disponivel: false,
        mensagem: temNomeETel
          ? 'JoinBank precisa de borrower completo (endereço, mãe, RG). Use o agente WhatsApp pra coletar.'
          : 'Faltou nome+telefone do cliente'
      });
    }

    // V8 Sistema (provedor QI)
    if (v8Sim?.idSimulation) {
      ofertas.push({
        banco: 'v8',
        label: 'V8 Sistema',
        disponivel: true,
        detalhes: {
          valorLiquido: v8Sim.valorDesembolso,
          parcelas: v8Sim.qtdParcelas,
          valorParcela: v8Sim.valorParcela,
          taxaMensal: v8Sim._configUsada?.monthly_interest_rate,
          cetMensal: v8Sim.cet
        },
        consultId: v8Sim._consultId,
        idSimulation: v8Sim.idSimulation
      });
    } else if (v8Existing?.data?.encontrado) {
      const ve = v8Existing.data;
      ofertas.push({
        banco: 'v8',
        label: 'V8 Sistema',
        disponivel: ve.status === 'SUCCESS' || ve.status === 'CONSENT_APPROVED',
        elegibilidade: ve.availableMarginValue ? {
          margemDisponivel: parseFloat(ve.availableMarginValue),
          empregador: null
        } : null,
        mensagem: `Status V8: ${ve.status}${ve.descricao ? ' — ' + ve.descricao : ''}`
      });
    } else {
      ofertas.push({
        banco: 'v8',
        label: 'V8 Sistema',
        disponivel: false,
        mensagem: temNomeETel
          ? 'V8 nao retornou simulacao (verificar V8_AUDIENCE configurado ou aguardar status)'
          : 'Faltou nome+telefone'
      });
    }

    // ─── Etapa 6: resumo ───
    const totalDisponivel = ofertas.filter(o => o.disponivel).length;

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
        ? `${totalDisponivel} de 3 bancos com oferta disponível`
        : 'Nenhum banco retornou oferta disponível pra esse CPF',
      _raw: {
        presencabank: pb,
        multicorban: mc,
        c6,
        presencabankTabelas: pbTabelas,
        joinbank: jbSim,
        v8Existing: v8Existing?.data,
        v8Sim
      }
    }, 200, req);

  } catch (err) {
    console.error('clt-oportunidades erro:', err);
    return jsonResp({ error: 'Erro interno', message: err.message }, 500, req);
  }
}
