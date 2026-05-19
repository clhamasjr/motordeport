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

export function parseExtratoText(text: string): InssExtratoResultado {
  const empty: InssExtratoResultado = {
    tipo: 'desconhecido',
    beneficiario: { nome: '', nb: '' },
    margens: empytMargens(),
    contratos: [], cartoes: [], descontosCartao: [],
    rawText: text,
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

  // Enriquece cartões com saldo devedor atual + estaUsando + podeCancelar
  for (const c of cartoes) {
    const ds = descontosCartao.filter((d) => d.contrato === c.contrato || d.tipo === c.tipo);
    ds.sort((a, b) => compareCompetencia(b.competencia, a.competencia));
    const ultimo = ds[0];
    if (ultimo) {
      c.saldoDevedorAtual = ultimo.saldoDevedor;
      c.ultimoDescontoCompetencia = ultimo.competencia;
      c.ultimoDescontoValorUtilizado = ultimo.utilizadoNoMes;
    }
    c.estaUsando = (c.saldoDevedorAtual || 0) > 0 || (c.ultimoDescontoValorUtilizado || 0) > 0;
    c.podeCancelar = (c.saldoDevedorAtual || 0) <= 0.01;
  }

  // Data de geração no rodapé
  const m = text.match(/(\d{2}\/\d{2}\/\d{4})\s+\d{2}:\d{2}:\d{2}/);
  return {
    tipo: 'historico_consignado',
    beneficiario, margens, contratos, cartoes, descontosCartao,
    geradoEm: m ? m[1] : undefined,
    rawText: text,
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
  // Padrões: "APOSENTADORIA POR IDADE", "PENSAO POR MORTE", "AUXILIO POR INCAPACIDADE", "APOSENTADORIA POR INVALIDEZ PREVIDENCIARIA"
  m = text.match(/(APOSENTADORIA(?:\s+POR\s+\S+(?:\s+\S+)?(?:\s+\S+)?)?|PENS\S+O\s+POR\s+MORTE|AUX\S+LIO\s+POR\s+\S+(?:\s+\S+)?|BENEF\S+CIO\s+ASSISTENCIAL[A-Z\s]+|LOAS[A-Z\s]*)/i);
  if (m) {
    let especie = m[1].trim().replace(/\s+/g, ' ');
    // Tira sufixo isolado de 1-2 letras (lixo de quebra de linha)
    especie = especie.replace(/\s+[A-Z]{1,2}$/, '');
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

  // Valores do benefício (resumo final)
  let m = text.match(/BASE\s+DE\s+C\S+LCULO\s+R\$\s*([\d.,]+)/i);
  if (m) r.baseCalculo = parseBR(m[1]);

  m = text.match(/TOTAL\s+COMPROMETIDO\s+R\$\s*([\d.,]+)/i);
  if (m) r.totalComprometido = parseBR(m[1]);

  m = text.match(/M\S+XIMO\s+DE\s+COMPROMETIMENTO[\w\s]*R\$\s*([\d.,]+)/i);
  if (m) r.maxComprometimentoPermitido = parseBR(m[1]);

  // Margem extrapolada total (vem em "Valores do Benefício")
  // Pode aparecer duas vezes — uma na seção VALORES POR MODALIDADE (3 colunas) e outra no resumo
  // Pega a ÚLTIMA ocorrência que é o total
  const reExtrap = /MARGEM\s+EXTRAPOLADA[*\s\S]{0,200}R\$\s*([\d.,]+)/gi;
  let lastMatch: RegExpExecArray | null = null;
  let allMatches: RegExpExecArray[] = [];
  while ((lastMatch = reExtrap.exec(text)) !== null) allMatches.push(lastMatch);
  if (allMatches.length > 0) {
    // Última ocorrência costuma ser o total (VALORES DO BENEFÍCIO)
    r.margemExtrapoladaTotal = parseBR(allMatches[allMatches.length - 1][1]);
  }

  // Margens por modalidade (EMP / RMC / RCC) — captura 3 valores depois do label
  const captureTriple = (re: RegExp): [number, number, number] | null => {
    const mm = text.match(re);
    if (!mm) return null;
    const after = text.substring(mm.index! + mm[0].length, mm.index! + mm[0].length + 200);
    const vals = (after.match(/R\$\s*[\d.,]+/g) || []).slice(0, 3).map((v) => parseBR(v.replace('R$', '')));
    if (vals.length < 3) return null;
    return [vals[0], vals[1], vals[2]];
  };

  const consig = captureTriple(/MARGEM\s+CONSIGN\S+VEL/i);
  if (consig) { [r.margemConsignavelEmp, r.margemConsignavelRmc, r.margemConsignavelRcc] = consig; }

  const util = captureTriple(/MARGEM\s+UTILIZADA/i);
  if (util) { [r.margemUtilizadaEmp, r.margemUtilizadaRmc, r.margemUtilizadaRcc] = util; }

  const disp = captureTriple(/MARGEM\s+DISPON\S+VEL/i);
  if (disp) { [r.margemDisponivelEmp, r.margemDisponivelRmc, r.margemDisponivelRcc] = disp; }

  // Fallback: se base de cálculo vazia mas extrapolada existe, deriva
  if (r.baseCalculo === 0 && r.margemUtilizadaEmp > 0) {
    // Aproximação: base ≈ utilizadaEmp / 0.35 (regra ATUAL)
    // mas só se tiver valor — senão deixa zero
    r.baseCalculo = Math.round((r.margemUtilizadaEmp / 0.35) * 100) / 100;
  }

  if (r.totalComprometido === 0) {
    r.totalComprometido = r.margemUtilizadaEmp + r.margemUtilizadaRmc + r.margemUtilizadaRcc;
  }

  return r;
}

function extractContratosAtivos(text: string): InssExtratoContratoEmp[] {
  const sec = text.match(/CONTRATOS\s+ATIVOS\s+E\s+SUSPENSOS([\s\S]+?)(?=CONTRATOS\s+EXCLU\S+DOS|CART\S+O\s+DE\s+CR\S+DITO|$)/i);
  if (!sec) return [];
  const block = sec[1];
  const out: InssExtratoContratoEmp[] = [];

  // Padrão: numero_contrato_longo (≥6 dig) + cod_banco_3_dig + nome + datas + qtd + valores
  const re = /(\d{6,})\s+(\d{3})\s*-\s*([A-Z][A-Z\s\/\.&]+?)\s+(\d{2}\/\d{4})\s+(\d{2}\/\d{4})\s+(\d{2,3})\s+R\$\s*([\d.,]+)\s+R\$\s*([\d.,]+)\s+R\$\s*([\d.,]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const after = block.substring(m.index, Math.min(m.index + 1500, block.length));
    const sit = after.match(/(Ativo|Suspenso|Suspens|Exclu\S+do|Encerrado)/i);
    const valLib = after.match(/R\$\s*([\d.,]+)\s+(?:\d+,\d+|\d{2}\/\d{2})/);
    const taxas = [...after.matchAll(/(\d+,\d+)\s+(\d+,\d+)\s+(\d+,\d+)\s+(\d+,\d+)/g)];

    out.push({
      contrato: m[1],
      bancoCodigo: m[2],
      bancoNome: m[3].trim().replace(/\s+/g, ' '),
      situacao: sit ? sit[1] : 'Ativo',
      qtdParcelas: parseInt(m[6], 10),
      valorParcela: parseBR(m[7]),
      valorEmprestado: parseBR(m[8]),
      iof: parseBR(m[9]),
      valorLiberado: valLib ? parseBR(valLib[1]) : parseBR(m[8]) - parseBR(m[9]),
      inicioDesconto: m[4],
      fimDesconto: m[5],
      cetMensal: taxas[0] ? parseFloat(taxas[0][1].replace(',', '.')) : undefined,
      cetAnual: taxas[0] ? parseFloat(taxas[0][2].replace(',', '.')) : undefined,
      taxaJurosMensal: taxas[0] ? parseFloat(taxas[0][3].replace(',', '.')) : undefined,
      taxaJurosAnual: taxas[0] ? parseFloat(taxas[0][4].replace(',', '.')) : undefined,
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
    const re = /(\d{10,})\s+(\d{3})\s*-\s*([A-Z][A-Z\s\/\.&]+?)\s+R\$\s*([\d.,]+)\s*(Ativo|Suspens\S+)\s+([A-Za-z\s\S]+?)\s+(\d{2}\/\d{2}\/\d{2,4})\s+R\$\s*([\d.,]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) {
      out.push({
        contrato: m[1],
        tipo,
        bancoCodigo: m[2],
        bancoNome: m[3].trim().replace(/\s+/g, ' '),
        valorLimite: parseBR(m[4]),
        situacao: m[5],
        origemAverbacao: m[6].trim().slice(0, 50),
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

  // Padrão: numero_contrato cod-bank NOME R$saldo SITUACAO MM/YYYY R$utilizado R$desconto Desconto de cart\So (RMC|RCC)
  const re = /(\d{10,})\s+(\d{3})\s*-\s*([A-Z][A-Z\s\/\.&]+?)\s+R\$\s*([\d.,]+)\s*(Ativo|Suspens\S+|Encerrado|Exclu\S+do)\s+(\d{2}\/\d{4})\s+R\$\s*([\d.,]+)\s+R\$\s*([\d.,]+)\s+Desconto\s+de\s+cart\S+o\s*\((RMC|RCC)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    out.push({
      contrato: m[1],
      tipo: m[9].toUpperCase() as 'RMC' | 'RCC',
      bancoNome: m[3].trim().replace(/\s+/g, ' '),
      situacao: m[5],
      competencia: m[6],
      saldoDevedor: parseBR(m[4]),
      utilizadoNoMes: parseBR(m[7]),
      valorDesconto: parseBR(m[8]),
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
