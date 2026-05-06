// ══════════════════════════════════════════════════════════════════
// api/pref.js — Modulo PREFEITURAS
//
// Espelha api/gov.js mas usa as tabelas pref_*. Adiciona suporte a
// filtro por municipio (alem de uf, busca, tipo).
//
// Actions:
//   - listConvenios       → lista convenios (filtros: uf, municipio, tipo, busca)
//   - getConvenio         → detalhe de 1 convenio com bancos + regras
//   - listBancos          → lista todos os bancos PREF
//   - analisarHolerite    → recebe arquivo (base64), extrai via Claude, cruza
//   - listAnalises        → historico de holerites
//   - getAnalise          → detalhe de 1 analise
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';
import { dbInsert, dbUpdate, dbQuery } from './_lib/supabase.js';

const CLAUDE_KEY = () => process.env.CLAUDE_API_KEY;
const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);
  if (req.method !== 'POST') return jsonError('Method Not Allowed', 405, req);

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  let body = {};
  try { body = await req.json(); } catch { return jsonError('JSON invalido', 400, req); }
  const action = body.action;

  try {
    switch (action) {
      case 'listConvenios':       return await listConvenios(body, req);
      case 'getConvenio':         return await getConvenio(body, req);
      case 'listBancos':          return await listBancos(body, req);
      case 'analisarHolerite':    return await analisarHolerite(body, req, auth);
      case 'listAnalises':        return await listAnalises(body, req, auth);
      case 'getAnalise':          return await getAnalise(body, req, auth);
      // ── Admin/gestor: cadastro manual de bancos em convenios ──
      case 'criarBanco':          return await adminCriarBanco(body, req, auth);
      case 'upsertBancoConvenio': return await adminUpsertBancoConvenio(body, req, auth);
      case 'deleteBancoConvenio': return await adminDeleteBancoConvenio(body, req, auth);
      default: return jsonError(`Action desconhecida: ${action}`, 400, req);
    }
  } catch (e) {
    return jsonError(`Erro interno: ${e.message}`, 500, req);
  }
}

// ══════════════════════════════════════════════════════════════
// ADMIN: criar banco novo em pref_bancos
// body: { nome, slug? (auto se vazio), observacoes? }
// ══════════════════════════════════════════════════════════════
async function adminCriarBanco(body, req, auth) {
  if (auth.role !== 'admin' && auth.role !== 'gestor') return jsonError('Sem permissao', 403, req);
  if (!body.nome || !body.nome.trim()) return jsonError('nome obrigatorio', 400, req);
  const nome = body.nome.trim();
  // gera slug se nao fornecido
  const slug = (body.slug || nome).toString().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  if (!slug) return jsonError('slug invalido apos normalizacao', 400, req);

  // upsert
  const url = `${process.env.SUPABASE_URL}/rest/v1/pref_bancos?on_conflict=slug`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify({ slug, nome, observacoes: body.observacoes || null })
  });
  if (!resp.ok) {
    const t = await resp.text();
    return jsonError(`Falha ao criar banco: ${t.substring(0,300)}`, 500, req);
  }
  const arr = await resp.json();
  return jsonResp({ ok: true, banco: Array.isArray(arr) ? arr[0] : arr }, 200, req);
}

// ══════════════════════════════════════════════════════════════
// ADMIN: criar/atualizar vinculo banco x convenio com regras
// body: { id? (atualizar) | banco_id+convenio_id (criar), regras... }
// ══════════════════════════════════════════════════════════════
async function adminUpsertBancoConvenio(body, req, auth) {
  if (auth.role !== 'admin' && auth.role !== 'gestor') return jsonError('Sem permissao', 403, req);
  if (!body.banco_id) return jsonError('banco_id obrigatorio', 400, req);
  if (!body.convenio_id) return jsonError('convenio_id obrigatorio', 400, req);

  // Helpers de saneamento
  const tobool = v => v === true || v === 'true' || v === 1 || v === '1';
  const tonum = v => (v === '' || v === null || v === undefined) ? null : Number(v);
  const toint = v => (v === '' || v === null || v === undefined) ? null : parseInt(v, 10);
  const tostr = v => (v === '' || v === null || v === undefined) ? null : String(v);

  // Margem/Taxa: aceita "35" (%) ou "0.35" (decimal)
  const parsePct = v => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(String(v).replace(',', '.').replace('%', '').trim());
    if (isNaN(n)) return null;
    return n > 1 ? n / 100 : n;
  };

  const dados = {
    banco_id: toint(body.banco_id),
    convenio_id: toint(body.convenio_id),
    opera_novo: tobool(body.opera_novo),
    opera_refin: tobool(body.opera_refin),
    opera_port: tobool(body.opera_port),
    opera_cartao: tobool(body.opera_cartao),
    suspenso: tobool(body.suspenso),
    regime_atendido: ['RPPS','RGPS','AMBOS'].includes(body.regime_atendido) ? body.regime_atendido : 'RPPS',
    publico_ativo: body.publico_ativo === undefined ? true : tobool(body.publico_ativo),
    publico_aposentado: body.publico_aposentado === undefined ? true : tobool(body.publico_aposentado),
    publico_pensionista: body.publico_pensionista === undefined ? true : tobool(body.publico_pensionista),
    margem_utilizavel: parsePct(body.margem_utilizavel),
    taxa_minima_port: parsePct(body.taxa_minima_port),
    idade_min: toint(body.idade_min),
    idade_max: toint(body.idade_max),
    prazo_max_meses: toint(body.prazo_max_meses),
    valor_minimo_op: tonum(body.valor_minimo_op),
    valor_maximo_op: tonum(body.valor_maximo_op),
    data_corte: tostr(body.data_corte),
    valor_minimo: tostr(body.valor_minimo),
    qtd_contratos: tostr(body.qtd_contratos),
    observacoes_admin: tostr(body.observacoes_admin),
    criado_por_admin: true,
    editado_manual: true,
    criado_por_user_id: auth.id || null,
  };

  // UPSERT por (banco_id, convenio_id)
  const url = `${process.env.SUPABASE_URL}/rest/v1/pref_banco_convenio?on_conflict=banco_id,convenio_id`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify(dados)
  });
  if (!resp.ok) {
    const t = await resp.text();
    return jsonError(`Falha ao salvar: ${t.substring(0,400)}`, 500, req);
  }
  const arr = await resp.json();
  return jsonResp({ ok: true, vinculo: Array.isArray(arr) ? arr[0] : arr }, 200, req);
}

// ══════════════════════════════════════════════════════════════
// ADMIN: remove vinculo banco x convenio
// body: { id }
// ══════════════════════════════════════════════════════════════
async function adminDeleteBancoConvenio(body, req, auth) {
  if (auth.role !== 'admin' && auth.role !== 'gestor') return jsonError('Sem permissao', 403, req);
  if (!body.id) return jsonError('id obrigatorio', 400, req);
  const url = `${process.env.SUPABASE_URL}/rest/v1/pref_banco_convenio?id=eq.${parseInt(body.id,10)}`;
  const resp = await fetch(url, {
    method: 'DELETE',
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    }
  });
  if (!resp.ok) {
    const t = await resp.text();
    return jsonError(`Falha ao remover: ${t.substring(0,300)}`, 500, req);
  }
  return jsonResp({ ok: true }, 200, req);
}

// ── listConvenios ───────────────────────────────────────────────
async function listConvenios(body, req) {
  const filtros = ['ativo=eq.true'];
  if (body.uf) filtros.push(`uf=eq.${encodeURIComponent(body.uf)}`);
  if (body.tipo) filtros.push(`tipo=eq.${encodeURIComponent(body.tipo)}`);
  if (body.municipio) filtros.push(`municipio=ilike.*${encodeURIComponent(body.municipio)}*`);
  if (body.busca) {
    filtros.push(`or=(nome.ilike.*${encodeURIComponent(body.busca)}*,municipio.ilike.*${encodeURIComponent(body.busca)}*,sheet_origem.ilike.*${encodeURIComponent(body.busca)}*)`);
  }
  filtros.push('order=uf.asc.nullslast,municipio.asc.nullslast,nome.asc');
  filtros.push('select=id,slug,nome,uf,estado_nome,municipio,tipo,sheet_origem,atualizado_em');
  // PostgREST default limita a 1000 — precisamos explicito porque sao 400+ convenios
  filtros.push('limit=2000');

  const { data, error } = await dbQuery('pref_convenios', filtros.join('&'));
  if (error) return jsonError(`Falha ao listar convenios: ${error}`, 500, req);

  // Agrupa por UF -> Municipio
  const porUf = {};
  for (const c of data || []) {
    const k = c.uf || 'OUTROS';
    if (!porUf[k]) porUf[k] = { uf: k, estado_nome: c.estado_nome, convenios: [] };
    porUf[k].convenios.push(c);
  }
  const grupos = Object.values(porUf).sort((a, b) =>
    (a.uf || 'ZZ').localeCompare(b.uf || 'ZZ')
  );

  return jsonResp({ ok: true, total: data?.length || 0, grupos, convenios: data || [] }, 200, req);
}

// ── getConvenio ────────────────────────────────────────────────
async function getConvenio(body, req) {
  if (!body.slug && !body.id) return jsonError('slug ou id obrigatorio', 400, req);
  const filter = body.slug ? `slug=eq.${encodeURIComponent(body.slug)}` : `id=eq.${body.id}`;
  const { data: conv, error: e1 } = await dbQuery(
    'pref_convenios',
    `${filter}&select=*&limit=1`,
    { single: true }
  );
  if (e1 || !conv) return jsonError('Convenio nao encontrado', 404, req);

  const { data: rels, error: e2 } = await dbQuery(
    'pref_banco_convenio',
    `convenio_id=eq.${conv.id}&select=*,pref_bancos(slug,nome,observacoes)&order=suspenso.asc.nullslast`
  );
  if (e2) return jsonError(`Falha ao buscar bancos: ${e2}`, 500, req);

  const bancos = (rels || []).map(r => ({
    id: r.id,
    banco_id: r.banco_id,
    banco_slug: r.pref_bancos?.slug,
    banco_nome: r.pref_bancos?.nome,
    suspenso: r.suspenso,
    operacoes: {
      novo: r.opera_novo,
      refin: r.opera_refin,
      port: r.opera_port,
      cartao: r.opera_cartao,
    },
    regime_atendido: r.regime_atendido || 'RPPS',
    publico_ativo: r.publico_ativo !== false,
    publico_aposentado: r.publico_aposentado !== false,
    publico_pensionista: r.publico_pensionista !== false,
    margem_utilizavel: r.margem_utilizavel,
    idade_min: r.idade_min,
    idade_max: r.idade_max,
    taxa_minima_port: r.taxa_minima_port,
    prazo_max_meses: r.prazo_max_meses,
    valor_minimo_op: r.valor_minimo_op,
    valor_maximo_op: r.valor_maximo_op,
    data_corte: r.data_corte,
    valor_minimo: r.valor_minimo,
    qtd_contratos: r.qtd_contratos,
    observacoes_admin: r.observacoes_admin,
    criado_por_admin: r.criado_por_admin || false,
    atributos: r.atributos || {},
    atributos_brutos: r.atributos_brutos || [],
  }));

  return jsonResp({ ok: true, convenio: conv, bancos }, 200, req);
}

// ── listBancos ──────────────────────────────────────────────────
async function listBancos(body, req) {
  const { data, error } = await dbQuery(
    'pref_bancos',
    'ativo=eq.true&order=nome.asc&select=id,slug,nome,observacoes&limit=200'
  );
  if (error) return jsonError(`Falha ao listar bancos: ${error}`, 500, req);
  return jsonResp({ ok: true, total: data?.length || 0, bancos: data || [] }, 200, req);
}

// ── analisarHolerite ────────────────────────────────────────────
async function analisarHolerite(body, req, auth) {
  const t0 = Date.now();
  const { arquivo_base64, arquivo_nome, arquivo_tipo } = body;
  if (!arquivo_base64) return jsonError('arquivo_base64 obrigatorio', 400, req);
  if (!arquivo_tipo) return jsonError('arquivo_tipo obrigatorio', 400, req);

  const tipo = String(arquivo_tipo).toLowerCase();
  const ehPdf = tipo === 'application/pdf';
  const ehImagem = ['image/jpeg','image/jpg','image/png','image/webp','image/gif'].includes(tipo);
  if (!ehPdf && !ehImagem) {
    return jsonError(`Tipo nao suportado: ${arquivo_tipo}. Use PDF, JPG, PNG ou WEBP.`, 400, req);
  }
  const tamanhoBytes = Math.floor((arquivo_base64.length * 3) / 4);
  if (tamanhoBytes > MAX_FILE_BYTES) {
    return jsonError(`Arquivo muito grande: ${(tamanhoBytes/1024/1024).toFixed(1)}MB. Maximo: 10MB.`, 400, req);
  }

  const insertResp = await dbInsert('pref_holerite_analises', {
    user_id: auth.id && auth.id !== 0 ? auth.id : null,
    parceiro_nome: auth.name || auth.username || null,
    arquivo_nome: arquivo_nome || null,
    arquivo_tipo: tipo,
    arquivo_tamanho_bytes: tamanhoBytes,
    status: 'processando',
    modelo_ia: CLAUDE_MODEL,
  });
  if (insertResp.error) return jsonError(`Falha ao criar registro: ${insertResp.error}`, 500, req);
  const analiseId = insertResp.data.id;

  try {
    const dadosExtraidos = await extrairDadosHolerite(arquivo_base64, tipo);
    if (!dadosExtraidos.ok) {
      await dbUpdate('pref_holerite_analises', { id: analiseId }, {
        status: 'erro',
        erro_mensagem: dadosExtraidos.erro,
        duracao_ms: Date.now() - t0,
      });
      return jsonError(`Falha na extracao: ${dadosExtraidos.erro}`, 500, req);
    }
    const dados = dadosExtraidos.dados;

    let convenio = null, confianca = 'baixa';
    if (body.convenio_id || body.convenio_slug) {
      const filter = body.convenio_id
        ? `id=eq.${body.convenio_id}`
        : `slug=eq.${encodeURIComponent(body.convenio_slug)}`;
      const r = await dbQuery('pref_convenios', `${filter}&limit=1`, { single: true });
      if (r.data) { convenio = r.data; confianca = 'usuario'; }
    } else if (dados.convenio_sugerido || dados.municipio) {
      // tenta achar pelo municipio + UF (mais preciso pra prefeituras), depois por nome
      const sugestao = (dados.municipio || dados.convenio_sugerido || '').toLowerCase();
      const uf = (dados.uf || '').toUpperCase();
      let q = `municipio=ilike.*${encodeURIComponent(sugestao)}*&limit=10&select=id,slug,nome,uf,municipio,tipo`;
      if (uf) q = `uf=eq.${uf}&` + q;
      let r = await dbQuery('pref_convenios', q);
      if ((!r.data || r.data.length === 0) && dados.convenio_sugerido) {
        r = await dbQuery(
          'pref_convenios',
          `nome=ilike.*${encodeURIComponent(dados.convenio_sugerido.toLowerCase())}*&limit=10&select=id,slug,nome,uf,municipio,tipo`
        );
      }
      if (r.data && r.data.length > 0) {
        // prioriza tipo=prefeitura sobre cartao_beneficio quando ha multiplos
        const sorted = r.data.slice().sort((a, b) => {
          const score = (t) => t === 'prefeitura' ? 0 : t === 'instituto_previdencia' ? 1 : 2;
          return score(a.tipo) - score(b.tipo);
        });
        convenio = sorted[0];
        confianca = r.data.length === 1 ? 'alta' : 'media';
      }
    }

    let bancosAtendem = [], bancosNaoAtendem = [];
    if (convenio) {
      const cruzamento = await cruzarHoleriteComBancos(convenio.id, dados);
      bancosAtendem = cruzamento.atendem;
      bancosNaoAtendem = cruzamento.nao_atendem;
    }

    await dbUpdate('pref_holerite_analises', { id: analiseId }, {
      dados_extraidos: dados,
      convenio_sugerido_id: convenio?.id || null,
      convenio_confianca: confianca,
      bancos_atendem: bancosAtendem,
      bancos_nao_atendem: bancosNaoAtendem,
      status: 'concluido',
      duracao_ms: Date.now() - t0,
    });

    return jsonResp({
      ok: true,
      analise_id: analiseId,
      dados_extraidos: dados,
      convenio,
      convenio_confianca: confianca,
      bancos_atendem: bancosAtendem,
      bancos_nao_atendem: bancosNaoAtendem,
      duracao_ms: Date.now() - t0,
    }, 200, req);
  } catch (e) {
    await dbUpdate('pref_holerite_analises', { id: analiseId }, {
      status: 'erro',
      erro_mensagem: e.message,
      duracao_ms: Date.now() - t0,
    });
    return jsonError(`Erro processando: ${e.message}`, 500, req);
  }
}

async function extrairDadosHolerite(base64, tipo) {
  const ehPdf = tipo === 'application/pdf';
  const tipoMidia = ehPdf ? 'document' : 'image';
  const mediaType = ehPdf ? 'application/pdf'
    : (tipo === 'image/jpg' ? 'image/jpeg' : tipo);

  const systemPrompt = `Voce e um assistente especializado em ler holerites/contracheques de servidores publicos MUNICIPAIS brasileiros (prefeituras, institutos de previdencia municipal, autarquias, hospitais municipais).
Sua tarefa e extrair dados estruturados em JSON.

REGRAS:
- Se um campo nao estiver presente ou nao puder ser identificado com seguranca, use null.
- Valores monetarios em numero (sem R$, sem separador de milhar). Use ponto como decimal.
- Datas no formato YYYY-MM-DD.
- Idade em anos completos (calcule a partir da data de nascimento se houver, ou retorne null).
- Margem consignavel: muitos holerites mostram "MARGEM CONSIGNAVEL" ou "MARGEM DISPONIVEL" — extraia o VALOR DISPONIVEL.
- "municipio": cidade onde o servidor trabalha (ex: "Sorocaba", "Belo Horizonte"). MUITO IMPORTANTE pra prefeituras.
- "convenio_sugerido": orgao/instituto que paga (ex: "PREFEITURA DE SOROCABA", "IPREM CAMPINAS", "FUNPREV BAURU").
- "uf": sigla 2 letras do estado.

REGIME PREVIDENCIARIO (CRITICO PRA CONSIGNADO):
- Procure nos descontos: "INSS" / "I.N.S.S." / "PREV. SOCIAL" / "RGPS" → regime_previdenciario = "RGPS"
  (servidor CLT, comissionado, contrato temporario, designado — NAO eh estatutario)
- Procure: "IPREM" / "IPSEM" / "FUNPREV" / "IPMDC" / "IPVV" / "PREV. MUNICIPAL" / qualquer instituto municipal
  ou estadual de previdencia → regime_previdenciario = "RPPS" (servidor estatutario efetivo)
- Se nao tiver desconto de previdencia identificado → regime_previdenciario = "INDEFINIDO"
- Se tiver AMBOS (raro, mas pode em casos de duplo vinculo) → regime_previdenciario = "AMBOS"

TIPO DE VINCULO (a partir do cargo + outros indicadores):
- "ativo" se servidor esta em exercicio (folha de pagamento padrao, descontos completos)
- "aposentado" se holerite menciona "APOSENTADO", "INATIVO", "PROVENTOS DE APOSENTADORIA"
- "pensionista" se menciona "PENSIONISTA", "PENSAO", "BENEFICIO POR MORTE"
- "indefinido" se nao consegue determinar

RESPONDA APENAS COM JSON VALIDO, SEM TEXTO ADICIONAL, SEM MARKDOWN, SEM \`\`\`.

Estrutura esperada:
{
  "nome": "string|null",
  "cpf": "string|null (so digitos)",
  "matricula": "string|null",
  "orgao": "string|null",
  "convenio_sugerido": "string|null",
  "municipio": "string|null",
  "uf": "string|null (sigla 2 letras)",
  "cargo": "string|null",
  "regime_previdenciario": "RGPS|RPPS|AMBOS|INDEFINIDO",
  "tipo_vinculo": "ativo|aposentado|pensionista|indefinido",
  "data_nascimento": "YYYY-MM-DD|null",
  "idade": "number|null",
  "competencia": "YYYY-MM|null",
  "salario_bruto": "number|null",
  "salario_liquido": "number|null",
  "total_descontos": "number|null",
  "margem_consignavel_disponivel": "number|null",
  "margem_cartao_disponivel": "number|null",
  "descontos_consignados": [{"descricao": "string", "valor": "number"}],
  "observacoes": "string|null"
}`;

  const userContent = [
    {
      type: tipoMidia,
      source: { type: 'base64', media_type: mediaType, data: base64 }
    },
    {
      type: 'text',
      text: 'Extraia os dados deste holerite em JSON conforme as instrucoes do system prompt.'
    }
  ];

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_KEY(),
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }]
      })
    });
    const txt = await r.text();
    let d; try { d = JSON.parse(txt); } catch { return { ok: false, erro: `Resposta nao-JSON da API: ${txt.substring(0,300)}` }; }
    if (!r.ok) return { ok: false, erro: `Anthropic ${r.status}: ${d.error?.message || txt.substring(0,300)}` };
    const text = d.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || '';
    if (!text) return { ok: false, erro: 'Resposta vazia da IA' };
    let clean = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
    let dados;
    try { dados = JSON.parse(clean); }
    catch (e) { return { ok: false, erro: `JSON invalido da IA: ${e.message}. Resposta: ${clean.substring(0,300)}` }; }
    return { ok: true, dados };
  } catch (e) {
    return { ok: false, erro: `Falha de rede: ${e.message}` };
  }
}

async function cruzarHoleriteComBancos(convenioId, dados) {
  const { data: rels, error } = await dbQuery(
    'pref_banco_convenio',
    `convenio_id=eq.${convenioId}&select=*,pref_bancos(slug,nome)`
  );
  if (error || !rels) return { atendem: [], nao_atendem: [] };

  const idade = Number(dados.idade) || null;
  const margemDisponivel = Number(dados.margem_consignavel_disponivel) || null;

  const atendem = [];
  const naoAtendem = [];

  // Regime/vinculo extraidos pela IA
  const regimeCli = (dados.regime_previdenciario || 'INDEFINIDO').toUpperCase();
  const tipoVinc = (dados.tipo_vinculo || 'indefinido').toLowerCase();

  for (const r of rels) {
    const banco = {
      banco_id: r.banco_id,
      banco_slug: r.pref_bancos?.slug,
      banco_nome: r.pref_bancos?.nome,
      regras: {
        suspenso: r.suspenso,
        opera_novo: r.opera_novo,
        opera_refin: r.opera_refin,
        opera_port: r.opera_port,
        opera_cartao: r.opera_cartao,
        regime_atendido: r.regime_atendido || 'RPPS',
        publico_ativo: r.publico_ativo !== false,
        publico_aposentado: r.publico_aposentado !== false,
        publico_pensionista: r.publico_pensionista !== false,
        idade_min: r.idade_min,
        idade_max: r.idade_max,
        margem_utilizavel: r.margem_utilizavel,
        taxa_minima_port: r.taxa_minima_port,
        observacoes_admin: r.observacoes_admin,
        atributos: r.atributos || {},
      }
    };

    const motivos = [];
    const obs = [];

    if (r.suspenso) {
      motivos.push('Banco esta suspenso neste convenio');
    }
    // ── Filtro REGIME (RPPS/RGPS) ──
    const regBanco = r.regime_atendido || 'RPPS';
    if (regimeCli === 'RGPS' && regBanco === 'RPPS') {
      motivos.push('Cliente desconta INSS (RGPS — CLT/comissionado/temporario); banco atende so estatutarios efetivos (RPPS)');
    } else if (regimeCli === 'RPPS' && regBanco === 'RGPS') {
      motivos.push('Cliente eh estatutario (RPPS); banco atende so RGPS (CLT/comissionado)');
    }
    // ── Filtro TIPO DE VINCULO (ativo/aposentado/pensionista) ──
    if (tipoVinc === 'ativo' && !r.publico_ativo) {
      motivos.push('Cliente esta na ATIVA; banco nao opera servidores ativos');
    }
    if (tipoVinc === 'aposentado' && !r.publico_aposentado) {
      motivos.push('Cliente esta APOSENTADO; banco nao opera aposentados');
    }
    if (tipoVinc === 'pensionista' && !r.publico_pensionista) {
      motivos.push('Cliente eh PENSIONISTA; banco nao opera pensionistas');
    }
    if (idade !== null && r.idade_max && idade > r.idade_max) {
      motivos.push(`Cliente tem ${idade} anos, banco aceita ate ${r.idade_max}`);
    }
    if (idade !== null && r.idade_min && idade < r.idade_min) {
      motivos.push(`Cliente tem ${idade} anos, banco exige minimo ${r.idade_min}`);
    }
    if (!r.opera_novo && !r.opera_refin && !r.opera_port && !r.opera_cartao) {
      motivos.push('Banco nao opera nenhum produto neste convenio');
    }

    if (idade === null && (r.idade_min || r.idade_max)) {
      obs.push(`Idade do cliente nao identificada — verificar (banco aceita ${r.idade_min || '?'} a ${r.idade_max || '?'} anos)`);
    }
    if (margemDisponivel === null) {
      obs.push('Margem do holerite nao identificada — confirmar manualmente');
    }
    if (r.taxa_minima_port) {
      obs.push(`Taxa minima de port: ${(r.taxa_minima_port * 100).toFixed(2)}% a.m.`);
    }
    if (r.idade_min && r.idade_max && idade !== null) {
      obs.push(`Idade OK (${idade} anos, banco aceita ${r.idade_min}-${r.idade_max})`);
    }

    if (motivos.length === 0) {
      atendem.push({ ...banco, observacoes: obs });
    } else {
      naoAtendem.push({ ...banco, motivo: motivos.join('; ') });
    }
  }

  atendem.sort((a, b) => {
    const ta = a.regras.taxa_minima_port || 999;
    const tb = b.regras.taxa_minima_port || 999;
    return ta - tb;
  });
  naoAtendem.sort((a, b) => (a.banco_nome || '').localeCompare(b.banco_nome || ''));

  return { atendem, nao_atendem: naoAtendem };
}

// ── listAnalises / getAnalise ───────────────────────────────────
async function listAnalises(body, req, auth) {
  const limit = Math.min(Number(body.limit) || 30, 100);
  const filtros = [];
  if (auth.role !== 'admin' && auth.role !== 'gestor') {
    filtros.push(`user_id=eq.${auth.id}`);
  } else if (body.user_id) {
    filtros.push(`user_id=eq.${body.user_id}`);
  }
  filtros.push(`order=created_at.desc&limit=${limit}`);
  filtros.push('select=id,parceiro_nome,arquivo_nome,arquivo_tipo,convenio_sugerido_id,convenio_confianca,status,created_at,duracao_ms');
  const { data, error } = await dbQuery('pref_holerite_analises', filtros.join('&'));
  if (error) return jsonError(error, 500, req);
  return jsonResp({ ok: true, total: data?.length || 0, analises: data || [] }, 200, req);
}

async function getAnalise(body, req, auth) {
  if (!body.id) return jsonError('id obrigatorio', 400, req);
  const { data, error } = await dbQuery(
    'pref_holerite_analises',
    `id=eq.${encodeURIComponent(body.id)}&limit=1`,
    { single: true }
  );
  if (error || !data) return jsonError('Analise nao encontrada', 404, req);
  if (auth.role !== 'admin' && auth.role !== 'gestor' && data.user_id !== auth.id) {
    return jsonError('Sem permissao', 403, req);
  }
  return jsonResp({ ok: true, analise: data }, 200, req);
}
