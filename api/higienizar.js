export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { cpf } = req.body;
  if (!cpf) return res.status(400).json({ error: 'CPF required' });

  try {
    // Step 1: Get token
    const tokenRes = await fetch('https://wsnv.novavidati.com.br/wslocalizador.asmx/GerarTokenJson', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credencial: {
          usuario: 'carlos@lhamascred.com.br',
          senha: 'Lh@mas2424',
          cliente: 'LHAMASCRED'
        }
      })
    });
    const tokenData = await tokenRes.json();
    
    // Extract token (may be nested)
    let token = null;
    if (typeof tokenData === 'string') {
      try { const p = JSON.parse(tokenData); token = p.Token || p.token || p.d; } catch { token = tokenData; }
    } else {
      token = tokenData.Token || tokenData.token || tokenData.d || 
              (tokenData.d && typeof tokenData.d === 'object' ? (tokenData.d.Token || tokenData.d.token) : null);
    }
    
    if (!token) return res.status(500).json({ error: 'Token not obtained', raw: tokenData });

    // Step 2: NVCHECK with CPF
    const checkRes = await fetch('https://wsnv.novavidati.com.br/wslocalizador.asmx/NVCHECKJson', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Token': token
      },
      body: JSON.stringify({
        nvcheck: { Documento: cpf.replace(/\D/g, '') }
      })
    });
    const checkData = await checkRes.json();
    
    // Parse response - extract phones
    let parsed = checkData;
    if (typeof checkData === 'string') {
      try { parsed = JSON.parse(checkData); } catch {}
    }
    if (parsed.d && typeof parsed.d === 'string') {
      try { parsed = JSON.parse(parsed.d); } catch { parsed = { d: parsed.d }; }
    }

    // Navigate to CONSULTA
    const consulta = parsed?.d?.CONSULTA || parsed?.CONSULTA || parsed;
    
    // Extract phones
    const telefones = consulta?.TELEFONES || consulta?.d?.CONSULTA?.TELEFONES || [];
    const contatosRuins = consulta?.CONTATOSRUINS || [];
    const nome = consulta?.CADASTRAIS?.NOME || consulta?.d?.CONSULTA?.CADASTRAIS?.NOME || '';
    const cpfResp = consulta?.CADASTRAIS?.CPF || cpf;

    // Filter good phones (not in bad contacts)
    const badPhones = new Set(contatosRuins.map(c => (c.DDD || '') + (c.TELEFONE || '')));
    const goodPhones = telefones.filter(t => {
      const full = (t.DDD || '') + (t.TELEFONE || '');
      return full.length >= 10 && !badPhones.has(full) && t.PROCON !== 'S';
    }).map(t => ({
      ddd: t.DDD,
      telefone: t.TELEFONE,
      tipo: t.TIPO_TELEFONE,
      operadora: t.OPERADORA,
      whatsapp: (t.TIPO_TELEFONE || '').toUpperCase().includes('CEL') || (t.TELEFONE || '').length >= 9
    }));

    return res.status(200).json({
      success: true,
      cpf: cpfResp,
      nome,
      telefones: goodPhones,
      totalEncontrados: telefones.length,
      totalValidos: goodPhones.length
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}