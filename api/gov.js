// ══════════════════════════════════════════════════════════════════
// api/gov.js — Modulo GOVERNOS
//
// Actions:
//   - listConvenios       → lista convenios (filtro opcional: uf, busca)
//   - getConvenio         → detalhe de 1 convenio com bancos + regras
//   - listBancos          → lista todos os bancos GOV
//   - analisarHolerite    → recebe arquivo (base64), extrai dados via Claude e cruza com base
//   - listAnalises        → historico de holerites do usuario logado
//   - getAnalise          → detalhe de 1 analise
//
// Open: todos os roles (admin, gestor, parceiro) podem usar.
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';
import { dbSelect, dbInsert, dbUpdate, dbQuery, dbDelete } from './_lib/supabase.js';

const CLAUDE_KEY = () => process.env.CLAUDE_API_KEY;
const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB

// ══════════════════════════════════════════════════════════════
// HANDLER
// ══════════════════════════════════════════════════════════════
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
      case 'listConvenios':    return await listConvenios(body, req);
      case 'getConvenio':      return await getConvenio(body, req);
      case 'listBancos':       return await listBancos(body, req);
      case 'analisarHolerite': return await analisarHolerite(body, req, auth);
      case 'listAnalises':     return await listAnalises(body, req, auth);
      case 'getAnalise':       return await getAnalise(body, req, auth);
      // ── ADMIN actions (so admin/gestor) ──
      case 'upsertBanco':         return await guardAdmin(auth, req, () => upsertBanco(body, req));
      case 'upsertConvenio':      return await guardAdmin(auth, req, () => upsertConvenio(body, req));
      case 'upsertBancoConvenio': return await guardAdmin(auth, req, () => upsertBancoConvenio(body, req));
      case 'deleteBancoConvenio': return await guardAdmin(auth, req, () => deleteBancoConvenio(body, req));
      case 'deleteBanco':         return await guardAdmin(auth, req, () => deleteBanco(body, req));
      case 'deleteConvenio':      return await guardAdmin(auth, req, () => deleteConvenio(body, req));
      default: return jsonError(`Action desconhecida: ${action}`, 400, req);
    }
  } catch (e) {
    return jsonError(`Erro interno: ${e.message}`, 500, req);
  }
}

function guardAdmin(auth, req, fn) {
  if (auth.role !== 'admin' && auth.role !== 'gestor' && !auth._internal) {
    return jsonError('Apenas admin/gestor', 403, req);
  }
  return fn();
}

function slugify(s) {
  return String(s||'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}

// ══════════════════════════════════════════════════════════════
// listConvenios — lista paginada de convenios
// body: { uf?, busca?, ativo? }
// ══════════════════════════════════════════════════════════════
async function listConvenios(body, req) {
  const filtros = ['ativo=eq.true'];
  if (body.uf) filtros.push(`uf=eq.${encodeURIComponent(body.uf)}`);
  if (body.busca) {
    // busca por nome ou sheet_origem (case-insensitive)
    filtros.push(`or=(nome.ilike.*${encodeURIComponent(body.busca)}*,sheet_origem.ilike.*${encodeURIComponent(body.busca)}*)`);
  }
  filtros.push('order=uf.asc.nullslast,nome.asc');
  filtros.push('select=id,slug,nome,uf,estado_nome,sheet_origem,atualizado_em');

  const { data, error } = await dbQuery('gov_convenios', filtros.join('&'));
  if (error) return jsonError(`Falha ao listar convenios: ${error}`, 500, req);

  // Agrupa por UF pra facilitar UI
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

// ══════════════════════════════════════════════════════════════
// getConvenio — detalhe de 1 convenio com todos os bancos
// body: { slug } ou { id }
// ══════════════════════════════════════════════════════════════
async function getConvenio(body, req) {
  if (!body.slug && !body.id) return jsonError('slug ou id obrigatorio', 400, req);
  const filter = body.slug ? `slug=eq.${encodeURIComponent(body.slug)}` : `id=eq.${body.id}`;
  const { data: conv, error: e1 } = await dbQuery(
    'gov_convenios',
    `${filter}&select=*&limit=1`,
    { single: true }
  );
  if (e1 || !conv) return jsonError('Convenio nao encontrado', 404, req);

  // Busca bancos via join (gov_banco_convenio + gov_bancos)
  const { data: rels, error: e2 } = await dbQuery(
    'gov_banco_convenio',
    `convenio_id=eq.${conv.id}&select=*,gov_bancos(slug,nome,observacoes)&order=suspenso.asc.nullslast`
  );
  if (e2) return jsonError(`Falha ao buscar bancos: ${e2}`, 500, req);

  const bancos = (rels || []).map(r => ({
    id: r.id,
    banco_id: r.banco_id,
    banco_slug: r.gov_bancos?.slug,
    banco_nome: r.gov_bancos?.nome,
    suspenso: r.suspenso,
    operacoes: {
      novo: r.opera_novo,
      refin: r.opera_refin,
      port: r.opera_port,
      cartao: r.opera_cartao,
    },
    margem_utilizavel: r.margem_utilizavel,
    idade_min: r.idade_min,
    idade_max: r.idade_max,
    taxa_minima_port: r.taxa_minima_port,
    data_corte: r.data_corte,
    valor_minimo: r.valor_minimo,
    qtd_contratos: r.qtd_contratos,
    atributos: r.atributos || {},
    atributos_brutos: r.atributos_brutos || [],
  }));

  return jsonResp({ ok: true, convenio: conv, bancos }, 200, req);
}

// ══════════════════════════════════════════════════════════════
// listBancos — lista todos os bancos GOV (pra dropdown/admin)
// ══════════════════════════════════════════════════════════════
async function listBancos(body, req) {
  const { data, error } = await dbQuery(
    'gov_bancos',
    'ativo=eq.true&order=nome.asc&select=id,slug,nome,observacoes'
  );
  if (error) return jsonError(`Falha ao listar bancos: ${error}`, 500, req);
  return jsonResp({ ok: true, total: data?.length || 0, bancos: data || [] }, 200, req);
}

// ══════════════════════════════════════════════════════════════
// analisarHolerite — recebe arquivo, extrai via Claude, cruza
// body: {
//   arquivo_base64,   // somente o conteudo base64 (sem prefixo data:)
//   arquivo_nome,
//   arquivo_tipo,     // 'application/pdf' | 'image/jpeg' | 'image/png'
//   convenio_id?,     // opcional: forca um convenio
//   convenio_slug?,
// }
// ══════════════════════════════════════════════════════════════
async function analisarHolerite(body, req, auth) {
  const t0 = Date.now();
  const { arquivo_base64, arquivo_nome, arquivo_tipo } = body;
  if (!arquivo_base64) return jsonError('arquivo_base64 obrigatorio', 400, req);
  if (!arquivo_tipo) return jsonError('arquivo_tipo obrigatorio', 400, req);

  // Valida tipo e tamanho
  const tipo = String(arquivo_tipo).toLowerCase();
  const ehPdf = tipo === 'application/pdf';
  const ehImagem = ['image/jpeg','image/jpg','image/png','image/webp','image/gif'].includes(tipo);
  if (!ehPdf && !ehImagem) {
    return jsonError(`Tipo nao suportado: ${arquivo_tipo}. Use PDF, JPG, PNG ou WEBP.`, 400, req);
  }
  // base64: cada 4 chars = 3 bytes
  const tamanhoBytes = Math.floor((arquivo_base64.length * 3) / 4);
  if (tamanhoBytes > MAX_FILE_BYTES) {
    return jsonError(`Arquivo muito grande: ${(tamanhoBytes/1024/1024).toFixed(1)}MB. Maximo: 10MB.`, 400, req);
  }

  // ── 1) Cria registro em status 'processando' ──
  const insertResp = await dbInsert('gov_holerite_analises', {
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
    // ── 2) Chama Claude pra extrair dados estruturados do holerite ──
    const dadosExtraidos = await extrairDadosHolerite(arquivo_base64, tipo);
    if (!dadosExtraidos.ok) {
      await dbUpdate('gov_holerite_analises', { id: analiseId }, {
        status: 'erro',
        erro_mensagem: dadosExtraidos.erro,
        duracao_ms: Date.now() - t0,
      });
      return jsonError(`Falha na extracao: ${dadosExtraidos.erro}`, 500, req);
    }
    const dados = dadosExtraidos.dados;

    // ── 3) Determina convenio (forcado pelo usuario OU sugerido pela IA) ──
    let convenio = null, confianca = 'baixa';
    if (body.convenio_id || body.convenio_slug) {
      const filter = body.convenio_id
        ? `id=eq.${body.convenio_id}`
        : `slug=eq.${encodeURIComponent(body.convenio_slug)}`;
      const r = await dbQuery('gov_convenios', `${filter}&limit=1`, { single: true });
      if (r.data) { convenio = r.data; confianca = 'usuario'; }
    } else if (dados.convenio_sugerido) {
      // tenta achar pelo nome/uf que a IA detectou
      const sugestao = dados.convenio_sugerido.toLowerCase();
      const r = await dbQuery(
        'gov_convenios',
        `nome=ilike.*${encodeURIComponent(sugestao)}*&limit=5&select=id,slug,nome,uf`
      );
      if (r.data && r.data.length > 0) {
        convenio = r.data[0];
        confianca = r.data.length === 1 ? 'alta' : 'media';
      }
    }

    // ── 4) Se tem convenio, cruza com bancos ──
    let bancosAtendem = [], bancosNaoAtendem = [];
    if (convenio) {
      const cruzamento = await cruzarHoleriteComBancos(convenio.id, dados);
      bancosAtendem = cruzamento.atendem;
      bancosNaoAtendem = cruzamento.nao_atendem;
    }

    // ── 5) Salva resultado ──
    await dbUpdate('gov_holerite_analises', { id: analiseId }, {
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
    await dbUpdate('gov_holerite_analises', { id: analiseId }, {
      status: 'erro',
      erro_mensagem: e.message,
      duracao_ms: Date.now() - t0,
    });
    return jsonError(`Erro processando: ${e.message}`, 500, req);
  }
}

// ── Extrai dados estruturados do holerite usando Claude vision/PDF ──
async function extrairDadosHolerite(base64, tipo) {
  const ehPdf = tipo === 'application/pdf';
  const tipoMidia = ehPdf ? 'document' : 'image';
  // mime do bloco de imagem precisa ser image/* exato
  const mediaType = ehPdf ? 'application/pdf'
    : (tipo === 'image/jpg' ? 'image/jpeg' : tipo);

  const systemPrompt = `Voce e um assistente especializado em ler holerites/contracheques de servidores publicos brasileiros.
Sua tarefa e extrair dados estruturados em JSON.

REGRAS:
- Se um campo nao estiver presente ou nao puder ser identificado com seguranca, use null.
- Valores monetarios em numero (sem R$, sem separador de milhar). Use ponto como decimal.
- Datas no formato YYYY-MM-DD.
- Idade em anos completos (calcule a partir da data de nascimento se houver, ou retorne null).
- Margem consignavel: muitos holerites mostram "MARGEM CONSIGNAVEL" ou "MARGEM DISPONIVEL" — extraia o VALOR DISPONIVEL.
- "convenio_sugerido": tente identificar o orgao/estado (ex: "GOVERNO DO ESTADO DA BAHIA", "TJMG", "PREFEITURA DE SOROCABA").

RESPONDA APENAS COM JSON VALIDO, SEM TEXTO ADICIONAL, SEM MARKDOWN, SEM \`\`\`.

Estrutura esperada:
{
  "nome": "string|null",
  "cpf": "string|null (so digitos)",
  "matricula": "string|null",
  "orgao": "string|null",
  "convenio_sugerido": "string|null",
  "uf": "string|null (sigla 2 letras)",
  "cargo": "string|null",
  "data_nascimento": "YYYY-MM-DD|null",
  "idade": "number|null",
  "competencia": "YYYY-MM|null (mes/ano de referencia do holerite)",
  "salario_bruto": "number|null",
  "salario_liquido": "number|null",
  "total_descontos": "number|null",
  "margem_consignavel_disponivel": "number|null",
  "margem_cartao_disponivel": "number|null",
  "descontos_consignados": [{"descricao": "string", "valor": "number"}],
  "observacoes": "string|null (qualquer info relevante: tipo de vinculo, situacao funcional, etc)"
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
    // Remove markdown se vier (fallback)
    let clean = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
    let dados;
    try { dados = JSON.parse(clean); }
    catch (e) { return { ok: false, erro: `JSON invalido da IA: ${e.message}. Resposta: ${clean.substring(0,300)}` }; }
    return { ok: true, dados };
  } catch (e) {
    return { ok: false, erro: `Falha de rede: ${e.message}` };
  }
}

// ── Cruza dados do holerite com regras dos bancos do convenio ──
async function cruzarHoleriteComBancos(convenioId, dados) {
  const { data: rels, error } = await dbQuery(
    'gov_banco_convenio',
    `convenio_id=eq.${convenioId}&select=*,gov_bancos(slug,nome)`
  );
  if (error || !rels) return { atendem: [], nao_atendem: [] };

  const idade = Number(dados.idade) || null;
  const margemDisponivel = Number(dados.margem_consignavel_disponivel) || null;

  const atendem = [];
  const naoAtendem = [];

  for (const r of rels) {
    const banco = {
      banco_id: r.banco_id,
      banco_slug: r.gov_bancos?.slug,
      banco_nome: r.gov_bancos?.nome,
      regras: {
        suspenso: r.suspenso,
        opera_novo: r.opera_novo,
        opera_refin: r.opera_refin,
        opera_port: r.opera_port,
        opera_cartao: r.opera_cartao,
        idade_min: r.idade_min,
        idade_max: r.idade_max,
        margem_utilizavel: r.margem_utilizavel,
        taxa_minima_port: r.taxa_minima_port,
        atributos: r.atributos || {},
      }
    };

    const motivos = [];
    const obs = [];

    // ── Filtros que descartam o banco ──
    if (r.suspenso) {
      motivos.push('Banco esta suspenso neste convenio');
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

    // ── Observacoes (informativas) ──
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

  // Ordena: bancos que atendem ficam por taxa (menor primeiro), nao-atendem por nome
  atendem.sort((a, b) => {
    const ta = a.regras.taxa_minima_port || 999;
    const tb = b.regras.taxa_minima_port || 999;
    return ta - tb;
  });
  naoAtendem.sort((a, b) => (a.banco_nome || '').localeCompare(b.banco_nome || ''));

  return { atendem, nao_atendem: naoAtendem };
}

// ══════════════════════════════════════════════════════════════
// listAnalises / getAnalise
// ══════════════════════════════════════════════════════════════
async function listAnalises(body, req, auth) {
  const limit = Math.min(Number(body.limit) || 30, 100);
  const filtros = [];
  if (auth.role !== 'admin' && auth.role !== 'gestor') {
    // parceiro so ve as proprias analises
    filtros.push(`user_id=eq.${auth.id}`);
  } else if (body.user_id) {
    filtros.push(`user_id=eq.${body.user_id}`);
  }
  filtros.push(`order=created_at.desc&limit=${limit}`);
  filtros.push('select=id,parceiro_nome,arquivo_nome,arquivo_tipo,convenio_sugerido_id,convenio_confianca,status,created_at,duracao_ms');
  const { data, error } = await dbQuery('gov_holerite_analises', filtros.join('&'));
  if (error) return jsonError(error, 500, req);
  return jsonResp({ ok: true, total: data?.length || 0, analises: data || [] }, 200, req);
}

async function getAnalise(body, req, auth) {
  if (!body.id) return jsonError('id obrigatorio', 400, req);
  const { data, error } = await dbQuery(
    'gov_holerite_analises',
    `id=eq.${encodeURIComponent(body.id)}&limit=1`,
    { single: true }
  );
  if (error || !data) return jsonError('Analise nao encontrada', 404, req);
  // parceiro so ve as proprias
  if (auth.role !== 'admin' && auth.role !== 'gestor' && data.user_id !== auth.id) {
    return jsonError('Sem permissao', 403, req);
  }
  return jsonResp({ ok: true, analise: data }, 200, req);
}

// ══════════════════════════════════════════════════════════════
// ADMIN ACTIONS
// ══════════════════════════════════════════════════════════════

// upsertBanco — body: { id?, slug?, nome, ativo?, observacoes? }
async function upsertBanco(body, req) {
  if (!body.nome) return jsonError('nome obrigatorio', 400, req);
  const slug = body.slug || slugify(body.nome);
  if (!slug) return jsonError('slug invalido', 400, req);
  const data = { slug, nome: body.nome.trim() };
  if (body.observacoes !== undefined) data.observacoes = body.observacoes;
  if (body.ativo !== undefined) data.ativo = !!body.ativo;
  if (body.id) {
    const r = await dbUpdate('gov_bancos', { id: body.id }, data);
    if (r.error) return jsonError(`Falha update banco: ${r.error}`, 500, req);
    return jsonResp({ ok: true, banco: Array.isArray(r.data)?r.data[0]:r.data }, 200, req);
  }
  const r = await dbInsert('gov_bancos', data);
  if (r.error) return jsonError(`Falha insert banco: ${r.error}`, 500, req);
  return jsonResp({ ok: true, banco: r.data }, 200, req);
}

// upsertConvenio — body: { id?, slug?, nome, uf?, estado_nome?, ativo?, observacoes? }
async function upsertConvenio(body, req) {
  if (!body.nome) return jsonError('nome obrigatorio', 400, req);
  const slug = body.slug || slugify(body.nome);
  const data = { slug, nome: body.nome.trim() };
  if (body.uf !== undefined) data.uf = body.uf || null;
  if (body.estado_nome !== undefined) data.estado_nome = body.estado_nome || null;
  if (body.observacoes !== undefined) data.observacoes = body.observacoes;
  if (body.ativo !== undefined) data.ativo = !!body.ativo;
  if (body.id) {
    const r = await dbUpdate('gov_convenios', { id: body.id }, data);
    if (r.error) return jsonError(`Falha update convenio: ${r.error}`, 500, req);
    return jsonResp({ ok: true, convenio: Array.isArray(r.data)?r.data[0]:r.data }, 200, req);
  }
  const r = await dbInsert('gov_convenios', data);
  if (r.error) return jsonError(`Falha insert convenio: ${r.error}`, 500, req);
  return jsonResp({ ok: true, convenio: r.data }, 200, req);
}

// upsertBancoConvenio — body: { id?, banco_id, convenio_id, opera_*, suspenso, margem, idade_min/max, taxa, ... }
async function upsertBancoConvenio(body, req) {
  if (!body.banco_id || !body.convenio_id) return jsonError('banco_id e convenio_id obrigatorios', 400, req);
  const data = {
    banco_id: Number(body.banco_id),
    convenio_id: Number(body.convenio_id),
    opera_novo: !!body.opera_novo,
    opera_refin: !!body.opera_refin,
    opera_port: !!body.opera_port,
    opera_cartao: !!body.opera_cartao,
    suspenso: !!body.suspenso,
    margem_utilizavel: body.margem_utilizavel === '' || body.margem_utilizavel === null ? null : Number(body.margem_utilizavel),
    idade_min: body.idade_min === '' || body.idade_min === null ? null : Number(body.idade_min),
    idade_max: body.idade_max === '' || body.idade_max === null ? null : Number(body.idade_max),
    taxa_minima_port: body.taxa_minima_port === '' || body.taxa_minima_port === null ? null : Number(body.taxa_minima_port),
    data_corte: body.data_corte || null,
    valor_minimo: body.valor_minimo || null,
    qtd_contratos: body.qtd_contratos || null,
  };
  if (body.atributos && typeof body.atributos === 'object') data.atributos = body.atributos;
  if (Array.isArray(body.atributos_brutos)) data.atributos_brutos = body.atributos_brutos;
  if (body.id) {
    const r = await dbUpdate('gov_banco_convenio', { id: body.id }, data);
    if (r.error) return jsonError(`Falha update: ${r.error}`, 500, req);
    return jsonResp({ ok: true, registro: Array.isArray(r.data)?r.data[0]:r.data }, 200, req);
  }
  const r = await dbInsert('gov_banco_convenio', data);
  if (r.error) return jsonError(`Falha insert: ${r.error}`, 500, req);
  return jsonResp({ ok: true, registro: r.data }, 200, req);
}

async function deleteBancoConvenio(body, req) {
  if (!body.id) return jsonError('id obrigatorio', 400, req);
  const r = await dbDelete('gov_banco_convenio', { id: body.id });
  if (r.error) return jsonError(`Falha delete: ${r.error}`, 500, req);
  return jsonResp({ ok: true }, 200, req);
}

async function deleteBanco(body, req) {
  if (!body.id) return jsonError('id obrigatorio', 400, req);
  const r = await dbDelete('gov_bancos', { id: body.id });
  if (r.error) return jsonError(`Falha delete: ${r.error}`, 500, req);
  return jsonResp({ ok: true }, 200, req);
}

async function deleteConvenio(body, req) {
  if (!body.id) return jsonError('id obrigatorio', 400, req);
  const r = await dbDelete('gov_convenios', { id: body.id });
  if (r.error) return jsonError(`Falha delete: ${r.error}`, 500, req);
  return jsonResp({ ok: true }, 200, req);
}
