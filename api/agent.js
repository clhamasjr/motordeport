export const config = { runtime: 'edge' };

// ═══ CREDENTIALS via ENV ═══
const CLAUDE_KEY = () => process.env.CLAUDE_API_KEY;
const EVO_URL = () => process.env.EVOLUTION_URL;
const EVO_KEY = () => process.env.EVOLUTION_KEY;
const CLAUDE_MODEL = 'claude-sonnet-4-5-20241022';

import { json as jsonResp, handleOptions } from './_lib/auth.js';

// ═══ CONVERSATION STATE (in-memory, resets on cold start) ═══
const convState = new Map();

function getConv(phone) {
  return convState.get(phone) || { phase: 'abordagem', data: {}, campaignType: 'completa', collectedFields: [], startedAt: Date.now(), lastAt: Date.now() };
}
function setConv(phone, state) {
  state.lastAt = Date.now();
  convState.set(phone, state);
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

═══ REGRA CRÍTICA — DADOS DO CLIENTE ═══
⚠️ SE você JÁ TEM dados do cliente no contexto (nome, CPF, benefício, valores de oportunidade, margens) —
NUNCA PEÇA CPF ou dados que JÁ ESTÃO no contexto. USE OS DADOS DIRETO.
Só peça CPF se o contexto explicitamente disser "SEM CONTEXTO — peça CPF".

═══ FASES DA CONVERSA ═══

FASE 1 — ABORDAGEM (PRIMEIRO CONTATO)

CASO A — Conversa veio de CAMPANHA (você já tem dados):
  → NUNCA PEÇA CPF. Você já tem.
  → Mencione o cliente pelo NOME (que já está no contexto)
  → Vá direto ao benefício com VALORES reais do contexto
  → Pergunte se pode explicar melhor

CASO B — Cliente chegou SEM contexto (iniciou conversa do nada):
  → Só use este caso se o contexto disser "SEM CONTEXTO".
  → Cumprimente, apresente-se, PEÇA O CPF educadamente:
    Ex: "Oi! Aqui é a Sofia da LhamasCred 😊 Pra eu ver as melhores oportunidades pra você, pode me passar seu CPF?"
  → Assim que cliente mandar CPF, o sistema consulta o motor e traz dados REAIS no próximo turno.

FASE 2 — QUALIFICAÇÃO (apresentar oportunidades)
→ Apresente a MAIS ATRATIVA primeiro (maior valor), de forma natural
→ Ex: "Ótimo, [Nome]! Encontrei uma oportunidade boa: [descrição]. Posso te explicar como funciona?"
→ Responda dúvidas, quebre objeções

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
  try {
    const r = await fetch(appUrl + '/api/multicorban', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'consult_cpf', cpf })
    });
    const data = await r.json();
    if (!data.ok) return { success: false, error: data.error || data.mensagem || 'CPF nao encontrado' };
    // Se retornou lista (multiplos beneficios), usa o primeiro ativo
    if (data.lista && data.lista.length && !data.parsed) {
      const ativo = data.lista.find(b => b.situacao === 'ATIVO') || data.lista[0];
      if (ativo && ativo.nb) {
        const r2 = await fetch(appUrl + '/api/multicorban', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'consult_beneficio', beneficio: ativo.nb })
        });
        const d2 = await r2.json();
        if (d2.ok && d2.parsed) return extractOportunidades(d2.parsed);
      }
      return { success: false, error: 'Multiplos beneficios, nao conseguiu detalhar' };
    }
    if (data.parsed) return extractOportunidades(data.parsed);
    return { success: false, error: 'Estrutura de resposta inesperada' };
  } catch (e) {
    return { success: false, error: e.message };
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
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_KEY(), 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 800, system: systemOverride || SYSTEM_PROMPT, messages })
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
  const phaseMatch = reply.match(/\[FASE:(\w+)\]/);
  if (phaseMatch) { phase = phaseMatch[1]; cleanReply = cleanReply.replace(/\[FASE:\w+\]/, '').trim(); }
  const actionMatches = reply.matchAll(/\[ACAO:(\w+)\]/g);
  for (const m of actionMatches) { actions.push(m[1]); cleanReply = cleanReply.replace(m[0], '').trim(); }
  const dataMatches = reply.matchAll(/\[DADO:(\w+)=([^\]]+)\]/g);
  for (const m of dataMatches) { collectedData[m[1]] = m[2]; cleanReply = cleanReply.replace(m[0], '').trim(); }
  return { cleanReply, actions, phase, collectedData };
}

// ═══ WEBHOOK SECRET for Evolution API ═══
function verifyWebhookSecret(req) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return true; // se nao configurou, aceita tudo (backward compat)
  const provided = req.headers.get('x-webhook-secret') || '';
  return provided === secret;
}

// ═══ MAIN HANDLER ═══

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);

  try {
    const body = await req.json();

    // ═══ EVOLUTION WEBHOOK (incoming message) ═══
    if (body.event === 'messages.upsert' || body.event === 'messages.update') {
      // Webhook nao requer auth de usuario, mas pode ter webhook secret
      if (!verifyWebhookSecret(req)) {
        return jsonResp({ error: 'Unauthorized webhook' }, 401, req);
      }

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

      // Commands
      if (text.trim().toLowerCase() === '/pausa') {
        await sendMsg(instance, number, '⏸️ Agente pausado. Um consultor humano vai continuar seu atendimento.');
        return jsonResp({ paused: true }, 200, req);
      }
      if (text.trim().toLowerCase() === '/agente') {
        await sendMsg(instance, number, '🤖 Sofia de volta! Como posso te ajudar?');
        return jsonResp({ resumed: true }, 200, req);
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

      const { cleanReply, actions, phase, collectedData } = parseResponse(reply);

      if (phase) conv.phase = phase;
      if (Object.keys(collectedData).length > 0) {
        conv.data = { ...conv.data, ...collectedData };
        conv.collectedFields = [...new Set([...(conv.collectedFields || []), ...Object.keys(collectedData)])];
      }
      setConv(number, conv);

      if (cleanReply.length > 500) {
        const parts = cleanReply.split('\n\n').filter(p => p.trim());
        for (let i = 0; i < parts.length; i++) {
          await sendMsg(instance, number, parts[i].trim());
          if (i < parts.length - 1) await new Promise(r => setTimeout(r, 1500));
        }
      } else {
        await sendMsg(instance, number, cleanReply);
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

    // Para actions do frontend, verificar auth
    // Webhook do Evolution já foi tratado acima
    const { requireAuth: reqAuth } = await import('./_lib/auth.js');
    const user = await reqAuth(req);
    if (user instanceof Response) return user;

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
      const appUrl = process.env.APP_URL || 'https://motordeport.vercel.app';
      const webhookUrl = body.webhookUrl || `${appUrl}/api/agent`;
      const r = await evoCall('POST', '/webhook/set/' + inst, { webhook: { enabled: true, url: webhookUrl, webhookByEvents: false, webhookBase64: false, events: ['MESSAGES_UPSERT'] } });
      return jsonResp({ success: true, instance: inst, webhookUrl, response: r }, 200, req);
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
      return jsonResp({ agentActive: claudeOk && evoOk, claude: claudeOk ? 'Ativo' : 'Erro', evolution: evoOk ? 'Ativo' : 'Erro', model: CLAUDE_MODEL, version: 'Sofia v2.1', activeConversations: convState.size }, 200, req);
    }

    return jsonResp({ error: 'action invalida', validActions: ['dispatch', 'bulkDispatch', 'getConv', 'setConvData', 'setWebhook', 'getWebhook', 'test'] }, 400, req);

  } catch (err) {
    return jsonResp({ error: 'Erro interno' }, 500, req);
  }
}
