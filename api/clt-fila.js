// ══════════════════════════════════════════════════════════════════
// api/clt-fila.js
// ESTEIRA DE CONSULTAS CLT — operador adiciona, sistema processa
// banco-a-banco em paralelo, frontend faz polling pra ver progresso.
//
// Actions:
//   - criar      → cria registro + retorna id (frontend dispara processadores)
//   - processar  → executa UM banco (params: id, banco)
//   - status     → retorna estado atual (params: id) — pra polling do frontend
//   - listar     → lista paginada (com filtros opcionais)
//
// Bancos válidos: presencabank | multicorban | v8_qi | v8_celcoin | c6
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';
import { dbSelect, dbInsert, dbUpdate, dbUpsert } from './_lib/supabase.js';

const APP_URL = () => process.env.APP_URL || 'https://flowforce.vercel.app';

// Edge functions Vercel tem ~25s limit. Pra evitar morte abrupta da
// funcao processar (que deixa status preso em 'processando'), abortamos
// chamadas externas em 18s e tratamos como falha graciosa.
async function callApi(path, payload, authHeader, internalSecret, timeoutMs = 18000) {
  const headers = { 'Content-Type': 'application/json' };
  if (internalSecret) headers['x-internal-secret'] = internalSecret;
  if (authHeader) headers['Authorization'] = authHeader;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(APP_URL() + path, {
      method: 'POST', headers, body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    const t = await r.text();
    let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 500) }; }
    return { ok: r.ok, status: r.status, data: d };
  } catch (e) {
    if (e.name === 'AbortError') {
      return { ok: false, status: 408, data: { error: 'Timeout (18s) — banco lento, marca como falha pra retry' } };
    }
    return { ok: false, status: 0, data: { error: e.message } };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeCPF(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d || d.length > 11 || d.length < 9) return null;
  return d.padStart(11, '0');
}

function ddMmYyToIso(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}

// Atualiza UM banco no jsonb bancos sem sobrescrever os outros
async function patchBanco(id, banco, payload) {
  // Lê estado atual
  const { data: row } = await dbSelect('clt_consultas_fila', { filters: { id }, single: true });
  if (!row) return { error: 'fila nao encontrada' };
  const bancos = { ...(row.bancos || {}) };
  bancos[banco] = { ...(bancos[banco] || {}), ...payload, atualizado_em: new Date().toISOString() };

  // Marca conclusao se todos terminaram
  const todosTerminaram = ['presencabank', 'multicorban', 'v8_qi', 'v8_celcoin', 'c6']
    .every(b => bancos[b] && ['ok','falha','bloqueado','pulado'].includes(bancos[b].status));
  const patch = { bancos };
  if (todosTerminaram && row.status_geral !== 'concluido') {
    patch.status_geral = 'concluido';
    patch.concluido_em = new Date().toISOString();
  }
  await dbUpdate('clt_consultas_fila', { id }, patch);
  return { ok: true, todosTerminaram };
}

// Espera ate aparecer cliente.nome+dataNascimento no registro (timeout configuravel)
// Usado pelos processadores V8 que precisam dos dados do enriquecimento.
// FALLBACK: se PB+MC nao trouxerem, busca em clt_clientes (cache de consultas
// anteriores) e mescla na fila. Resolve casos onde o cliente ja foi consultado
// antes mas a consulta atual nao trouxe dados (ex: PB sem vinculo nesta vez).
async function aguardarCliente(id, timeoutMs = 9000, intervalMs = 700) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    const { data: row } = await dbSelect('clt_consultas_fila', { filters: { id }, single: true });
    const cli = row?.cliente || {};
    if (cli.nome && cli.dataNascimento) return cli;

    // Apos 4s sem ter dados completos da consulta atual, busca em clt_clientes
    // (cache de qualquer consulta anterior do mesmo CPF)
    if (Date.now() - inicio > 4000 && row?.cpf) {
      try {
        const { data: clienteSalvo } = await dbSelect('clt_clientes', { filters: { cpf: row.cpf }, single: true });
        if (clienteSalvo) {
          const enriquecido = { ...cli };
          if (clienteSalvo.nome && !enriquecido.nome) enriquecido.nome = clienteSalvo.nome;
          if (clienteSalvo.data_nascimento && !enriquecido.dataNascimento) enriquecido.dataNascimento = clienteSalvo.data_nascimento;
          if (clienteSalvo.sexo && !enriquecido.sexo) enriquecido.sexo = clienteSalvo.sexo;
          if (clienteSalvo.nome_mae && !enriquecido.nomeMae) enriquecido.nomeMae = clienteSalvo.nome_mae;
          if (clienteSalvo.telefones?.length && !enriquecido.telefones?.length) enriquecido.telefones = clienteSalvo.telefones;
          if (clienteSalvo.emails?.length && !enriquecido.emails?.length) enriquecido.emails = clienteSalvo.emails;
          if (enriquecido.nome && enriquecido.dataNascimento) {
            // Salva enriquecido na fila pra outros processadores aproveitarem
            await dbUpdate('clt_consultas_fila', { id }, { cliente: enriquecido });
            return enriquecido;
          }
        }
      } catch { /* segue tentando aguardar PB/MC */ }
    }

    await new Promise(r => setTimeout(r, intervalMs));
  }
  return null;
}

// Mescla dados do cliente (PB > MC > NV) preservando o que ja foi salvo
// E persiste em clt_clientes pra reusar em consultas futuras
async function mesclarCliente(id, novoBloco) {
  const { data: row } = await dbSelect('clt_consultas_fila', { filters: { id }, single: true });
  const atual = row?.cliente || {};
  const merged = { ...novoBloco, ...atual }; // ATUAL tem prioridade (nao sobrescreve)
  for (const k of Object.keys(novoBloco)) {
    if (atual[k] === null || atual[k] === undefined || atual[k] === '' ||
        (Array.isArray(atual[k]) && atual[k].length === 0)) {
      merged[k] = novoBloco[k];
    }
  }
  await dbUpdate('clt_consultas_fila', { id }, { cliente: merged });

  // Persiste em clt_clientes (UPSERT por cpf) — campos vazios nao sobrescrevem
  if (row?.cpf) {
    try {
      const persistir = {
        cpf: row.cpf,
        ultima_consulta_at: new Date().toISOString()
      };
      if (merged.nome) persistir.nome = merged.nome;
      if (merged.dataNascimento) persistir.data_nascimento = merged.dataNascimento;
      if (merged.sexo) persistir.sexo = merged.sexo;
      if (merged.nomeMae) persistir.nome_mae = merged.nomeMae;
      if (merged.idade) persistir.idade = merged.idade;
      if (Array.isArray(merged.telefones) && merged.telefones.length > 0) persistir.telefones = merged.telefones;
      if (Array.isArray(merged.emails) && merged.emails.length > 0) {
        persistir.emails = merged.emails;
        persistir.email = merged.emails[0];
      }
      await dbUpsert('clt_clientes', persistir, 'cpf');
    } catch { /* nao quebra fluxo */ }
  }
}

// ═══════════════════════════════════════════════════════════════════
// PROCESSADORES POR BANCO
// ═══════════════════════════════════════════════════════════════════

async function processarPresencaBank(id, cpf, auth, secret) {
  await patchBanco(id, 'presencabank', { status: 'processando' });
  const r = await callApi('/api/presencabank', { action: 'oportunidadesPorCPF', cpf }, auth, secret);
  const pb = r.data || {};

  // Mescla dados de cliente / vinculo na fila
  const novoCliente = {};
  if (pb.dadosCliente?.dataNascimento) novoCliente.dataNascimento = pb.dadosCliente.dataNascimento;
  if (pb.dadosCliente?.sexo) novoCliente.sexo = pb.dadosCliente.sexo;
  if (pb.dadosCliente?.nomeMae) novoCliente.nomeMae = pb.dadosCliente.nomeMae;
  if (pb.dadosCliente?.nome) novoCliente.nome = pb.dadosCliente.nome;
  if (Object.keys(novoCliente).length > 0) await mesclarCliente(id, novoCliente);

  if (pb.temVinculo) {
    const vinculoData = {
      matricula: pb.vinculo?.matricula,
      cnpj: pb.vinculo?.cnpj,
      empregador: pb.vinculo?.empregador,
      dataAdmissao: pb.vinculo?.dataAdmissao
    };
    await dbUpdate('clt_consultas_fila', { id }, { vinculo: vinculoData });
    // PERSISTE response RAW pra inspecao posterior (debug)
    await patchBanco(id, 'presencabank', { _raw_response: pb._raw }).catch(() => {});
    const margemDisp = parseFloat(pb.margem?.disponivel || 0);
    const margemBase = parseFloat(pb.margem?.base || 0);

    // DETECTA FALHA TRANSITORIA: PB retorna 'temVinculo: true' mas margem zero
    // (acontece quando sessao deles esta com problema). NAO eh "sem margem real" —
    // eh response incompleto. Marcamos como falha pra re-tentar.
    if (margemDisp === 0 && margemBase === 0) {
      await patchBanco(id, 'presencabank', {
        status: 'falha',
        disponivel: false,
        mensagem: '⚠️ Resposta incompleta da API — clique em re-tentar (provavelmente glitch temporário)',
        retryable: true,
        dados: { empregador: pb.vinculo?.empregador }
      });
      return;
    }

    await patchBanco(id, 'presencabank', {
      status: 'ok',
      disponivel: true,
      mensagem: margemDisp > 0
        ? `Cliente elegível — margem R$ ${margemDisp.toFixed(2)}`
        : 'Cliente elegível mas sem margem disponível',
      dados: {
        margemDisponivel: margemDisp,
        margemBase: margemBase,
        empregador: pb.vinculo?.empregador
      }
    });
  } else {
    await patchBanco(id, 'presencabank', {
      status: 'falha',
      disponivel: false,
      mensagem: pb.mensagem || 'Sem vínculo CLT elegível pra este banco',
      _raw_response: pb._raw, // salva mesmo assim pra debug
      _totalVinculosBrutos: pb.totalVinculosBrutos // se PB recebeu vinculos mas todos elegivel=false
    });
  }
}

async function processarMulticorban(id, cpf, auth, secret) {
  await patchBanco(id, 'multicorban', { status: 'processando' });
  const r = await callApi('/api/multicorban', { action: 'consult_clt', cpf }, auth, secret);
  const mc = r.data?.parsed || {};

  const novoCliente = {};
  if (mc.nome) novoCliente.nome = mc.nome;
  if (mc.dataNascimento) novoCliente.dataNascimento = ddMmYyToIso(mc.dataNascimento);
  if (mc.sexo) novoCliente.sexo = mc.sexo;
  if (mc.nomeMae) novoCliente.nomeMae = mc.nomeMae;
  if (mc.nomePai) novoCliente.nomePai = mc.nomePai;
  if (mc.idade) novoCliente.idade = mc.idade;
  if (Array.isArray(mc.telefones) && mc.telefones.length > 0) {
    novoCliente.telefones = mc.telefones.map(t => ({
      ddd: t.ddd, numero: t.numero, completo: t.completo, whatsapp: t.whatsapp, fonte: 'multicorban'
    }));
  }
  if (Object.keys(novoCliente).length > 0) await mesclarCliente(id, novoCliente);

  await patchBanco(id, 'multicorban', {
    status: r.ok && mc.nome ? 'ok' : 'falha',
    mensagem: r.ok && mc.nome
      ? `Dados encontrados: nome, ${mc.telefones?.length || 0} telefone(s)${mc.trabalhista?.renda ? ', renda' : ''}`
      : (r.data?.error || 'Sem dados encontrados pra esse CPF'),
    dados: r.ok ? mc : null
  });
}

async function processarV8(id, provider, cpf, auth, secret) {
  const banco = provider === 'QI' ? 'v8_qi' : 'v8_celcoin';
  await patchBanco(id, banco, { status: 'processando' });

  // 1) Consulta status
  let consulta = await callApi('/api/v8', { action: 'consultarPorCPF', cpf, provider }, auth, secret).catch(() => ({ ok: false }));
  let v8 = consulta.data || {};

  // 2) Se nao tem termo (ou esta REJECTED/FAILED), tenta gerar
  const precisaTermo = !v8.encontrado || ['REJECTED', 'FAILED'].includes(v8.status);
  if (precisaTermo) {
    // Espera dados do enriquecimento (PB+MC) chegarem
    const cli = await aguardarCliente(id);
    if (!cli) {
      await patchBanco(id, banco, {
        status: 'falha',
        mensagem: 'Faltam dados básicos do cliente (nome ou data de nascimento)'
      });
      return;
    }

    const sexoPadrao = (cli.sexo || 'M').toUpperCase().startsWith('F') ? 'F' : 'M';
    const telefonePadrao = cli.telefones?.[0]?.completo || '11900000000';
    const emailPadrao = (cli.emails?.[0]) || `${cpf}@lead.lhamascred.com.br`;
    const dataIso = cli.dataNascimento.includes('-') ? cli.dataNascimento : ddMmYyToIso(cli.dataNascimento);

    const termoR = await callApi('/api/v8', {
      action: 'gerarTermo',
      cpf, provider,
      nome: cli.nome,
      dataNascimento: dataIso,
      email: emailPadrao,
      telefone: telefonePadrao,
      sexo: sexoPadrao
    }, auth, secret).catch(() => ({ ok: false }));

    if (termoR.data?.consultId) {
      // Auto-autoriza (Lhamas como correspondente)
      await callApi('/api/v8', { action: 'autorizarTermo', consultId: termoR.data.consultId, provider }, auth, secret).catch(() => {});
      // Re-consulta status
      consulta = await callApi('/api/v8', { action: 'consultarPorCPF', cpf, provider }, auth, secret).catch(() => ({ ok: false }));
      v8 = consulta.data || {};
    }
  }

  // 3) Avalia status final
  if (v8.encontrado && v8.status === 'SUCCESS') {
    await patchBanco(id, banco, {
      status: 'ok',
      disponivel: true,
      consultId: v8.consultId,
      mensagem: `Cliente elegível — margem R$ ${parseFloat(v8.availableMarginValue || 0).toFixed(2)}`,
      dados: {
        margemDisponivel: parseFloat(v8.availableMarginValue || 0),
        consultId: v8.consultId
      }
    });
  } else if (['REJECTED', 'FAILED'].includes(v8.status)) {
    await patchBanco(id, banco, {
      status: 'falha',
      mensagem: `❌ ${v8.status}: ${v8.descricao || 'cliente rejeitado'}`,
      dados: v8
    });
  } else if (v8.encontrado) {
    await patchBanco(id, banco, {
      status: 'processando',
      processando: true,
      consultId: v8.consultId,
      mensagem: `${v8.status} — aguardando confirmação (pode levar até 5min)`
    });
  } else {
    await patchBanco(id, banco, {
      status: 'falha',
      mensagem: 'Não foi possível gerar termo (faltam dados ou erro de comunicação)'
    });
  }
}

// Banco MERCANTIL — API REST real (Layer7 Gateway, JWT auth).
// Tenta API; se nao tiver JWT configurado (env MERCANTIL_JWT), cai pra
// modo digitacao manual (operador faz no portal e cadastra valor).
async function processarMercantil(id, cpf, auth, secret) {
  await patchBanco(id, 'mercantil', { status: 'processando' });

  // Tenta via API: iniciarOperacao confirma se cliente tem vinculo
  const r = await callApi('/api/mercantil', { action: 'iniciarOperacao', cpf, convenio: 'MTE' }, auth, secret);
  const mb = r.data || {};

  // Se erro de JWT nao configurado: cai pra modo manual (fallback)
  if (mb.error && String(mb.error).includes('JWT')) {
    await patchBanco(id, 'mercantil', {
      status: 'manual_aguardando',
      disponivel: false,
      manual: true,
      portalUrl: process.env.MERCANTIL_PORTAL_URL || 'https://meu.bancomercantil.com.br/login',
      mensagem: 'API não configurada — clique "Abrir Portal" e simule manualmente.'
    });
    return;
  }

  if (mb.success && mb.temVinculo) {
    await patchBanco(id, 'mercantil', {
      status: 'ok',
      disponivel: true,
      operacaoId: mb.operacaoId,
      mensagem: `Cliente elegível — operação ${mb.operacaoId}. Clique Digitar pra simular tabela.`,
      dados: { operacaoId: mb.operacaoId, convenio: mb.convenio }
    });
  } else {
    await patchBanco(id, 'mercantil', {
      status: 'falha',
      disponivel: false,
      mensagem: mb.dados?.mensagem || mb.error || 'Cliente sem vínculo no convênio MTE',
      _raw_response: mb
    });
  }
}

async function processarJoinBank(id, cpf, auth, secret) {
  await patchBanco(id, 'joinbank', { status: 'processando' });

  // Espera dados basicos do cliente (nome + dataNasc) — JoinBank exige borrower completo
  const cli = await aguardarCliente(id, 8000);
  if (!cli) {
    await patchBanco(id, 'joinbank', {
      status: 'falha',
      mensagem: 'Faltam dados básicos do cliente (nome ou data de nascimento)'
    });
    return;
  }

  // borrower obrigatorio: identity (CPF) + name + birthDate
  const dataIso = cli.dataNascimento.includes('-') ? cli.dataNascimento : ddMmYyToIso(cli.dataNascimento);
  const borrower = {
    identity: cpf,
    name: cli.nome,
    birthDate: dataIso,
    motherName: cli.nomeMae || undefined,
    gender: (cli.sexo || 'M').toUpperCase().startsWith('F') ? 'female' : 'male'
  };
  if (cli.telefones?.[0]?.completo) {
    const tel = cli.telefones[0].completo.replace(/\D/g, '');
    borrower.phone = tel;
  }

  // 1) Cria simulacao
  const r = await callApi('/api/joinbank', {
    action: 'cltCreateSimulation',
    borrower,
    providerCode: '950002' // QITech
  }, auth, secret);
  const jb = r.data || {};

  if (!r.ok || !jb.simulationId) {
    await patchBanco(id, 'joinbank', {
      status: 'falha',
      mensagem: jb._raw?.title || jb._raw?.detail || jb.message || 'Falha ao criar simulação'
    });
    return;
  }

  // 2) ACEITE DO TERMO — Lhamas como correspondente assina, que destrava
  // a consulta dos vinculos empregaticios (sem isso, employmentRelationships
  // vem vazio e marcariamos 'sem vinculo' incorretamente)
  const termoR = await callApi('/api/joinbank', {
    action: 'cltAuthTerm', simulationId: jb.simulationId
  }, auth, secret);
  const termo = termoR.data || {};
  if (termo.authTermKey && !termo.signed) {
    await callApi('/api/joinbank', {
      action: 'cltSignTerm', authTermKey: termo.authTermKey
    }, auth, secret).catch(() => {});
  }

  // 3) Re-cria simulacao apos assinatura — agora os vinculos vem populados
  // (algumas APIs precisam de novo POST; outras a propria simulacao recarrega
  // o status. Tentamos um GET primeiro pra economizar)
  const refresh = await callApi('/api/joinbank', {
    action: 'cltCreateSimulation', borrower, providerCode: '950002'
  }, auth, secret);
  const jb2 = refresh.data || jb;

  const vinculos = jb2.employmentRelationships || [];
  if (!vinculos.length) {
    await patchBanco(id, 'joinbank', {
      status: 'falha',
      disponivel: false,
      mensagem: 'Sem vínculo CLT elegível pra este banco',
      simulationId: jb2.simulationId || jb.simulationId,
      _termoAssinado: !!termo.authTermKey
    });
    return;
  }

  const v = vinculos[0];
  await patchBanco(id, 'joinbank', {
    status: 'ok',
    disponivel: true,
    simulationId: jb2.simulationId || jb.simulationId,
    mensagem: `Cliente elegível — ${v.employerName || 'empregador'}`,
    dados: {
      simulationId: jb2.simulationId || jb.simulationId,
      empregador: v.employerName,
      empregadorCnpj: v.employerDocument,
      registrationNumber: v.registrationNumber,
      vinculos: vinculos.length
    }
  });
}

async function processarC6(id, cpf, incluirC6, auth, secret) {
  await patchBanco(id, 'c6', { status: 'processando' });

  // Sempre checa status (gratis, rapido)
  const status = await callApi('/api/c6', { action: 'statusAutorizacao', cpf }, auth, secret).catch(() => ({ ok: false }));
  const sd = status.data || {};
  const autorizado = sd.autorizado === true || sd.statusAutorizacao === 'AUTORIZADO';

  if (autorizado || incluirC6) {
    const ofertaR = await callApi('/api/c6', { action: 'oferta', cpf, skipAuthCheck: autorizado }, auth, secret).catch(() => ({ ok: false }));
    const c6 = ofertaR.data || {};

    if (autorizado && c6.success && c6.temOferta) {
      await patchBanco(id, 'c6', {
        status: 'ok',
        disponivel: true,
        ja_autorizado: true,
        statusAutorizacao: 'AUTORIZADO',
        mensagem: 'Cliente já autorizado — oferta disponível',
        dados: {
          valorLiquido: c6.oferta?.valorCliente,
          parcelas: c6.oferta?.qtdParcelas,
          valorParcela: c6.oferta?.valorParcela,
          seguroSugerido: c6.oferta?.valorSeguroSugerido
        }
      });
    } else if (autorizado) {
      await patchBanco(id, 'c6', {
        status: 'ok',
        disponivel: false,
        ja_autorizado: true,
        statusAutorizacao: 'AUTORIZADO',
        mensagem: 'Cliente já autorizado, mas sem oferta disponível no momento'
      });
    } else if (c6.requiresLiveness) {
      await patchBanco(id, 'c6', {
        status: 'bloqueado',
        bloqueado: true,
        statusAutorizacao: c6.statusAutorizacao,
        mensagem: c6.mensagem || 'Cliente ainda não autorizou. Clique pra gerar selfie de autorização.'
      });
    } else {
      await patchBanco(id, 'c6', {
        status: 'falha',
        mensagem: c6.mensagem || 'Erro ao consultar oferta'
      });
    }
  } else {
    // Sem autz e incluirC6=false → bloqueado
    const st = sd.statusAutorizacao || 'NAO_AUTORIZADO';
    await patchBanco(id, 'c6', {
      status: 'bloqueado',
      bloqueado: true,
      statusAutorizacao: st,
      mensagem: st === 'AGUARDANDO_AUTORIZACAO'
        ? 'Aguardando cliente fazer a selfie de autorização (link já enviado).'
        : 'Cliente ainda não autorizou. Clique pra gerar selfie de autorização e enviar via WhatsApp.'
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════════
export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  const auth = req.headers.get('Authorization') || '';
  const secret = process.env.WEBHOOK_SECRET || '';

  let body;
  try { body = await req.json(); } catch { return jsonError('JSON inválido', 400, req); }

  const action = body.action || 'criar';

  // ─── CRIAR ─────────────────────────────────────────────────
  if (action === 'criar') {
    const cpf = normalizeCPF(body.cpf);
    if (!cpf) return jsonError('CPF inválido', 400, req);
    const nomeManual = (body.nome || '').trim() || null;
    // Aceita YYYY-MM-DD (input type=date) ou DD/MM/YYYY (digitado a mao)
    let dataNascManual = (body.dataNascimento || '').trim() || null;
    if (dataNascManual) {
      const m1 = dataNascManual.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const m2 = dataNascManual.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m1) {
        dataNascManual = `${m1[1]}-${m1[2]}-${m1[3]}`;
      } else if (m2) {
        dataNascManual = `${m2[3]}-${m2[2]}-${m2[1]}`;
      } else {
        dataNascManual = null; // formato invalido — ignora
      }
    }
    const sexoManual = (body.sexo || '').toUpperCase().startsWith('F') ? 'F'
                     : (body.sexo || '').toUpperCase().startsWith('M') ? 'M' : null;
    const incluirC6 = body.incluirC6 !== false; // default true

    const inicial = {
      presencabank: { status: 'pending' },
      multicorban: { status: 'pending' },
      v8_qi: { status: 'pending' },
      v8_celcoin: { status: 'pending' },
      joinbank: { status: 'pending' },
      mercantil: { status: 'pending' },
      c6: { status: 'pending' }
    };

    // PRE-POPULA cliente com o que ja sabemos desse CPF (clt_clientes acumulado).
    // Assim mesmo que o PB ou MC nao tragam dados nessa consulta, o V8 ainda
    // consegue gerar termo com dataNasc/sexo de consultas anteriores.
    // Manuais tem PRIORIDADE — operador supre o que bancos nao trazem
    let clienteInicial = {};
    if (nomeManual) clienteInicial.nome = nomeManual;
    if (dataNascManual) clienteInicial.dataNascimento = dataNascManual;
    if (sexoManual) clienteInicial.sexo = sexoManual;

    try {
      const { data: clienteSalvo } = await dbSelect('clt_clientes', {
        filters: { cpf }, single: true
      });
      if (clienteSalvo) {
        // Reusa: nome (se nao tem manual), dataNasc, sexo, mae, telefones
        if (!clienteInicial.nome && clienteSalvo.nome) clienteInicial.nome = clienteSalvo.nome;
        if (clienteSalvo.data_nascimento) clienteInicial.dataNascimento = clienteSalvo.data_nascimento;
        if (clienteSalvo.sexo) clienteInicial.sexo = clienteSalvo.sexo;
        if (clienteSalvo.nome_mae) clienteInicial.nomeMae = clienteSalvo.nome_mae;
        if (clienteSalvo.idade) clienteInicial.idade = clienteSalvo.idade;
        if (Array.isArray(clienteSalvo.telefones) && clienteSalvo.telefones.length > 0) {
          clienteInicial.telefones = clienteSalvo.telefones;
        }
        if (clienteSalvo.email) clienteInicial.emails = [clienteSalvo.email];
      }
    } catch { /* nao quebra se nao tem ainda */ }

    if (Object.keys(clienteInicial).length === 0) clienteInicial = null;

    const { data: row, error } = await dbInsert('clt_consultas_fila', {
      cpf, nome_manual: nomeManual, incluir_c6: incluirC6,
      status_geral: 'processando',
      bancos: inicial,
      cliente: clienteInicial,
      iniciado_em: new Date().toISOString()
    });
    if (error) return jsonError('Erro criando fila: ' + error, 500, req);

    // DISPARA OS 5 PROCESSADORES NO BACKEND — garantia de execucao mesmo se
    // o frontend fechar a janela. Cada um roda em paralelo (fetch sem await),
    // mas como o handler `processar` faz await ate terminar, o trabalho roda
    // ate o fim mesmo se o cliente desconectar.
    const bancos = ['presencabank', 'multicorban', 'v8_qi', 'v8_celcoin', 'joinbank', 'mercantil', 'c6'];
    const baseUrl = APP_URL();
    for (const banco of bancos) {
      // Fire-and-forget mas COM internal-secret (evita 401 de chamadas internas)
      fetch(baseUrl + '/api/clt-fila', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret || '' },
        body: JSON.stringify({ action: 'processar', id: row.id, banco })
      }).catch(e => console.error('[clt-fila] dispatch ' + banco + ':', e.message));
    }

    return jsonResp({
      success: true,
      id: row.id,
      cpf,
      mensagem: 'Consulta adicionada à fila — processadores disparados em background.'
    }, 200, req);
  }

  // ─── SIMULAR MANUAL — operador digitou os valores que viu no portal do banco ──
  // Usado por bancos sem API (ex: Mercantil). Aceita valor liberado, parcelas,
  // valor parcela e marca o card como 'ok' com dados manuais.
  if (action === 'simularManual') {
    const id = body.id;
    const banco = body.banco;
    if (!id || !banco) return jsonError('id e banco obrigatórios', 400, req);
    const valorLiquido = parseFloat(body.valorLiquido || 0);
    const parcelas = parseInt(body.parcelas || 0);
    const valorParcela = parseFloat(body.valorParcela || 0);
    if (!valorLiquido || !parcelas || !valorParcela) {
      return jsonError('valorLiquido, parcelas e valorParcela obrigatórios', 400, req);
    }

    await patchBanco(id, banco, {
      status: 'ok',
      disponivel: true,
      manual: true,
      digitadoEm: new Date().toISOString(),
      mensagem: `Simulado manualmente — R$ ${valorLiquido.toFixed(2)} em ${parcelas}x R$ ${valorParcela.toFixed(2)}`,
      detalhes: { valorLiquido, parcelas, valorParcela },
      dados: { valorLiquido, parcelas, valorParcela, fonte: 'manual', protocolo: body.protocolo || null }
    });
    return jsonResp({ success: true, banco, valorLiquido, parcelas, valorParcela }, 200, req);
  }

  // ─── INTERPRETAR PRINT — Claude Vision le o screenshot da simulação manual ──
  // Operador anexa foto da tela com simulação do portal. IA extrai valor/parcelas/taxa.
  if (action === 'interpretarPrint') {
    const id = body.id;
    const banco = body.banco;
    const imagemBase64 = body.imagemBase64; // sem o prefix "data:image/..."
    const mimeType = body.mimeType || 'image/png';
    if (!id || !banco || !imagemBase64) {
      return jsonError('id, banco e imagemBase64 obrigatórios', 400, req);
    }

    const claudeKey = process.env.CLAUDE_API_KEY_AGENTE_CLT || process.env.CLAUDE_API_KEY;
    if (!claudeKey) return jsonError('CLAUDE_API_KEY não configurado', 500, req);

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: imagemBase64 } },
            { type: 'text', text:
`Esta é uma tela de simulação de empréstimo consignado. Extraia os seguintes dados em JSON:
{
  "valorLiquido": <numero, valor que cliente recebe na conta>,
  "parcelas": <numero inteiro de parcelas>,
  "valorParcela": <numero, valor de cada parcela mensal>,
  "taxaMensal": <numero opcional, % ao mês>,
  "iof": <numero opcional>,
  "cet": <numero opcional, % CET ao mês>,
  "protocolo": <string opcional, número do protocolo da simulação>
}
Retorne APENAS o JSON, sem texto adicional. Se algum dado não estiver visível, use null.` }
          ]
        }]
      })
    });
    const d = await r.json();
    const texto = d.content?.[0]?.text || '';
    let extraido;
    try {
      const m = texto.match(/\{[\s\S]*\}/);
      extraido = m ? JSON.parse(m[0]) : null;
    } catch { extraido = null; }
    if (!extraido) {
      return jsonResp({ success: false, error: 'Não consegui extrair dados do print', _raw: texto.substring(0, 300) }, 200, req);
    }
    return jsonResp({ success: true, extraido }, 200, req);
  }

  // ─── VERIFICAR V8 (verificacao leve — so consultarPorCPF, sem gerar termo) ──
  // Usado quando V8 esta em status intermediario (CONSENT_APPROVED, WAITING_*)
  // pra atualizar sem refazer todo o processarV8 (que estoura timeout do Edge)
  if (action === 'verificarV8') {
    const id = body.id;
    const provider = body.provider; // 'QI' ou 'CELCOIN'
    if (!id || !provider) return jsonError('id e provider obrigatórios', 400, req);
    const { data: row } = await dbSelect('clt_consultas_fila', { filters: { id }, single: true });
    if (!row) return jsonError('Fila não encontrada', 404, req);

    const r = await callApi('/api/v8', { action: 'consultarPorCPF', cpf: row.cpf, provider }, auth, secret);
    const v8 = r.data || {};
    const banco = provider === 'QI' ? 'v8_qi' : 'v8_celcoin';

    if (v8.encontrado && v8.status === 'SUCCESS') {
      await patchBanco(id, banco, {
        status: 'ok', disponivel: true, consultId: v8.consultId,
        mensagem: `Cliente elegível — margem R$ ${parseFloat(v8.availableMarginValue || 0).toFixed(2)}`,
        dados: { margemDisponivel: parseFloat(v8.availableMarginValue || 0), consultId: v8.consultId }
      });
    } else if (['REJECTED', 'FAILED'].includes(v8.status)) {
      await patchBanco(id, banco, {
        status: 'falha', mensagem: `❌ ${v8.status}: ${v8.descricao || 'cliente rejeitado'}`
      });
    } else if (v8.encontrado) {
      // Continua processando — atualiza só atualizado_em pra polling saber que checamos
      await patchBanco(id, banco, {
        status: 'processando', processando: true, consultId: v8.consultId,
        mensagem: `${v8.status} — aguardando confirmação`
      });
    }
    return jsonResp({ success: true, banco, status: v8.status }, 200, req);
  }

  // ─── PROCESSAR ─────────────────────────────────────────────
  if (action === 'processar') {
    const id = body.id;
    const banco = body.banco;
    const forceRerun = body.force === true; // re-disparo manual
    if (!id || !banco) return jsonError('id e banco obrigatórios', 400, req);

    const { data: row } = await dbSelect('clt_consultas_fila', { filters: { id }, single: true });
    if (!row) return jsonError('Fila não encontrada', 404, req);

    // IDEMPOTENCIA: se ja esta em estado final ou processando ativamente,
    // nao re-roda (evita corrida quando re-disparos chegam em paralelo)
    const bancoStatus = row.bancos?.[banco]?.status;
    if (!forceRerun && ['ok', 'falha', 'bloqueado'].includes(bancoStatus)) {
      return jsonResp({ success: true, banco, id, skipped: 'estado final: ' + bancoStatus }, 200, req);
    }
    if (!forceRerun && bancoStatus === 'processando') {
      // Se esta processando ha menos de 20s, deixa quieto
      const atualizadoEm = row.bancos?.[banco]?.atualizado_em;
      if (atualizadoEm && Date.now() - new Date(atualizadoEm).getTime() < 20000) {
        return jsonResp({ success: true, banco, id, skipped: 'recente' }, 200, req);
      }
    }

    try {
      if (banco === 'presencabank') await processarPresencaBank(id, row.cpf, auth, secret);
      else if (banco === 'multicorban') await processarMulticorban(id, row.cpf, auth, secret);
      else if (banco === 'v8_qi') await processarV8(id, 'QI', row.cpf, auth, secret);
      else if (banco === 'v8_celcoin') await processarV8(id, 'CELCOIN', row.cpf, auth, secret);
      else if (banco === 'joinbank') await processarJoinBank(id, row.cpf, auth, secret);
      else if (banco === 'mercantil') await processarMercantil(id, row.cpf, auth, secret);
      else if (banco === 'c6') await processarC6(id, row.cpf, !!row.incluir_c6, auth, secret);
      else return jsonError('Banco inválido. Válidos: presencabank, multicorban, v8_qi, v8_celcoin, joinbank, mercantil, c6', 400, req);
    } catch (e) {
      await patchBanco(id, banco, { status: 'falha', mensagem: 'Erro: ' + e.message });
      return jsonResp({ success: false, error: e.message }, 200, req);
    }

    return jsonResp({ success: true, banco, id }, 200, req);
  }

  // ─── STATUS (polling) ─────────────────────────────────────
  if (action === 'status') {
    const id = body.id;
    if (!id) return jsonError('id obrigatório', 400, req);
    const { data: row } = await dbSelect('clt_consultas_fila', { filters: { id }, single: true });
    if (!row) return jsonError('Fila não encontrada', 404, req);

    // TIMEOUT ABSOLUTO: se a fila esta processando ha mais de 10min, forca
    // conclusao marcando bancos pendentes como falha (V8 pode ficar
    // WAITING_CREDIT_ANALYSIS eternamente se DataPrev nao confirmar)
    if (row.status_geral === 'processando' && row.iniciado_em) {
      const idadeMs = Date.now() - new Date(row.iniciado_em).getTime();
      if (idadeMs > 10 * 60 * 1000) {
        const bancosNovos = { ...(row.bancos || {}) };
        for (const k of ['presencabank', 'multicorban', 'v8_qi', 'v8_celcoin', 'c6']) {
          if (bancosNovos[k] && ['pending', 'processando'].includes(bancosNovos[k].status)) {
            bancosNovos[k] = {
              ...bancosNovos[k],
              status: 'falha',
              mensagem: bancosNovos[k].mensagem || '⏱ Timeout 10min — banco não confirmou',
              atualizado_em: new Date().toISOString()
            };
          }
        }
        await dbUpdate('clt_consultas_fila', { id }, {
          bancos: bancosNovos,
          status_geral: 'concluido',
          concluido_em: new Date().toISOString()
        });
        row.bancos = bancosNovos;
        row.status_geral = 'concluido';
      }
    }

    return jsonResp({ success: true, fila: row }, 200, req);
  }

  // ─── LISTAR (paginado) ────────────────────────────────────
  if (action === 'listar') {
    const limit = Math.min(parseInt(body.limit || 50), 200);
    const filters = {};
    if (body.cpf) filters.cpf = body.cpf;
    if (body.status_geral) filters.status_geral = body.status_geral;
    const { data } = await dbSelect('clt_consultas_fila', {
      filters, order: 'iniciado_em.desc', limit
    });
    return jsonResp({ success: true, items: data || [] }, 200, req);
  }

  return jsonError('Action inválida. Válidas: criar, processar, status, listar', 400, req);
}
