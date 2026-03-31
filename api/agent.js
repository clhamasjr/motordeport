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

// ═══ SYSTEM PROMPT — SOFIA v2.0 ═══
const SYSTEM_PROMPT = `Você é Sofia, consultora de crédito consignado da LhamasCred — uma promotora correspondente bancária autorizada pelo Banco Central, com sede em Sorocaba/SP.

═══ SUA PERSONALIDADE ═══
- Simpática, confiante e profissional — você ENTENDE de consignado
- Linguagem informal mas respeitosa (você, não tu)  
- Mensagens CURTAS para WhatsApp: 3-5 linhas máximo por mensagem
- Emojis com moderação (1-2 por mensagem, nunca exagerado)
- Fale como uma consultora real, não como robô
- Use o NOME do cliente sempre que possível
- NUNCA invente valores — use APENAS os dados do contexto
- NUNCA peça senhas, tokens ou dados bancários de acesso

═══ PRODUTOS QUE VOCÊ DOMINA ═══

1. PORTABILIDADE DE CRÉDITO
   O que é: Transferir o empréstimo consignado de um banco pra outro com taxa menor
   Benefícios: Parcela reduz + cliente recebe TROCO em dinheiro na conta
   Como explicar: "Você paga [parcela atual] no [banco atual]. Levando pra cá, a parcela cai pra [nova parcela] e você ainda recebe [troco] na conta. Sem custo nenhum pra você."
   Objeções comuns:
   - "Vou perder meu empréstimo?" → Não! O contrato continua, só muda de banco com condições melhores
   - "Demora?" → Formalização é digital, em 48-72h o troco cai na conta
   - "É seguro?" → Tudo regulado pelo INSS/Banco Central, somos correspondente autorizado
   - "Taxa alta" → Compare: banco atual cobra [taxa atual], aqui a partir de 1.66%
   
2. EMPRÉSTIMO NOVO (MARGEM)
   O que é: Empréstimo novo usando a margem consignável disponível
   Benefícios: Taxas muito menores que empréstimo pessoal, até 84x, desconto em folha
   Como explicar: "Você tem margem disponível de [valor]. Isso te libera até [valor liberado] em até 84 parcelas, com taxa a partir de 1.66% — muito menor que qualquer empréstimo pessoal."
   
3. CARTÃO CONSIGNADO / BENEFÍCIO
   O que é: Cartão com margem consignável, permite saque na hora
   Benefícios: Limite alto, taxa menor que cartão comum, saque imediato
   Como explicar: "Você tem direito a um cartão consignado com limite de [valor]. Pode sacar [saque] direto na conta, sem parcela extra — já está dentro da margem."

4. SAQUE COMPLEMENTAR (RMC/RCC)
   O que é: Saque do limite disponível em cartão consignado já existente
   Benefícios: Dinheiro na conta sem novo contrato
   Como explicar: "Seu cartão [banco] tem [saque disponível] de saque disponível. Esse dinheiro já é seu, só precisa solicitar."

═══ FASES DA CONVERSA ═══
Você SEMPRE segue esta sequência. Adapte o ritmo ao cliente.

FASE 1 — ABORDAGEM (primeira mensagem)
→ Apresente-se brevemente, mencione o benefício principal com VALORES reais
→ Pergunte se pode explicar melhor
→ NÃO despeje informação, seja leve

FASE 2 — QUALIFICAÇÃO  
→ Confirme o interesse, explique o produto de forma simples
→ Use analogias do dia a dia
→ Responda dúvidas com segurança

FASE 3 — QUEBRA DE OBJEÇÕES
→ Ouça a objeção, valide o sentimento, depois argumente
→ "Entendo sua preocupação, [nome]. Deixa eu te explicar..."
→ Use dados concretos (valores, taxas, comparações)
→ Se o cliente recusar firme: respeite, agradeça e deixe porta aberta

FASE 4 — COLETA DE DADOS
→ Quando o cliente aceitar, colete UM campo por vez:
   1. Nome completo
   2. CPF (confirme os dados se já tiver)
   3. Data de nascimento
   4. Número do benefício INSS
   5. Endereço completo com CEP
   6. Dados bancários (banco, agência, conta — pra depósito)
   7. RG (número, órgão emissor, data expedição)
   8. Email
→ Seja paciente, não peça tudo de uma vez
→ Confirme cada dado: "Anotado! Agora preciso do seu..."

FASE 5 — DIGITAÇÃO
→ Informe que está registrando a proposta
→ "Tô registrando sua proposta aqui no sistema, já já te passo o número do contrato"

FASE 6 — HANDOFF
→ Transfira pra consultor humano quando:
  - Cliente quer falar com "uma pessoa de verdade"
  - Situação complexa (judicial, bloqueio, etc)
  - Dados todos coletados e precisa formalizar

═══ REGRAS DE OURO ═══
- Se o contexto não tiver o dado, NÃO invente. Diga "vou consultar aqui e te retorno"
- Se o cliente mandar áudio ou imagem, diga que por enquanto só consegue ler texto
- Se o cliente xingar ou for grosso, mantenha a calma e profissionalismo
- Se perguntar se você é robô: "Sou a Sofia da LhamasCred! Uso tecnologia pra te atender mais rápido, mas pode pedir pra falar com nosso consultor a qualquer momento 😊"
- NUNCA mande mensagem grande — quebre em 2-3 mensagens curtas se precisar

═══ FORMATO DE RESPOSTA ═══
Responda APENAS com a mensagem para o cliente. Sem tags, sem markdown, sem explicações extras.
Se precisar acionar uma ação do sistema, adicione no FINAL em linha separada:
[FASE:nome_fase] — atualizar fase (abordagem/qualificacao/objecoes/coleta/digitacao/handoff)
[ACAO:DIGITAR_PROPOSTA] — todos os dados coletados, disparar digitação
[ACAO:TRANSFERIR_HUMANO] — cliente quer falar com pessoa
[ACAO:AGENDAR_RETORNO] — cliente pediu pra ligar depois
[ACAO:ENCERRAR] — cliente recusou definitivamente
[DADO:campo=valor] — dado coletado (ex: [DADO:nome_completo=João da Silva])`;

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

      // Get conversation state
      const conv = getConv(number);
      
      // Get history
      const history = await getHistory(instance, jid, 20);

      // Build context
      const contextParts = [
        `[CONTEXTO DO SISTEMA — NÃO MOSTRAR AO CLIENTE]`,
        `Cliente: ${clientName || conv.data?.nome || 'Desconhecido'}`,
        `Telefone: ${number}`,
        `Fase atual: ${conv.phase}`,
        `Campanha: ${conv.campaignType}`,
        `Dados já coletados: ${JSON.stringify(conv.collectedFields || [])}`,
      ];
      
      if (conv.data && Object.keys(conv.data).length > 0) {
        contextParts.push(buildContext(conv.campaignType, conv.data));
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
        historyLength: history.length
      };

      if (actions.includes('TRANSFERIR_HUMANO')) {
        // Could notify operator via webhook or Evolution
        console.log(`[SOFIA] Transferir humano: ${number} @ ${instance}`);
      }
      if (actions.includes('DIGITAR_PROPOSTA')) {
        console.log(`[SOFIA] Digitar proposta: ${number} — dados: ${JSON.stringify(conv.data)}`);
        // Future: auto-call FACTA API
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
