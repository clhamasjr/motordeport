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
import { dbUpsert, dbSelect } from './_lib/supabase.js';

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

    // ─── Catalogo: bancos com ativo=false sao pulados (em manutencao) ───
    // Busca rapida (~30ms). Se falhar, default = todos ativos (fail open).
    const { data: bancosCat = [] } = await dbSelect('clt_bancos', { limit: 100 }).catch(() => ({ data: [] }));
    const bancosMap = new Map((bancosCat || []).map(b => [b.slug, b]));
    const isAtivo = (slug) => bancosMap.get(slug)?.ativo !== false; // default true se nao cadastrado
    const skipped = (slug) => ({ ok: false, data: { _emManutencao: true, _slug: slug } });
    const msgManutencao = (slug, label) => {
      const b = bancosMap.get(slug);
      const obs = b?.observacoes || '';
      // Pega a primeira frase (até "—" ou ".") da observação se começar com 🔧
      const m = obs.match(/^(🔧[^—.]*)/);
      return m ? m[1].trim() : '🔧 Em manutenção — voltará em breve';
    };
    const cardManutencao = (slug, label) => ({
      banco: slug, label, disponivel: false, emManutencao: true,
      mensagem: msgManutencao(slug, label)
    });

    // ─── FASE 1: chamadas básicas em paralelo (não exigem dados do cliente) ─
    // PresençaBank, Multicorban, V8 (QI + CELCOIN), C6 status, Mercantil iniciarOperacao
    // NovaVida fica como FALLBACK (so se PB+MC nao encontrarem)
    // JoinBank vai pra FASE 2 (precisa nome+dataNasc do cliente)
    const tarefas = [
      isAtivo('presencabank')
        ? callApi('/api/presencabank', { action: 'oportunidadesPorCPF', cpf }, auth, secret)
        : Promise.resolve(skipped('presencabank')),
      callApi('/api/multicorban',   { action: 'consult_clt', cpf },         auth, secret),
      isAtivo('v8_qi') && isAtivo('v8')
        ? callApi('/api/v8', { action: 'consultarPorCPF', cpf, provider: 'QI' }, auth, secret).catch(() => ({ ok: false }))
        : Promise.resolve(skipped('v8_qi')),
      isAtivo('v8_celcoin') && isAtivo('v8')
        ? callApi('/api/v8', { action: 'consultarPorCPF', cpf, provider: 'CELCOIN' }, auth, secret).catch(() => ({ ok: false }))
        : Promise.resolve(skipped('v8_celcoin')),
      // C6: SEMPRE checa status de autorizacao primeiro (gratis, rapido).
      isAtivo('c6')
        ? callApi('/api/c6', { action: 'statusAutorizacao', cpf }, auth, secret).catch(() => ({ ok: false }))
        : Promise.resolve(skipped('c6')),
      // Mercantil: iniciarOperacao só checa cadastro. Se JWT inválido, mb.error
      // contém 'JWT' — frontend mostra "JWT expirado, admin precisa renovar".
      isAtivo('mercantil')
        ? callApi('/api/mercantil', { action: 'iniciarOperacao', cpf, convenio: 'MTE' }, auth, secret).catch(() => ({ ok: false }))
        : Promise.resolve(skipped('mercantil')),
      // Handbank/UY3: iniciarConsultaCLT tambem checa autorizacao do cliente.
      // Retorna 202 + linkAutorizacao quando cliente ainda nao autorizou no UY3.
      isAtivo('handbank')
        ? callApi('/api/handbank', { action: 'iniciarConsultaCLT', cpf }, auth, secret).catch(() => ({ ok: false }))
        : Promise.resolve(skipped('handbank'))
    ];
    const [pbOpor, mcClt, v8QI, v8Celcoin, c6Status, merc, hb] = await Promise.all(tarefas);

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

    // V8 (QI ou CELCOIN) retorna nome do cliente em consultarPorCPF se ja existe
    // consult anterior — aproveita isso pra nao depender so de PB/MC/NV
    const v8Nome = v8QI?.data?.nome || v8Celcoin?.data?.nome || null;
    const cliente = {
      // Prioridade: manual (operador) > MC > PB > V8 > NV
      nome: nomeManual || mc.nome || pb.dadosCliente?.nome || v8Nome || nv.nome || null,
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
    // ─── AUTO-GERAR TERMO V8 (QI + CELCOIN) se nao existir ainda ───
    // V8 precisa: cpf, nome, dataNascimento, email, telefone, sexo.
    // Pra campos administrativos sem dado real, usamos defaults seguros
    // (eh so pra registro do termo — o email/telefone real do cliente
    // sao usados depois no momento de criar a proposta de verdade).
    function precisaTermo(existing) {
      // Se nao foi encontrado consultarPorCPF, ou foi mas esta REJECTED/FAILED
      // tentamos gerar. Se ja eh SUCCESS ou esta processando, nao mexemos.
      if (!existing?.encontrado) return true;
      const st = existing.status;
      return st === 'REJECTED' || st === 'FAILED';
    }
    const tellQI = v8QI?.data;
    const tellCELCOIN = v8Celcoin?.data;
    const podeGerar = !!(cliente.nome && cliente.dataNascimento);

    if (podeGerar && (precisaTermo(tellQI) || precisaTermo(tellCELCOIN))) {
      const dataIso = cliente.dataNascimento.includes('-') ? cliente.dataNascimento : ddMmYyToIso(cliente.dataNascimento);
      const sexoPadrao = (cliente.sexo || 'M').toUpperCase().startsWith('F') ? 'F' : 'M';
      const telefonePadrao = cliente.telefones?.[0]?.completo || '11900000000';
      const emailPadrao = (cliente.emails?.[0]) || `${cpf}@lead.lhamascred.com.br`;
      const payloadTermo = {
        action: 'gerarTermo',
        cpf,
        nome: cliente.nome,
        dataNascimento: dataIso,
        email: emailPadrao,
        telefone: telefonePadrao,
        sexo: sexoPadrao
      };

      // Gera termo nos 2 providers em paralelo
      const tarefasTermo = [];
      if (precisaTermo(tellQI)) {
        tarefasTermo.push(callApi('/api/v8', { ...payloadTermo, provider: 'QI' }, auth, secret).catch(() => ({ ok: false })));
      } else { tarefasTermo.push(Promise.resolve(null)); }
      if (precisaTermo(tellCELCOIN)) {
        tarefasTermo.push(callApi('/api/v8', { ...payloadTermo, provider: 'CELCOIN' }, auth, secret).catch(() => ({ ok: false })));
      } else { tarefasTermo.push(Promise.resolve(null)); }
      const [termoQI, termoCelcoin] = await Promise.all(tarefasTermo);

      // Auto-autoriza os termos que foram criados (Lhamas como correspondente)
      const tarefasAutz = [];
      if (termoQI?.data?.consultId) {
        tarefasAutz.push(callApi('/api/v8', { action: 'autorizarTermo', consultId: termoQI.data.consultId, provider: 'QI' }, auth, secret).catch(() => ({ ok: false })));
      }
      if (termoCelcoin?.data?.consultId) {
        tarefasAutz.push(callApi('/api/v8', { action: 'autorizarTermo', consultId: termoCelcoin.data.consultId, provider: 'CELCOIN' }, auth, secret).catch(() => ({ ok: false })));
      }
      if (tarefasAutz.length > 0) await Promise.all(tarefasAutz);

      // Re-consulta status pra ver se ficou SUCCESS
      const tarefasRe = [];
      if (termoQI?.data?.consultId) {
        tarefasRe.push(callApi('/api/v8', { action: 'consultarPorCPF', cpf, provider: 'QI' }, auth, secret).catch(() => ({ ok: false })));
      } else { tarefasRe.push(Promise.resolve(null)); }
      if (termoCelcoin?.data?.consultId) {
        tarefasRe.push(callApi('/api/v8', { action: 'consultarPorCPF', cpf, provider: 'CELCOIN' }, auth, secret).catch(() => ({ ok: false })));
      } else { tarefasRe.push(Promise.resolve(null)); }
      const [reQI, reCelcoin] = await Promise.all(tarefasRe);
      if (reQI?.data) v8QI.data = reQI.data;
      if (reCelcoin?.data) v8Celcoin.data = reCelcoin.data;
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

    // ─── MERCANTIL — card baseado no resultado do iniciarOperacao (Fase 1) ──
    const mb = merc?.data || {};
    if (mb.error && String(mb.error).toUpperCase().includes('JWT')) {
      ofertas.push({
        banco: 'mercantil', label: 'Mercantil',
        disponivel: false, bloqueado: true,
        mensagem: 'Token Mercantil expirado. Admin precisa renovar em CLT > Token Mercantil.'
      });
    } else if (mb.success && mb.temCadastro && mb.tokenValidoConsignadoPrivado) {
      ofertas.push({
        banco: 'mercantil', label: 'Mercantil',
        disponivel: true,
        operacaoId: mb.operacaoId,
        elegibilidade: { empregador: null, nomeCliente: mb.nomeCliente },
        mensagem: `Cliente elegível (${mb.nomeCliente || cliente.nome || 'cadastrado'}) — clique Digitar pra simular.`
      });
    } else if (mb.success && mb.temCadastro && mb.precisaAutorizacao) {
      ofertas.push({
        banco: 'mercantil', label: 'Mercantil',
        disponivel: false, bloqueado: true,
        operacaoId: mb.operacaoId,
        precisaAutorizacao: true,
        mensagem: `Cliente cadastrado (${mb.nomeCliente || ''}) — precisa autorizar consulta. Clique pra enviar SMS de autorização.`
      });
    } else if (mb.semCadastro) {
      ofertas.push({
        banco: 'mercantil', label: 'Mercantil',
        disponivel: false,
        mensagem: 'Cliente sem cadastro prévio no Mercantil'
      });
    } else {
      ofertas.push({
        banco: 'mercantil', label: 'Mercantil',
        disponivel: false,
        mensagem: mb.mensagem || mb.error || 'Falha ao consultar Mercantil'
      });
    }

    // ─── HANDBANK/UY3 — card baseado no resultado de iniciarConsultaCLT ──
    // 3 cenarios mapeados pelo handbank.js:
    //   precisaAutorizacao=true  → 202: link autz UY3
    //   autorizado=true          → 201: tem margem
    //   bloqueado=true           → 400: ja tem contrato OU impedimento
    const hbData = hb?.data || {};
    if (hbData.precisaAutorizacao && hbData.linkAutorizacao) {
      ofertas.push({
        banco: 'handbank', label: 'Handbank · UY3',
        disponivel: false, bloqueado: true,
        precisaAutorizacao: true,
        linkAutorizacao: hbData.linkAutorizacao,
        mensagem: 'Cliente precisa autorizar a consulta UY3 (cadastro com selfie). Clique pra enviar link via WhatsApp.'
      });
    } else if (hbData.autorizado === true && hbData.disponivel) {
      const hbMargemNum = typeof hbData.margem === 'number' ? hbData.margem : Number(hbData.margem) || 0;
      ofertas.push({
        banco: 'handbank', label: 'Handbank · UY3',
        disponivel: true,
        elegibilidade: {
          margemDisponivel: hbMargemNum,
          empregador: hbData.empregador,
          empregadorCnpj: hbData.empregadorCnpj,
          matricula: hbData.matricula,
          renda: hbData.renda
        },
        dados: hbData,
        mensagem: hbMargemNum > 0
          ? `Cliente elegível — margem R$ ${hbMargemNum.toFixed(2)}`
          : (hbData.mensagem || 'Cliente elegível mas sem margem disponível')
      });
    } else if (hbData.bloqueado && hbData.jaTemContrato) {
      ofertas.push({
        banco: 'handbank', label: 'Handbank · UY3',
        disponivel: false, bloqueado: true,
        mensagem: hbData.mensagem || 'Cliente já possui contrato ativo na UY3.'
      });
    } else if (hbData._httpStatus === 400) {
      ofertas.push({
        banco: 'handbank', label: 'Handbank · UY3',
        disponivel: false,
        mensagem: hbData.mensagem || 'UY3 recusou consulta'
      });
    } else {
      ofertas.push({
        banco: 'handbank', label: 'Handbank · UY3',
        disponivel: false,
        mensagem: hbData.mensagem || hbData.error || 'Aguardando resposta do Handbank'
      });
    }

    // ─── FASE 2: JoinBank/QualiBanking (precisa cliente.nome + dataNasc) ───
    // Roda só se temos dados suficientes do enriquecimento (PB+MC+manual).
    // Tempo: ~8-12s (4 chamadas em série encapsuladas em cltCheckEligibility).
    if (cliente.nome && cliente.dataNascimento) {
      try {
        const dataIso = String(cliente.dataNascimento).includes('-')
          ? cliente.dataNascimento
          : ddMmYyToIso(cliente.dataNascimento);
        const sexoNorm = (cliente.sexo || 'M').toUpperCase().startsWith('F') ? 'female' : 'male';
        const borrower = {
          identity: cpf,
          name: cliente.nome,
          birthDate: dataIso,
          motherName: cliente.nomeMae || undefined,
          gender: sexoNorm
        };
        if (cliente.telefones?.[0]?.completo) {
          borrower.phone = String(cliente.telefones[0].completo).replace(/\D/g, '');
        }
        const jbR = await callApi('/api/joinbank', {
          action: 'cltCheckEligibility', borrower, providerCode: '950002'
        }, auth, secret).catch(() => ({ ok: false, data: {} }));
        const jb = jbR.data || {};
        if (jb.disponivel) {
          // QITech retorna availableMargin = 0 no checkEligibility (preenche so apos cltCalculate).
          // Estimamos margem teorica = 35% da renda (lei do consignado CLT) pra dar feedback ao operador.
          const rendaJb = parseFloat(jb.vinculo?.renda || 0);
          const margemTeorica = rendaJb > 0 ? rendaJb * 0.35 : null;
          ofertas.push({
            banco: 'joinbank', label: 'QualiBanking',
            disponivel: true,
            simulationId: jb.simulationId,
            elegibilidade: {
              empregador: jb.vinculo?.empregador,
              empregadorCnpj: jb.vinculo?.empregadorCnpj,
              matricula: jb.vinculo?.matricula,
              margemDisponivel: jb.vinculo?.margemDisponivel,
              margemTeorica,
              renda: jb.vinculo?.renda
            },
            mensagem: `Cliente elegível — ${jb.vinculo?.empregador || 'empregador'}. Calculando valor liberado...`
          });
        } else {
          ofertas.push({
            banco: 'joinbank', label: 'QualiBanking',
            disponivel: false,
            simulationId: jb.simulationId || null,
            mensagem: jb.motivo || 'Sem vínculo CLT elegível pra este banco'
          });
        }
      } catch (e) {
        ofertas.push({
          banco: 'joinbank', label: 'QualiBanking',
          disponivel: false,
          mensagem: 'Erro consultando QualiBanking: ' + (e.message || 'desconhecido')
        });
      }
    } else {
      ofertas.push({
        banco: 'joinbank', label: 'QualiBanking',
        disponivel: false,
        mensagem: 'Faltam dados básicos do cliente (nome ou data de nascimento)'
      });
    }

    // ─── Defensivo: sobrescreve cards de bancos em manutencao ───
    // Mesmo se a chamada tiver sido feita (ex: banco entrou em manutencao
    // depois do bancosMap ja carregado, ou nao foi pulado por slug), garante
    // que o card final mostre o aviso de manutencao em vez do erro real.
    for (let i = 0; i < ofertas.length; i++) {
      const o = ofertas[i];
      if (bancosMap.get(o.banco)?.ativo === false) {
        ofertas[i] = cardManutencao(o.banco, o.label);
      }
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
        ? `${totalDisponivel} banco(s) com oferta disponível`
        : 'Nenhum banco retornou oferta disponível pra esse CPF',
      _raw: {
        presencabank: pb,
        multicorban: mc,
        novavida: nv,
        c6,
        mercantil: mb,
        handbank: hbData,
        v8QI: v8QI?.data,
        v8Celcoin: v8Celcoin?.data
      }
    }, 200, req);

  } catch (err) {
    console.error('clt-oportunidades erro:', err);
    return jsonResp({ error: 'Erro interno', message: err.message }, 500, req);
  }
}
