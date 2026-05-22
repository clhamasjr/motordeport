export const config = { runtime: 'edge' };

// ═══════════════════════════════════════════════════════════════
// api/crefaz-webhook.js — Receber callbacks da Crefaz On
//
// A Crefaz aceita o campo `urlNotificacaoParceiro` ao criar proposta
// (POST /Proposta) e dispara pra essa URL quando o status muda.
//
// URL publica a configurar no FlowForce/Crefaz:
//   https://motordeport.vercel.app/api/crefaz-webhook?secret={WEBHOOK_SECRET}
//
// PROTECAO: shared secret via query string (?secret=...). Sem ele, retorna 401.
// O payload exato AINDA NAO ESTA DOCUMENTADO — TODO confirmar com a Crefaz.
// ═══════════════════════════════════════════════════════════════

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // Validacao basica de seguranca: shared secret na query string
  const url = new URL(req.url);
  const provided = url.searchParams.get('secret') || '';
  const expected = process.env.CREFAZ_WEBHOOK_SECRET || '';
  if (!expected) {
    console.error('[crefaz-webhook] CREFAZ_WEBHOOK_SECRET nao configurado — recusando');
    return new Response(JSON.stringify({ ok: false, error: 'webhook nao configurado' }), {
      status: 500, headers: corsHeaders()
    });
  }
  if (provided !== expected) {
    console.warn('[crefaz-webhook] secret invalido');
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 401, headers: corsHeaders()
    });
  }

  try {
    const txt = await req.text();
    let body = null;
    try { body = JSON.parse(txt); } catch { body = { raw: txt }; }

    // Log estruturado pra rastreabilidade
    console.log('[crefaz-webhook] payload recebido', JSON.stringify({
      ts: new Date().toISOString(),
      headers: Object.fromEntries(req.headers.entries()),
      body,
    }));

    // TODO: quando confirmarmos o schema com a Crefaz, atualizar a tabela
    // de propostas no Supabase aqui. Por enquanto so loga e responde 200.
    //
    // Pattern esperado (a confirmar):
    //   { propostaId, situacao, situacaoDescricao, data, motivos? }
    //
    // Codigo placeholder (descomentar quando ligar):
    // const { propostaId, situacao, situacaoDescricao } = body || {};
    // if (propostaId) {
    //   await dbUpdate('crefaz_propostas', { id: propostaId }, {
    //     situacao_descricao: situacaoDescricao,
    //     situacao_codigo: situacao,
    //     atualizado_em: new Date().toISOString(),
    //   });
    // }

    return new Response(JSON.stringify({ ok: true, received: true }), {
      status: 200, headers: corsHeaders()
    });
  } catch (err) {
    console.error('[crefaz-webhook] erro', err);
    return new Response(JSON.stringify({ ok: false, error: err?.message || 'erro' }), {
      status: 500, headers: corsHeaders()
    });
  }
}
