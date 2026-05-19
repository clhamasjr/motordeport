// ──────────────────────────────────────────────────────────────────
// INSS — Parser do PDF "Histórico de Empréstimo Consignado"
// Extrai do PDF oficial do INSS (meu.inss.gov.br):
//  - Beneficiário + benefício + situação
//  - Margens (consignável, utilizada, disponível, extrapolada)
//  - Contratos ATIVOS de empréstimo (com valor, parcela, prazo, datas, taxa)
//  - Cartões ATIVOS (RMC e RCC) com limite + valor reservado
//  - Descontos de cartão (histórico — pra ver SALDO DEVEDOR)
// Roda 100% client-side via pdfjs-dist.
//
// IMPORTANTE: os regex são TOLERANTES a caracteres acentuados quebrados.
// Em vez de "Histórico" usa "Hist\\S+rico" — bate com 'Histórico' e 'Hist?rico'.
// ──────────────────────────────────────────────────────────────────

// Limpa nomes de banco quebrados em palavras devido ao layout do PDF.
// O pdfjs/pypdf separa "SANTANDER" em "SANTA NDER", "MERCANTIL" em "MERCA NTIL", etc.
function cleanBancoNome(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/\bSANTA\s+NDER\b/gi, 'SANTANDER')
    .replace(/\bMERCA\s+NTIL\b/gi, 'MERCANTIL')
    .replace(/\bAGIBAN\s+K\b/gi, 'AGIBANK')
    .replace(/\bBRADES\s+CO\b/gi, 'BRADESCO')
    .replace(/\bCETEL\s+EM\b/gi, 'CETELEM')
    .replace(/\bDAYCO\s+VAL\b/gi, 'DAYCOVAL')
    .replace(/\bICATU\s+SEG\b/gi, 'ICATU SEG')
    .replace(/\bBONSUC\s+ESSO\b/gi, 'BONSUCESSO')
    .replace(/\bSAFRA\s+S\s+A\b/gi, 'SAFRA S A')
    .replace(/\bBANCOOB\b/gi, 'BANCOOB')
    .replace(/\bPARAN\s+A\b/gi, 'PARANA')
    .trim();
}

// Helper de parsing pt-BR
export function parseBR(v: string | number | null | undefined): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v).trim().replace(/R\$\s*/g, '').replace(/\s/g, '');
  if (!s) return 0;
  if (s.indexOf(',') >= 0) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
  return parseFloat(s) || 0;
}

// ──────────────────────────────────────────────────────────────────
// Tipos
// ──────────────────────────────────────────────────────────────────

export interface InssExtratoBeneficiario {
  nome: string;
  nb: string;
  especie?: string;
  situacao?: string;
  bancoConta?: string;
  agencia?: string;
  contaCorrente?: string;
  bloqueado?: boolean;
  elegivel?: boolean;
}

export interface InssExtratoMargens {
  baseCalculo: number;
  totalComprometido: number;
  maxComprometimentoPermitido: number;
  margemExtrapoladaTotal: number;
  margemExtrapoladaEmp: number;
  margemExtrapoladaRmc: number;
  margemExtrapoladaRcc: number;
  // Para retro-compatibilidade
  margemConsignavelEmp: number;
  margemConsignavelRmc: number;
  margemConsignavelRcc: number;
  margemUtilizadaEmp: number;
  margemUtilizadaRmc: number;
  margemUtilizadaRcc: number;
  margemDisponivelEmp: number;
  margemDisponivelRmc: number;
  margemDisponivelRcc: number;
  margemReservadaEmp: number;
}

export interface InssExtratoContratoEmp {
  contrato: string;
  bancoCodigo: string;
  bancoNome: string;
  situacao: string;
  origemAverbacao?: string;
  dataInclusao?: string;
  inicioDesconto?: string;
  fimDesconto?: string;
  qtdParcelas: number;
  valorParcela: number;
  valorEmprestado: number;
  valorLiberado: number;
  iof: number;
  saldoDevedor?: number;
  cetMensal?: number;
  cetAnual?: number;
  taxaJurosMensal?: number;
  taxaJurosAnual?: number;
  primeiroDesconto?: string;
}

export interface InssExtratoCartao {
  contrato: string;
  tipo: 'RMC' | 'RCC';
  bancoCodigo: string;
  bancoNome: string;
  situacao: string;
  origemAverbacao?: string;
  dataInclusao?: string;
  valorLimite: number;
  valorReservado: number;
  saldoDevedorAtual: number;
  ultimoDescontoCompetencia?: string;
  ultimoDescontoValorUtilizado: number;
  estaUsando: boolean;
  podeCancelar: boolean;
}

export interface InssExtratoDescontoCartao {
  contrato: string;
  tipo: 'RMC' | 'RCC';
  bancoNome: string;
  situacao: string;
  competencia: string;
  saldoDevedor: number;
  utilizadoNoMes: number;
  valorDesconto: number;
  cetMensal?: number;
  taxaJurosMensal?: number;
}

export interface InssExtratoResultado {
  tipo: 'historico_consignado' | 'autenticidade' | 'desconhecido';
  beneficiario: InssExtratoBeneficiario;
  margens: InssExtratoMargens;
  contratos: InssExtratoContratoEmp[];
  cartoes: InssExtratoCartao[];
  descontosCartao: InssExtratoDescontoCartao[];
  geradoEm?: string;
  rawText: string;
  /** Quando tipo != 'historico_consignado', explica por quê. */
  motivo?: string;
}

// ──────────────────────────────────────────────────────────────────
// Parser principal
// ──────────────────────────────────────────────────────────────────

export async function parsePdfInssFromFile(file: File): Promise<InssExtratoResultado> {
  const pdfjs = await import('pdfjs-dist');
  (pdfjs as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  let fullText = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const items = tc.items as { str?: string }[];
    for (const it of items) fullText += (it.str || '') + ' ';
    fullText += '\n\n';
  }
  return parseExtratoText(fullText);
}

/**
 * NORMALIZAÇÃO AGRESSIVA do texto do PDF do INSS.
 * O PDF (extraído por pdfjs-dist ou pypdf) quebra valores e datas em
 * múltiplas linhas. Esta função reconstrói os tokens fragmentados.
 *
 * Exemplos de fragmentação observada no PDF original:
 *   "R$83\n,70"       → "R$83,70"
 *   "R$2.510\n,08"    → "R$2.510,08"
 *   "24/04/2\n6"      → "24/04/26"
 *   "461431\n511"     → contrato "461431511" (junta dígitos)
 *   "318 -\nBANCO\nBMG S\nA" → "318 - BANCO BMG S A"
 */
function normalize(text: string): string {
  let t = text.replace(/\r\n/g, '\n');
  // 1. Junta valores R$ fragmentados: "R$83 ,70" / "R$83\n,70" → "R$83,70"
  t = t.replace(/(R\$\s*[\d.]+)\s*[\n ]+\s*(,\d{2})/g, '$1$2');
  t = t.replace(/(R\$\s*\d+)\s*[\n ]\s*(\.\d{3})/g, '$1$2'); // R$2\n.510 → R$2.510
  // 1b. Junta valor partido sem ponto/vírgula no meio: "R$12 9,03" → "R$129,03"
  // (caso o IOF venha quebrado depois de N dígitos antes do grupo das centenas)
  // Sem \b — "03Ativo" não tem boundary (ambos são word chars). Negativo lookahead garante
  // que não estamos partindo um número que já tem vírgula (ex.: "R$2.510,08 9,03" — caso falso)
  t = t.replace(/(R\$\s*\d{1,4})\s+(\d{1,3},\d{2})(?!\d)/g, '$1$2');
  // 2. Junta datas fragmentadas: 24/04/2\n6 → 24/04/26 ; 04/02/2\n6 → 04/02/26
  t = t.replace(/(\d{2}\/\d{2}\/\d)\s*[\n ]\s*(\d)\b/g, '$1$2');
  // 3. Colapsa todo whitespace em UM espaço
  t = t.replace(/\s+/g, ' ');
  // 4. Espaços antes/depois de vírgula em valores: "R$83 , 70" → "R$83,70"
  t = t.replace(/(\d)\s+,\s*(\d)/g, '$1,$2');
  // 5. Separa valor R$ grudado em letra/palavra: "R$83,70Ativo" → "R$83,70 Ativo"
  t = t.replace(/(R\$\s*[\d.,]+)([A-Za-zÀ-ÿ])/g, '$1 $2');
  // 6. Separa dois R$ grudados: "R$39,12R$81,05" → "R$39,12 R$81,05"
  t = t.replace(/(R\$\s*[\d.,]+)(R\$)/g, '$1 $2');
  // 7. Junta palavras com acento quebrado: "Averbaç ão nova" → "Averbação nova" ;
  //    "Exclu ído" → "Excluído" ; "Encerr ado" → "Encerrado"
  t = t.replace(/(Averba)(?:ç|ç)\s+(ão|ão|\S)/gi, '$1ção $2');
  t = t.replace(/(Exclu)(?:í|í)?\s+(do|ído)/gi, '$1ído');
  t = t.replace(/(Encerr)\s+(ado)/gi, '$1$2');
  // 8. Separa dígito grudado em letra: "0010423831Não" → "0010423831 Não"
  t = t.replace(/(\d)([A-Z][a-záéíóúâêôãõ])/g, '$1 $2');
  return t.trim();
}

export function parseExtratoText(rawText: string): InssExtratoResultado {
  const text = normalize(rawText);
  const empty: InssExtratoResultado = {
    tipo: 'desconhecido',
    beneficiario: { nome: '', nb: '' },
    margens: empytMargens(),
    contratos: [], cartoes: [], descontosCartao: [],
    rawText,
  };

  // Detecta o tipo do PDF — "Histórico de Empréstimo Consignado" tem essas palavras-chave
  const isHistorico = /Hist\S+rico\s+de\s+Empr\S+stimo\s+Consignado/i.test(text) ||
    /HIST\S+RICO\s+DE\s+EMPR\S+STIMO\s+CONSIGNADO/i.test(text) ||
    /CONTRATOS\s+ATIVOS\s+E\s+SUSPENSOS/i.test(text);

  if (!isHistorico) {
    return {
      ...empty,
      tipo: 'autenticidade',
      motivo: 'Esse PDF parece ser de Autenticidade ou outro tipo de documento, não o "Histórico de Empréstimo Consignado". Faça o download em meu.inss.gov.br → "Consignado" → "Solicitar Histórico".',
    };
  }

  const beneficiario = extractBeneficiario(text);
  const margens = extractMargens(text);
  const contratos = extractContratosAtivos(text);
  const cartoes = extractCartoesAtivos(text);
  const descontosCartao = extractDescontosCartao(text);

  // Enriquece cartões com saldo devedor atual + estaUsando + podeCancelar.
  // O nº do contrato no histórico de descontos muda a cada mês (sufixo = competência),
  // então casamos por PREFIXO (primeiros 9 dígitos) + tipo (RMC/RCC).
  for (const c of cartoes) {
    const prefixo = c.contrato.slice(0, 9);
    const ds = descontosCartao.filter((d) =>
      d.tipo === c.tipo && (d.contrato.startsWith(prefixo) || d.bancoNome === c.bancoNome)
    );
    ds.sort((a, b) => compareCompetencia(b.competencia, a.competencia));
    const ultimo = ds[0];
    if (ultimo) {
      c.saldoDevedorAtual = ultimo.saldoDevedor;
      c.ultimoDescontoCompetencia = ultimo.competencia;
      c.ultimoDescontoValorUtilizado = ultimo.utilizadoNoMes;
    }
    // estaUsando = teve compra/utilização no mês OU tem saldo a pagar
    c.estaUsando = (c.saldoDevedorAtual || 0) > 0 || (c.ultimoDescontoValorUtilizado || 0) > 0;
    // podeCancelar = não tem saldo devedor (pode cancelar sem ônus)
    c.podeCancelar = (c.saldoDevedorAtual || 0) <= 0.01;
  }

  // Data de geração no rodapé
  const m = text.match(/(\d{2}\/\d{2}\/\d{4})\s+\d{2}:\d{2}:\d{2}/);
  return {
    tipo: 'historico_consignado',
    beneficiario, margens, contratos, cartoes, descontosCartao,
    geradoEm: m ? m[1] : undefined,
    rawText,
  };
}

function empytMargens(): InssExtratoMargens {
  return {
    baseCalculo: 0, totalComprometido: 0, maxComprometimentoPermitido: 0,
    margemExtrapoladaTotal: 0,
    margemExtrapoladaEmp: 0, margemExtrapoladaRmc: 0, margemExtrapoladaRcc: 0,
    margemConsignavelEmp: 0, margemConsignavelRmc: 0, margemConsignavelRcc: 0,
    margemUtilizadaEmp: 0, margemUtilizadaRmc: 0, margemUtilizadaRcc: 0,
    margemDisponivelEmp: 0, margemDisponivelRmc: 0, margemDisponivelRcc: 0,
    margemReservadaEmp: 0,
  };
}

function compareCompetencia(a: string, b: string): number {
  // Compara "MM/YYYY" — ordena pelo ano/mês
  const pa = a.match(/(\d{2})\/(\d{4})/);
  const pb = b.match(/(\d{2})\/(\d{4})/);
  if (!pa || !pb) return 0;
  const yearDiff = parseInt(pa[2]) - parseInt(pb[2]);
  if (yearDiff !== 0) return yearDiff;
  return parseInt(pa[1]) - parseInt(pb[1]);
}

// ──────────────────────────────────────────────────────────────────
// Sub-parsers — TODOS resilientes a caracteres acentuados quebrados
// (usa \S em vez de letras acentuadas específicas)
// ──────────────────────────────────────────────────────────────────

function extractBeneficiario(text: string): InssExtratoBeneficiario {
  const r: InssExtratoBeneficiario = { nome: '', nb: '' };

  // ── Nome do beneficiário ──
  // Estratégia: aparece depois de "EMPRÉSTIMO CONSIGNADO" e antes de "Benefício"
  // Aceita "Hist\S+rico" / "HIST\S+RICO"
  let m = text.match(/EMPR\S+STIMO\s+CONSIGNADO\s+([A-Z][A-Z][A-Z\s]+?)(?:\s+Benef|\s+N[ºo]?\s*Benef)/i);
  if (m) {
    r.nome = m[1].trim().replace(/\s+/g, ' ');
  } else {
    // Fallback: linha em CAPS sozinha (mais de 2 palavras)
    const linhas = text.split(/\n/);
    for (const l of linhas) {
      const trim = l.trim();
      if (/^[A-Z][A-Z\s]{8,80}$/.test(trim) && trim.split(/\s+/).length >= 2 && !trim.includes('INSS') && !trim.includes('NACIONAL')) {
        r.nome = trim;
        break;
      }
    }
  }

  // ── NB ── (Número do benefício)
  m = text.match(/N[ºo°]?\s*Benef\S+cio[\s:]+([\d.\-]+)/i)
    || text.match(/Benef\S+cio[\s:]+(\d[\d.\-]{6,})/i);
  if (m) r.nb = m[1].replace(/\D/g, '');

  // ── Espécie ──
  // Padrões: "APOSENTADORIA POR IDADE", "PENSAO POR MORTE", "AUXILIO POR INCAPACIDADE",
  //          "APOSENTADORIA POR INVALIDEZ PREVIDENCIARIA"
  // Estratégia: pegar palavras MAIÚSCULAS contínuas e PARAR ao encontrar "Nº", dígito ou minúscula.
  m = text.match(/(APOSENTADORIA\s+POR\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]+(?:\s+PREVIDENCI[A-Z]+|\s+ACIDENT[A-Z]+|\s+POR\s+[A-Z]+)?|PENS[AÃ]O\s+POR\s+MORTE|AUX[IÍ]LIO[\s-]+POR[\s-]+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]+)?|AUX[IÍ]LIO[\s-]+DOEN[CÇ]A|BENEF[IÍ]CIO\s+ASSISTENCIAL(?:\s+[A-Z]+)?|LOAS|AMPARO\s+SOCIAL(?:\s+[A-Z]+)?)/i);
  if (m) {
    let especie = m[1].trim().replace(/\s+/g, ' ');
    // Tira sufixo de label que escapou (Nº, Benef, etc)
    especie = especie.replace(/\s+N[ºo°]?\s*$/i, '').replace(/\s+Benef.*$/i, '');
    r.especie = especie;
  }

  // ── Situação ──
  m = text.match(/Situa\S+o[\s:]+(\w+)/i);
  if (m) r.situacao = m[1].toUpperCase();

  // ── Banco conta / agência / conta ──
  m = text.match(/Pago em[\s:]+([A-Z][A-Z\s\.]+?)(?:\s+Ag\S+ncia|\s+\d|\n)/i);
  if (m) r.bancoConta = m[1].trim().replace(/\s+/g, ' ');
  m = text.match(/Ag\S+ncia[\s:]+(\d+)/i);
  if (m) r.agencia = m[1];
  m = text.match(/Conta\s+Corrente[\s:]+(\d+)/i);
  if (m) r.contaCorrente = m[1];

  // Flags
  r.bloqueado = /Bloqueado para empr/i.test(text);
  r.elegivel = /Eleg\S+vel\s+para\s+empr/i.test(text);

  return r;
}

function extractMargens(text: string): InssExtratoMargens {
  const r = empytMargens();

  // ── VALORES DO BENEFÍCIO ──
  // Formato real do PDF: 4 labels + 4 valores em sequência
  //   "BASE DE CÁLCULO TOTAL COMPROMETIDO MÁXIMO DE COMPROMETIMENTO PERMITIDO MARGEM EXTRAPOLADA*** R$1.621,00 R$729,45 R$729,45 R$0,00"
  const sec = text.match(/VALORES\s+DO\s+BENEF\S+CIO[\s\S]{0,500}/i);
  if (sec) {
    const vals = (sec[0].match(/R\$\s*[\d.,]+/g) || []).slice(0, 4).map((v) => parseBR(v.replace('R$', '')));
    if (vals.length >= 4) {
      r.baseCalculo = vals[0];
      r.totalComprometido = vals[1];
      r.maxComprometimentoPermitido = vals[2];
      r.margemExtrapoladaTotal = vals[3];
    }
  }

  // ── VALORES POR MODALIDADE ──
  // Formato observado:
  //   EMPRÉSTIMOS RMC R$567,35 R$0,00 R$567,35
  //   MARGEM DISPONÍVEL* R$0,00 MARGEM RESERVADA R$0,00
  //   MARGEM EXTRAPOLADA*** R$81,05 R$0,00 R$0,00 - R$81,05
  //   MARGEM CONSIGNÁVEL MARGEM UTILIZADA** RCC ...
  // É complexo — usamos buscas por seções nomeadas
  const modSec = text.match(/EMPR\S+STIMOS\s+RMC[\s\S]{0,800}/i);
  if (modSec) {
    // Os 3 primeiros valores são geralmente: utilEmp, utilRmc, utilRcc
    const vals = (modSec[0].match(/R\$\s*[\d.,]+/g) || []).slice(0, 3).map((v) => parseBR(v.replace('R$', '')));
    if (vals.length >= 3) {
      r.margemUtilizadaEmp = vals[0];
      r.margemUtilizadaRmc = vals[1];
      r.margemUtilizadaRcc = vals[2];
    }
  }

  // Margem extrapolada por modalidade (3 valores após "MARGEM EXTRAPOLADA***")
  const extrapMod = text.match(/MARGEM\s+EXTRAPOLADA\*+\s+(R\$\s*[\d.,]+)\s+(R\$\s*[\d.,]+)\s+(R\$\s*[\d.,]+)/i);
  if (extrapMod) {
    r.margemExtrapoladaEmp = parseBR(extrapMod[1].replace('R$', ''));
    r.margemExtrapoladaRmc = parseBR(extrapMod[2].replace('R$', ''));
    r.margemExtrapoladaRcc = parseBR(extrapMod[3].replace('R$', ''));
  }

  // Fallbacks
  if (r.totalComprometido === 0 && r.margemUtilizadaEmp > 0) {
    r.totalComprometido = r.margemUtilizadaEmp + r.margemUtilizadaRmc + r.margemUtilizadaRcc;
  }
  if (r.baseCalculo === 0 && r.margemUtilizadaEmp > 0) {
    r.baseCalculo = Math.round((r.margemUtilizadaEmp / 0.35) * 100) / 100;
  }

  return r;
}

function extractContratosAtivos(text: string): InssExtratoContratoEmp[] {
  const sec = text.match(/CONTRATOS\s+ATIVOS\s+E\s+SUSPENSOS([\s\S]+?)(?=CONTRATOS\s+EXCLU\S+DOS|CART\S+O\s+DE\s+CR\S+DITO|$)/i);
  if (!sec) return [];
  const block = sec[1];
  const out: InssExtratoContratoEmp[] = [];

  // Padrão real (após normalize):
  //   "461431 511 318 - BANCO BMG S A 05/2026 04/2034 96 R$57,02 R$2.510,08 R$83,70 Ativo Averbação nova 24/04/26 R$2.426,38 1,94 26,38 1,84 24,45 07/06/26"
  // O contrato pode vir partido em 2 grupos de dígitos com espaço entre.
  // Estratégia: ler digit-runs separados por espaços, juntar TODOS os dígitos
  // até encontrar o código de banco (3 dígitos seguidos de " - ").
  //
  // Regex captura:
  //   1. "contrato"   = ((?:\d+\s+)+?\d+) — dígitos com espaços
  //   2. "codBanco"   = (\d{3})
  //   3. "nomeBanco"  = ([A-Z][^0-9]+?)   — letras até próximo dígito (data)
  //   4. "inicio"     = (\d{2}/\d{4})
  //   5. "fim"        = (\d{2}/\d{4})
  //   6. "qtdParc"    = (\d{2,3})
  //   7. "parcela"    = R$...
  //   8. "emprestado" = R$...
  //   9. "iof"        = R$...
  //   10. "situacao"  = (Ativo|Suspens...|Exclu...|Encerr...)
  // \b\d{4,} = começa com run de ≥4 dígitos (evita pegar "26" do final de "07/06/26")
  const re = /\b(\d{4,}(?:\s+\d{1,5}){0,2})\s+(\d{3})\s*-\s*([A-Z][^0-9]+?)\s+(\d{2}\/\d{4})\s+(\d{2}\/\d{4})\s+(\d{2,3})\s+R\$\s*([\d.,]+)\s+R\$\s*([\d.,]+)\s+R\$\s*([\d.,]+)\s+(Ativo|Suspens\S*|Exclu\S+do|Encerrado)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const contratoJoined = m[1].replace(/\s+/g, '');
    // contratos válidos têm pelo menos 6 dígitos. Pula falsos positivos.
    if (contratoJoined.length < 6) continue;
    // Pega o "after" pra extrair taxas, valor liberado e data primeiro desconto
    const idxEnd = m.index + m[0].length;
    const after = block.substring(idxEnd, Math.min(idxEnd + 600, block.length));

    // Origem averbação (próxima palavra(s) depois de situação até a data)
    const origMatch = after.match(/^\s*([A-Za-zÀ-ÿ\s]+?)\s+(?:CBC:\s*\d+\s+)?(\d{2}\/\d{2}\/\d{2,4})/);
    const origem = origMatch ? origMatch[1].trim().replace(/\s+/g, ' ') : undefined;
    const dataIncl = origMatch ? origMatch[2] : undefined;

    // Valor liberado (R$ logo após data de inclusão)
    const liberadoMatch = after.match(/\d{2}\/\d{2}\/\d{2,4}\s+R\$\s*([\d.,]+)/);
    const valorLiberado = liberadoMatch ? parseBR(liberadoMatch[1]) : parseBR(m[8]) - parseBR(m[9]);

    // Taxas: 4 valores decimais em sequência (CET mensal, CET anual, Juros mensal, Juros anual)
    const taxasM = after.match(/(\d+,\d+)\s+(\d+,\d+)\s+(\d+,\d+)\s+(\d+,\d+)/);
    // Primeiro desconto (última data dd/mm/yy do bloco)
    const primDescMatch = after.match(/(\d{2}\/\d{2}\/\d{2,4})\s*(?:$|\d{6,})/);

    out.push({
      contrato: contratoJoined,
      bancoCodigo: m[2],
      bancoNome: cleanBancoNome(m[3]),
      situacao: m[10],
      origemAverbacao: origem,
      dataInclusao: dataIncl,
      qtdParcelas: parseInt(m[6], 10),
      valorParcela: parseBR(m[7]),
      valorEmprestado: parseBR(m[8]),
      iof: parseBR(m[9]),
      valorLiberado,
      inicioDesconto: m[4],
      fimDesconto: m[5],
      cetMensal: taxasM ? parseFloat(taxasM[1].replace(',', '.')) : undefined,
      cetAnual: taxasM ? parseFloat(taxasM[2].replace(',', '.')) : undefined,
      taxaJurosMensal: taxasM ? parseFloat(taxasM[3].replace(',', '.')) : undefined,
      taxaJurosAnual: taxasM ? parseFloat(taxasM[4].replace(',', '.')) : undefined,
      primeiroDesconto: primDescMatch ? primDescMatch[1] : undefined,
    });
  }
  return out;
}

function extractCartoesAtivos(text: string): InssExtratoCartao[] {
  const out: InssExtratoCartao[] = [];
  // RMC
  const rmcSec = text.match(/CART\S+O\s+DE\s+CR\S+DITO\s*-\s*RMC[\s\S]+?CONTRATOS\s+ATIVOS\s+E\s+SUSPENSOS([\s\S]+?)(?=CART\S+O\s+DE\s+CR\S+DITO\s*-\s*RCC|DESCONTOS\s+DE\s+CART|$)/i);
  // RCC
  const rccSec = text.match(/CART\S+O\s+DE\s+CR\S+DITO\s*-\s*RCC[\s\S]+?CONTRATOS\s+ATIVOS\s+E\s+SUSPENSOS([\s\S]+?)(?=DESCONTOS\s+DE\s+CART|$)/i);

  const parse = (block: string, tipo: 'RMC' | 'RCC') => {
    // Padrão real (após normalize):
    //   "0055148330001 389 - BANCO MERCANTIL DO BRASIL S A R$2.000,00 Ativo Averbação nova 17/04/23 R$81,05 Reserva de Margem para Cartão (RMC)"
    const re = /(\d{10,})\s+(\d{3})\s*-\s*([A-Z][A-Z\s\/\.&]+?)\s+R\$\s*([\d.,]+)\s+(Ativo|Suspens\S+)\s+(Averba\S+\s+\S+(?:\s+\S+)?|Migrad\S+[\s\S]+?CBC[:\s]+\d+)\s+(\d{2}\/\d{2}\/\d{2,4})\s+R\$\s*([\d.,]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) {
      out.push({
        contrato: m[1],
        tipo,
        bancoCodigo: m[2],
        bancoNome: cleanBancoNome(m[3]),
        valorLimite: parseBR(m[4]),
        situacao: m[5],
        origemAverbacao: m[6].trim().slice(0, 80).replace(/\s+/g, ' '),
        dataInclusao: m[7],
        valorReservado: parseBR(m[8]),
        saldoDevedorAtual: 0,
        ultimoDescontoValorUtilizado: 0,
        estaUsando: false,
        podeCancelar: true,
      });
    }
  };
  if (rmcSec) parse(rmcSec[1], 'RMC');
  if (rccSec) parse(rccSec[1], 'RCC');
  return out;
}

function extractDescontosCartao(text: string): InssExtratoDescontoCartao[] {
  const sec = text.match(/DESCONTOS\s+DE\s+CART\S+O([\s\S]+)/i);
  if (!sec) return [];
  const block = sec[1];
  const out: InssExtratoDescontoCartao[] = [];

  // Padrão real (após normalize com separadores R$/letra inseridos):
  //   "00551483328042026 389 - BANCO MERCANTIL DO BRASIL S A R$2.023,80 Encerrado 05/2026 R$39,12 R$81,05 Desconto de cartão (RMC) R$3,60 3,12 44,73 2,46 26,00"
  // [A-Z\s\/\.&]+? evita pegar R/$ literais mas casa "BANCO MERCANTIL DO BRASIL S A"
  const re = /(\d{10,})\s+(\d{3})\s*-\s*([A-Z][A-Z\s\/\.&]+?)\s+R\$\s*([\d.,]+)\s+(Ativo|Suspens\S+|Encerrado|Exclu\S+do)\s+(\d{2}\/\d{4})\s+R\$\s*([\d.,]+)\s+R\$\s*([\d.,]+)\s+Desconto\s+de\s+cart\S+o\s*\((RMC|RCC)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    // Após a captura, pega o IOF + taxas (se existirem)
    const idxEnd = m.index + m[0].length;
    const after = block.substring(idxEnd, Math.min(idxEnd + 200, block.length));
    const iofMatch = after.match(/^\s*R\$\s*([\d.,]+)/);
    const taxasM = after.match(/(\d+,\d+)\s+(\d+,\d+)\s+(\d+,\d+)\s+(\d+,\d+)/);

    out.push({
      contrato: m[1],
      tipo: m[9].toUpperCase() as 'RMC' | 'RCC',
      bancoNome: cleanBancoNome(m[3]),
      situacao: m[5],
      competencia: m[6],
      saldoDevedor: parseBR(m[4]),
      utilizadoNoMes: parseBR(m[7]),
      valorDesconto: parseBR(m[8]),
      cetMensal: taxasM ? parseFloat(taxasM[1].replace(',', '.')) : undefined,
      taxaJurosMensal: taxasM ? parseFloat(taxasM[3].replace(',', '.')) : undefined,
    });
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────
// ENQUADRAMENTO baseado no extrato + análise de cartão
// ──────────────────────────────────────────────────────────────────

export interface AnaliseExtrato {
  baseCalculo: number;
  totalComprometido: number;
  sumEmp: number;
  sumRmc: number;
  sumRcc: number;
  teto40: number;
  excedenteNovaRegra: number;
  compPctSobre40: number;
  enquadraNovaRegra: boolean;
  contratosQueResolvem: { contrato: string; reducaoEstim: number; novaParc: number; bancoNome: string }[];
  cartoesQueResolvem: { contrato: string; tipo: 'RMC' | 'RCC'; valorReservado: number; saldoDevedor: number; podeCancelarSemPagar: boolean; resolve: boolean }[];
}

function coefPrice108_150(): number {
  const i = 0.015;
  return i / (1 - Math.pow(1 + i, -108));
}

export function analisarEnquadramento(ext: InssExtratoResultado): AnaliseExtrato {
  const baseCalculo = ext.margens.baseCalculo;
  const totalComprometido = ext.margens.totalComprometido;
  const sumEmp = ext.contratos.reduce((s, c) => s + (c.valorParcela || 0), 0);
  const sumRmc = ext.cartoes.filter((c) => c.tipo === 'RMC').reduce((s, c) => s + (c.valorReservado || 0), 0);
  const sumRcc = ext.cartoes.filter((c) => c.tipo === 'RCC').reduce((s, c) => s + (c.valorReservado || 0), 0);
  const teto40 = baseCalculo * 0.40;
  const total = totalComprometido || (sumEmp + sumRmc + sumRcc);
  const excedente = Math.max(0, total - teto40);
  const compPct = baseCalculo > 0 ? (total / baseCalculo) * 100 : 0;
  const enquadra = total <= teto40 + 0.01 && baseCalculo > 0;

  const coef = coefPrice108_150();
  const contratosQueResolvem: AnaliseExtrato['contratosQueResolvem'] = [];
  for (const c of ext.contratos) {
    if (!c.valorParcela || !c.valorEmprestado) continue;
    const saldoAprox = c.valorEmprestado;
    const novaParc = saldoAprox * coef;
    const reducao = c.valorParcela - novaParc;
    if (reducao > 0 && reducao >= excedente - 0.01 && excedente > 0) {
      contratosQueResolvem.push({
        contrato: c.contrato,
        reducaoEstim: Math.round(reducao * 100) / 100,
        novaParc: Math.round(novaParc * 100) / 100,
        bancoNome: c.bancoNome,
      });
    }
  }
  const cartoesQueResolvem: AnaliseExtrato['cartoesQueResolvem'] = ext.cartoes.map((c) => ({
    contrato: c.contrato,
    tipo: c.tipo,
    valorReservado: c.valorReservado,
    saldoDevedor: c.saldoDevedorAtual || 0,
    podeCancelarSemPagar: c.podeCancelar,
    resolve: c.valorReservado >= excedente - 0.01,
  }));

  return {
    baseCalculo, totalComprometido: total, sumEmp, sumRmc, sumRcc,
    teto40, excedenteNovaRegra: excedente, compPctSobre40: Math.round(compPct * 10) / 10,
    enquadraNovaRegra: enquadra,
    contratosQueResolvem, cartoesQueResolvem,
  };
}
