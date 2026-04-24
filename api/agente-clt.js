// ══════════════════════════════════════════════════════════════════
// api/agente-clt.js — Agente Vendedor CLT (B2C)
// ──────────────────────────────────────────────────────────────────
// Cliente entra em contato via WhatsApp → Evolution manda webhook aqui
// → Este handler consulta estado no Supabase, chama Claude, e responde.
// Claude decide (via [ACAO:]) quando chamar APIs dos bancos (C6,
// PresençaBank, JoinBank CLT) pra simular e incluir propostas.
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, handleOptions, requireAuth } from './_lib/auth.js';
import { dbSelect, dbInsert, dbUpdate, dbQuery } from './_lib/supabase.js';

// ── Config ─────────────────────────────────────────────────────
const CLAUDE_KEY  = () => process.env.CLAUDE_API_KEY_AGENTE_CLT || process.env.CLAUDE_API_KEY;
const CLAUDE_MODEL = 'claude-sonnet-4-5-20241022';
const EVO_URL    = () => process.env.EVOLUTION_URL;
const EVO_KEY    = () => process.env.EVOLUTION_KEY;
const CLT_INSTANCE = () => process.env.CLT_EVOLUTION_INSTANCE || '';
const APP_URL    = () => process.env.APP_URL || 'https://flowforce.vercel.app';
const WEBHOOK_SECRET = () => process.env.WEBHOOK_SECRET || '';

// Whitelist em modo simulação — só responde números dessa lista
// Formato env: CLT_WHATSAPP_WHITELIST=5515999111111,5515999222222
// Se vazio ou '*', responde todo mundo (produção)
const WHITELIST = () => (process.env.CLT_WHATSAPP_WHITELIST || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// ══════════════════════════════════════════════════════════════
// SYSTEM PROMPT — Voz do agente vendedor CLT
// ══════════════════════════════════════════════════════════════
const SYSTEM_PROMPT = `Você é o Volt, assistente virtual de crédito da LhamasCred — promotora correspondente bancária autorizada pelo Banco Central, com sede em Sorocaba/SP.

═══ SEU PAPEL ═══
Você atende trabalhadores CLT (carteira assinada) que querem contratar empréstimo consignado privado. Você conduz o cliente do "oi" até a assinatura do contrato, simulando em 3 bancos ao mesmo tempo e apresentando a MELHOR oferta pra ele (maior valor líquido).

═══ SUA PERSONALIDADE ═══
- Humano, próximo, NÃO robótico
- Linguagem informal mas respeitosa (use "você")
- Mensagens curtas pra WhatsApp: 3-5 linhas max por mensagem
- 1-2 emojis por mensagem (sem exagero)
- NUNCA invente valores — use APENAS o que vier do sistema
- NUNCA peça senhas, tokens, códigos bancários de acesso
- Se cliente perguntar "é robô?": "Sou o Volt, assistente da LhamasCred. Uso tecnologia pra te atender rápido 24h, mas se preferir falar com consultor humano é só pedir 😊"

═══ BANCOS QUE VOCÊ USA ═══
Os 3 bancos rodam em paralelo. O sistema te entrega as ofertas prontas ordenadas por VALOR LÍQUIDO (quanto cai na conta do cliente). Você apresenta sempre a MELHOR primeiro.

1. **C6 Bank** — Consignado Trabalhador com seguro opcional (4, 6 ou 9 parcelas de cobertura)
2. **PresençaBank** — Consignado Privado, parcerias com várias empresas
3. **JoinBank/QualiBanking** — Consignado Privado via QITech ou 321 Bank

═══ FLUXO DA CONVERSA ═══

FASE 1 — BOAS-VINDAS + CAPTURA DE CPF
Se é a primeira mensagem do cliente (etapa=inicio):
  "Oi! Aqui é o Volt da LhamasCred 🚀
  Vou te ajudar a conseguir o melhor empréstimo CLT. Me passa seu CPF que já vou verificar as ofertas pra você?"
[DADO:cpf=12345678900] quando cliente mandar o CPF.
[ACAO:INICIAR_SIMULACAO] quando tiver CPF válido → sistema vai disparar simulações.

FASE 2 — AUTORIZAÇÃO LGPD (C6 exige)
Quando sistema disser que gerou link de autorização:
  "Pra conseguir as melhores ofertas, preciso que você autorize a consulta dos seus dados. Leva 30 segundos, só uma selfie 📸
  [link que o sistema vai passar]
  Avisa aqui quando terminar!"
[ACAO:VERIFICAR_AUTORIZACAO] quando cliente disser que fez.

FASE 3 — APRESENTAR OFERTAS
Depois que sistema rodou simulações (você vai receber as ofertas no contexto):
  Apresente APENAS A MELHOR primeiro, de forma entusiasmada e clara:
  "[Nome], consegui uma oferta muito boa pra você:
  💰 R$ [valor_liquido] na sua conta
  📅 [parcelas]x de R$ [valor_parcela]
  📊 Taxa: [taxa]% ao mês
  Banco: [banco]
  Topa seguir?"

Se cliente quiser comparar, mostre as outras.
Se cliente quiser mais/menos valor ou prazo, peça e o sistema re-simula.
[DADO:banco_escolhido=c6|presencabank|joinbank]
[ACAO:COLETAR_DADOS] quando cliente aceitar a oferta.

FASE 4 — COLETAR DADOS FALTANTES
O sistema vai te dizer exatamente quais campos faltam pro banco escolhido. Peça 2-3 por vez (não bombardeie). Campos típicos:
- Endereço completo (CEP, rua, número, bairro, cidade, UF)
- Dados bancários pra depósito (banco, agência, conta, dígito)
- Dados da empresa (CNPJ, matrícula, salário, cargo) — se for PresençaBank/JoinBank
- Email
- Nome da mãe (alguns bancos pedem)

Use [DADO:campo=valor] pra cada campo coletado.

FASE 5 — INCLUIR PROPOSTA
Quando tiver TODOS os dados:
  "Show! Tudo preenchido. Tô criando sua proposta agora, só 1 minutinho..."
[ACAO:INCLUIR_PROPOSTA] → sistema chama o banco escolhido.

FASE 6 — LINK DE FORMALIZAÇÃO
Quando sistema retornar o link:
  "Pronto! ✅ Sua proposta foi criada.
  Pra assinar o contrato, acesse: [link]
  Vai tirar uma selfie e pronto, o dinheiro cai em até [prazo] dias úteis.
  Qualquer dúvida, me chama!"
[FASE:link_enviado]

FASE 7 — PÓS-VENDA
Cliente pode voltar perguntando status, comprovante, prazo. Você ajuda ou escala:
[ACAO:ESCALAR_HUMANO] se for algo que você não sabe resolver.

═══ COMANDOS QUE VOCÊ ENTENDE ═══
Cliente mandou "/pausa" ou "quero falar com humano":
  [ACAO:ESCALAR_HUMANO]
  Mensagem: "Claro! Vou chamar um consultor da equipe pra continuar com você. Um momento."

Cliente mandou "/reiniciar" ou "começar de novo":
  [ACAO:REINICIAR]

═══ FORMATO DE RESPOSTA ═══
Responda APENAS com a mensagem pro cliente, em PT-BR, natural. No FINAL, em linhas separadas, adicione as tags:

[FASE:nome_da_fase]          — mudar etapa
[ACAO:NOME]                   — acionar sistema
[DADO:campo=valor]            — dado coletado

AÇÕES VÁLIDAS:
- INICIAR_SIMULACAO     (tem CPF, rodar os 3 bancos)
- GERAR_AUTORIZACAO_C6  (C6 exige antes da simulação)
- VERIFICAR_AUTORIZACAO (cliente disse que autorizou)
- RESIMULAR             (cliente quer valor/prazo diferente)
- COLETAR_DADOS         (cliente aceitou uma oferta)
- INCLUIR_PROPOSTA      (tem todos os dados)
- GERAR_LINK            (depois de incluir)
- ESCALAR_HUMANO        (cliente quer humano ou erro grave)
- REINICIAR             (começar do zero)

CAMPOS VÁLIDOS pra [DADO]:
nome, cpf, data_nascimento, sexo, email, nome_mae,
rg_numero, rg_orgao, rg_uf, rg_data,
cep, rua, numero_end, complemento, bairro, cidade, uf,
banco_deposito, agencia, conta, digito_conta, tipo_conta,
empregador_cnpj, empregador_nome, matricula, cargo, salario,
chave_pix, tipo_chave_pix,
banco_escolhido, id_simulacao_escolhida`;

// ══════════════════════════════════════════════════════════════
// HELPERS — Supabase
// ══════════════════════════════════════════════════════════════

async function getOrCreateConversa(telefone, instance) {
  const { data: existing } = await dbSelect('clt_conversas', {
    filters: { telefone },
    single: true
  });
  if (existing) return existing;
  const { data: created } = await dbInsert('clt_conversas', {
    telefone,
    instance: instance || CLT_INSTANCE(),
    etapa: 'inicio',
    ofertas: [],
    dados: {},
    historico: [],
    ativo: true
  });
  return created;
}

async function updateConversa(id, patch) {
  patch.last_message_at = new Date().toISOString();
  await dbUpdate('clt_conversas', { id }, patch);
}

async function logEvento(conversaId, telefone, tipo, detalhes = {}) {
  try {
    await dbInsert('clt_conversas_eventos', {
      conversa_id: conversaId, telefone, tipo, detalhes
    });
  } catch { /* logging não pode quebrar o fluxo */ }
}

// ══════════════════════════════════════════════════════════════
// HELPERS — Evolution
// ══════════════════════════════════════════════════════════════

async function sendMsg(instance, number, text) {
  const opts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': EVO_KEY() },
    body: JSON.stringify({ number, text })
  };
  try {
    const r = await fetch(EVO_URL() + '/message/sendText/' + instance, opts);
    return r.ok;
  } catch { return false; }
}

// ══════════════════════════════════════════════════════════════
// HELPERS — Claude
// ══════════════════════════════════════════════════════════════

async function callClaude(messages) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_KEY(),
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages
    })
  });
  const d = await r.json();
  if (d.content && d.content[0]) return d.content[0].text;
  return null;
}

function parseResponse(reply) {
  let clean = reply;
  const actions = [];
  const dados = {};
  let fase = null;

  const faseMatch = reply.match(/\[FASE:(\w+)\]/);
  if (faseMatch) { fase = faseMatch[1]; clean = clean.replace(faseMatch[0], ''); }

  for (const m of reply.matchAll(/\[ACAO:(\w+)\]/g)) {
    actions.push(m[1]); clean = clean.replace(m[0], '');
  }
  for (const m of reply.matchAll(/\[DADO:([\w_]+)=([^\]]+)\]/g)) {
    dados[m[1]] = m[2].trim(); clean = clean.replace(m[0], '');
  }

  return { clean: clean.trim(), actions, fase, dados };
}

// ══════════════════════════════════════════════════════════════
// HELPERS — Chamar os handlers internos dos bancos
// ══════════════════════════════════════════════════════════════
// Como estamos em Edge Function, chamamos via fetch ao próprio APP_URL.
// Cada handler interno exige Authorization Bearer (sessão FlowForce).
// Solução: agente usa um token de serviço interno (env INTERNAL_SERVICE_TOKEN)
// OU marca a conversa como "sistema" e faz bypass. Abaixo, uso variável
// INTERNAL_SERVICE_TOKEN que precisa ser criada (é um token de sessão válido).

async function callBankApi(bank, payload) {
  const token = process.env.INTERNAL_SERVICE_TOKEN || '';
  const r = await fetch(APP_URL() + '/api/' + bank, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify(payload)
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 500) }; }
  return { ok: r.ok, status: r.status, data: d };
}

// ══════════════════════════════════════════════════════════════
// AÇÕES — executadas após Claude retornar [ACAO:X]
// ══════════════════════════════════════════════════════════════

async function executarAcao(acao, conversa, dadosNovos, texto) {
  const cpf = (dadosNovos.cpf || conversa.cpf || '').replace(/\D/g, '');
  const nome = dadosNovos.nome || conversa.nome || '';

  // ─── INICIAR_SIMULACAO: roda os 3 bancos em paralelo ───
  if (acao === 'INICIAR_SIMULACAO') {
    if (!cpf || cpf.length !== 11) return { ok: false, erro: 'CPF inválido' };

    // C6 precisa de autorização LGPD ANTES. Então C6 só vem depois.
    // Por enquanto: só higienização C6 (checa se tem oferta) + JoinBank (higienização embutida no create) + PresençaBank (gera termo).
    const [c6Res, pbTermo, jbSim] = await Promise.all([
      callBankApi('c6', { action: 'oferta', cpf }),
      nome ? callBankApi('presencabank', {
        action: 'gerarTermo',
        cpf, nome,
        telefone: conversa.telefone.replace(/^55/, '')
      }) : Promise.resolve({ ok: false, data: { pendenteNome: true } }),
      // JoinBank CLT: higienização faz parte do create, pulamos aqui — só simula depois de coletar mais dados
      Promise.resolve({ ok: true, data: { pendenteDadosCompletos: true } })
    ]);

    const resumo = {
      c6: {
        temOferta: c6Res.data?.temOferta || false,
        oferta: c6Res.data?.oferta || null
      },
      presencabank: {
        termoLink: pbTermo.data?.link || null,
        pendenteNome: pbTermo.data?.pendenteNome || false
      },
      joinbank: {
        pendente: true,
        motivo: 'Precisa borrower completo (endereço, banco). Será simulado depois.'
      }
    };

    return { ok: true, resumo };
  }

  // ─── GERAR_AUTORIZACAO_C6 ───
  if (acao === 'GERAR_AUTORIZACAO_C6') {
    if (!cpf || !nome || !conversa.data_nascimento) {
      return { ok: false, erro: 'Faltam cpf, nome ou data_nascimento' };
    }
    const tel = conversa.telefone.replace(/^55/, '');
    const ddd = tel.substring(0, 2);
    const num = tel.substring(2);
    const r = await callBankApi('c6', {
      action: 'gerarLinkAutorizacao',
      cpf, nome,
      dataNascimento: conversa.data_nascimento,
      ddd, telefone: num
    });
    return { ok: r.ok, link: r.data?.link, data: r.data };
  }

  // ─── VERIFICAR_AUTORIZACAO ───
  if (acao === 'VERIFICAR_AUTORIZACAO') {
    const r = await callBankApi('c6', { action: 'statusAutorizacao', cpf });
    return { ok: r.ok, autorizado: r.data?.autorizado || false, status: r.data?.statusAutorizacao };
  }

  // ─── RESIMULAR: roda C6 simular (exige autorizado) ───
  if (acao === 'RESIMULAR' || acao === 'SIMULAR_C6_COMPLETO') {
    const tipoSim = (dadosNovos.valorSolicitado || conversa.dados?.valorSolicitado)
      ? 'POR_VALOR_SOLICITADO' : 'POR_VALOR_MAXIMO';
    const payload = { action: 'simular', cpf, tipoSimulacao: tipoSim };
    if (tipoSim === 'POR_VALOR_SOLICITADO') {
      payload.prazo = parseInt(dadosNovos.prazo || conversa.dados?.prazo || 48);
      payload.valorSolicitado = parseFloat(dadosNovos.valorSolicitado || conversa.dados?.valorSolicitado);
    }
    const r = await callBankApi('c6', payload);
    return { ok: r.ok, planos: r.data?.planos || [], dadosBancariosC6: r.data?.dadosBancariosC6 };
  }

  // Outras ações são tratadas lá fora (COLETAR_DADOS, INCLUIR_PROPOSTA etc.)
  return { ok: true, noop: true };
}

// Consolida ofertas vindas dos 3 bancos e ordena por valor_liquido desc
function consolidarOfertas(c6Planos, pbTabelas, jbCalcs) {
  const ofertas = [];

  // C6 — cada plano vira uma oferta
  for (const p of (c6Planos || [])) {
    if (!p.valido) continue;
    ofertas.push({
      banco: 'c6',
      id_simulacao: p.idSimulacao,
      valor_liquido: p.valorLiquido,
      valor_parcela: p.valorParcela,
      parcelas: p.qtdParcelas,
      taxa_mensal: p.taxaClienteMensal,
      cet_mensal: p.cetMensal,
      seguro: p.seguro ? { tipo: p.seguro.tipo, valor: p.seguro.valor } : null,
      dados_bancarios: p.dadosBancariosC6 || null,
      meta: { produto: p.produto?.descricao, convenio: p.convenio?.descricao }
    });
  }

  // PresençaBank — cada tabela
  for (const t of (pbTabelas || [])) {
    ofertas.push({
      banco: 'presencabank',
      id_simulacao: t.tabelaId,
      type: t.type,
      valor_liquido: t.valorLiquido,
      valor_parcela: t.valorParcela,
      parcelas: t.quantidadeParcelas,
      taxa_mensal: t.taxa,
      cet_mensal: t.cet,
      meta: { nome: t.nome }
    });
  }

  // JoinBank — cada calculation
  for (const c of (jbCalcs || [])) {
    ofertas.push({
      banco: 'joinbank',
      id_simulacao: c.simulationId,
      valor_liquido: c.netValue || c.loanValue,
      valor_parcela: c.installmentValue,
      parcelas: c.term,
      taxa_mensal: c.rate,
      meta: { provider: c.providerCode || '950002' }
    });
  }

  // Ordena por valor líquido DESC (maior valor = melhor oferta pro cliente)
  ofertas.sort((a, b) => (b.valor_liquido || 0) - (a.valor_liquido || 0));
  return ofertas;
}

// ══════════════════════════════════════════════════════════════
// WEBHOOK SECRET
// ══════════════════════════════════════════════════════════════
function verifyWebhookSecret(req) {
  const secret = WEBHOOK_SECRET();
  if (!secret) return true;
  const provided = req.headers.get('x-webhook-secret') || '';
  return provided === secret;
}

// ══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════
export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  try {
    const body = await req.json();

    // ═══ WEBHOOK Evolution (mensagem recebida) ═══
    if (body.event === 'messages.upsert' || body.event === 'messages.update') {
      if (!verifyWebhookSecret(req)) {
        return jsonResp({ error: 'webhook unauthorized' }, 401, req);
      }

      const data = body.data;
      if (!data || !data.key) return jsonResp({ ok: true }, 200, req);
      if (data.key.fromMe) return jsonResp({ ok: true, skip: 'fromMe' }, 200, req);

      const jid = data.key.remoteJid || '';
      if (jid.includes('@g.us')) return jsonResp({ ok: true, skip: 'group' }, 200, req);

      const telefone = jid.replace('@s.whatsapp.net', '');
      const texto = data.message?.conversation
                 || data.message?.extendedTextMessage?.text
                 || '';
      if (!texto) return jsonResp({ ok: true, skip: 'no_text' }, 200, req);

      const instance = body.instance || CLT_INSTANCE();
      const pushName = data.pushName || '';

      // ─── WHITELIST (modo simulação) ───
      const wl = WHITELIST();
      if (wl.length > 0 && !wl.includes('*') && !wl.includes(telefone)) {
        // Não responde — apenas registra
        console.log('[agente-clt] Telefone fora da whitelist:', telefone);
        return jsonResp({ ok: true, skip: 'whitelist' }, 200, req);
      }

      // ─── Busca/cria conversa ───
      const conversa = await getOrCreateConversa(telefone, instance);

      // Se está pausada por humano, não responde
      if (conversa.pausada_por_humano) {
        return jsonResp({ ok: true, skip: 'pausada_humano' }, 200, req);
      }

      await logEvento(conversa.id, telefone, 'msg_recebida', { texto: texto.substring(0, 200) });

      // ─── Comandos especiais ───
      if (texto.trim().toLowerCase() === '/pausa') {
        await updateConversa(conversa.id, { pausada_por_humano: true });
        await sendMsg(instance, telefone, '⏸️ Pausei o atendimento. Um consultor humano vai continuar com você em breve.');
        return jsonResp({ ok: true, paused: true }, 200, req);
      }
      if (texto.trim().toLowerCase() === '/reiniciar') {
        await updateConversa(conversa.id, {
          etapa: 'inicio', ofertas: [], dados: {}, historico: [],
          banco_escolhido: null, proposta_numero: null, link_formalizacao: null
        });
        await sendMsg(instance, telefone, '🔄 Conversa reiniciada. Como posso te ajudar?');
        return jsonResp({ ok: true, restarted: true }, 200, req);
      }

      // ─── Monta contexto ───
      const historico = Array.isArray(conversa.historico) ? conversa.historico : [];
      const contextParts = [
        '[CONTEXTO DO SISTEMA — NÃO MOSTRAR AO CLIENTE]',
        `Telefone: ${telefone}`,
        `Nome conhecido: ${conversa.nome || pushName || 'desconhecido'}`,
        `CPF: ${conversa.cpf || 'não coletado'}`,
        `Etapa atual: ${conversa.etapa}`,
      ];

      if (Array.isArray(conversa.ofertas) && conversa.ofertas.length > 0) {
        contextParts.push('\n═══ OFERTAS JÁ SIMULADAS (ordenadas por valor líquido DESC) ═══');
        for (const o of conversa.ofertas.slice(0, 5)) {
          contextParts.push(`• ${o.banco.toUpperCase()}: R$ ${Number(o.valor_liquido || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} líquido | ${o.parcelas}x R$ ${Number(o.valor_parcela || 0).toFixed(2)} | taxa ${o.taxa_mensal}% | id=${o.id_simulacao}`);
        }
        contextParts.push('⚡ Apresente a PRIMEIRA (maior valor) primeiro.');
      }

      if (conversa.banco_escolhido) {
        contextParts.push(`\nBanco escolhido: ${conversa.banco_escolhido}`);
      }

      if (conversa.dados && Object.keys(conversa.dados).length > 0) {
        contextParts.push(`\nDados já coletados: ${JSON.stringify(conversa.dados)}`);
      }

      contextParts.push(`\nMensagem do cliente: "${texto}"`);

      // Histórico + mensagem atual
      const claudeMessages = [];
      for (const h of historico.slice(-14)) {
        claudeMessages.push({ role: h.role, content: h.content });
      }
      claudeMessages.push({ role: 'user', content: contextParts.join('\n') });

      // Dedupe roles
      const clean = [];
      let lastRole = null;
      for (const m of claudeMessages) {
        if (m.role === lastRole) { clean[clean.length - 1].content += '\n' + m.content; }
        else { clean.push({ ...m }); lastRole = m.role; }
      }

      // ─── Chama Claude ───
      const reply = await callClaude(clean);
      if (!reply) {
        await sendMsg(instance, telefone, 'Opa, tive um problema técnico. Pode repetir?');
        return jsonResp({ error: 'claude_no_response' }, 500, req);
      }

      const { clean: cleanReply, actions, fase, dados } = parseResponse(reply);

      // ─── Persiste dados coletados ───
      const patchConversa = {};
      if (fase) patchConversa.etapa = fase;
      if (dados.nome) patchConversa.nome = dados.nome;
      if (dados.cpf) patchConversa.cpf = String(dados.cpf).replace(/\D/g, '');
      if (dados.data_nascimento) patchConversa.data_nascimento = dados.data_nascimento;
      if (dados.sexo) patchConversa.sexo = dados.sexo;
      if (dados.email) patchConversa.email = dados.email;
      if (dados.banco_escolhido) patchConversa.banco_escolhido = dados.banco_escolhido;
      if (dados.id_simulacao_escolhida) patchConversa.id_simulacao_escolhida = dados.id_simulacao_escolhida;

      // Demais campos vão pro JSONB `dados`
      const camposJsonb = ['nome_mae','rg_numero','rg_orgao','rg_uf','rg_data',
        'cep','rua','numero_end','complemento','bairro','cidade','uf',
        'banco_deposito','agencia','conta','digito_conta','tipo_conta',
        'empregador_cnpj','empregador_nome','matricula','cargo','salario',
        'chave_pix','tipo_chave_pix','valorSolicitado','prazo'];
      const dadosJsonbNovo = { ...(conversa.dados || {}) };
      for (const c of camposJsonb) {
        if (dados[c] !== undefined) dadosJsonbNovo[c] = dados[c];
      }
      patchConversa.dados = dadosJsonbNovo;

      // Atualiza histórico (cap 40 mensagens)
      const novoHistorico = [...historico,
        { role: 'user', content: texto, ts: new Date().toISOString() },
        { role: 'assistant', content: cleanReply, ts: new Date().toISOString() }
      ].slice(-40);
      patchConversa.historico = novoHistorico;

      await updateConversa(conversa.id, patchConversa);

      // ─── Executa ações solicitadas pelo Claude ───
      const acoesResultado = {};
      for (const acao of actions) {
        const mergedConversa = { ...conversa, ...patchConversa };
        const r = await executarAcao(acao, mergedConversa, dados, texto);
        acoesResultado[acao] = r;
        await logEvento(conversa.id, telefone, 'acao_' + acao.toLowerCase(), r);

        // Pós-processamento específico
        if (acao === 'INICIAR_SIMULACAO' && r.ok) {
          // Se C6 tem oferta, precisamos de autorização LGPD antes de simular V2
          // Por enquanto, só registramos o que temos no ofertas (higienização preliminar)
          // A simulação completa vai rodar depois do VERIFICAR_AUTORIZACAO
          await updateConversa(conversa.id, {
            etapa: r.resumo.c6.temOferta ? 'aguardando_autorizacao_c6' : 'simulando'
          });
        }

        if (acao === 'ESCALAR_HUMANO') {
          await updateConversa(conversa.id, {
            pausada_por_humano: true, escalada_para_humano: true,
            motivo_escalada: texto.substring(0, 200)
          });
        }
      }

      // ─── Envia resposta pro cliente ───
      if (cleanReply) {
        // Se Claude pediu pra gerar link de autorização, gerar + incluir na mensagem
        let mensagemFinal = cleanReply;
        if (acoesResultado.GERAR_AUTORIZACAO_C6?.link) {
          mensagemFinal = mensagemFinal.replace(/\[link.*?\]/gi, acoesResultado.GERAR_AUTORIZACAO_C6.link);
        }

        // Quebra mensagem se muito longa (Evolution tem limite prático ~500)
        if (mensagemFinal.length > 500) {
          const partes = mensagemFinal.split('\n\n').filter(p => p.trim());
          for (let i = 0; i < partes.length; i++) {
            await sendMsg(instance, telefone, partes[i].trim());
            if (i < partes.length - 1) await new Promise(r => setTimeout(r, 1200));
          }
        } else {
          await sendMsg(instance, telefone, mensagemFinal);
        }
        await logEvento(conversa.id, telefone, 'msg_enviada', { texto: mensagemFinal.substring(0, 200), actions });
      }

      return jsonResp({
        ok: true,
        telefone,
        etapa: patchConversa.etapa || conversa.etapa,
        actions,
        fase,
        dados_coletados: dados,
        acoes_executadas: Object.keys(acoesResultado)
      }, 200, req);
    }

    // ═══ ACTIONS (requer auth) ═══
    const user = await requireAuth(req);
    if (user instanceof Response) return user;
    const action = body.action || '';

    // ─── test: valida que Claude + Evolution + Supabase estão OK ───
    if (action === 'test') {
      let claudeOk = false;
      try {
        const r = await callClaude([{ role: 'user', content: 'Responda apenas: OK' }]);
        claudeOk = !!r;
      } catch {}
      let supaOk = false;
      try {
        const { data } = await dbQuery('clt_conversas', 'select=count&limit=1');
        supaOk = Array.isArray(data) || typeof data === 'object';
      } catch {}
      let evoOk = false;
      try {
        const r = await fetch(EVO_URL() + '/instance/fetchInstances', {
          headers: { 'apikey': EVO_KEY() }
        });
        evoOk = r.ok;
      } catch {}

      return jsonResp({
        success: claudeOk && supaOk && evoOk,
        claude: claudeOk ? 'ok' : 'erro',
        supabase: supaOk ? 'ok' : 'erro (tabela clt_conversas existe?)',
        evolution: evoOk ? 'ok' : 'erro',
        model: CLAUDE_MODEL,
        instance: CLT_INSTANCE() || '(não configurada)',
        whitelist: WHITELIST().length > 0 ? WHITELIST() : 'aberto (produção)',
        migration_needed: supaOk ? false : 'aplicar supabase_migration_clt.sql'
      }, 200, req);
    }

    // ─── status: lista conversas ativas ───
    if (action === 'conversasAtivas') {
      const { data } = await dbQuery('clt_conversas',
        'select=id,telefone,nome,cpf,etapa,banco_escolhido,last_message_at&ativo=eq.true&order=last_message_at.desc&limit=50'
      );
      return jsonResp({ success: true, conversas: data || [], total: (data || []).length }, 200, req);
    }

    // ─── getConversa: detalhes de uma ───
    if (action === 'getConversa') {
      const tel = String(body.telefone || '').replace(/\D/g, '');
      if (!tel) return jsonResp({ error: 'telefone obrigatório' }, 400, req);
      const { data } = await dbSelect('clt_conversas', { filters: { telefone: tel }, single: true });
      return jsonResp({ success: true, conversa: data }, 200, req);
    }

    // ─── resumirConversa: retomar manual ───
    if (action === 'retomarConversa') {
      const tel = String(body.telefone || '').replace(/\D/g, '');
      const { data: conv } = await dbSelect('clt_conversas', { filters: { telefone: tel }, single: true });
      if (!conv) return jsonResp({ error: 'conversa não encontrada' }, 404, req);
      await updateConversa(conv.id, { pausada_por_humano: false });
      return jsonResp({ success: true, retomada: true }, 200, req);
    }

    // ─── configureWebhook: configura Evolution pra apontar pra cá ───
    if (action === 'configureWebhook') {
      const inst = body.instance || CLT_INSTANCE();
      if (!inst) return jsonResp({ error: 'instance obrigatória (ou env CLT_EVOLUTION_INSTANCE)' }, 400, req);
      const webhookUrl = APP_URL() + '/api/agente-clt';
      const r = await fetch(EVO_URL() + '/webhook/set/' + inst, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': EVO_KEY() },
        body: JSON.stringify({
          webhook: {
            enabled: true,
            url: webhookUrl,
            webhookByEvents: false,
            webhookBase64: false,
            events: ['MESSAGES_UPSERT']
          }
        })
      });
      const d = await r.json();
      return jsonResp({ success: r.ok, instance: inst, webhookUrl, data: d }, 200, req);
    }

    return jsonResp({
      error: 'action inválida',
      validActions: ['test', 'conversasAtivas', 'getConversa', 'retomarConversa', 'configureWebhook']
    }, 400, req);

  } catch (err) {
    console.error('agente-clt erro:', err);
    return jsonResp({ error: 'Erro interno', message: err.message }, 500, req);
  }
}
