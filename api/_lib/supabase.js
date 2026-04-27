// ══════════════════════════════════════════════════════════════════
// api/_lib/supabase.js — Cliente Supabase leve para Edge Runtime
// Usa fetch direto (sem dependencia de npm)
// ══════════════════════════════════════════════════════════════════

const SUPABASE_URL = () => process.env.SUPABASE_URL;
const SUPABASE_KEY = () => process.env.SUPABASE_SERVICE_KEY; // service_role key

function headers() {
  return {
    'apikey': SUPABASE_KEY(),
    'Authorization': `Bearer ${SUPABASE_KEY()}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
}

// ── Query helper ──────────────────────────────────────────────
export async function dbSelect(table, { filters = {}, select = '*', order, limit, single } = {}) {
  let url = `${SUPABASE_URL()}/rest/v1/${table}?select=${select}`;
  for (const [k, v] of Object.entries(filters)) {
    url += `&${k}=eq.${encodeURIComponent(v)}`;
  }
  if (order) url += `&order=${order}`;
  if (limit) url += `&limit=${limit}`;
  const h = headers();
  if (single) h['Accept'] = 'application/vnd.pgrst.object+json';
  const r = await fetch(url, { headers: h });
  if (!r.ok) {
    const t = await r.text();
    return { error: t, data: null };
  }
  return { error: null, data: await r.json() };
}

export async function dbInsert(table, data) {
  const r = await fetch(`${SUPABASE_URL()}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(data)
  });
  if (!r.ok) {
    const t = await r.text();
    return { error: t, data: null };
  }
  const result = await r.json();
  return { error: null, data: Array.isArray(result) ? result[0] : result };
}

// UPSERT — insere ou atualiza por coluna unique (ex: cpf).
// `conflictColumn` precisa ter constraint UNIQUE (ou ser PK).
// Por padrao mescla — campos nao informados ficam intactos? NAO no Postgrest:
// ele atualiza TODOS os campos enviados. Pra mesclar parcial, monte o data
// so com os campos que quer atualizar.
export async function dbUpsert(table, data, conflictColumn) {
  const url = `${SUPABASE_URL()}/rest/v1/${table}?on_conflict=${conflictColumn}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { ...headers(), 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(data)
  });
  if (!r.ok) {
    const t = await r.text();
    return { error: t, data: null };
  }
  const result = await r.json();
  return { error: null, data: Array.isArray(result) ? result[0] : result };
}

export async function dbUpdate(table, filters, data) {
  let url = `${SUPABASE_URL()}/rest/v1/${table}?`;
  for (const [k, v] of Object.entries(filters)) {
    url += `${k}=eq.${encodeURIComponent(v)}&`;
  }
  const r = await fetch(url, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(data)
  });
  if (!r.ok) {
    const t = await r.text();
    return { error: t, data: null };
  }
  return { error: null, data: await r.json() };
}

export async function dbDelete(table, filters) {
  let url = `${SUPABASE_URL()}/rest/v1/${table}?`;
  for (const [k, v] of Object.entries(filters)) {
    url += `${k}=eq.${encodeURIComponent(v)}&`;
  }
  const r = await fetch(url, { method: 'DELETE', headers: headers() });
  if (!r.ok) {
    const t = await r.text();
    return { error: t, data: null };
  }
  return { error: null };
}

// ── Raw query (para queries complexas) ───────────────────────
export async function dbRPC(fnName, params = {}) {
  const r = await fetch(`${SUPABASE_URL()}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(params)
  });
  if (!r.ok) {
    const t = await r.text();
    return { error: t, data: null };
  }
  return { error: null, data: await r.json() };
}

// ── Raw URL query (for advanced filters like gt, lt, ilike) ──
export async function dbQuery(table, queryString, opts = {}) {
  const h = headers();
  if (opts.single) h['Accept'] = 'application/vnd.pgrst.object+json';
  const r = await fetch(`${SUPABASE_URL()}/rest/v1/${table}?${queryString}`, { headers: h });
  if (!r.ok) {
    const t = await r.text();
    return { error: t, data: null };
  }
  return { error: null, data: await r.json() };
}
