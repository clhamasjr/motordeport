// ══════════════════════════════════════════════════════════════════
// api/presencabank.js — PresençaBank: Consignado Privado (CLT)
// Documentação: presena-bank.readme.io + Postman collection
// URL base produção: https://presenca-bank-api.azurewebsites.net
// Rate limit: 30 req/min → recomendado 1 req/2s
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';

function getConfig() {
  return {
    BASE: process.env.PRESENCABANK_BASE_URL || 'https://presenca-bank-api.azurewebsites.net',
    LOGIN: process.env.PRESENCABANK_LOGIN,
    SENHA: process.env.PRESENCABANK_SENHA,
    PRODUTO_ID: parseInt(process.env.PRESENCABANK_PRODUTO_ID || '28'), // 28 = Consignado Privado
  };
}

// ── Token cache (em memória edge) ─────────────────────────────────
// PresençaBank não documenta TTL explícito, cacheamos por 15min conservadoramente.
let TOKEN_CACHE = { token: null, expiresAt: 0 };

async function getToken() {
  const now = Date.now();
  if (TOKEN_CACHE.token && TOKEN_CACHE.expiresAt > now + 60_000) {
    return TOKEN_CACHE.token;
  }
  const cfg = getConfig();
  if (!cfg.LOGIN || !cfg.SENHA) {
    throw new Error('PRESENCABANK_LOGIN/PRESENCABANK_SENHA nao configurados');
  }
  const r = await fetch(cfg.BASE + '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: cfg.LOGIN, senha: cfg.SENHA }),
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 500) }; }
  if (!r.ok || !d.token) {
    throw new Error(`Falha auth PresencaBank (HTTP ${r.status}): ${d.message || d.error || d.raw || 'sem detalhes'}`);
  }
  // Cache 15min — conservador
  TOKEN_CACHE = { token: d.token, expiresAt: now + (15 * 60 * 1000) };
  return d.token;
}

async function pbCall(path, method, body) {
  const token = await getToken();
  const cfg = getConfig();
  const opts = {
    method,
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const r = await fetch(cfg.BASE + path, opts);
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 2000) }; }
  return { ok: r.ok, status: r.status, data: d };
}

const j = (data, status = 200, req = null) => jsonResp(data, status, req);

// ══════════════════════════════════════════════════════════════════
// HANDLER
// ══════════════════════════════════════════════════════════════════
export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  try {
    const body = req.method === 'POST' ? await req.json() : {};
    const action = body.action || '';

    // ─── TEST: valida auth ────────────────────────────────────
    if (action === 'test') {
      try {
        const token = await getToken();
        return j({
          success: true,
          apiActive: true,
          message: 'API PresencaBank autenticada com sucesso!',
          tokenPreview: token.substring(0, 24) + '...',
          config: { baseUrl: getConfig().BASE, login: getConfig().LOGIN, produtoId: getConfig().PRODUTO_ID },
        }, 200, req);
      } catch (e) {
        return j({ success: false, apiActive: false, error: e.message }, 200, req);
      }
    }

    // ─── 1) GERAR TERMO DE AUTORIZAÇÃO (LGPD) ─────────────────
    // POST /consultas/termo-inss
    // Retorna link que o cliente precisa aceitar antes de qualquer consulta
    if (action === 'gerarTermo') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      const telefone = (body.telefone || '').replace(/\D/g, '');
      if (!cpf || !body.nome || !telefone) {
        return jsonError('cpf, nome e telefone sao obrigatorios', 400, req);
      }
      const r = await pbCall('/consultas/termo-inss', 'POST', {
        cpf, nome: body.nome, telefone, produtoId: getConfig().PRODUTO_ID,
      });
      return j({
        success: r.ok, httpStatus: r.status,
        termoId: r.data?.id || r.data?.termoId || null,
        link: r.data?.link || r.data?.url || null,
        aceito: r.data?.aceito || false,
        mensagemParaCliente: (r.data?.link || r.data?.url)
          ? `Pra continuar, aceite o termo: ${r.data.link || r.data.url}`
          : null,
        _raw: r.data,
      }, 200, req);
    }

    // ─── 1.5) ASSINAR TERMO PRÓPRIO ───────────────────────────
    // PUT /consultas/termo-inss/{id}
    // Usado quando o corban ACEITA o termo no lugar do cliente (termo próprio).
    // Permitido porque é modelo de consentimento por representação autorizada.
    if (action === 'assinarTermo') {
      if (!body.termoId) return jsonError('termoId obrigatorio (retornado do gerarTermo)', 400, req);
      const cfg = getConfig();
      const token = await getToken();
      const payload = {
        userAgent: body.userAgent || 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
        OperationalSystem: body.operationalSystem || 'Android',
        DeviceModel: body.deviceModel || 'Server',
        DeviceName: body.deviceName || 'LhamasCred Backend',
        DeviceType: body.deviceType || 'Backend',
        GeoLocation: body.geoLocation || { Latitude: '-23.5016', Longitude: '-47.4592' } // Sorocaba
      };
      const r = await fetch(cfg.BASE + `/consultas/termo-inss/${encodeURIComponent(body.termoId)}`, {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json',
          'tenant-id': 'superuser'
        },
        body: JSON.stringify(payload)
      });
      const t = await r.text();
      let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 2000) }; }
      return j({ success: r.ok, httpStatus: r.status, data: d }, 200, req);
    }

    // ─── FLUXO COMPLETO (termo proprio + vinculos + margem + tabelas) ─
    // Orquestra tudo num endpoint: gera termo, assina (termo proprio),
    // consulta vinculos, pega margem e traz tabelas disponiveis.
    // Input: cpf, nome, telefone (obrigatorios)
    if (action === 'fluxoCompleto') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      const telefone = (body.telefone || '').replace(/\D/g, '');
      if (!cpf || !body.nome || !telefone) {
        return jsonError('cpf, nome e telefone obrigatorios', 400, req);
      }

      // 1) Gera termo
      const termoR = await pbCall('/consultas/termo-inss', 'POST', {
        cpf, nome: body.nome, telefone, produtoId: getConfig().PRODUTO_ID
      });
      const termoId = termoR.data?.id || termoR.data?.termoId;
      if (!termoR.ok || !termoId) {
        return j({ success: false, etapa: 'gerarTermo', erro: termoR.data }, 200, req);
      }

      // 2) Assina termo proprio
      const cfg = getConfig();
      const token = await getToken();
      const assinaR = await fetch(cfg.BASE + `/consultas/termo-inss/${encodeURIComponent(termoId)}`, {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json',
          'tenant-id': 'superuser'
        },
        body: JSON.stringify({
          userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
          OperationalSystem: 'Android',
          DeviceModel: 'Server',
          DeviceName: 'LhamasCred Backend',
          DeviceType: 'Backend',
          GeoLocation: { Latitude: '-23.5016', Longitude: '-47.4592' }
        })
      });
      if (!assinaR.ok) {
        const at = await assinaR.text();
        return j({ success: false, etapa: 'assinarTermo', httpStatus: assinaR.status, erro: at.substring(0, 500) }, 200, req);
      }

      // 3) Consulta vínculos
      const vincR = await pbCall('/v3/operacoes/consignado-privado/consultar-vinculos', 'POST', { cpf });
      const vinculos = Array.isArray(vincR.data) ? vincR.data : (vincR.data?.vinculos || vincR.data?.data || []);
      if (!vincR.ok || !vinculos.length) {
        return j({
          success: false, etapa: 'consultarVinculos',
          temVinculo: false,
          mensagem: 'Cliente sem vinculo CLT ativo no PresencaBank',
          _raw: vincR.data
        }, 200, req);
      }

      const v = vinculos[0];
      const matricula = v.matricula || v.registroEmpregaticio;
      const cnpj = v.cnpj || v.numeroInscricaoEmpregador || v.cnpjEmpregador;
      const empregador = v.empregador || v.nomeEmpregador || v.razaoSocial;

      // 4) Consulta margem
      const margR = await pbCall('/v3/operacoes/consignado-privado/consultar-margem', 'POST', {
        cpf, matricula, cnpj
      });
      const m = margR.data || {};
      const margemDisponivel = parseFloat(m.valorMargemDisponivel || m.margemDisponivel || 0);

      if (!margR.ok || !margemDisponivel) {
        return j({
          success: false, etapa: 'consultarMargem',
          temVinculo: true,
          vinculo: { matricula, cnpj, empregador },
          mensagem: 'Vinculo encontrado mas sem margem disponivel',
          _raw: margR.data
        }, 200, req);
      }

      // 5) Consulta tabelas
      const tabR = await pbCall('/v5/operacoes/simulacao/disponiveis', 'POST', {
        tomador: {
          telefone: { ddd: telefone.substring(0, 2), numero: telefone.substring(2) },
          cpf, nome: body.nome,
          dataNascimento: m.dataNascimento || body.dataNascimento || '1980-01-01',
          nomeMae: m.nomeMae || '',
          email: body.email || '',
          sexo: m.sexo || null,
          vinculoEmpregaticio: { cnpjEmpregador: cnpj, registroEmpregaticio: matricula },
          dadosBancarios: { codigoBanco: null, agencia: null, conta: null, digitoConta: null, formaCredito: null },
          endereco: { cep: '', rua: '', numero: '', complemento: '', cidade: '', estado: '', bairro: '' }
        },
        proposta: {
          valorSolicitado: 0, quantidadeParcelas: 0,
          produtoId: getConfig().PRODUTO_ID,
          valorParcela: margemDisponivel
        },
        documentos: []
      });

      const tabelas = Array.isArray(tabR.data) ? tabR.data : (tabR.data?.tabelas || tabR.data?.data || []);
      const tabelasNormalizadas = tabelas.map(t => ({
        tabelaId: t.tabelaId || t.id,
        type: t.type || null,
        nome: t.nome || t.descricao,
        quantidadeParcelas: t.quantidadeParcelas,
        valorParcela: t.valorParcela,
        valorSolicitado: t.valorSolicitado || t.valorPrincipal,
        valorLiquido: t.valorLiquido || t.valorCliente,
        taxa: t.taxa || t.taxaMensal,
        cet: t.cet || t.custoTotalEfetivoMensal
      }));

      return j({
        success: true,
        etapa: 'completo',
        temVinculo: true,
        vinculo: { matricula, cnpj, empregador },
        margemDisponivel,
        dadosCliente: {
          nome: m.nome || null,
          dataNascimento: m.dataNascimento || null,
          nomeMae: m.nomeMae || null,
          sexo: m.sexo || null,
          valorRenda: m.valorRenda || m.salario || null
        },
        tabelas: tabelasNormalizadas,
        melhorTabela: tabelasNormalizadas.sort((a,b) => (b.valorLiquido||0)-(a.valorLiquido||0))[0] || null
      }, 200, req);
    }

    // ─── 2) CONSULTAR VÍNCULOS EMPREGATÍCIOS ──────────────────
    // POST /v3/operacoes/consignado-privado/consultar-vinculos
    // Funciona com termo proprio (corban). Resposta vem em r.data.id (nao "vinculos"!)
    // Estrutura real: { id: [{ matricula, numeroInscricaoEmpregador, elegivel, cpf }] }
    if (action === 'consultarVinculos') {
      const digits = (body.cpf || '').replace(/\D/g, '');
      const cpf = (digits.length >= 9 && digits.length <= 11) ? digits.padStart(11, '0') : '';
      if (!cpf) return jsonError('cpf obrigatorio', 400, req);
      const r = await pbCall('/v3/operacoes/consignado-privado/consultar-vinculos', 'POST', { cpf });

      // PB retorna em r.data.id (nao "vinculos")
      const lista = Array.isArray(r.data?.id) ? r.data.id
                  : Array.isArray(r.data) ? r.data
                  : (r.data?.vinculos || r.data?.data || []);
      const normalizados = lista.map(v => ({
        matricula: v.matricula || v.registroEmpregaticio,
        cnpj: v.numeroInscricaoEmpregador || v.cnpj || v.cnpjEmpregador,
        empregador: v.empregador || v.nomeEmpregador || v.razaoSocial || null,
        elegivel: v.elegivel !== false,
        _raw: v,
      }));
      const elegiveis = normalizados.filter(v => v.elegivel);

      return j({
        success: r.ok, httpStatus: r.status, cpf,
        temVinculo: elegiveis.length > 0,
        totalVinculos: normalizados.length,
        totalElegiveis: elegiveis.length,
        vinculos: normalizados,
        mensagem: !r.ok && r.status === 403
          ? 'Termo LGPD ainda nao aceito (ou perfil sem permissao de termo proprio)'
          : (elegiveis.length === 0 ? 'Nenhum vinculo CLT ativo elegivel' : null),
        _raw: r.data,
      }, 200, req);
    }

    // ─── OPORTUNIDADES POR CPF (so CPF, sem nome/tel) ─────────
    // Faz consultarVinculos + consultarMargem.
    // Retorna elegibilidade + margem + dados pessoais (sem simular tabelas).
    // Pra simular tabelas precisa de nome+telefone (use action fluxoCompleto).
    if (action === 'oportunidadesPorCPF') {
      const digits = (body.cpf || '').replace(/\D/g, '');
      const cpf = (digits.length >= 9 && digits.length <= 11) ? digits.padStart(11, '0') : '';
      if (!cpf) return jsonError('cpf obrigatorio', 400, req);

      // 1) Vinculos
      const vincR = await pbCall('/v3/operacoes/consignado-privado/consultar-vinculos', 'POST', { cpf });
      const lista = Array.isArray(vincR.data?.id) ? vincR.data.id : [];
      const elegiveis = lista.filter(v => v.elegivel !== false);

      if (!elegiveis.length) {
        return j({
          success: true, etapa: 'vinculos',
          temVinculo: false,
          mensagem: 'Cliente sem vinculo CLT elegivel no PresencaBank',
          totalVinculosBrutos: lista.length
        }, 200, req);
      }

      // Usa o primeiro elegivel
      const v = elegiveis[0];
      const matricula = v.matricula || v.registroEmpregaticio;
      const cnpj = v.numeroInscricaoEmpregador;

      // 2) Margem
      const margR = await pbCall('/v3/operacoes/consignado-privado/consultar-margem', 'POST', {
        cpf, matricula, cnpj
      });
      const m = margR.data || {};

      return j({
        success: true, etapa: 'completo',
        temVinculo: true,
        cpf,
        vinculo: {
          matricula,
          cnpj,
          empregador: v.empregador || null,
          dataAdmissao: m.dataAdmissao || null
        },
        margem: {
          disponivel: m.valorMargemDisponivel || 0,
          base: m.valorMargemBase || 0,
          totalDevido: m.valorTotalDevido || 0
        },
        dadosCliente: {
          dataNascimento: m.dataNascimento || null,
          nomeMae: m.nomeMae || null,
          sexo: m.sexo || null
        },
        outrosVinculos: elegiveis.length - 1,
        observacao: 'Pra simular tabela exata de credito, ainda eh necessario nome e telefone do cliente.',
        _raw: { vinculos: vincR.data, margem: m }
      }, 200, req);
    }

    // ─── 3) CONSULTAR MARGEM DO VÍNCULO ───────────────────────
    // POST /v3/operacoes/consignado-privado/consultar-margem
    if (action === 'consultarMargem') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      const cnpj = (body.cnpj || '').replace(/\D/g, '');
      if (!cpf || !body.matricula || !cnpj) {
        return jsonError('cpf, matricula e cnpj sao obrigatorios (matricula+cnpj vem do consultarVinculos)', 400, req);
      }
      const r = await pbCall('/v3/operacoes/consignado-privado/consultar-margem', 'POST', {
        cpf, matricula: body.matricula, cnpj,
      });
      const m = r.data || {};
      return j({
        success: r.ok, httpStatus: r.status, cpf,
        margemDisponivel: m.valorMargemDisponivel || m.margemDisponivel || 0,
        dadosCliente: {
          nome: m.nome || null,
          dataNascimento: m.dataNascimento || null,
          nomeMae: m.nomeMae || null,
          sexo: m.sexo || null,
          valorRenda: m.valorRenda || m.salario || null,
        },
        vinculo: {
          cnpjEmpregador: m.cnpjEmpregador || cnpj,
          registroEmpregaticio: m.registroEmpregaticio || body.matricula,
        },
        _raw: r.data,
      }, 200, req);
    }

    // ─── 4) CONSULTAR TABELAS DISPONÍVEIS (SIMULAÇÃO) ─────────
    // POST /v5/operacoes/simulacao/disponiveis
    if (action === 'consultarTabelas') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      if (!cpf || !body.nome || !body.valorParcela) {
        return jsonError('cpf, nome, valorParcela obrigatorios (valorParcela = margem disponivel)', 400, req);
      }
      const payload = {
        tomador: {
          telefone: {
            ddd: (body.ddd || '').replace(/\D/g, ''),
            numero: (body.telefone || '').replace(/\D/g, ''),
          },
          cpf,
          nome: body.nome,
          dataNascimento: body.dataNascimento, // YYYY-MM-DD
          nomeMae: body.nomeMae || '',
          email: body.email || '',
          sexo: body.sexo || null, // "M" ou "F" ou null
          vinculoEmpregaticio: {
            cnpjEmpregador: (body.cnpj || '').replace(/\D/g, ''),
            registroEmpregaticio: body.matricula || '',
          },
          dadosBancarios: {
            codigoBanco: null, agencia: null, conta: null, digitoConta: null, formaCredito: null,
          },
          endereco: {
            cep: body.cep || '', rua: body.logradouro || '', numero: body.numero || '',
            complemento: body.complemento || '', cidade: body.cidade || '',
            estado: body.uf || '', bairro: body.bairro || '',
          },
        },
        proposta: {
          valorSolicitado: 0,
          quantidadeParcelas: 0,
          produtoId: getConfig().PRODUTO_ID,
          valorParcela: parseFloat(body.valorParcela),
        },
        documentos: [],
      };

      const r = await pbCall('/v5/operacoes/simulacao/disponiveis', 'POST', payload);
      const tabelas = Array.isArray(r.data) ? r.data : (r.data?.tabelas || r.data?.data || []);
      const normalizadas = tabelas.map(t => ({
        tabelaId: t.tabelaId || t.id,
        type: t.type || null, // necessário pra criar a proposta
        nome: t.nome || t.descricao,
        quantidadeParcelas: t.quantidadeParcelas,
        valorParcela: t.valorParcela,
        valorSolicitado: t.valorSolicitado || t.valorPrincipal,
        valorLiquido: t.valorLiquido || t.valorCliente,
        taxa: t.taxa || t.taxaMensal,
        cet: t.cet || t.custoTotalEfetivoMensal,
        _raw: t,
      }));

      return j({
        success: r.ok, httpStatus: r.status, cpf,
        totalTabelas: normalizadas.length,
        tabelas: normalizadas,
        _raw: r.data,
      }, 200, req);
    }

    // ─── 5) CRIAR PROPOSTA ────────────────────────────────────
    // POST /v3/operacoes
    if (action === 'criarProposta') {
      const cpf = (body.cpf || '').replace(/\D/g, '');
      const obrigatorios = ['type', 'cpf', 'nome', 'ddd', 'telefone', 'dataNascimento', 'email',
        'cnpj', 'matricula', 'valorRenda', 'cep', 'logradouro', 'numero', 'cidade', 'uf', 'bairro',
        'quantidadeParcelas', 'valorParcela', 'tabelaId'];
      const missing = obrigatorios.filter(k => body[k] === undefined || body[k] === null || body[k] === '');
      if (missing.length) return jsonError('Campos obrigatorios faltando: ' + missing.join(', '), 400, req);

      // Dados bancários: se tem chave pix usa pix, senão usa conta tradicional
      const usarPix = !!body.chavePix;
      const dadosBancarios = usarPix ? {
        agencia: null, conta: null, digitoConta: null,
        formaCredito: '3',
        chavePix: body.chavePix,
        tipoChavePixId: body.tipoChavePixId || 4, // 1=CPF/CNPJ, 3=email, 4=celular, 5=aleatória
      } : {
        agencia: body.agencia,
        conta: body.conta,
        digitoConta: body.digitoConta,
        formaCredito: body.formaCredito || '2', // 1=poupança, 2=corrente
      };

      const payload = {
        type: body.type, // obtido na tabela selecionada do consultarTabelas
        tomador: {
          cpf, nome: body.nome,
          telefone: { ddd: (body.ddd || '').replace(/\D/g, ''), numero: (body.telefone || '').replace(/\D/g, '') },
          dataNascimento: body.dataNascimento,
          email: body.email,
          sexo: body.sexo || 'M',
          nomeMae: body.nomeMae || '',
          vinculoEmpregaticio: {
            cnpjEmpregador: (body.cnpj || '').replace(/\D/g, ''),
            registroEmpregaticio: body.matricula,
            valorRenda: parseFloat(body.valorRenda),
          },
          dadosBancarios,
          endereco: {
            cep: (body.cep || '').replace(/\D/g, ''),
            rua: body.logradouro,
            numero: String(body.numero),
            complemento: body.complemento || '',
            cidade: body.cidade,
            estado: body.uf,
            bairro: body.bairro,
          },
        },
        proposta: {
          valorSolicitado: 0,
          quantidadeParcelas: parseInt(body.quantidadeParcelas),
          produtoId: getConfig().PRODUTO_ID,
          valorParcela: parseFloat(body.valorParcela),
          tabelaId: body.tabelaId,
        },
        documentos: body.documentos || [],
      };

      const r = await pbCall('/v3/operacoes', 'POST', payload);
      return j({
        success: r.ok, httpStatus: r.status,
        propostaId: r.data?.id || r.data?.operacaoId || r.data?.propostaId || null,
        _raw: r.data,
      }, 200, req);
    }

    // ─── 6) LINK DE FORMALIZAÇÃO ──────────────────────────────
    // GET /operacoes/{id}/link-formalizacao
    if (action === 'linkFormalizacao') {
      if (!body.propostaId) return jsonError('propostaId obrigatorio', 400, req);
      const r = await pbCall(`/operacoes/${encodeURIComponent(body.propostaId)}/link-formalizacao`, 'GET', null);
      return j({
        success: r.ok, httpStatus: r.status,
        url: r.data?.link || r.data?.url || null,
        mensagemParaCliente: (r.data?.link || r.data?.url)
          ? `Pra finalizar seu empréstimo, acesse: ${r.data.link || r.data.url}`
          : null,
        _raw: r.data,
      }, 200, req);
    }

    // ─── 7) CONSULTAR PROPOSTA (DETALHE) ──────────────────────
    // GET /operacoes/{id}/detalhe
    if (action === 'consultarProposta') {
      if (!body.propostaId) return jsonError('propostaId obrigatorio', 400, req);
      const r = await pbCall(`/operacoes/${encodeURIComponent(body.propostaId)}/detalhe`, 'GET', null);
      return j({
        success: r.ok, httpStatus: r.status,
        propostaId: body.propostaId,
        status: r.data?.status || r.data?.situacao || null,
        pendencias: r.data?.pendencias || [],
        _raw: r.data,
      }, 200, req);
    }

    // ─── RAW CALL (debug — testar endpoints arbitrarios) ─────
    // Body: { action: 'rawCall', path: '/v3/clientes/...', method: 'GET'|'POST', body: {...} }
    if (action === 'rawCall') {
      if (!body.path) return jsonError('path obrigatorio', 400, req);
      const token = await getToken();
      const cfg = getConfig();
      const opts = {
        method: body.method || 'GET',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json',
          'tenant-id': 'superuser'
        }
      };
      if (body.body && opts.method !== 'GET') opts.body = JSON.stringify(body.body);
      const r = await fetch(cfg.BASE + body.path, opts);
      const t = await r.text();
      let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 2000) }; }
      return j({ httpStatus: r.status, ok: r.ok, path: body.path, method: opts.method, response: d }, 200, req);
    }

    return jsonError(
      'action invalida. Disponiveis: test, gerarTermo, assinarTermo, fluxoCompleto, consultarVinculos, consultarMargem, oportunidadesPorCPF, consultarTabelas, criarProposta, linkFormalizacao, consultarProposta, rawCall',
      400, req
    );
  } catch (err) {
    console.error('presencabank.js erro:', err);
    return j({ error: 'Erro interno', message: err.message || String(err) }, 500, req);
  }
}
