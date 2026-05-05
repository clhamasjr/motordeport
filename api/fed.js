// ══════════════════════════════════════════════════════════════════
// api/fed.js — Modulo FEDERAIS (SIAPE / SERPRO / Forcas Armadas)
//
// Espelha api/gov.js e api/pref.js mas usa as tabelas fed_*. Adiciona
// suporte a filtro por categoria (civil|militar) e orgao.
//
// Actions:
//   - listConvenios       → lista convenios (filtros: categoria, orgao, busca)
//   - getConvenio         → detalhe de 1 convenio com bancos + regras
//   - listBancos          → lista todos os bancos FEDERAIS
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
      case 'listConvenios':    return await listConvenios(body, req);
      case 'getConvenio':      return await getConvenio(body, req);
      case 'listBancos':       return await listBancos(body, req);
      case 'analisarHolerite': return await analisarHolerite(body, req, auth);
      case 'listAnalises':     return await listAnalises(body, req, auth);
      case 'getAnalise':       return await getAnalise(body, req, auth);
      default: return jsonError(`Action desconhecida: ${action}`, 400, req);
    }
  } catch (e) {
    return jsonError(`Erro interno: ${e.message}`, 500, req);
  }
}

// ── listConvenios ───────────────────────────────────────────────
async function listConvenios(body, req) {
  const filtros = ['ativo=eq.true'];
  if (body.categoria) filtros.push(`categoria=eq.${encodeURIComponent(body.categoria)}`);
  if (body.orgao) filtros.push(`orgao=eq.${encodeURIComponent(body.orgao)}`);
  if (body.busca) {
    filtros.push(`or=(nome.ilike.*${encodeURIComponent(body.busca)}*,orgao.ilike.*${encodeURIComponent(body.busca)}*,sheet_origem.ilike.*${encodeURIComponent(body.busca)}*)`);
  }
  filtros.push('order=categoria.asc.nullslast,orgao.asc.nullslast,nome.asc');
  filtros.push('select=id,slug,nome,categoria,orgao,operacao_tipo,sheet_origem,atualizado_em');
  filtros.push('limit=200');

  const { data, error } = await dbQuery('fed_convenios', filtros.join('&'));
  if (error) return jsonError(`Falha ao listar convenios: ${error}`, 500, req);

  // Agrupa por categoria -> orgao
  const porCat = {};
  for (const c of data || []) {
    const k = c.categoria || 'OUTROS';
    if (!porCat[k]) porCat[k] = { categoria: k, convenios: [] };
    porCat[k].convenios.push(c);
  }
  const ordemCat = ['civil', 'militar', 'OUTROS'];
  const grupos = ordemCat
    .filter(k => porCat[k])
    .map(k => porCat[k]);

  return jsonResp({ ok: true, total: data?.length || 0, grupos, convenios: data || [] }, 200, req);
}

// ── getConvenio ────────────────────────────────────────────────
async function getConvenio(body, req) {
  if (!body.slug && !body.id) return jsonError('slug ou id obrigatorio', 400, req);
  const filter = body.slug ? `slug=eq.${encodeURIComponent(body.slug)}` : `id=eq.${body.id}`;
  const { data: conv, error: e1 } = await dbQuery(
    'fed_convenios',
    `${filter}&select=*&limit=1`,
    { single: true }
  );
  if (e1 || !conv) return jsonError('Convenio nao encontrado', 404, req);

  const { data: rels, error: e2 } = await dbQuery(
    'fed_banco_convenio',
    `convenio_id=eq.${conv.id}&select=*,fed_bancos(slug,nome,observacoes)&order=suspenso.asc.nullslast`
  );
  if (e2) return jsonError(`Falha ao buscar bancos: ${e2}`, 500, req);

  const bancos = (rels || []).map(r => ({
    id: r.id,
    banco_id: r.banco_id,
    banco_slug: r.fed_bancos?.slug,
    banco_nome: r.fed_bancos?.nome,
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

// ── listBancos ──────────────────────────────────────────────────
async function listBancos(body, req) {
  const { data, error } = await dbQuery(
    'fed_bancos',
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

  const insertResp = await dbInsert('fed_holerite_analises', {
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
      await dbUpdate('fed_holerite_analises', { id: analiseId }, {
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
      const r = await dbQuery('fed_convenios', `${filter}&limit=1`, { single: true });
      if (r.data) { convenio = r.data; confianca = 'usuario'; }
    } else {
      // Detecta categoria/orgao a partir dos dados extraidos
      const orgao = (dados.orgao_federal || '').toUpperCase();
      const categoria = (dados.categoria_servidor || '').toLowerCase();
      let q = 'select=id,slug,nome,categoria,orgao,operacao_tipo&limit=10';
      if (orgao) q = `orgao=ilike.*${encodeURIComponent(orgao)}*&` + q;
      if (categoria) q = `categoria=eq.${encodeURIComponent(categoria)}&` + q;
      let r = await dbQuery('fed_convenios', q);
      if ((!r.data || r.data.length === 0) && dados.convenio_sugerido) {
        r = await dbQuery(
          'fed_convenios',
          `nome=ilike.*${encodeURIComponent(String(dados.convenio_sugerido).toLowerCase())}*&limit=10&select=id,slug,nome,categoria,orgao,operacao_tipo`
        );
      }
      if (r.data && r.data.length > 0) {
        // Para SIAPE, prioriza o convenio "novo_refin" (mais comum) quando ha multiplos
        const sorted = r.data.slice().sort((a, b) => {
          const score = (t) => t === 'novo_refin' ? 0 : t === 'completo' ? 1 : t === 'portabilidade' ? 2 : 3;
          return score(a.operacao_tipo) - score(b.operacao_tipo);
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

    await dbUpdate('fed_holerite_analises', { id: analiseId }, {
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
    await dbUpdate('fed_holerite_analises', { id: analiseId }, {
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

  const systemPrompt = `Voce e um assistente especializado em ler holerites/contracheques de servidores publicos FEDERAIS brasileiros e MILITARES.
Os contracheques podem ser:
  - SIAPE (servidores civis do executivo federal — origens: Ministerios, Universidades Federais, IFES, Autarquias, Fundacoes, INSS, Receita Federal, etc.)
  - SERPRO (Servico Federal de Processamento de Dados)
  - MILITARES: Marinha, Exercito ou Aeronautica (Forcas Armadas — campos diferentes: posto/graduacao, situacao militar, PREC-CP)

Sua tarefa e extrair dados estruturados em JSON.

REGRAS:
- Se um campo nao estiver presente ou nao puder ser identificado com seguranca, use null.
- Valores monetarios em numero (sem R$, sem separador de milhar). Use ponto como decimal.
- Datas no formato YYYY-MM-DD.
- Idade em anos completos (calcule a partir da data de nascimento se houver, ou retorne null).
- Margem consignavel: extraia o VALOR DISPONIVEL.
- "categoria_servidor": "civil" se SIAPE/SERPRO, "militar" se Marinha/Exercito/Aeronautica.
- "orgao_federal": sigla do orgao (ex: "SIAPE", "SERPRO", "MARINHA", "EXERCITO", "AERONAUTICA"). Se for SIAPE-vinculado, use "SIAPE".
- "convenio_sugerido": nome amigavel do convenio (ex: "SIAPE Novo/Refin", "Forcas Armadas - Marinha").
- "patente" e "situacao_militar": para militares, capture posto/graduacao (Cap, Sgt, Sd) e situacao (Carreira, Tempo, Reforma, Reserva).
- "prec_cp": para militares, capture o codigo PREC-CP (numero) se aparecer no contracheque.

RESPONDA APENAS COM JSON VALIDO, SEM TEXTO ADICIONAL, SEM MARKDOWN, SEM \`\`\`.

Estrutura esperada:
{
  "nome": "string|null",
  "cpf": "string|null (so digitos)",
  "matricula": "string|null",
  "orgao": "string|null (texto completo do orgao no holerite)",
  "orgao_federal": "string|null (sigla padronizada: SIAPE, SERPRO, MARINHA, EXERCITO, AERONAUTICA)",
  "categoria_servidor": "civil|militar|null",
  "convenio_sugerido": "string|null",
  "cargo": "string|null",
  "patente": "string|null (so para militares)",
  "situacao_militar": "string|null (so para militares: Carreira, Tempo, Reserva, Reformado)",
  "prec_cp": "string|null (so para militares)",
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
      text: 'Extraia os dados deste contracheque/holerite federal ou militar em JSON conforme as instrucoes do system prompt.'
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
    'fed_banco_convenio',
    `convenio_id=eq.${convenioId}&select=*,fed_bancos(slug,nome)`
  );
  if (error || !rels) return { atendem: [], nao_atendem: [] };

  const idade = Number(dados.idade) || null;
  const margemDisponivel = Number(dados.margem_consignavel_disponivel) || null;

  const atendem = [];
  const naoAtendem = [];

  for (const r of rels) {
    const banco = {
      banco_id: r.banco_id,
      banco_slug: r.fed_bancos?.slug,
      banco_nome: r.fed_bancos?.nome,
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

    if (idade === null && (r.idade_min || r.idade_max)) {
      obs.push(`Idade do cliente nao identificada — verificar (banco aceita ${r.idade_min || '?'} a ${r.idade_max || '?'} anos)`);
    }
    if (margemDisponivel === null) {
      obs.push('Margem do contracheque nao identificada — confirmar manualmente');
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
  const { data, error } = await dbQuery('fed_holerite_analises', filtros.join('&'));
  if (error) return jsonError(error, 500, req);
  return jsonResp({ ok: true, total: data?.length || 0, analises: data || [] }, 200, req);
}

async function getAnalise(body, req, auth) {
  if (!body.id) return jsonError('id obrigatorio', 400, req);
  const { data, error } = await dbQuery(
    'fed_holerite_analises',
    `id=eq.${encodeURIComponent(body.id)}&limit=1`,
    { single: true }
  );
  if (error || !data) return jsonError('Analise nao encontrada', 404, req);
  if (auth.role !== 'admin' && auth.role !== 'gestor' && data.user_id !== auth.id) {
    return jsonError('Sem permissao', 403, req);
  }
  return jsonResp({ ok: true, analise: data }, 200, req);
}
