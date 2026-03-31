export const config = { runtime: 'edge' };

// ═══ CREDENTIALS ═══
const CLAUDE_KEY = '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';
const EVO_URL = 'https://evo.cbdw.com.br';
const EVO_KEY = 'CBDW_EVO_KEY_2026';
const CLAUDE_MODEL = 'claude-opus-4-6';

// ═══ CONVERSATION STATE (in-memory, resets on cold start) ═══
const convState = new Map(); // phone → { phase, data, campaignType, startedAt, lastAt }

function getConv(phone) {
  return convState.get(phone) || { phase: 'abordagem', data: {}, campaignType: 'completa', collectedFields: [], startedAt: Date.now(), lastAt: Date.now() };
}
function setConv(phone, state) {
  state.lastAt = Date.now();
  convState.set(phone, state);
  // Cleanup old convs (>24h)
  for (const [k, v] of convState) { if (Date.now() - v.lastAt > 86400000) convState.delete(k); }
}

// ═══ SYSTEM PROMPT — SOFIA v2.1 ═══
const SYSTEM_PROMPT = `Você é Sofia, consultora de crédito consignado da LhamasCred — uma promotora correspondente bancária autorizada pelo Banco Central, com sede em Sorocaba/SP.

═══ SUA PERSONALIDADE ═══
- Simpática, confiante e profissional — você ENTENDE de consignado
- Linguagem informal mas respeitosa (você, não tu)  
- Mensagens CURTAS para WhatsApp: 3-5 linhas máximo por mensagem
- Emojis com moderação (1-2 por mensagem)
- Fale como consultora real, use o NOME do cliente
- NUNCA invente valores — use APENAS os dados do contexto
- NUNCA peça senhas, tokens ou dados bancários de acesso online

═══ BANCOS INTEGRADOS — O QUE VOCÊ PODE DIGITAR ═══

FACTA FINANCEIRA (principal):
- Empréstimo Novo Digital (op 13) — até 84x, taxa a partir de 1.66%
- Margem Complementar (op 27) — empréstimo usando margem extra
- Refinanciamento (op 14) — renegocia contrato existente com melhores condições
- Portabilidade CIP + Refinanciamento (op 003500) — transfere de outro banco + troco
- Cartão Benefício (op 33) — cartão com saque imediato
→ Formalização 100% digital, link enviado por WhatsApp

QUALICONSIG / JOINBANK (complementar):
- Empréstimo Novo (op 1)
- Refinanciamento (op 2)
- Portabilidade (op 3)
- Portabilidade + Refinanciamento (op 4)
→ Também digital, boas taxas

QUANDO USAR CADA BANCO:
- Portabilidade com troco: FACTA (op 003500) é o principal
- Empréstimo novo: FACTA (op 13) ou Quali (op 1) — comparar taxas
- Cartão/saque: FACTA (op 33) para cartão benefício
- Refinanciamento: FACTA (op 14) ou Quali (op 2)

═══ PRODUTOS QUE VOCÊ DOMINA ═══

1. PORTABILIDADE DE CRÉDITO
   Transferir empréstimo de outro banco pra FACTA com taxa menor + troco em dinheiro
   Argumento: "Você paga [parcela atual] no [banco]. Trazendo pra cá, parcela cai e ainda recebe [troco] na conta"
   
2. EMPRÉSTIMO NOVO
   Margem consignável disponível → libera crédito com taxa muito menor que pessoal
   Argumento: "Sua margem libera até [valor] em até 84x com taxa a partir de 1.66%"
   
3. CARTÃO CONSIGNADO / BENEFÍCIO
   Cartão com limite alto, saque na hora, taxa menor que cartão comum
   Argumento: "Limite de [valor] aprovado, pode sacar [saque] direto na conta"

4. SAQUE COMPLEMENTAR (RMC/RCC)
   Saque do limite disponível em cartão consignado já existente
   Argumento: "Seu cartão [banco] tem [valor] de saque disponível, é seu, só precisa solicitar"

═══ FASES DA CONVERSA ═══

FASE 1 — ABORDAGEM
→ Apresente-se, mencione o benefício com VALORES reais, pergunte se pode explicar

FASE 2 — QUALIFICAÇÃO  
→ Explique o produto de forma simples, responda dúvidas

FASE 3 — QUEBRA DE OBJEÇÕES
- "Taxa alta" → Compare: banco dele cobra [taxa atual], aqui a partir de 1.66%
- "Não preciso" → Mostre economia mensal e troco
- "Medo de golpe" → Somos correspondente autorizado, formalização pelo INSS, não peço senha
- "Vou pensar" → Respeite, diga que a condição é por tempo limitado
- "Já tenho consignado" → Ótimo! A portabilidade transfere com melhores condições + troco

FASE 4 — COLETA DE DADOS
IMPORTANTE: Muitos dados você JÁ TEM do contexto (nome, CPF, benefício, telefone).
NÃO peça o que já tem. Confirme os dados existentes e peça APENAS o que falta.

Dados que a digitação FACTA precisa (e que geralmente FALTAM):
- Sexo (masculino/feminino)
- Estado civil
- Nome da mãe
- RG (número, órgão emissor, UF emissor, data expedição)
- CEP + Endereço completo (logradouro, número, complemento, bairro, cidade, UF)
- Banco pra depósito (banco, agência, conta, tipo conta)
- Email

Dados que você JÁ TERÁ do pipeline (NÃO peça de novo):
- Nome completo → confirme
- CPF → confirme
- Data de nascimento → pode já ter
- Número do benefício → pode já ter
- Telefone → já tem (é o WhatsApp)

FLUXO DE COLETA:
1. Confirme: "Seus dados: [nome], CPF [cpf]. Está correto?"
2. Peça 2-3 campos por vez no máximo (não bombardeie)
3. Confirme cada resposta: "Anotado! ✅"
4. Quando tiver TODOS os campos, avise: "Tudo certo! Vou registrar sua proposta agora..."

FASE 5 — DIGITAÇÃO
→ "Registrando sua proposta no sistema... já já te mando o link pra formalizar 📋"
→ O sistema vai chamar a API FACTA automaticamente

FASE 6 — HANDOFF
→ Transfira quando: cliente quer pessoa, situação complexa, judicial, bloqueio

═══ REGRAS DE OURO ═══
- Se não tiver o dado no contexto, NÃO invente — diga "vou verificar e te retorno"
- Se cliente mandar áudio/imagem: "Por enquanto consigo ler só texto, pode me escrever? 😊"
- Se for grosso: mantenha calma e profissionalismo
- Se perguntar se é robô: "Sou a Sofia da LhamasCred! Uso tecnologia pra te atender rápido, mas pode pedir pra falar com nosso consultor 😊"
- Se cliente pedir pra parar: respeite IMEDIATAMENTE e agradeça

═══ FORMATO DE RESPOSTA ═══
Responda APENAS com a mensagem pro cliente. Sem tags, sem markdown, sem explicações.
Se precisar acionar sistema, adicione no FINAL em linha separada:
[FASE:nome] — atualizar fase (abordagem/qualificacao/objecoes/coleta/digitacao/handoff)
[ACAO:DIGITAR_PROPOSTA] — todos os dados prontos, disparar digitação FACTA
[ACAO:TRANSFERIR_HUMANO] — cliente quer pessoa
[ACAO:AGENDAR_RETORNO] — cliente pediu pra ligar depois
[ACAO:CONSULTAR_DADOS] — precisa consultar dados do cliente na base (IN100/DATAPREV)
[ACAO:ENCERRAR] — cliente recusou definitivamente
[DADO:campo=valor] — dado coletado (ex: [DADO:nome_mae=Maria da Silva])

Campos válidos pra [DADO]: nome_completo, cpf, data_nascimento, sexo, estado_civil, nome_mae, rg_numero, rg_orgao, rg_uf, rg_data, cep, endereco, numero_end, complemento, bairro, cidade, uf, banco_deposito, agencia, conta, tipo_conta, email, beneficio`;

// ═══ REQUIRED FIELDS FOR DIGITAÇÃO ═══
const FACTA_REQUIRED = [
  'nome_completo', 'cpf', 'data_nascimento', 'sexo', 'estado_civil',
  'nome_mae', 'rg_numero', 'rg_orgao', 'rg_uf', 'rg_data',
  'cep', 'endereco', 'numero_end', 'bairro', 'cidade', 'uf',
  'banco_deposito', 'agencia', 'conta', 'tipo_conta',
  'email', 'beneficio'
];

// Check which fields are missing
function getMissingFields(collectedData) {
  const have = new Set(Object.keys(collectedData || {}).filter(k => collectedData[k]));
  return FACTA_REQUIRED.filter(f => !have.has(f));
}

// Build "what we know vs what's missing" summary for Sofia
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

  // Always missing (rarely in pipeline)
  const alwaysMissing = ['sexo', 'estado_civil', 'nome_mae', 'rg_numero', 'rg_orgao', 'rg_uf', 'rg_data',
    'cep', 'endereco', 'numero_end', 'bairro', 'cidade', 'uf',
    'banco_deposito', 'agencia', 'conta', 'tipo_conta', 'email'];
  
  for (const f of alwaysMissing) {
    if (d[f]) known.push(`${f}: ${d[f]}`);
    else missing.push(f);
  }
  
  return { known, missing };
}

// Try to auto-fill from pipeline data
function autoFillFromPipeline(convData) {
  const d = { ...convData };
  // Map pipeline field names to FACTA field names
  if (d.nome && !d.nome_completo) d.nome_completo = d.nome;
  if (d.dtNasc && !d.data_nascimento) d.data_nascimento = d.dtNasc;
  if (d.ben && !d.beneficio) d.beneficio = d.ben;
  if (d.t1 && !d.telefone) d.telefone = d.t1;
  return d;
}

// ═══ CAMPAIGN-SPECIFIC CONTEXT BUILDERS ═══

function buildPortContext(cl) {
  let ctx = `
═══ DADOS DA OPORTUNIDADE — PORTABILIDADE ═══
Cliente: ${cl.nome || 'Não informado'}
CPF: ${cl.cpf || 'Não informado'}
Benefício INSS: ${cl.beneficio || cl.ben || 'Não informado'}
Espécie: ${cl.especie || cl.esp || 'Não informado'}`;
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
  let ctx = `
═══ DADOS DA OPORTUNIDADE — EMPRÉSTIMO NOVO ═══
Cliente: ${cl.nome || 'Não informado'}
CPF: ${cl.cpf || 'Não informado'}
Benefício INSS: ${cl.beneficio || cl.ben || 'Não informado'}`;
  if (cl.margem_emprestimo || cl.mrgEmpNova) ctx += `\nMargem Disponível: R$ ${cl.margem_emprestimo || cl.mrgEmpNova}`;
  if (cl.valor_liberado) ctx += `\nValor Liberado Estimado: R$ ${cl.valor_liberado}`;
  if (cl.parcela_estimada) ctx += `\nParcela Estimada: R$ ${cl.parcela_estimada}`;
  if (cl.prazo_max) ctx += `\nPrazo Máximo: ${cl.prazo_max}x`;
  if (cl.taxa_estimada) ctx += `\nTaxa Estimada: ${cl.taxa_estimada}% a.m.`;
  ctx += `\n\nOBJETIVO: Oferecer empréstimo novo com taxa consignada (muito menor que pessoal). Destacar que o desconto é direto no benefício, sem boleto.`;
  return ctx;
}

function buildCartaoContext(cl) {
  let ctx = `
═══ DADOS DA OPORTUNIDADE — CARTÃO CONSIGNADO ═══
Cliente: ${cl.nome || 'Não informado'}
CPF: ${cl.cpf || 'Não informado'}
Benefício INSS: ${cl.beneficio || cl.ben || 'Não informado'}`;
  if (cl.margem_cartao || cl.mrgCartNova) ctx += `\nMargem Cartão Disponível: R$ ${cl.margem_cartao || cl.mrgCartNova}`;
  if (cl.valor_saque) ctx += `\nValor de Saque Disponível: R$ ${cl.valor_saque}`;
  if (cl.banco_cartao) ctx += `\nBanco do Cartão: ${cl.banco_cartao}`;
  ctx += `\n\nOBJETIVO: Oferecer cartão consignado com saque imediato. Destacar que o limite já está aprovado e o saque cai na conta.`;
  return ctx;
}

function buildSaqueContext(cl) {
  let ctx = `
═══ DADOS DA OPORTUNIDADE — SAQUE COMPLEMENTAR ═══
Cliente: ${cl.nome || 'Não informado'}
CPF: ${cl.cpf || 'Não informado'}
Benefício INSS: ${cl.beneficio || cl.ben || 'Não informado'}`;
  if (cl.saque_disponivel || cl.saqueDisp) ctx += `\nSaque Disponível: R$ ${cl.saque_disponivel || cl.saqueDisp}`;
  if (cl.banco_rmc) ctx += `\nBanco RMC: ${cl.banco_rmc}`;
  if (cl.banco_rcc) ctx += `\nBanco RCC: ${cl.banco_rcc}`;
  if (cl.vlr_rmc) ctx += `\nValor RMC: R$ ${cl.vlr_rmc}`;
  if (cl.vlr_rcc) ctx += `\nValor RCC: R$ ${cl.vlr_rcc}`;
  ctx += `\n\nOBJETIVO: Informar que o cliente TEM saque disponível no cartão consignado existente. O dinheiro já é dele, só precisa solicitar.`;
  return ctx;
}

function buildCompletaContext(cl) {
  let ctx = `
═══ DADOS DO CLIENTE — CAMPANHA COMPLETA ═══
Cliente: ${cl.nome || 'Não informado'}
CPF: ${cl.cpf || 'Não informado'}
Benefício INSS: ${cl.beneficio || cl.ben || 'Não informado'}
OPORTUNIDADES IDENTIFICADAS:`;
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

// ═══ HELPERS ═══

async function evoCall(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json', 'apikey': EVO_KEY } };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const r = await fetch(EVO_URL + path, opts);
  return r.json();
}

async function callClaude(messages, systemOverride) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 800,
      system: systemOverride || SYSTEM_PROMPT,
      messages
    })
  });
  const d = await r.json();
  if (d.content && d.content[0]) return d.content[0].text;
  return null;
}

async function getHistory(instance, jid, limit = 20) {
  try {
    const d = await evoCall('POST', '/chat/findMessages/' + instance, {
      where: { key: { remoteJid: jid } },
      limit
    });
    if (!Array.isArray(d)) return [];
    return d.map(m => ({
      role: m.key?.fromMe ? 'assistant' : 'user',
      content: m.message?.conversation || m.message?.extendedTextMessage?.text || '[mídia]'
    })).filter(m => m.content !== '[mídia]').reverse();
  } catch { return []; }
}

async function sendMsg(instance, number, text) {
  return evoCall('POST', '/message/sendText/' + instance, { number, text });
}

// Parse actions and data from response
function parseResponse(reply) {
  let cleanReply = reply;
  let actions = [];
  let phase = null;
  let collectedData = {};

  // Extract phase
  const phaseMatch = reply.match(/\[FASE:(\w+)\]/);
  if (phaseMatch) { phase = phaseMatch[1]; cleanReply = cleanReply.replace(/\[FASE:\w+\]/, '').trim(); }

  // Extract actions
  const actionMatches = reply.matchAll(/\[ACAO:(\w+)\]/g);
  for (const m of actionMatches) { actions.push(m[1]); cleanReply = cleanReply.replace(m[0], '').trim(); }

  // Extract collected data
  const dataMatches = reply.matchAll(/\[DADO:(\w+)=([^\]]+)\]/g);
  for (const m of dataMatches) { collectedData[m[1]] = m[2]; cleanReply = cleanReply.replace(m[0], '').trim(); }

  return { cleanReply, actions, phase, collectedData };
}

// ═══ MAIN HANDLER ═══

export default async function handler(req) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });

  try {
    const body = await req.json();

    // ═══ EVOLUTION WEBHOOK (incoming message) ═══
    if (body.event === 'messages.upsert' || body.event === 'messages.update') {
      const data = body.data;
      if (!data || !data.key) return new Response('ok', { headers: cors });
      if (data.key.fromMe) return new Response('ok', { headers: cors });

      const jid = data.key.remoteJid || '';
      if (jid.includes('@g.us')) return new Response('ok', { headers: cors });

      const text = data.message?.conversation || data.message?.extendedTextMessage?.text || '';
      if (!text) return new Response('ok', { headers: cors });

      const instance = body.instance || '';
      const clientName = data.pushName || '';
      const number = jid.replace('@s.whatsapp.net', '');

      // Commands
      if (text.trim().toLowerCase() === '/pausa') {
        await sendMsg(instance, number, '⏸️ Agente pausado. Um consultor humano vai continuar seu atendimento.');
        return new Response(JSON.stringify({ paused: true }), { headers: cors });
      }
      if (text.trim().toLowerCase() === '/agente') {
        await sendMsg(instance, number, '🤖 Sofia de volta! Como posso te ajudar?');
        return new Response(JSON.stringify({ resumed: true }), { headers: cors });
      }
      if (text.trim().toLowerCase() === '/status') {
        const conv = getConv(number);
        await sendMsg(instance, number, `📊 Fase: ${conv.phase}\nCampanha: ${conv.campaignType}\nDados coletados: ${conv.collectedFields?.join(', ') || 'nenhum'}`);
        return new Response(JSON.stringify({ status: conv }), { headers: cors });
      }

      // Get conversation state and auto-fill from pipeline
      const conv = getConv(number);
      conv.data = autoFillFromPipeline(conv.data || {});
      
      // Get history
      const history = await getHistory(instance, jid, 20);

      // Build data summary for coleta phase
      const { known, missing } = buildDataSummary(conv.data);

      // Build context
      const contextParts = [
        `[CONTEXTO DO SISTEMA — NÃO MOSTRAR AO CLIENTE]`,
        `Cliente: ${clientName || conv.data?.nome_completo || conv.data?.nome || 'Desconhecido'}`,
        `Telefone: ${number}`,
        `Fase atual: ${conv.phase}`,
        `Campanha: ${conv.campaignType}`,
      ];
      
      if (conv.data && Object.keys(conv.data).length > 0) {
        contextParts.push(buildContext(conv.campaignType, conv.data));
      }

      // In coleta phase, tell Sofia exactly what's missing
      if (conv.phase === 'coleta' || conv.collectedFields?.length > 0) {
        contextParts.push(`\n═══ STATUS DA COLETA DE DADOS ═══`);
        contextParts.push(`DADOS QUE JÁ TEMOS (NÃO peça de novo):\n${known.length ? known.join('\n') : 'Nenhum'}`);
        contextParts.push(`DADOS QUE FALTAM (peça ao cliente, 2-3 por vez):\n${missing.length ? missing.join(', ') : 'TODOS COMPLETOS → disparar [ACAO:DIGITAR_PROPOSTA]'}`);
        if (missing.length === 0) contextParts.push(`\n⚡ TODOS OS DADOS COMPLETOS! Avise o cliente e dispare [ACAO:DIGITAR_PROPOSTA]`);
        else if (missing.length <= 5) contextParts.push(`\n🔜 Quase lá! Faltam apenas ${missing.length} campos.`);
      }
      
      contextParts.push(`\nMensagem do cliente: "${text}"`);
      const contextMsg = contextParts.join('\n');

      // Build messages for Claude
      const claudeMessages = [];
      for (const h of history.slice(-16)) { claudeMessages.push(h); }
      
      if (claudeMessages.length === 0 || claudeMessages[claudeMessages.length - 1].role !== 'user') {
        claudeMessages.push({ role: 'user', content: contextMsg });
      } else {
        claudeMessages[claudeMessages.length - 1] = { role: 'user', content: contextMsg };
      }

      // Ensure alternating roles
      const cleanMessages = [];
      let lastRole = null;
      for (const m of claudeMessages) {
        if (m.role === lastRole) {
          cleanMessages[cleanMessages.length - 1].content += '\n' + m.content;
        } else {
          cleanMessages.push({ ...m });
          lastRole = m.role;
        }
      }

      // Call Claude Opus
      const reply = await callClaude(cleanMessages);
      if (!reply) return new Response(JSON.stringify({ error: 'Claude sem resposta' }), { headers: cors });

      // Parse response
      const { cleanReply, actions, phase, collectedData } = parseResponse(reply);

      // Update conversation state
      if (phase) conv.phase = phase;
      if (Object.keys(collectedData).length > 0) {
        conv.data = { ...conv.data, ...collectedData };
        conv.collectedFields = [...new Set([...(conv.collectedFields || []), ...Object.keys(collectedData)])];
      }
      setConv(number, conv);

      // Send response (split long messages)
      if (cleanReply.length > 500) {
        const parts = cleanReply.split('\n\n').filter(p => p.trim());
        for (let i = 0; i < parts.length; i++) {
          await sendMsg(instance, number, parts[i].trim());
          if (i < parts.length - 1) await new Promise(r => setTimeout(r, 1500));
        }
      } else {
        await sendMsg(instance, number, cleanReply);
      }

      // Handle actions
      const result = {
        success: true, instance, number, clientName,
        incomingText: text, reply: cleanReply,
        actions, phase: conv.phase, collectedData,
        missingFields: getMissingFields(conv.data),
        historyLength: history.length
      };

      if (actions.includes('TRANSFERIR_HUMANO')) {
        console.log(`[SOFIA] Transferir humano: ${number} @ ${instance}`);
        // TODO: notify operator via N8N webhook
      }
      
      if (actions.includes('AGENDAR_RETORNO')) {
        console.log(`[SOFIA] Agendar retorno: ${number}`);
      }

      if (actions.includes('CONSULTAR_DADOS')) {
        // Auto-consult IN100 via JoinBank to fill client data
        try {
          const ben = conv.data.beneficio || conv.data.ben;
          const cpf = conv.data.cpf;
          if (cpf && ben) {
            const in100 = await fetch('https://motordeport.vercel.app/api/joinbank', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'in100', cpf, beneficio: ben })
            });
            const in100Data = await in100.json();
            if (in100Data.success) {
              // Auto-fill from IN100
              if (in100Data.nome && !conv.data.nome_completo) conv.data.nome_completo = in100Data.nome;
              if (in100Data.dataNascimento && !conv.data.data_nascimento) conv.data.data_nascimento = in100Data.dataNascimento;
              if (in100Data.uf && !conv.data.uf) conv.data.uf = in100Data.uf;
              setConv(number, conv);
              result.in100 = in100Data;
            }
          }
        } catch (e) { console.log(`[SOFIA] IN100 error: ${e.message}`); }
      }

      if (actions.includes('DIGITAR_PROPOSTA')) {
        const d = conv.data;
        const missingNow = getMissingFields(d);
        
        if (missingNow.length > 0) {
          console.log(`[SOFIA] Digitar mas faltam campos: ${missingNow.join(', ')}`);
          result.digitacao = { status: 'pendente', missing: missingNow };
        } else {
          // ═══ ROUTING: decide which bank API to use ═══
          const destino = String(d.destino || d.dest || d.banco_destino || '').toUpperCase();
          const isQuali = destino.includes('QUALI') || destino.includes('JOINBANK') || destino.includes('INBURSA');
          const isFacta = destino.includes('FACTA');
          // If no specific destination, check campaign type default
          const useQuali = isQuali || (!isFacta && !destino && conv.campaignType === 'novo');
          const useFacta = isFacta || (!isQuali && !destino);
          
          try {
            if (useQuali) {
              // ═══ DIGITAÇÃO VIA JOINBANK/QUALI ═══
              console.log(`[SOFIA] Digitando via QUALI: ${d.cpf} — destino: ${destino}`);
              
              const qualiOp = conv.campaignType === 'portabilidade' ? 3 :
                              conv.campaignType === 'novo' ? 1 :
                              conv.campaignType === 'saque' ? 2 : 1;
              
              // JoinBank simulation/rules first
              const simRes = await fetch('https://motordeport.vercel.app/api/joinbank', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'listRules', operation: qualiOp, limit: 20 })
              });
              const simData = await simRes.json();
              
              if (simData.items && simData.items.length > 0) {
                const bestRule = simData.items[0]; // First rule is usually best
                result.digitacao = { status: 'simulado_quali', banco: 'QUALI', regra: bestRule, totalRegras: simData.items.length };
                
                await sendMsg(instance, number, `✅ Encontrei uma ótima condição na Qualiconsig!\n\nVou gerar o link de formalização, um momento... 📋`);
                
                // TODO: Call JoinBank digitação endpoint with full client data
                result.digitacao.status = 'aguardando_digitacao_quali';
                result.digitacao.message = 'Simulação Quali OK, digitação via JoinBank API pendente';
              } else {
                result.digitacao = { status: 'sem_regras_quali', response: simData };
                await sendMsg(instance, number, `Verifiquei as condições e estou buscando a melhor proposta pra você. Um consultor vai finalizar, tá? 😊`);
              }
              
            } else if (useFacta) {
              // ═══ DIGITAÇÃO VIA FACTA ═══
              console.log(`[SOFIA] Digitando via FACTA: ${d.cpf} — destino: ${destino}`);
              
              const factaOp = conv.campaignType === 'portabilidade' ? '003500' : 
                              conv.campaignType === 'cartao' ? '33' :
                              conv.campaignType === 'saque' ? '27' :
                              conv.campaignType === 'novo' ? '13' : '13';
              
              const simRes = await fetch('https://motordeport.vercel.app/api/facta', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  action: 'simular', cpf: d.cpf,
                  data_nascimento: d.data_nascimento,
                  tipo_operacao: factaOp
                })
              });
              const simData = await simRes.json();
              
              if (simData.tabelas && simData.tabelas.length > 0) {
                const bestTab = simData.tabelas.sort((a, b) => Number(a.taxa) - Number(b.taxa))[0];
                result.digitacao = { status: 'simulado_facta', banco: 'FACTA', tabela: bestTab, totalTabelas: simData.tabelas.length };
                
                await sendMsg(instance, number, `✅ Encontrei uma ótima condição pra você!\n\n📋 Taxa: ${bestTab.taxa}% a.m.\n💰 Parcela: R$ ${bestTab.parcela}\n📅 Prazo: ${bestTab.prazo}x\n\nVou gerar o link de formalização, um momento...`);
                
                // TODO: Complete etapa2 + etapa3 with full client data
                result.digitacao.status = 'aguardando_etapa2_facta';
                
              } else if (simData.tabelas_portabilidade) {
                const tPort = simData.tabelas_portabilidade;
                const bestPort = tPort.sort((a, b) => Number(a.taxa) - Number(b.taxa))[0];
                result.digitacao = { status: 'simulado_port_facta', banco: 'FACTA', tabela: bestPort, totalPort: tPort.length };
                
                await sendMsg(instance, number, `✅ Portabilidade processada!\n\n📋 Taxa: ${bestPort.taxa}% a.m.\n💰 Parcela: R$ ${bestPort.parcela}\n\nUm consultor vai finalizar os detalhes 😊`);
              } else {
                result.digitacao = { status: 'sem_tabelas_facta', response: simData };
                await sendMsg(instance, number, `Fiz a consulta e estou verificando as melhores condições. Um consultor vai te retornar com os detalhes 😊`);
              }
              
            } else {
              // ═══ OUTRO BANCO → OPERADOR HUMANO ═══
              console.log(`[SOFIA] Banco ${destino} não integrado. Transferindo pro operador.`);
              result.digitacao = { status: 'manual', banco: destino, message: 'Banco não integrado, operador precisa digitar manualmente' };
              
              await sendMsg(instance, number, `✅ Seus dados foram registrados!\n\nComo a melhor condição pra você é no ${destino}, um consultor especialista vai finalizar sua proposta e te enviar o link de formalização.\n\nPode ficar tranquilo, já temos tudo certinho! 😊`);
            }
          } catch (e) {
            console.log(`[SOFIA] Digitação error: ${e.message}`);
            result.digitacao = { status: 'erro', error: e.message };
            await sendMsg(instance, number, `Registrei todos os seus dados! Um consultor vai finalizar sua proposta em breve 😊`);
          }
        }
      }

      return new Response(JSON.stringify(result), { headers: cors });
    }

    // ═══ DISPATCH (initiate conversation) ═══
    const action = body.action || '';

    if (action === 'dispatch') {
      const { instance, number, campaignType, clientData } = body;
      // Also support legacy flat format
      const tipo = campaignType || body.tipo || 'completa';
      const cl = clientData || body;
      
      if (!instance || !number) return new Response(JSON.stringify({ error: 'instance e number obrigatórios' }), { status: 400, headers: cors });

      let phone = String(number).replace(/\D/g, '');
      if (!phone.startsWith('55') && phone.length <= 11) phone = '55' + phone;

      // Initialize conversation state
      const conv = { phase: 'abordagem', data: cl, campaignType: tipo, collectedFields: [], startedAt: Date.now(), lastAt: Date.now() };
      setConv(phone, conv);

      // Build context for first message
      const contextMsg = `[CONTEXTO DO SISTEMA]
Você vai INICIAR uma conversa com um novo cliente. Envie a PRIMEIRA mensagem de abordagem.
Campanha: ${tipo}
${buildContext(tipo, cl)}

INSTRUÇÕES PARA A PRIMEIRA MENSAGEM:
- Apresente-se como Sofia da LhamasCred
- Mencione o nome do cliente
- Vá direto ao benefício principal com o VALOR mais atrativo
- Pergunte se pode explicar melhor
- Seja breve e natural (3-4 linhas no máximo)`;

      const reply = await callClaude([{ role: 'user', content: contextMsg }]);
      if (!reply) return new Response(JSON.stringify({ error: 'Claude sem resposta' }), { headers: cors });

      const { cleanReply } = parseResponse(reply);
      await sendMsg(instance, phone, cleanReply);

      return new Response(JSON.stringify({ success: true, number: phone, message: cleanReply, campaignType: tipo }), { headers: cors });
    }

    // ═══ BULK DISPATCH ═══
    if (action === 'bulkDispatch') {
      const { instance, clients, campaignType } = body;
      const tipo = campaignType || body.tipo || 'completa';
      
      if (!instance || !clients || !clients.length) return new Response(JSON.stringify({ error: 'instance e clients obrigatórios' }), { status: 400, headers: cors });

      const results = [];
      for (const cl of clients) {
        try {
          let phone = String(cl.phone || cl.t1 || '').replace(/\D/g, '');
          if (!phone) { results.push({ nome: cl.nome, ok: false, error: 'sem telefone' }); continue; }
          if (!phone.startsWith('55') && phone.length <= 11) phone = '55' + phone;

          // Initialize conversation
          const conv = { phase: 'abordagem', data: cl, campaignType: tipo, collectedFields: [], startedAt: Date.now(), lastAt: Date.now() };
          setConv(phone, conv);

          const contextMsg = `[CONTEXTO] Primeira mensagem para novo cliente.
Campanha: ${tipo}
${buildContext(tipo, cl)}
Seja breve, natural, mencione o valor principal. 3-4 linhas.`;

          const reply = await callClaude([{ role: 'user', content: contextMsg }]);
          const { cleanReply } = parseResponse(reply || '');

          if (cleanReply) {
            await sendMsg(instance, phone, cleanReply);
            results.push({ nome: cl.nome, phone, ok: true, message: cleanReply });
          } else {
            results.push({ nome: cl.nome, ok: false, error: 'sem resposta IA' });
          }
        } catch (e) { results.push({ nome: cl.nome, ok: false, error: e.message }); }

        // Delay between messages (3-5s random)
        await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
      }

      return new Response(JSON.stringify({
        success: true, total: clients.length,
        sent: results.filter(r => r.ok).length,
        failed: results.filter(r => !r.ok).length,
        results
      }), { headers: cors });
    }

    // ═══ GET/SET CONVERSATION STATE ═══
    if (action === 'getConv') {
      const phone = String(body.phone || '').replace(/\D/g, '');
      return new Response(JSON.stringify({ success: true, ...getConv(phone) }), { headers: cors });
    }

    if (action === 'setConvData') {
      const phone = String(body.phone || '').replace(/\D/g, '');
      const conv = getConv(phone);
      conv.data = { ...conv.data, ...(body.data || {}) };
      if (body.campaignType) conv.campaignType = body.campaignType;
      setConv(phone, conv);
      return new Response(JSON.stringify({ success: true, conv }), { headers: cors });
    }

    // ═══ SET WEBHOOK ═══
    if (action === 'setWebhook') {
      const inst = body.instance || '';
      if (!inst) return new Response(JSON.stringify({ error: 'instance obrigatório' }), { status: 400, headers: cors });
      const webhookUrl = body.webhookUrl || 'https://motordeport.vercel.app/api/agent';
      const r = await evoCall('POST', '/webhook/set/' + inst, {
        webhook: { enabled: true, url: webhookUrl, webhookByEvents: false, webhookBase64: false, events: ['MESSAGES_UPSERT'] }
      });
      return new Response(JSON.stringify({ success: true, instance: inst, webhookUrl, response: r }), { headers: cors });
    }

    // ═══ GET WEBHOOK ═══
    if (action === 'getWebhook') {
      const inst = body.instance || '';
      if (!inst) return new Response(JSON.stringify({ error: 'instance obrigatório' }), { status: 400, headers: cors });
      const r = await evoCall('GET', '/webhook/find/' + inst);
      return new Response(JSON.stringify({ success: true, ...r }), { headers: cors });
    }

    // ═══ TEST ═══
    if (action === 'test') {
      let claudeOk = false, claudeModel = '';
      try {
        const t = await callClaude([{ role: 'user', content: 'Responda apenas: OK' }]);
        claudeOk = !!t;
        claudeModel = CLAUDE_MODEL;
      } catch {}

      let evoOk = false;
      try {
        const e = await evoCall('GET', '/instance/fetchInstances');
        evoOk = Array.isArray(e);
      } catch {}

      return new Response(JSON.stringify({
        agentActive: claudeOk && evoOk,
        claude: claudeOk ? '✅ Ativo' : '❌ Erro',
        evolution: evoOk ? '✅ Ativo' : '❌ Erro',
        model: claudeModel,
        version: 'Sofia v2.0',
        activeConversations: convState.size,
        webhookUrl: 'https://motordeport.vercel.app/api/agent'
      }), { headers: cors });
    }

    return new Response(JSON.stringify({
      error: 'action inválida',
      validActions: ['dispatch', 'bulkDispatch', 'getConv', 'setConvData', 'setWebhook', 'getWebhook', 'test']
    }), { status: 400, headers: cors });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } });
  }
}
