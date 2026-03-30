export const config = { runtime: 'edge' };

// ═══════════════════════════════════════════════════════════════
// API FACTA — Proxy Completo v2.0
// Baseado em 8 documentos oficiais FACTA (09.01.2026)
// ═══════════════════════════════════════════════════════════════
// Operações suportadas:
//   INSS Novo Digital (13) / Margem Complementar (27/35/37)
//   INSS Refin Digital (14/49)
//   Portabilidade CIP + Refin Port (003500 → 17+18)
//   Cartão Consignado Benefício (33)
//   Consulta de Propostas / Esteira / Cancelamento
//   Consulta de Tabelas/Coeficientes
//   Métodos Complementares (combos)
// ═══════════════════════════════════════════════════════════════

const BASE = 'https://webservice.facta.com.br';
const AUTH = 'Basic OTM1OTY6ZDNtNXFxMXM0dmp5cDJ2YjZqdnk=';
const LOGIN_CERT = '93596';

// Token cache — validade real 1h, cache 50min por segurança
let _tk = { token: null, exp: 0 };

async function getToken() {
  if (_tk.token && Date.now() < _tk.exp) return _tk.token;
  const r = await fetch(BASE + '/gera-token', { headers: { 'Authorization': AUTH } });
  const d = await r.json();
  if (d.erro === false && d.token) {
    _tk = { token: d.token, exp: Date.now() + 50 * 60 * 1000 };
    return d.token;
  }
  throw new Error(d.mensagem || 'Erro ao gerar token FACTA');
}

// GET com query string
async function fGet(path, params) {
  const token = await getToken();
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const r = await fetch(BASE + path + qs, {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 3000) }; }
  return { ok: r.ok, status: r.status, data: d };
}

// POST com form-data (multipart) — como a FACTA espera
async function fPost(path, fields) {
  const token = await getToken();
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null && v !== '') fd.append(k, String(v));
  }
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token },
    body: fd
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 3000) }; }
  return { ok: r.ok, status: r.status, data: d };
}

// POST com JSON (usado no cancelamento)
async function fPostJson(path, body) {
  const token = await getToken();
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 3000) }; }
  return { ok: r.ok, status: r.status, data: d };
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const j = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: CORS });

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: { ...CORS, 'Access-Control-Allow-Methods': 'POST,GET', 'Access-Control-Allow-Headers': 'Content-Type' } });

  try {
    const body = req.method === 'POST' ? await req.json() : {};
    const action = body.action || '';

    // ═══════════════════════════════════════
    // TEST — Verifica conexão e token
    // ═══════════════════════════════════════
    if (action === 'test') {
      try {
        const token = await getToken();
        return j({ apiActive: true, message: 'API FACTA ativa!', tokenPreview: token.substring(0, 20) + '...' });
      } catch (e) {
        return j({ apiActive: false, message: e.message });
      }
    }

    // ═══════════════════════════════════════
    // SIMULAÇÃO — Consulta operações disponíveis
    // Serve pra TODOS os tipos: 13, 27, 33, 14, 003500
    // ═══════════════════════════════════════
    // body: { tipo_operacao, cpf, data_nascimento, opcao_valor, valor?, valor_parcela?, prazo?,
    //         valor_renda?, prazo_restante?, saldo_devedor?, valor_parcela_original?,
    //         contratos_refin?, vendedor? }
    if (action === 'simular') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      if (!cpf) return j({ error: 'CPF obrigatório' }, 400);
      const p = {
        produto: 'D',
        tipo_operacao: body.tipo_operacao || 13,
        averbador: body.averbador || 3,
        convenio: body.convenio || 3,
        opcao_valor: body.opcao_valor || 1,
        cpf,
        data_nascimento: body.data_nascimento || ''
      };
      // Campos opcionais por tipo de operação
      if (body.valor) p.valor = body.valor;
      if (body.valor_parcela) p.valor_parcela = body.valor_parcela;
      if (body.prazo) p.prazo = body.prazo;
      if (body.valor_renda) p.valor_renda = body.valor_renda;               // Refin(14) + Cartão(33)
      if (body.prazo_restante) p.prazo_restante = body.prazo_restante;       // Port CIP(003500)
      if (body.saldo_devedor) p.saldo_devedor = body.saldo_devedor;          // Port CIP(003500)
      if (body.valor_parcela_original) p.valor_parcela_original = body.valor_parcela_original; // Port CIP
      if (body.prazo_original) p.prazo_original = body.prazo_original;       // Port CIP
      if (body.contratos_refin) p.contratos_refin = body.contratos_refin;    // Refin(14)
      if (body.vendedor) p.vendedor = body.vendedor;

      const r = await fGet('/proposta/operacoes-disponiveis', p);
      const d = r.data;
      // Port CIP retorna 2 arrays diferentes
      const resp = { success: d.erro === false, erro: d.erro, mensagem: d.mensagem || null };
      if (d.tabelas_portabilidade) {
        resp.tabelas_portabilidade = d.tabelas_portabilidade;
        resp.tabelas_refin_portabilidade = d.tabelas_refin_portabilidade || [];
      } else {
        resp.tabelas = d.tabelas || [];
      }
      return j(resp);
    }

    // ═══════════════════════════════════════
    // CONTRATOS REFIN — Busca contratos passíveis de refinanciamento
    // Exclusivo: REFIN (tipo_operacao 14 ou 49)
    // ═══════════════════════════════════════
    // body: { cpf, tipo_operacao: 14|49 }
    if (action === 'contratosRefin') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      if (!cpf) return j({ error: 'CPF obrigatório' }, 400);
      const r = await fGet('/proposta/contratos-refinanciamento', {
        cpf, tipo_operacao: body.tipo_operacao || 14, averbador: 3, convenio: 3
      });
      return j({ success: r.data.erro === false, ...r.data });
    }

    // ═══════════════════════════════════════
    // ETAPA 1 — Simulação de valores (gravar simulação)
    // Serve pra: Novo(13), Margem(27), Refin(14/49), Port(003500), Cartão(33)
    // ═══════════════════════════════════════
    // body: { cpf, data_nascimento, tipo_operacao, codigo_tabela, prazo,
    //         valor_operacao, valor_parcela, coeficiente,
    //         login_certificado?, vendedor?, codigo_master?, gerente_comercial?,
    //         contratos_refin?, saldo_devedor?, prazo_original?, valor_renda? }
    if (action === 'etapa1') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      if (!cpf) return j({ error: 'CPF obrigatório' }, 400);
      const fields = {
        produto: 'D',
        tipo_operacao: body.tipo_operacao || 13,
        averbador: body.averbador || 3,
        convenio: body.convenio || 3,
        cpf,
        data_nascimento: body.data_nascimento,
        login_certificado: body.login_certificado || LOGIN_CERT,
        codigo_tabela: body.codigo_tabela,
        prazo: body.prazo,
        valor_operacao: body.valor_operacao,
        valor_parcela: body.valor_parcela,
        coeficiente: body.coeficiente
      };
      // Campos opcionais
      if (body.vendedor) fields.vendedor = body.vendedor;
      if (body.codigo_master) fields.codigo_master = body.codigo_master;
      if (body.gerente_comercial) fields.gerente_comercial = body.gerente_comercial;
      if (body.cpf_representante) fields.cpf_representante = body.cpf_representante;
      if (body.nome_representante) fields.nome_representante = body.nome_representante;
      // Refin (14/49)
      if (body.contratos_refin) fields.contratos_refin = body.contratos_refin;
      if (body.saldo_devedor) fields.saldo_devedor = body.saldo_devedor;
      // Port CIP (003500)
      if (body.prazo_original) fields.prazo_original = body.prazo_original;
      // Cartão (33) / Refin (14)
      if (body.valor_renda) fields.valor_renda = body.valor_renda;

      const r = await fPost('/proposta/etapa1-simulador', fields);
      return j({ success: r.data.erro === false, ...r.data });
      // Retorna: { id_simulador: "0000000" }
    }

    // ═══════════════════════════════════════
    // ETAPA 1 REFIN PORT — Valores do Refin da Portabilidade
    // Exclusivo: Portabilidade CIP (003500)
    // Deve ser chamado APÓS etapa1 da portabilidade
    // ═══════════════════════════════════════
    // body: { id_simulador, banco_compra, contrato_compra, prazo_restante,
    //         saldo_devedor, valor_parcela_original, prazo, codigo_tabela,
    //         coeficiente, valor_operacao, valor_parcela, vendedor? }
    if (action === 'etapa1RefinPort') {
      if (!body.id_simulador) return j({ error: 'id_simulador obrigatório' }, 400);
      const fields = {
        id_simulador: body.id_simulador,
        banco_compra: body.banco_compra,
        contrato_compra: body.contrato_compra,
        prazo_restante: body.prazo_restante,
        saldo_devedor: body.saldo_devedor,
        valor_parcela_original: body.valor_parcela_original,
        prazo: body.prazo,
        codigo_tabela: body.codigo_tabela,
        coeficiente: body.coeficiente,
        valor_operacao: body.valor_operacao,
        valor_parcela: body.valor_parcela
      };
      if (body.vendedor) fields.vendedor = body.vendedor;

      const r = await fPost('/proposta/etapa1-refin-portabilidade', fields);
      return j({ success: r.data.erro === false, ...r.data });
    }

    // ═══════════════════════════════════════
    // ETAPA 2 — Cadastro de dados pessoais
    // Serve pra TODOS os tipos
    // ═══════════════════════════════════════
    // body: { id_simulador, cpf, nome, sexo, estado_civil, data_nascimento,
    //         rg, estado_rg, orgao_emissor, data_expedicao, estado_natural,
    //         cidade_natural, nacionalidade, celular, email, renda, cep,
    //         endereco, numero, complemento?, bairro, cidade, estado,
    //         nome_mae, nome_pai, valor_patrimonio, cliente_iletrado_impossibilitado,
    //         banco, agencia, conta, matricula, tipo_credito_nb, tipo_beneficio,
    //         estado_beneficio, tipo_chave_pix, chave_pix,
    //         tipo_conta?, pais_origem?, banco_pagamento?, agencia_pagamento?, conta_pagamento?,
    //         nome_a_rogo?, cpf_a_rogo?, nome_a_rogo_testemunha?, cpf_a_rogo_testemunha?,
    //         tipo_documento?,
    //         beneficiario_nome_1..5?, beneficiario_parentesco_1..5?, beneficiario_percentual_1..5? }
    if (action === 'etapa2') {
      if (!body.id_simulador) return j({ error: 'id_simulador obrigatório' }, 400);
      const fields = {};
      // Copia todos os campos do body (exceto action)
      for (const [k, v] of Object.entries(body)) {
        if (k !== 'action' && v !== undefined && v !== null) fields[k] = v;
      }
      // Limpa CPF
      if (fields.cpf) fields.cpf = String(fields.cpf).replace(/\D/g, '');

      const r = await fPost('/proposta/etapa2-dados-pessoais', fields);
      return j({ success: r.data.erro === false, ...r.data });
      // Retorna: { codigo_cliente: "00000", novo_cliente: "N" }
    }

    // ═══════════════════════════════════════
    // ETAPA 3 — Proposta cadastro (gera AF + link formalização)
    // Serve pra TODOS os tipos
    // ═══════════════════════════════════════
    // body: { codigo_cliente, id_simulador, tipo_formalizacao?: "PRE"|"DIG" }
    if (action === 'etapa3') {
      if (!body.codigo_cliente || !body.id_simulador) return j({ error: 'codigo_cliente e id_simulador obrigatórios' }, 400);
      const fields = {
        codigo_cliente: body.codigo_cliente,
        id_simulador: body.id_simulador
      };
      if (body.tipo_formalizacao) fields.tipo_formalizacao = body.tipo_formalizacao;

      const r = await fPost('/proposta/etapa3-proposta-cadastro', fields);
      return j({ success: r.data.erro === false, ...r.data });
      // Retorna: { codigo: "AF", url_formalizacao: "facta.ly/xxx" }
      // Port CIP retorna também: codigo_refin_port
    }

    // ═══════════════════════════════════════
    // ENVIO DE LINK — Formalização por WhatsApp ou SMS
    // ═══════════════════════════════════════
    // body: { codigo_af, tipo_envio: "whatsapp"|"sms" }
    if (action === 'enviarLink') {
      if (!body.codigo_af) return j({ error: 'codigo_af obrigatório' }, 400);
      const r = await fPost('/proposta/envio-link', {
        codigo_af: body.codigo_af,
        tipo_envio: body.tipo_envio || 'whatsapp'
      });
      return j({ success: r.data.erro === false, ...r.data });
    }

    // ═══════════════════════════════════════
    // ANDAMENTO DE PROPOSTAS — Esteira completa
    // ═══════════════════════════════════════
    // body: { af?, data_ini?, data_fim?, data_alteracao_ini?, data_alteracao_fim?,
    //         convenio?, averbador?, cpf?, pagina?, quantidade?,
    //         consulta_sub?, codigo_sub? }
    if (action === 'andamentoPropostas') {
      const p = {};
      const keys = ['af', 'data_ini', 'data_fim', 'data_alteracao_ini', 'data_alteracao_fim',
        'convenio', 'averbador', 'cpf', 'pagina', 'quantidade', 'consulta_sub', 'codigo_sub'];
      for (const k of keys) { if (body[k] !== undefined && body[k] !== '') p[k] = body[k]; }
      const r = await fGet('/proposta/andamento-propostas', p);
      return j({ success: r.data.erro === false, ...r.data });
    }

    // ═══════════════════════════════════════
    // PROPOSTAS ATUALIZADAS — Só mudanças do dia (leve)
    // ═══════════════════════════════════════
    // body: { data_alteracao?, consulta_sub?, codigo_sub? }
    if (action === 'propostasAtualizadas') {
      const p = {};
      if (body.data_alteracao) p.data_alteracao = body.data_alteracao;
      if (body.consulta_sub) p.consulta_sub = body.consulta_sub;
      if (body.codigo_sub) p.codigo_sub = body.codigo_sub;
      const r = await fGet('/proposta/propostas-atualizadas', p);
      return j({ success: r.data.erro === false, ...r.data });
    }

    // ═══════════════════════════════════════
    // CONSULTA OCORRÊNCIAS — Timeline de uma proposta
    // ═══════════════════════════════════════
    // body: { af }
    if (action === 'consultaOcorrencias') {
      if (!body.af) return j({ error: 'af obrigatório' }, 400);
      const r = await fGet('/proposta/consulta-ocorrencias', { af: body.af });
      return j({ success: r.data.erro === false, ...r.data });
    }

    // ═══════════════════════════════════════
    // CONSULTA CLIENTE — Dados cadastrais por CPF
    // ═══════════════════════════════════════
    // body: { cpf }
    if (action === 'consultaCliente') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      if (!cpf) return j({ error: 'CPF obrigatório' }, 400);
      const r = await fGet('/proposta/consulta-cliente', { cpf });
      return j({ success: r.data.erro === false, ...r.data });
    }

    // ═══════════════════════════════════════
    // CANCELAMENTO DE PROPOSTA
    // ═══════════════════════════════════════
    // body: { codigo_af }
    if (action === 'cancelarProposta') {
      if (!body.codigo_af) return j({ error: 'codigo_af obrigatório' }, 400);
      const r = await fPostJson('/cancelamento-contrato/solicitacao', {
        codigo_af: body.codigo_af
      });
      return j({ success: r.data.erro === false, ...r.data });
    }

    // ═══════════════════════════════════════
    // TABELAS E COEFICIENTES
    // ═══════════════════════════════════════
    // body: { averbador: 3|20095, tipo_operacao: 13, tabela?, prazo?, data? }
    if (action === 'tabelasCoeficientes') {
      if (!body.averbador || !body.tipo_operacao) return j({ error: 'averbador e tipo_operacao obrigatórios' }, 400);
      const p = { averbador: body.averbador, tipo_operacao: body.tipo_operacao };
      if (body.tabela) p.tabela = body.tabela;
      if (body.prazo) p.prazo = body.prazo;
      if (body.data) p.data = body.data;
      const r = await fGet('/comercial/tabelas-coeficientes', p);
      return j({ success: r.data.erro === false, ...r.data });
    }

    // ═══════════════════════════════════════
    // COMBOS / LOOKUPS — Métodos complementares
    // ═══════════════════════════════════════
    // body: { combo: "produto"|"banco"|"tipo-operacao"|"orgao-emissor"|"averbador"|
    //                "convenio"|"paises"|"estado"|"cidade"|"estado-civil"|
    //                "tipo-beneficio"|"valor-patrimonial"|"tipo-documento"|
    //                "tipo-chave-pix"|"gerente-comercial",
    //         params?: { nome_banco?, produto?, tipo_operacao?, averbador?,
    //                    estado?, nome_cidade?, Id_Simulador?, nome? } }
    if (action === 'combo') {
      const combo = body.combo || '';
      const valid = ['produto', 'banco', 'tipo-operacao', 'orgao-emissor', 'averbador',
        'convenio', 'paises', 'estado', 'cidade', 'estado-civil', 'tipo-beneficio',
        'valor-patrimonial', 'tipo-documento', 'tipo-chave-pix', 'gerente-comercial'];
      if (!valid.includes(combo)) return j({ error: 'combo inválido', valid }, 400);

      const r = await fGet('/proposta-combos/' + combo, body.params || {});
      return j({ success: r.data.erro === false, ...r.data });
    }

    // ═══════════════════════════════════════
    // FLUXO COMPLETO — Helper que executa todas as etapas de uma vez
    // Pra uso interno do FlowForce (simulação rápida)
    // ═══════════════════════════════════════
    // body: { tipo_operacao, cpf, data_nascimento, opcao_valor, valor?, prazo?, ... }
    // Retorna apenas as tabelas disponíveis (etapa de simulação)
    if (action === 'simulacaoRapida') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      if (!cpf || !body.data_nascimento) return j({ error: 'CPF e data_nascimento obrigatórios' }, 400);

      const tipoOp = body.tipo_operacao || 13;
      const p = {
        produto: 'D', tipo_operacao: tipoOp, averbador: 3, convenio: 3,
        cpf, data_nascimento: body.data_nascimento
      };

      // Novo/Margem (13, 27)
      if ([13, 27, 35, 37].includes(Number(tipoOp))) {
        p.opcao_valor = body.opcao_valor || 1;
        if (body.valor) p.valor = body.valor;
        if (body.valor_parcela) p.valor_parcela = body.valor_parcela;
        if (body.prazo) p.prazo = body.prazo;
      }
      // Refin (14, 49)
      else if ([14, 49].includes(Number(tipoOp))) {
        p.opcao_valor = 2;
        p.valor_parcela = body.valor_parcela;
        p.valor_renda = body.valor_renda;
        p.contratos_refin = body.contratos_refin;
        if (body.prazo) p.prazo = body.prazo;
      }
      // Cartão Benefício (33)
      else if (Number(tipoOp) === 33) {
        p.opcao_valor = 1;
        p.valor = body.valor;
        p.valor_renda = body.valor_renda;
      }
      // Port CIP (003500)
      else if (String(tipoOp) === '003500') {
        p.opcao_valor = 2;
        p.valor_parcela = body.valor_parcela;
        p.prazo = body.prazo;
        p.prazo_restante = body.prazo_restante;
        p.saldo_devedor = body.saldo_devedor;
        p.valor_parcela_original = body.valor_parcela_original;
        if (body.prazo_original) p.prazo_original = body.prazo_original;
      }

      const r = await fGet('/proposta/operacoes-disponiveis', p);
      const d = r.data;
      return j({
        success: d.erro === false,
        tipo_operacao: tipoOp,
        tabelas: d.tabelas || undefined,
        tabelas_portabilidade: d.tabelas_portabilidade || undefined,
        tabelas_refin_portabilidade: d.tabelas_refin_portabilidade || undefined,
        mensagem: d.mensagem || null
      });
    }

    // ═══════════════════════════════════════
    // ACTION NÃO ENCONTRADA
    // ═══════════════════════════════════════
    return j({
      error: 'action inválida',
      validActions: [
        'test',
        '── DIGITAÇÃO ──',
        'simular', 'contratosRefin', 'etapa1', 'etapa1RefinPort',
        'etapa2', 'etapa3', 'enviarLink',
        '── ESTEIRA ──',
        'andamentoPropostas', 'propostasAtualizadas', 'consultaOcorrencias',
        'consultaCliente', 'cancelarProposta',
        '── CONSULTAS ──',
        'tabelasCoeficientes', 'combo', 'simulacaoRapida'
      ]
    }, 400);

  } catch (err) {
    return j({ error: err.message, stack: err.stack?.substring(0, 500) }, 500);
  }
}
