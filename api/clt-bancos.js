// ══════════════════════════════════════════════════════════════════
// api/clt-bancos.js
// Catálogo + matcher de bancos CLT (mesmo padrão pref/gov/fed):
//
//   - listar         → bancos + convenios + regras (pra UI Catalogo)
//   - analisar       → MATCHER: dado idade/margem/valor/prazo/tempo_casa,
//                      retorna bancos que ATENDEM e os que NAO + motivo
//   - upsertBanco    → admin edita info de 1 banco
//   - upsertVinculo  → admin edita regras (banco × convenio)
// ══════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { json as jsonResp, jsonError, handleOptions, requireAuth } from './_lib/auth.js';
import { dbSelect, dbUpsert, dbInsert } from './_lib/supabase.js';

// Calcula idade pela data de nascimento (YYYY-MM-DD)
function calcularIdade(dataNasc) {
  if (!dataNasc) return null;
  const m = String(dataNasc).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const nasc = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const hoje = new Date();
  let idade = hoje.getUTCFullYear() - nasc.getUTCFullYear();
  const md = hoje.getUTCMonth() - nasc.getUTCMonth();
  if (md < 0 || (md === 0 && hoje.getUTCDate() < nasc.getUTCDate())) idade--;
  return idade;
}

// Avalia 1 vinculo (banco_convenio) contra os parametros do cliente
// Retorna { atende: bool, motivo: string, regras_check: [] }
function avaliarVinculo(bc, params) {
  const motivos = [];

  // suspenso
  if (bc.suspenso === true) {
    motivos.push('Banco suspenso pra esse convênio');
  }

  // idade
  if (params.idade != null && bc.idade_min != null && params.idade < bc.idade_min) {
    motivos.push(`Idade ${params.idade} < mínimo ${bc.idade_min}`);
  }
  if (params.idade != null && bc.idade_max != null && params.idade > bc.idade_max) {
    motivos.push(`Idade ${params.idade} > máximo ${bc.idade_max}`);
  }

  // margem (parcela mensal disponivel)
  if (params.margem != null && bc.margem_minima != null && params.margem < bc.margem_minima) {
    motivos.push(`Margem R$ ${params.margem} < mínimo R$ ${bc.margem_minima}`);
  }

  // valor liberado solicitado
  if (params.valor != null && bc.valor_minimo != null && params.valor < bc.valor_minimo) {
    motivos.push(`Valor R$ ${params.valor} < mínimo R$ ${bc.valor_minimo}`);
  }
  if (params.valor != null && bc.valor_maximo != null && params.valor > bc.valor_maximo) {
    motivos.push(`Valor R$ ${params.valor} > máximo R$ ${bc.valor_maximo}`);
  }

  // prazo (parcelas)
  if (params.prazo != null && bc.prazo_min != null && params.prazo < bc.prazo_min) {
    motivos.push(`Prazo ${params.prazo}x < mínimo ${bc.prazo_min}x`);
  }
  if (params.prazo != null && bc.prazo_max != null && params.prazo > bc.prazo_max) {
    motivos.push(`Prazo ${params.prazo}x > máximo ${bc.prazo_max}x`);
  }

  // tempo de casa
  if (params.tempo_admissao_meses != null && bc.tempo_admissao_min_meses != null
      && params.tempo_admissao_meses < bc.tempo_admissao_min_meses) {
    motivos.push(`Tempo de casa ${params.tempo_admissao_meses}m < mínimo ${bc.tempo_admissao_min_meses}m`);
  }

  return {
    atende: motivos.length === 0,
    motivos,
    regras: {
      idade_min: bc.idade_min, idade_max: bc.idade_max,
      margem_minima: bc.margem_minima,
      valor_minimo: bc.valor_minimo, valor_maximo: bc.valor_maximo,
      prazo_min: bc.prazo_min, prazo_max: bc.prazo_max,
      tempo_admissao_min_meses: bc.tempo_admissao_min_meses,
      exige_selfie: bc.exige_selfie, exige_termo: bc.exige_termo,
      taxa_minima: bc.taxa_minima, taxa_maxima: bc.taxa_maxima
    }
  };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions(req);
  const user = await requireAuth(req);
  if (user instanceof Response) return user;
  if (req.method !== 'POST') return jsonError('POST only', 405, req);

  let body;
  try { body = await req.json(); } catch { body = {}; }
  const action = body.action || 'listar';

  // ─── LISTAR: bancos + convenios + regras (catalogo completo) ──
  if (action === 'listar') {
    const { data: bancos = [] } = await dbSelect('clt_bancos', { order: 'nome.asc' });
    const { data: convenios = [] } = await dbSelect('clt_convenios', { order: 'nome.asc' });
    const { data: vinculos = [] } = await dbSelect('clt_banco_convenio', { limit: 1000 });
    return jsonResp({ success: true, bancos, convenios, vinculos }, 200, req);
  }

  // ─── ANALISAR: matcher dados cliente → bancos que atendem ──
  if (action === 'analisar') {
    const params = {
      idade: body.idade != null ? Number(body.idade)
            : (body.dataNascimento ? calcularIdade(body.dataNascimento) : null),
      margem: body.margem != null ? Number(body.margem) : null,
      valor: body.valor != null ? Number(body.valor) : null,
      prazo: body.prazo != null ? Number(body.prazo) : null,
      tempo_admissao_meses: body.tempo_admissao_meses != null ? Number(body.tempo_admissao_meses) : null,
      operacao: body.operacao || 'novo', // novo | refin | port | cartao
      empregador_cnpj: (body.empregador_cnpj || '').replace(/\D/g, '') || null,
      cnae: body.cnae || null,
      convenio_slug: body.convenio_slug || 'clt-geral'
    };

    // Busca convênio
    const { data: conv } = await dbSelect('clt_convenios', {
      filters: { slug: params.convenio_slug }, single: true
    });
    if (!conv) return jsonError(`Convênio '${params.convenio_slug}' não encontrado`, 404, req);

    // Busca bancos + vinculos
    const { data: bancos = [] } = await dbSelect('clt_bancos', { filters: { ativo: true } });
    const { data: vinculos = [] } = await dbSelect('clt_banco_convenio', {
      filters: { convenio_id: conv.id }
    });
    const vincPorBanco = {};
    for (const v of vinculos) vincPorBanco[v.banco_id] = v;

    const atendem = [];
    const naoAtendem = [];

    for (const b of bancos) {
      const bc = vincPorBanco[b.id];
      if (!bc) {
        naoAtendem.push({
          banco_slug: b.slug, banco_nome: b.nome,
          motivo: `Sem regra cadastrada pra convênio '${conv.slug}'`,
          regras: null
        });
        continue;
      }

      // Checa operacao
      const opOk = params.operacao === 'novo' ? bc.opera_novo
                 : params.operacao === 'refin' ? bc.opera_refin
                 : params.operacao === 'port' ? bc.opera_port
                 : params.operacao === 'cartao' ? bc.opera_cartao
                 : true;
      if (!opOk) {
        naoAtendem.push({
          banco_slug: b.slug, banco_nome: b.nome,
          motivo: `Não opera ${params.operacao}`,
          regras: bc
        });
        continue;
      }

      const aval = avaliarVinculo(bc, params);
      if (aval.atende) {
        atendem.push({
          banco_slug: b.slug, banco_nome: b.nome,
          banco_id: b.id, vinculo_id: bc.id,
          api_status: b.api_status,
          exige_selfie: b.exige_selfie || bc.exige_selfie,
          exige_termo: b.exige_termo || bc.exige_termo,
          documentos: bc.documentos_obrigatorios || [],
          regras: aval.regras
        });
      } else {
        naoAtendem.push({
          banco_slug: b.slug, banco_nome: b.nome,
          motivo: aval.motivos.join(' · '),
          regras: aval.regras
        });
      }
    }

    return jsonResp({
      success: true,
      params_normalizados: params,
      convenio: { id: conv.id, slug: conv.slug, nome: conv.nome },
      total_bancos: bancos.length,
      atendem_count: atendem.length,
      nao_atendem_count: naoAtendem.length,
      atendem, nao_atendem: naoAtendem
    }, 200, req);
  }

  // ─── UPSERT BANCO (admin) ──
  if (action === 'upsertBanco') {
    if (user.role !== 'admin' && user.role !== 'gestor') return jsonError('Sem permissão', 403, req);
    const banco = body.banco || {};
    if (!banco.slug || !banco.nome) return jsonError('slug + nome obrigatorios', 400, req);
    banco.updated_at = new Date().toISOString();
    const { data, error } = await dbUpsert('clt_bancos', banco, 'slug');
    if (error) return jsonError(error, 500, req);
    return jsonResp({ success: true, banco: data }, 200, req);
  }

  // ─── UPSERT VINCULO banco × convenio (admin) ──
  if (action === 'upsertVinculo') {
    if (user.role !== 'admin' && user.role !== 'gestor') return jsonError('Sem permissão', 403, req);
    const v = body.vinculo || {};
    if (!v.banco_id || !v.convenio_id) return jsonError('banco_id + convenio_id obrigatorios', 400, req);
    v.updated_at = new Date().toISOString();
    if (v.id) {
      const { data, error } = await dbUpsert('clt_banco_convenio', v, 'id');
      if (error) return jsonError(error, 500, req);
      return jsonResp({ success: true, vinculo: data }, 200, req);
    } else {
      const { data, error } = await dbInsert('clt_banco_convenio', v);
      if (error) return jsonError(error, 500, req);
      return jsonResp({ success: true, vinculo: data }, 200, req);
    }
  }

  return jsonError('Action invalida. Validas: listar, analisar, upsertBanco, upsertVinculo', 400, req);
}
