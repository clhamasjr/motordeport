export const config = { runtime: 'edge' };

// ═══ CREDENTIALS ═══
const CLAUDE_KEY = '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';
const EVO_URL = 'https://evo.cbdw.com.br';
const EVO_KEY = 'CBDW_EVO_KEY_2026';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

// ═══ SYSTEM PROMPT — AGENTE DE CRÉDITO CONSIGNADO ═══
const SYSTEM_PROMPT = `Você é um consultor especialista em crédito consignado da Central Bancária. Seu nome é Sofia.

REGRAS DE COMPORTAMENTO:
- Seja simpática, profissional e objetiva
- Use linguagem informal mas respeitosa (você, não tu)
- Mensagens CURTAS (máx 3-4 linhas por vez no WhatsApp)
- Use emojis com moderação (1-2 por mensagem)
- NUNCA invente valores — use apenas os dados fornecidos no contexto
- NUNCA peça dados sensíveis como senha de banco
- Se não souber algo, diga que vai verificar com a equipe

FASES DA CONVERSA:
1. ABORDAGEM — Apresente a oportunidade de forma leve e direta
2. QUALIFICAÇÃO — Confirme interesse, pergunte se pode explicar
3. OBJEÇÕES — Quebre resistências com argumentos reais:
   - "Taxa alta" → Compare: bancos cobram 2.5%+, nós a partir de 1.66%
   - "Não preciso" → Mostre a economia mensal e o troco
   - "Medo de golpe" → Somos correspondente bancário autorizado, tudo pelo INSS
   - "Vou pensar" → Respeite, mas reforce que a condição é por tempo limitado
   - "Já tenho consignado" → Exatamente! Portabilidade reduz parcela E libera troco
4. COLETA DE DADOS — Quando aceitar, colete:
   - Nome completo, CPF, data de nascimento
   - Número do benefício INSS
   - Endereço completo com CEP
   - Dados bancários (banco, agência, conta)
   - RG (número, órgão emissor, data expedição)
   - Email e telefone
5. DIGITAÇÃO — Informe que está registrando a proposta no banco
6. HANDOFF — Transfira para consultor humano para finalização

PRODUTOS DISPONÍVEIS:
- PORTABILIDADE: transfere consignado de outro banco com taxa menor + troco em dinheiro
- EMPRÉSTIMO NOVO: para quem tem margem disponível, até 84x
- MARGEM COMPLEMENTAR: cartão consignado com saque na hora
- REFINANCIAMENTO: renegocia contrato existente com melhores condições

CONTEXTO DO CLIENTE (será fornecido em cada mensagem):
Use as informações de nome, troco, margem, etc para personalizar a conversa.

FORMATO DE RESPOSTA:
Responda APENAS com a mensagem para o cliente. Sem explicações, sem tags, sem markdown.
Se precisar acionar uma ação do sistema, adicione no FINAL da mensagem em uma linha separada:
[ACAO:COLETAR_DADOS] — quando o cliente aceitou e precisa coletar dados
[ACAO:DIGITAR_PROPOSTA] — quando todos os dados foram coletados
[ACAO:TRANSFERIR_HUMANO] — quando precisa de um humano
[ACAO:ENCERRAR] — quando o cliente recusou definitivamente`;

// ═══ HELPERS ═══

async function evoCall(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json', 'apikey': EVO_KEY } };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const r = await fetch(EVO_URL + path, opts);
  return r.json();
}

async function callClaude(messages) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages
    })
  });
  const d = await r.json();
  if (d.content && d.content[0]) return d.content[0].text;
  return null;
}

async function getHistory(instance, jid, limit = 15) {
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

      // Skip own messages
      if (data.key.fromMe) return new Response('ok', { headers: cors });

      // Skip groups
      const jid = data.key.remoteJid || '';
      if (jid.includes('@g.us')) return new Response('ok', { headers: cors });

      // Extract message
      const text = data.message?.conversation || data.message?.extendedTextMessage?.text || '';
      if (!text) return new Response('ok', { headers: cors });

      const instance = body.instance || '';
      const clientName = data.pushName || '';
      const number = jid.replace('@s.whatsapp.net', '');

      // Check if agent is enabled (check for /pausa command)
      if (text.trim().toLowerCase() === '/pausa') {
        await sendMsg(instance, number, '⏸️ Agente pausado. Um consultor humano vai continuar a conversa.');
        return new Response(JSON.stringify({ paused: true }), { headers: cors });
      }
      if (text.trim().toLowerCase() === '/agente') {
        await sendMsg(instance, number, '🤖 Agente reativado! Como posso te ajudar?');
        return new Response(JSON.stringify({ resumed: true }), { headers: cors });
      }

      // Get conversation history
      const history = await getHistory(instance, jid, 15);

      // Build context message
      const contextMsg = `[CONTEXTO DO SISTEMA - não mostre ao cliente]
Cliente: ${clientName || 'Desconhecido'}
Telefone: ${number}
Mensagem recebida: "${text}"
Histórico: ${history.length} mensagens anteriores`;

      // Build messages for Claude
      const claudeMessages = [];
      // Add history
      for (const h of history.slice(-12)) {
        claudeMessages.push(h);
      }
      // Ensure last message is from user
      if (claudeMessages.length === 0 || claudeMessages[claudeMessages.length - 1].role !== 'user') {
        claudeMessages.push({ role: 'user', content: contextMsg + '\n\nMensagem do cliente: ' + text });
      } else {
        // Replace last user message with enriched version
        claudeMessages[claudeMessages.length - 1] = {
          role: 'user',
          content: contextMsg + '\n\nMensagem do cliente: ' + text
        };
      }

      // Ensure alternating roles
      const cleanMessages = [];
      let lastRole = null;
      for (const m of claudeMessages) {
        if (m.role === lastRole) {
          // Merge with previous
          cleanMessages[cleanMessages.length - 1].content += '\n' + m.content;
        } else {
          cleanMessages.push(m);
          lastRole = m.role;
        }
      }

      // Call Claude
      const reply = await callClaude(cleanMessages);
      if (!reply) return new Response(JSON.stringify({ error: 'Claude sem resposta' }), { headers: cors });

      // Extract actions
      let cleanReply = reply;
      let action = null;
      const actionMatch = reply.match(/\[ACAO:(\w+)\]/);
      if (actionMatch) {
        action = actionMatch[1];
        cleanReply = reply.replace(/\[ACAO:\w+\]/, '').trim();
      }

      // Send response
      await sendMsg(instance, number, cleanReply);

      // Handle actions
      if (action === 'TRANSFERIR_HUMANO') {
        // Notify operator somehow - for now just log
        console.log(`[AGENT] Transferir humano: ${number} @ ${instance}`);
      }

      return new Response(JSON.stringify({
        success: true,
        instance,
        number,
        clientName,
        incomingText: text,
        reply: cleanReply,
        action,
        historyLength: history.length
      }), { headers: cors });
    }

    // ═══ DISPATCH (initiate conversation from FlowForce) ═══
    const action = body.action || '';

    if (action === 'dispatch') {
      const { instance, number, nome, troco, saque, cartao, emprestimo, tipo } = body;
      if (!instance || !number) return new Response(JSON.stringify({ error: 'instance e number obrigatórios' }), { status: 400, headers: cors });

      let phone = String(number).replace(/\D/g, '');
      if (!phone.startsWith('55') && phone.length <= 11) phone = '55' + phone;

      // Build personalized first message using Claude
      const contextMsg = `[CONTEXTO DO SISTEMA]
Você vai INICIAR uma conversa com um novo cliente. Envie a PRIMEIRA mensagem de abordagem.
Nome: ${nome || 'Cliente'}
Tipo campanha: ${tipo || 'completa'}
Troco portabilidade disponível: ${troco ? 'R$ ' + troco : 'não calculado'}
Saque complementar: ${saque ? 'R$ ' + saque : 'não disponível'}
Margem cartão novo: ${cartao ? 'R$ ' + cartao : 'não disponível'}
Margem empréstimo novo: ${emprestimo ? 'R$ ' + emprestimo : 'não disponível'}

Faça uma abordagem leve e natural. Mencione o valor mais relevante pro tipo de campanha.`;

      const reply = await callClaude([{ role: 'user', content: contextMsg }]);
      if (!reply) return new Response(JSON.stringify({ error: 'Claude sem resposta' }), { headers: cors });

      const cleanReply = reply.replace(/\[ACAO:\w+\]/, '').trim();
      await sendMsg(instance, phone, cleanReply);

      return new Response(JSON.stringify({ success: true, number: phone, message: cleanReply }), { headers: cors });
    }

    // ═══ BULK DISPATCH (multiple clients) ═══
    if (action === 'bulkDispatch') {
      const { instance, clients, tipo } = body;
      if (!instance || !clients || !clients.length) return new Response(JSON.stringify({ error: 'instance e clients obrigatórios' }), { status: 400, headers: cors });

      const results = [];
      for (const cl of clients) {
        try {
          let phone = String(cl.phone || cl.t1 || '').replace(/\D/g, '');
          if (!phone) { results.push({ nome: cl.nome, ok: false, error: 'sem telefone' }); continue; }
          if (!phone.startsWith('55') && phone.length <= 11) phone = '55' + phone;

          const contextMsg = `[CONTEXTO] Primeira mensagem para ${cl.nome || 'Cliente'}. Tipo: ${tipo || 'completa'}. Troco: ${cl.troco ? 'R$' + cl.troco : 'N/A'}. Saque: ${cl.saque ? 'R$' + cl.saque : 'N/A'}. Cartão: ${cl.cartao ? 'R$' + cl.cartao : 'N/A'}. Empréstimo: ${cl.emprestimo ? 'R$' + cl.emprestimo : 'N/A'}. Faça abordagem leve e curta.`;

          const reply = await callClaude([{ role: 'user', content: contextMsg }]);
          const cleanReply = (reply || '').replace(/\[ACAO:\w+\]/, '').trim();

          if (cleanReply) {
            await sendMsg(instance, phone, cleanReply);
            results.push({ nome: cl.nome, phone, ok: true, message: cleanReply });
          } else {
            results.push({ nome: cl.nome, ok: false, error: 'sem resposta IA' });
          }
        } catch (e) { results.push({ nome: cl.nome, ok: false, error: e.message }); }

        // Delay between messages
        await new Promise(r => setTimeout(r, 3000));
      }

      return new Response(JSON.stringify({
        success: true,
        total: clients.length,
        sent: results.filter(r => r.ok).length,
        failed: results.filter(r => !r.ok).length,
        results
      }), { headers: cors });
    }

    // ═══ SET WEBHOOK (configure Evolution to send to this endpoint) ═══
    if (action === 'setWebhook') {
      const instance = body.instance || '';
      if (!instance) return new Response(JSON.stringify({ error: 'instance obrigatório' }), { status: 400, headers: cors });

      const webhookUrl = body.webhookUrl || 'https://motordeport.vercel.app/api/agent';
      const r = await evoCall('POST', '/webhook/set/' + instance, {
        webhook: {
          enabled: true,
          url: webhookUrl,
          webhookByEvents: false,
          webhookBase64: false,
          events: ['MESSAGES_UPSERT']
        }
      });

      return new Response(JSON.stringify({ success: true, instance, webhookUrl, response: r }), { headers: cors });
    }

    // ═══ GET WEBHOOK STATUS ═══
    if (action === 'getWebhook') {
      const instance = body.instance || '';
      if (!instance) return new Response(JSON.stringify({ error: 'instance obrigatório' }), { status: 400, headers: cors });
      const r = await evoCall('GET', '/webhook/find/' + instance);
      return new Response(JSON.stringify({ success: true, ...r }), { headers: cors });
    }

    // ═══ TEST ═══
    if (action === 'test') {
      // Test Claude
      let claudeOk = false;
      try {
        const t = await callClaude([{ role: 'user', content: 'Responda apenas: OK' }]);
        claudeOk = !!t;
      } catch {}

      // Test Evolution
      let evoOk = false;
      try {
        const e = await evoCall('GET', '/instance/fetchInstances');
        evoOk = Array.isArray(e);
      } catch {}

      return new Response(JSON.stringify({
        agentActive: claudeOk && evoOk,
        claude: claudeOk ? '✅ Ativo' : '❌ Erro',
        evolution: evoOk ? '✅ Ativo' : '❌ Erro',
        model: CLAUDE_MODEL,
        webhookUrl: 'https://motordeport.vercel.app/api/agent'
      }), { headers: cors });
    }

    return new Response(JSON.stringify({
      error: 'action inválida ou webhook não reconhecido',
      validActions: ['dispatch', 'bulkDispatch', 'setWebhook', 'getWebhook', 'test']
    }), { status: 400, headers: cors });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } });
  }
}
