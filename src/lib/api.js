// ══════ API ══════
const BASE = '/api';

async function post(endpoint, body) {
  const res = await fetch(`${BASE}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ── Consulta INSS (via proxy)
export async function consultaCPF(cpf) {
  return post('multicorban', { action: 'consult_cpf', cpf: cpf.replace(/\D/g, '') });
}
export async function consultaBeneficio(beneficio) {
  return post('multicorban', { action: 'consult_beneficio', beneficio });
}

// ── FACTA
export async function factaSimular(params) {
  return post('facta', { action: 'simular', ...params });
}
export async function factaEsteira(params) {
  return post('facta', { action: 'esteira', ...params });
}
export async function factaTabelas(params) {
  return post('facta', { action: 'tabelas', ...params });
}

// ── JoinBank
export async function joinbankIN100(cpf, beneficio) {
  return post('joinbank', { action: 'in100', cpf, beneficio });
}
export async function joinbankListRules(operation, limit = 50) {
  return post('joinbank', { action: 'listRules', operation, limit });
}

// ── Cartão (DataConsulta)
export async function consultaCartao(cpf, matricula) {
  return post('cartao', { cpf: cpf.replace(/\D/g, ''), matricula: matricula || '' });
}

// ── Evolution (WhatsApp)
export async function wppCall(action, data = {}) {
  return post('evolution', { action, ...data });
}

// ── Sofia (AI Agent)
export async function sofiaChat(messages, context) {
  return post('agent', { messages, context });
}
