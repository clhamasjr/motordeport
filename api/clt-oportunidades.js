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
import { dbUpsert } from './_lib/supabase.js';

const APP_URL = () => process.env.APP_URL || 'https://flowforce.vercel.app';

// Persiste cliente em clt_clientes (UPSERT por cpf). Nunca quebra fluxo.
// Chame com TODOS os dados que voce conhece — campos null/undefined nao
// sobreescrevem os existentes (filtramos antes).
async function persistirCliente(cpf, dados, fontes = {}) {
  if (!cpf) return null;
  try {
    // Remove undefined/null/string vazia pra nao sobreescrever dados existentes com vazio
    const limpo = {};
    for (const [k, v] of Object.entries(dados)) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'string' && v.trim() === '') continue;
      if (Array.isArray(v) && v.length === 0) continue;
      limpo[k] = v;
    }
    limpo.cpf = cpf;
    limpo.fontes = fontes;
    limpo.ultima_consulta_at = new Date().toISOString();
    const { data, error } = await dbUpsert('clt_clientes', limpo, 'cpf');
    if (error) return { error };
    // Incrementa contador via UPDATE separado (Postgrest UPSERT nao suporta SQL inline)
    return { ok: true, data };
  } catch (e) {
    return { error: e.message };
  }
}

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

    // Nome manual (opcional) — operador digitou na consulta unitaria.
    // Se vier, sobrescreve o nome enriquecido (PB/MC nao trazem nome cadastral).
    const nomeManual = (body.nome || '').toString().trim() || null;

    // C6 só consulta se opt-in (default false) — exige autorização LGPD via selfie,
    // que cliente precisa fazer primeiro. Frontend libera o C6 explicitamente.
    const incluirC6 = body.incluirC6 === true;

    const auth = req.headers.get('Authorization') || '';
    // Se temos WEBHOOK_SECRET, usa ele nas chamadas internas (mais robusto)
    const secret = process.env.WEBHOOK_SECRET || '';

    // ─── ETAPA ÚNICA: chamadas básicas em paralelo ─
    // Padrão: V8 (QI + CELCOIN) + PresençaBank + Multicorban
    // C6 só entra se incluirC6=true (cliente autorizou)
    // NovaVida fica como FALLBACK (so se PB+MC nao encontrarem) + on-demand
    // depois (quando cliente aceita oferta, pra completar email/endereco/etc)
    const tarefas = [
      callApi('/api/presencabank', { action: 'oportunidadesPorCPF', cpf }, auth, secret),
      callApi('/api/multicorban',   { action: 'consult_clt', cpf },         auth, secret),
      callApi('/api/v8',            { action: 'consultarPorCPF', cpf, provider: 'QI' },     auth, secret).catch(() => ({ ok: false })),
      callApi('/api/v8',            { action: 'consultarPorCPF', cpf, provider: 'CELCOIN' }, auth, secret).catch(() => ({ ok: false })),
      // C6: SEMPRE checa status de autorizacao primeiro (gratis, rapido).
      // Se cliente ja tem autorizacao, roda oferta completa. Se nao, mostra bloqueado.
      callApi('/api/c6', { action: 'statusAutorizacao', cpf }, auth, secret).catch(() => ({ ok: false }))
    ];
    const [pbOpor, mcClt, v8QI, v8Celcoin, c6Status] = await Promise.all(tarefas);

    // Se C6 ja autorizado, busca oferta tambem (em paralelo nao da pra fazer porque depende do status)
    let c6Of = { ok: false, data: { _bloqueado: true } };
    const c6Autorizado = c6Status?.data?.autorizado === true || c6Status?.data?.statusAutorizacao === 'AUTORIZADO';
    if (c6Autorizado || incluirC6) {
      c6Of = await callApi('/api/c6', { action: 'oferta', cpf, skipAuthCheck: c6Autorizado }, auth, secret).catch(() => ({ ok: false, data: {} }));
    }

    // ─── Mescla dados do cliente (PresençaBank > Multicorban) ─────
    const pb = pbOpor.data || {};
    const mc = mcClt.data?.parsed || {};

    // Telefones: vindos de Multicorban
    const telefonesMap = new Map();
    for (const t of (mc.telefones || [])) {
      const key = `${(t.ddd||'').replace(/\D/g,'')}-${(t.numero||'').replace(/\D/g,'')}`;
      if (key !== '-') telefonesMap.set(key, {
        ddd: t.ddd, numero: t.numero, completo: t.completo, whatsapp: t.whatsapp, fonte: 'multicorban'
      });
    }

    // ─── FALLBACK NovaVida: so chama se PB+MC nao trouxeram nome OU telefone ─
    // (NovaVida eh paga por consulta, entao so usa quando realmente precisa)
    let nv = {};
    let novaVidaUsada = false;
    const nomeBase = mc.nome || pb.dadosCliente?.nome;
    const temTelefone = telefonesMap.size > 0;
    if (!nomeBase || !temTelefone) {
      try {
        const nvRes = await callApi('/api/novavida', { cpf }, auth, secret);
        nv = nvRes?.data || {};
        novaVidaUsada = true;
        // Adiciona telefones da NovaVida que nao tinham antes
        for (const t of (nv.telefones || [])) {
          const key = `${(t.ddd||'').replace(/\D/g,'')}-${(t.telefone||'').replace(/\D/g,'')}`;
          if (key !== '-' && !telefonesMap.has(key)) telefonesMap.set(key, {
            ddd: t.ddd, numero: t.telefone, completo: `${t.ddd}${t.telefone}`, whatsapp: t.whatsapp, fonte: 'novavida'
          });
        }
      } catch { /* falhou - segue sem NovaVida */ }
    }

    const cliente = {
      // Prioridade: manual (digitado pelo operador) > MC > PB > NV
      nome: nomeManual || mc.nome || pb.dadosCliente?.nome || nv.nome || null,
      cpf,
      dataNascimento: pb.dadosCliente?.dataNascimento
                   || (mc.dataNascimento ? ddMmYyToIso(mc.dataNascimento) : null)
                   || (nv.nascimento ? ddMmYyToIso(nv.nascimento) : null),
      sexo: pb.dadosCliente?.sexo || mc.sexo || null,
      nomeMae: pb.dadosCliente?.nomeMae || mc.nomeMae || null,
      nomePai: mc.nomePai || null,
      idade: mc.idade || nv.idade || null,
      telefones: Array.from(telefonesMap.values()),
      // Enderecos e emails da NovaVida (so se foi consultada nesse fallback)
      enderecos: (nv.enderecos || []).map(e => ({
        tipo: e.tipo, logradouro: e.logradouro, numero: e.numero, complemento: e.complemento,
        bairro: e.bairro, cidade: e.cidade, uf: e.uf, cep: (e.cep || '').replace(/\D/g, '')
      })),
      emails: nv.emails || [],
      obito: !!nv.obito
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
        mensagem: pb.mensagem || 'Sem vínculo CLT elegível pra este banco'
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
            ? 'Aguardando geração de termo. Clique Digitar pra prosseguir.'
            : 'Faltam dados básicos do cliente (nome, data de nascimento ou telefone).'
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
          mensagem: `❌ ${st}: ${existing.descricao || 'cliente rejeitado'}`
        });
      } else {
        ofertas.push({
          banco: 'v8', provider, label,
          disponivel: false,
          processando: true,
          consultId: existing.consultId,
          mensagem: `${st} — aguardando confirmação (pode levar até 5min)`
        });
      }
    }
    montarCardV8('QI', 'V8 (QI Tech)', v8QI?.data);
    montarCardV8('CELCOIN', 'V8 (CELCOIN)', v8Celcoin?.data);

    // C6 — montagem do card baseada no status de autorizacao + oferta (se rodou)
    const c6 = c6Of.data || {};
    if (c6Autorizado) {
      // Cliente JA autorizou anteriormente — mostra oferta direto se houver
      ofertas.push({
        banco: 'c6',
        label: 'C6 Bank',
        disponivel: !!(c6.success && c6.temOferta),
        statusAutorizacao: 'AUTORIZADO',
        ja_autorizado: true,
        detalhes: c6.temOferta ? {
          valorLiquido: c6.oferta?.valorCliente,
          parcelas: c6.oferta?.qtdParcelas,
          valorParcela: c6.oferta?.valorParcela,
          seguroSugerido: c6.oferta?.valorSeguroSugerido
        } : null,
        mensagem: c6.temOferta
          ? `Cliente já autorizado — oferta disponível.`
          : (c6.mensagem || 'Cliente já autorizado, mas sem oferta disponível no momento.')
      });
    } else {
      // Cliente nunca autorizou OU autorizacao expirou — precisa selfie
      const status = c6Status?.data?.statusAutorizacao || 'NAO_AUTORIZADO';
      ofertas.push({
        banco: 'c6',
        label: 'C6 Bank',
        disponivel: false,
        bloqueado: true,
        statusAutorizacao: status,
        mensagem: status === 'AGUARDANDO_AUTORIZACAO'
          ? 'Aguardando cliente fazer a selfie de autorização (link já enviado).'
          : status === 'NAO_AUTORIZADO'
          ? 'Cliente recusou ou link expirou. Clique pra gerar nova selfie de autorização.'
          : 'Cliente ainda não autorizou. Clique pra gerar selfie de autorização e enviar via WhatsApp.'
      });
    }

    const totalDisponivel = ofertas.filter(o => o.disponivel).length;
    const telefonePrincipal = cliente.telefones?.[0]?.completo || null;
    const temNomeETel = !!(cliente.nome && telefonePrincipal);

    // ─── Persiste cliente em clt_clientes (UPSERT por cpf) ───
    // Sempre atualiza com TUDO que sabemos hoje. Campos vazios nao sobreescrevem.
    const enderecoNV = cliente.enderecos?.[0] || {};
    await persistirCliente(cpf, {
      nome: cliente.nome,
      data_nascimento: cliente.dataNascimento,
      sexo: cliente.sexo,
      nome_mae: cliente.nomeMae,
      nome_pai: cliente.nomePai,
      idade: cliente.idade,
      telefones: cliente.telefones,
      enderecos: cliente.enderecos,
      emails: cliente.emails,
      email: cliente.emails?.[0] || null,
      cep: enderecoNV.cep || null,
      rua: enderecoNV.logradouro || null,
      numero_end: enderecoNV.numero || null,
      complemento: enderecoNV.complemento || null,
      bairro: enderecoNV.bairro || null,
      cidade: enderecoNV.cidade || null,
      uf: enderecoNV.uf || null,
      empregador_nome: vinculo?.empregador,
      empregador_cnpj: vinculo?.cnpj,
      matricula: vinculo?.matricula,
      renda: vinculo?.renda,
      saldo_fgts_aproximado: vinculo?.saldoAproximadoFgts,
      data_admissao: vinculo?.dataAdmissao,
      tempo_contribuicao_meses: vinculo?.tempoContribuicaoMeses,
      obito: cliente.obito
    }, {
      presencaBank: pbOpor.ok && pb.temVinculo,
      multicorban: mcClt.ok && !!mc.nome,
      novaVida: novaVidaUsada,
      manual: !!nomeManual,
      atualizadoEm: new Date().toISOString()
    });

    return jsonResp({
      success: true,
      cpf,
      cliente,
      vinculo,
      margemPresencaBank: margem,
      enriquecimento: {
        presencaBankOk: pbOpor.ok && pb.temVinculo,
        multicorbanOk: mcClt.ok && !!mc.nome,
        novaVidaUsada,
        novaVidaOk: novaVidaUsada && !!(nv.success || nv.nome || (nv.telefones || []).length > 0),
        nomeOrigem: mc.nome ? 'multicorban' : (pb.dadosCliente?.nome ? 'presencabank' : (nv.nome ? 'novavida' : null)),
        telefoneOrigem: cliente.telefones?.[0]?.fonte || null,
        enderecoOrigem: cliente.enderecos?.length > 0 ? 'novavida' : null,
        emailOrigem: cliente.emails?.length > 0 ? 'novavida' : null
      },
      ofertas,
      totalBancosDisponiveis: totalDisponivel,
      mensagem: totalDisponivel > 0
        ? `${totalDisponivel} de 4 bancos com oferta disponível`
        : 'Nenhum banco retornou oferta disponível pra esse CPF',
      _raw: {
        presencabank: pb,
        multicorban: mc,
        novavida: nv,
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
