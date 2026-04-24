// ══════════════════════════════════════════════════════════════════
// api/c6.js — C6 Bank Marketplace: Consignado Trabalhador (CLT)
// Documentação: Manual API V30 (c6bank.info)
// Produto: Empréstimo Consignado Trabalhador com/sem Seguro (2p, 4p, 6p, 9p)
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';

// ── Config ─────────────────────────────────────────────────────
function getConfig() {
  return {
    BASE: process.env.C6_BASE_URL || 'https://marketplace-proposal-service-api-p.c6bank.info',
    USER: process.env.C6_USERNAME,
    PASS: process.env.C6_PASSWORD,
    PROMOTER: process.env.C6_PROMOTER_CODE || '004684',
    CODIGO_ORIGEM: process.env.C6_CODIGO_ORIGEM || '004684',
    CPF_CERT: process.env.C6_CPF_CERTIFICADO,
  };
}

// ── Token cache (em memória do edge) ───────────────────────────
// Edge é stateless entre cold-starts, mas reutiliza dentro da mesma instância.
// Token C6 vive ~20 min (1199s), então vale cachear.
let TOKEN_CACHE = { token: null, expiresAt: 0 };

async function getToken() {
  const now = Date.now();
  if (TOKEN_CACHE.token && TOKEN_CACHE.expiresAt > now + 60_000) {
    return TOKEN_CACHE.token;
  }
  const cfg = getConfig();
  if (!cfg.USER || !cfg.PASS) {
    throw new Error('C6_USERNAME/C6_PASSWORD nao configurados no ambiente');
  }
  const body = new URLSearchParams({ username: cfg.USER, password: cfg.PASS });
  const r = await fetch(cfg.BASE + '/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 500) }; }
  if (!r.ok || !d.access_token) {
    throw new Error(`Falha auth C6 (HTTP ${r.status}): ${d.message || d.error || d.raw || 'sem detalhes'}`);
  }
  const ttlMs = ((d.expires_in_seconds || 1199) * 1000) - 30_000; // margem de 30s
  TOKEN_CACHE = { token: d.access_token, expiresAt: now + ttlMs };
  return d.access_token;
}

// ── Helper de chamada autenticada ──────────────────────────────
async function c6Call(path, method, accept, body) {
  const token = await getToken();
  const cfg = getConfig();
  const opts = {
    method,
    headers: {
      'Authorization': token,
      'Content-Type': 'application/json',
      'Accept': accept || 'application/json',
    },
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const r = await fetch(cfg.BASE + path, opts);
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 2000) }; }
  return { ok: r.ok, status: r.status, data: d };
}

const j = (data, status = 200, req = null) => jsonResp(data, status, req);

// ══════════════════════════════════════════════════════════════
// HANDLER
// ══════════════════════════════════════════════════════════════
export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  try {
    const body = req.method === 'POST' ? await req.json() : {};
    const action = body.action || '';

    // ─── TEST: valida auth + credenciais ─────────────────────
    if (action === 'test') {
      try {
        const token = await getToken();
        return j({
          success: true,
          apiActive: true,
          message: 'API C6 autenticada com sucesso!',
          tokenPreview: token.substring(0, 24) + '...',
          expiresInSeconds: Math.floor((TOKEN_CACHE.expiresAt - Date.now()) / 1000),
          config: {
            baseUrl: getConfig().BASE,
            promoter: getConfig().PROMOTER,
            codigoOrigem: getConfig().CODIGO_ORIGEM,
            cpfCertificado: (getConfig().CPF_CERT || '').substring(0, 6) + '...',
          },
        }, 200, req);
      } catch (e) {
        return j({ success: false, apiActive: false, error: e.message }, 200, req);
      }
    }

    // ─── OFERTA: higienização — o CPF tem oferta CLT no C6? ─
    // Endpoint: POST /marketplace/worker-payroll-loan-offers
    // Retorno: valor pré-aprovado + qtd parcelas + valor parcela + seguro
    if (action === 'oferta') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      if (!cpf || cpf.length !== 11) return jsonError('CPF invalido', 400, req);
      const r = await c6Call(
        '/marketplace/worker-payroll-loan-offers',
        'POST',
        'application/vnd.c6bank_generate_offer_v1+json',
        { cpf_cliente: cpf }
      );
      const t = r.data?.trabalhador || {};
      const temOferta = !!(t.valor_cliente && parseFloat(t.valor_cliente) > 0);
      return j({
        success: r.ok,
        httpStatus: r.status,
        cpf,
        temOferta,
        oferta: temOferta ? {
          valorCliente: parseFloat(t.valor_cliente || 0),
          qtdParcelas: parseInt(t.quantidade_parcelas || 0),
          valorParcela: parseFloat(t.valor_parcela || 0),
          valorTaxa: parseFloat(t.valor_taxa || 0),
          valorSeguroSugerido: parseFloat(t.seguro?.valor_seguro || 0),
        } : null,
        mensagem: temOferta
          ? `Cliente tem oferta pré-aprovada: R$ ${parseFloat(t.valor_cliente).toFixed(2)} em ${t.quantidade_parcelas}x de R$ ${parseFloat(t.valor_parcela).toFixed(2)}`
          : 'Cliente não possui oferta CLT disponível no C6 neste momento.',
        _raw: r.data,
      }, 200, req);
    }

    // ─── GERAR LINK DE AUTORIZAÇÃO (LGPD + Liveness/Selfie) ───
    // Cliente precisa autorizar a consulta de dados do empréstimo trabalhador
    // Endpoint: POST /marketplace/authorization/generate-liveness
    if (action === 'gerarLinkAutorizacao') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      if (!cpf || !body.nome || !body.dataNascimento) {
        return jsonError('cpf, nome e dataNascimento (YYYY-MM-DD) sao obrigatorios', 400, req);
      }
      const payload = {
        nome: body.nome,
        cpf,
        data_nascimento: body.dataNascimento, // formato "1986-07-23"
      };
      if (body.telefone && body.ddd) {
        payload.telefone = {
          numero: (body.telefone || '').replace(/\D/g, ''),
          codigo_area: (body.ddd || '').replace(/\D/g, ''),
        };
      }
      const r = await c6Call(
        '/marketplace/authorization/generate-liveness',
        'POST',
        'application/vnd.c6bank_authorization_generate_liveness_v1+json',
        payload
      );
      return j({
        success: r.ok,
        httpStatus: r.status,
        link: r.data?.link || null,
        dataExpiracao: r.data?.data_expiracao || null,
        mensagemParaCliente: r.ok && r.data?.link
          ? `Pra prosseguir com sua oferta, acesse: ${r.data.link}\n\nVocê vai tirar uma selfie rápida pra confirmar sua identidade.`
          : null,
        _raw: r.data,
      }, 200, req);
    }

    // ─── STATUS DA AUTORIZAÇÃO ────────────────────────────────
    // Endpoint: POST /marketplace/authorization/status
    if (action === 'statusAutorizacao') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      if (!cpf) return jsonError('CPF obrigatorio', 400, req);
      const r = await c6Call(
        '/marketplace/authorization/status',
        'POST',
        'application/vnd.c6bank_authorization_status_v1+json',
        { cpf }
      );
      const st = r.data?.status || '';
      return j({
        success: r.ok,
        httpStatus: r.status,
        cpf,
        statusAutorizacao: st,
        observacao: r.data?.observacao || null,
        autorizado: st === 'AUTORIZADO',
        aguardando: st === 'AGUARDANDO_AUTORIZACAO',
        naoAutorizado: st === 'NAO_AUTORIZADO',
        _raw: r.data,
      }, 200, req);
    }

    // ─── SIMULAÇÃO V2 (com dados bancários C6) ────────────────
    // Retorna até 5 planos: sem seguro, seguro 2p, 4p, 6p, 9p
    // Endpoint: POST /marketplace/worker-payroll-loan-offers/simulation
    if (action === 'simular') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      if (!cpf) return jsonError('CPF obrigatorio', 400, req);
      const tipoSim = body.tipoSimulacao || 'POR_VALOR_MAXIMO';
      const payload = { cpf, tipo_simulacao: tipoSim };

      if (tipoSim === 'POR_VALOR_SOLICITADO') {
        if (!body.prazo || !body.valorSolicitado) {
          return jsonError('prazo e valorSolicitado obrigatorios para POR_VALOR_SOLICITADO', 400, req);
        }
        payload.prazo = parseInt(body.prazo);
        payload.valor_solicitado = parseFloat(body.valorSolicitado);
      }
      if (tipoSim === 'POR_VALOR_PARCELA') {
        if (!body.prazo || !body.valorParcela) {
          return jsonError('prazo e valorParcela obrigatorios para POR_VALOR_PARCELA', 400, req);
        }
        payload.prazo = parseInt(body.prazo);
        payload.valor_parcela = parseFloat(body.valorParcela);
      }

      const r = await c6Call(
        '/marketplace/worker-payroll-loan-offers/simulation',
        'POST',
        'application/vnd.c6bank_simulate_proposal_v2+json',
        payload
      );

      // Mapeia cada condição em um "plano" estruturado
      const planos = (r.data?.condicoes_credito || []).map(c => {
        const cc = c.condicao || {};
        const despesa = (cc.despesas || [])[0] || null;
        const isValido = !(cc.convenio?.observacao && /invalido/i.test(cc.convenio.observacao));
        return {
          idSimulacao: cc.id_simulacao,
          valido: isValido,
          convenio: {
            codigo: cc.convenio?.codigo,
            descricao: cc.convenio?.descricao,
            observacao: cc.convenio?.observacao || null,
          },
          produto: {
            codigo: cc.produto?.codigo,
            descricao: cc.produto?.descricao,
          },
          qtdParcelas: cc.quantidade_parcelas,
          valorSolicitado: cc.valor_solicitado,
          valorPrincipal: cc.valor_principal,
          valorParcela: cc.valor_parcela,
          valorBruto: cc.valor_bruto,
          valorIof: cc.valor_iof,
          valorLiquido: cc.valor_liquido,
          valorCliente: cc.valor_cliente,
          taxaClienteMensal: cc.taxa_cliente_mensal,
          taxaClienteAnual: cc.taxa_cliente_anual,
          cetMensal: cc.custo_total_efetivo_mensal,
          cetAnual: cc.custo_total_efetivo_anual,
          primeiroVencimento: cc.data_primeiro_vencimento,
          ultimoVencimento: cc.data_ultimo_vencimento,
          seguro: despesa ? {
            codigo: despesa.codigo,
            codigoTipo: despesa.codigo_tipo,
            tipo: despesa.descricao_tipo, // "Seguro 2 parcelas", "Seguro 4 parcelas", etc.
            valor: despesa.valor,
            coberturas: despesa.observacao,
          } : null,
          temSeguro: !!despesa,
          dadosBancariosC6: cc.dados_bancarios || null,
        };
      });

      // Extrai dados bancários C6 (se o cliente tiver conta) — mesma info em todos os planos válidos
      const dadosBancariosC6 = planos.find(p => p.dadosBancariosC6)?.dadosBancariosC6 || null;
      const clienteTemContaC6 = !!dadosBancariosC6;
      const planosValidos = planos.filter(p => p.valido);

      return j({
        success: r.ok,
        httpStatus: r.status,
        cpf,
        tipoSimulacao: tipoSim,
        totalPlanos: planos.length,
        totalPlanosValidos: planosValidos.length,
        clienteTemContaC6,
        dadosBancariosC6,
        planos,
        _raw: r.data,
      }, 200, req);
    }

    // ─── INCLUSÃO DE PROPOSTA ─────────────────────────────────
    // Endpoint: POST /marketplace/worker-payroll-loan-offers/include
    if (action === 'incluir') {
      const cfg = getConfig();
      const cpf = (body.cpf || '').replace(/\D/g, '');
      const cep = (body.cep || '').replace(/\D/g, '');

      const payload = {
        id_simulacao: body.idSimulacao,
        cpf,
        ddd: (body.ddd || '').replace(/\D/g, ''),
        numero_telefone: (body.telefone || '').replace(/\D/g, ''),
        logradouro: body.logradouro,
        numero: String(body.numero || ''),
        cep,
        bairro: body.bairro,
        cidade: body.cidade,
        uf: body.uf,
        codigo_origem_6: body.codigoOrigem || cfg.CODIGO_ORIGEM,
        numero_cpf_certificado: (body.cpfCertificado || cfg.CPF_CERT || '').replace(/\D/g, ''),
        dados_bancarios: {
          tipo_conta: body.tipoConta || 'ContaCorrenteIndividual',
          numero_banco: body.numeroBanco,
          numero_agencia: body.numeroAgencia,
          digito_agencia: body.digitoAgencia || '',
          numero_conta: body.numeroConta,
          digito_conta: body.digitoConta,
        },
      };

      // Validação básica
      const obrigatorios = ['id_simulacao', 'cpf', 'ddd', 'numero_telefone', 'logradouro',
        'numero', 'cep', 'bairro', 'cidade', 'uf', 'codigo_origem_6', 'numero_cpf_certificado'];
      const faltando = obrigatorios.filter(k => !payload[k]);
      if (faltando.length) {
        return jsonError('Campos obrigatorios faltando: ' + faltando.join(', '), 400, req);
      }
      const bancOk = payload.dados_bancarios.numero_banco &&
                     payload.dados_bancarios.numero_agencia &&
                     payload.dados_bancarios.numero_conta &&
                     payload.dados_bancarios.digito_conta;
      if (!bancOk) {
        return jsonError('dados_bancarios incompletos (numeroBanco, numeroAgencia, numeroConta, digitoConta)', 400, req);
      }

      const r = await c6Call(
        '/marketplace/worker-payroll-loan-offers/include',
        'POST',
        'application/vnd.c6bank_include_proposal_v1+json',
        payload
      );

      return j({
        success: r.ok,
        httpStatus: r.status,
        propostaNumero: r.data?.proposal_number || r.data?.numero_proposta || r.data?.numero || null,
        _raw: r.data,
      }, 200, req);
    }

    // ─── LINK DE FORMALIZAÇÃO ─────────────────────────────────
    // Endpoint: GET /marketplace/proposal/formalization-url?proposalNumber=X
    if (action === 'linkFormalizacao') {
      if (!body.propostaNumero) return jsonError('propostaNumero obrigatorio', 400, req);
      const r = await c6Call(
        `/marketplace/proposal/formalization-url?proposalNumber=${encodeURIComponent(body.propostaNumero)}`,
        'GET',
        'application/vnd.c6bank_url_consult_v1+json',
        null
      );
      return j({
        success: r.ok,
        httpStatus: r.status,
        url: r.data?.url || null,
        linkStatus: r.data?.status || null,
        ativo: r.data?.status === 'ACTIVE',
        mensagemParaCliente: r.data?.url
          ? `Pra finalizar seu empréstimo, acesse: ${r.data.url}\n\nVocê vai assinar o contrato por selfie. O link vale 30 dias.`
          : null,
        _raw: r.data,
      }, 200, req);
    }

    // ─── CONSULTAR PROPOSTA ───────────────────────────────────
    // Endpoint: GET /marketplace/proposal/{proposalNumber}
    if (action === 'consultarProposta') {
      if (!body.propostaNumero) return jsonError('propostaNumero obrigatorio', 400, req);
      const r = await c6Call(
        `/marketplace/proposal/${encodeURIComponent(body.propostaNumero)}`,
        'GET',
        'application/json',
        null
      );
      return j({
        success: r.ok,
        httpStatus: r.status,
        propostaNumero: body.propostaNumero,
        situacao: r.data?.loan_track?.situation || null,
        atividade: r.data?.loan_track?.current_activity_description || null,
        formalizationStatus: r.data?.formalization_status || null,
        cliente: r.data?.client ? {
          nome: r.data.client.name,
          cpf: r.data.client.tax_identifier,
        } : null,
        _raw: r.data,
      }, 200, req);
    }

    return jsonError(
      'action invalida. Disponiveis: test, oferta, gerarLinkAutorizacao, statusAutorizacao, simular, incluir, linkFormalizacao, consultarProposta',
      400, req
    );
  } catch (err) {
    console.error('c6.js erro:', err);
    return j({ error: 'Erro interno', message: err.message || String(err) }, 500, req);
  }
}
