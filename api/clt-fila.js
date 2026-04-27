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
// Usado pelos processadores V8 que precisam dos dados do enriquecimento
async function aguardarCliente(id, timeoutMs = 9000, intervalMs = 700) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    const { data: row } = await dbSelect('clt_consultas_fila', { filters: { id }, single: true });
    const cli = row?.cliente || {};
    if (cli.nome && cli.dataNascimento) return cli;
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
      mensagem: pb.mensagem || 'Sem vínculo CLT elegível pra este banco'
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
    const incluirC6 = body.incluirC6 !== false; // default true

    const inicial = {
      presencabank: { status: 'pending' },
      multicorban: { status: 'pending' },
      v8_qi: { status: 'pending' },
      v8_celcoin: { status: 'pending' },
      c6: { status: 'pending' }
    };

    // PRE-POPULA cliente com o que ja sabemos desse CPF (clt_clientes acumulado).
    // Assim mesmo que o PB ou MC nao tragam dados nessa consulta, o V8 ainda
    // consegue gerar termo com dataNasc/sexo de consultas anteriores.
    let clienteInicial = nomeManual ? { nome: nomeManual } : {};
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
    const bancos = ['presencabank', 'multicorban', 'v8_qi', 'v8_celcoin', 'c6'];
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
      else if (banco === 'c6') await processarC6(id, row.cpf, !!row.incluir_c6, auth, secret);
      else return jsonError('Banco inválido. Válidos: presencabank, multicorban, v8_qi, v8_celcoin, c6', 400, req);
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
