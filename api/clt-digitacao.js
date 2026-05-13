// ══════════════════════════════════════════════════════════════════
// api/clt-digitacao.js — Orquestrador de digitação CLT (4 bancos)
//
// Recebe dados completos do cliente + escolha de oferta → chama API
// correta do banco escolhido + grava em clt_propostas (esteira).
//
// Bancos suportados:
//  - c6           → action 'incluir'
//  - presencabank → action 'criarProposta'
//  - joinbank     → action 'cltSelectCondition' + 'cltCreateLoans'
//  - v8           → action 'criarOperacao'
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';
import { dbInsert } from './_lib/supabase.js';

const APP_URL = () => process.env.APP_URL || 'https://flowforce.vercel.app';

async function callApi(path, payload, authHeader) {
  const opts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
    body: JSON.stringify(payload)
  };
  try {
    const r = await fetch(APP_URL() + path, opts);
    const t = await r.text();
    let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 500) }; }
    return { ok: r.ok, status: r.status, data: d };
  } catch (e) {
    return { ok: false, status: 0, data: { error: e.message } };
  }
}

function normalizeCPF(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d || d.length > 11 || d.length < 9) return null;
  return d.padStart(11, '0');
}

// ── Define quais campos cada banco exige ───────────────────────
const CAMPOS_OBRIGATORIOS = {
  c6: {
    cliente: ['cpf', 'telefone', 'ddd'],
    endereco: ['cep', 'logradouro', 'numero', 'bairro', 'cidade', 'uf'],
    bancario: ['numeroBanco', 'numeroAgencia', 'numeroConta', 'digitoConta'],
    proposta: ['idSimulacao']
  },
  presencabank: {
    cliente: ['cpf', 'nome', 'telefone', 'ddd', 'dataNascimento', 'email'],
    endereco: ['cep', 'logradouro', 'numero', 'bairro', 'cidade', 'uf'],
    bancario: ['formaCredito'], // PIX ou conta
    empregador: ['cnpj', 'matricula', 'valorRenda'],
    proposta: ['idSimulacao', 'type', 'tabelaId', 'quantidadeParcelas', 'valorParcela']
  },
  joinbank: {
    cliente: ['cpf', 'nome', 'telefone'],
    proposta: ['simulationId']
  },
  v8: {
    cliente: ['cpf', 'nome', 'telefone', 'email', 'dataNascimento', 'sexo', 'nomeMae'],
    endereco: ['cep', 'rua', 'numero', 'bairro', 'cidade', 'uf'],
    bancario: ['pixKey', 'pixKeyType'],
    proposta: ['simulationId']
  }
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  const user = await requireAuth(req);
  if (user instanceof Response) return user;

  try {
    const body = req.method === 'POST' ? await req.json() : {};
    const action = body.action || '';
    const auth = req.headers.get('Authorization') || '';

    // ─── getCamposObrigatorios (frontend usa pra montar form) ──
    if (action === 'getCamposObrigatorios') {
      if (!body.banco || !CAMPOS_OBRIGATORIOS[body.banco]) {
        return jsonError('banco invalido', 400, req);
      }
      return jsonResp({ success: true, banco: body.banco, campos: CAMPOS_OBRIGATORIOS[body.banco] }, 200, req);
    }

    // ─── DIGITAR proposta no banco escolhido + gravar na esteira ─
    if (action === 'digitar') {
      const banco = body.banco;
      if (!banco || !CAMPOS_OBRIGATORIOS[banco]) return jsonError('banco invalido', 400, req);

      const cpf = normalizeCPF(body.cliente?.cpf);
      if (!cpf) return jsonError('cpf invalido', 400, req);

      const cliente = body.cliente || {};
      const endereco = body.endereco || {};
      const bancario = body.bancario || {};
      const empregador = body.empregador || {};
      const proposta = body.proposta || {};

      // Monta payload específico de cada banco
      let result;

      if (banco === 'c6') {
        const payload = {
          action: 'incluir',
          idSimulacao: proposta.idSimulacao,
          cpf, ddd: cliente.ddd,
          telefone: cliente.telefone,
          logradouro: endereco.logradouro,
          numero: endereco.numero,
          cep: endereco.cep,
          bairro: endereco.bairro,
          cidade: endereco.cidade,
          uf: endereco.uf,
          numeroBanco: bancario.numeroBanco,
          numeroAgencia: bancario.numeroAgencia,
          digitoAgencia: bancario.digitoAgencia || '',
          numeroConta: bancario.numeroConta,
          digitoConta: bancario.digitoConta,
          tipoConta: bancario.tipoConta || 'ContaCorrenteIndividual'
        };
        result = await callApi('/api/c6', payload, auth);
      }

      else if (banco === 'presencabank') {
        const payload = {
          action: 'criarProposta',
          type: proposta.type, // obtido na tabela do consultarTabelas
          tabelaId: proposta.tabelaId,
          idSimulacao: proposta.idSimulacao, // não usado na PB (mantido por compat)
          quantidadeParcelas: proposta.quantidadeParcelas,
          valorParcela: proposta.valorParcela,
          cpf, nome: cliente.nome,
          ddd: cliente.ddd,
          telefone: cliente.telefone,
          dataNascimento: cliente.dataNascimento,
          email: cliente.email,
          sexo: cliente.sexo || 'M',
          nomeMae: cliente.nomeMae || '',
          cnpj: empregador.cnpj,
          matricula: empregador.matricula,
          valorRenda: empregador.valorRenda,
          cep: endereco.cep,
          logradouro: endereco.logradouro,
          numero: endereco.numero,
          complemento: endereco.complemento || '',
          bairro: endereco.bairro,
          cidade: endereco.cidade,
          uf: endereco.uf,
          formaCredito: bancario.formaCredito || '2', // 1=poupança, 2=corrente, 3=pix
          agencia: bancario.numeroAgencia,
          conta: bancario.numeroConta,
          digitoConta: bancario.digitoConta,
          chavePix: bancario.chavePix,
          tipoChavePixId: bancario.tipoChavePixId
        };
        result = await callApi('/api/presencabank', payload, auth);
      }

      else if (banco === 'joinbank') {
        // JoinBank: select condition + create loans
        const sel = await callApi('/api/joinbank', {
          action: 'cltSelectCondition',
          simulationId: proposta.simulationId,
          items: proposta.items
        }, auth);
        if (!sel.ok) {
          return jsonResp({ success: false, etapa: 'cltSelectCondition', _raw: sel.data }, 200, req);
        }
        result = await callApi('/api/joinbank', {
          action: 'cltCreateLoans',
          simulationId: proposta.simulationId
        }, auth);
      }

      else if (banco === 'v8') {
        const tel = String(cliente.telefone || '').replace(/\D/g, '');
        const payload = {
          action: 'criarOperacao',
          provider: proposta.provider || 'QI', // QI ou CELCOIN
          simulationId: proposta.simulationId,
          cpf, nome: cliente.nome,
          email: cliente.email,
          telefone: tel,
          dataNascimento: cliente.dataNascimento,
          sexo: cliente.sexo,
          nomeMae: cliente.nomeMae,
          maritalStatus: cliente.estadoCivil || 'single',
          documentType: cliente.tipoDoc || 'rg',
          documentIdentificationNumber: cliente.docNumero || '000000',
          documentIdentificationDate: cliente.docDataExp || '2020-01-01',
          documentIssuer: cliente.docOrgaoEmissor || 'SSP',
          nationality: 'brazilian',
          pep: cliente.pep === true,
          address: {
            street: endereco.rua || endereco.logradouro,
            number: endereco.numero,
            complement: endereco.complemento || '',
            neighborhood: endereco.bairro,
            city: endereco.cidade,
            state: endereco.uf,
            postalCode: endereco.cep
          },
          pixKey: bancario.pixKey || cpf,
          pixKeyType: bancario.pixKeyType || 'cpf'
        };
        result = await callApi('/api/v8', payload, auth);
      }

      else if (banco === 'mercantil') {
        // Mercantil: ainda nao tem fluxo completo de criar proposta via API
        // (precisa endpoints de simular tabela + criar proposta capturados via DevTools).
        // Por enquanto retorna info do operacaoId pra operador continuar manualmente
        // no portal usando esses dados.
        result = {
          ok: false,
          status: 501,
          data: {
            erro: 'Mercantil ainda em modo manual — abra o portal pra simular tabela e criar proposta. Endpoints de simular/criar via API ainda nao capturados.',
            portalUrl: 'https://meu.bancomercantil.com.br/login',
            operacaoId: proposta.operacaoId || null
          }
        };
      }

      else if (banco === 'handbank') {
        // Handbank/UY3: sem endpoint de criarProposta documentado na API
        // atual. Operador finaliza digitação no portal Handbank usando
        // os dados do cliente que ja foram coletados aqui.
        result = {
          ok: false,
          status: 501,
          data: {
            erro: 'Handbank/UY3 ainda em modo manual — finalize a digitação no portal Handbank com os dados já coletados. Pra automatizar, precisamos do manual da API Handbank (endpoint criarProposta UY3).',
            portalUrl: 'https://app.handbank.com.br/',
            empregadorCnpj: empregador.cnpj || null,
            matricula: empregador.matricula || null
          }
        };
      }

      else if (banco === 'fintech_qi' || banco === 'fintech_celcoin') {
        // Fintech do Corban: cria proposta via /Api/V1/Operation/Online-Hiring-Private-Credit
        const provider = banco === 'fintech_celcoin' ? 'celcoin' : 'qi';
        // Payload livre — Fintech aceita objeto com dados do cliente + proposta
        const tel = String(cliente.telefone || '').replace(/\D/g, '');
        const payload = {
          action: 'criarOperacao',
          provider,
          payload: {
            workerId: proposta.workerId || null,
            cpfCliente: cpf,
            cliente: {
              cpf, nome: cliente.nome,
              email: cliente.email,
              telefone: tel,
              ddd: cliente.ddd,
              dataNascimento: cliente.dataNascimento,
              genero: (cliente.sexo || 'M').toUpperCase().charAt(0),
              nomeMae: cliente.nomeMae,
              estadoCivil: cliente.estadoCivil || 'solteiro'
            },
            endereco: {
              cep: endereco.cep,
              logradouro: endereco.logradouro || endereco.rua,
              numero: endereco.numero,
              complemento: endereco.complemento || '',
              bairro: endereco.bairro,
              cidade: endereco.cidade,
              uf: endereco.uf
            },
            empregador: {
              cnpj: empregador.cnpj,
              matricula: empregador.matricula,
              valorRenda: empregador.valorRenda
            },
            dadosBancarios: {
              pixKey: bancario.pixKey || cpf,
              pixKeyType: bancario.pixKeyType || 'cpf',
              banco: bancario.numeroBanco,
              agencia: bancario.numeroAgencia,
              conta: bancario.numeroConta,
              digitoConta: bancario.digitoConta,
              formaCredito: bancario.formaCredito || 'pix'
            },
            simulacao: {
              idSimulacao: proposta.idSimulacao || proposta.simulationId || null,
              tabela: proposta.tabelaId || null,
              valorLiquido: proposta.valorLiquido,
              parcelas: proposta.parcelas,
              valorParcela: proposta.valorParcela
            }
          }
        };
        result = await callApi('/api/fintechdocorban', payload, auth);
      }

      else {
        // Banco nao suportado — retorna erro claro em vez de result undefined
        return jsonResp({
          success: false,
          banco,
          erro: `Banco '${banco}' nao suportado pra digitacao automatica. Bancos suportados: c6, presencabank, joinbank, v8, mercantil, handbank, fintech_qi, fintech_celcoin.`,
          dica: 'Use o botao de digitacao manual no portal proprio do banco.'
        }, 400, req);
      }

      // Extrai info comum do response
      const r = result.data || {};
      const ok = result.ok && (r.propostaNumero || r.operationId || r.propostaId || r.signature || r.id);
      const propostaIdExterno = r.propostaNumero || r.operationId || r.propostaId || r.id || null;
      const linkFormalizacao = r.formalizationUrl || r.url || r.link || r.linkFormalizacao || null;

      // Grava na esteira (sempre, mesmo se falhou — pra debug)
      const linhaEsteira = {
        banco,
        proposta_id_externo: propostaIdExterno ? String(propostaIdExterno) : null,
        externo_simulation_id: proposta.idSimulacao || proposta.simulationId || null,
        externo_consult_id: proposta.consultId || null,
        cpf,
        nome: cliente.nome || null,
        telefone: cliente.telefone ? String(cliente.telefone).replace(/\D/g,'') : null,
        email: cliente.email || null,
        data_nascimento: cliente.dataNascimento || null,
        nome_mae: cliente.nomeMae || null,
        empregador_cnpj: empregador.cnpj || null,
        empregador_nome: empregador.nome || null,
        matricula: empregador.matricula || null,
        renda: empregador.valorRenda || null,
        valor_solicitado: proposta.valorSolicitado || null,
        valor_liquido: proposta.valorLiquido || proposta.valorParcela ? null : null,
        valor_parcela: proposta.valorParcela || null,
        qtd_parcelas: proposta.quantidadeParcelas || proposta.qtdParcelas || null,
        taxa_mensal: proposta.taxaMensal || null,
        status_externo: ok ? 'criada' : 'erro',
        status_interno: ok ? (linkFormalizacao ? 'aguardando_assinatura' : 'criada') : 'rejeitada',
        link_formalizacao: linkFormalizacao,
        contract_number: r.contract_number || r.contractNumber || null,
        criada_por_user_id: user.id,
        conversa_id: body.conversaId || null,
        origem: body.origem || 'consulta_unitaria',
        vendedor_nome: user.nome_vendedor || null,
        parceiro_nome: user.nome_parceiro || null,
        webhook_ultimo: r
      };

      const ins = await dbInsert('clt_propostas', linhaEsteira);

      return jsonResp({
        success: ok,
        banco,
        propostaIdExterno,
        linkFormalizacao,
        propostaEsteira: ins.data || null,
        mensagem: ok
          ? `Proposta criada no ${banco.toUpperCase()}! ${linkFormalizacao ? 'Envie o link de formalização ao cliente.' : ''}`
          : 'Falha ao digitar proposta. Veja _raw pra detalhes.',
        _raw: r
      }, 200, req);
    }

    return jsonError('action invalida. Disponiveis: getCamposObrigatorios, digitar', 400, req);

  } catch (err) {
    console.error('clt-digitacao erro:', err);
    return jsonResp({ error: 'Erro interno', message: err.message }, 500, req);
  }
}
