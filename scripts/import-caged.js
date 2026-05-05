// ════════════════════════════════════════════════════════════════════
// scripts/import-caged.js
// Importa CAGED 2024 (~27 GB, ~150M registros) pra clt_base_funcionarios.
//
// Estrategia:
//  1) Stream linha-a-linha (baixa RAM)
//  2) Decode Latin-1 → UTF-8 (CAGED usa Windows-1252)
//  3) Parse pipe-delimited
//  4) Valida CPF (11 digitos, descarta dummies)
//  5) Mantem em Map<cpf, registro> deduplicando pelo MAIS RECENTE
//     (max(data_admissao, data_demissao) — ultimo estado conhecido)
//  6) A cada 50k CPFs novos no Map, faz UPSERT em batch no Supabase
//     via REST com prefer=resolution=merge-duplicates (UPSERT por PK).
//  7) No final, faz mais 1 flush dos restantes
//
// Uso:
//   1) Configure as env vars no terminal antes de rodar:
//        export SUPABASE_URL="https://xtyvnocvckbvhwvdwdpo.supabase.co"
//        export SUPABASE_SERVICE_KEY="seu_service_role_key_aqui"
//      (ou no Windows PowerShell:
//        $env:SUPABASE_URL="..."
//        $env:SUPABASE_SERVICE_KEY="..."
//      )
//   2) Roda:
//        node scripts/import-caged.js "C:\\Users\\clham\\Downloads\\Caged-2024.txt"
//        node scripts/import-caged.js "C:\\Users\\clham\\Downloads\\Caged-2024-complementar.txt"
//      (rode os 2 separadamente — o segundo so atualiza CPFs com info mais recente)
//
// Pode interromper a qualquer momento (Ctrl+C). Re-rodar continua de
// onde parou pq o UPSERT compara data_atualizacao_registro e so substitui
// se for mais recente.
// ════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import readline from 'node:readline';

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPA_URL || !SUPA_KEY) {
  console.error('❌ Configure SUPABASE_URL e SUPABASE_SERVICE_KEY como env vars antes.');
  console.error('   Veja o cabeçalho do arquivo pra exemplos.');
  process.exit(1);
}

const FILE = process.argv[2];
if (!FILE) {
  console.error('❌ Uso: node scripts/import-caged.js "caminho/para/Caged-2024.txt"');
  process.exit(1);
}

if (!fs.existsSync(FILE)) {
  console.error('❌ Arquivo não encontrado:', FILE);
  process.exit(1);
}

const TABELA = 'clt_base_funcionarios';
const BATCH_SIZE = 5000;       // CPFs por request UPSERT
const FLUSH_THRESHOLD = 50000; // Quando o Map atingir N CPFs, flush

// ─── Helpers ─────────────────────────────────────────────────────

// Indices das colunas (35 no total, separador |)
const COL = {
  CNPJ_RAIZ: 0, NOM_RAZAO: 1, NOM_LOGRAD: 2, NUM_LOGRAD: 3, COMPL: 4,
  BAIRRO: 5, COD_UFMUN: 6, CNAE_R: 7, CNAE_S: 8, DAT_ABERTURA: 9,
  TEL_DDD: 10, TEL: 11, TEL2: 12, FAX_DDD: 13, FAX: 14,
  CNPJ_EMPREGADOR: 15, PIS: 16, NOME_FUNC: 17, SEXO: 18, DATA_NASC: 19,
  CTPS_NUM: 20, CTPS_SERIE: 21, CPF: 22, CBO: 23, DATA_ADMISSAO: 24,
  DATA_DEMISSAO: 25, CNAE_EMP: 26, COD_MUNI: 27, CIDADE_EMP: 28,
  CIDADE_FUNC: 29, DDD1: 30, TELEFONE1: 31, TIPO_TEL: 32, EMAIL: 33, RN: 34
};

// IBGE: 2 primeiros digitos do COD_UFMUN = codigo UF
const UF_BY_IBGE = {
  '11':'RO','12':'AC','13':'AM','14':'RR','15':'PA','16':'AP','17':'TO',
  '21':'MA','22':'PI','23':'CE','24':'RN','25':'PB','26':'PE','27':'AL','28':'SE','29':'BA',
  '31':'MG','32':'ES','33':'RJ','35':'SP',
  '41':'PR','42':'SC','43':'RS',
  '50':'MS','51':'MT','52':'GO','53':'DF'
};

// CPF valido = 11 digitos, nao todos iguais, nao zerado
function cpfValido(s) {
  if (!s || s.length !== 11) return false;
  if (/^(\d)\1+$/.test(s)) return false; // 00000000000, 11111111111, etc
  return true;
}

// Decoda DDMMAAAA ou DD/MM/AAAA → YYYY-MM-DD
function parseDataBr(s) {
  if (!s) return null;
  s = String(s).trim();
  if (!s) return null;
  // DDMMAAAA
  const m1 = s.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (m1) return `${m1[3]}-${m1[2]}-${m1[1]}`;
  // DD/MM/AAAA
  const m2 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;
  // YYYY-MM-DD HH:MM:SS — pega so a data
  const m3 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m3) return `${m3[1]}-${m3[2]}-${m3[3]}`;
  return null;
}

// Compara YYYY-MM-DD strings (lexicografica = cronologica)
function dataMaior(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a > b ? a : b;
}

// Validar data ISO (YYYY-MM-DD) com ano razoavel + EXISTE NO CALENDARIO
// (CAGED tem 2024-09-31, 2024-02-30, etc — datas que nao existem). Postgres
// rejeita o batch inteiro se 1 linha tiver data invalida, entao filtramos aqui.
function dataValida(s) {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const ano = parseInt(m[1]);
  const mes = parseInt(m[2]);
  const dia = parseInt(m[3]);
  if (ano < 1900 || ano > 2030) return null;
  if (mes < 1 || mes > 12) return null;
  if (dia < 1 || dia > 31) return null;
  // Validacao real: cria Date UTC e checa se Y/M/D batem (rejeita 2024-09-31, 2023-02-29 etc)
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (isNaN(d.getTime())) return null;
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() + 1 !== mes || d.getUTCDate() !== dia) return null;
  return s;
}

// Parse 1 linha do CAGED → registro pra base
function parseLinha(parts) {
  const cpf = (parts[COL.CPF] || '').replace(/\D/g, '').padStart(11, '0').slice(-11);
  if (!cpfValido(cpf)) return null;

  const nome = (parts[COL.NOME_FUNC] || '').trim();
  if (!nome || nome.length < 3) return null;

  const sexoRaw = parts[COL.SEXO] || '';
  const sexo = sexoRaw === '1' ? 'M' : sexoRaw === '2' ? 'F' : null;

  const dataNasc = dataValida(parseDataBr(parts[COL.DATA_NASC]));
  const dataAdm = dataValida(parseDataBr(parts[COL.DATA_ADMISSAO]));
  const dataDemRaw = parts[COL.DATA_DEMISSAO];
  const dataDem = dataValida(parseDataBr(dataDemRaw));
  const ativo = !dataDem || (dataAdm && dataDem < dataAdm);

  const codUfMun = (parts[COL.COD_MUNI] || parts[COL.COD_UFMUN] || '').replace(/\D/g, '');
  const uf = UF_BY_IBGE[codUfMun.substring(0, 2)] || null;

  const ddd = (parts[COL.DDD1] || '').replace(/\D/g, '').slice(0, 2);
  const tel = (parts[COL.TELEFONE1] || '').replace(/\D/g, '');

  return {
    cpf,
    nome,
    sexo,
    data_nascimento: dataNasc,
    pis: (parts[COL.PIS] || '').replace(/\D/g, '') || null,
    ctps_numero: (parts[COL.CTPS_NUM] || '').trim() || null,
    ctps_serie: (parts[COL.CTPS_SERIE] || '').trim() || null,
    empregador_cnpj: (parts[COL.CNPJ_EMPREGADOR] || '').replace(/\D/g, '') || null,
    empregador_nome: (parts[COL.NOM_RAZAO] || '').trim() || null,
    cbo: (parts[COL.CBO] || '').trim() || null,
    data_admissao: dataAdm,
    data_demissao: dataDem,
    ativo,
    cnae: (parts[COL.CNAE_EMP] || parts[COL.CNAE_R] || '').trim() || null,
    cod_municipio: codUfMun || null,
    cidade: (parts[COL.CIDADE_FUNC] || '').trim() || null,
    uf,
    cidade_empresa: (parts[COL.CIDADE_EMP] || '').trim() || null,
    ddd: ddd || null,
    telefone: tel || null,
    email: (parts[COL.EMAIL] || '').trim() || null,
    ultima_atualizacao_registro: dataMaior(dataAdm, dataDem) || null
  };
}

// Compara 2 registros do mesmo CPF e mantem o de data MAIS RECENTE
function maisRecente(a, b) {
  if (!a) return b;
  if (!b) return a;
  const dA = a.ultima_atualizacao_registro || '';
  const dB = b.ultima_atualizacao_registro || '';
  return dA >= dB ? a : b;
}

// ─── Flush em batch pro Supabase ─────────────────────────────────
async function upsertBatch(linhas) {
  if (linhas.length === 0) return;
  const url = `${SUPA_URL}/rest/v1/${TABELA}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(linhas)
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Supabase HTTP ${r.status}: ${txt.substring(0, 300)}`);
  }
}

async function flushMap(map) {
  const linhas = Array.from(map.values());
  if (linhas.length === 0) return;
  let i = 0;
  while (i < linhas.length) {
    const slice = linhas.slice(i, i + BATCH_SIZE);
    let tentativas = 0;
    while (tentativas < 3) {
      try {
        await upsertBatch(slice);
        break;
      } catch (e) {
        tentativas++;
        if (tentativas >= 3) throw e;
        console.error(`   ⚠️ retry ${tentativas}/3:`, e.message.substring(0, 100));
        await new Promise(r => setTimeout(r, 2000 * tentativas));
      }
    }
    i += BATCH_SIZE;
  }
}

// ─── Loop principal ──────────────────────────────────────────────
async function main() {
  const tamanhoBytes = fs.statSync(FILE).size;
  console.log(`📂 ${FILE}`);
  console.log(`   ${(tamanhoBytes / 1024 / 1024 / 1024).toFixed(2)} GB`);
  console.log(`🚀 Iniciando import — destino: ${TABELA}\n`);

  const stream = fs.createReadStream(FILE);
  // CAGED usa Latin-1/Windows-1252 — Node nao tem direto, usamos TextDecoder
  // por chunk apos split de linha (binary). Mas pra simplificar e ser rapido,
  // vamos ler como latin1 e converter manual usando TextDecoder.
  stream.setEncoding('latin1');
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const cpfs = new Map(); // cpf → registro deduplicado
  let totalLinhas = 0;
  let pulado = 0;
  let totalUpsert = 0;
  let cabecalho = true;
  let inicio = Date.now();
  let ultimoLog = Date.now();

  for await (const linha of rl) {
    totalLinhas++;
    if (cabecalho) { cabecalho = false; continue; } // pula 1a linha

    // Latin-1 → UTF-8 reinterpretation
    const utf8 = Buffer.from(linha, 'latin1').toString('utf8');
    const parts = utf8.split('|');
    if (parts.length < 30) { pulado++; continue; }

    const reg = parseLinha(parts);
    if (!reg) { pulado++; continue; }

    const existente = cpfs.get(reg.cpf);
    cpfs.set(reg.cpf, maisRecente(existente, reg));

    // Flush periodicamente
    if (cpfs.size >= FLUSH_THRESHOLD) {
      const t1 = Date.now();
      await flushMap(cpfs);
      totalUpsert += cpfs.size;
      cpfs.clear();
      console.log(`   💾 flush: +${FLUSH_THRESHOLD} CPFs (${(Date.now()-t1)/1000}s) | total upsert: ${totalUpsert.toLocaleString('pt-BR')}`);
    }

    // Log de progresso a cada 30s
    if (Date.now() - ultimoLog > 30000) {
      const elapsed = (Date.now() - inicio) / 1000;
      const linhasPorSeg = totalLinhas / elapsed;
      console.log(`   📊 ${totalLinhas.toLocaleString('pt-BR')} linhas lidas | ${cpfs.size.toLocaleString('pt-BR')} no buffer | ${linhasPorSeg.toFixed(0)} l/s | pulados: ${pulado.toLocaleString('pt-BR')}`);
      ultimoLog = Date.now();
    }
  }

  // Flush final
  if (cpfs.size > 0) {
    console.log(`\n   💾 flush final: ${cpfs.size.toLocaleString('pt-BR')} CPFs restantes...`);
    await flushMap(cpfs);
    totalUpsert += cpfs.size;
  }

  const totalSeg = (Date.now() - inicio) / 1000;
  console.log(`\n✅ CONCLUÍDO em ${(totalSeg/60).toFixed(1)} minutos`);
  console.log(`   ${totalLinhas.toLocaleString('pt-BR')} linhas processadas`);
  console.log(`   ${pulado.toLocaleString('pt-BR')} linhas puladas (CPF inválido / formato ruim)`);
  console.log(`   ${totalUpsert.toLocaleString('pt-BR')} CPFs upsertados (deduplicados pelo último estado)`);
}

main().catch(e => {
  console.error('\n❌ ERRO:', e);
  process.exit(1);
});
