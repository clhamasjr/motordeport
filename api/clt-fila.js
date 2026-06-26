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
import { dbSelect, dbInsert, dbUpdate, dbUpsert, dbRPC } from './_lib/supabase.js';

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

// Catalogo completo de bancos CLT — usado pra checar "todos terminaram".
// Tem que casar com a lista usada em 'criar' (linha ~1013).
const TODOS_BANCOS_CLT = [
  'presencabank', 'multicorban', 'v8_qi', 'v8_celcoin',
  'joinbank', 'mercantil', 'handbank', 'c6',
  'fintech_qi', 'fintech_celcoin', 'unno',
  'nossa_fintech',       // A NOSSA FINTECH via QITECH
  'nossa_fintech_uy3',   // A NOSSA FINTECH via UY3
  'facta_clt',           // FACTA Crédito do Trabalhador
];

// ── MODO STANDBY ───────────────────────────────────────────────
// Ate esta data, consultas de operador NAO disparam os bancos —
// ficam em status_geral='standby' e sao disparadas em massa no dia
// 26/06 07h (cron clt-cron-reconsulta), junto com a re-consulta do
// historico. Motivo: bancarizadoras instaveis/virada de folha ate la.
// Chamadas internas (cron, _internal) NUNCA entram em standby.
const CLT_STANDBY_ATE = Date.parse('2026-06-26T07:00:00-03:00'); // 26/06 07h BRT
function emStandbyAgora(user) {
  return !user?._internal && Date.now() < CLT_STANDBY_ATE;
}

// ── Isolamento multi-tenant das consultas CLT ──────────────────
// Admin/gestor (e chamadas internas via WEBHOOK_SECRET) enxergam tudo.
// Demais: isolados por parceiro_id (se tiver) ou pelo proprio user_id.
// Sem isso, a action 'listar' devolvia TODAS as consultas pra qualquer
// operador (vazamento de dados entre parceiros/vendedores).
function isPrivCLT(user) {
  return !!(user && (user.role === 'admin' || user.role === 'gestor' || user._internal));
}
// Isolamento por USUARIO (nao por parceiro). Vendedores da mesma Lhamas
// compartilham parceiro_id — se filtrasse por parceiro, todos veriam tudo
// uns dos outros (= "todo mundo ve tudo"). Cada vendedor ve SO as proprias
// consultas; admin/gestor veem tudo.
function escopoFiltrosCLT(user) {
  if (isPrivCLT(user)) return {};
  return { criada_por_user_id: user?.id ?? -1 };
}
// Checa se o usuario pode ver uma fila especifica (defense-in-depth no status).
function podeVerFilaCLT(user, row) {
  if (isPrivCLT(user)) return true;
  if (!row) return false;
  return row.criada_por_user_id === user?.id;
}

// Atualiza UM banco no jsonb bancos sem sobrescrever os outros.
// Quando status muda pra terminal (ok/falha/bloqueado/manual_aguardando)
// limpa flags transitorias (processando) automaticamente — evita ficarem
// gruda do nos merges e travarem o card no frontend.
async function patchBanco(id, banco, payload) {
  // Lê estado atual
  const { data: row } = await dbSelect('clt_consultas_fila', { filters: { id }, single: true });
  if (!row) return { error: 'fila nao encontrada' };
  const bancos = { ...(row.bancos || {}) };
  const merged = { ...(bancos[banco] || {}), ...payload, atualizado_em: new Date().toISOString() };
  // GARANTIA: mensagem sempre string. Algumas APIs de banco retornam erro
  // como objeto ({id, code, message}) — se vazar pro jsonb, o React do V2
  // quebra ao renderizar (error #31: objects are not valid as React child).
  if (merged.mensagem != null && typeof merged.mensagem !== 'string') {
    const m = merged.mensagem;
    merged.mensagem = (typeof m === 'object' && (m.message || m.detail || m.error))
      ? String(m.message || m.detail || m.error)
      : JSON.stringify(m).substring(0, 300);
  }
  // Limpa flags transitorias quando status virou terminal
  const terminal = ['ok', 'falha', 'bloqueado', 'manual_aguardando', 'pulado'];
  if (terminal.includes(merged.status) && payload.processando !== true) {
    merged.processando = false;
  }
  bancos[banco] = merged;

  // Marca conclusao quando TODOS os bancos disparados terminaram.
  // 'em_manutencao' tambem eh terminal (banco desativado no catalogo).
  // Considera SO os bancos presentes em `bancos` (foram disparados nessa
  // consulta — pode ter filtro de bancos especificos via body.bancos).
  const STATUS_TERMINAIS = ['ok','falha','bloqueado','pulado','em_manutencao','manual_aguardando'];
  const bancosPresentes = TODOS_BANCOS_CLT.filter(b => bancos[b]);
  const todosTerminaram = bancosPresentes.length > 0 &&
    bancosPresentes.every(b => STATUS_TERMINAIS.includes(bancos[b].status));
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
// CATÁLOGO: bancos com ativo=false sao pulados (em manutencao)
// Cache de 60s pra nao bater no DB a cada banco processado.
// ═══════════════════════════════════════════════════════════════════
let _bancosCacheClt = null;
let _bancosCacheCltAt = 0;
async function _getBancosCatalogoClt() {
  const now = Date.now();
  if (_bancosCacheClt && (now - _bancosCacheCltAt) < 60_000) return _bancosCacheClt;
  const { data } = await dbSelect('clt_bancos', { limit: 100 }).catch(() => ({ data: [] }));
  _bancosCacheClt = new Map((data || []).map(b => [b.slug, b]));
  _bancosCacheCltAt = now;
  return _bancosCacheClt;
}

async function _bancoEmManutencao(slug) {
  const m = await _getBancosCatalogoClt();
  const b = m.get(slug);
  if (!b || b.ativo !== false) return null;
  // Extrai a mensagem das observacoes se comecar com 🔧
  const obs = b.observacoes || '';
  const mt = obs.match(/^(🔧[^—.]*)/);
  return mt ? mt[1].trim() : '🔧 Em manutenção — voltará em breve';
}

async function _marcarEmManutencao(id, slug, msg) {
  await patchBanco(id, slug, {
    status: 'em_manutencao',
    disponivel: false,
    emManutencao: true,
    mensagem: msg
  });
}

// Tracking de empresas aprovadas — chama clt_registrar_aprovacao() pra UPSERT
// na tabela clt_empresas_aprovadas. Roda em background (sem await na cadeia
// principal) pra nao atrasar o response do banco. Falhas sao silenciosas
// (nao queremos quebrar o fluxo de aprovacao por causa de tracking).
async function _registrarAprovacao(cnpj, empregadorNome, banco, cnae, cidade, uf) {
  if (!cnpj) return;
  const cnpjLimpo = String(cnpj).replace(/\D/g, '');
  if (!cnpjLimpo || cnpjLimpo.length < 8) return;
  try {
    await dbRPC('clt_registrar_aprovacao', {
      p_cnpj: cnpjLimpo,
      p_empregador_nome: empregadorNome || null,
      p_banco: banco,
      p_cnae: cnae || null,
      p_cidade: cidade || null,
      p_uf: uf || null
    });
  } catch (e) {
    console.error('[clt-fila] tracking aprovacao falhou:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════
// PROCESSADORES POR BANCO
// ═══════════════════════════════════════════════════════════════════

async function processarPresencaBank(id, cpf, auth, secret) {
  const manut = await _bancoEmManutencao('presencabank');
  if (manut) { await _marcarEmManutencao(id, 'presencabank', manut); return; }
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

    const totalDevido = parseFloat(pb.margem?.totalDevido || 0) || 0;
    let msgPB;
    if (margemDisp > 0) {
      msgPB = `Cliente elegível — margem R$ ${margemDisp.toFixed(2)}`;
    } else if (totalDevido > 0) {
      // Margem livre <= 0 mas tem dívida → oportunidade de PORTABILIDADE
      msgPB = `Sem margem p/ novo, mas tem R$ ${totalDevido.toFixed(2)} em dívida (potencial portabilidade) · base R$ ${margemBase.toFixed(2)}`;
    } else {
      msgPB = 'Cliente elegível mas sem margem disponível';
    }
    await patchBanco(id, 'presencabank', {
      status: 'ok',
      disponivel: true,
      mensagem: msgPB,
      dados: {
        margemDisponivel: margemDisp,
        margemBase: margemBase,
        totalDevido,
        portabilidade: margemDisp <= 0 && totalDevido > 0,
        empregador: pb.vinculo?.empregador,
        empregadorCnpj: pb.vinculo?.cnpj
      }
    });
    // Tracking: registra empresa aprovada
    _registrarAprovacao(pb.vinculo?.cnpj, pb.vinculo?.empregador, 'presencabank', null, null, null);
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
  const manut = await _bancoEmManutencao(banco);
  if (manut) { await _marcarEmManutencao(id, banco, manut); return; }
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
  const manut = await _bancoEmManutencao('mercantil');
  if (manut) { await _marcarEmManutencao(id, 'mercantil', manut); return; }
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

  // Mercantil retorna o nome do cliente — aproveita pra enriquecer
  if (mb.nomeCliente) {
    await mesclarCliente(id, { nome: mb.nomeCliente });
  }

  if (mb.success && mb.temCadastro && mb.tokenValidoConsignadoPrivado) {
    // CASO IDEAL: cliente cadastrado + ja autorizou consulta consignado privado
    await patchBanco(id, 'mercantil', {
      status: 'ok',
      disponivel: true,
      operacaoId: mb.operacaoId,
      nomeCliente: mb.nomeCliente,
      mensagem: `Cliente elegível — clique Digitar pra simular tabela.`,
      dados: { operacaoId: mb.operacaoId, convenio: mb.convenio, nomeCliente: mb.nomeCliente }
    });
  } else if (mb.success && mb.temCadastro && mb.precisaAutorizacao) {
    // Cliente conhecido mas precisa autorizar consulta — proximo passo: gerar token/termo
    await patchBanco(id, 'mercantil', {
      status: 'bloqueado',
      bloqueado: true,
      operacaoId: mb.operacaoId,
      nomeCliente: mb.nomeCliente,
      precisaAutorizacao: true,
      mensagem: `Cliente cadastrado (${mb.nomeCliente}) — precisa autorizar consulta consignado privado primeiro.`,
      dados: { operacaoId: mb.operacaoId, nomeCliente: mb.nomeCliente }
    });
  } else if (mb.semCadastro) {
    // 400 Bad Request — cliente novo / sem ficha
    await patchBanco(id, 'mercantil', {
      status: 'falha',
      disponivel: false,
      mensagem: 'Cliente sem cadastro prévio no Mercantil',
      _raw_response: mb
    });
  } else {
    // Preserva mensagem COMPLETA + hints e preview do payload pra debug
    const msgLong = (mb.error || mb.mensagem || 'Falha consulta Mercantil').toString();
    await patchBanco(id, 'mercantil', {
      status: 'falha',
      disponivel: false,
      mensagem: msgLong.substring(0, 500),
      mensagem_completa: msgLong,
      hint: mb._hint || null,
      payload_preview: mb._payload_preview || null,
      chars_suspeitos: mb._chars_suspeitos || null,
      _raw_response: mb
    });
  }
}

// Banco HANDBANK / UY3 — bate em /uy3/simulacao_clt:
//   202 → precisa autorizar. Se temos nome+dataNasc+telefone do cliente,
//          AUTO-AUTORIZA chamando ChallengeInfo da UY3 e re-consulta.
//   201 → autorizado, retorna { cnpj, matricula, valor_margem, mensagem }
//   400 → cliente ja tem contrato OU outro impedimento
async function processarHandbank(id, cpf, auth, secret) {
  const manut = await _bancoEmManutencao('handbank');
  if (manut) { await _marcarEmManutencao(id, 'handbank', manut); return; }
  await patchBanco(id, 'handbank', { status: 'processando' });
  let r = await callApi('/api/handbank', { action: 'iniciarConsultaCLT', cpf }, auth, secret);
  let d = r.data || {};

  // Cenario 1: precisa autorizacao (202)
  if (d.precisaAutorizacao && d.linkAutorizacao) {
    // Tenta auto-autorizar se temos os dados necessarios (nome + dataNasc + telefone)
    const cli = await aguardarCliente(id, 6000);
    const tel = cli?.telefones?.[0]?.completo;
    if (cli?.nome && cli?.dataNascimento && tel) {
      const dataIso = String(cli.dataNascimento).includes('-') ? cli.dataNascimento : ddMmYyToIso(cli.dataNascimento);
      const autzR = await callApi('/api/handbank', {
        action: 'autorizarUY3',
        cpf, nome: cli.nome, dataNascimento: dataIso, telefone: tel
      }, auth, secret).catch(() => ({ ok: false }));

      if (autzR.ok && autzR.data?.success) {
        // Re-consulta apos autorizacao — agora pode vir 201 (autorizado)
        await new Promise(r => setTimeout(r, 1500));
        r = await callApi('/api/handbank', { action: 'iniciarConsultaCLT', cpf }, auth, secret);
        d = r.data || {};
        // continua pro cenario 3 abaixo se virou autorizado
      } else {
        // Auto-autz falhou — deixa link manual
        await patchBanco(id, 'handbank', {
          status: 'bloqueado',
          bloqueado: true,
          precisaAutorizacao: true,
          linkAutorizacao: d.linkAutorizacao,
          mensagem: 'Auto-autorização UY3 falhou. Use o link manual no card.',
          _raw_response: d
        });
        return;
      }
    } else {
      // Sem dados pra auto-autorizar — fica em bloqueado com link
      await patchBanco(id, 'handbank', {
        status: 'bloqueado',
        bloqueado: true,
        precisaAutorizacao: true,
        linkAutorizacao: d.linkAutorizacao,
        mensagem: 'Cliente precisa autorizar UY3. Faltam dados (nome/data/telefone) pra autorização automática.',
        _raw_response: d
      });
      return;
    }
  }

  // Cenario 2: cliente ja tem contrato OU outro impedimento (400)
  // IMPORTANTE: persistir `jaTemContrato: true` pra UI mostrar status "Já contratado"
  // (sem essa flag o StatusPill mostra "Aguarda autorização" — semantica errada,
  // ja que aqui o cliente NAO precisa autorizar nada, ele simplesmente nao eh
  // elegivel porque ja contratou).
  if (d.bloqueado && d.jaTemContrato) {
    await patchBanco(id, 'handbank', {
      status: 'bloqueado',
      bloqueado: true,
      jaTemContrato: true,
      precisaAutorizacao: false,
      mensagem: d.mensagem || 'Cliente já possui contrato ativo na UY3'
    });
    return;
  }

  // Cenario 3: autorizado com margem (201)
  if (d.autorizado && d.disponivel) {
    const margemNum = typeof d.margem === 'number' ? d.margem : Number(d.margem) || 0;
    await patchBanco(id, 'handbank', {
      status: 'ok',
      disponivel: true,
      precisaAutorizacao: false,
      bloqueado: false,
      linkAutorizacao: null,
      mensagem: margemNum > 0
        ? `Cliente elegível — margem R$ ${margemNum.toFixed(2)}`
        : 'Cliente elegível mas sem margem disponível',
      dados: {
        margemDisponivel: margemNum,
        empregadorCnpj: d.empregadorCnpj || null,
        matricula: d.matricula || null,
        empregador: d.empregador || null,
        renda: d.renda || null
      },
      _raw_response: d
    });
    // Tracking: registra empresa aprovada
    _registrarAprovacao(d.empregadorCnpj, d.empregador, 'handbank', null, null, null);
    return;
  }

  // Outros (HTTP 500, erro env vars, etc)
  await patchBanco(id, 'handbank', {
    status: 'falha',
    mensagem: d.mensagem || d.error || 'Erro consultando Handbank',
    _raw_response: d
  });
}

async function processarJoinBank(id, cpf, auth, secret) {
  const manut = await _bancoEmManutencao('joinbank');
  if (manut) { await _marcarEmManutencao(id, 'joinbank', manut); return; }
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
    // Extrai motivo real de TODOS os campos possiveis (JoinBank/QITech retorna
    // erro em formato diferente conforme tipo: validacao, recusa de credito,
    // CNAE bloqueado, etc). Sem isso a tela mostra "Falha ao criar simulação"
    // generico e o operador nao sabe se eh problema do cliente ou bug.
    const raw = jb._raw || jb;
    const errs = Array.isArray(raw.errors) ? raw.errors : (Array.isArray(jb.errors) ? jb.errors : []);
    const errsStr = errs.length
      ? errs.map(e => e.message || e.title || e.detail || (typeof e === 'string' ? e : JSON.stringify(e))).join('; ')
      : null;
    const motivo = raw.title
      || raw.detail
      || raw.message
      || errsStr
      || jb.message
      || jb.error
      || (jb.refusalReason || raw.refusalReason)
      || (jb.httpStatus || r.status ? `Erro HTTP ${jb.httpStatus || r.status}` : null)
      || 'Falha ao criar simulação';
    await patchBanco(id, 'joinbank', {
      status: 'falha',
      mensagem: motivo,
      _raw_response: raw
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
  // Tracking: registra empresa aprovada
  _registrarAprovacao(v.employerDocument, v.employerName, 'joinbank', null, null, null);
}

// ─── FINTECH DO CORBAN (QI Tech / Celcoin) ──────────────────────────
// Substitui o V8 (que saiu da operacao). Usa /api/fintechdocorban.
async function processarFintech(id, provider, cpf, auth, secret) {
  const banco = provider === 'celcoin' ? 'fintech_celcoin' : 'fintech_qi';
  const manut = await _bancoEmManutencao(banco);
  if (manut) { await _marcarEmManutencao(id, banco, manut); return; }
  await patchBanco(id, banco, { status: 'processando' });

  // Estrategia: cltCheckEligibility consolidada faz consulta+autorizacao+vinculos
  // (so funciona auto pro QI — Celcoin precisa SMS pro cliente)
  const r = await callApi('/api/fintechdocorban', {
    action: 'cltCheckEligibility',
    cpf,
    provider: provider === 'celcoin' ? 'celcoin' : 'qi'
  }, auth, secret).catch(() => ({ ok: false, data: {} }));
  const d = r.data || {};

  // Casos:
  // 1) Sem vinculo → falha
  // 2) Vinculo + QI + autorizadoAgora=true + dadosWorker → ok com margem
  // 3) Vinculo + Celcoin + precisaAutorizacao → bloqueado com mensagem clara
  // 4) Falha generica (env var, erro API, etc)
  if (!r.ok && d.error?.includes('FINTECH_API_KEY')) {
    await patchBanco(id, banco, {
      status: 'falha',
      mensagem: '⚙️ ' + d.error + ' — admin precisa cadastrar.',
      _raw_response: d
    });
    return;
  }
  if (!d.temVinculo) {
    await patchBanco(id, banco, {
      status: 'falha',
      disponivel: false,
      mensagem: d.mensagem || 'Sem vínculo CLT elegível pra este banco',
      _raw_response: d
    });
    return;
  }
  if (provider === 'celcoin' && d.precisaAutorizacao) {
    await patchBanco(id, banco, {
      status: 'bloqueado',
      bloqueado: true,
      precisaAutorizacao: true,
      mensagem: 'Cliente precisa autorizar via SMS antes de simular. Operador envia o link.',
      dados: {
        empregador: d.vinculo?.empregador,
        empregadorCnpj: d.vinculo?.cnpj,
        matricula: d.vinculo?.matricula
      },
      _raw_response: d
    });
    return;
  }
  if (d.disponivel && d.dadosWorker) {
    // Extrai margem do dadosWorker (estrutura varia conforme provider)
    const w = d.dadosWorker || {};
    const margem = parseFloat(
      w.availableMargin || w.margem_disponivel || w.available_margin ||
      w.margem || w.margemDisponivel || 0
    ) || 0;
    const renda = parseFloat(w.salary || w.salario || w.renda || w.income || 0) || null;
    await patchBanco(id, banco, {
      status: 'ok',
      disponivel: true,
      mensagem: margem > 0
        ? `Cliente elegível — margem R$ ${margem.toFixed(2)}`
        : 'Cliente elegível — margem em consulta',
      dados: {
        margemDisponivel: margem,
        empregador: d.vinculo?.empregador,
        empregadorCnpj: d.vinculo?.cnpj,
        matricula: d.vinculo?.matricula,
        renda,
        workerId: w.id || w.workerId || w.idWorker || null
      },
      _raw_response: d
    });
    // Tracking: registra empresa aprovada
    _registrarAprovacao(d.vinculo?.cnpj, d.vinculo?.empregador, banco, null, null, null);
    return;
  }

  await patchBanco(id, banco, {
    status: 'falha',
    mensagem: d.mensagem || 'Fintech do Corban não retornou dados',
    _raw_response: d
  });
}

// ─── UNNO (Consignado CLT via QITECH/Credspot — auto-autz Handbank-like) ─
// Fluxo "tudo de uma vez" (modelo Handbank/UY3):
//   1) Cria TERMO via POST /auth/api/v1/terms (cliente_cpf, name, phone,
//      email, birth_date, gender, bank_provider_uuid)
//   2) AUTO-AUTORIZA termo via PUT /auth/api/v1/terms/authorize/{uuid}
//      — parceiro autoriza tecnicamente em nome do cliente (igual
//      ChallengeInfo UY3). Pressupoe procuracao escrita do cliente.
//   3) Aguarda Unno criar proposta (~5-15s) e rodar risk-analysis
//   4) Retorna resultado: APROVADO / RECUSADO / EM_ANALISE
//
// Card vai direto de "processando" pra "ok/falha" em ~15-20s. Sem
// fluxo "aguarda autorização" — cliente nao precisa fazer nada.
async function processarUnno(id, cpf, auth, secret) {
  const manut = await _bancoEmManutencao('unno');
  if (manut) { await _marcarEmManutencao(id, 'unno', manut); return; }

  // ── IDEMPOTENCIA: se ja tem termo criado, NAO cria de novo. ──
  // Le estado atual pra ver se ja tem termUuid persistido. Sem isso,
  // cada re-tentativa criava termo duplicado no painel da Unno (lixo).
  const { data: rowAtu } = await dbSelect('clt_consultas_fila', { filters: { id }, single: true });
  const estadoUnno = rowAtu?.bancos?.unno || {};
  const termUuidExistente = estadoUnno.termUuid;

  await patchBanco(id, 'unno', { status: 'processando' });

  // Se ja tem termo — so verifica status da proposta (nao cria novo)
  if (termUuidExistente) {
    const r = await callApi('/api/unno', {
      action: 'verificarStatus',
      termUuid: termUuidExistente,
      cpf,
    }, auth, secret, 20000);

    const u = r.data || {};

    if (!r.ok) {
      await patchBanco(id, 'unno', {
        status: 'falha',
        mensagem: u.error || `Erro Unno (HTTP ${r.status})`,
        retryable: true,
        termUuid: termUuidExistente,
      });
      return;
    }

    // Aprovado
    if (u.etapa === 'APROVADO') {
      await patchBanco(id, 'unno', {
        status: 'ok',
        disponivel: true,
        mensagem: u.mensagem,
        dados: {
          proposalUuid: u.proposalUuid,
          termUuid: termUuidExistente,
          bancoProvedor: u.bancoProvedor,
          linkPainel: u.linkPainel,
        },
      });
      return;
    }
    // Recusado
    if (u.etapa === 'RECUSADO') {
      await patchBanco(id, 'unno', {
        status: 'falha',
        disponivel: false,
        mensagem: u.mensagem,
        retryable: false,
        dados: {
          proposalUuid: u.proposalUuid,
          termUuid: termUuidExistente,
          bancoProvedor: u.bancoProvedor,
          linkPainel: u.linkPainel,
          motivoRecusa: u.motivoRecusa,
        },
      });
      return;
    }
    // Cancelado
    if (u.etapa === 'CANCELADO') {
      await patchBanco(id, 'unno', {
        status: 'falha',
        mensagem: u.mensagem,
        retryable: false,
        dados: { proposalUuid: u.proposalUuid, termUuid: termUuidExistente },
      });
      return;
    }
    // Em análise — mantém manual_aguardando (action='status' vai auto-re-trigger)
    await patchBanco(id, 'unno', {
      status: 'manual_aguardando',
      disponivel: false,
      manual: false, // operador NAO precisa fazer nada — sistema continua sozinho
      portalUrl: u.linkPainel || 'https://app.unnotech.com.br/loans/clt/simulations',
      mensagem: '⏳ Unno analisando — aguarde...',
      retryable: false, // status check faz auto-re-trigger
      termUuid: termUuidExistente,
      dados: { proposalUuid: u.proposalUuid, bancoProvedor: u.bancoProvedor, linkPainel: u.linkPainel },
    });
    return;
  }

  // ── Primeira execucao: precisa dados completos pra criar termo ─
  const cli = await aguardarCliente(id, 8000);
  if (!cli || !cli.nome || !cli.dataNascimento) {
    await patchBanco(id, 'unno', {
      status: 'falha',
      mensagem: 'Faltam nome ou data de nascimento — Unno exige pra criar termo',
      retryable: true,
    });
    return;
  }
  if (!cli.telefones?.[0]?.completo) {
    await patchBanco(id, 'unno', {
      status: 'falha',
      mensagem: 'Falta telefone do cliente — Unno exige pra criar termo. Use "Completar Dados".',
      retryable: true,
    });
    return;
  }

  // Cria termo NOVO + auto-autz + polling inicial
  const r = await callApi('/api/unno', {
    action: 'simulacaoCompleta',
    cpf,
    nome: cli.nome,
    dataNascimento: cli.dataNascimento,
    telefone: cli.telefones[0].completo,
    email: cli.emails?.[0] || null,
    sexo: cli.sexo || 'M',
    provedor: 'qitech',
  }, auth, secret, 25000);

  const u = r.data || {};
  if (!r.ok || !u.sucesso) {
    await patchBanco(id, 'unno', {
      status: 'falha',
      mensagem: u.error || `Erro Unno (HTTP ${r.status})`,
      retryable: true,
      _raw_response: u,
    });
    return;
  }

  // APROVADO
  if (u.etapa === 'APROVADO') {
    const dc = u.dadosCliente || {};
    await patchBanco(id, 'unno', {
      status: 'ok',
      disponivel: true,
      mensagem: u.mensagem,
      dados: {
        proposalUuid: u.proposalUuid,
        termUuid: u.termUuid,
        bancoProvedor: u.bancoProvedor,
        linkPainel: u.linkPainel,
        empregador: null, // Unno nao retorna na listagem (precisa GET detalhado)
      },
    });
    return;
  }

  // RECUSADO
  if (u.etapa === 'RECUSADO') {
    await patchBanco(id, 'unno', {
      status: 'falha',
      disponivel: false,
      mensagem: u.mensagem,
      retryable: false, // motor recusou — refazer nao adianta
      dados: {
        proposalUuid: u.proposalUuid,
        termUuid: u.termUuid,
        bancoProvedor: u.bancoProvedor,
        linkPainel: u.linkPainel,
        motivoRecusa: u.motivoRecusa,
      },
    });
    return;
  }

  // EM_ANALISE / AUTORIZADO_EM_ANALISE — polling estourou, mas tem termUuid.
  // Action='status' faz auto-re-trigger automaticamente — operador nao
  // precisa fazer nada, sistema continua sozinho.
  if (u.etapa === 'EM_ANALISE' || u.etapa === 'AUTORIZADO_EM_ANALISE') {
    await patchBanco(id, 'unno', {
      status: 'manual_aguardando',
      disponivel: false,
      manual: false, // operador NAO precisa fazer nada
      portalUrl: u.linkPainel || 'https://app.unnotech.com.br/loans/clt/simulations',
      mensagem: '⏳ Unno analisando — aguarde...',
      retryable: false, // auto-re-trigger no status
      termUuid: u.termUuid,
      dados: {
        proposalUuid: u.proposalUuid,
        bancoProvedor: u.bancoProvedor,
        linkPainel: u.linkPainel,
      },
    });
    return;
  }

  if (u.etapa === 'CANCELADO') {
    await patchBanco(id, 'unno', {
      status: 'falha',
      mensagem: u.mensagem,
      retryable: false,
      dados: { proposalUuid: u.proposalUuid, termUuid: u.termUuid },
    });
    return;
  }

  // Caso impossivel — log defensivo
  await patchBanco(id, 'unno', {
    status: 'falha',
    mensagem: `Etapa inesperada: ${u.etapa}`,
    retryable: true,
    _raw_response: u,
  });
}

// ─── A NOSSA FINTECH (Spixii) — multi-bancarizadora QITECH + UY3 ──
// Cada bancarizadora vira 1 card: slug 'nossa_fintech' (QITECH) e
// 'nossa_fintech_uy3' (UY3). Auto-autz modelo Handbank/UY3 (sistema
// autoriza DataPrev sem o cliente clicar — procuracao). Se a
// bancarizadora nao esta habilitada na conta (ex: UY3 em homolog),
// etapa INDISPONIVEL → marca em_manutencao (some/cinza, sem erro feio).
async function processarNossaFintech(id, cpf, slug, serviceType, auth, secret) {
  const manut = await _bancoEmManutencao(slug);
  if (manut) { await _marcarEmManutencao(id, slug, manut); return; }
  await patchBanco(id, slug, { status: 'processando' });

  // Espera dados do cliente — precisa nome+telefone pra disparar autz
  const cli = await aguardarCliente(id, 6000);
  const telefone = cli?.telefones?.[0]?.completo || null;
  const nome = cli?.nome || null;

  const r = await callApi('/api/nossa-fintech', {
    action: 'consultarAprovacao',
    cpf,
    nome,
    telefone,
    serviceType, // 'QITECH' | 'UY3'
  }, auth, secret, 20000);

  const u = r.data || {};
  if (!r.ok) {
    await patchBanco(id, slug, {
      status: 'falha',
      mensagem: u.error || u.message || `Erro Nossa Fintech (HTTP ${r.status})`,
      retryable: true,
      _raw_response: u,
    });
    return;
  }

  // INDISPONIVEL — bancarizadora nao habilitada nesta conta
  if (u.etapa === 'INDISPONIVEL') {
    await patchBanco(id, slug, {
      status: 'em_manutencao',
      disponivel: false,
      emManutencao: true,
      mensagem: u.mensagem || `${serviceType} não habilitada`,
    });
    return;
  }

  // APROVADO
  if (u.etapa === 'APROVADO') {
    const dc = u.dadosCliente || {};
    const novoCliente = {};
    if (dc.nome) novoCliente.nome = dc.nome;
    if (dc.dataNascimento) novoCliente.dataNascimento = dc.dataNascimento;
    if (dc.sexo) novoCliente.sexo = dc.sexo;
    if (dc.nomeMae) novoCliente.nomeMae = dc.nomeMae;
    if (Object.keys(novoCliente).length > 0) await mesclarCliente(id, novoCliente);

    // Persiste vinculo na fila se nao tem ainda
    if (u.vinculo?.cnpj && u.vinculo?.empregador) {
      const { data: rowV } = await dbSelect('clt_consultas_fila', { filters: { id }, single: true });
      if (!rowV?.vinculo?.cnpj) {
        await dbUpdate('clt_consultas_fila', { id }, {
          vinculo: {
            cnpj: u.vinculo.cnpj,
            empregador: u.vinculo.empregador,
            matricula: u.vinculo.matricula,
            dataAdmissao: u.vinculo.dataAdmissao,
            fonte: slug,
          }
        });
      }
    }

    await patchBanco(id, slug, {
      status: 'ok',
      disponivel: true,
      mensagem: u.mensagem,
      dados: {
        margemDisponivel: u.margem?.disponivel || 0,
        margemUtilizavel: u.margem?.utilizavel || 0,
        margemBase: u.margem?.base || 0,
        empregador: u.vinculo?.empregador,
        empregadorCnpj: u.vinculo?.cnpj,
        matricula: u.vinculo?.matricula,
        marginKey: u.marginKey,
        bancarizadora: serviceType,
      },
    });
    if (u.vinculo?.cnpj) {
      _registrarAprovacao(u.vinculo.cnpj, u.vinculo.empregador, slug, null, null, null);
    }
    return;
  }

  // AGUARDA_AUTORIZACAO — auto-autz nao confirmou (ou autoAutorizar=false)
  if (u.etapa === 'AGUARDA_AUTORIZACAO') {
    await patchBanco(id, slug, {
      status: 'bloqueado',
      bloqueado: true,
      precisaAutorizacao: true,
      linkAutorizacao: u.linkAutorizacao || null,
      mensagem: u.mensagem,
      statusAutorizacao: u.status,
      retryable: true,
    });
    return;
  }

  // SEM_VINCULO / SEM_MARGEM
  if (u.etapa === 'SEM_VINCULO' || u.etapa === 'SEM_MARGEM') {
    await patchBanco(id, slug, {
      status: 'falha',
      disponivel: false,
      mensagem: u.mensagem,
      _raw_response: u,
    });
    return;
  }

  // Outros erros
  await patchBanco(id, slug, {
    status: 'falha',
    mensagem: u.error || u.mensagem || `Etapa: ${u.etapa}`,
    retryable: true,
    _raw_response: u,
  });
}

// ─── FACTA Crédito do Trabalhador (CLT) — via proxy IP fixo ─────
// Modelo Mercantil/Nossa Fintech: precisa cliente autorizar consulta
// DataPrev via SMS/WhatsApp (vale 30 dias). Se autorizado, retorna
// margem. Roda via facta-proxy (IP fixo autorizado pela FACTA).
async function processarFacta(id, cpf, auth, secret) {
  const manut = await _bancoEmManutencao('facta_clt');
  if (manut) { await _marcarEmManutencao(id, 'facta_clt', manut); return; }
  await patchBanco(id, 'facta_clt', { status: 'processando' });

  const cli = await aguardarCliente(id, 6000);
  const telefone = cli?.telefones?.[0]?.completo || null;
  const nome = cli?.nome || null;

  const r = await callApi('/api/facta', {
    action: 'cltConsultarAprovacao',
    cpf, nome, telefone,
  }, auth, secret, 20000);

  const u = r.data || {};
  if (!r.ok) {
    await patchBanco(id, 'facta_clt', {
      status: 'falha',
      mensagem: u.error || u.message || `Erro FACTA (HTTP ${r.status})`,
      retryable: true,
      _raw_response: u,
    });
    return;
  }

  if (u.etapa === 'APROVADO') {
    const dc = u.dadosCliente || {};
    const novoCliente = {};
    if (dc.nome) novoCliente.nome = dc.nome;
    if (dc.dataNascimento) novoCliente.dataNascimento = dc.dataNascimento;
    if (dc.sexo) novoCliente.sexo = dc.sexo;
    if (dc.nomeMae) novoCliente.nomeMae = dc.nomeMae;
    if (Object.keys(novoCliente).length > 0) await mesclarCliente(id, novoCliente);

    await patchBanco(id, 'facta_clt', {
      status: 'ok',
      disponivel: true,
      mensagem: u.mensagem,
      dados: {
        margemDisponivel: u.margem?.disponivel || 0,
        margemBase: u.margem?.base || 0,
        empregador: u.vinculo?.empregador,
        empregadorCnpj: u.vinculo?.cnpj,
        matricula: u.vinculo?.matricula,
      },
    });
    if (u.vinculo?.cnpj) {
      _registrarAprovacao(u.vinculo.cnpj, u.vinculo.empregador, 'facta_clt', null, null, null);
    }
    return;
  }

  if (u.etapa === 'AGUARDA_AUTORIZACAO') {
    await patchBanco(id, 'facta_clt', {
      status: 'bloqueado',
      bloqueado: true,
      precisaAutorizacao: true,
      mensagem: u.mensagem,
      retryable: true,
    });
    return;
  }

  if (u.etapa === 'INDISPONIVEL') {
    await patchBanco(id, 'facta_clt', {
      status: 'manual_aguardando',
      disponivel: false,
      manual: false,
      mensagem: u.mensagem,
      retryable: true,
    });
    return;
  }

  // SEM_MARGEM / ERRO
  await patchBanco(id, 'facta_clt', {
    status: 'falha',
    disponivel: false,
    mensagem: u.mensagem || 'FACTA nao retornou margem',
    retryable: u.etapa === 'ERRO',
    _raw_response: u,
  });
}

async function processarC6(id, cpf, incluirC6, auth, secret) {
  const manut = await _bancoEmManutencao('c6');
  if (manut) { await _marcarEmManutencao(id, 'c6', manut); return; }
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

  // ─── PRECHECK ──────────────────────────────────────────────
  // Verifica se as bases (clt_clientes + CAGED) ja tem os dados basicos
  // do CPF (nome, dataNasc, telefone). Usado pela tela de consulta pra
  // decidir: se tem tudo → segue direto; se falta → obriga operador a
  // digitar nome/dataNasc/telefone antes de criar a consulta.
  if (action === 'precheck') {
    const cpf = normalizeCPF(body.cpf);
    if (!cpf) return jsonError('CPF inválido', 400, req);

    let nome = null, dataNascimento = null, sexo = null;
    let telefone = null;

    // 1) clt_clientes (consultas anteriores — dados mais frescos)
    try {
      const { data: cli } = await dbSelect('clt_clientes', { filters: { cpf }, single: true });
      if (cli) {
        if (cli.nome) nome = cli.nome;
        if (cli.data_nascimento) dataNascimento = cli.data_nascimento;
        if (cli.sexo) sexo = cli.sexo;
        if (Array.isArray(cli.telefones) && cli.telefones.length > 0) {
          telefone = cli.telefones[0].completo || null;
        }
      }
    } catch { /* segue */ }

    // 2) Fallback CAGED (clt_base_funcionarios) — preenche o que faltou
    try {
      const { data: caged } = await dbSelect('clt_base_funcionarios', { filters: { cpf }, single: true });
      if (caged) {
        if (!nome && caged.nome) nome = caged.nome;
        if (!dataNascimento && caged.data_nascimento) dataNascimento = caged.data_nascimento;
        if (!sexo && caged.sexo) sexo = caged.sexo;
        if (!telefone && caged.ddd && caged.telefone) telefone = caged.ddd + caged.telefone;
      }
    } catch { /* segue */ }

    const temNome = !!(nome && nome.trim());
    const temDataNascimento = !!dataNascimento;
    const temTelefone = !!(telefone && String(telefone).replace(/\D/g, '').length >= 10);
    const completo = temNome && temDataNascimento && temTelefone;

    return jsonResp({
      success: true,
      completo,           // true = pode seguir direto; false = obrigar preenchimento
      temNome, temDataNascimento, temTelefone,
      faltam: [
        !temNome && 'nome',
        !temDataNascimento && 'dataNascimento',
        !temTelefone && 'telefone',
      ].filter(Boolean),
      dados: {            // pre-preenche o form com o que ja existe
        nome: nome || null,
        dataNascimento: dataNascimento || null,
        sexo: sexo || null,
        telefone: telefone ? String(telefone).replace(/\D/g, '') : null,
      },
    }, 200, req);
  }

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
    // Telefone manual digitado pelo operador (destrava autorizacao automatica
    // de bancos que exigem nome+dataNasc+telefone, ex: Handbank UY3)
    const telefoneManualBruto = (body.telefone || '').toString().replace(/\D/g, '');
    let telefoneManual = null;
    if (telefoneManualBruto.length === 10 || telefoneManualBruto.length === 11) {
      telefoneManual = {
        ddd: telefoneManualBruto.substring(0, 2),
        numero: telefoneManualBruto.substring(2),
        completo: telefoneManualBruto,
        whatsapp: true,
        fonte: 'manual_operador'
      };
    }
    const incluirC6 = body.incluirC6 !== false; // default true

    // Filtro de bancos: body.bancos = ['fintech_qi', 'handbank', ...] dispara
    // SO esses (multicorban sempre roda — eh enriquecimento).
    // O `inicial` so deve conter os bancos que VAO rodar — caso contrario
    // o status_geral nunca vai pra 'concluido' (banco em pending eterno).
    const filtroSolicitadoBancos = Array.isArray(body.bancos) && body.bancos.length > 0
      ? [...new Set([...body.bancos, 'multicorban'])].filter(b => TODOS_BANCOS_CLT.includes(b))
      : TODOS_BANCOS_CLT;

    const inicial = Object.fromEntries(
      filtroSolicitadoBancos.map(b => [b, { status: 'pending' }])
    );

    // PRE-POPULA cliente com o que ja sabemos desse CPF (clt_clientes acumulado).
    // Assim mesmo que o PB ou MC nao tragam dados nessa consulta, o V8 ainda
    // consegue gerar termo com dataNasc/sexo de consultas anteriores.
    // Manuais tem PRIORIDADE — operador supre o que bancos nao trazem
    let clienteInicial = {};
    if (nomeManual) clienteInicial.nome = nomeManual;
    if (dataNascManual) clienteInicial.dataNascimento = dataNascManual;
    if (sexoManual) clienteInicial.sexo = sexoManual;
    if (telefoneManual) clienteInicial.telefones = [telefoneManual];

    try {
      const { data: clienteSalvo } = await dbSelect('clt_clientes', {
        filters: { cpf }, single: true
      });
      if (clienteSalvo) {
        // Reusa: nome (se nao tem manual), dataNasc, sexo, mae, telefones
        if (!clienteInicial.nome && clienteSalvo.nome) clienteInicial.nome = clienteSalvo.nome;
        if (!clienteInicial.dataNascimento && clienteSalvo.data_nascimento) clienteInicial.dataNascimento = clienteSalvo.data_nascimento;
        if (!clienteInicial.sexo && clienteSalvo.sexo) clienteInicial.sexo = clienteSalvo.sexo;
        if (clienteSalvo.nome_mae) clienteInicial.nomeMae = clienteSalvo.nome_mae;
        if (clienteSalvo.idade) clienteInicial.idade = clienteSalvo.idade;
        // Telefone manual sempre fica no topo; salvos vao depois (sem duplicar)
        if (Array.isArray(clienteSalvo.telefones) && clienteSalvo.telefones.length > 0) {
          if (!clienteInicial.telefones?.length) {
            clienteInicial.telefones = clienteSalvo.telefones;
          } else {
            const jaTem = new Set(clienteInicial.telefones.map(t => t.completo));
            for (const t of clienteSalvo.telefones) {
              if (!jaTem.has(t.completo)) clienteInicial.telefones.push(t);
            }
          }
        }
        if (clienteSalvo.email) clienteInicial.emails = [clienteSalvo.email];
      }
    } catch { /* nao quebra se nao tem ainda */ }

    // FALLBACK: Base CAGED 2024 (clt_base_funcionarios) — 43M+ CPFs do Brasil.
    // So usamos os campos que CONTINUAM faltando apos clt_clientes (priorizamos
    // dados de consultas anteriores, que sao mais frescos que dados do CAGED 2024).
    let vinculoInicial = null;
    try {
      const { data: baseCaged } = await dbSelect('clt_base_funcionarios', {
        filters: { cpf }, single: true
      });
      if (baseCaged) {
        if (!clienteInicial.nome && baseCaged.nome) clienteInicial.nome = baseCaged.nome;
        if (!clienteInicial.dataNascimento && baseCaged.data_nascimento) clienteInicial.dataNascimento = baseCaged.data_nascimento;
        if (!clienteInicial.sexo && baseCaged.sexo) clienteInicial.sexo = baseCaged.sexo;
        if (!clienteInicial.telefones?.length && baseCaged.ddd && baseCaged.telefone) {
          const completo = baseCaged.ddd + baseCaged.telefone;
          clienteInicial.telefones = [{
            ddd: baseCaged.ddd, numero: baseCaged.telefone,
            completo, whatsapp: true, fonte: 'caged_2024'
          }];
        }
        if (!clienteInicial.emails?.length && baseCaged.email) {
          clienteInicial.emails = [baseCaged.email];
        }
        // Pre-popula vinculo com info de empregador (CAGED tem CNPJ + nome + admissao)
        if (baseCaged.empregador_cnpj) {
          vinculoInicial = {
            cnpj: baseCaged.empregador_cnpj,
            empregador: baseCaged.empregador_nome,
            dataAdmissao: baseCaged.data_admissao,
            cnae: baseCaged.cnae,
            cbo: baseCaged.cbo,
            fonte: 'caged_2024'
          };
        }
      }
    } catch { /* base pode ainda nao estar populada — segue sem */ }

    if (Object.keys(clienteInicial).length === 0) clienteInicial = null;

    // Origem do registro: 'lote' (higienizacao em lote) muda o criada_por_nome
    // pra "Higienizacao Lote · <user>". Default 'unitaria' usa nome do user.
    const origem = body.origem === 'lote' ? 'lote' : 'unitaria';

    // OVERRIDE DE DONO (so chamada interna): cron de reconsulta atribui a
    // consulta ao VENDEDOR ORIGINAL (preserva isolamento multi-tenant — cada
    // vendedor ve as suas). body.comoUserId/comoUserNome/comoParceiroId.
    let donoUserId = user?.id || null;
    let donoParceiroId = user?.parceiro_id || null;
    let nomeOperador = user?.nome || user?.username || 'Sistema';
    if (user?._internal && body.comoUserId) {
      donoUserId = body.comoUserId;
      donoParceiroId = body.comoParceiroId ?? null;
      nomeOperador = body.comoUserNome || nomeOperador;
    }
    const criadaPorNome = origem === 'lote'
      ? `Reconsulta Lote · ${nomeOperador}`
      : nomeOperador;

    // MODO STANDBY: ate 26/06 07h, consultas de operador ficam paradas
    // (status_geral='standby') e disparam em massa no cron do dia 26.
    const standby = emStandbyAgora(user);

    const { data: row, error } = await dbInsert('clt_consultas_fila', {
      cpf, nome_manual: nomeManual, incluir_c6: incluirC6,
      status_geral: standby ? 'standby' : 'processando',
      bancos: inicial,
      cliente: clienteInicial,
      vinculo: vinculoInicial, // pre-populado do CAGED se disponivel
      iniciado_em: new Date().toISOString(),
      criada_por_user_id: donoUserId,
      criada_por_nome: criadaPorNome,
      parceiro_id: donoParceiroId // isolamento multi-tenant
    });
    if (error) return jsonError('Erro criando fila: ' + error, 500, req);

    // Em standby: NAO dispara os processadores agora. O cron do dia 26/06
    // (clt-cron-reconsulta) pega as filas 'standby' e dispara em massa.
    if (standby) {
      return jsonResp({
        success: true,
        id: row.id,
        cpf,
        standby: true,
        mensagem: '⏸️ Consulta agendada — será processada em 26/06 às 07h (modo standby).',
      }, 200, req);
    }

    // DISPARA OS PROCESSADORES NO BACKEND — garantia de execucao mesmo se
    // o frontend fechar a janela. Cada um roda em paralelo (fetch sem await),
    // mas como o handler `processar` faz await ate terminar, o trabalho roda
    // ate o fim mesmo se o cliente desconectar.
    //
    // Bancos que serao disparados — ja calculado em filtroSolicitadoBancos
    // logo apos `inicial`. Usa a mesma variavel pra garantir consistencia:
    // bancos disparados == chaves do inicial == bancos que patchBanco checa.
    const bancos = filtroSolicitadoBancos;
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
      else if (banco === 'handbank') await processarHandbank(id, row.cpf, auth, secret);
      else if (banco === 'c6') await processarC6(id, row.cpf, !!row.incluir_c6, auth, secret);
      else if (banco === 'fintech_qi') await processarFintech(id, 'qi', row.cpf, auth, secret);
      else if (banco === 'fintech_celcoin') await processarFintech(id, 'celcoin', row.cpf, auth, secret);
      else if (banco === 'unno') await processarUnno(id, row.cpf, auth, secret);
      else if (banco === 'nossa_fintech') await processarNossaFintech(id, row.cpf, 'nossa_fintech', 'QITECH', auth, secret);
      else if (banco === 'nossa_fintech_uy3') await processarNossaFintech(id, row.cpf, 'nossa_fintech_uy3', 'UY3', auth, secret);
      else if (banco === 'facta_clt') await processarFacta(id, row.cpf, auth, secret);
      else return jsonError('Banco inválido. Válidos: presencabank, multicorban, v8_qi, v8_celcoin, joinbank, mercantil, handbank, c6, fintech_qi, fintech_celcoin, unno, nossa_fintech, nossa_fintech_uy3, facta_clt', 400, req);
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
    let { data: row } = await dbSelect('clt_consultas_fila', { filters: { id }, single: true });
    if (!row) return jsonError('Fila não encontrada', 404, req);
    // Isolamento: usuario so ve fila do proprio escopo (parceiro/user).
    // Retorna 404 (nao 403) pra nao revelar que o id existe.
    // EXCECAO pool-comum: o Pipeline CLT (action 'pipeline') e compartilhado
    // entre todos os operadores ("disponivel para todos que consultaram"). Ao
    // abrir um cliente DE LA, o front manda `pool:true` — leitura liberada
    // (so leitura; processar/digitar continuam isolados pelas suas actions).
    const leituraPool = body.pool === true;
    if (!leituraPool && !podeVerFilaCLT(user, row)) return jsonError('Fila não encontrada', 404, req);

    // REFRESH ATIVO V8: se um V8 esta processando ha mais de 60s
    // (CONSENT_APPROVED ou WAITING_CREDIT_ANALYSIS), re-consulta sincronamente
    // pra ver se ja virou SUCCESS. Sem isso o card fica eternamente "aguardando
    // confirmação" no card e eventualmente cai pro timeout 10min como FALHA.
    if (row.status_geral === 'processando' && row.iniciado_em) {
      const idadeMs = Date.now() - new Date(row.iniciado_em).getTime();
      if (idadeMs > 60 * 1000) {
        for (const provider of ['QI', 'CELCOIN']) {
          const k = provider === 'QI' ? 'v8_qi' : 'v8_celcoin';
          const b = row.bancos?.[k];
          if (b && (b.status === 'processando' || b.processando === true)) {
            try {
              const v8r = await callApi('/api/v8', { action: 'consultarPorCPF', cpf: row.cpf, provider }, auth, secret);
              const v8 = v8r.data || {};
              if (v8.encontrado && v8.status === 'SUCCESS') {
                await patchBanco(id, k, {
                  status: 'ok', disponivel: true, processando: false,
                  consultId: v8.consultId,
                  mensagem: `Cliente elegível — margem R$ ${parseFloat(v8.availableMarginValue || 0).toFixed(2)}`,
                  dados: { margemDisponivel: parseFloat(v8.availableMarginValue || 0), consultId: v8.consultId }
                });
              } else if (['REJECTED', 'FAILED'].includes(v8.status)) {
                await patchBanco(id, k, {
                  status: 'falha', processando: false,
                  mensagem: `❌ ${v8.status}: ${v8.descricao || 'cliente rejeitado'}`
                });
              }
              // Se ainda CONSENT_APPROVED ou WAITING — mantem processando (proxima poll re-tenta)
            } catch { /* ignora erro de refresh, deixa pro proximo poll */ }
          }
        }
        // Re-le row depois das atualizacoes
        const { data: refreshed } = await dbSelect('clt_consultas_fila', { filters: { id }, single: true });
        if (refreshed) row = refreshed;
      }
    }

    // AUTO-RE-TRIGGER UNNO: se Unno esta em manual_aguardando com termUuid
    // ha mais de 8s (tempo razoavel pro polling proposta), re-processa em
    // background pra o operador NAO precisar clicar "re-tentar". O polling
    // proprio do frontend (a cada 2s) eventualmente pega o novo estado.
    // Idempotencia em processarUnno garante que NAO cria termo duplicado.
    {
      const unno = row.bancos?.unno;
      if (unno && unno.status === 'manual_aguardando' && unno.termUuid) {
        const idadeMs = unno.atualizado_em
          ? Date.now() - new Date(unno.atualizado_em).getTime()
          : Infinity;
        if (idadeMs > 8000) {
          // Fire-and-forget — proximo poll do frontend ve o resultado
          const baseUrl = APP_URL();
          fetch(baseUrl + '/api/clt-fila', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret || '' },
            body: JSON.stringify({ action: 'processar', id, banco: 'unno', force: true })
          }).catch(e => console.error('[clt-fila] auto-re-trigger unno:', e.message));
        }
      }
    }

    // TIMEOUT ABSOLUTO: se a fila esta processando ha mais de 10min, forca
    // conclusao marcando bancos pendentes como falha (V8 pode ficar
    // WAITING_CREDIT_ANALYSIS eternamente se DataPrev nao confirmar)
    // IMPORTANTE: usa TODOS_BANCOS_CLT (catalogo central) — antes era lista
    // hardcoded que ficou desatualizada quando entraram fintech_qi/celcoin,
    // mercantil, handbank e joinbank (esses ficavam "processando" eternos).
    if (row.status_geral === 'processando' && row.iniciado_em) {
      const idadeMs = Date.now() - new Date(row.iniciado_em).getTime();
      if (idadeMs > 10 * 60 * 1000) {
        const bancosNovos = { ...(row.bancos || {}) };
        for (const k of TODOS_BANCOS_CLT) {
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
    // Isolamento multi-tenant: aplica escopo do usuario (parceiro/user).
    // Admin/gestor recebem {} (sem filtro) e veem tudo.
    const filters = { ...escopoFiltrosCLT(user) };
    if (body.cpf) filters.cpf = body.cpf;
    if (body.status_geral) filters.status_geral = body.status_geral;
    const { data } = await dbSelect('clt_consultas_fila', {
      filters, order: 'iniciado_em.desc', limit
    });
    return jsonResp({ success: true, items: data || [] }, 200, req);
  }

  // ─── APTOS ── pipeline de clientes APTOS (margem disponivel em >=1 banco)
  // Lista trabalhavel pos-consulta: quem deu certo, melhor margem/banco,
  // vendedor. Mesmo isolamento (vendedor ve os seus, admin ve todos).
  // Dedup por CPF — fica a consulta mais recente apta de cada cliente.
  // PIPELINE: categoriza TODOS os clientes consultados (apto / sem_margem /
  // aguardando / inapto / standby / processando). POOL COMUM — todos veem.
  // 'aptos' mantido como alias (retorna o mesmo payload; frontend filtra).
  if (action === 'pipeline' || action === 'aptos') {
    const limit = Math.min(parseInt(body.limit || 600), 1000);
    const { data } = await dbSelect('clt_consultas_fila', {
      order: 'iniciado_em.desc', limit
    });
    const porCpf = new Map(); // cpf → registro (consulta mais recente)
    for (const c of (data || [])) {
      if (porCpf.has(c.cpf)) continue; // ja tem o mais recente desse CPF

      let melhorMargem = 0, melhorBanco = null, nAptos = 0;
      const bancosAptos = [];
      const aguardandoBancos = []; // slugs dos bancos que travam por autorizacao
      let temOk = false, temAguardando = false, temFalha = false, temPending = false;
      for (const [slug, st] of Object.entries(c.bancos || {})) {
        if (slug === 'multicorban') continue;
        const s = st?.status;
        if (s === 'ok' && st?.disponivel === true) {
          temOk = true;
          let m = parseFloat(st.dados?.margemDisponivel ?? st.dados?.valorLiquido ?? 0) || 0;
          // Normaliza dados LEGADOS: Handbank/UY3 gravava `valor_margem` em
          // CENTAVOS (ex: 226799 = R$ 2.267,99). Margem mensal CLT real nunca
          // passa de ~R$20k → se veio de margemDisponivel e está absurda, ÷100.
          // Idempotente: dados já corrigidos (em reais) ficam abaixo do teto.
          if (st.dados?.margemDisponivel != null && m > 20000) m = m / 100;
          if (m > 0) {
            nAptos++;
            bancosAptos.push({ banco: slug, margem: m });
            if (m > melhorMargem) { melhorMargem = m; melhorBanco = slug; }
          }
        } else if (s === 'bloqueado' || s === 'manual_aguardando') {
          temAguardando = true;
          aguardandoBancos.push(slug);
        } else if (s === 'falha') {
          temFalha = true;
        } else if (s === 'pending' || s === 'processando') {
          temPending = true;
        }
      }

      // "Sem dados": cliente que so esta aguardando autorizacao e nao temos
      // nome nem empregador — nao da pra trabalhar (sem contato/contexto).
      const temNome = !!(c.cliente?.nome || c.nome_manual);
      const temContato = !!(c.cliente?.telefones?.[0]?.completo);
      const semDados = !temNome && !temContato;
      // C6 precisa de selfie/liveness do cliente — destacamos pra acao.
      const precisaSelfieC6 = aguardandoBancos.includes('c6');

      // Categoria (prioridade): apto > standby > processando > sem_margem
      // (elegivel s/ margem) > aguardando (precisa autz, com dados) >
      // sem_dados (aguardando mas sem nome/telefone) > inapto
      let categoria;
      if (melhorMargem > 0) categoria = 'apto';
      else if (c.status_geral === 'standby') categoria = 'standby';
      else if (c.status_geral === 'processando' && temPending && !temOk && !temFalha) categoria = 'processando';
      else if (temOk) categoria = 'sem_margem';
      else if (temAguardando) categoria = semDados ? 'sem_dados' : 'aguardando';
      else categoria = 'inapto';

      bancosAptos.sort((a, b) => b.margem - a.margem);
      porCpf.set(c.cpf, {
        id: c.id,
        cpf: c.cpf,
        nome: c.cliente?.nome || c.nome_manual || '(sem nome)',
        telefone: c.cliente?.telefones?.[0]?.completo || null,
        empregador: c.vinculo?.empregador || null,
        empregadorCnpj: c.vinculo?.cnpj || null,
        categoria,
        melhorBanco,
        melhorMargem,
        totalBancosAptos: nAptos,
        bancosAptos,
        aguardandoBancos,    // quais bancos travam por autorizacao
        precisaSelfieC6,     // C6 esperando selfie do cliente
        vendedor: (c.criada_por_nome || '').replace(/^(Reconsulta|Higienização) Lote · /, ''),
        iniciado_em: c.iniciado_em,
      });
    }
    const clientes = Array.from(porCpf.values()).sort((a, b) => b.melhorMargem - a.melhorMargem);
    const contadores = {};
    for (const c of clientes) contadores[c.categoria] = (contadores[c.categoria] || 0) + 1;
    const somaMargem = clientes.filter(c => c.categoria === 'apto').reduce((s, a) => s + a.melhorMargem, 0);
    return jsonResp({
      success: true,
      total: clientes.length,
      contadores,        // { apto, sem_margem, aguardando, sem_dados, inapto, standby, processando }
      somaMargem,        // soma das margens dos aptos
      clientes,          // lista completa categorizada (frontend filtra por aba)
      // compat com tela antiga:
      aptos: clientes.filter(c => c.categoria === 'apto'),
    }, 200, req);
  }

  // ─── COMPLEMENTAR CLIENTE ─────────────────────────────────
  // Operador completa dados que faltaram (nome/dataNasc/sexo/nomeMae) e o
  // sistema re-dispara automaticamente os bancos que estavam bloqueados por
  // falta desses dados (joinbank principalmente). Tambem persiste em
  // clt_clientes pra reusar em consultas futuras desse CPF.
  if (action === 'complementarCliente') {
    const id = body.id;
    if (!id) return jsonError('id obrigatório', 400, req);
    let { data: row } = await dbSelect('clt_consultas_fila', { filters: { id }, single: true });
    if (!row) return jsonError('Fila não encontrada', 404, req);

    // Normaliza inputs (aceita YYYY-MM-DD ou DD/MM/YYYY)
    const nome = (body.nome || '').trim() || null;
    let dataNasc = (body.dataNascimento || '').trim() || null;
    if (dataNasc) {
      const m1 = dataNasc.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const m2 = dataNasc.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m1) dataNasc = `${m1[1]}-${m1[2]}-${m1[3]}`;
      else if (m2) dataNasc = `${m2[3]}-${m2[2]}-${m2[1]}`;
      else dataNasc = null;
    }
    const sexo = (body.sexo || '').toUpperCase().startsWith('F') ? 'F'
               : (body.sexo || '').toUpperCase().startsWith('M') ? 'M' : null;
    const nomeMae = (body.nomeMae || '').trim() || null;

    if (!nome && !dataNasc && !sexo && !nomeMae) {
      return jsonError('Pelo menos um campo (nome, dataNascimento, sexo ou nomeMae) deve ser fornecido', 400, req);
    }

    // Mescla na fila (sem sobrescrever o que ja tem com vazio)
    const novosDados = {};
    if (nome) novosDados.nome = nome;
    if (dataNasc) novosDados.dataNascimento = dataNasc;
    if (sexo) novosDados.sexo = sexo;
    if (nomeMae) novosDados.nomeMae = nomeMae;
    await mesclarCliente(id, novosDados);

    // Re-le row atualizado
    const { data: rowAtu } = await dbSelect('clt_consultas_fila', { filters: { id }, single: true });
    const cli = rowAtu?.cliente || {};
    const temBasicos = !!(cli.nome && cli.dataNascimento);

    // Re-dispara bancos que estavam bloqueados por falta de dados:
    // joinbank: SEMPRE re-tenta (precisa nome+dataNasc obrigatoriamente)
    // v8_qi/v8_celcoin: re-tenta se status atual nao eh ok
    if (temBasicos) {
      const baseUrl = APP_URL();
      const bancosRedisparar = ['joinbank'];
      // Re-dispara V8 se nao deu ok ainda (precisa termo gerado com dados completos)
      const v8qiSt = rowAtu?.bancos?.v8_qi?.status;
      const v8ccSt = rowAtu?.bancos?.v8_celcoin?.status;
      if (v8qiSt !== 'ok') bancosRedisparar.push('v8_qi');
      if (v8ccSt !== 'ok') bancosRedisparar.push('v8_celcoin');
      // Marca status_geral de volta pra processando se estava concluido
      if (rowAtu?.status_geral === 'concluido') {
        await dbUpdate('clt_consultas_fila', { id }, { status_geral: 'processando' });
      }
      for (const banco of bancosRedisparar) {
        fetch(baseUrl + '/api/clt-fila', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret || '' },
          body: JSON.stringify({ action: 'processar', id, banco })
        }).catch(e => console.error('[complementar] dispatch ' + banco + ':', e.message));
      }
    }

    return jsonResp({
      success: true,
      cliente: cli,
      bancosRedisparados: temBasicos ? ['joinbank', 'v8_qi', 'v8_celcoin'] : [],
      observacao: temBasicos
        ? 'Dados completos. Re-disparei JoinBank/V8 — aguarde alguns segundos.'
        : 'Dados ainda incompletos. Precisa nome + data de nascimento pra re-disparar bancos.'
    }, 200, req);
  }

  // ─── ENRIQUECER COM NOVA VIDA ─────────────────────────────
  // Pega os dados que faltam (nome / nascimento / telefone) no Nova Vida TI
  // por CPF e mescla na consulta. Usado pra "ressuscitar" clientes da categoria
  // "Sem dados" do Pipeline. Depois re-dispara os bancos que dependem desses
  // dados (UY3/Handbank, JoinBank, Unno, Nossa Fintech) pra a consulta andar.
  // Body: { id } (uma fila). Frontend chama 1x por cliente (sem estourar timeout).
  if (action === 'enriquecerNovaVida') {
    const id = body.id;
    if (!id) return jsonError('id obrigatório', 400, req);
    const { data: row } = await dbSelect('clt_consultas_fila', { filters: { id }, single: true });
    if (!row) return jsonError('Fila não encontrada', 404, req);
    const cpf = String(row.cpf || '').replace(/\D/g, '');
    if (cpf.length !== 11) return jsonError('CPF inválido na fila', 400, req);

    // Chama a integração Nova Vida (tem cache de 30d lá dentro)
    const nv = await callApi('/api/novavida', { cpf }, auth, secret).catch(() => ({ ok: false }));
    const d = nv?.data || {};
    if (!d || d.success === false) {
      return jsonResp({
        success: false, id, cpf, enriquecido: false,
        mensagem: d?.error || 'Nova Vida não retornou dados pra esse CPF',
      }, 200, req);
    }

    // Normaliza nascimento (NASC pode vir DD/MM/AAAA, AAAA-MM-DD ou AAAAMMDD)
    let dataNasc = null;
    const ns = String(d.nascimento || '').trim();
    let mm;
    if ((mm = ns.match(/^(\d{2})\/(\d{2})\/(\d{4})$/))) dataNasc = `${mm[3]}-${mm[2]}-${mm[1]}`;
    else if ((mm = ns.match(/^(\d{4})-(\d{2})-(\d{2})/))) dataNasc = `${mm[1]}-${mm[2]}-${mm[3]}`;
    else if ((mm = ns.match(/^(\d{4})(\d{2})(\d{2})$/))) dataNasc = `${mm[1]}-${mm[2]}-${mm[3]}`;

    // Telefones: prioriza WhatsApp; formata { completo, ddd, numero, whatsapp }
    const tels = Array.isArray(d.telefones) ? d.telefones : [];
    const telsFmt = tels
      .map(t => ({
        ddd: String(t.ddd || '').replace(/\D/g, ''),
        numero: String(t.telefone || '').replace(/\D/g, ''),
        completo: `${String(t.ddd || '')}${String(t.telefone || '')}`.replace(/\D/g, ''),
        whatsapp: !!t.whatsapp,
        operadora: t.operadora || null,
      }))
      .filter(t => t.completo.length >= 10)
      .sort((a, b) => (b.whatsapp ? 1 : 0) - (a.whatsapp ? 1 : 0));

    const novoBloco = {};
    if (d.nome) novoBloco.nome = d.nome;
    if (dataNasc) novoBloco.dataNascimento = dataNasc;
    if (telsFmt.length) novoBloco.telefones = telsFmt;
    if (Array.isArray(d.emails) && d.emails.length) novoBloco.emails = d.emails;

    const achouAlgo = !!(novoBloco.nome || novoBloco.dataNascimento || novoBloco.telefones);
    if (!achouAlgo) {
      return jsonResp({ success: true, id, cpf, enriquecido: false, mensagem: 'Nova Vida não tinha nome/telefone pra esse CPF' }, 200, req);
    }

    // Mescla (sem sobrescrever o que já existe) na fila + clt_clientes
    await mesclarCliente(id, novoBloco);
    const { data: rowAtu } = await dbSelect('clt_consultas_fila', { filters: { id }, single: true });
    const cli = rowAtu?.cliente || {};
    const temBasicos = !!(cli.nome && cli.dataNascimento);
    const temTelefone = Array.isArray(cli.telefones) && cli.telefones.length > 0;

    // Re-dispara bancos que dependem de nome/data/telefone (se temos o básico).
    // Só re-dispara os que NÃO estão 'ok' ainda — evita refazer trabalho.
    let redisparados = [];
    if ((temBasicos || temTelefone) && body.redisparar !== false) {
      const baseUrl = APP_URL();
      const candidatos = ['handbank', 'joinbank', 'unno', 'nossa_fintech', 'nossa_fintech_uy3'];
      for (const banco of candidatos) {
        const st = rowAtu?.bancos?.[banco]?.status;
        if (st === 'ok') continue;
        redisparados.push(banco);
        fetch(baseUrl + '/api/clt-fila', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret || '' },
          body: JSON.stringify({ action: 'processar', id, banco, force: true }),
        }).catch(() => {});
      }
      if (redisparados.length && rowAtu?.status_geral === 'concluido') {
        await dbUpdate('clt_consultas_fila', { id }, { status_geral: 'processando' });
      }
    }

    return jsonResp({
      success: true, id, cpf, enriquecido: true,
      campos: {
        nome: novoBloco.nome || null,
        dataNascimento: novoBloco.dataNascimento || null,
        telefone: telsFmt[0]?.completo || null,
        totalTelefones: telsFmt.length,
      },
      redisparados,
      mensagem: `Enriquecido via Nova Vida${redisparados.length ? ` — re-disparei ${redisparados.length} banco(s)` : ''}.`,
    }, 200, req);
  }

  return jsonError('Action inválida. Válidas: criar, processar, status, listar, complementarCliente, enriquecerNovaVida, pipeline', 400, req);
}
