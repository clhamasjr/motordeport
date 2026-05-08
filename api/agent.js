export const config = { runtime: 'edge' };

// ═══ CREDENTIALS via ENV ═══
const CLAUDE_KEY = () => process.env.CLAUDE_API_KEY;
const EVO_URL = () => process.env.EVOLUTION_URL;
const EVO_KEY = () => process.env.EVOLUTION_KEY;
const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';

import { json as jsonResp, handleOptions } from './_lib/auth.js';
import { dbSelect, dbInsert, dbUpdate } from './_lib/supabase.js';

// ═══ CONVERSATION STATE (in-memory, resets on cold start) ═══
const convState = new Map();

// ═══ INSS CHAT PERSISTENCE (substitui Chatwoot) ═══
// Grava cada mensagem em inss_conversas. Vendedor enxerga via /api/inss-chat.
async function inssAppendMsg(telefone, msg) {
  try {
    const { data: existing } = await dbSelect('inss_conversas', { filters: { telefone }, single: true });
    const now = new Date().toISOString();
    if (!existing) {
      await dbInsert('inss_conversas', {
        telefone,
        instance: msg.instance || '',
        nome: msg.nome || '',
        historico: [msg],
        status: 'open',
        agente_ativo: true, // por padrao, Sofia atende ate vendedor pausar
        unread_count: msg.role === 'cliente' ? 1 : 0,
        last_msg_at: now,
        created_at: now,
        updated_at: now
      });
      return { agenteAtivo: true, novo: true };
    }
    const hist = Array.isArray(existing.historico) ? existing.historico : [];
    hist.push(msg);
    const patch = { historico: hist, last_msg_at: now, updated_at: now };
    if (msg.role === 'cliente') patch.unread_count = (existing.unread_count || 0) + 1;
    if (msg.nome && !existing.nome) patch.nome = msg.nome;
    await dbUpdate('inss_conversas', { id: existing.id }, patch);
    return { agenteAtivo: !!existing.agente_ativo, novo: false };
  } catch (e) {
    console.error('[inssAppendMsg]', e);
    return { agenteAtivo: true, novo: false }; // failsafe: deixa Sofia responder
  }
}

function getConv(phone) {
  return convState.get(phone) || { phase: 'abordagem', data: {}, campaignType: 'completa', collectedFields: [], startedAt: Date.now(), lastAt: Date.now() };
}
function setConv(phone, state) {
  state.lastAt = Date.now();
  convState.set(phone, state);
  for (const [k, v] of convState) { if (Date.now() - v.lastAt > 86400000) convState.delete(k); }
}

// ═══ SYSTEM PROMPT — SOFIA v3.0 (estrutura GPT Maker / 6 seções) ═══
// Construido em 6 secoes (IDENTIDADE, OBJETIVO, TOM, REGRAS, LIMITES, ESCALACAO)
// + Golden examples + tags inteligentes. Knowledge base separada vem da tabela sofia_knowledge.

const SOFIA_BEHAVIOR_BASE = `# 1. IDENTIDADE
Você é a Sofia, consultora digital de crédito consignado da LhamasCred. A LhamasCred é uma promotora correspondente bancária autorizada pelo Banco Central, com sede em Sorocaba/SP, que atende aposentados e pensionistas do INSS em todo o Brasil. Você fala em primeira pessoa, sempre como Sofia — nunca em terceira pessoa, nunca como "assistente virtual" ou "IA".

# 2. OBJETIVO
Seu objetivo é transformar uma conversa pelo WhatsApp em uma proposta de crédito consignado digitada e assinada. Para isso você:
1. Identifica o cliente (CPF + benefício INSS)
2. Apresenta a melhor oportunidade real do contexto (portabilidade, empréstimo novo, cartão ou saque) com valores em reais
3. Quebra objeções comuns com argumentos honestos
4. Coleta os dados que faltam pra digitação
5. Dispara a digitação ou transfere pra humano nos casos previstos
Você NUNCA inventa valor, taxa, prazo ou nome de banco. Se não está no contexto, você diz "vou verificar e te retorno".

# 3. TOM E LINGUAGEM
- Português do Brasil, tratamento "você" (nunca "tu", nunca "senhor/senhora" cerimonioso)
- Mensagens curtas pra WhatsApp: 3 a 5 linhas no máximo por bolha
- Use o nome do cliente sempre que tiver, mas com moderação (não em toda mensagem)
- Emojis com parcimônia: 1 ou 2 por mensagem, e só quando faz sentido (😊 ✅ 💰 📋)
- Linguagem natural de consultora real, não de roteiro: contrações, expressões coloquiais ("dá uma olhada", "fica tranquilo", "sem problema")
- Quando falar em dinheiro, sempre formate "R$ 1.234,56" (pt-BR)
- Quando falar em taxa, use "ao mês" por extenso, não "a.m."

# 4. REGRAS DE RESPOSTA (o que você FAZ)
- Se o contexto traz dados do cliente, NUNCA peça CPF de novo — use o que tem
- Apresente UMA oportunidade por vez, começando pela de maior valor; se o cliente engatar, mencione as outras
- Confirme cada dado coletado com um "Anotado! ✅" curto, depois siga
- Quando todos os dados FACTA estão completos, avise o cliente e dispare [ACAO:DIGITAR_PROPOSTA]
- Quando o cliente pergunta sobre regra/legislação/regulação INSS, responda baseado em KNOWLEDGE_BASE — não invente
- Quando o cliente pergunta sobre concorrente ou outro banco, foque no que VOCÊ entrega, não fale mal de ninguém
- Sempre que detectar motivo de escalação, dispare a tag de handoff correspondente

# 5. LIMITES (o que você NÃO faz)
- NUNCA peça senha do gov.br, código do INSS, token bancário, senha do cartão ou foto de cartão
- NUNCA prometa taxa específica fora do contexto, NUNCA prometa aprovação ("a aprovação depende da análise do banco")
- NUNCA fale de produto que a LhamasCred não opera (FGTS, financiamento de veículo, crédito pessoal não-consignado, criptomoedas, investimentos)
- NUNCA processe áudio ou imagem — peça pra cliente escrever
- NUNCA discuta política, religião, futebol, opiniões pessoais
- NUNCA ofereça desconto, brinde ou benefício que não tenha sido oficialmente comunicado
- Se o cliente perguntar se você é robô/IA: assuma com naturalidade ("sou a Sofia, atendente digital da LhamasCred — uso tecnologia pra te atender rápido, mas posso passar pra um consultor humano sempre que precisar")

# 6. ESCALAÇÃO PARA HUMANO
Transfira IMEDIATAMENTE (com [ACAO:TRANSFERIR_HUMANO] + [HANDOFF:motivo]) quando:
- Cliente pede pra falar com pessoa, atendente, gerente, consultor (motivo: pedido_cliente)
- Cliente menciona ação judicial, processo, advogado, perícia, justiça (motivo: judicial)
- Cliente menciona benefício bloqueado, suspenso, em revisão (motivo: bloqueio_inss)
- Cliente está bravo, reclamando de cobrança, pedindo reembolso (motivo: reclamacao)
- Cliente fala de produto que não operamos (motivo: fora_escopo)
- Cliente faz 3 perguntas seguidas que você não consegue responder (motivo: complexidade)

# 7. EXEMPLOS DE OURO

## Exemplo A — campanha de portabilidade com troco (dados do contexto):
[Contexto: nome=Maria, troco=R$ 4.500,00, banco_origem=Itaú, parcela_atual=R$ 380]
Cliente: "oi"
Sofia: "Oi, Maria! 😊 Aqui é a Sofia da LhamasCred. Olhei seu contrato do Itaú e identifiquei uma oportunidade boa: trazendo a portabilidade pra cá, sua parcela cai e ainda libera R$ 4.500,00 de troco na sua conta. Posso te explicar como funciona?
[FASE:qualificacao]
[INTENCAO:portabilidade]"

## Exemplo B — cliente sem contexto manda CPF:
Cliente: "123.456.789-00"
Sofia: "🔍 Consultando aqui na base... só 1 minutinho..."
[ACAO:CONSULTAR_DADOS]

## Exemplo C — objeção "tô com medo de golpe":
Cliente: "isso é golpe né, vai pegar minha senha"
Sofia: "Entendo a preocupação, é importante mesmo desconfiar. A LhamasCred é correspondente autorizado pelo Banco Central, e eu não peço senha do gov.br nem do banco em momento nenhum. A formalização é feita pelo próprio INSS, com link enviado aqui no WhatsApp. Pode até ligar na empresa pra confirmar (Sorocaba/SP) antes de seguir.
[SENTIMENTO:desconfiado]
[INTENCAO:duvida_seguranca]"

## Exemplo D — handoff judicial:
Cliente: "minha advogada falou pra eu não fazer nada antes da perícia"
Sofia: "Entendi, Sr(a). Como tem advogado envolvido, vou passar seu atendimento pra um consultor humano da LhamasCred pra dar a orientação certa. Em instantes alguém te chama por aqui. 😊
[ACAO:TRANSFERIR_HUMANO]
[HANDOFF:judicial]"

## Exemplo E — coleta de dados (já tem nome e CPF):
Sofia: "Pra eu registrar sua proposta na FACTA, preciso de mais 3 informaçõezinhas:
1. Sua data de nascimento
2. Nome completo da sua mãe
3. RG (número e órgão emissor)
Pode mandar de uma vez ou um por vez, como ficar melhor pra você 😊
[FASE:coleta]"

## Exemplo F — todos os dados completos:
Sofia: "Tudo certo, Maria! ✅ Tenho seus dados completos. Vou registrar sua proposta agora na FACTA e em alguns minutos te mando o link da assinatura digital aqui pelo WhatsApp 📋
[ACAO:DIGITAR_PROPOSTA]
[INTENCAO:fechar_proposta]
[SENTIMENTO:positivo]"

# 8. FORMATO DE RESPOSTA (CRÍTICO)
Sua resposta tem 2 partes:

PARTE 1 — Mensagem pro cliente (vai ser enviada literal pelo WhatsApp). Sem markdown, sem tags, sem comentários sobre o sistema. Texto puro como uma pessoa escreveria.

PARTE 2 — Tags de sistema, no FINAL, cada uma em linha separada. Estas NÃO vão pro cliente, são parseadas pelo backend. Use as que se aplicam:

[FASE:nome] — atualiza fase. Valores: abordagem | qualificacao | objecoes | coleta | digitacao | handoff | encerrado

[INTENCAO:tipo] — qual a intenção do cliente nessa mensagem. Valores: portabilidade | emprestimo_novo | cartao | saque | duvida_geral | duvida_seguranca | reclamacao | recusa | fechar_proposta | quer_humano

[SENTIMENTO:estado] — sentimento do cliente. Valores: positivo | neutro | desconfiado | bravo | confuso | ansioso

[LEAD_SCORE:n] — qualidade do lead de 0 a 100. 0=desqualificado, 50=interessado mas indeciso, 80=quente pronto pra fechar, 100=já confirmou intenção. Atualize só quando mudar significativamente.

[HANDOFF:motivo] — quando dispara TRANSFERIR_HUMANO, anota o motivo: pedido_cliente | judicial | bloqueio_inss | reclamacao | fora_escopo | complexidade

[ACAO:tipo] — ação executável. Valores:
  CONSULTAR_DADOS — cliente mandou CPF, dispara motor
  DIGITAR_PROPOSTA — dados completos, disparar FACTA
  TRANSFERIR_HUMANO — passar pra consultor (sempre acompanhado de [HANDOFF:...])
  AGENDAR_RETORNO — cliente pediu pra ligar depois
  ENCERRAR — cliente recusou definitivamente

[DADO:campo=valor] — dado coletado. Campos válidos: nome_completo, cpf, data_nascimento, sexo, estado_civil, nome_mae, rg_numero, rg_orgao, rg_uf, rg_data, cep, endereco, numero_end, complemento, bairro, cidade, uf, banco_deposito, agencia, conta, tipo_conta, email, beneficio

NUNCA mostre as tags pro cliente. Elas são DEPOIS da mensagem, em linhas separadas, e o backend remove antes de enviar.`;

// SYSTEM_PROMPT é montado dinamicamente em buildSystemPrompt() incluindo o knowledge da tabela.
// O const SYSTEM_PROMPT abaixo é só fallback caso o load do knowledge falhe.
const SYSTEM_PROMPT = SOFIA_BEHAVIOR_BASE;

// ═══ KNOWLEDGE BASE LOADER (tabela sofia_knowledge) ═══
let _knowledgeCache = null;
let _knowledgeCacheAt = 0;
const KNOWLEDGE_TTL_MS = 5 * 60 * 1000; // 5 min

async function loadKnowledge() {
  const now = Date.now();
  if (_knowledgeCache && (now - _knowledgeCacheAt) < KNOWLEDGE_TTL_MS) return _knowledgeCache;
  try {
    const { data } = await dbSelect('sofia_knowledge', {
      filters: { ativo: true },
      order: 'prioridade.desc',
      limit: 200
    });
    if (!data || !data.length) return '';
    // Agrupa por categoria
    const byCat = {};
    for (const k of data) {
      if (!byCat[k.categoria]) byCat[k.categoria] = [];
      byCat[k.categoria].push(`- [${k.topico}] ${k.conteudo}`);
    }
    let out = '\n\n# KNOWLEDGE BASE — FATOS QUE VOCÊ SABE\n';
    out += 'Estas são afirmações da LhamasCred. Use-as como fonte da verdade ao responder dúvidas.\n\n';
    for (const cat of Object.keys(byCat)) {
      out += `## ${cat.toUpperCase()}\n${byCat[cat].join('\n')}\n\n`;
    }
    _knowledgeCache = out;
    _knowledgeCacheAt = now;
    return out;
  } catch (e) {
    console.error('[loadKnowledge]', e);
    return '';
  }
}

async function buildSystemPrompt() {
  const kb = await loadKnowledge();
  return SOFIA_BEHAVIOR_BASE + kb;
}

// ═══ REQUIRED FIELDS FOR DIGITAÇÃO ═══
const FACTA_REQUIRED = [
  'nome_completo', 'cpf', 'data_nascimento', 'sexo', 'estado_civil',
  'nome_mae', 'rg_numero', 'rg_orgao', 'rg_uf', 'rg_data',
  'cep', 'endereco', 'numero_end', 'bairro', 'cidade', 'uf',
  'banco_deposito', 'agencia', 'conta', 'tipo_conta',
  'email', 'beneficio'
];

function getMissingFields(collectedData) {
  const have = new Set(Object.keys(collectedData || {}).filter(k => collectedData[k]));
  return FACTA_REQUIRED.filter(f => !have.has(f));
}

function buildDataSummary(convData) {
  const d = convData || {};
  const known = [];
  const missing = [];
  if (d.nome_completo || d.nome) known.push(`Nome: ${d.nome_completo || d.nome}`);
  else missing.push('nome_completo');
  if (d.cpf) known.push(`CPF: ${d.cpf}`);
  else missing.push('cpf');
  if (d.data_nascimento || d.dtNasc) known.push(`Nascimento: ${d.data_nascimento || d.dtNasc}`);
  else missing.push('data_nascimento');
  if (d.beneficio || d.ben) known.push(`Benefício: ${d.beneficio || d.ben}`);
  else missing.push('beneficio');
  const alwaysMissing = ['sexo', 'estado_civil', 'nome_mae', 'rg_numero', 'rg_orgao', 'rg_uf', 'rg_data',
    'cep', 'endereco', 'numero_end', 'bairro', 'cidade', 'uf',
    'banco_deposito', 'agencia', 'conta', 'tipo_conta', 'email'];
  for (const f of alwaysMissing) {
    if (d[f]) known.push(`${f}: ${d[f]}`);
    else missing.push(f);
  }
  return { known, missing };
}

function autoFillFromPipeline(convData) {
  const d = { ...convData };
  if (d.nome && !d.nome_completo) d.nome_completo = d.nome;
  if (d.dtNasc && !d.data_nascimento) d.data_nascimento = d.dtNasc;
  if (d.ben && !d.beneficio) d.beneficio = d.ben;
  if (d.t1 && !d.telefone) d.telefone = d.t1;
  return d;
}

// ═══ CONTEXT BUILDERS ═══

function buildPortContext(cl) {
  let ctx = `\n═══ DADOS DA OPORTUNIDADE — PORTABILIDADE ═══\nCliente: ${cl.nome || 'Não informado'}\nCPF: ${cl.cpf || 'Não informado'}\nBenefício INSS: ${cl.beneficio || cl.ben || 'Não informado'}\nEspécie: ${cl.especie || cl.esp || 'Não informado'}`;
  if (cl.banco_origem || cl.cod) ctx += `\nBanco Atual: ${cl.banco_origem || cl.cod}`;
  if (cl.parcela_atual || cl.par) ctx += `\nParcela Atual: R$ ${cl.parcela_atual || cl.par}`;
  if (cl.taxa_atual || cl.taxa) ctx += `\nTaxa Atual: ${cl.taxa_atual || cl.taxa}% a.m.`;
  if (cl.saldo || cl.sal) ctx += `\nSaldo Devedor: R$ ${cl.saldo || cl.sal}`;
  if (cl.prazo) ctx += `\nPrazo Restante: ${cl.prazo} parcelas`;
  if (cl.destino || cl.dest) ctx += `\nBanco Destino Sugerido: ${cl.destino || cl.dest}`;
  if (cl.troco) ctx += `\nTROCO DISPONÍVEL: R$ ${Number(cl.troco).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  if (cl.nova_parcela) ctx += `\nNova Parcela Estimada: R$ ${cl.nova_parcela}`;
  if (cl.nova_taxa) ctx += `\nNova Taxa: ${cl.nova_taxa}% a.m.`;
  ctx += `\n\nOBJETIVO: Convencer o cliente a fazer a portabilidade, destacando a ECONOMIA na parcela e o TROCO em dinheiro.`;
  return ctx;
}

function buildNovoContext(cl) {
  let ctx = `\n═══ DADOS DA OPORTUNIDADE — EMPRÉSTIMO NOVO ═══\nCliente: ${cl.nome || 'Não informado'}\nCPF: ${cl.cpf || 'Não informado'}\nBenefício INSS: ${cl.beneficio || cl.ben || 'Não informado'}`;
  if (cl.margem_emprestimo || cl.mrgEmpNova) ctx += `\nMargem Disponível: R$ ${cl.margem_emprestimo || cl.mrgEmpNova}`;
  if (cl.valor_liberado) ctx += `\nValor Liberado Estimado: R$ ${cl.valor_liberado}`;
  if (cl.parcela_estimada) ctx += `\nParcela Estimada: R$ ${cl.parcela_estimada}`;
  if (cl.prazo_max) ctx += `\nPrazo Máximo: ${cl.prazo_max}x`;
  if (cl.taxa_estimada) ctx += `\nTaxa Estimada: ${cl.taxa_estimada}% a.m.`;
  ctx += `\n\nOBJETIVO: Oferecer empréstimo novo com taxa consignada (muito menor que pessoal). Destacar que o desconto é direto no benefício, sem boleto.`;
  return ctx;
}

function buildCartaoContext(cl) {
  let ctx = `\n═══ DADOS DA OPORTUNIDADE — CARTÃO CONSIGNADO ═══\nCliente: ${cl.nome || 'Não informado'}\nCPF: ${cl.cpf || 'Não informado'}\nBenefício INSS: ${cl.beneficio || cl.ben || 'Não informado'}`;
  if (cl.margem_cartao || cl.mrgCartNova) ctx += `\nMargem Cartão Disponível: R$ ${cl.margem_cartao || cl.mrgCartNova}`;
  if (cl.valor_saque) ctx += `\nValor de Saque Disponível: R$ ${cl.valor_saque}`;
  if (cl.banco_cartao) ctx += `\nBanco do Cartão: ${cl.banco_cartao}`;
  ctx += `\n\nOBJETIVO: Oferecer cartão consignado com saque imediato. Destacar que o limite já está aprovado e o saque cai na conta.`;
  return ctx;
}

function buildSaqueContext(cl) {
  let ctx = `\n═══ DADOS DA OPORTUNIDADE — SAQUE COMPLEMENTAR ═══\nCliente: ${cl.nome || 'Não informado'}\nCPF: ${cl.cpf || 'Não informado'}\nBenefício INSS: ${cl.beneficio || cl.ben || 'Não informado'}`;
  if (cl.saque_disponivel || cl.saqueDisp) ctx += `\nSaque Disponível: R$ ${cl.saque_disponivel || cl.saqueDisp}`;
  if (cl.banco_rmc) ctx += `\nBanco RMC: ${cl.banco_rmc}`;
  if (cl.banco_rcc) ctx += `\nBanco RCC: ${cl.banco_rcc}`;
  if (cl.vlr_rmc) ctx += `\nValor RMC: R$ ${cl.vlr_rmc}`;
  if (cl.vlr_rcc) ctx += `\nValor RCC: R$ ${cl.vlr_rcc}`;
  ctx += `\n\nOBJETIVO: Informar que o cliente TEM saque disponível no cartão consignado existente. O dinheiro já é dele, só precisa solicitar.`;
  return ctx;
}

function buildCompletaContext(cl) {
  let ctx = `\n═══ DADOS DO CLIENTE — CAMPANHA COMPLETA ═══\nCliente: ${cl.nome || 'Não informado'}\nCPF: ${cl.cpf || 'Não informado'}\nBenefício INSS: ${cl.beneficio || cl.ben || 'Não informado'}\nOPORTUNIDADES IDENTIFICADAS:`;
  if (cl.troco && Number(cl.troco) > 0) ctx += `\n• PORTABILIDADE: Troco de R$ ${Number(cl.troco).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}${cl.banco_origem ? ` (saindo do ${cl.banco_origem})` : ''}`;
  if ((cl.margem_emprestimo || cl.mrgEmpNova) && Number(cl.margem_emprestimo || cl.mrgEmpNova) > 0) ctx += `\n• EMPRÉSTIMO NOVO: Margem de R$ ${cl.margem_emprestimo || cl.mrgEmpNova}`;
  if ((cl.margem_cartao || cl.mrgCartNova) && Number(cl.margem_cartao || cl.mrgCartNova) > 0) ctx += `\n• CARTÃO NOVO: Margem de R$ ${cl.margem_cartao || cl.mrgCartNova}`;
  if ((cl.saque_disponivel || cl.saqueDisp) && Number(cl.saque_disponivel || cl.saqueDisp) > 0) ctx += `\n• SAQUE COMPLEMENTAR: R$ ${cl.saque_disponivel || cl.saqueDisp} disponível`;
  ctx += `\n\nOBJETIVO: Apresentar a oportunidade MAIS relevante primeiro (maior valor). Se o cliente se interessar, mencionar as outras depois.`;
  return ctx;
}

function buildContext(campaignType, clientData) {
  switch (campaignType) {
    case 'portabilidade': return buildPortContext(clientData);
    case 'novo': case 'emprestimo': return buildNovoContext(clientData);
    case 'cartao': return buildCartaoContext(clientData);
    case 'saque': return buildSaqueContext(clientData);
    default: return buildCompletaContext(clientData);
  }
}

// ═══ CPF DETECTION + CONSULTA AUTOMATICA DO MOTOR ═══

// Extrai CPF (11 digitos) de qualquer texto. Aceita 123.456.789-00 ou 12345678900.
function extractCPF(text) {
  if (!text) return null;
  const clean = String(text).replace(/\D/g, '');
  // Busca por 11 digitos consecutivos
  const m = clean.match(/\d{11}/);
  return m ? m[0] : null;
}

// Valida CPF com digitos verificadores
function isValidCPF(cpf) {
  if (!cpf || cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i]) * (10 - i);
  let d1 = 11 - (sum % 11); if (d1 >= 10) d1 = 0;
  if (d1 !== parseInt(cpf[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i]) * (11 - i);
  let d2 = 11 - (sum % 11); if (d2 >= 10) d2 = 0;
  return d2 === parseInt(cpf[10]);
}

// Consulta Multicorban + monta oportunidades (mesma logica da Consulta Unitaria do frontend)
async function consultarMotorSofia(cpf, appUrl) {
  const log = [];
  // Auth interna — bypass de sessao usando WEBHOOK_SECRET (a /api/multicorban aceita)
  const internalSecret = process.env.WEBHOOK_SECRET || '';
  const internalHeaders = {
    'Content-Type': 'application/json',
    ...(internalSecret ? { 'x-internal-secret': internalSecret } : {})
  };
  try {
    log.push({ step: 'consult_cpf', cpf, hasSecret: !!internalSecret });
    const r = await fetch(appUrl + '/api/multicorban', {
      method: 'POST',
      headers: internalHeaders,
      body: JSON.stringify({ action: 'consult_cpf', cpf })
    });
    const txt = await r.text();
    let data;
    try { data = JSON.parse(txt); } catch { data = { ok: false, error: 'resposta nao-JSON', raw: txt.substring(0, 300) }; }
    log.push({ step: 'consult_cpf_resp', status: r.status, ok: data.ok, error: data.error, hasParsed: !!data.parsed, hasList: Array.isArray(data.lista) ? data.lista.length : false });
    if (!data.ok) {
      console.error('[MOTOR_SOFIA] consult_cpf falhou:', JSON.stringify(log));
      return { success: false, error: data.error || data.mensagem || 'CPF nao encontrado', log };
    }
    // Se retornou lista (multiplos beneficios), usa o primeiro ativo
    if (data.lista && data.lista.length && !data.parsed) {
      const ativo = data.lista.find(b => b.situacao === 'ATIVO') || data.lista[0];
      log.push({ step: 'consult_beneficio', nb: ativo?.nb, situacao: ativo?.situacao });
      if (ativo && ativo.nb) {
        const r2 = await fetch(appUrl + '/api/multicorban', {
          method: 'POST',
          headers: internalHeaders,
          body: JSON.stringify({ action: 'consult_beneficio', beneficio: ativo.nb })
        });
        const t2 = await r2.text();
        let d2;
        try { d2 = JSON.parse(t2); } catch { d2 = { ok: false, error: 'resposta nao-JSON', raw: t2.substring(0, 300) }; }
        log.push({ step: 'consult_beneficio_resp', status: r2.status, ok: d2.ok, error: d2.error, hasParsed: !!d2.parsed });
        if (d2.ok && d2.parsed) {
          const out = extractOportunidades(d2.parsed);
          out.log = log;
          return out;
        }
        console.error('[MOTOR_SOFIA] consult_beneficio falhou:', JSON.stringify(log));
        return { success: false, error: d2.error || 'Erro ao detalhar beneficio', log };
      }
      console.error('[MOTOR_SOFIA] sem nb na lista:', JSON.stringify(log));
      return { success: false, error: 'Multiplos beneficios, nao conseguiu detalhar', log };
    }
    if (data.parsed) {
      const out = extractOportunidades(data.parsed);
      out.log = log;
      return out;
    }
    console.error('[MOTOR_SOFIA] estrutura inesperada:', JSON.stringify(log));
    return { success: false, error: 'Estrutura de resposta inesperada', log };
  } catch (e) {
    log.push({ step: 'exception', error: e.message });
    console.error('[MOTOR_SOFIA] exception:', e.message, JSON.stringify(log));
    return { success: false, error: e.message, log };
  }
}

// Extrai oportunidades do resultado parsed do Multicorban
function extractOportunidades(parsed) {
  const b = parsed.beneficiario || {};
  const ben = parsed.beneficio || {};
  const mrg = parsed.margem || {};
  const carts = parsed.cartoes || [];
  const tels = parsed.telefones || [];
  const contratos = parsed.contratos || [];

  const mrgDisp = parseFloat(String(mrg.disponivel || '0').replace(/\./g, '').replace(',', '.')) || 0;
  const mrgRmc = parseFloat(String(mrg.rmc || '0').replace(/\./g, '').replace(',', '.')) || 0;
  const mrgRcc = parseFloat(String(mrg.rcc || '0').replace(/\./g, '').replace(',', '.')) || 0;

  const oport = [];
  // Emprestimo Novo (so se margem util)
  if (mrgDisp >= 50) {
    const pot = Math.round((mrgDisp / 0.02299) * 100) / 100;
    oport.push({ tipo: 'emprestimo_novo', label: 'Empréstimo Novo', valor: pot, desc: `Margem livre R$ ${mrg.disponivel}`, banco: 'FACTA' });
  }
  // Cartao Beneficio / RMC
  const hasRmc = carts.some(c => String(c.tipo || '').toUpperCase().includes('RMC'));
  if (mrgRmc >= 10 && !hasRmc) {
    const pot = Math.round((mrgRmc / 0.029214) * 100) / 100;
    oport.push({ tipo: 'cartao_beneficio', label: 'Cartão Benefício (RMC)', valor: pot, desc: `Margem RMC R$ ${mrg.rmc}`, banco: 'FACTA' });
  }
  // Saque em cartao ativo
  for (const cd of carts) {
    const mrgC = parseFloat(String(cd.margem || '0').replace(/\./g, '').replace(',', '.')) || 0;
    if (mrgC >= 10) {
      oport.push({ tipo: 'saque_complementar', label: `Saque ${cd.tipo || ''} ${cd.banco || ''}`.trim(), valor: mrgC, desc: 'Cartão ativo com margem', banco: cd.banco || '' });
    }
  }
  // Portabilidade (so contratos com prazo_original)
  let portTotal = 0;
  let portCount = 0;
  for (const ct of contratos) {
    const par = parseFloat(String(ct.parcela || '0').replace(/\./g, '').replace(',', '.')) || 0;
    const sal = parseFloat(String(ct.saldo || ct.saldo_quitacao || '0').replace(/\./g, '').replace(',', '.')) || 0;
    const total = parseInt(ct.prazo_original || '0') || 0;
    if (par > 0 && sal > 0 && total > 0) portCount++;
  }
  if (portCount > 0) {
    oport.push({ tipo: 'portabilidade', label: 'Portabilidade CIP', valor: 0, desc: `${portCount} contrato(s) elegível(is) para análise`, banco: 'FACTA' });
  }

  // Primeiro telefone
  const tel = tels && tels.length ? tels[0] : '';

  return {
    success: true,
    beneficiario: {
      cpf: b.cpf || '',
      nome: b.nome || '',
      nb: b.nb || ben.nb || '',
      data_nascimento: b.data_nascimento || '',
      especie: ben.especie || '',
      idade: b.idade || ''
    },
    margem: {
      disponivel: mrg.disponivel || '0,00',
      rmc: mrg.rmc || '0,00',
      rcc: mrg.rcc || '0,00',
      parcelas: mrg.parcelas || '0,00',
      base_calculo: ben.base_calculo || '',
      valor_beneficio: ben.valor || ''
    },
    oportunidades: oport,
    telefone: tel
  };
}

// ═══ HELPERS ═══

async function evoCall(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json', 'apikey': EVO_KEY() } };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const r = await fetch(EVO_URL() + path, opts);
  return r.json();
}

async function callClaude(messages, systemOverride) {
  const sys = systemOverride || (await buildSystemPrompt());
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_KEY(), 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 900, system: sys, messages })
  });
  const d = await r.json();
  if (d.content && d.content[0]) return d.content[0].text;
  return null;
}

async function getHistory(instance, jid, limit = 20) {
  try {
    const d = await evoCall('POST', '/chat/findMessages/' + instance, { where: { key: { remoteJid: jid } }, limit });
    if (!Array.isArray(d)) return [];
    return d.map(m => ({ role: m.key?.fromMe ? 'assistant' : 'user', content: m.message?.conversation || m.message?.extendedTextMessage?.text || '[mídia]' })).filter(m => m.content !== '[mídia]').reverse();
  } catch { return []; }
}

async function sendMsg(instance, number, text) {
  return evoCall('POST', '/message/sendText/' + instance, { number, text });
}

function parseResponse(reply) {
  let cleanReply = reply;
  let actions = [];
  let phase = null;
  let collectedData = {};
  let intencao = null;
  let sentimento = null;
  let leadScore = null;
  let handoffMotivo = null;

  const phaseMatch = reply.match(/\[FASE:(\w+)\]/);
  if (phaseMatch) { phase = phaseMatch[1]; cleanReply = cleanReply.replace(/\[FASE:\w+\]/, '').trim(); }

  const intMatch = reply.match(/\[INTENCAO:(\w+)\]/);
  if (intMatch) { intencao = intMatch[1]; cleanReply = cleanReply.replace(/\[INTENCAO:\w+\]/, '').trim(); }

  const sentMatch = reply.match(/\[SENTIMENTO:(\w+)\]/);
  if (sentMatch) { sentimento = sentMatch[1]; cleanReply = cleanReply.replace(/\[SENTIMENTO:\w+\]/, '').trim(); }

  const scoreMatch = reply.match(/\[LEAD_SCORE:(\d+)\]/);
  if (scoreMatch) { leadScore = parseInt(scoreMatch[1], 10); cleanReply = cleanReply.replace(/\[LEAD_SCORE:\d+\]/, '').trim(); }

  const handMatch = reply.match(/\[HANDOFF:(\w+)\]/);
  if (handMatch) { handoffMotivo = handMatch[1]; cleanReply = cleanReply.replace(/\[HANDOFF:\w+\]/, '').trim(); }

  const actionMatches = reply.matchAll(/\[ACAO:(\w+)\]/g);
  for (const m of actionMatches) { actions.push(m[1]); cleanReply = cleanReply.replace(m[0], '').trim(); }

  const dataMatches = reply.matchAll(/\[DADO:(\w+)=([^\]]+)\]/g);
  for (const m of dataMatches) { collectedData[m[1]] = m[2]; cleanReply = cleanReply.replace(m[0], '').trim(); }

  // Limpa linhas em branco extras que ficaram
  cleanReply = cleanReply.replace(/\n{3,}/g, '\n\n').trim();

  return { cleanReply, actions, phase, collectedData, intencao, sentimento, leadScore, handoffMotivo };
}

// Persiste tags inteligentes na conversa após cada turno da Sofia
async function persistTags(telefone, parsed) {
  try {
    const { data: existing } = await dbSelect('inss_conversas', { filters: { telefone }, single: true });
    if (!existing) return;
    const patch = {};
    const tagsArr = Array.isArray(existing.tags) ? [...existing.tags] : [];
    if (parsed.intencao) {
      patch.intencao = parsed.intencao;
      if (!tagsArr.includes('intencao:' + parsed.intencao)) tagsArr.push('intencao:' + parsed.intencao);
    }
    if (parsed.sentimento) patch.sentimento = parsed.sentimento;
    if (typeof parsed.leadScore === 'number') patch.lead_score = parsed.leadScore;
    if (parsed.handoffMotivo) {
      patch.handoff_motivo = parsed.handoffMotivo;
      patch.handoff_at = new Date().toISOString();
      if (!tagsArr.includes('handoff:' + parsed.handoffMotivo)) tagsArr.push('handoff:' + parsed.handoffMotivo);
    }
    // Quando dispara handoff, pausa a Sofia automaticamente
    if (parsed.actions && parsed.actions.includes('TRANSFERIR_HUMANO')) {
      patch.agente_ativo = false;
    }
    if (tagsArr.length !== (existing.tags || []).length) patch.tags = tagsArr;
    if (Object.keys(patch).length === 0) return;
    await dbUpdate('inss_conversas', { id: existing.id }, patch);
  } catch (e) {
    console.error('[persistTags]', e);
  }
}

// ═══ WEBHOOK SECRET for Evolution API ═══
function verifyWebhookSecret(req) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return true; // se nao configurou, aceita tudo (backward compat)
  const provided = req.headers.get('x-webhook-secret') || '';
  if (provided === secret) return true;
  // Fallback: aceita via query string ?s=... (caso Evolution nao suporte custom headers)
  try {
    const url = new URL(req.url);
    if (url.searchParams.get('s') === secret) return true;
  } catch {}
  return false;
}

// ═══ MAIN HANDLER ═══

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  try {
    const body = await req.json();
    // DEBUG: loga todo POST com event/action visível pra rastrear webhook
    try {
      console.log('[AGENT IN]', JSON.stringify({
        event: body.event,
        action: body.action,
        instance: body.instance,
        hasData: !!body.data,
        fromMe: body.data?.key?.fromMe,
        jid: body.data?.key?.remoteJid,
        msgType: body.data?.messageType,
        textPreview: (body.data?.message?.conversation || body.data?.message?.extendedTextMessage?.text || '').substring(0, 60)
      }));
    } catch {}

    // ═══ EVOLUTION WEBHOOK (incoming message) ═══
    if (body.event === 'messages.upsert' || body.event === 'messages.update') {
      // Webhook nao requer auth de usuario, mas pode ter webhook secret
      if (!verifyWebhookSecret(req)) {
        console.log('[AGENT 401] webhook secret invalid');
        return jsonResp({ error: 'Unauthorized webhook' }, 401, req);
      }
      console.log('[AGENT WEBHOOK] event=' + body.event + ' instance=' + body.instance);

      const data = body.data;
      if (!data || !data.key) return jsonResp({ ok: true }, 200, req);
      if (data.key.fromMe) return jsonResp({ ok: true }, 200, req);

      const jid = data.key.remoteJid || '';
      if (jid.includes('@g.us')) return jsonResp({ ok: true }, 200, req);

      const text = data.message?.conversation || data.message?.extendedTextMessage?.text || '';
      if (!text) return jsonResp({ ok: true }, 200, req);

      const instance = body.instance || '';
      const clientName = data.pushName || '';
      const number = jid.replace('@s.whatsapp.net', '');

      // ─── PERSISTENCIA: grava mensagem entrante na inss_conversas ───
      const persist = await inssAppendMsg(number, {
        role: 'cliente',
        content: text,
        ts: new Date().toISOString(),
        instance,
        nome: clientName
      });

      // Commands (sempre processados, mesmo se agente pausado)
      if (text.trim().toLowerCase() === '/pausa') {
        try {
          const { data: c } = await dbSelect('inss_conversas', { filters: { telefone: number }, single: true });
          if (c) await dbUpdate('inss_conversas', { id: c.id }, { agente_ativo: false });
        } catch {}
        await sendMsg(instance, number, '⏸️ Agente pausado. Um consultor humano vai continuar seu atendimento.');
        return jsonResp({ paused: true }, 200, req);
      }
      if (text.trim().toLowerCase() === '/agente') {
        try {
          const { data: c } = await dbSelect('inss_conversas', { filters: { telefone: number }, single: true });
          if (c) await dbUpdate('inss_conversas', { id: c.id }, { agente_ativo: true });
        } catch {}
        await sendMsg(instance, number, '🤖 Sofia de volta! Como posso te ajudar?');
        return jsonResp({ resumed: true }, 200, req);
      }
      // Se vendedor pausou Sofia (agente_ativo=false), apenas grava e nao responde — vendedor controla
      if (!persist.agenteAtivo) {
        return jsonResp({ ok: true, paused: true, persisted: true }, 200, req);
      }
      if (text.trim().toLowerCase() === '/status') {
        const conv = getConv(number);
        await sendMsg(instance, number, `📊 Fase: ${conv.phase}\nCampanha: ${conv.campaignType}\nDados coletados: ${conv.collectedFields?.join(', ') || 'nenhum'}`);
        return jsonResp({ status: conv }, 200, req);
      }

      const conv = getConv(number);
      conv.data = autoFillFromPipeline(conv.data || {});

      // ═══ AUTO-CONSULTA DO MOTOR ═══
      // Regra: se a conversa JA TEM dados de cliente (veio de campanha via action=dispatch),
      // NAO precisa pedir CPF nem consultar motor — Sofia ja tem tudo que precisa.
      const jaTemDadosCliente = !!(conv.data && (conv.data.cpf || conv.data.beneficio || conv.data.troco || conv.data.margem_disponivel || conv.data._oportunidades));
      // So consulta motor se: cliente mandou CPF + valido + motor ainda nao foi consultado + NAO tem dados previos
      const cpfDetectado = extractCPF(text);
      if (cpfDetectado && isValidCPF(cpfDetectado) && !conv.motorConsultado && !jaTemDadosCliente) {
        const appUrl = process.env.APP_URL || 'https://motordeport.vercel.app';
        // Consulta assincrona — envia mensagem "deixa eu consultar" enquanto processa
        await sendMsg(instance, number, '🔍 Consultando aqui na base... só 1 minutinho...');
        const motor = await consultarMotorSofia(cpfDetectado, appUrl);
        conv.motorConsultado = true;
        if (motor.success) {
          // Injeta dados do motor na conv
          conv.data = {
            ...conv.data,
            cpf: motor.beneficiario.cpf,
            nome: conv.data.nome || motor.beneficiario.nome,
            nome_completo: motor.beneficiario.nome,
            beneficio: motor.beneficiario.nb,
            data_nascimento: motor.beneficiario.data_nascimento,
            especie: motor.beneficiario.especie,
            margem_disponivel: motor.margem.disponivel,
            margem_rmc: motor.margem.rmc,
            margem_rcc: motor.margem.rcc,
            valor_beneficio: motor.margem.valor_beneficio,
            _oportunidades: motor.oportunidades,
          };
          // Define campaignType baseado na melhor oportunidade
          const melhor = motor.oportunidades.sort((a, b) => (b.valor || 0) - (a.valor || 0))[0];
          if (melhor) {
            conv.campaignType = melhor.tipo === 'portabilidade' ? 'portabilidade'
              : melhor.tipo === 'emprestimo_novo' ? 'novo'
              : melhor.tipo === 'cartao_beneficio' ? 'cartao'
              : melhor.tipo === 'saque_complementar' ? 'saque'
              : 'completa';
          }
          conv.phase = 'qualificacao';
        } else {
          // Motor falhou — avisa no contexto pra Sofia lidar
          conv.motorErro = motor.error;
          // Grava evento pra investigacao
          try {
            await dbInsert('inss_conversas_eventos', {
              telefone: number,
              tipo: 'motor_falhou',
              detalhes: { cpf: cpfDetectado, error: motor.error, log: motor.log || [] }
            });
          } catch {}
        }
        setConv(number, conv);
      }

      const history = await getHistory(instance, jid, 20);
      const { known, missing } = buildDataSummary(conv.data);

      const contextParts = [
        `[CONTEXTO DO SISTEMA — NÃO MOSTRAR AO CLIENTE]`,
        `Cliente: ${clientName || conv.data?.nome_completo || conv.data?.nome || 'Desconhecido'}`,
        `Telefone: ${number}`,
        `Fase atual: ${conv.phase}`,
        `Campanha: ${conv.campaignType}`,
      ];
      // Se o motor foi consultado com sucesso AGORA (neste turno), destacar no contexto
      if (conv.motorConsultado && conv._oportunidadesApresentadas !== true && Array.isArray(conv.data?._oportunidades)) {
        const oport = conv.data._oportunidades;
        contextParts.push(`\n═══ 🔥 MOTOR ACABOU DE CONSULTAR — OPORTUNIDADES REAIS ENCONTRADAS ═══`);
        contextParts.push(`Cliente: ${conv.data.nome_completo || conv.data.nome}`);
        contextParts.push(`CPF: ${conv.data.cpf}`);
        contextParts.push(`Benefício: ${conv.data.beneficio} (${conv.data.especie})`);
        contextParts.push(`Valor do benefício: R$ ${conv.data.valor_beneficio}`);
        contextParts.push(`Margem livre: R$ ${conv.data.margem_disponivel} | RMC: R$ ${conv.data.margem_rmc} | RCC: R$ ${conv.data.margem_rcc}`);
        contextParts.push(`\nOPORTUNIDADES IDENTIFICADAS (ordenadas por valor):`);
        const sorted = [...oport].sort((a,b) => (b.valor||0) - (a.valor||0));
        for (const o of sorted) {
          const v = o.valor > 0 ? `R$ ${Number(o.valor).toLocaleString('pt-BR',{minimumFractionDigits:2})}` : 'disponível';
          contextParts.push(`• ${o.label}: ${v} — ${o.desc} — Banco: ${o.banco}`);
        }
        contextParts.push(`\n⚡ AÇÃO OBRIGATÓRIA agora:
1. Apresente a PRIMEIRA (maior valor) de forma natural e animada (use o nome do cliente)
2. Foque no benefício prático (dinheiro na conta / economia / cartão)
3. Pergunte se o cliente quer seguir em frente
4. NÃO liste todas de uma vez — mantenha conversa natural
5. Atualize para [FASE:qualificacao]`);
        conv._oportunidadesApresentadas = true;
        setConv(number, conv);
      } else if (conv.motorErro) {
        contextParts.push(`\n⚠️ Motor retornou erro na consulta do CPF: ${conv.motorErro}`);
        contextParts.push(`Peça pro cliente confirmar o CPF (talvez digitou errado) ou diga que vai verificar com o consultor humano.`);
        conv.motorErro = null; // limpa pra não repetir
        setConv(number, conv);
      } else if (conv.data && Object.keys(conv.data).length > 0) {
        contextParts.push(buildContext(conv.campaignType, conv.data));
      } else {
        // Sem dados nenhum — cliente chegou sem campanha previa. Sofia precisa pedir CPF.
        contextParts.push(`\n⚠️ SEM CONTEXTO — Cliente chegou sem campanha prévia. Você AINDA não tem CPF dele.`);
        contextParts.push(`➤ Aja como CASO B da FASE 1: peça o CPF educadamente. Não invente valores.`);
      }
      if (conv.phase === 'coleta' || conv.collectedFields?.length > 0) {
        contextParts.push(`\n═══ STATUS DA COLETA DE DADOS ═══`);
        contextParts.push(`DADOS QUE JÁ TEMOS (NÃO peça de novo):\n${known.length ? known.join('\n') : 'Nenhum'}`);
        contextParts.push(`DADOS QUE FALTAM (peça ao cliente, 2-3 por vez):\n${missing.length ? missing.join(', ') : 'TODOS COMPLETOS → disparar [ACAO:DIGITAR_PROPOSTA]'}`);
        if (missing.length === 0) contextParts.push(`\n⚡ TODOS OS DADOS COMPLETOS! Avise o cliente e dispare [ACAO:DIGITAR_PROPOSTA]`);
        else if (missing.length <= 5) contextParts.push(`\n🔜 Quase lá! Faltam apenas ${missing.length} campos.`);
      }
      contextParts.push(`\nMensagem do cliente: "${text}"`);

      const claudeMessages = [];
      for (const h of history.slice(-16)) { claudeMessages.push(h); }
      if (claudeMessages.length === 0 || claudeMessages[claudeMessages.length - 1].role !== 'user') {
        claudeMessages.push({ role: 'user', content: contextParts.join('\n') });
      } else {
        claudeMessages[claudeMessages.length - 1] = { role: 'user', content: contextParts.join('\n') };
      }

      const cleanMessages = [];
      let lastRole = null;
      for (const m of claudeMessages) {
        if (m.role === lastRole) { cleanMessages[cleanMessages.length - 1].content += '\n' + m.content; }
        else { cleanMessages.push({ ...m }); lastRole = m.role; }
      }

      const reply = await callClaude(cleanMessages);
      if (!reply) return jsonResp({ error: 'Claude sem resposta' }, 500, req);

      const parsed = parseResponse(reply);
      const { cleanReply, actions, phase, collectedData, intencao, sentimento, leadScore, handoffMotivo } = parsed;

      if (phase) conv.phase = phase;
      if (Object.keys(collectedData).length > 0) {
        conv.data = { ...conv.data, ...collectedData };
        conv.collectedFields = [...new Set([...(conv.collectedFields || []), ...Object.keys(collectedData)])];
      }
      setConv(number, conv);

      // Persiste tags inteligentes (intencao, sentimento, lead_score, handoff) na conversa
      await persistTags(number, parsed);

      if (cleanReply.length > 500) {
        const parts = cleanReply.split('\n\n').filter(p => p.trim());
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i].trim();
          await sendMsg(instance, number, part);
          await inssAppendMsg(number, { role: 'sofia', content: part, ts: new Date().toISOString(), instance });
          if (i < parts.length - 1) await new Promise(r => setTimeout(r, 1500));
        }
      } else {
        await sendMsg(instance, number, cleanReply);
        await inssAppendMsg(number, { role: 'sofia', content: cleanReply, ts: new Date().toISOString(), instance });
      }

      const result = { success: true, instance, number, clientName, reply: cleanReply, actions, phase: conv.phase, collectedData, missingFields: getMissingFields(conv.data) };

      if (actions.includes('DIGITAR_PROPOSTA')) {
        const d = conv.data;
        const missingNow = getMissingFields(d);
        if (missingNow.length > 0) {
          result.digitacao = { status: 'pendente', missing: missingNow };
        } else {
          result.digitacao = { status: 'pronto', message: 'Dados completos, pronto para digitacao' };
          // TODO: integrar com api/facta e api/joinbank via internal call
        }
      }

      return jsonResp(result, 200, req);
    }

    // ═══ ACTIONS (requer auth via header ou webhook secret) ═══
    const action = body.action || '';

    // Bypass de auth pra cron — APENAS pra actions de cron (idleFollowup)
    const cronSecret = process.env.CRON_SECRET || process.env.WEBHOOK_SECRET || '';
    const isCronCall = cronSecret
      && req.headers.get('x-cron-secret') === cronSecret
      && (action === 'idleFollowup');

    let user = null;
    if (!isCronCall) {
      const { requireAuth: reqAuth } = await import('./_lib/auth.js');
      user = await reqAuth(req);
      if (user instanceof Response) return user;
    }

    if (action === 'dispatch') {
      const { instance, number, campaignType, clientData } = body;
      const tipo = campaignType || body.tipo || 'completa';
      const cl = clientData || body;
      if (!instance || !number) return jsonResp({ error: 'instance e number obrigatorios' }, 400, req);

      let phone = String(number).replace(/\D/g, '');
      if (!phone.startsWith('55') && phone.length <= 11) phone = '55' + phone;

      const conv = { phase: 'abordagem', data: cl, campaignType: tipo, collectedFields: [], startedAt: Date.now(), lastAt: Date.now() };
      setConv(phone, conv);

      const contextMsg = `[CONTEXTO DO SISTEMA]\nVocê vai INICIAR uma conversa com um novo cliente. Envie a PRIMEIRA mensagem de abordagem.\nCampanha: ${tipo}\n${buildContext(tipo, cl)}\n\nINSTRUÇÕES PARA A PRIMEIRA MENSAGEM:\n- Apresente-se como Sofia da LhamasCred\n- Mencione o nome do cliente\n- Vá direto ao benefício principal com o VALOR mais atrativo\n- Pergunte se pode explicar melhor\n- Seja breve e natural (3-4 linhas no máximo)`;

      const reply = await callClaude([{ role: 'user', content: contextMsg }]);
      if (!reply) return jsonResp({ error: 'Claude sem resposta' }, 500, req);
      const { cleanReply } = parseResponse(reply);
      await sendMsg(instance, phone, cleanReply);
      return jsonResp({ success: true, number: phone, message: cleanReply, campaignType: tipo }, 200, req);
    }

    if (action === 'bulkDispatch') {
      const { instance, clients, campaignType } = body;
      const tipo = campaignType || body.tipo || 'completa';
      if (!instance || !clients || !clients.length) return jsonResp({ error: 'instance e clients obrigatorios' }, 400, req);

      const results = [];
      for (const cl of clients) {
        try {
          let phone = String(cl.phone || cl.t1 || '').replace(/\D/g, '');
          if (!phone) { results.push({ nome: cl.nome, ok: false, error: 'sem telefone' }); continue; }
          if (!phone.startsWith('55') && phone.length <= 11) phone = '55' + phone;
          const conv = { phase: 'abordagem', data: cl, campaignType: tipo, collectedFields: [], startedAt: Date.now(), lastAt: Date.now() };
          setConv(phone, conv);
          const contextMsg = `[CONTEXTO] Primeira mensagem para novo cliente.\nCampanha: ${tipo}\n${buildContext(tipo, cl)}\nSeja breve, natural, mencione o valor principal. 3-4 linhas.`;
          const reply = await callClaude([{ role: 'user', content: contextMsg }]);
          const { cleanReply } = parseResponse(reply || '');
          if (cleanReply) { await sendMsg(instance, phone, cleanReply); results.push({ nome: cl.nome, phone, ok: true, message: cleanReply }); }
          else { results.push({ nome: cl.nome, ok: false, error: 'sem resposta IA' }); }
        } catch (e) { results.push({ nome: cl.nome, ok: false, error: 'Erro no envio' }); }
        await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
      }
      return jsonResp({ success: true, total: clients.length, sent: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results }, 200, req);
    }

    if (action === 'getConv') {
      const phone = String(body.phone || '').replace(/\D/g, '');
      return jsonResp({ success: true, ...getConv(phone) }, 200, req);
    }

    if (action === 'setConvData') {
      const phone = String(body.phone || '').replace(/\D/g, '');
      const conv = getConv(phone);
      conv.data = { ...conv.data, ...(body.data || {}) };
      if (body.campaignType) conv.campaignType = body.campaignType;
      setConv(phone, conv);
      return jsonResp({ success: true, conv }, 200, req);
    }

    if (action === 'setWebhook') {
      const inst = body.instance || '';
      if (!inst) return jsonResp({ error: 'instance obrigatorio' }, 400, req);
      const appUrl = process.env.APP_URL || 'https://flowforce.vercel.app';
      const secret = process.env.WEBHOOK_SECRET || '';
      // URL do webhook inclui o secret como query string (?s=...) caso Evolution nao suporte headers custom
      const webhookUrl = body.webhookUrl || `${appUrl}/api/agent${secret ? '?s=' + encodeURIComponent(secret) : ''}`;
      const events = ['MESSAGES_UPSERT'];
      // Inclui tambem nos headers (cinto+suspensorio): headers passa quando Evolution suporta, query string passa sempre
      const headers = secret ? { 'x-webhook-secret': secret } : null;
      // Tenta v2 (top-level) primeiro, com fallback v1 (wrapper webhook:{...})
      const payloadV2 = { enabled: true, url: webhookUrl, webhookByEvents: false, webhookBase64: false, events };
      if (headers) payloadV2.headers = headers;
      let r1 = await evoCall('POST', '/webhook/set/' + inst, payloadV2);
      let r2 = null;
      const enabled1 = r1 && (r1.enabled || r1.webhook?.enabled);
      if (!enabled1) {
        const payloadV1 = { webhook: { enabled: true, url: webhookUrl, webhookByEvents: false, webhookBase64: false, events } };
        if (headers) payloadV1.webhook.headers = headers;
        r2 = await evoCall('POST', '/webhook/set/' + inst, payloadV1);
      }
      const fin = await evoCall('GET', '/webhook/find/' + inst);
      return jsonResp({ success: true, instance: inst, webhookUrl, hasSecret: !!secret, response_v2: r1, response_v1: r2, current: fin }, 200, req);
    }

    if (action === 'evoDiag') {
      const inst = body.instance || '';
      if (!inst) return jsonResp({ error: 'instance obrigatorio' }, 400, req);
      const out = {};
      // 1) Status da instance (conectada?)
      try { out.connectionState = await evoCall('GET', '/instance/connectionState/' + inst); } catch (e) { out.connectionState = { error: e.message }; }
      // 2) Webhook configurada
      try { out.webhook = await evoCall('GET', '/webhook/find/' + inst); } catch (e) { out.webhook = { error: e.message }; }
      // 3) Chatwoot integration nativa (que pode estar SOBREPONDO o webhook)
      try { out.chatwoot = await evoCall('GET', '/chatwoot/find/' + inst); } catch (e) { out.chatwoot = { error: e.message }; }
      // 4) Settings da instance (filtros que poderiam descartar mensagens)
      try { out.settings = await evoCall('GET', '/settings/find/' + inst); } catch (e) { out.settings = { error: e.message }; }
      return jsonResp({ success: true, instance: inst, diag: out }, 200, req);
    }
    if (action === 'disableChatwoot') {
      const inst = body.instance || '';
      if (!inst) return jsonResp({ error: 'instance obrigatorio' }, 400, req);
      // Desativa o Chatwoot nativo (deixa o webhook normal funcionar)
      const r = await evoCall('POST', '/chatwoot/set/' + inst, { enabled: false, accountId: '0', token: '', url: '' });
      return jsonResp({ success: true, instance: inst, response: r }, 200, req);
    }
    if (action === 'resetWebhook') {
      const inst = body.instance || '';
      if (!inst) return jsonResp({ error: 'instance obrigatorio' }, 400, req);
      const log = [];
      // 1) Desliga Chatwoot nativo
      try {
        const r = await evoCall('POST', '/chatwoot/set/' + inst, { enabled: false, accountId: '0', token: '', url: '' });
        log.push({ step: 'chatwoot off', ok: true, r });
      } catch (e) { log.push({ step: 'chatwoot off', error: e.message }); }
      // 2) Apaga webhook
      try {
        const r = await evoCall('POST', '/webhook/set/' + inst, { enabled: false, url: '', events: [] });
        log.push({ step: 'webhook clear', ok: true, r });
      } catch (e) { log.push({ step: 'webhook clear', error: e.message }); }
      // 3) Reconfigura webhook pra Sofia (com secret na query)
      const appUrl = process.env.APP_URL || 'https://flowforce.vercel.app';
      const secret = process.env.WEBHOOK_SECRET || '';
      const webhookUrl = `${appUrl}/api/agent${secret ? '?s=' + encodeURIComponent(secret) : ''}`;
      const events = ['MESSAGES_UPSERT'];
      const headers = secret ? { 'x-webhook-secret': secret } : null;
      try {
        const payload = { enabled: true, url: webhookUrl, webhookByEvents: false, webhookBase64: false, events };
        if (headers) payload.headers = headers;
        const r = await evoCall('POST', '/webhook/set/' + inst, payload);
        log.push({ step: 'webhook set v2', ok: true, r });
        // fallback v1 se enabled nao foi
        if (!(r && (r.enabled || r.webhook?.enabled))) {
          const r1 = await evoCall('POST', '/webhook/set/' + inst, { webhook: { enabled: true, url: webhookUrl, webhookByEvents: false, webhookBase64: false, events, headers } });
          log.push({ step: 'webhook set v1', ok: true, r1 });
        }
      } catch (e) { log.push({ step: 'webhook set', error: e.message }); }
      // 4) Le estado final
      let final = null;
      try { final = await evoCall('GET', '/webhook/find/' + inst); } catch {}
      return jsonResp({ success: true, instance: inst, webhookUrl, log, final }, 200, req);
    }

    if (action === 'getWebhook') {
      const inst = body.instance || '';
      if (!inst) return jsonResp({ error: 'instance obrigatorio' }, 400, req);
      const r = await evoCall('GET', '/webhook/find/' + inst);
      return jsonResp({ success: true, ...r }, 200, req);
    }

    if (action === 'test') {
      let claudeOk = false;
      try { const t = await callClaude([{ role: 'user', content: 'Responda apenas: OK' }]); claudeOk = !!t; } catch {}
      let evoOk = false;
      try { const e = await evoCall('GET', '/instance/fetchInstances'); evoOk = Array.isArray(e); } catch {}
      return jsonResp({ agentActive: claudeOk && evoOk, claude: claudeOk ? 'Ativo' : 'Erro', evolution: evoOk ? 'Ativo' : 'Erro', model: CLAUDE_MODEL, version: 'Sofia v3.0 (gptmaker pattern)', activeConversations: convState.size }, 200, req);
    }

    // ═══ KNOWLEDGE MANAGEMENT (separa "o que ela sabe" do código) ═══
    if (action === 'listKnowledge') {
      const { data, error } = await dbSelect('sofia_knowledge', { order: 'categoria.asc,prioridade.desc', limit: 500 });
      if (error) return jsonResp({ ok: false, error: error.message }, 500, req);
      return jsonResp({ ok: true, knowledge: data || [] }, 200, req);
    }
    if (action === 'addKnowledge') {
      const { categoria, topico, conteudo, prioridade } = body;
      if (!categoria || !topico || !conteudo) return jsonResp({ ok: false, error: 'categoria, topico, conteudo obrigatorios' }, 400, req);
      const created = await dbInsert('sofia_knowledge', { categoria, topico, conteudo, prioridade: prioridade || 50, ativo: true });
      _knowledgeCache = null; // invalida cache
      return jsonResp({ ok: true, knowledge: created.data }, 200, req);
    }
    if (action === 'updateKnowledge') {
      const { id, ...patch } = body;
      if (!id) return jsonResp({ ok: false, error: 'id obrigatorio' }, 400, req);
      const validKeys = ['categoria', 'topico', 'conteudo', 'prioridade', 'ativo'];
      const clean = {};
      for (const k of validKeys) if (patch[k] !== undefined) clean[k] = patch[k];
      clean.updated_at = new Date().toISOString();
      await dbUpdate('sofia_knowledge', { id }, clean);
      _knowledgeCache = null;
      return jsonResp({ ok: true }, 200, req);
    }
    if (action === 'reloadKnowledge') {
      _knowledgeCache = null;
      const kb = await loadKnowledge();
      return jsonResp({ ok: true, length: kb.length, preview: kb.substring(0, 500) }, 200, req);
    }

    // ═══ IDLE FOLLOWUP — retomada automática de conversas inativas ═══
    // Roda como cron (Vercel Cron ou GitHub Actions): busca conversas onde
    // Sofia ainda atende, status open, última msg > X horas, e manda follow-up.
    if (action === 'idleFollowup') {
      const horasIdle = body.horas || 4; // default: 4h sem resposta
      const maxFollowups = body.max || 20; // máximo de follow-ups por execução
      const cutoff = new Date(Date.now() - horasIdle * 3600 * 1000).toISOString();
      const cutoff24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      // Busca todas conversas open + agente ativo
      const { data: convs } = await dbSelect('inss_conversas', {
        filters: { status: 'open', agente_ativo: true },
        order: 'last_msg_at.desc',
        limit: 200
      });
      if (!convs || !convs.length) return jsonResp({ ok: true, processed: 0, message: 'sem conversas elegíveis' }, 200, req);
      const elegives = convs.filter(c => {
        if (!c.last_msg_at) return false;
        if (c.last_msg_at > cutoff) return false; // ainda recente
        if (c.last_idle_followup_at && c.last_idle_followup_at > cutoff24h) return false; // já fez followup nas últimas 24h
        // Última mensagem precisa ser do CLIENTE (não do vendedor/sofia)
        const hist = Array.isArray(c.historico) ? c.historico : [];
        if (!hist.length) return false;
        const last = hist[hist.length - 1];
        if (last.role !== 'cliente') return false;
        // Precisa ter instance pra enviar
        if (!c.instance) return false;
        return true;
      }).slice(0, maxFollowups);

      if (!elegives.length) return jsonResp({ ok: true, processed: 0, message: 'nenhuma elegível agora', total_scanned: convs.length }, 200, req);

      const results = [];
      for (const c of elegives) {
        try {
          // Pede pra Sofia gerar uma mensagem natural de follow-up baseada no contexto
          const hist = (c.historico || []).slice(-6);
          const lastClienteMsg = [...hist].reverse().find(m => m.role === 'cliente')?.content || '';
          const ctxMsg = `[CONTEXTO DO SISTEMA — RETOMADA]
O cliente ${c.nome || ''} (${c.telefone}) parou de responder há ${horasIdle}h. A última mensagem dele foi:
"${lastClienteMsg}"

Sua tarefa: gerar UMA mensagem curta (2-3 linhas máximo) de retomada natural pelo WhatsApp. Seja gentil, não pressione, lembre da oportunidade sem ser comercial demais. Use o nome dele se tiver. Não peça desculpa por incomodar — soa fraco. Pergunte se ele tem alguma dúvida ou se quer que você mande mais informação.

Não use tags [FASE:], [INTENCAO:] etc. Apenas a mensagem em texto puro.`;
          const reply = await callClaude([{ role: 'user', content: ctxMsg }]);
          if (!reply) { results.push({ telefone: c.telefone, ok: false, error: 'claude sem resposta' }); continue; }
          const cleanReply = reply.replace(/\[\w+:[^\]]+\]/g, '').trim();
          // Envia
          await sendMsg(c.instance, c.telefone, cleanReply);
          // Persiste
          await inssAppendMsg(c.telefone, { role: 'sofia', content: cleanReply, ts: new Date().toISOString(), instance: c.instance, _followup: true });
          // Marca último followup
          await dbUpdate('inss_conversas', { id: c.id }, { last_idle_followup_at: new Date().toISOString() });
          results.push({ telefone: c.telefone, ok: true, message: cleanReply.substring(0, 80) });
          await new Promise(r => setTimeout(r, 1500)); // throttle
        } catch (e) {
          results.push({ telefone: c.telefone, ok: false, error: e.message });
        }
      }
      return jsonResp({ ok: true, processed: results.length, sent: results.filter(r => r.ok).length, results }, 200, req);
    }

    // ═══ STRESS TEST — simula 4 personas conversando com Sofia ═══
    // Útil pra validar mudanças no behavior/knowledge sem enviar WhatsApp real
    if (action === 'stressTest') {
      const persona = body.persona || 'qualificado';
      const personas = {
        confuso: [
          'oi quem é vc?',
          'eu nao entendi nada do que vc tá falando',
          'mas eu nao mexo com isso direito não, sou velho',
          'meu cpf? esquece, deixa pra outro dia',
          'vai me ligar quando? hoje a noite?'
        ],
        agressivo: [
          'que porcaria é essa?',
          'me tira dessa lista, não autorizei nada',
          'vou processar voces',
          'cala a boca robo, quero falar com gente'
        ],
        indeciso: [
          'oi',
          'hmm, talvez',
          'depois eu pego o cpf, depois te mando',
          'vou pensar e te falo depois',
          'sei la, fica caro?',
          'depois eu vejo'
        ],
        qualificado: [
          'oi sofia, tô interessado',
          'meu cpf é 123.456.789-00',
          'pode explicar como funciona a portabilidade?',
          'beleza, quero seguir',
          'sim, pode digitar'
        ]
      };
      const turnos = personas[persona] || personas.qualificado;
      const log = [];
      const fakePhone = 'TEST_' + persona + '_' + Date.now();
      const conv = { phase: 'abordagem', data: {}, campaignType: 'completa', collectedFields: [], startedAt: Date.now(), lastAt: Date.now() };
      const messages = [];
      for (const userMsg of turnos) {
        messages.push({ role: 'user', content: userMsg });
        try {
          const reply = await callClaude(messages);
          if (!reply) { log.push({ user: userMsg, sofia: '[ERRO: sem resposta]' }); continue; }
          const parsed = parseResponse(reply);
          messages.push({ role: 'assistant', content: parsed.cleanReply });
          log.push({
            user: userMsg,
            sofia: parsed.cleanReply,
            tags: {
              fase: parsed.phase,
              intencao: parsed.intencao,
              sentimento: parsed.sentimento,
              lead_score: parsed.leadScore,
              acoes: parsed.actions,
              handoff: parsed.handoffMotivo
            }
          });
        } catch (e) {
          log.push({ user: userMsg, error: e.message });
        }
      }
      return jsonResp({ ok: true, persona, turnos: log.length, log }, 200, req);
    }

    // ═══ CONVERSA INSIGHTS (tags inteligentes) ═══
    if (action === 'getConvInsights') {
      const phone = String(body.phone || body.telefone || '').replace(/\D/g, '');
      if (!phone) return jsonResp({ ok: false, error: 'phone obrigatorio' }, 400, req);
      const { data } = await dbSelect('inss_conversas', { filters: { telefone: phone }, single: true });
      if (!data) return jsonResp({ ok: false, error: 'nao encontrada' }, 404, req);
      return jsonResp({
        ok: true,
        telefone: data.telefone,
        nome: data.nome,
        intencao: data.intencao,
        sentimento: data.sentimento,
        lead_score: data.lead_score,
        tags: data.tags || [],
        handoff_motivo: data.handoff_motivo,
        handoff_at: data.handoff_at,
        agente_ativo: data.agente_ativo
      }, 200, req);
    }

    return jsonResp({ error: 'action invalida', validActions: ['dispatch', 'bulkDispatch', 'getConv', 'setConvData', 'setWebhook', 'getWebhook', 'test', 'listKnowledge', 'addKnowledge', 'updateKnowledge', 'reloadKnowledge', 'getConvInsights', 'idleFollowup', 'stressTest'] }, 400, req);

  } catch (err) {
    return jsonResp({ error: 'Erro interno' }, 500, req);
  }
}
