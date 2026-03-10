export const config = { runtime: 'edge' };

export default async function handler(req) {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }

  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  try {
    const body = await req.json();
    const cpf = body.cpf;
    if (!cpf) return new Response(JSON.stringify({ error: 'CPF obrigatório' }), { status: 400, headers: cors });

    // Step 1: Generate Token
    const tokenBody = JSON.stringify({
      credencial: {
        usuario: 'carlos@lhamascred.com.br',
        senha: 'Lh@mas2424',
        cliente: 'LHAMASCRED'
      }
    });

    const tokenRes = await fetch('https://wsnv.novavidati.com.br/wslocalizador.asmx/GerarTokenJson', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: tokenBody
    });

    const tokenText = await tokenRes.text();
    let token = null;

    // Try to extract token from various response formats
    try {
      let parsed = JSON.parse(tokenText);
      // Format: {"d": "token_string"} or {"d": {"Token": "xxx"}} or {"Token": "xxx"} or just "token"
      if (typeof parsed === 'string') {
        token = parsed;
      } else if (parsed.d) {
        if (typeof parsed.d === 'string') {
          // Could be JSON inside d
          try {
            let inner = JSON.parse(parsed.d);
            token = inner.Token || inner.token || inner.ACCESS_TOKEN || parsed.d;
          } catch {
            token = parsed.d;
          }
        } else if (typeof parsed.d === 'object') {
          token = parsed.d.Token || parsed.d.token || parsed.d.ACCESS_TOKEN;
        }
      } else {
        token = parsed.Token || parsed.token || parsed.ACCESS_TOKEN;
      }
    } catch {
      // Raw text token
      token = tokenText.replace(/["\s]/g, '');
    }

    if (!token) {
      return new Response(JSON.stringify({ 
        error: 'Não foi possível obter o token', 
        debug_response: tokenText.substring(0, 500) 
      }), { status: 500, headers: cors });
    }

    // Step 2: NVCHECK
    const cleanCPF = cpf.replace(/\D/g, '');
    const checkBody = JSON.stringify({
      nvcheck: { Documento: cleanCPF }
    });

    const checkRes = await fetch('https://wsnv.novavidati.com.br/wslocalizador.asmx/NVCHECKJson', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Token': token
      },
      body: checkBody
    });

    const checkText = await checkRes.text();
    let checkData;

    try {
      checkData = JSON.parse(checkText);
      // Unwrap {"d": "..."} if needed
      if (checkData.d && typeof checkData.d === 'string') {
        try { checkData = JSON.parse(checkData.d); } catch { checkData = { raw: checkData.d }; }
      }
    } catch {
      return new Response(JSON.stringify({ 
        error: 'Resposta inválida da API', 
        debug_response: checkText.substring(0, 500) 
      }), { status: 500, headers: cors });
    }

    // Navigate to data
    const consulta = checkData?.d?.CONSULTA || checkData?.CONSULTA || checkData;
    const cadastrais = consulta?.CADASTRAIS || {};
    const telefones = consulta?.TELEFONES || [];
    const contatosRuins = consulta?.CONTATOSRUINS || [];
    const nome = cadastrais.NOME || '';

    // Filter: remove bad contacts and PROCON
    const badSet = new Set(contatosRuins.map(c => (c.DDD || '') + (c.TELEFONE || '')));
    const goodPhones = telefones.filter(t => {
      const full = (t.DDD || '') + (t.TELEFONE || '');
      return full.length >= 10 && !badSet.has(full) && t.PROCON !== 'S';
    }).map(t => ({
      ddd: t.DDD || '',
      telefone: t.TELEFONE || '',
      tipo: t.TIPO_TELEFONE || '',
      operadora: t.OPERADORA || '',
      whatsapp: (t.TIPO_TELEFONE || '').toUpperCase().includes('CEL') || (t.TELEFONE || '').length >= 9
    }));

    return new Response(JSON.stringify({
      success: true,
      cpf: cleanCPF,
      nome,
      telefones: goodPhones,
      totalEncontrados: telefones.length,
      totalValidos: goodPhones.length
    }), { status: 200, headers: cors });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, stack: err.stack?.substring(0, 200) }), { status: 500, headers: cors });
  }
}
