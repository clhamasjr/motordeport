export const config = { runtime: 'edge' };

// ═══ CREDENTIALS ═══
const FACTA_URL = 'https://webservice.facta.com.br';
const FACTA_AUTH = 'Basic OTM1OTY6ZDNtNXFxMXM0dmp5cDJ2YjZqdnk=';

// Token cache (Edge Runtime - per-instance)
let tokenCache = { token: null, expires: 0 };

async function getToken() {
  if (tokenCache.token && Date.now() < tokenCache.expires) return tokenCache.token;
  const r = await fetch(FACTA_URL + '/gera-token', {
    method: 'GET',
    headers: { 'Authorization': FACTA_AUTH }
  });
  const d = await r.json();
  if (d.erro === false && d.token) {
    tokenCache = { token: d.token, expires: Date.now() + 9 * 3600 * 1000 }; // 9h cache
    return d.token;
  }
  throw new Error(d.mensagem || 'Erro ao gerar token FACTA');
}

async function facta(method, path, params, body) {
  const token = await getToken();
  let url = FACTA_URL + path;
  if (params) {
    const qs = new URLSearchParams(params).toString();
    url += '?' + qs;
  }
  const opts = {
    method,
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 2000) }; }
  return { ok: r.ok, status: r.status, data: d };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,GET', 'Access-Control-Allow-Headers': 'Content-Type' } });
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  try {
    const body = req.method === 'POST' ? await req.json() : {};
    const action = body.action || '';

    // ═══ TEST ═══
    if (action === 'test') {
      try {
        const token = await getToken();
        return new Response(JSON.stringify({
          apiActive: true,
          message: 'API FACTA ativa! Token gerado com sucesso.',
          tokenPreview: token.substring(0, 20) + '...'
        }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ apiActive: false, message: e.message }), { headers: cors });
      }
    }

    // ═══ SIMULATION: Query available operations ═══
    // body: { tipo_operacao: 13|27|35|37, cpf, data_nascimento, opcao_valor: 1|2, valor?, valor_parcela?, prazo? }
    if (action === 'simular') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      if (!cpf) return new Response(JSON.stringify({ error: 'CPF obrigatório' }), { status: 400, headers: cors });
      const params = {
        produto: 'D',
        tipo_operacao: body.tipo_operacao || 13,
        averbador: 3,
        convenio: 3,
        opcao_valor: body.opcao_valor || 1,
        cpf: cpf,
        data_nascimento: body.data_nascimento || '',
        prazo: body.prazo || 84
      };
      if (body.valor) params.valor = body.valor;
      if (body.valor_parcela) params.valor_parcela = body.valor_parcela;
      if (body.cpf_representante) params.cpf_representante = body.cpf_representante;
      if (body.nome_representante) params.nome_representante = body.nome_representante;

      const r = await facta('GET', '/proposta/operacoes-disponiveis', params);
      const d = r.data;
      return new Response(JSON.stringify({
        success: !d.erro,
        erro: d.erro,
        mensagem: d.mensagem || null,
        tabelas: (d.tabelas || []).map(t => ({
          convenio: t.convenio,
          idConvenio: t.idConvenio,
          averbador: t.averbador,
          tabela: t.tabela,
          taxa: t.taxa,
          prazo: t.prazo,
          tipoOp: t.tipoop,
          tipoOperacao: t.tipoOperacao,
          codigoTabela: t.codigoTabela,
          coeficiente: t.coeficiente,
          primeiroVencimento: t.primeiro_vencimento,
          contrato: t.contrato,
          parcela: t.parcela
        })),
        totalTabelas: (d.tabelas || []).length
      }), { headers: cors });
    }

    // ═══ DEFINE VALUES: Set operation values from simulation ═══
    // body: { cpf, data_nascimento, tipo_operacao, codigo_tabela, prazo, valor_operacao, valor_parcela, coeficiente, login_certificado? }
    if (action === 'definirValores') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      if (!cpf) return new Response(JSON.stringify({ error: 'CPF obrigatório' }), { status: 400, headers: cors });
      const params = {
        produto: 'D',
        tipo_operacao: body.tipo_operacao || 13,
        averbador: 3,
        convenio: 3,
        cpf: cpf,
        data_nascimento: body.data_nascimento || '',
        login_certificado: body.login_certificado || '93596',
        codigo_tabela: body.codigo_tabela,
        prazo: body.prazo,
        valor_operacao: body.valor_operacao,
        valor_parcela: body.valor_parcela,
        coeficiente: body.coeficiente
      };
      if (body.cpf_representante) params.cpf_representante = body.cpf_representante;
      if (body.nome_representante) params.nome_representante = body.nome_representante;

      const r = await facta('GET', '/proposta/define-valores', params);
      return new Response(JSON.stringify({ success: !r.data.erro, ...r.data }), { headers: cors });
    }

    // ═══ REGISTER PERSONAL DATA ═══
    // body: { dados_pessoais: { cpf, nome, sexo, estado_civil, data_nascimento, rg, orgao_emissor, estado_rg, data_expedicao, estado_natural, cidade_natural, nacionalidade, pep, numero_beneficio, estado, nome_mae, nome_pai?, email, telefone, cep, endereco, numero, complemento?, bairro, cidade, estado_endereco, banco, agencia, conta, tipo_conta } }
    if (action === 'cadastrarDadosPessoais') {
      const r = await facta('POST', '/proposta/dados-pessoais', body.dados_pessoais || body);
      return new Response(JSON.stringify({ success: !r.data.erro, ...r.data }), { headers: cors });
    }

    // ═══ CREATE PROPOSAL ═══
    // body: { proposta: { cpf, tipo_operacao, codigo_tabela, prazo, valor_operacao, valor_parcela, coeficiente, ... } }
    if (action === 'criarProposta') {
      const r = await facta('POST', '/proposta/cadastro', body.proposta || body);
      return new Response(JSON.stringify({
        success: !r.data.erro,
        codigo_af: r.data.codigo_af || null,
        ...r.data
      }), { headers: cors });
    }

    // ═══ SEND FORMALIZATION LINK ═══
    // body: { codigo_af, tipo_envio: 'whatsapp' | 'sms' }
    if (action === 'enviarLink') {
      if (!body.codigo_af) return new Response(JSON.stringify({ error: 'codigo_af obrigatório' }), { status: 400, headers: cors });
      const r = await facta('POST', '/proposta/enviar-link', {
        codigo_af: body.codigo_af,
        tipo_envio: body.tipo_envio || 'whatsapp'
      });
      return new Response(JSON.stringify({ success: !r.data.erro, ...r.data }), { headers: cors });
    }

    // ═══ CHECK PROPOSAL STATUS ═══
    // body: { codigo_af }
    if (action === 'statusProposta') {
      if (!body.codigo_af) return new Response(JSON.stringify({ error: 'codigo_af obrigatório' }), { status: 400, headers: cors });
      const r = await facta('GET', '/proposta/status', { codigo_af: body.codigo_af });
      return new Response(JSON.stringify({ success: !r.data.erro, ...r.data }), { headers: cors });
    }

    return new Response(JSON.stringify({
      error: 'action inválida',
      validActions: ['test', 'simular', 'definirValores', 'cadastrarDadosPessoais', 'criarProposta', 'enviarLink', 'statusProposta']
    }), { status: 400, headers: cors });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: cors });
  }
}
