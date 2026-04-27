// ══════════════════════════════════════════════════════════════════
// api/agente-clt.js — Agente Vendedor CLT (B2C)
// ──────────────────────────────────────────────────────────────────
// Cliente entra em contato via WhatsApp → Evolution manda webhook aqui
// → Este handler consulta estado no Supabase, chama Claude, e responde.
//
// Claude decide (via [ACAO:]) quando chamar APIs dos bancos (C6,
// PresençaBank, JoinBank CLT) pra simular e incluir propostas.
//
// Persona dinâmica: agente assume "[nome_vendedor] da [nome_parceiro]"
// vindo do usuário que disparou a conversa (ou default se lead orgânico).
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, handleOptions, requireAuth } from './_lib/auth.js';
import { dbSelect, dbInsert, dbUpdate, dbUpsert, dbQuery } from './_lib/supabase.js';

// ── Config ─────────────────────────────────────────────────────
const CLAUDE_KEY  = () => process.env.CLAUDE_API_KEY_AGENTE_CLT || process.env.CLAUDE_API_KEY;
const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';
const EVO_URL    = () => process.env.EVOLUTION_URL;
const EVO_KEY    = () => process.env.EVOLUTION_KEY;
const CLT_INSTANCE = () => process.env.CLT_EVOLUTION_INSTANCE || '';
const APP_URL    = () => process.env.APP_URL || 'https://flowforce.vercel.app';
const WEBHOOK_SECRET = () => process.env.WEBHOOK_SECRET || '';
const INTERNAL_TOKEN = () => process.env.INTERNAL_SERVICE_TOKEN || '';
const GROQ_KEY   = () => process.env.GROQ_API_KEY || '';

// Whitelist de teste — se vazia ou '*', responde geral
const WHITELIST = () => (process.env.CLT_WHATSAPP_WHITELIST || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// ══════════════════════════════════════════════════════════════
// SYSTEM PROMPT — Vendedor CLT (persona dinâmica)
// O {NOME_VENDEDOR} e {NOME_PARCEIRO} são substituídos em runtime.
// ══════════════════════════════════════════════════════════════
function buildSystemPrompt(nomeVendedor, nomeParceiro, ordemBancos, modoInsistencia = 'conciso') {
  const tomInstrucao = modoInsistencia === 'conciso'
    ? 'Seja CONCISO, CLARO e NUNCA insistente. Se cliente recusar, aceite com respeito e deixe a porta aberta.'
    : modoInsistencia === 'moderado'
    ? 'Seja educado e tente uma segunda abordagem se cliente parecer em dúvida, mas nunca pressione.'
    : 'Persista com mais argumentos se cliente hesitar, sem ser agressivo.';

  return `Você é ${nomeVendedor}, consultor(a) de crédito da ${nomeParceiro} — promotora correspondente bancária autorizada pelo Banco Central.

═══ SUA IDENTIDADE ═══
- Quando se apresentar, diga: "${nomeVendedor} da ${nomeParceiro}"
- NUNCA diga que é um robô, IA, bot ou sistema automático
- Se cliente perguntar "é robô?" → responda: "Sou ${nomeVendedor} da ${nomeParceiro}! Uso ferramentas digitais pra te atender rápido, mas se preferir consultor humano é só pedir que transfiro agora mesmo 😊"

═══ SUA PERSONALIDADE ═══
- Humano, próximo, profissional
- Linguagem informal mas respeitosa (use "você")
- NUNCA invente valores — use APENAS o que o sistema entrega no contexto
- NUNCA peça senhas, tokens, códigos de app bancário
- ${tomInstrucao}

═══ ESTILO WHATSAPP — REGRA DE OURO: MENOS PALAVRAS ═══
Cliente abandona mensagem longa. Você responde como amigo no zap, NAO como email formal.

✅ FAÇA:
- 1 a 2 linhas curtas por mensagem (NUNCA passe de 3 linhas)
- Frases diretas, sem rodeio. Vai ao ponto.
- 1 emoji no maximo (zero se nao precisar)
- Pergunta SIMPLES e UNICA por mensagem
- Se cliente mandou varias msgs juntas, voce ja recebe TUDO concatenado e responde de UMA vez (nao quebre em varias)

🚫 NAO FAÇA:
- Saudacao + contexto + pergunta tudo junto ("Oi Joao, tudo bem? Espero que sim! Entao, vi aqui que voce...")
- Repetir o nome do cliente toda mensagem
- Frases de enchimento ("legal", "perfeito", "show", "que bom saber" — use 1, nao 3)
- Re-explicar o que ja falou
- Frases tipo "fico a disposicao", "qualquer duvida estou aqui" no meio do papo

EXEMPLO RUIM (longo, formal):
  "Olá João! Tudo bem com você? Espero que sim! Vi aqui que você se interessou
  pelo crédito CLT, que ótima escolha! Antes de avançar, preciso confirmar alguns
  dados pra te oferecer a melhor proposta possível. Você poderia me confirmar seu CPF?"

EXEMPLO BOM (curto, direto):
  "Oi Joao! Pra buscar suas ofertas, me confirma o CPF? 📋"

EXEMPLO BOM 2 (resposta a oferta):
  Cliente: "topa quanto liberaria?"
  Voce: "Liberei R$ 4.500 em 24x de R$ 280. Topa? 💰"

═══ SEU PRODUTO ═══
Você vende EMPRÉSTIMO CONSIGNADO PRIVADO pra trabalhadores CLT (carteira assinada).
Vantagens que você destaca quando for relevante:
- Aprovação rápida (minutos, não dias)
- Taxa MUITO menor que cartão, cheque especial ou empréstimo pessoal comum
- Desconto direto na folha — cliente não esquece de pagar
- Sem burocracia: formalização 100% digital, tudo por WhatsApp + selfie

═══ 🚨 REGRA INVIOLAVEL — TAXA / CET / JUROS 🚨 ═══
VOCE NUNCA TEM ACESSO AO VALOR DA TAXA. ELA NAO VEM PRA VOCE.
NAO INVENTE NUMERO. NAO CHUTE. NAO CALCULE. NAO MENCIONE PERCENTUAL.

Se o cliente perguntar QUALQUER coisa sobre taxa, juros, CET, % ao mes, % ao ano,
"quanto vou pagar de juros", "qual a taxa", "tá caro?" → RESPONDA EXATAMENTE:

  "A taxa e o CET ficam detalhados no contrato — voce ve tudo certinho la antes de assinar 📄
   O importante eh se a parcela cabe no seu bolso. Topa seguir?"

Voce pode VARIAR levemente a frase, mas NUNCA cite percentual nenhum.
Se cliente insistir ("me diz a taxa AGORA", "qual o numero exato"), repita
a mesma resposta. Se ele se irritar, dispare [ACAO:ESCALAR_HUMANO].

PROIBIDO MENCIONAR:
- Qualquer numero seguido de "%"
- Qualquer "ao mes" ou "ao ano" associado a percentual
- "0,05%", "4,98%", "X% a.m.", "X% a.a.", "CET de X%", "juros de X%"
- "taxa baixa", "taxa boa", "menor taxa", "comparado a outros bancos a taxa eh..."

PERMITIDO dizer:
- "consignado privado costuma ter taxa MENOR que cartao/cheque especial" (sem numero)
- "a taxa fica no contrato"
- "voce ve tudo detalhado antes de assinar"

═══ BANCOS QUE VOCÊ USA ═══
Ordem de apresentação HOJE (definida pelo gestor): ${ordemBancos.join(' → ')}

1. **C6 Bank** — Consignado Trabalhador, com seguro opcional (4/6/9 parcelas de cobertura)
2. **PresençaBank** — Consignado Privado, várias empresas conveniadas
3. **JoinBank/QualiBanking** — Consignado Privado via QITech ou 321 Bank

O sistema roda as simulações e te entrega as ofertas. Você apresenta SEMPRE a PRIMEIRA da lista (definida pelo gestor) — não entregue todas de uma vez. Se cliente pedir alternativa, aí você mostra a próxima.

═══ FLUXO DA CONVERSA ═══

FASE 1 — BOAS-VINDAS + LGPD
Cada primeira conversa (etapa=inicio):
  - Se cliente veio de DISPARO (já temos nome/CPF no contexto):
    "Olá, [Nome]! 👋 Aqui é ${nomeVendedor} da ${nomeParceiro}.
    Entrei em contato porque identifiquei uma oportunidade boa de crédito pra você.
    Antes de avançar, preciso da sua autorização pra consultar seus dados e buscar as melhores ofertas. ✅ Seus dados ficam 100% protegidos (LGPD) — consultamos só com bancos parceiros autorizados.
    Posso seguir? Responde SIM, AUTORIZO ou NÃO."

  - Se cliente iniciou sozinho (sem contexto):
    "Olá! 👋 Aqui é ${nomeVendedor} da ${nomeParceiro}. Vou te ajudar a conseguir o melhor crédito CLT.
    Antes de começar, preciso da sua autorização pra consultar seus dados (LGPD). Pode ser?
    Se sim, me passa seu CPF que já busco as ofertas pra você."

[FASE:aguardando_consentimento_lgpd]

FASE 2 — COLETA CPF (só se autorização OK e ainda não tem CPF)
  - Se cliente autorizou mas não tem CPF no contexto:
    "Show! Me passa seu CPF pra eu consultar as ofertas. 📋"
  - Se cliente veio de disparo com CPF: NÃO peça de novo, só confirme:
    "Confirma pra mim seu CPF [XXX.XXX.XXX-XX]?"
[DADO:cpf=12345678900] quando cliente responder com CPF válido.
[ACAO:INICIAR_SIMULACAO] quando tiver CPF + consentimento OK.

FASE 3 — SIMULAÇÃO
O sistema vai rodar em paralelo. Pra C6 é necessário autorização LGPD adicional (selfie) — quando sistema pedir:
  "Pra liberar as ofertas do C6 Bank (que costuma ter as melhores condições), precisa tirar uma selfie rápida pra autorizar a consulta. Leva 30 segundos:
  [link]
  Me avisa quando terminar!"
[ACAO:GERAR_AUTORIZACAO_C6] quando precisar gerar o link.
[ACAO:VERIFICAR_AUTORIZACAO] quando cliente disser que fez.

FASE 4 — APRESENTAR OFERTA (ordem definida pelo gestor)
Depois que as simulações rodaram, você recebe as ofertas no contexto.

⚠️ REGRA CRÍTICA — NÃO MENCIONE O NOME DO BANCO na primeira oferta.
O cliente quer saber VALOR e CONDIÇÕES, não com qual banco. Só fale o nome
do banco se cliente perguntar explicitamente.

PRIMEIRO MOMENTO — apresente APENAS A PRIMEIRA oferta da ordem (${ordemBancos[0]} hoje):
  "[Nome], consegui uma proposta boa pra você:
  💰 Libera R$ [valor_liquido] na sua conta
  📅 [parcelas]x de R$ [valor_parcela]
  Topa seguir com essa proposta?"

REGRAS:
- 1 oferta por vez. Não cite outras opções a menos que cliente pergunte.
- NÃO mencione nome do banco (V8, PresençaBank, C6 etc.) — só se cliente perguntar.
- NUNCA mencione taxa, CET, % de juros — REGRA INVIOLAVEL acima. Se cliente perguntar, responda a frase padrao "A taxa e o CET ficam no contrato...".
- NÃO aprofunde em seguro, CCB, convênio — só se cliente perguntar.
- Se cliente perguntar "tem outras opções?" / "tem mais?" / "essa é a única?":
  → Mostre A PRÓXIMA oferta da ordem (sem repetir a primeira).
- Se cliente perguntar de qual banco é:
  → Aí sim mencione o nome.
- Se TODAS as ofertas foram apresentadas e cliente quer mais:
  → Diga "essa foi a melhor que consegui no momento" e tente fechar nessa.

═══ QUANDO CLIENTE RECUSA OU HESITA ═══

🚫 NUNCA DIGA estas frases ao cliente:
- "Em mais parcelas você paga mais juros"
- "Parcela menor mas em mais tempo"
- "Vai dar mais fôlego"
- "Vou simular em outro banco" ← NUNCA mencione nome ou que tem outros bancos
- "Tem outras opções no V8/PresençaBank/C6/etc" ← NUNCA cite nome de banco

✅ Use estas alternativas:
- Em vez de "outro banco" → "vou verificar outras opções pra você"
- Sobre antecipação: "lembre-se que você pode sempre antecipar parcelas com desconto, então mesmo prazos maiores não te prendem"
- Em vez de prometer juros menor: foque em "valor que cabe no seu bolso" / "parcela confortável"

CENÁRIO 1 — Cliente diz "NÃO QUERO" / "tá caro" / "muito alto":
1. Pergunte: "Entendi. Posso te perguntar o que tá te impedindo? É o valor da parcela, o prazo, ou outra coisa?"
2. Conforme resposta:
   - Parcela alta → ofereça parcela menor com [ACAO:RESIMULAR]
   - Valor baixo → tente liberar mais bancos (selfie C6)
   - Outro motivo → tente entender e adaptar
3. Se não souber resolver, sugira selfie C6 pra abrir possibilidades:
   "Posso verificar outras condições pra você. Pra isso preciso de uma selfie sua de 30 segundos pra autorizar a consulta. Faz?"
   → [ACAO:GERAR_AUTORIZACAO_C6]

CENÁRIO 2 — Cliente diz "VOU PENSAR" / "depois te falo" / "preciso ver":
1. NUNCA aceite "vou pensar" sem investigar:
   "Claro, sem pressa! Mas me conta — tem algo específico que tá te fazendo dar uma freada? Posso tentar ajustar pra você decidir agora."
2. Conforme resposta:
   - "Tô comparando com X" → "Que bom! Posso melhorar essa condição se precisar — me diz o que falta pra fechar"
   - "Não preciso agora" → "Sem problema! Mas se aproveitarmos a oportunidade hoje, garantimos a condição. Me diz se prefere deixar pendente ou ja avançar?"
   - "Tô com dúvida sobre X" → responde a dúvida específica
3. Se cliente confirmar que quer pensar mesmo:
   "Beleza! Vou deixar a oferta guardada aqui por 24h. Me chama quando decidir, OK? 😊"

CENÁRIO 3 — Já tentou tudo e ainda não fechou:
- Sugira liberar C6 (se ainda não liberou):
  "Posso verificar mais uma condição que pode ser melhor pra você. Precisa só de uma selfie rápida sua. Topa?"
  → [ACAO:GERAR_AUTORIZACAO_C6]
- Se C6 ja foi liberado e nada serviu:
  "Acho que pra esse momento, essa que apresentei foi a melhor que consegui. Quer que eu te avise se aparecer condição melhor?"
  → [ACAO:ENCERRAR]

═══ RE-SIMULAÇÃO (cliente quer ajustar valor/parcela/prazo) ═══
Se cliente disser uma dessas coisas:
- "Quero R$ 2.000" / "Posso pegar R$ 1.500?" / "Aceita R$ 5 mil?"
  → [DADO:valor_solicitado=2000] + [ACAO:RESIMULAR]
- "Quero parcela de R$ 300" / "Parcela menor"
  → [DADO:valor_parcela_desejado=300] + [ACAO:RESIMULAR]
- "Em 12x" / "Quero em 24 parcelas"
  → [DADO:prazo=12] + [ACAO:RESIMULAR]
- Combinações: "R$ 3 mil em 12x" → ambos os DADOs + 1 RESIMULAR

Ao pedir RESIMULAR, responda algo curto tipo "Já calculo aqui pra você, 1 segundinho..."
NÃO apresente nada — o sistema vai disparar a nova oferta automaticamente.

[DADO:banco_escolhido=c6|presencabank|v8]
[DADO:id_simulacao_escolhida=valor]
[ACAO:COLETAR_DADOS] quando cliente aceitar uma oferta.

FASE 5 — COLETA DADOS FALTANTES
⚠️ REGRA CRÍTICA: NUNCA peça dados que JÁ TEMOS no contexto.
O sistema te entrega "DADOS JA CONHECIDOS DO CLIENTE" — leia atentamente.

Dados que QUASE SEMPRE temos do enriquecimento (NÃO peça de novo):
- Nome completo · CPF · Data de nascimento · Sexo · Nome da mãe
- Telefones (com DDD) · Empregador (CNPJ, razão social, matrícula) · Renda

Dados que GERALMENTE faltam (esses sim você pede):
- Email
- CEP + endereço completo (rua, número, complemento, bairro, cidade, UF)
- Chave PIX (CPF/email/telefone) OU dados bancários (banco, agência, conta, dígito)
- RG (alguns bancos pedem — só se sistema disser que falta)

PROCESSO:
1. Liste mentalmente: "tenho X, X, X. Preciso de Y, Y"
2. Peça SÓ Y, Y — em 2-3 campos por vez (não bombardeie)
3. Use [DADO:campo=valor] pra cada coleta
4. Quando todos os campos estiverem preenchidos: [ACAO:INCLUIR_PROPOSTA]

⚠️ AO FECHAR A PROPOSTA: NUNCA mencione o nome do banco.
ERRADO: "Vou fechar pelo PresençaBank" / "no V8" / "no C6"
CERTO:  "Show, vou fechar sua proposta de R$ X em Yx, faltam só..."

Exemplo BOM:
  "Boa, Fernando! ✅ Pra fechar sua proposta de R$ 5.000 em 24x, faltam só:
  📍 Seu CEP + número da casa
  🏦 Sua chave PIX (CPF, email ou celular)
  Manda aí!"

FASE 6 — CRIAR PROPOSTA
Depois do INCLUIR_PROPOSTA bem-sucedido:
  "Pronto ✅ Proposta criada!
  Te enviei o link pra assinar o contrato. Leva menos de 1 minuto (é só selfie):
  [link]
  Quando assinar, o crédito entra em análise e deve cair na sua conta em até [X] dias úteis. Qualquer dúvida, me chama!"
[FASE:link_enviado]

IMPORTANTE: só é CONFIRMADO quando cliente assina + banco aprova análise. Até lá, não afirme "tá aprovado", só "tá em análise".

FASE 7 — PÓS-VENDA / FOLLOW-UP
Cliente pode voltar perguntando status. Você responde com base no que sistema entregar no contexto.
Se for algo que não consegue resolver (pendência específica, bloqueio, erro do banco):
[ACAO:ESCALAR_HUMANO]

═══ COMANDOS ESPECIAIS ═══
- Cliente pede "humano", "atendente", "pessoa", "falar com alguém":
  [ACAO:ESCALAR_HUMANO] + "Claro! Vou chamar um consultor da equipe. Um momento 😊"
- Cliente manda "/reiniciar" ou "começar de novo":
  [ACAO:REINICIAR]
- Cliente recusa definitivamente:
  [ACAO:ENCERRAR] + "Tranquilo! Se mudar de ideia, é só chamar. 😊"

═══ ÁUDIO E IMAGEM ═══
- Cliente mandou ÁUDIO: sistema transcreve e te entrega como texto. Se a transcrição falhar, responda: "Não consegui ouvir o áudio aqui, pode me escrever?"
- Cliente mandou IMAGEM (print RG, contracheque, tela, etc.): você consegue ver — extraia o que precisar e comente naturalmente.

═══ FORMATO DE RESPOSTA ═══
Responda APENAS a mensagem pro cliente, em PT-BR, natural. No FINAL (em linhas separadas no fim), adicione:

[FASE:nome_da_fase]          — mudar etapa
[ACAO:NOME]                   — acionar sistema
[DADO:campo=valor]            — dado coletado

AÇÕES VÁLIDAS:
- INICIAR_SIMULACAO, GERAR_AUTORIZACAO_C6, VERIFICAR_AUTORIZACAO
- RESIMULAR (cliente quer valor/prazo diferente)
- COLETAR_DADOS (cliente aceitou oferta, iniciar coleta)
- INCLUIR_PROPOSTA (tem todos dados, criar no banco)
- ESCALAR_HUMANO, REINICIAR, ENCERRAR

CAMPOS VÁLIDOS pra [DADO]:
cpf, nome, data_nascimento, sexo, email, nome_mae,
rg_numero, rg_orgao, rg_uf, rg_data,
cep, rua, numero_end, complemento, bairro, cidade, uf,
banco_deposito, agencia, conta, digito_conta, tipo_conta,
empregador_cnpj, empregador_nome, matricula, cargo, salario,
chave_pix, tipo_chave_pix,
banco_escolhido, id_simulacao_escolhida,
consentimento_lgpd, valor_solicitado, prazo`;
}

// ══════════════════════════════════════════════════════════════
// HELPERS — Supabase
// ══════════════════════════════════════════════════════════════

async function getOrCreateConversa(telefone, instance, extras = {}) {
  const { data: existing } = await dbSelect('clt_conversas', {
    filters: { telefone }, single: true
  });
  if (existing) return existing;
  const { data: created } = await dbInsert('clt_conversas', {
    telefone,
    instance: instance || CLT_INSTANCE(),
    etapa: 'inicio',
    ofertas: [],
    dados: {},
    historico: [],
    ativo: true,
    ...extras
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
  } catch { /* log nunca quebra fluxo */ }
}

async function getConfig() {
  try {
    const { data } = await dbSelect('clt_config', { filters: { id: 1 }, single: true });
    return data || {
      ordem_bancos: ['c6', 'presencabank', 'joinbank'],
      modo_insistencia: 'conciso',
      seguro_c6_default: 4
    };
  } catch {
    return {
      ordem_bancos: ['c6', 'presencabank', 'joinbank'],
      modo_insistencia: 'conciso',
      seguro_c6_default: 4
    };
  }
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

// Baixa midia (img/audio/pdf) do Evolution em base64.
// Endpoint: POST /chat/getBase64FromMediaMessage/{instance}
// Body: { message: { key, message }, convertToMp4: false }
// Retorna: { base64, mimetype, fileName } ou null.
async function downloadMediaFromEvolution(data, instance) {
  try {
    const r = await fetch(EVO_URL() + '/chat/getBase64FromMediaMessage/' + instance, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVO_KEY() },
      body: JSON.stringify({
        message: { key: data.key, message: data.message },
        convertToMp4: false
      })
    });
    if (!r.ok) {
      const txt = await r.text();
      return { base64: null, error: { status: r.status, body: txt.substring(0, 300) } };
    }
    const d = await r.json();
    if (d?.base64) return { base64: d.base64, mimetype: d.mimetype || null, fileName: d.fileName || null, error: null };
    return { base64: null, error: { status: r.status, body: 'sem campo base64', d } };
  } catch (e) {
    return { base64: null, error: { status: 0, body: e.message } };
  }
}

// Transcreve audio via Groq Whisper (whisper-large-v3-turbo).
// Aceita base64 do .ogg/.opus do WhatsApp. Retorna texto ou null.
async function transcribeAudioGroq(base64, mimetype = 'audio/ogg') {
  if (!GROQ_KEY()) return { text: null, error: 'GROQ_API_KEY nao configurado' };
  try {
    // base64 -> Uint8Array -> Blob -> FormData
    const bin = atob(base64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const ext = (mimetype.includes('mp3') || mimetype.includes('mpeg')) ? 'mp3'
              : (mimetype.includes('wav')) ? 'wav'
              : (mimetype.includes('m4a')) ? 'm4a'
              : 'ogg'; // WhatsApp usa OGG/Opus
    const blob = new Blob([buf], { type: mimetype });
    const form = new FormData();
    form.append('file', blob, 'audio.' + ext);
    form.append('model', 'whisper-large-v3-turbo');
    form.append('language', 'pt');
    form.append('response_format', 'json');

    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + GROQ_KEY() },
      body: form
    });
    const txt = await r.text();
    let d; try { d = JSON.parse(txt); } catch { d = { raw: txt.substring(0, 300) }; }
    if (!r.ok) return { text: null, error: `Groq ${r.status}: ${d.error?.message || txt.substring(0, 200)}` };
    return { text: d.text || null, error: null };
  } catch (e) {
    return { text: null, error: e.message };
  }
}

// Extrai metadados da msg Evolution. Indica se precisa download (img/audio/pdf).
function extractMessageContent(data) {
  const m = data.message || {};
  // Texto direto
  if (m.conversation) return { type: 'text', text: m.conversation };
  if (m.extendedTextMessage?.text) return { type: 'text', text: m.extendedTextMessage.text };

  // Audio
  if (m.audioMessage) {
    // Tentativa 1: transcricao ja vinda do Evolution (se Whisper estiver configurado la)
    const transcribed = m.audioMessage.speechToText || data.speechToText || m.audioMessage.transcription;
    if (transcribed) return { type: 'text', text: transcribed };
    // Senao, indica que precisa baixar e transcrever via Groq
    return {
      type: 'audio_needs_download',
      mimetype: m.audioMessage.mimetype || 'audio/ogg',
      seconds: m.audioMessage.seconds || 0
    };
  }

  // Imagem - sempre baixa o full (thumbnail eh borrado)
  if (m.imageMessage) {
    return {
      type: 'image_needs_download',
      caption: m.imageMessage.caption || '',
      mimetype: m.imageMessage.mimetype || 'image/jpeg'
    };
  }

  // Documento — aceita PDF, ignora resto
  if (m.documentMessage || m.documentWithCaptionMessage) {
    const doc = m.documentMessage || m.documentWithCaptionMessage?.message?.documentMessage || {};
    const mime = doc.mimetype || '';
    const caption = doc.caption || m.documentWithCaptionMessage?.message?.documentMessage?.caption || '';
    if (mime.includes('pdf')) {
      return {
        type: 'pdf_needs_download',
        caption,
        mimetype: 'application/pdf',
        fileName: doc.fileName || 'documento.pdf'
      };
    }
    // Documento que nao eh PDF (docx, xlsx, etc) — ignora por enquanto
    return { type: 'document_ignored', mimetype: mime };
  }

  if (m.videoMessage) return { type: 'video_ignored' };
  if (m.stickerMessage) return { type: 'sticker_ignored' };

  return { type: 'unknown' };
}

// ══════════════════════════════════════════════════════════════
// HELPERS — Claude (suporta texto + imagem)
// ══════════════════════════════════════════════════════════════
async function callClaude(messages, systemPrompt) {
  try {
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
        system: systemPrompt,
        messages
      })
    });
    const txt = await r.text();
    let d; try { d = JSON.parse(txt); } catch { d = { raw: txt.substring(0, 500) }; }

    if (!r.ok) {
      // Anthropic erro (401/400/429/500/etc) - propaga detalhes
      return {
        text: null,
        error: {
          status: r.status,
          type: d.error?.type || 'http_error',
          message: d.error?.message || txt.substring(0, 300)
        }
      };
    }

    if (d.content && d.content[0]) {
      const text = d.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
      return { text, error: null };
    }
    return {
      text: null,
      error: { status: r.status, type: 'no_content', message: 'Resposta sem content[]' }
    };
  } catch (e) {
    return {
      text: null,
      error: { status: 0, type: 'network', message: e.message || 'fetch falhou' }
    };
  }
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
// HELPERS — Chamar handlers internos dos bancos
// ══════════════════════════════════════════════════════════════
async function callBankApi(bank, payload) {
  // Usa x-internal-secret (WEBHOOK_SECRET) — nao expira, mais robusto
  // Fallback pra INTERNAL_SERVICE_TOKEN se WEBHOOK_SECRET nao tiver setado
  const secret = WEBHOOK_SECRET();
  const headers = { 'Content-Type': 'application/json' };
  if (secret) {
    headers['x-internal-secret'] = secret;
  } else {
    headers['Authorization'] = 'Bearer ' + INTERNAL_TOKEN();
  }
  const r = await fetch(APP_URL() + '/api/' + bank, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 500) }; }
  return { ok: r.ok, status: r.status, data: d };
}

// ══════════════════════════════════════════════════════════════
// ENRIQUECIMENTO — tenta preencher dados via PresençaBank
// (fluxo: gerarTermo -> aguarda aceite -> consultarVinculos -> consultarMargem)
// A margem retorna nome/dataNascimento/nomeMae/sexo → economia grande na coleta
// ══════════════════════════════════════════════════════════════
async function enriquecerComPresencaBank(cpf, nome, telefone) {
  try {
    // 1) Gerar termo (se ainda não tiver)
    const termo = await callBankApi('presencabank', {
      action: 'gerarTermo', cpf, nome, telefone
    });
    // 2) Consultar vínculos (só funciona depois do aceite do termo pelo cliente)
    const vinc = await callBankApi('presencabank', {
      action: 'consultarVinculos', cpf
    });
    if (!vinc.ok || !vinc.data?.temVinculo) {
      return { termoLink: termo.data?.link, vinculo: null, enriquecido: false };
    }
    const v = vinc.data.vinculos[0];
    // 3) Consultar margem (traz nome, nomeMae, dataNascimento, sexo)
    const marg = await callBankApi('presencabank', {
      action: 'consultarMargem', cpf, matricula: v.matricula, cnpj: v.cnpj
    });
    return {
      termoLink: termo.data?.link,
      vinculo: { matricula: v.matricula, cnpj: v.cnpj, empregador: v.empregador },
      dadosCliente: marg.data?.dadosCliente || {},
      margem: marg.data?.margemDisponivel || 0,
      enriquecido: true
    };
  } catch (e) {
    return { enriquecido: false, erro: e.message };
  }
}

// ══════════════════════════════════════════════════════════════
// AÇÕES — executadas após Claude retornar [ACAO:X]
// ══════════════════════════════════════════════════════════════
async function executarAcao(acao, conversa, dadosNovos, config) {
  const cpf = (dadosNovos.cpf || conversa.cpf || '').replace(/\D/g, '');
  const nome = dadosNovos.nome || conversa.nome || '';
  const ordem = config.ordem_bancos || ['c6', 'presencabank', 'joinbank'];

  if (acao === 'INICIAR_SIMULACAO') {
    if (!cpf || cpf.length !== 11) return { ok: false, erro: 'CPF inválido' };

    // ETAPA A: Consulta basica em paralelo (rapida, ~5-8s)
    const r = await callBankApi('clt-oportunidades', { cpf, incluirC6: false });
    if (!r.ok || !r.data?.success) {
      return { ok: false, erro: 'Falha ao consultar bancos', _raw: r.data };
    }

    const cliente = r.data.cliente || {};
    const ofertasBasicas = r.data.ofertas || [];
    const telPrincipal = cliente.telefones?.[0]?.completo;

    // ETAPA B: Pra cada oferta DISPONIVEL, dispara simulacao detalhada em paralelo
    // (rola em background nao bloqueando — limite 12s no agente)
    const tarefasDetalhe = [];
    for (const o of ofertasBasicas) {
      if (!o.disponivel) continue;
      if (o.banco === 'presencabank' && cliente.nome && telPrincipal) {
        tarefasDetalhe.push(
          callBankApi('clt-simular-detalhe', {
            banco: 'presencabank', cpf, nome: cliente.nome, telefone: telPrincipal
          }).then(res => ({ ...res.data, _ofertaIdx: ofertasBasicas.indexOf(o) }))
            .catch(() => null)
        );
      }
      if (o.banco === 'v8' && o.consultId) {
        tarefasDetalhe.push(
          callBankApi('clt-simular-detalhe', {
            banco: 'v8', cpf,
            provider: o.provider,
            consultId: o.consultId,
            margem: o.elegibilidade?.margemDisponivel || 0
          }).then(res => ({ ...res.data, _ofertaIdx: ofertasBasicas.indexOf(o) }))
            .catch(() => null)
        );
      }
    }

    // Aguarda detalhes (max ~15s — algumas podem falhar/timeout, ok)
    const detalhes = await Promise.all(tarefasDetalhe);

    // Mescla detalhes nas ofertas basicas
    for (const det of detalhes) {
      if (!det || !det.success || det._ofertaIdx === undefined) continue;
      const o = ofertasBasicas[det._ofertaIdx];
      if (o && det.detalhes) {
        o.detalhes = det.detalhes;
        if (det.idSimulacao) o.idSimulacao = det.idSimulacao;
        if (det.type) o.type = det.type;
      }
    }

    return {
      ok: true,
      cliente,
      vinculo: r.data.vinculo,
      ofertas: ofertasBasicas,
      totalDisponivel: ofertasBasicas.filter(o => o.disponivel).length,
      mensagem: r.data.mensagem
    };
  }

  if (acao === 'GERAR_AUTORIZACAO_C6') {
    if (!cpf) return { ok: false, erro: 'Sem CPF do cliente.' };

    // PRE-CHECK: cliente ja tem autorizacao? Se sim, nao precisa gerar link novo.
    const status = await callBankApi('c6', { action: 'statusAutorizacao', cpf });
    if (status.ok && (status.data?.autorizado === true || status.data?.statusAutorizacao === 'AUTORIZADO')) {
      return {
        ok: true,
        ja_autorizado: true,
        link: null,
        mensagem: 'Cliente já tem autorização válida. Não precisa enviar selfie.'
      };
    }

    if (!nome || !conversa.data_nascimento) {
      return { ok: false, erro: 'Faltam dados básicos do cliente (nome ou data de nascimento).' };
    }
    const tel = conversa.telefone.replace(/^55/, '');
    const ddd = tel.substring(0, 2);
    const num = tel.substring(2);
    const r = await callBankApi('c6', {
      action: 'gerarLinkAutorizacao', cpf, nome,
      dataNascimento: conversa.data_nascimento, ddd, telefone: num
    });
    return { ok: r.ok, link: r.data?.link, data: r.data };
  }

  if (acao === 'VERIFICAR_AUTORIZACAO') {
    const r = await callBankApi('c6', { action: 'statusAutorizacao', cpf });
    return {
      ok: r.ok,
      autorizado: r.data?.autorizado || false,
      status: r.data?.statusAutorizacao
    };
  }

  if (acao === 'RESIMULAR' || acao === 'SIMULAR_C6_COMPLETO') {
    // Re-simula nos bancos onde cliente já tem oferta, com novos parâmetros
    // Suporta: valor_solicitado, valor_parcela, prazo (qualquer um)
    const valorSolicitado = parseFloat(dadosNovos.valor_solicitado || conversa.dados?.valor_solicitado || 0);
    const valorParcela = parseFloat(dadosNovos.valor_parcela_desejado || dadosNovos.valor_parcela || 0);
    const prazo = parseInt(dadosNovos.prazo || conversa.dados?.prazo || 0);

    const ofertasAtuais = conversa.ofertas || [];
    const tarefas = [];
    for (const o of ofertasAtuais) {
      if (!o.disponivel) continue;
      if (o.banco === 'v8' && o.consultId) {
        tarefas.push(
          callBankApi('clt-simular-detalhe', {
            banco: 'v8', cpf,
            provider: o.provider, consultId: o.consultId,
            margem: o.elegibilidade?.margemDisponivel || 0,
            valorDesejado: valorSolicitado,
            valorParcelaDesejado: valorParcela,
            numeroParcelasDesejado: prazo
          }).then(res => ({ ...res.data, _ofertaIdx: ofertasAtuais.indexOf(o) }))
            .catch(() => null)
        );
      }
      // PB e C6: por enquanto não re-simulam (PB precisa fluxo grande, C6 precisa selfie)
      // Se quiser resimular C6: cliente já autorizou, valoria $valorSolicitado
    }

    const detalhes = await Promise.all(tarefas);
    const ofertasNovas = [...ofertasAtuais];
    const sucessos = [];
    const falhas = [];
    for (const det of detalhes) {
      if (!det || det._ofertaIdx === undefined) continue;
      if (det.success) {
        const o = { ...ofertasNovas[det._ofertaIdx] };
        if (det.detalhes) o.detalhes = det.detalhes;
        if (det.idSimulacao) o.idSimulacao = det.idSimulacao;
        ofertasNovas[det._ofertaIdx] = o;
        sucessos.push(o);
      } else {
        falhas.push({
          banco: ofertasNovas[det._ofertaIdx]?.banco,
          provider: ofertasNovas[det._ofertaIdx]?.provider,
          ofertaIdx: det._ofertaIdx,
          excedeuMargem: det.excedeuMargem || false,
          margemMaxima: det.margemMaxima,
          valorMaximoEstimado: det.valorMaximoCalculadoLiquido,
          mensagem: det.mensagem
        });
      }
    }

    // Se TUDO falhou por excedeu margem, REFAZ automaticamente com a margem máxima
    // pra apresentar uma oferta CONCRETA (não estimativa)
    let ofertaMaximaReal = null;
    if (sucessos.length === 0 && falhas.some(f => f.excedeuMargem)) {
      const tarefasMax = [];
      for (const f of falhas) {
        if (!f.excedeuMargem || !f.margemMaxima) continue;
        const o = ofertasNovas[f.ofertaIdx];
        if (o.banco === 'v8' && o.consultId) {
          tarefasMax.push(
            callBankApi('clt-simular-detalhe', {
              banco: 'v8', cpf,
              provider: o.provider, consultId: o.consultId,
              margem: f.margemMaxima,
              valorParcelaDesejado: f.margemMaxima,
              numeroParcelasDesejado: prazo // mantém prazo do cliente se possível
            }).then(res => ({ ...res.data, _ofertaIdx: f.ofertaIdx }))
              .catch(() => null)
          );
        }
      }
      const detalhesMax = await Promise.all(tarefasMax);
      for (const det of detalhesMax) {
        if (!det || !det.success || det._ofertaIdx === undefined) continue;
        const o = { ...ofertasNovas[det._ofertaIdx] };
        if (det.detalhes) o.detalhes = det.detalhes;
        if (det.idSimulacao) o.idSimulacao = det.idSimulacao;
        ofertasNovas[det._ofertaIdx] = o;
        ofertaMaximaReal = o;
        break; // primeira que funcionar
      }
    }

    const c6Bloqueado = ofertasNovas.find(o => o.banco === 'c6' && o.bloqueado);

    return {
      ok: true,
      ofertas: ofertasNovas,
      sucessos: sucessos.length,
      falhas,
      excedeuMargem: falhas.some(f => f.excedeuMargem),
      maiorMargemMaxima: Math.max(...falhas.filter(f => f.margemMaxima).map(f => f.margemMaxima), 0),
      ofertaMaximaReal, // simulação real com a margem máxima (quando cliente pediu mais que dá)
      c6Bloqueado: !!c6Bloqueado,
      parametros: { valorSolicitado, valorParcela, prazo },
      mensagem: sucessos.length > 0
        ? `${sucessos.length} oferta(s) re-simulada(s)`
        : (ofertaMaximaReal ? 'Excedeu margem — apresentando MAXIMO possivel'
                            : 'Nenhuma simulação retornou')
    };
  }

  // ═══ COLETAR_DADOS — cliente aceitou oferta, hora de completar dados ═══
  // Consulta NovaVida (que traz endereco+email+telefones) pra preencher
  // automaticamente o que o cliente nao precisa digitar. Persiste tudo
  // em clt_clientes E atualiza conversa.dados pro Claude saber.
  if (acao === 'COLETAR_DADOS') {
    const cpf = conversa.cpf || (conversa.dados?.cpf);
    if (!cpf) return { ok: false, mensagem: 'Sem CPF na conversa pra consultar NovaVida' };

    const nvRes = await callBankApi('novavida', { cpf });
    const nv = nvRes?.data || {};
    const dadosAtuais = conversa.dados || {};
    const enriquecidos = {};

    if (nv.success || nv.nome || (nv.telefones || []).length > 0) {
      // Email — primeiro disponivel
      const email = (nv.emails || []).find(e => e && e.includes('@'));
      if (email && !dadosAtuais.email && !conversa.email) enriquecidos.email = email;

      // Endereco — primeiro
      const end = (nv.enderecos || [])[0];
      if (end) {
        if (end.cep && !dadosAtuais.cep && !conversa.cep) enriquecidos.cep = String(end.cep).replace(/\D/g, '');
        if (end.logradouro && !dadosAtuais.rua && !conversa.rua) enriquecidos.rua = end.logradouro;
        if (end.numero && !dadosAtuais.numero_end && !conversa.numero_end) enriquecidos.numero_end = end.numero;
        if (end.complemento && !dadosAtuais.complemento) enriquecidos.complemento = end.complemento;
        if (end.bairro && !dadosAtuais.bairro && !conversa.bairro) enriquecidos.bairro = end.bairro;
        if (end.cidade && !dadosAtuais.cidade && !conversa.cidade) enriquecidos.cidade = end.cidade;
        if (end.uf && !dadosAtuais.uf && !conversa.uf) enriquecidos.uf = end.uf;
      }

      // Atualiza conversa.dados se tem algo novo
      if (Object.keys(enriquecidos).length > 0) {
        await updateConversa(conversa.id, {
          dados: { ...dadosAtuais, ...enriquecidos }
        });
      }

      // Persiste em clt_clientes (UPSERT por cpf) — aproveita TUDO que NovaVida trouxe
      try {
        const limpo = {
          cpf,
          nome: nv.nome || conversa.nome || null,
          email: email || null,
          emails: nv.emails || [],
          telefones: nv.telefones || [],
          enderecos: nv.enderecos || [],
          cep: enriquecidos.cep || null,
          rua: enriquecidos.rua || null,
          numero_end: enriquecidos.numero_end || null,
          complemento: enriquecidos.complemento || null,
          bairro: enriquecidos.bairro || null,
          cidade: enriquecidos.cidade || null,
          uf: enriquecidos.uf || null,
          obito: !!nv.obito,
          ultima_consulta_at: new Date().toISOString()
        };
        // Filtra null/empty/empty-array
        for (const k of Object.keys(limpo)) {
          const v = limpo[k];
          if (v === null || v === undefined) delete limpo[k];
          else if (typeof v === 'string' && v.trim() === '') delete limpo[k];
          else if (Array.isArray(v) && v.length === 0) delete limpo[k];
        }
        limpo.cpf = cpf; // garante CPF
        await dbUpsert('clt_clientes', limpo, 'cpf');
      } catch { /* nao quebra fluxo */ }
    }

    return {
      ok: true,
      acao: 'COLETAR_DADOS',
      novaVidaConsultada: true,
      enriquecidos,
      faltam: ['email','cep','rua','numero_end','bairro','cidade','uf','chave_pix']
        .filter(c => !{ ...dadosAtuais, ...enriquecidos }[c] && !conversa[c]),
      mensagem: Object.keys(enriquecidos).length > 0
        ? `Preenchi automaticamente: ${Object.keys(enriquecidos).join(', ')}`
        : 'NovaVida nao trouxe dados novos — agente vai pedir tudo pro cliente'
    };
  }

  return { ok: true, noop: true };
}

// ══════════════════════════════════════════════════════════════
// WEBHOOK VALIDATION
// ══════════════════════════════════════════════════════════════
// IMPORTANTE: Evolution NAO envia x-webhook-secret automatico.
// Se quiser validacao real, configurar Evolution pra incluir header
// custom OU validar via apikey (que ele ja envia).
// Por enquanto, aceita qualquer webhook que tenha shape valido
// (verificacao do shape feita no proprio handler).
function verifyWebhookSecret(req) {
  // Aceita tudo - shape do payload eh validado adiante
  return true;
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

      // WhatsApp introduziu LID (Linked Identity) que mascara o numero real.
      // Quando addressingMode === 'lid', o JID em remoteJid eh um ID anonimo
      // (ex: 260266461782095@lid) e o NUMERO REAL vem em remoteJidAlt.
      // Sem esse fix, conversas com @lid criariam telefones bizarros e nao
      // dariam pra mandar resposta de volta (sendText precisa @s.whatsapp.net).
      let jid = data.key.remoteJid || '';
      if (data.key.addressingMode === 'lid' && data.key.remoteJidAlt) {
        jid = data.key.remoteJidAlt;
      } else if (jid.endsWith('@lid') && data.key.remoteJidAlt) {
        // fallback: as vezes addressingMode nao vem mas remoteJidAlt sim
        jid = data.key.remoteJidAlt;
      }
      if (jid.includes('@g.us')) return jsonResp({ ok: true, skip: 'group' }, 200, req);
      if (jid.endsWith('@lid')) {
        // Veio @lid mas SEM remoteJidAlt — nao dá pra responder. Loga e ignora.
        console.log('[LID_SEM_ALT]', { jid, fullKey: data.key, pushName: data.pushName });
        return jsonResp({ ok: true, skip: 'lid_sem_remoteJidAlt', jid }, 200, req);
      }

      // Limpa qualquer sufixo conhecido pra ficar so com numero limpo
      const telefone = jid.replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/@.*$/, '');
      const msgContent = extractMessageContent(data);
      const instance = body.instance || CLT_INSTANCE();
      const pushName = data.pushName || '';

      // ─── WHITELIST (modo teste) ───
      const wl = WHITELIST();
      if (wl.length > 0 && !wl.includes('*') && !wl.includes(telefone)) {
        return jsonResp({ ok: true, skip: 'whitelist', telefone }, 200, req);
      }

      // ─── Busca ou cria conversa ───
      const conversa = await getOrCreateConversa(telefone, instance);

      if (conversa.pausada_por_humano) {
        return jsonResp({ ok: true, skip: 'pausada_humano' }, 200, req);
      }

      // ─── Lida com texto/audio/imagem/pdf/outros ───
      let textoDoCliente = '';
      let imageBlock = null;     // bloco de imagem pro Claude (multimodal)
      let documentBlock = null;  // bloco de PDF pro Claude (multimodal)

      if (msgContent.type === 'text') {
        textoDoCliente = msgContent.text;

      } else if (msgContent.type === 'audio_needs_download') {
        // Baixa o audio do Evolution e transcreve via Groq Whisper
        const dl = await downloadMediaFromEvolution(data, instance);
        if (!dl.base64) {
          await logEvento(conversa.id, telefone, 'audio_download_falhou', dl.error);
          await sendMsg(instance, telefone, 'Ops, não consegui baixar seu áudio 😅 Pode escrever pra mim?');
          return jsonResp({ ok: true, handled: 'audio_download_fail' }, 200, req);
        }
        const tr = await transcribeAudioGroq(dl.base64, dl.mimetype || msgContent.mimetype);
        if (!tr.text) {
          await logEvento(conversa.id, telefone, 'audio_transcricao_falhou', { error: tr.error, mime: dl.mimetype });
          await sendMsg(instance, telefone, 'Não consegui ouvir o áudio aqui 😅 Pode escrever pra mim?');
          return jsonResp({ ok: true, handled: 'audio_transcribe_fail' }, 200, req);
        }
        textoDoCliente = tr.text;
        await logEvento(conversa.id, telefone, 'audio_transcrito', {
          texto: tr.text.substring(0, 200), seconds: msgContent.seconds
        });

      } else if (msgContent.type === 'image_needs_download') {
        // Baixa imagem completa (nao thumbnail)
        const dl = await downloadMediaFromEvolution(data, instance);
        textoDoCliente = msgContent.caption || '(cliente enviou uma imagem sem legenda)';
        if (dl.base64) {
          // Claude aceita image/jpeg, image/png, image/gif, image/webp
          let mime = dl.mimetype || msgContent.mimetype || 'image/jpeg';
          if (!['image/jpeg','image/png','image/gif','image/webp'].includes(mime)) mime = 'image/jpeg';
          imageBlock = {
            type: 'image',
            source: { type: 'base64', media_type: mime, data: dl.base64 }
          };
          await logEvento(conversa.id, telefone, 'imagem_baixada', { bytes: dl.base64.length, mime });
        } else {
          await logEvento(conversa.id, telefone, 'imagem_download_falhou', dl.error);
        }

      } else if (msgContent.type === 'pdf_needs_download') {
        // Baixa PDF e manda pro Claude como document
        const dl = await downloadMediaFromEvolution(data, instance);
        textoDoCliente = msgContent.caption || `(cliente enviou um PDF: ${msgContent.fileName || 'sem nome'})`;
        if (dl.base64) {
          documentBlock = {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: dl.base64 }
          };
          await logEvento(conversa.id, telefone, 'pdf_baixado', { bytes: dl.base64.length, fileName: msgContent.fileName });
        } else {
          await logEvento(conversa.id, telefone, 'pdf_download_falhou', dl.error);
          await sendMsg(instance, telefone, 'Ops, não consegui abrir seu PDF 😅 Pode tentar mandar de novo?');
          return jsonResp({ ok: true, handled: 'pdf_download_fail' }, 200, req);
        }

      } else if (msgContent.type === 'document_ignored') {
        await sendMsg(instance, telefone, `Recebi seu arquivo, mas só consigo ler PDF, imagens e áudio. Você pode mandar como PDF ou tirar foto? 📄`);
        return jsonResp({ ok: true, handled: 'doc_ignored', mime: msgContent.mimetype }, 200, req);
      } else if (msgContent.type === 'video_ignored' || msgContent.type === 'sticker_ignored') {
        await sendMsg(instance, telefone, 'Recebi! Mas no momento trabalho só com texto, imagem, áudio e PDF. Pode me escrever?');
        return jsonResp({ ok: true, handled: 'media_ignored' }, 200, req);
      } else {
        return jsonResp({ ok: true, skip: 'unknown_message_type' }, 200, req);
      }

      await logEvento(conversa.id, telefone, 'msg_recebida', {
        tipo: msgContent.type, texto: textoDoCliente.substring(0, 200)
      });

      // ─── DEBOUNCE: agrupa msgs em rajada (so pra texto, sem comandos) ───
      // Cliente costuma mandar 3-4 msgs seguidas ("oi" "tudo bem?" "queria saber...").
      // Em vez de responder cada uma, esperamos 5s. Se chegar msg nova nesse meio,
      // o handler atual aborta e o handler MAIS NOVO eh quem processa o lote.
      const ehTextoComum = msgContent.type === 'text' && !textoDoCliente.trim().startsWith('/');
      if (ehTextoComum) {
        const meuTs = Date.now();
        const dadosAtuais = conversa.dados || {};
        const bufferAtual = Array.isArray(dadosAtuais.__buffer?.msgs) ? dadosAtuais.__buffer.msgs : [];
        bufferAtual.push({ texto: textoDoCliente, ts: meuTs });
        await updateConversa(conversa.id, {
          dados: { ...dadosAtuais, __buffer: { msgs: bufferAtual, ts: meuTs } }
        });

        // Aguarda 5s pra ver se chegam mais mensagens
        await new Promise(r => setTimeout(r, 5000));

        // Re-checa: se chegou msg nova (ts maior que o meu), eu aborto — o outro handler vai processar
        const fresh = (await dbSelect('clt_conversas', { filters: { id: conversa.id }, single: true }))?.data;
        const freshTs = fresh?.dados?.__buffer?.ts || 0;
        if (freshTs > meuTs) {
          await logEvento(conversa.id, telefone, 'msg_debounced', { meuTs, freshTs, texto: textoDoCliente.substring(0, 100) });
          return jsonResp({ ok: true, debounced: true }, 200, req);
        }

        // Sou o "chosen one" — processo TODAS as msgs do buffer juntas
        const msgsBuffer = Array.isArray(fresh?.dados?.__buffer?.msgs) ? fresh.dados.__buffer.msgs : bufferAtual;
        if (msgsBuffer.length > 1) {
          textoDoCliente = msgsBuffer.map(m => m.texto).join('\n');
          await logEvento(conversa.id, telefone, 'msgs_agrupadas', {
            count: msgsBuffer.length, texto_final: textoDoCliente.substring(0, 200)
          });
        }

        // Limpa o buffer + atualiza conversa local
        const dadosClean = { ...(fresh?.dados || {}) };
        delete dadosClean.__buffer;
        await updateConversa(conversa.id, { dados: dadosClean });
        if (fresh) {
          conversa.dados = dadosClean;
          conversa.historico = fresh.historico;
          conversa.etapa = fresh.etapa;
          conversa.consentimento_lgpd = fresh.consentimento_lgpd;
          conversa.ofertas = fresh.ofertas;
          conversa.banco_escolhido = fresh.banco_escolhido;
        }
      }

      // ─── Comandos especiais ───
      if (textoDoCliente.trim().toLowerCase() === '/pausa') {
        await updateConversa(conversa.id, { pausada_por_humano: true });
        await sendMsg(instance, telefone, '⏸️ Atendimento pausado. Um consultor humano vai continuar com você em breve.');
        return jsonResp({ ok: true, paused: true }, 200, req);
      }
      if (textoDoCliente.trim().toLowerCase() === '/reiniciar') {
        await updateConversa(conversa.id, {
          etapa: 'inicio', ofertas: [], dados: {}, historico: [],
          banco_escolhido: null, proposta_numero: null, link_formalizacao: null,
          consentimento_lgpd: false, consentimento_lgpd_at: null
        });
        await sendMsg(instance, telefone, '🔄 Conversa reiniciada. Como posso te ajudar?');
        return jsonResp({ ok: true, restarted: true }, 200, req);
      }

      // ─── Carrega config global ───
      const config = await getConfig();

      // ─── Detecta consentimento LGPD se ainda não deu ───
      const textoLower = textoDoCliente.toLowerCase().trim();
      if (!conversa.consentimento_lgpd && conversa.etapa === 'aguardando_consentimento_lgpd') {
        if (/\b(sim|autorizo|autorizado|pode|concordo|beleza|ok)\b/.test(textoLower)) {
          await updateConversa(conversa.id, {
            consentimento_lgpd: true,
            consentimento_lgpd_at: new Date().toISOString(),
            consentimento_lgpd_texto: textoDoCliente.substring(0, 500),
            etapa: 'coletando_cpf'
          });
          await logEvento(conversa.id, telefone, 'lgpd_autorizado');
        } else if (/\b(não|nao|recusa|negativo|recuso)\b/.test(textoLower)) {
          await updateConversa(conversa.id, { ativo: false, etapa: 'fechada_sem_venda' });
          await sendMsg(instance, telefone, 'Tranquilo! Sem problema nenhum. Se mudar de ideia é só chamar. 😊');
          await logEvento(conversa.id, telefone, 'lgpd_recusado');
          return jsonResp({ ok: true, lgpd_denied: true }, 200, req);
        }
      }

      // ─── Persona: busca do user que disparou OU default ───
      const nomeVendedor = conversa.nome_vendedor || 'LhamasCred';
      const nomeParceiro = conversa.nome_parceiro || 'LhamasCred';

      // ─── Monta contexto ───
      const historico = Array.isArray(conversa.historico) ? conversa.historico : [];
      const contextParts = [
        '[CONTEXTO DO SISTEMA — NÃO MOSTRAR AO CLIENTE]',
        `Telefone: ${telefone}`,
        `Etapa atual: ${conversa.etapa}`,
        `Consentimento LGPD: ${conversa.consentimento_lgpd ? 'SIM' : 'ainda não'}`,
        `Persona: você é ${nomeVendedor} da ${nomeParceiro}`,
        `Ordem dos bancos hoje (NUNCA mencionar nomes): ${config.ordem_bancos.join(' → ')}`,
      ];

      // ── DADOS JÁ CONHECIDOS DO CLIENTE (do enriquecimento) ──
      // Lista TUDO que sabemos pra Claude NÃO pedir de novo
      const dadosCli = conversa.dados || {};
      const dadosConhecidos = [];
      if (conversa.nome) dadosConhecidos.push(`Nome: ${conversa.nome}`);
      if (conversa.cpf) dadosConhecidos.push(`CPF: ${conversa.cpf}`);
      if (conversa.data_nascimento) dadosConhecidos.push(`Data Nasc: ${conversa.data_nascimento}`);
      if (conversa.sexo) dadosConhecidos.push(`Sexo: ${conversa.sexo}`);
      if (dadosCli.nome_mae || conversa.dados?.nome_mae) dadosConhecidos.push(`Nome da Mãe: ${dadosCli.nome_mae || conversa.dados.nome_mae}`);
      if (dadosCli.empregador_nome) dadosConhecidos.push(`Empregador: ${dadosCli.empregador_nome}`);
      if (dadosCli.empregador_cnpj) dadosConhecidos.push(`CNPJ: ${dadosCli.empregador_cnpj}`);
      if (dadosCli.matricula) dadosConhecidos.push(`Matrícula: ${dadosCli.matricula}`);
      if (dadosCli.renda) dadosConhecidos.push(`Renda: R$ ${Number(dadosCli.renda).toFixed(2)}`);
      if (telefone) dadosConhecidos.push(`Telefone WA: ${telefone}`);

      contextParts.push('\n═══ DADOS JÁ CONHECIDOS (NUNCA peça esses ao cliente) ═══');
      contextParts.push(dadosConhecidos.length ? dadosConhecidos.join(' · ') : 'Nenhum ainda');

      // Faltantes pra digitação
      const camposNecessarios = ['email', 'cep', 'rua', 'numero_end', 'bairro', 'cidade', 'uf', 'pix_key'];
      const faltantes = camposNecessarios.filter(c => !dadosCli[c] && !conversa[c]);
      if (faltantes.length && conversa.etapa === 'apresentando_ofertas' || conversa.etapa === 'coletando_dados') {
        contextParts.push(`\n📋 Pra digitar proposta, ainda FALTA: ${faltantes.join(', ')}`);
      }

      if (Array.isArray(conversa.ofertas) && conversa.ofertas.length > 0) {
        contextParts.push('\n═══ OFERTAS JÁ SIMULADAS (cliente já viu essas) ═══');
        const ofertasComDetalhe = conversa.ofertas.filter(o => o.disponivel && o.detalhes?.valorLiquido);
        for (const o of ofertasComDetalhe.slice(0, 5)) {
          const d = o.detalhes;
          const vl = Number(d.valorLiquido || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
          const vp = Number(d.valorParcela || 0).toFixed(2);
          const idSim = o.idSimulacao || '?';
          // NUNCA injetar taxaMensal/cetMensal aqui — Claude alucina interpretando o decimal
          // (caso real: cliente perguntou taxa, Claude inventou "0,05% ao mes" depois "4,98% ao mes" depois "ao ano"...)
          contextParts.push(`• ${o.banco.toUpperCase()}${o.provider?'/'+o.provider:''}: R$ ${vl} liquido | ${d.parcelas}x R$ ${vp} | id_simulacao=${idSim}`);
        }
        const elegiveis = conversa.ofertas.filter(o => o.disponivel && !o.detalhes?.valorLiquido && o.elegibilidade);
        for (const o of elegiveis) {
          contextParts.push(`• ${o.banco.toUpperCase()}: ELEGIVEL — margem R$ ${(o.elegibilidade.margemDisponivel||0).toFixed(2)} (sem simulacao detalhada ainda)`);
        }
        const bloqueadas = conversa.ofertas.filter(o => o.bloqueado);
        for (const o of bloqueadas) {
          contextParts.push(`• ${o.banco.toUpperCase()}: BLOQUEADO — exige selfie do cliente (oferecer se cliente quiser explorar mais)`);
        }
        contextParts.push(`\n⚡ ATENCAO: Se cliente acabou de ACEITAR uma oferta (disse 'topo', 'pode ser', 'quero essa', 'fechado', 'bora', etc), responda com:\n   [DADO:banco_escolhido=<banco_da_oferta_aceita>]\n   [DADO:id_simulacao_escolhida=<id_simulacao>]\n   [ACAO:COLETAR_DADOS]\n   Mensagem: "Show, [Nome]! Pra fechar a proposta de R$ X em Yx, vou precisar de uns dados. Pode me passar..."\n\nNAO escale pra humano se a re-simulacao funcionou. Se cliente aceitou, parta pra coleta.`);
      }

      if (conversa.banco_escolhido) {
        contextParts.push(`\nBanco escolhido pelo cliente: ${conversa.banco_escolhido}`);
      }

      if (conversa.dados && Object.keys(conversa.dados).length > 0) {
        contextParts.push(`\nDados já coletados: ${JSON.stringify(conversa.dados)}`);
      }

      if (!conversa.consentimento_lgpd && conversa.etapa === 'inicio') {
        contextParts.push('\n⚡ PRIMEIRA INTERAÇÃO — apresente-se, peça consentimento LGPD, mude pra [FASE:aguardando_consentimento_lgpd]');
      }

      contextParts.push(`\nMensagem do cliente: "${textoDoCliente}"`);

      // ─── Monta messages pro Claude ───
      const claudeMessages = [];
      for (const h of historico.slice(-14)) {
        claudeMessages.push({ role: h.role, content: h.content });
      }

      // Mensagem atual (texto, texto+imagem, ou texto+pdf)
      const contextContent = contextParts.join('\n');
      if (imageBlock || documentBlock) {
        const parts = [];
        if (documentBlock) parts.push(documentBlock); // PDF antes do texto pra Claude analisar primeiro
        if (imageBlock) parts.push(imageBlock);
        parts.push({ type: 'text', text: contextContent });
        claudeMessages.push({ role: 'user', content: parts });
      } else {
        claudeMessages.push({ role: 'user', content: contextContent });
      }

      // Dedupe roles consecutivos
      const cleanMsgs = [];
      let lastRole = null;
      for (const m of claudeMessages) {
        if (m.role === lastRole && typeof m.content === 'string' && typeof cleanMsgs[cleanMsgs.length-1]?.content === 'string') {
          cleanMsgs[cleanMsgs.length - 1].content += '\n' + m.content;
        } else {
          cleanMsgs.push({ ...m });
          lastRole = m.role;
        }
      }

      // ─── Chama Claude ───
      const systemPrompt = config.prompt_override
        || buildSystemPrompt(nomeVendedor, nomeParceiro, config.ordem_bancos, config.modo_insistencia);

      const cr = await callClaude(cleanMsgs, systemPrompt);
      const reply = cr.text;
      if (!reply) {
        // Loga o erro REAL (status, type, message) pra debug no painel
        await logEvento(conversa.id, telefone, 'claude_erro', cr.error || { status: 0, message: 'sem detalhes' });
        // NAO envia fallback generico - evita loop "tive problema tecnico" repetido.
        // Cliente fica sem resposta e voce ve o erro nos eventos pra corrigir.
        return jsonResp({ error: 'claude_no_response', detail: cr.error }, 500, req);
      }

      const { clean: cleanReply, actions, fase, dados } = parseResponse(reply);

      // ─── Persiste ───
      const patchConversa = {};
      if (fase) patchConversa.etapa = fase;
      if (dados.nome) patchConversa.nome = dados.nome;
      if (dados.cpf) patchConversa.cpf = String(dados.cpf).replace(/\D/g, '');
      if (dados.data_nascimento) patchConversa.data_nascimento = dados.data_nascimento;
      if (dados.sexo) patchConversa.sexo = dados.sexo;
      if (dados.email) patchConversa.email = dados.email;
      if (dados.banco_escolhido) patchConversa.banco_escolhido = dados.banco_escolhido;
      if (dados.id_simulacao_escolhida) patchConversa.id_simulacao_escolhida = dados.id_simulacao_escolhida;

      const camposJsonb = ['nome_mae','rg_numero','rg_orgao','rg_uf','rg_data',
        'cep','rua','numero_end','complemento','bairro','cidade','uf',
        'banco_deposito','agencia','conta','digito_conta','tipo_conta',
        'empregador_cnpj','empregador_nome','matricula','cargo','salario',
        'chave_pix','tipo_chave_pix','valor_solicitado','prazo'];
      const dadosJsonbNovo = { ...(conversa.dados || {}) };
      for (const c of camposJsonb) {
        if (dados[c] !== undefined) dadosJsonbNovo[c] = dados[c];
      }
      patchConversa.dados = dadosJsonbNovo;

      // Histórico (cap 40)
      const novoHistorico = [...historico,
        { role: 'user', content: textoDoCliente, ts: new Date().toISOString() },
        { role: 'assistant', content: cleanReply, ts: new Date().toISOString() }
      ].slice(-40);
      patchConversa.historico = novoHistorico;

      await updateConversa(conversa.id, patchConversa);

      // ─── ENVIA 1ª MENSAGEM PRIMEIRO (resposta imediata do Claude) ───
      // ANTES de executar actions/follow-up, pra cliente receber na ordem certa.
      // Sem isso, follow-up ('aqui está a oferta') chegava ANTES da resposta original
      // ('vou consultar...') por causa do tempo de execução das actions.
      let _mensagemEnviada = null;
      if (cleanReply) {
        let mensagemFinal = cleanReply;
        // Reservamos a substituição de link C6 pra DEPOIS porque depende de action
        if (mensagemFinal.length > 500) {
          const partes = mensagemFinal.split('\n\n').filter(p => p.trim());
          for (let i = 0; i < partes.length; i++) {
            await sendMsg(instance, telefone, partes[i].trim());
            if (i < partes.length - 1) await new Promise(r => setTimeout(r, 1200));
          }
        } else {
          await sendMsg(instance, telefone, mensagemFinal);
        }
        _mensagemEnviada = mensagemFinal;
        await logEvento(conversa.id, telefone, 'msg_enviada', {
          texto: mensagemFinal.substring(0, 200), actions
        });
      }

      // ─── Executa ações (DEPOIS da 1ª mensagem) ───
      const acoesResultado = {};
      for (const acao of actions) {
        const merged = { ...conversa, ...patchConversa };
        const r = await executarAcao(acao, merged, dados, config);
        acoesResultado[acao] = r;
        await logEvento(conversa.id, telefone, 'acao_' + acao.toLowerCase(), r);

        if (acao === 'RESIMULAR' && r.ok && r.ofertas) {
          await updateConversa(conversa.id, { ofertas: r.ofertas });
          await logEvento(conversa.id, telefone, 'resimulacao_ok', {
            parametros: r.parametros, sucessos: r.sucessos, excedeuMargem: r.excedeuMargem
          });

          try {
            const ordemPrioridade = config.ordem_bancos || ['v8', 'presencabank', 'c6'];
            const ofertasOrdenadas = [...r.ofertas].sort((a, b) => {
              const ia = ordemPrioridade.indexOf(a.banco);
              const ib = ordemPrioridade.indexOf(b.banco);
              return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
            });
            const primeira = ofertasOrdenadas.find(o => o.disponivel && o.detalhes?.valorLiquido);

            let contextoResim;
            if (primeira) {
              // CENÁRIO 1: Re-simulação OK — apresenta nova oferta
              const d = primeira.detalhes;
              contextoResim = `[CONTEXTO INTERNO — RE-SIMULACAO PRONTA]
Cliente pediu nova simulacao com parametros: ${JSON.stringify(r.parametros)}.
Nova proposta:
💰 R$ ${Number(d.valorLiquido).toFixed(2)} liberado
📅 ${d.parcelas}x de R$ ${Number(d.valorParcela).toFixed(2)}
Apresente APENAS essa oferta ao cliente em tom natural, SEM mencionar nome do banco.
Pergunte se topa essa ou se quer ajustar valor/parcela. 3-4 linhas.`;
            } else if (r.excedeuMargem) {
              // CENÁRIO 2: Excedeu margem — apresentar OFERTA MAXIMA REAL (não estimativa)
              const valor = r.parametros.valorSolicitado || r.parametros.valorParcela;
              const om = r.ofertaMaximaReal?.detalhes;

              if (om && om.valorLiquido) {
                // Temos uma simulação CONCRETA com a margem máxima — apresentar ela
                contextoResim = `[CONTEXTO INTERNO — CLIENTE PEDIU MAIS DO QUE A MARGEM PERMITE]
Cliente pediu R$ ${valor || '?'}, mas NAO ha margem suficiente pra esse valor.
Ja simulei aqui o MAXIMO possivel dentro da margem disponivel:

💰 R$ ${Number(om.valorLiquido).toFixed(2)} liberado
📅 ${om.parcelas}x de R$ ${Number(om.valorParcela).toFixed(2)}

⚡ INSTRUCOES OBRIGATORIAS:
1. Diga ao cliente que NAO tem margem suficiente pro valor que ele pediu
2. Apresente essa oferta acima como "a opcao possivel no momento" / "o maximo que consigo liberar agora"
3. Pergunte se ele topa esse valor maximo${r.c6Bloqueado ? ', ou se prefere liberar outra consulta com selfie pra tentar mais margem' : ''}
4. NUNCA mencione nome de banco
5. Tom natural, direto, 4-5 linhas
6. NAO fale "mais juros" / "parcelas menores" / "mais folego"
7. Pode lembrar: "voce sempre pode antecipar parcelas com desconto"

Se cliente aceitar essa oferta maxima, voce dispara [ACAO:COLETAR_DADOS] na proxima mensagem.${r.c6Bloqueado ? "\nSe cliente quiser liberar outro banco, dispare [ACAO:GERAR_AUTORIZACAO_C6]." : ''}`;
              } else {
                // Fallback: nem a simulação máxima funcionou — só explica e sugere alternativas
                const sugestoes = [];
                if (r.maiorMargemMaxima > 0) sugestoes.push(`A parcela maxima que cabe na margem do cliente eh R$ ${r.maiorMargemMaxima.toFixed(2)}/mes — sugira um valor menor`);
                if (r.c6Bloqueado) sugestoes.push(`Posso liberar consulta em outro banco que pode ter MAIS margem — basta uma selfie sua. Faria isso?`);
                else sugestoes.push(`Quer tentar outro valor menor?`);

                contextoResim = `[CONTEXTO INTERNO — RE-SIMULACAO EXCEDEU MARGEM]
Cliente pediu R$ ${valor || '?'} mas NAO ha margem suficiente pra esse valor.
Margem maxima de parcela: R$ ${(r.maiorMargemMaxima||0).toFixed(2)}/mes.

⚡ Explique pro cliente que NAO tem margem suficiente pro valor pedido e ofereca:
${sugestoes.map((s,i) => `${i+1}. ${s}`).join('\n')}

Tom natural, claro, sem ser tecnico. SEM mencionar nome do banco. 4-6 linhas.
NAO fale "mais juros" / "parcelas menores" / "mais folego".
Se cliente topar liberar C6, ele vai dizer 'sim' e VOCE responde com [ACAO:GERAR_AUTORIZACAO_C6].`;
              }
            } else {
              // CENÁRIO 3: Falha geral
              contextoResim = `[CONTEXTO INTERNO — RE-SIMULACAO FALHOU]
Tentei re-simular mas o sistema nao retornou oferta com esses parametros.
${r.c6Bloqueado ? 'Cliente PODE liberar mais um banco com selfie (C6/DataPrev).' : ''}

Avise o cliente em tom acolhedor, sugerindo:
- Tentar outro valor (mais baixo)
- ${r.c6Bloqueado ? 'Liberar consulta em outro banco com selfie rapida' : 'Manter a oferta original'}
3-4 linhas.`;
            }

            const histAtu = (await dbSelect('clt_conversas', { filters: { id: conversa.id }, single: true }))?.data?.historico || [];
            const msgsResim = [];
            for (const h of histAtu.slice(-12)) msgsResim.push({ role: h.role, content: h.content });
            msgsResim.push({ role: 'user', content: contextoResim });
            const cleanMsgsR = [];
            let lr = null;
            for (const m of msgsResim) {
              if (m.role === lr && typeof m.content === 'string' && typeof cleanMsgsR[cleanMsgsR.length-1]?.content === 'string') {
                cleanMsgsR[cleanMsgsR.length - 1].content += '\n' + m.content;
              } else { cleanMsgsR.push({ ...m }); lr = m.role; }
            }
            const sysPromptR = config.prompt_override
              || buildSystemPrompt(nomeVendedor, nomeParceiro, config.ordem_bancos, config.modo_insistencia);
            const crR = await callClaude(cleanMsgsR, sysPromptR);
            const replyR = crR.text;
            if (!replyR && crR.error) {
              await logEvento(conversa.id, telefone, 'claude_erro_followup_resim', crR.error);
            }
            if (replyR) {
              const parsedR = parseResponse(replyR);
              if (parsedR.clean) {
                await sendMsg(instance, telefone, parsedR.clean);
                await logEvento(conversa.id, telefone, 'msg_enviada', {
                  texto: parsedR.clean.substring(0, 200), origem: 'followup_resimulacao'
                });
              }
            }
          } catch (e) {
            await logEvento(conversa.id, telefone, 'followup_resim_erro', { erro: e.message });
          }
        }

        if (acao === 'INICIAR_SIMULACAO' && r.ok) {
          // Salva ofertas + dados do cliente vindos do orquestrador
          const cliente = r.cliente || {};
          const patchCli = {};
          if (cliente.nome && !merged.nome) patchCli.nome = cliente.nome;
          if (cliente.dataNascimento) patchCli.data_nascimento = cliente.dataNascimento;
          if (cliente.sexo) patchCli.sexo = cliente.sexo;
          patchCli.ofertas = r.ofertas || [];
          patchCli.etapa = r.totalDisponivel > 0 ? 'apresentando_ofertas' : 'simulando';

          // Mescla dados do enriquecimento (vínculo, mãe, etc)
          const dadosNovos = { ...merged.dados };
          if (cliente.nomeMae) dadosNovos.nome_mae = cliente.nomeMae;
          if (r.vinculo?.cnpj) dadosNovos.empregador_cnpj = r.vinculo.cnpj;
          if (r.vinculo?.matricula) dadosNovos.matricula = r.vinculo.matricula;
          if (r.vinculo?.empregador) dadosNovos.empregador_nome = r.vinculo.empregador;
          if (r.vinculo?.renda) dadosNovos.renda = r.vinculo.renda;
          patchCli.dados = dadosNovos;

          await updateConversa(conversa.id, patchCli);

          // ─── FOLLOW-UP AUTOMÁTICO: chama Claude DE NOVO pra apresentar ofertas ──
          await logEvento(conversa.id, telefone, 'followup_iniciado', { ofertas_count: (r.ofertas || []).length });
          try {
            // Ordena ofertas pela prioridade do gestor (clt_config.ordem_bancos)
            const ordemPrioridade = config.ordem_bancos || ['v8', 'presencabank', 'c6'];
            const ofertasOrdenadas = [...(r.ofertas || [])].sort((a, b) => {
              const ia = ordemPrioridade.indexOf(a.banco);
              const ib = ordemPrioridade.indexOf(b.banco);
              return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
            });
            const ofertasDisp = ofertasOrdenadas.filter(o => o.disponivel);
            const ofertasBloqueadas = ofertasOrdenadas.filter(o => o.bloqueado);
            const primeira = ofertasDisp[0] || null;

            const formatOferta = (o, idx) => {
              const d = o.detalhes || {};
              const e = o.elegibilidade || {};
              const ord = idx + 1;
              if (d.valorLiquido) {
                return `${ord}. [${o.banco.toUpperCase()}${o.provider?'/'+o.provider:''}] ${o.label}: R$ ${Number(d.valorLiquido).toFixed(2)} liquido em ${d.parcelas}x R$ ${Number(d.valorParcela).toFixed(2)}`;
              } else if (e.margemDisponivel) {
                return `${ord}. [${o.banco.toUpperCase()}${o.provider?'/'+o.provider:''}] ${o.label}: ELEGIVEL — margem R$ ${Number(e.margemDisponivel).toFixed(2)} (simular tabela exata se cliente aceitar)`;
              } else {
                return `${ord}. [${o.banco.toUpperCase()}${o.provider?'/'+o.provider:''}] ${o.label}: ${o.mensagem || 'disponivel'}`;
              }
            };

            const cpfCliente = cliente.cpf || conversa.cpf || patchCli.cpf || '';
            const contextoOfertas = `[CONTEXTO INTERNO — APRESENTAR APENAS A 1ª OFERTA AGORA]

Acabei de consultar os bancos pra ${cliente.nome || 'cliente'} (CPF ${cpfCliente}).

ORDEM DE PRIORIDADE DEFINIDA PELO GESTOR: ${ordemPrioridade.join(' → ')}

OFERTAS DISPONIVEIS (ordenadas por prioridade):
${ofertasDisp.length === 0 ? 'NENHUMA. Veja bloqueadas abaixo.' : ofertasDisp.map(formatOferta).join('\n')}

OFERTAS QUE EXIGEM AUTORIZACAO/SELFIE (NAO MENCIONE AGORA):
${ofertasBloqueadas.length === 0 ? 'Nenhuma' : ofertasBloqueadas.map(o => `- ${o.label}: ${o.mensagem}`).join('\n')}

⚡ INSTRUCOES OBRIGATORIAS:

1. ${primeira ? `Apresente APENAS A 1ª oferta (${primeira.banco.toUpperCase()}${primeira.provider?'/'+primeira.provider:''}) — VALOR + PARCELAS.` : 'Sem ofertas disponiveis ainda. Avise cliente que esta consultando mais bancos.'}

2. **NAO MENCIONE O NOME DO BANCO** na sua mensagem. Cliente quer saber valor e condicoes, nao instituicao.
   Errado: "O V8 te liberou R$ 2.000"
   Certo:  "Consegui R$ 2.000 liberados pra voce"

3. NAO mencione que ha outras opcoes a menos que cliente pergunte. Apresente como SE FOSSE A UNICA.

4. NUNCA mencione taxa, CET, % de juros — voce NAO TEM esse dado, NAO INVENTE. Se cliente perguntar, resposta padrao: "A taxa e o CET ficam no contrato — voce ve tudo certinho la antes de assinar 📄"

5. NAO aprofunde em seguro, CCB, convenio — so se cliente perguntar.

6. Pergunte se cliente topa seguir.

7. SE cliente perguntar depois 'tem outras opcoes?': mostre a 2ª oferta (mesmo formato, sem banco).
   SE perguntar de novo: 3ª oferta. E por ai vai.

8. SE TODAS apresentadas e cliente ainda quer mais: diga "Essa foi a melhor que consegui — vamos fechar nessa?"

${ofertasDisp.length === 0 && ofertasBloqueadas.length > 0 ? '\n9. Como nao tem oferta disponivel agora, sugira liberar consulta C6: "Posso tentar mais um banco que precisa de uma selfie rapida sua. Vou te mandar o link?"' : ''}

Mensagem natural, 3-5 linhas. Use o nome ${cliente.nome || 'do cliente'} se souber.`;

            const sysPromptFollowup = config.prompt_override
              || buildSystemPrompt(nomeVendedor, nomeParceiro, config.ordem_bancos, config.modo_insistencia);

            // Histórico atualizado + nova mensagem de contexto
            const histAtualizado = [...(novoHistorico || [])];
            const messagesFollowup = [];
            for (const h of histAtualizado.slice(-12)) messagesFollowup.push({ role: h.role, content: h.content });
            messagesFollowup.push({ role: 'user', content: contextoOfertas });

            // Dedupe roles consecutivos
            const cleanFu = [];
            let lr = null;
            for (const m of messagesFollowup) {
              if (m.role === lr && typeof m.content === 'string' && typeof cleanFu[cleanFu.length-1]?.content === 'string') {
                cleanFu[cleanFu.length - 1].content += '\n' + m.content;
              } else { cleanFu.push({ ...m }); lr = m.role; }
            }

            await logEvento(conversa.id, telefone, 'followup_calling_claude', { msgs_count: cleanFu.length });
            const crFu = await callClaude(cleanFu, sysPromptFollowup);
            const replyOfertas = crFu.text;
            await logEvento(conversa.id, telefone, 'followup_claude_returned', {
              has_reply: !!replyOfertas, len: (replyOfertas||'').length, error: crFu.error
            });
            if (replyOfertas) {
              const parsedFu = parseResponse(replyOfertas);
              if (parsedFu.clean) {
                const sent = await sendMsg(instance, telefone, parsedFu.clean);
                await logEvento(conversa.id, telefone, 'followup_sent', { sent, len: parsedFu.clean.length });
                const histFinal = [...histAtualizado,
                  { role: 'assistant', content: parsedFu.clean, ts: new Date().toISOString() }
                ].slice(-40);
                await updateConversa(conversa.id, { historico: histFinal });
                await logEvento(conversa.id, telefone, 'msg_enviada', {
                  texto: parsedFu.clean.substring(0, 200), origem: 'followup_ofertas'
                });
              } else {
                await logEvento(conversa.id, telefone, 'followup_clean_empty', { raw: replyOfertas.substring(0, 200) });
              }
            } else {
              await logEvento(conversa.id, telefone, 'followup_no_reply', {});
            }
          } catch (e) {
            await logEvento(conversa.id, telefone, 'followup_erro', { erro: e.message, stack: (e.stack||'').substring(0,500) });
            console.error('Erro no follow-up de ofertas:', e);
          }
        }

        if (acao === 'ESCALAR_HUMANO') {
          await updateConversa(conversa.id, {
            pausada_por_humano: true, escalada_para_humano: true,
            motivo_escalada: textoDoCliente.substring(0, 200)
          });
        }

        if (acao === 'ENCERRAR') {
          await updateConversa(conversa.id, { ativo: false, etapa: 'fechada_sem_venda' });
        }
      }

      // ─── Envia resposta pro cliente ───
      // Caso especial: GERAR_AUTORIZACAO_C6 retornou link DEPOIS da msg ja ter sido enviada.
      // Manda link como mensagem extra.
      if (acoesResultado.GERAR_AUTORIZACAO_C6?.link && _mensagemEnviada && _mensagemEnviada.match(/\[link.*?\]/i)) {
        const linkMsg = `Aqui está o link pra você fazer a selfie:\n\n${acoesResultado.GERAR_AUTORIZACAO_C6.link}\n\nLeva 30 segundos. Me avisa quando terminar!`;
        await sendMsg(instance, telefone, linkMsg);
        await logEvento(conversa.id, telefone, 'msg_enviada', { texto: linkMsg.substring(0, 200), origem: 'link_c6_pos_action' });
      }

      return jsonResp({
        ok: true, telefone,
        etapa: patchConversa.etapa || conversa.etapa,
        actions, fase,
        dados_coletados: dados,
        acoes_executadas: Object.keys(acoesResultado)
      }, 200, req);
    }

    // ═══ ACTIONS (requer auth) ═══
    const user = await requireAuth(req);
    if (user instanceof Response) return user;
    const action = body.action || '';

    if (action === 'test') {
      let claudeOk = false;
      let claudeErro = null;
      let claudeKeyConfigured = !!CLAUDE_KEY();
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_KEY(), 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 10, messages: [{ role: 'user', content: 'OK' }] })
        });
        const t = await r.text();
        if (r.ok) { claudeOk = true; }
        else {
          let d; try { d = JSON.parse(t); } catch { d = { raw: t.substring(0, 300) }; }
          claudeErro = { httpStatus: r.status, ...d };
        }
      } catch (e) { claudeErro = { exception: e.message }; }
      let supaOk = false;
      try {
        const { data } = await dbQuery('clt_conversas', 'select=count&limit=1');
        supaOk = Array.isArray(data) || typeof data === 'object';
      } catch {}
      let configOk = false, configData = null;
      try {
        configData = await getConfig();
        configOk = !!configData;
      } catch {}
      let evoOk = false;
      try {
        const r = await fetch(EVO_URL() + '/instance/fetchInstances', { headers: { 'apikey': EVO_KEY() } });
        evoOk = r.ok;
      } catch {}

      return jsonResp({
        success: claudeOk && supaOk && configOk && evoOk,
        claude: claudeOk ? 'ok' : 'erro',
        claude_key_configured: claudeKeyConfigured,
        claude_erro_detalhes: claudeErro,
        supabase: supaOk ? 'ok' : 'erro (aplicar supabase_migration_clt.sql?)',
        clt_config: configOk ? configData : 'erro (tabela clt_config existe?)',
        evolution: evoOk ? 'ok' : 'erro',
        model: CLAUDE_MODEL,
        instance: CLT_INSTANCE() || '(CLT_EVOLUTION_INSTANCE não configurada)',
        whitelist: WHITELIST().length > 0 ? WHITELIST() : 'aberto (produção)',
        webhook_secret_set: !!WEBHOOK_SECRET(),
        internal_token_set: !!INTERNAL_TOKEN(),
        app_url: APP_URL()
      }, 200, req);
    }

    // ─── DEBUG: ver eventos de uma conversa ──────────────────
    if (action === 'debugConversa') {
      const tel = String(body.telefone || '').replace(/\D/g, '');
      if (!tel) return jsonResp({ error: 'telefone obrigatório' }, 400, req);
      const { data: conv } = await dbSelect('clt_conversas', { filters: { telefone: tel }, single: true });
      if (!conv) {
        return jsonResp({
          success: false,
          encontrouConversa: false,
          mensagem: 'Nenhuma conversa registrada com esse telefone. Webhook talvez não chegou.',
          dicas: [
            '1. Verificar webhook em Vercel logs',
            '2. CLT_WHATSAPP_WHITELIST pode estar bloqueando esse número',
            '3. Webhook pode estar apontando pra URL errada (rodar action configureWebhook de novo)'
          ]
        }, 200, req);
      }
      const { data: eventos } = await dbQuery('clt_conversas_eventos',
        `select=*&conversa_id=eq.${conv.id}&order=created_at.desc&limit=20`);
      return jsonResp({
        success: true,
        encontrouConversa: true,
        conversa: {
          id: conv.id, telefone: conv.telefone, etapa: conv.etapa,
          ativo: conv.ativo, pausada: conv.pausada_por_humano,
          consentimento_lgpd: conv.consentimento_lgpd,
          last_message_at: conv.last_message_at,
          historico_size: (conv.historico || []).length
        },
        eventos: eventos || [],
        ultimaMensagemRecebida: (conv.historico || []).filter(h => h.role === 'user').slice(-1)[0],
        ultimaResposta: (conv.historico || []).filter(h => h.role === 'assistant').slice(-1)[0]
      }, 200, req);
    }

    if (action === 'conversasAtivas') {
      const { data } = await dbQuery('clt_conversas',
        'select=id,telefone,nome,cpf,etapa,banco_escolhido,consentimento_lgpd,last_message_at&ativo=eq.true&order=last_message_at.desc&limit=50'
      );
      return jsonResp({ success: true, conversas: data || [], total: (data || []).length }, 200, req);
    }

    if (action === 'getConversa') {
      const tel = String(body.telefone || '').replace(/\D/g, '');
      if (!tel) return jsonResp({ error: 'telefone obrigatório' }, 400, req);
      const { data } = await dbSelect('clt_conversas', { filters: { telefone: tel }, single: true });
      return jsonResp({ success: true, conversa: data }, 200, req);
    }

    if (action === 'retomarConversa') {
      const tel = String(body.telefone || '').replace(/\D/g, '');
      const { data: conv } = await dbSelect('clt_conversas', { filters: { telefone: tel }, single: true });
      if (!conv) return jsonResp({ error: 'conversa não encontrada' }, 404, req);
      await updateConversa(conv.id, { pausada_por_humano: false });
      return jsonResp({ success: true, retomada: true }, 200, req);
    }

    if (action === 'configureWebhook') {
      const inst = body.instance || CLT_INSTANCE();
      if (!inst) return jsonResp({ error: 'instance obrigatória' }, 400, req);
      const webhookUrl = APP_URL() + '/api/agente-clt';
      const r = await fetch(EVO_URL() + '/webhook/set/' + inst, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': EVO_KEY() },
        body: JSON.stringify({
          webhook: {
            enabled: true, url: webhookUrl,
            webhookByEvents: false, webhookBase64: true, // base64 pra pegar imagens
            events: ['MESSAGES_UPSERT']
          }
        })
      });
      const d = await r.json();
      return jsonResp({ success: r.ok, instance: inst, webhookUrl, data: d }, 200, req);
    }

    // Dispatch pra lead novo (inicia conversa com dados pré-preenchidos)
    if (action === 'dispatch') {
      const { instance, number, cliente = {}, vendedor, parceiro } = body;
      if (!instance || !number) return jsonResp({ error: 'instance e number obrigatórios' }, 400, req);
      let phone = String(number).replace(/\D/g, '');
      if (!phone.startsWith('55') && phone.length <= 11) phone = '55' + phone;

      // Busca/cria conversa com persona do vendedor
      const vendedorFinal = vendedor || user.nome_vendedor || 'LhamasCred';
      const parceiroFinal = parceiro || user.nome_parceiro || 'LhamasCred';

      const conv = await getOrCreateConversa(phone, instance, {
        nome: cliente.nome || null,
        cpf: cliente.cpf ? String(cliente.cpf).replace(/\D/g, '') : null,
        data_nascimento: cliente.data_nascimento || null,
        nome_vendedor: vendedorFinal,
        nome_parceiro: parceiroFinal,
        disparado_por_user_id: user.id,
        dados: cliente,
        origem: 'dispatch'
      });

      // Atualiza dados se conversa já existia
      await updateConversa(conv.id, {
        nome: cliente.nome || conv.nome,
        nome_vendedor: vendedorFinal,
        nome_parceiro: parceiroFinal,
        etapa: 'inicio'
      });

      // Primeira mensagem: abre com LGPD
      const config = await getConfig();
      const systemPrompt = buildSystemPrompt(vendedorFinal, parceiroFinal, config.ordem_bancos, config.modo_insistencia);
      const contextMsg = `[CONTEXTO — DISPARO INICIAL]
Você vai ABRIR uma conversa agora com um cliente que NÃO perguntou nada ainda.
Dados conhecidos do cliente:
- Nome: ${cliente.nome || 'desconhecido'}
- CPF: ${cliente.cpf || 'desconhecido'}
${cliente.empregador_nome ? `- Empresa: ${cliente.empregador_nome}` : ''}

Escreva a PRIMEIRA MENSAGEM:
- Cumprimento + apresentação (${vendedorFinal} da ${parceiroFinal})
- Razão do contato (identifiquei oportunidade de crédito CLT pra você)
- Pedido de consentimento LGPD
- Curta, 4-6 linhas no máximo
Termine com [FASE:aguardando_consentimento_lgpd]`;

      const crD = await callClaude([{ role: 'user', content: contextMsg }], systemPrompt);
      const reply = crD.text;
      if (!reply) return jsonResp({ error: 'claude_no_response', detail: crD.error }, 500, req);
      const { clean, fase } = parseResponse(reply);

      await sendMsg(instance, phone, clean);
      await logEvento(conv.id, phone, 'msg_enviada', { texto: clean.substring(0, 200), origem: 'dispatch' });
      if (fase) await updateConversa(conv.id, { etapa: fase });

      return jsonResp({ success: true, telefone: phone, mensagem: clean, etapa: fase }, 200, req);
    }

    return jsonResp({
      error: 'action inválida',
      validActions: ['test', 'conversasAtivas', 'getConversa', 'retomarConversa', 'configureWebhook', 'dispatch']
    }, 400, req);

  } catch (err) {
    console.error('agente-clt erro:', err);
    return jsonResp({ error: 'Erro interno', message: err.message }, 500, req);
  }
}
