export const config = { runtime: 'edge' };

// ══════════════════════════════════════════════════════════════════
// api/crefisa-br.js — CREFISA "Baixa Renda" (BOLSA FAMÍLIA)
//
// Portal: app1.gerencialcredito.com.br/CREFISA (sistema 2tech / Gerencial
// Crédito, Classic ASP + Vue). NÃO tem API pública — isto fala com a API
// interna do próprio portal.
//
// ⚠️ O login do portal tem reCAPTCHA + 2FA → o robô NÃO loga sozinho.
// Padrão = SESSÃO COLADA (mesmo do Portal do Consignado / SOMA):
// o dono loga no navegador, roda o snippet (action setPortalSession) 1x,
// e o motor opera o dia inteiro com aquela sessão.
//
// A sessão tem DUAS partes, as duas obrigatórias:
//   • cookie  (ASPSESSIONID...)      → exigido pelas telas .asp legadas
//   • bearer  (JWT do localStorage)  → exigido pela API REST /microservice
//
// Produto: "Baixa Renda" (BR) = Bolsa Família. convenioId2tech=38,
// codigoConvenioCrefisa=70567. NOVO: R$101–750 · REFIN: R$61–750 ·
// parcela R$25–159 · prazo 1–12x.
//
// Consulta do benefício (Portal da Transparência) devolve o NIS. Validado
// ao vivo 05/10/2026 com cliente real: na maioria dos casos o NIS vem
// DIRETO (cenarioId 3 = "Portal atualizado"). Só quando o Portal da
// Transparência não tem o dado é que a Crefisa exige Open Finance como
// plano B → etapa AGUARDA_OPENFINANCE.
//
// Data de pagamento (codigoSubOrgao) = calendário do Bolsa Família, que
// sai do ÚLTIMO DÍGITO DO NIS (tabela DATA_PAGAMENTO_BR abaixo).
// Simulação devolve os 12 prazos de uma vez; a regra de parcela máxima
// (R$ 159) corta parte deles → cada oferta vem marcada com `contratavel`.
//
// Env vars (Vercel): CREFISA_BR_BASE_URL (opcional),
// CREFISA_BR_COD_CLIENTE (default 10431), CREFISA_BR_CODIGO_PARCEIRO.
// ══════════════════════════════════════════════════════════════════

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';
import { dbSelect, dbUpsert } from './_lib/supabase.js';

function getConfig() {
  return {
    BASE: (process.env.CREFISA_BR_BASE_URL || 'https://app1.gerencialcredito.com.br').trim().replace(/\/+$/, ''),
    COD: (process.env.CREFISA_BR_COD_CLIENTE || '10431').trim(),
    CODIGO_PARCEIRO: (process.env.CREFISA_BR_CODIGO_PARCEIRO || '50796').trim(),
    CODIGO_USUARIO_PARCEIRO: (process.env.CREFISA_BR_CODIGO_USUARIO_PARCEIRO || '').trim(),
  };
}

// ── Constantes do produto Baixa Renda (lidas do portal em 03/08/2026) ──
const CONVENIO_ID_2TECH = 38;
const CONVENIO_CREFISA = 70567;
const REGRAS_BR = {
  convenio: 'Baixa Renda (Bolsa Família)',
  convenioId2tech: CONVENIO_ID_2TECH,
  codigoConvenioCrefisa: CONVENIO_CREFISA,
  operacoes: [
    { tipoSimulacao: 1, nome: 'NOVO', valorMin: 101, valorMax: 750, parcelaMin: 25, parcelaMax: 159, prazoMin: 1, prazoMax: 12 },
    { tipoSimulacao: 2, nome: 'REFIN', valorMin: 61, valorMax: 750, parcelaMin: 25, parcelaMax: 159, prazoMin: 1, prazoMax: 12 },
  ],
  // Bancos aceitos pra conta do cliente no Baixa Renda (Crefisa 069 é só INSS)
  bancos: [
    { codigo: 1, nome: 'Banco do Brasil' },
    { codigo: 33, nome: 'Santander' },
    { codigo: 104, nome: 'Caixa Econômica Federal' },
    { codigo: 237, nome: 'Bradesco' },
  ],
  escolaridades: [
    { id: 7, nome: 'PRIMEIRO GRAU INCOMPLETO' }, { id: 1, nome: 'PRIMEIRO GRAU COMPLETO' },
    { id: 8, nome: 'SEGUNDO GRAU INCOMPLETO' }, { id: 2, nome: 'SEGUNDO GRAU COMPLETO' },
    { id: 3, nome: 'SUPERIOR INCOMPLETO' }, { id: 4, nome: 'SUPERIOR COMPLETO' },
    { id: 5, nome: 'PÓS GRADUADO' }, { id: 6, nome: 'NÃO ALFABETIZADO/DEFICIENTE VISUAL' },
  ],
  estadosCivis: [
    { id: 2, nome: 'SOLTEIRO(A)' }, { id: 1, nome: 'CASADO(A)' }, { id: 5, nome: 'UNIÃO ESTÁVEL' },
    { id: 3, nome: 'SEPARADO(A)' }, { id: 6, nome: 'DESQUITADO/DIVORCIADO' }, { id: 4, nome: 'VIÚVO(A)' },
  ],
};

// Documentos: a Crefisa manda os obrigatórios como texto ("RG/CPF;Extrato
// Bancário;Tela de Compartilhamento"). A chave é a 1ª palavra em minúsculo,
// e cada tipo vira UM pdf com nome fixo (tirado do DadosCadastraisCrefisa.js).
const ARQUIVO_POR_TIPO = {
  'rg/cpf': 'Rg', extrato: 'ExtratoBancario', contracheque: 'Contracheque', outros: 'Outros',
  portal: 'PortalCidadao', cad: 'CadUnico', meu: 'MeuNis', tela: 'TelaCompartilhamento',
};
const chaveDocumento = (nome) => String(nome || '').trim().split(' ')[0].toLowerCase();
const MAX_DOC_BYTES = 5 * 1024 * 1024;

// Calendário do Bolsa Família: último dígito do NIS → código "REVERSO" que
// a Crefisa usa como codigoSubOrgao (tirado do SimuladorCrefisa.js).
const DATA_PAGAMENTO_BR = {
  0: 56701, 9: 56702, 8: 56703, 7: 56704, 6: 56705,
  5: 56706, 4: 56707, 3: 56708, 2: 56709, 1: 56710,
};
const dataPagamentoPorNis = (nis) => {
  const d = String(nis || '').slice(-1);
  return d === '' ? null : (DATA_PAGAMENTO_BR[Number(d)] ?? null);
};

const onlyDigits = (s) => String(s || '').replace(/\D/g, '');
const j = (data, status = 200, req = null) => jsonResp(data, status, req);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

// ══════════════════════════════════════════════════════════════
// SESSÃO DO PORTAL (colada pelo dono — singleton id=1)
// ══════════════════════════════════════════════════════════════
let _sessMem = null;
async function getPortalSession() {
  if (_sessMem) return _sessMem;
  const { data } = await dbSelect('crefisa_portal_session', { filters: { id: 1 }, single: true });
  _sessMem = data || null;
  return _sessMem;
}
async function savePortalSession(patch) {
  const atual = (await getPortalSession()) || {};
  const merged = { id: 1, ...atual, ...patch, atualizado_em: new Date().toISOString() };
  _sessMem = merged;
  await dbUpsert('crefisa_portal_session', merged, 'id').catch(() => {});
  return merged;
}

const SEM_SESSAO = {
  ok: false,
  status: 401,
  _semSessao: true,
  data: { error: 'Sessão Crefisa não configurada. O portal exige reCAPTCHA + 2FA — o robô não loga sozinho. Faça login no portal e rode o snippet de captura 1x.' },
};
const SESSAO_EXPIRADA = {
  ok: false,
  status: 401,
  _semSessao: true,
  data: { error: 'Sessão Crefisa expirada — recole a sessão (login no portal + snippet de captura).' },
};

// ── Chamada à API REST interna (/microservice/crefisa/{cod}/...) ──
async function apiCall(path, method = 'GET', body = null) {
  const cfg = getConfig();
  const sess = await getPortalSession();
  const cod = sess?.cod_cliente || cfg.COD;
  return apiCallRaiz(`/crefisa/${cod}${path}`, method, body);
}

// ── Mesma coisa, mas com o caminho cru após /microservice (ex: /uploadfile/...) ──
async function apiCallRaiz(path, method = 'GET', body = null) {
  const cfg = getConfig();
  const sess = await getPortalSession();
  if (!sess || !sess.bearer) return SEM_SESSAO;

  const bearer = String(sess.bearer).replace(/^Bearer\s+/i, '');
  const headers = {
    'Authorization': 'Bearer ' + bearer,
    'X-Versao-Sistema': String(sess.versao_sistema || ''),
    'accept': 'application/json, text/plain, */*',
    'Cache-Control': 'no-cache, no-store',
    'User-Agent': UA,
    'Referer': cfg.BASE + '/CREFISA/simuladorCrefisa.asp',
  };
  if (sess.cookie) headers['Cookie'] = sess.cookie;
  if (method !== 'GET') headers['Content-Type'] = 'application/json';

  const url = `${cfg.BASE}/microservice${path}`;
  const r = await fetch(url, {
    method,
    headers,
    ...(body !== null && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
  });

  if (r.status === 401 || r.status === 403) return SESSAO_EXPIRADA;

  const t = await r.text();
  // HTTP 500 com HTML do IIS = quase sempre sessão/credencial faltando
  if (r.status === 500 && /n[ãa]o pode ser exibida|erro interno do servidor/i.test(t)) {
    return SESSAO_EXPIRADA;
  }
  let d;
  try { d = JSON.parse(t); } catch {
    // URL assinada do S3 pode vir como texto puro e ser longa — não corta
    d = /^https:\/\//.test(t.trim()) ? t.trim() : { raw: t.substring(0, 800) };
  }
  return { ok: r.ok, status: r.status, data: d };
}

// ── Chamada aos endpoints .asp legados (ajax_crefisa.asp?combo=...) ──
async function aspCall(params) {
  const cfg = getConfig();
  const sess = await getPortalSession();
  if (!sess || !sess.cookie) return SEM_SESSAO;

  const qs = new URLSearchParams(params).toString();
  const url = `${cfg.BASE}/CREFISA/ajax_crefisa.asp?${qs}`;
  const r = await fetch(url, {
    headers: {
      'Cookie': sess.cookie,
      'accept': 'application/json, text/plain, */*',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': UA,
      'Referer': cfg.BASE + '/CREFISA/simuladorCrefisa.asp',
    },
  });
  const t = await r.text();
  // Se voltou a tela de login, a sessão morreu
  if (/<html/i.test(t) && /senha|recaptcha/i.test(t)) return SESSAO_EXPIRADA;
  let d;
  try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 800) }; }
  return { ok: r.ok, status: r.status, data: d };
}

// ── Traduz a resposta da consulta de benefício numa etapa do funil ──
function classificarBeneficio(r) {
  if (r._semSessao) {
    return { etapa: 'SEM_SESSAO', approved: false, mensagem: r.data.error };
  }
  const d = r.data || {};
  const nis = d?.objeto?.codigoNIS || null;

  if (nis) {
    const nisStr = String(nis);
    const o = d.objeto || {};
    return {
      etapa: 'ELEGIVEL',
      approved: true,
      mensagem: `✅ ${o.descricaoBeneficio || 'Benefício'} confirmado — pode simular`,
      nis: nisStr,
      matriculaRenda: nisStr.slice(0, -1),
      digito: nisStr.slice(-1),
      dataPagamento: dataPagamentoPorNis(nisStr),
      valorBeneficio: o.valor != null ? Number(o.valor) : null,
      descricaoBeneficio: o.descricaoBeneficio || null,
      dataBeneficio: o.dataBeneficio || null,
      docsObrigatorios: o.docsObrigatorios || d.docsObrigatorios || '',
      convenioId2tech: CONVENIO_ID_2TECH,
      convenioId: CONVENIO_CREFISA,
      cenarioId: o.id ?? null,
      _raw: d,
    };
  }

  const msg = String(d.mensagem || d.message || '');
  // A Crefisa exige Open Finance ANTES de liberar a consulta do NIS
  if (/compartilhamento de dados banc|open ?finance/i.test(msg)) {
    return {
      etapa: 'AGUARDA_OPENFINANCE',
      approved: false,
      mensagem: '⏳ Falta o cliente compartilhar os dados bancários (Open Finance) — mande o link',
      docsObrigatorios: d.docsObrigatorios || '',
      _raw: d,
    };
  }
  return {
    etapa: d.erro ? 'NAO_ELEGIVEL' : 'SEM_RETORNO',
    approved: false,
    mensagem: msg || 'Portal da Transparência não retornou benefício pra este CPF',
    docsObrigatorios: d.docsObrigatorios || '',
    _raw: d,
  };
}

// ══════════════════════════════════════════════════════════════
// HANDLER
// ══════════════════════════════════════════════════════════════
export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);
  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  let body;
  try { body = await req.json(); } catch { return jsonError('JSON invalido', 400, req); }
  const action = body.action || 'test';
  const cfg = getConfig();

  try {
    // ── Diagnóstico ────────────────────────────────────────────
    if (action === 'test') {
      return j({ success: true, portal: cfg.BASE, codCliente: cfg.COD, regras: REGRAS_BR }, 200, req);
    }

    if (action === 'regras') {
      return j({ success: true, ...REGRAS_BR }, 200, req);
    }

    // ── Ciclo de vida da sessão ────────────────────────────────
    if (action === 'setPortalSession') {
      const bearer = String(body.bearer || body.authorization || '').replace(/^Bearer\s+/i, '').trim();
      const cookie = String(body.cookie || '').trim();
      if (!bearer) return jsonError('bearer obrigatorio (o JWT do localStorage, sem "Bearer ")', 400, req);
      if (!cookie) return jsonError('cookie obrigatorio (o ASPSESSIONID do portal)', 400, req);
      await savePortalSession({
        bearer,
        cookie,
        versao_sistema: String(body.versaoSistema || '').trim() || null,
        cod_cliente: String(body.cod || cfg.COD).trim(),
        vendedor_id: body.vendedorId ? parseInt(body.vendedorId) : null,
        codigo_parceiro: String(body.codigoParceiro || cfg.CODIGO_PARCEIRO).trim(),
        codigo_usuario_parceiro: String(body.codigoUsuarioParceiro || '').trim() || null,
      });
      return j({ success: true, mensagem: 'Sessão Crefisa salva — motor Baixa Renda ativo' }, 200, req);
    }

    if (action === 'statusPortalSession') {
      const s = (await getPortalSession()) || {};
      if (!s.bearer) {
        return j({ success: false, sessao: 'sem-sessao', viva: false, mensagem: 'Nenhuma sessão colada ainda' }, 200, req);
      }
      // testa vivacidade com um CPF sintético (consulta leve, não cria nada)
      const teste = await apiCall('/captura/operacao-cliente/11144477735?tipo=0', 'GET');
      const viva = !teste._semSessao;
      return j({
        success: true,
        sessao: viva ? 'ativa' : 'expirada',
        viva,
        bearerPreview: String(s.bearer).substring(0, 10) + '...',
        temCookie: !!s.cookie,
        atualizadoEm: s.atualizado_em || null,
        mensagem: viva ? '✅ Sessão viva' : '⚠️ Sessão expirada — recole',
      }, 200, req);
    }

    // ── Daqui pra baixo quase tudo exige CPF ───────────────────
    const cpf = onlyDigits(body.cpf);
    const precisaCpf = [
      'consultarCliente', 'consultarBeneficio', 'enviarLinkOpenFinance', 'statusOpenFinance',
      'refinanciaveis', 'simular', 'validarMatricula', 'validarDadosBancarios', 'digitar', 'fluxo',
    ];
    if (precisaCpf.includes(action) && cpf.length !== 11) {
      return jsonError('cpf obrigatorio (11 digitos)', 400, req);
    }

    // ── Consulta se o cliente pode ser capturado ───────────────
    if (action === 'consultarCliente') {
      const r = await apiCall(`/captura/operacao-cliente/${cpf}?tipo=0`, 'GET');
      if (r._semSessao) return j({ etapa: 'SEM_SESSAO', approved: false, mensagem: r.data.error }, 200, req);
      const o = r.data?.objeto || {};
      return j({
        success: r.ok,
        clienteNovo: o.clienteNovo ?? null,
        permiteCaptura: o.permiteCaptura ?? null,
        mensagem: o.mensagem || r.data?.mensagem || '',
        perfilProposta: o.perfilProposta || [],
        _raw: r.data,
      }, 200, req);
    }

    // ── Consulta do benefício (Portal da Transparência → NIS) ──
    if (action === 'consultarBeneficio') {
      const r = await apiCall(`/captura/consulta-beneficio/${cpf}`, 'GET');
      return j({ success: !r._semSessao, ...classificarBeneficio(r) }, 200, req);
    }

    // ── Open Finance: manda o link e acompanha ─────────────────
    if (action === 'enviarLinkOpenFinance') {
      const payload = {
        codigoBanco: body.codigoBanco ? parseInt(body.codigoBanco) : null,
        telefone: onlyDigits(body.telefone) || '',
        convenioId: CONVENIO_ID_2TECH,
      };
      const r = await apiCall(`/captura/consentimento-link/${cpf}`, 'POST', payload);
      if (r._semSessao) return j({ etapa: 'SEM_SESSAO', approved: false, mensagem: r.data.error }, 200, req);
      return j({
        success: r.ok && !r.data?.erro,
        httpStatus: r.status,
        mensagem: r.data?.mensagem || 'Link de consentimento enviado ao cliente',
        link: r.data?.objeto?.link || r.data?.objeto?.url || null,
        _raw: r.data,
      }, 200, req);
    }

    if (action === 'statusOpenFinance') {
      const cons = await apiCall(`/captura/consentimento-usuario/${cpf}`, 'GET');
      if (cons._semSessao) return j({ etapa: 'SEM_SESSAO', approved: false, mensagem: cons.data.error }, 200, req);
      const dados = await apiCall(`/captura/dados-usuario/${cpf}`, 'GET');
      const bancos = dados.data?.objeto?.dadosCliente?.dadosBancarios || [];
      const temDados = !!(dados.data?.objeto && Object.keys(dados.data.objeto).length);
      return j({
        success: true,
        compartilhado: temDados,
        etapa: temDados ? 'COMPARTILHADO' : 'AGUARDA_OPENFINANCE',
        mensagem: temDados ? '✅ Cliente compartilhou os dados bancários' : '⏳ Aguardando o cliente autorizar no app do banco',
        dadosBancarios: bancos,
        _raw: { cons: cons.data, dados: dados.data },
      }, 200, req);
    }

    // ── Contratos refinanciáveis (pra REFIN) ───────────────────
    if (action === 'refinanciaveis') {
      const r = await apiCall(`/captura/refinanciamento-cliente/${cpf}`, 'POST', {
        codigoParceiro: parseInt(body.codigoParceiro || cfg.CODIGO_PARCEIRO),
        codigoOrgao: CONVENIO_CREFISA,
      });
      if (r._semSessao) return j({ etapa: 'SEM_SESSAO', approved: false, mensagem: r.data.error }, 200, req);
      return j({ success: r.ok, httpStatus: r.status, contratos: r.data?.objeto || [], _raw: r.data }, 200, req);
    }

    // ── Simulação ──────────────────────────────────────────────
    if (action === 'simular') {
      const tipo = parseInt(body.tipoSimulacao || 1); // 1=NOVO 2=REFIN
      const regra = REGRAS_BR.operacoes.find((o) => o.tipoSimulacao === tipo);
      if (!regra) return jsonError('tipoSimulacao invalido (1=NOVO, 2=REFIN)', 400, req);

      const valorTomador = body.valorTomador != null && body.valorTomador !== '' ? parseFloat(body.valorTomador) : null;
      const valorParcela = body.valorParcela != null && body.valorParcela !== '' ? parseFloat(body.valorParcela) : null;
      if (valorTomador == null && valorParcela == null) {
        return jsonError('informe valorTomador OU valorParcela', 400, req);
      }
      // Valida contra as regras do convênio antes de gastar chamada no portal
      if (valorTomador != null && (valorTomador < regra.valorMin || valorTomador > regra.valorMax)) {
        return jsonError(`valorTomador fora da regra ${regra.nome}: R$ ${regra.valorMin} a R$ ${regra.valorMax}`, 400, req);
      }
      if (valorParcela != null && (valorParcela < regra.parcelaMin || valorParcela > regra.parcelaMax)) {
        return jsonError(`valorParcela fora da regra ${regra.nome}: R$ ${regra.parcelaMin} a R$ ${regra.parcelaMax}`, 400, req);
      }

      // Data de pagamento: vem pronta do `fluxo`, ou é derivada do NIS/dígito
      const dataPagamento = body.dataPagamento
        || dataPagamentoPorNis(body.nis || body.digito);
      if (!dataPagamento) {
        return jsonError('dataPagamento obrigatoria (ou informe nis/digito pra derivar)', 400, req);
      }

      const model = {
        cpf,
        codigoParceiro: parseInt(body.codigoParceiro || cfg.CODIGO_PARCEIRO),
        tipoOperacao: tipo,
        valorTomador,
        valorParcela,
        quantidadeParcelas: body.quantidadeParcelas != null ? parseInt(body.quantidadeParcelas) : null,
        codigoOrgao: CONVENIO_CREFISA,
        codigoSubOrgao: String(dataPagamento),
        valorSaldoDevedor: body.valorSaldoDevedor ?? null,
        codigoContratoRefin: body.codigoContratoRefin != null ? parseInt(body.codigoContratoRefin) : null,
        codigoCampanha: body.codigoCampanha != null ? parseInt(body.codigoCampanha) : null,
        dadosBancarios: {
          dddTelefone: onlyDigits(body.ddd) || '',
          numeroTelefone: onlyDigits(body.telefone) || '',
          valorParcela,
        },
      };
      if (body.dataLiberacao) model.dataLiberacao = body.dataLiberacao;

      const r = await apiCall(`/captura/simulacao-proposta/${cpf}`, 'POST', model);
      if (r._semSessao) return j({ etapa: 'SEM_SESSAO', approved: false, mensagem: r.data.error }, 200, req);

      const o = r.data?.objeto || {};
      // A Crefisa devolve os 12 prazos; marca quais respeitam a faixa de parcela
      const simulacoes = (o.simulacoes || []).map((s) => {
        const parcela = Number(s.valorParcela) || 0;
        return {
          ...s,
          contratavel: parcela >= regra.parcelaMin && parcela <= regra.parcelaMax,
        };
      });
      const contrataveis = simulacoes.filter((s) => s.contratavel);
      if (!simulacoes.length) {
        return j({
          etapa: 'SEM_OFERTA',
          approved: false,
          success: false,
          mensagem: r.data?.mensagem || o.mensagemLimiteTomado || 'Nenhuma oferta retornada pra este CPF',
          valorLimiteTomado: o.valorLimiteTomado ?? null,
          dataLiberacao: o.dataLiberacao || null,
          _raw: r.data,
        }, 200, req);
      }
      if (!contrataveis.length) {
        return j({
          etapa: 'SEM_OFERTA',
          approved: false,
          success: false,
          mensagem: `Nenhum prazo cabe na parcela máxima de R$ ${regra.parcelaMax} — tente um valor menor`,
          simulacoes,
          valorLimiteTomado: o.valorLimiteTomado ?? null,
          dataLiberacao: o.dataLiberacao || null,
          _raw: r.data,
        }, 200, req);
      }
      return j({
        etapa: 'COM_OFERTA',
        approved: true,
        success: true,
        mensagem: `✅ ${contrataveis.length} prazo(s) contratável(is)`,
        simulacoes,
        dataPagamento,
        valorLimiteTomado: o.valorLimiteTomado ?? null,
        dataLiberacao: o.dataLiberacao || null,
        _raw: r.data,
      }, 200, req);
    }

    // ── Validações antes de digitar ────────────────────────────
    if (action === 'validarMatricula') {
      // ⚠️ Este endpoint usa PascalCase (validado ao vivo 05/10/2026)
      const r = await apiCall(`/captura/validacao-dados-matricula/${cpf}`, 'POST', {
        CodigoOrgao: CONVENIO_CREFISA,
        CodigoMatricula: onlyDigits(body.matriculaRenda),
        DigitoMatricula: String(body.digito || ''),
      });
      if (r._semSessao) return j({ etapa: 'SEM_SESSAO', approved: false, mensagem: r.data.error }, 200, req);
      const valido = !r.data?.erro && !!r.data?.objeto?.valido;
      return j({
        success: valido,
        valido,
        mensagem: r.data?.erro ? (r.data?.mensagem || 'Erro ao validar') : (r.data?.objeto?.observacao || ''),
        _raw: r.data,
      }, 200, req);
    }

    if (action === 'validarDadosBancarios') {
      // Caixa Tem: a conta vai SEM a operação 1288 (validado ao vivo 05/10/2026)
      const r = await apiCall(`/captura/validacao-dados-bancarios/${cpf}`, 'POST', {
        codigoBanco: parseInt(body.codigoBanco),
        codigoAgencia: parseInt(onlyDigits(body.agencia)),
        digitoAgencia: String(body.digitoAgencia ?? ''),
        codigoConta: onlyDigits(body.contaCorrente),
        digitoConta: String(body.digitoConta ?? '').toUpperCase(),
      });
      if (r._semSessao) return j({ etapa: 'SEM_SESSAO', approved: false, mensagem: r.data.error }, 200, req);
      const valido = !r.data?.erro && !!r.data?.objeto?.valido;
      return j({
        success: valido,
        valido,
        mensagem: r.data?.erro ? (r.data?.mensagem || 'Erro ao validar') : (r.data?.objeto?.observacao || ''),
        _raw: r.data,
      }, 200, req);
    }

    if (action === 'buscarCep') {
      const cep = onlyDigits(body.cep);
      if (cep.length !== 8) return jsonError('cep obrigatorio (8 digitos)', 400, req);
      const qs = cpf.length === 11 ? `?cpf=${cpf}` : '';
      const r = await apiCall(`/captura/buscar-cep/${cep}${qs}`, 'GET');
      if (r._semSessao) return j({ etapa: 'SEM_SESSAO', approved: false, mensagem: r.data.error }, 200, req);
      const o = r.data?.objeto || null;
      if (!o || r.data?.erro) return j({ success: false, mensagem: r.data?.mensagem || 'CEP não encontrado', endereco: null }, 200, req);
      return j({
        success: true,
        endereco: {
          cep,
          logradouro: [o.tipoLogradouro, o.endereco].filter(Boolean).join(' '),
          bairro: o.bairro || '',
          cidade: o.cidade || '',
          uf: o.estado || '',
        },
        _raw: r.data,
      }, 200, req);
    }

    // ── Upload de documento (1 tipo = 1 PDF) ───────────────────
    // O front manda o PDF já montado em base64. O motor pede a URL
    // assinada ao portal, sobe direto no S3 da 2tech (server-side, sem
    // CORS) e devolve o objeto `documento` no formato que a proposta usa.
    if (action === 'uploadDocumento') {
      const guid = String(body.guid || '').trim();
      const chave = chaveDocumento(body.tipo);
      const nomeBase = ARQUIVO_POR_TIPO[chave];
      if (!guid) return jsonError('guid obrigatorio (o mesmo da digitacao)', 400, req);
      if (!nomeBase) return jsonError(`tipo de documento desconhecido: "${body.tipo}"`, 400, req);
      const b64 = String(body.base64 || '').replace(/^data:[^,]+,/, '');
      if (!b64) return jsonError('base64 obrigatorio (PDF)', 400, req);

      let bytes;
      try {
        const bin = atob(b64);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } catch {
        return jsonError('base64 invalido', 400, req);
      }
      if (bytes.length > MAX_DOC_BYTES) return jsonError('documento maior que 5MB — reduza as fotos', 400, req);

      const hoje = new Date().toISOString().slice(0, 10);
      const pasta = `captura/${hoje}/${guid}`;
      const nomeArquivo = `arquivos${nomeBase}.pdf`;

      const sess = await getPortalSession();
      const pre = await apiCallRaiz(`/uploadfile/${sess?.cod_cliente || cfg.COD}/pre-signed-url`, 'POST', {
        FolderName: pasta, Filename: nomeArquivo, ContentType: 'application/pdf',
      });
      if (pre._semSessao) return j({ etapa: 'SEM_SESSAO', approved: false, mensagem: pre.data.error }, 200, req);
      const urlAssinada = typeof pre.data === 'string' ? pre.data : (pre.data?.raw || pre.data?.url || '');
      if (!/^https:\/\//.test(urlAssinada)) {
        return j({ success: false, mensagem: 'Portal não devolveu URL de upload', _raw: pre.data }, 200, req);
      }

      const put = await fetch(decodeURI(urlAssinada), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        body: bytes,
      });
      if (!put.ok) {
        return j({ success: false, httpStatus: put.status, mensagem: `Falha ao subir ${nomeArquivo} (HTTP ${put.status})` }, 200, req);
      }
      return j({
        success: true,
        mensagem: `✅ ${nomeArquivo} enviado`,
        documento: { codigoDocumento: 0, nomeDocumento: nomeArquivo, base64: '', urlDocumento: `${pasta}/${nomeArquivo}` },
      }, 200, req);
    }

    // ── Digitação (envio final da proposta) ────────────────────
    // Modelo idêntico ao DadosCadastraisCrefisa.js (mapeado 05/10/2026).
    // ⚠️ Cria proposta de verdade na Crefisa — a tela sempre pede
    // confirmação antes de chamar isto.
    if (action === 'digitar') {
      const c = body.cliente || {};
      const e = body.endereco || {};
      const db = body.dadosBancarios || {};
      const op = body.operacao || {};
      const tel = onlyDigits(body.telefone);
      const sess = (await getPortalSession()) || {};

      // Validação de obrigatórios (mensagens em pt-BR pro operador)
      const faltando = [];
      const req1 = (v, nome) => { if (v == null || String(v).trim() === '') faltando.push(nome); };
      req1(c.nome, 'nome'); req1(c.dataNascimento, 'data de nascimento'); req1(c.sexo, 'sexo');
      req1(c.rg, 'RG'); req1(c.dataEmissaoRg, 'data de emissão do RG'); req1(c.orgaoEmissorRg, 'órgão emissor');
      req1(c.ufRg, 'UF do RG'); req1(c.ufNascimento, 'UF de nascimento'); req1(c.naturalidade, 'naturalidade');
      req1(c.estadoCivil, 'estado civil'); req1(c.escolaridade, 'escolaridade');
      if (!c.nomeMaeNadaConsta) req1(c.nomeMae, 'nome da mãe');
      req1(e.cep, 'CEP'); req1(e.uf, 'UF'); req1(e.cidade, 'cidade'); req1(e.bairro, 'bairro');
      req1(e.logradouro, 'logradouro'); req1(e.numero, 'número');
      req1(body.matriculaRenda, 'matrícula (NIS)'); req1(body.digito, 'dígito do NIS'); req1(body.valorRenda, 'valor do benefício');
      req1(db.codigoBanco, 'banco'); req1(db.agencia, 'agência'); req1(db.contaCorrente, 'conta'); req1(db.digitoConta, 'dígito da conta');
      req1(op.valorPrincipal, 'valor'); req1(op.valorParcela, 'parcela'); req1(op.quantidadeParcelas, 'prazo');
      if (tel.length < 10) faltando.push('telefone com DDD');
      if (faltando.length) return jsonError(`Faltou preencher: ${faltando.join(', ')}`, 400, req);

      if (!REGRAS_BR.bancos.some((b) => b.codigo === parseInt(db.codigoBanco))) {
        return jsonError('Banco não aceito no Baixa Renda — só Banco do Brasil, Santander, Caixa ou Bradesco', 400, req);
      }
      const parcela = parseFloat(op.valorParcela);
      if (parcela < 25 || parcela > 159) return jsonError('Parcela fora da faixa R$ 25 a R$ 159', 400, req);

      const docs = Array.isArray(body.documentos) ? body.documentos : [];
      const obrig = String(body.docsObrigatorios || '').split(';').map((s) => s.trim()).filter(Boolean);
      const enviados = new Set(docs.map((d) => String(d.nomeDocumento || '')));
      const faltaDoc = obrig.filter((n) => !enviados.has(`arquivos${ARQUIVO_POR_TIPO[chaveDocumento(n)]}.pdf`));
      if (faltaDoc.length) return jsonError(`Faltou anexar: ${faltaDoc.join(', ')}`, 400, req);

      const codigoUsuarioParceiro = String(body.codigoUsuarioParceiro || sess.codigo_usuario_parceiro || cfg.CODIGO_USUARIO_PARCEIRO || '');
      if (!codigoUsuarioParceiro) return jsonError('codigo do usuario digitador nao configurado — recole a sessao com o capturador novo', 400, req);

      const dataPagamento = body.dataPagamento || dataPagamentoPorNis(body.digito);

      // Pré-checks idênticos ao ChecaDadosProposta do portal:
      // 1) cliente não pode ter captura em aberto
      const cap = await apiCall(`/captura/operacao-cliente/${cpf}?codigoParceiro=${parseInt(body.codigoParceiro || sess.codigo_parceiro || cfg.CODIGO_PARCEIRO)}&tipo=0`, 'GET');
      if (cap._semSessao) return j({ etapa: 'SEM_SESSAO', approved: false, mensagem: cap.data.error }, 200, req);
      if (cap.data?.erro || !cap.data?.objeto) return jsonError(cap.data?.mensagem || 'Não deu pra verificar captura em aberto — tente de novo', 400, req);
      if (String(cap.data.objeto.mensagem || '').includes('Cliente em captura')) return jsonError('Cliente já está em captura/análise na Crefisa', 400, req);
      // 2) matrícula (NIS) tem que validar
      const vMat = await apiCall(`/captura/validacao-dados-matricula/${cpf}`, 'POST', {
        CodigoOrgao: CONVENIO_CREFISA, CodigoMatricula: onlyDigits(body.matriculaRenda), DigitoMatricula: String(body.digito),
      });
      if (vMat.data?.erro || !vMat.data?.objeto?.valido) {
        return jsonError(`Matrícula recusada: ${vMat.data?.objeto?.observacao || vMat.data?.mensagem || 'confira NIS e dígito'}`, 400, req);
      }
      // 3) conta tem que validar
      const vConta = await apiCall(`/captura/validacao-dados-bancarios/${cpf}`, 'POST', {
        codigoBanco: parseInt(db.codigoBanco),
        codigoAgencia: parseInt(onlyDigits(db.agencia)),
        digitoAgencia: String(db.digitoAgencia ?? ''),
        codigoConta: onlyDigits(db.contaCorrente),
        digitoConta: String(db.digitoConta ?? '').toUpperCase(),
      });
      if (vConta._semSessao) return j({ etapa: 'SEM_SESSAO', approved: false, mensagem: vConta.data.error }, 200, req);
      if (vConta.data?.erro || !vConta.data?.objeto?.valido) {
        return jsonError(`Conta recusada pela Crefisa: ${vConta.data?.objeto?.observacao || vConta.data?.mensagem || 'dados bancários inválidos'} (Caixa Tem: informe a conta SEM a operação 1288)`, 400, req);
      }

      const model = {
        codigoParceiro: parseInt(body.codigoParceiro || sess.codigo_parceiro || cfg.CODIGO_PARCEIRO),
        codigoUsuarioParceiro,
        tipoOperacao: parseInt(body.tipoSimulacao || 1),
        cliente: {
          nomeCliente: String(c.nome).trim(),
          cpf,
          dataNascimento: String(c.dataNascimento),
          sexo: String(c.sexo),
          baseRG: onlyDigits(c.rg),
          digitoRG: String(c.digitoRg ?? ''),
          dataExpidacaoRG: String(c.dataEmissaoRg),
          orgaoEmissorRG: String(c.orgaoEmissorRg).toUpperCase(),
          ufrg: String(c.ufRg).toUpperCase(),
          ufNaturalidade: String(c.ufNascimento).toUpperCase(),
          descricaoNaturalidade: String(c.naturalidade).toUpperCase(),
          flagAutorizaSMS: c.autorizaSms === false ? 'N' : 'S',
          nomeMae: c.nomeMaeNadaConsta ? 'Nada consta' : String(c.nomeMae),
          nomePai: c.nomePaiNadaConsta || !c.nomePai ? 'Nada consta' : String(c.nomePai),
          escolaridade: String(c.escolaridade),
          estadoCivil: String(c.estadoCivil),
          flagPortadorDeficienciaVisual: String(c.escolaridade) === '6' ? 1 : 0,
          email: String(c.email || ''),
          codigoCanalDivulgacao: parseInt(c.canalDivulgacao) || 418, // 418 = CARTEIRA PROPRIA
        },
        endereco: {
          cep: parseInt(onlyDigits(e.cep)),
          uf: String(e.uf).toUpperCase(),
          cidade: String(e.cidade).toUpperCase(),
          bairro: String(e.bairro).substring(0, 35),
          logradouro: String(e.logradouro),
          numero: String(e.numero),
          complemento: e.complemento ? String(e.complemento) : '',
        },
        telefone: {
          ddd: parseInt(tel.slice(0, 2)),
          numeroTelefone: parseInt(tel.slice(2, 11)),
        },
        renda: {
          codigoOrgao: CONVENIO_CREFISA,
          codigoSubOrgao: String(dataPagamento || ''),
          codigoMatricula: String(body.matriculaRenda),
          digitoMatricula: String(body.digito),
          valorRenda: parseFloat(body.valorRenda),
          codigoEspecieBeneficio: 0, // só INSS usa espécie de benefício
        },
        dadosBancarios: {
          codigoBanco: parseInt(db.codigoBanco),
          codigoAgencia: parseInt(onlyDigits(db.agencia)),
          digitoAgencia: String(db.digitoAgencia ?? ''),
          codigoConta: onlyDigits(db.contaCorrente),
          digitoConta: String(db.digitoConta ?? ''),
        },
        operacao: {
          codigoCampanha: parseInt(op.codigoCampanha) || 0,
          valorPrincipal: parseFloat(op.valorPrincipal),
          valorParcela: parcela,
          quantidadeParcelas: parseInt(op.quantidadeParcelas),
          codigoContratoRefin: parseInt(op.codigoContratoRefin) || 0,
        },
        documentos: docs,
        isRefinRecorrenteCorban: body.isRefinRecorrenteCorban ? 1 : 0,
        isOpenFinanceObrigatorio: body.isOpenFinanceObrigatorio ? 1 : 0,
        isPortalTransparenciaDesatualizado: body.isPortalTransparenciaDesatualizado ? 1 : 0,
        vendedorId: parseInt(body.vendedorId || sess.vendedor_id || 0),
        guid: String(body.guid || crypto.randomUUID()),
        contratoId: 0,
        convenioId2tech: CONVENIO_ID_2TECH,
        preAnalise: 0,
        indicacaoProposta: 0,
        OpenFinance: body.openFinance || {
          possuiConsentimento: false, linkConsentimento: '', statusConsentimento: '', bancoCodigo: '', telefone: '',
        },
        docsObrigatorios: '',
        dataPrimeiraParcela: String(body.dataPrimeiraParcela || '').slice(0, 10),
      };

      const r = await apiCall(`/captura/incluir-proposta/${cpf}`, 'POST', model);
      if (r._semSessao) return j({ etapa: 'SEM_SESSAO', approved: false, mensagem: r.data.error }, 200, req);
      if (!r.ok || r.data?.erro) {
        return j({
          etapa: 'ERRO',
          approved: false,
          success: false,
          retryable: r.status >= 500 || r.status === 429,
          httpStatus: r.status,
          mensagem: r.data?.mensagem || `Erro ao digitar (HTTP ${r.status})`,
          _raw: r.data,
        }, 200, req);
      }
      return j({
        etapa: 'DIGITADA',
        approved: true,
        success: true,
        mensagem: r.data?.mensagem || '✅ Proposta digitada na Crefisa',
        guid: model.guid,
        proposta: r.data?.objeto ?? null,
        _raw: r.data,
      }, 200, req);
    }

    // ── Fluxo guiado: 1 chamada → diz exatamente o próximo passo ──
    if (action === 'fluxo') {
      const cliente = await apiCall(`/captura/operacao-cliente/${cpf}?tipo=0`, 'GET');
      if (cliente._semSessao) {
        return j({ etapa: 'SEM_SESSAO', approved: false, mensagem: cliente.data.error, proximoPasso: 'Recolar a sessão do portal' }, 200, req);
      }
      const o = cliente.data?.objeto || {};
      if (o.permiteCaptura === false) {
        return j({
          etapa: 'BLOQUEADO',
          approved: false,
          success: true,
          cpf,
          mensagem: o.mensagem || 'Cliente não permite captura',
          proximoPasso: 'Nada a fazer — a Crefisa bloqueou este CPF',
          _raw: cliente.data,
        }, 200, req);
      }

      const ben = classificarBeneficio(await apiCall(`/captura/consulta-beneficio/${cpf}`, 'GET'));
      const proximoPasso = {
        ELEGIVEL: 'Simular a operação',
        AGUARDA_OPENFINANCE: 'Mandar o link de Open Finance pro cliente autorizar',
        NAO_ELEGIVEL: 'Nada a fazer — não é beneficiário Bolsa Família ativo',
        SEM_RETORNO: 'Conferir o CPF ou tentar de novo mais tarde',
        SEM_SESSAO: 'Recolar a sessão do portal',
      }[ben.etapa] || 'Conferir manualmente no portal';

      return j({
        success: true,
        cpf,
        clienteNovo: o.clienteNovo ?? null,
        permiteCaptura: o.permiteCaptura ?? null,
        perfilProposta: o.perfilProposta || [],
        ...ben,
        proximoPasso,
        regras: REGRAS_BR,
      }, 200, req);
    }

    // ── Debug: bate em qualquer rota sem precisar de deploy ────
    if (action === 'rawCall') {
      if (!body.path || !String(body.path).startsWith('/')) return jsonError('path obrigatorio (comeca com /)', 400, req);
      const r = await apiCall(body.path, body.method || 'GET', body.payload ?? null);
      return j({ success: r.ok, httpStatus: r.status, data: r.data }, 200, req);
    }

    if (action === 'rawAsp') {
      if (!body.combo) return jsonError('combo obrigatorio', 400, req);
      const r = await aspCall({ combo: body.combo, ...(body.params || {}) });
      return j({ success: r.ok, httpStatus: r.status, data: r.data }, 200, req);
    }

    return jsonError('Action invalida. Validas: test, regras, setPortalSession, statusPortalSession, consultarCliente, consultarBeneficio, enviarLinkOpenFinance, statusOpenFinance, refinanciaveis, simular, validarMatricula, validarDadosBancarios, buscarCep, uploadDocumento, digitar, fluxo, rawCall, rawAsp', 400, req);
  } catch (e) {
    return jsonError('Erro Crefisa BR: ' + e.message, 500, req);
  }
}
