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
  const { arquivo_base64, arquivo_nome, arquivo_tipo,
          extrato_base64, extrato_nome, extrato_tipo } = body;
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

  // Validacao do extrato (se fornecido)
  let extratoTipo = null;
  if (extrato_base64) {
    extratoTipo = String(extrato_tipo || 'application/pdf').toLowerCase();
    const eExtPdf = extratoTipo === 'application/pdf';
    const eExtImg = ['image/jpeg','image/jpg','image/png','image/webp','image/gif'].includes(extratoTipo);
    if (!eExtPdf && !eExtImg) {
      return jsonError(`Tipo do extrato nao suportado: ${extrato_tipo}. Use PDF ou imagem.`, 400, req);
    }
    const tExt = Math.floor((extrato_base64.length * 3) / 4);
    if (tExt > MAX_FILE_BYTES) {
      return jsonError(`Extrato muito grande: ${(tExt/1024/1024).toFixed(1)}MB. Maximo: 10MB.`, 400, req);
    }
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
    // Extracao do contracheque + (em paralelo) extracao dos contratos do extrato
    const [dadosExtraidos, contratosExtraidos] = await Promise.all([
      extrairDadosHolerite(arquivo_base64, tipo),
      extrato_base64 ? extrairContratosExtrato(extrato_base64, extratoTipo) : Promise.resolve({ ok: true, contratos: [], info: null }),
    ]);

    if (!dadosExtraidos.ok) {
      await dbUpdate('fed_holerite_analises', { id: analiseId }, {
        status: 'erro',
        erro_mensagem: dadosExtraidos.erro,
        duracao_ms: Date.now() - t0,
      });
      return jsonError(`Falha na extracao: ${dadosExtraidos.erro}`, 500, req);
    }
    const dados = dadosExtraidos.dados;

    // Anexa extrato no JSON dos dados extraidos
    if (extrato_base64) {
      dados.extrato_arquivo_nome = extrato_nome || null;
      dados.extrato_info = contratosExtraidos.ok ? (contratosExtraidos.info || {}) : null;
      dados.contratos_ativos = contratosExtraidos.ok ? (contratosExtraidos.contratos || []) : [];
      dados.extrato_erro = contratosExtraidos.ok ? null : contratosExtraidos.erro;
      // Dados pessoais do extrato podem complementar quando o contracheque nao traz
      const inf = dados.extrato_info || {};
      if (!dados.cpf && inf.cpf) dados.cpf = inf.cpf;
      if (!dados.matricula && inf.matricula) dados.matricula = inf.matricula;
      if (!dados.nome && inf.nome) dados.nome = inf.nome;
      if (!dados.orgao && inf.orgao) dados.orgao = inf.orgao;
    }

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
        // Quando ha extrato com contratos, prioriza convenio que opera PORTABILIDADE
        const temContratos = (dados.contratos_ativos || []).filter(c => c.tipo === 'emprestimo').length > 0;
        const sorted = r.data.slice().sort((a, b) => {
          const score = (t) => {
            if (temContratos) {
              return t === 'portabilidade' ? 0 : t === 'completo' ? 1 : t === 'novo_refin' ? 2 : 3;
            }
            return t === 'novo_refin' ? 0 : t === 'completo' ? 1 : t === 'portabilidade' ? 2 : 3;
          };
          return score(a.operacao_tipo) - score(b.operacao_tipo);
        });
        convenio = sorted[0];
        confianca = r.data.length === 1 ? 'alta' : 'media';
      }
    }

    let bancosAtendem = [], bancosNaoAtendem = [], simulacaoPort = [];
    if (convenio) {
      const cruzamento = await cruzarHoleriteComBancos(convenio.id, dados);
      bancosAtendem = cruzamento.atendem;
      bancosNaoAtendem = cruzamento.nao_atendem;

      // Se tem contratos do extrato, simula portabilidade contrato-a-contrato
      const contratosEmprestimo = (dados.contratos_ativos || []).filter(c => c.tipo === 'emprestimo');
      if (contratosEmprestimo.length > 0) {
        // Usa convenios SIAPE-Portabilidade especificamente quando o convenio escolhido for SIAPE
        let convenioPortId = convenio.id;
        if (convenio.orgao === 'SIAPE' && convenio.operacao_tipo !== 'portabilidade') {
          const r = await dbQuery('fed_convenios',
            `orgao=eq.SIAPE&operacao_tipo=eq.portabilidade&limit=1`, { single: true });
          if (r.data) convenioPortId = r.data.id;
        }
        simulacaoPort = await simularPortabilidade(convenioPortId, contratosEmprestimo);
      }
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
      simulacao_port: simulacaoPort,
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

// ── Extracao do EXTRATO DE CONSIGNACOES VIGENTES ────────────────
// Extrato federal/militar lista contratos ativos: empréstimo, RMC (cartão crédito) e RCC (cartão benefício).
// Cada contrato tem: numero, rubrica (codigo+banco), parcela X/Y, valor parcela, inicio, fim.
async function extrairContratosExtrato(base64, tipo) {
  const ehPdf = tipo === 'application/pdf';
  const tipoMidia = ehPdf ? 'document' : 'image';
  const mediaType = ehPdf ? 'application/pdf'
    : (tipo === 'image/jpg' ? 'image/jpeg' : tipo);

  const systemPrompt = `Voce e especialista em ler EXTRATO DE CONSIGNACOES VIGENTES de servidores publicos federais e militares brasileiros (SIGEPE, SIAPE, Forcas Armadas, Polícias Militares, etc.).

O extrato lista os contratos consignados ativos do servidor, geralmente em ate 3 secoes:
1. "Demonstrativo de uso da margem / Novo Contrato e Renovacao" → EMPRESTIMOS consignados
2. "Demonstrativo de uso da margem - Amortizacao de Despesas / Saques com Cartao de Credito" → RMC (cartao consignado)
3. "Demonstrativo de uso da margem - Cartao Consignado de Beneficio" → RCC (cartao beneficio)

CADA LINHA DE CONTRATO TEM:
- Numero do Contrato (ex: 15706907, 1500825738, 25019966188241)
- Rubrica (formato: "<codigo> - <DESCRICAO> - <BANCO>", ex: "34114 - EMPREST BCO OFICIAL - BRB CFI" ou "34193 - EMPREST BCO PRIVADOS - DAYBCO")
- Sequencia, Prioridade Transacao, Data/Hora
- Parcela no formato "X/Y" (X = parcelas pagas, Y = total) ex: 22/96, 05/96
- Valor da Parcela (R$)
- Inicio (MM/AAAA) e Fim (MM/AAAA)

REGRAS:
- Extraia o nome do BANCO da rubrica (sigla legivel: DAYBCO=Daycoval, BRB CFI=BRB, BANRISUL=Banrisul, INTERME=Intermedium/Inter, CLICKBANK=ClickBank, BMG, ITAU, PAN, FACTA, SAFRA, etc.)
- "tipo" do contrato: "emprestimo" (rubricas com "EMPREST"), "rmc" (rubricas "AMORT CARTAO CREDITO"), "rcc" (rubricas "AMORT CARTAO BENEFICIO" ou "CARTAO BENEFICIO")
- Calcule "parcelas_pagas" e "parcelas_totais" a partir do "X/Y" (numeros)
- "parcelas_restantes" = parcelas_totais - parcelas_pagas
- "saldo_estimado" = parcela * parcelas_restantes (estimativa simples sem juros, util pra simular port)
- Datas: formato YYYY-MM-DD (use dia 01 para inicio/fim no formato MM/AAAA)
- Se nao conseguir extrair um campo, use null

INFO_GERAL: tente extrair tambem (no topo do extrato): cpf (so digitos), matricula, nome (do servidor), orgao (texto completo).

RESPONDA APENAS COM JSON VALIDO, SEM TEXTO ADICIONAL, SEM MARKDOWN, SEM \`\`\`.

Estrutura esperada:
{
  "info": {
    "cpf": "string|null",
    "matricula": "string|null",
    "nome": "string|null",
    "orgao": "string|null",
    "data_emissao": "YYYY-MM-DD|null",
    "margem_total_facultativa_disponivel": "number|null",
    "margem_total_cartao_disponivel": "number|null",
    "margem_total_cb_disponivel": "number|null"
  },
  "contratos": [
    {
      "numero": "string",
      "rubrica_codigo": "string",
      "rubrica_descricao": "string",
      "banco_extrato": "string (sigla legivel: ex: 'Daycoval', 'BRB', 'Intermedium')",
      "tipo": "emprestimo|rmc|rcc",
      "parcela_valor": "number",
      "parcelas_pagas": "number",
      "parcelas_totais": "number",
      "parcelas_restantes": "number",
      "saldo_estimado": "number",
      "inicio": "YYYY-MM-DD|null",
      "fim": "YYYY-MM-DD|null"
    }
  ]
}`;

  const userContent = [
    {
      type: tipoMidia,
      source: { type: 'base64', media_type: mediaType, data: base64 }
    },
    {
      type: 'text',
      text: 'Extraia os contratos consignados ativos deste extrato em JSON conforme as instrucoes do system prompt.'
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
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }]
      })
    });
    const txt = await r.text();
    let d; try { d = JSON.parse(txt); } catch { return { ok: false, erro: `Resposta nao-JSON da API: ${txt.substring(0,300)}` }; }
    if (!r.ok) return { ok: false, erro: `Anthropic ${r.status}: ${d.error?.message || txt.substring(0,300)}` };
    const text = d.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || '';
    if (!text) return { ok: false, erro: 'Resposta vazia da IA (extrato)' };
    let clean = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
    let dados;
    try { dados = JSON.parse(clean); }
    catch (e) { return { ok: false, erro: `JSON invalido da IA (extrato): ${e.message}. Resposta: ${clean.substring(0,300)}` }; }
    return {
      ok: true,
      info: dados.info || null,
      contratos: Array.isArray(dados.contratos) ? dados.contratos : []
    };
  } catch (e) {
    return { ok: false, erro: `Falha de rede (extrato): ${e.message}` };
  }
}

// ── Simulacao de PORTABILIDADE com TROCO ───────────────────────
// Modelo:
//  1) Assume taxa de mercado vigente do contrato origem = 1,80% a.m. (TAXA_ORIGEM_PADRAO)
//  2) Calcula SALDO DEVEDOR REAL = PMT * (1-(1+i_origem)^-n_restantes) / i_origem
//  3) Para cada banco destino: REFIN DE PORT mantendo a mesma parcela atual
//     no PRAZO ORIGINAL (parcelas_totais), com a TAXA do banco destino.
//     - Novo PV (capital financiado) = PMT_atual * (1-(1+i_dest)^-n_total) / i_dest
//     - TROCO = Novo PV - Saldo devedor atual
//     - Quando troco > 0 → cliente recebe na conta apos quitacao
//     - Quando troco <= 0 → port nao gera troco (so reduzir parcela ou prazo)
//  4) Tambem calcula PORT PURA (mantem prazo restante, taxa nova) → reducao
//     mensal de parcela e economia total.
const TAXA_ORIGEM_PADRAO = 0.018; // 1,80% a.m. (assumida pra calcular saldo devedor)

// Saldo devedor: PV de uma anuidade postecipada. PMT * (1 - (1+i)^-n) / i
function calcularSaldoDevedor(pmt, n, i) {
  if (!pmt || !n || !i) return null;
  if (i <= 0) return pmt * n;
  return pmt * (1 - Math.pow(1 + i, -n)) / i;
}

async function simularPortabilidade(convenioId, contratos) {
  if (!Array.isArray(contratos) || contratos.length === 0) return [];
  const { data: rels, error } = await dbQuery(
    'fed_banco_convenio',
    `convenio_id=eq.${convenioId}&suspenso=eq.false&opera_port=eq.true&select=*,fed_bancos(slug,nome)`
  );
  if (error || !rels || rels.length === 0) return [];

  const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu, '').trim();

  const result = [];
  for (const c of contratos) {
    const contratoBancoNorm = norm(c.banco_extrato);
    const parcela = Number(c.parcela_valor) || 0;
    const restantes = Number(c.parcelas_restantes) || 0;
    const totais = Number(c.parcelas_totais) || 0;
    const pagas = Number(c.parcelas_pagas) || 0;

    // SALDO DEVEDOR REAL com taxa origem 1,80% a.m.
    const saldoDevedor = calcularSaldoDevedor(parcela, restantes, TAXA_ORIGEM_PADRAO);

    const sugestoes = [];
    for (const r of rels) {
      const bancoNome = r.fed_bancos?.nome || '';
      const bancoNomeNorm = norm(bancoNome);
      const ehMesmoBanco = contratoBancoNorm && bancoNomeNorm.includes(contratoBancoNorm.split(/\s+/)[0]);
      if (ehMesmoBanco) continue;

      const motivos = [];
      const minParcelasTxt = (r.atributos?.port_min_parcelas_pagas || '');
      const matchParcelas = String(minParcelasTxt).match(/(\d{1,3})\s*pa(g|rcelas)/i);
      const minParcelas = matchParcelas ? parseInt(matchParcelas[1], 10) : null;
      if (minParcelas !== null && pagas < minParcelas) {
        motivos.push(`Banco exige ${minParcelas} parcelas pagas, contrato tem so ${pagas}`);
      }

      const taxa = Number(r.taxa_minima_port) || null;

      // Cenario A — PORT PURA: mesma parcela escolhida pelo cliente, prazo restante, taxa nova
      // Reduz a parcela mensal mantendo o prazo. Nao gera troco.
      let parcelaNovaPort = null, economiaPort = null;
      if (taxa && restantes > 0 && saldoDevedor > 0) {
        const denom = 1 - Math.pow(1 + taxa, -restantes);
        if (denom > 0) {
          parcelaNovaPort = saldoDevedor * taxa / denom;
          economiaPort = (parcela - parcelaNovaPort) * restantes;
        }
      }

      // Cenario B — REFIN DE PORT (TROCO): mantem a parcela atual e expande
      // de volta ao prazo total original. Capital financiado fica maior →
      // diferenca pro saldo devedor = troco pago ao cliente.
      let novoPV = null, troco = null;
      if (taxa && totais > 0 && parcela > 0) {
        const denomT = 1 - Math.pow(1 + taxa, -totais);
        if (denomT > 0) {
          novoPV = parcela * denomT / taxa;
          if (saldoDevedor != null) troco = novoPV - saldoDevedor;
        }
      }

      sugestoes.push({
        banco_id: r.banco_id,
        banco_slug: r.fed_bancos?.slug,
        banco_nome: bancoNome,
        taxa_minima_port: taxa,
        // Port pura (reduz parcela, mantem prazo restante)
        parcela_port_pura: parcelaNovaPort ? Number(parcelaNovaPort.toFixed(2)) : null,
        economia_port_pura: economiaPort ? Number(economiaPort.toFixed(2)) : null,
        // Refin de port com troco (mantem parcela, prazo total)
        novo_pv_refin: novoPV ? Number(novoPV.toFixed(2)) : null,
        troco_estimado: troco != null ? Number(troco.toFixed(2)) : null,
        motivos_bloqueio: motivos,
        atende: motivos.length === 0,
      });
    }
    // Ordena: atende primeiro, depois maior troco, depois menor taxa
    sugestoes.sort((a, b) => {
      if (a.atende !== b.atende) return a.atende ? -1 : 1;
      const tra = a.troco_estimado != null ? a.troco_estimado : -1e9;
      const trb = b.troco_estimado != null ? b.troco_estimado : -1e9;
      if (tra !== trb) return trb - tra;
      const ta = a.taxa_minima_port || 999;
      const tb = b.taxa_minima_port || 999;
      return ta - tb;
    });

    result.push({
      contrato: {
        numero: c.numero,
        banco_origem: c.banco_extrato,
        parcela_valor: parcela,
        parcelas_pagas: pagas,
        parcelas_totais: totais,
        parcelas_restantes: restantes,
        saldo_estimado_sem_juros: Number(c.saldo_estimado) || (parcela * restantes),
        saldo_devedor_estimado: saldoDevedor ? Number(saldoDevedor.toFixed(2)) : null,
        taxa_origem_assumida: TAXA_ORIGEM_PADRAO,
        fim: c.fim,
      },
      sugestoes_top: sugestoes.slice(0, 5),
      total_sugestoes: sugestoes.length,
      qtd_atendem: sugestoes.filter(s => s.atende).length,
    });
  }
  return result;
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
