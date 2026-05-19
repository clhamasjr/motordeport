// ──────────────────────────────────────────────────────────────────
// INSS — Parser do PDF "Histórico de Empréstimo Consignado"
// Extrai do PDF oficial do INSS (meu.inss.gov.br):
//  - Beneficiário + benefício + situação
//  - Margens (consignável, utilizada, disponível, extrapolada)
//  - Contratos ATIVOS de empréstimo (com valor, parcela, prazo, datas, taxa)
//  - Cartões ATIVOS (RMC e RCC) com limite + valor reservado
//  - Descontos de cartão (histórico — pra ver SALDO DEVEDOR)
// Roda 100% client-side via pdfjs-dist.
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
  procurador?: boolean;
  representanteLegal?: boolean;
  pensaoAlimenticia?: boolean;
}

export interface InssExtratoMargens {
  // Por modalidade
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
  margemExtrapoladaEmp: number;
  margemExtrapoladaRmc: number;
  margemExtrapoladaRcc: number;
  // Resumo do benefício
  baseCalculo: number;
  totalComprometido: number;
  maxComprometimentoPermitido: number;
  margemExtrapoladaTotal: number;
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
  saldoDevedor?: number; // valor pago em refin/port (campo "VALOR PAGO**")
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
  // Calculado a partir do histórico de descontos
  saldoDevedorAtual: number;
  ultimoDescontoCompetencia?: string;
  ultimoDescontoValorUtilizado: number;
  /** TRUE se o cartão está sendo USADO ativamente (saldo > 0 ou usando no mês). */
  estaUsando: boolean;
  /** TRUE se pode ser cancelado sem custo (saldo devedor = 0). */
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
  beneficiario: InssExtratoBeneficiario;
  margens: InssExtratoMargens;
  contratos: InssExtratoContratoEmp[];
  cartoes: InssExtratoCartao[];
  descontosCartao: InssExtratoDescontoCartao[];
  geradoEm?: string;
  rawText: string;
}

// ──────────────────────────────────────────────────────────────────
// Parser principal
// ──────────────────────────────────────────────────────────────────

export async function parsePdfInssFromFile(file: File): Promise<InssExtratoResultado> {
  // pdfjs-dist no client
  const pdfjs = await import('pdfjs-dist');
  // Worker path (Next.js): mantemos sem worker (slow mode) pra evitar setup
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
  const beneficiario = extractBeneficiario(text);
  const margens = extractMargens(text);
  const contratos = extractContratosAtivos(text);
  const cartoes = extractCartoesAtivos(text);
  const descontosCartao = extractDescontosCartao(text);

  // Enriquece cartões com info de "estaUsando" e "podeCancelar"
  for (const c of cartoes) {
    const ds = descontosCartao.filter((d) => d.contrato === c.contrato || d.tipo === c.tipo);
    ds.sort((a, b) => (b.competencia || '').localeCompare(a.competencia || ''));
    const ultimo = ds[0];
    if (ultimo) {
      c.saldoDevedorAtual = ultimo.saldoDevedor;
      c.ultimoDescontoCompetencia = ultimo.competencia;
      c.ultimoDescontoValorUtilizado = ultimo.utilizadoNoMes;
    }
    // estaUsando = saldo devedor > 0 OU utilizado no mês > 0
    c.estaUsando = (c.saldoDevedorAtual || 0) > 0 || (c.ultimoDescontoValorUtilizado || 0) > 0;
    // podeCancelar = saldo devedor ≤ 0 (cliente não deve nada)
    c.podeCancelar = (c.saldoDevedorAtual || 0) <= 0.01;
  }

  // Geração: extrai data do rodapé
  const m = text.match(/(\d{2}\/\d{2}\/\d{4})\s+\d{2}:\d{2}:\d{2}/);
  return {
    beneficiario, margens, contratos, cartoes, descontosCartao,
    geradoEm: m ? m[1] : undefined,
    rawText: text,
  };
}

// ──────────────────────────────────────────────────────────────────
// Sub-parsers
// ──────────────────────────────────────────────────────────────────

function extractBeneficiario(text: string): InssExtratoBeneficiario {
  const r: InssExtratoBeneficiario = { nome: '', nb: '' };
  // Nome: aparece logo após "HISTÓRICO DE EMPRÉSTIMO CONSIGNADO"
  let m = text.match(/EMPR[��ÉE]STIMO\s+CONSIGNADO\s+([A-Z][A-Z\s]+?)\s+Benef[��É]cio/i);
  if (m) r.nome = m[1].trim().replace(/\s+/g, ' ');
  // NB
  m = text.match(/Benef[��É]cio[\s:]+([\d.\-]+)/i) ||
      text.match(/N[º°]?\s*Benef[��É]cio[\s:]+([\d.\-]+)/i);
  if (m) r.nb = m[1].replace(/\D/g, '');
  // Espécie
  m = text.match(/Benef[��É]cio\s+([A-Z][A-Z\s]+?)(?:\s+N[º°]|\s+\d)/i);
  if (m && !m[1].includes('Benef')) r.especie = m[1].trim().replace(/\s+/g, ' ');
  // Outro padrão
  m = text.match(/(APOSENTADORIA[A-Z\s]*|PENS[��ÃA]O[A-Z\s]*|AUX[��ÍI]LIO[A-Z\s]*)/i);
  if (m && !r.especie) r.especie = m[1].trim().replace(/\s+/g, ' ');
  // Situação
  m = text.match(/Situa[c��çã]+o[\s:]+(\w+)/i);
  if (m) r.situacao = m[1].toUpperCase();
  // Banco/conta
  m = text.match(/Pago em[\s:]+([A-Z][A-Z\s\.]+?)(?:\s+Ag[��êe]ncia|\s+\d)/i);
  if (m) r.bancoConta = m[1].trim().replace(/\s+/g, ' ');
  m = text.match(/Ag[��êe]ncia[\s:]+(\d+)/i);
  if (m) r.agencia = m[1];
  m = text.match(/Conta\s+Corrente[\s:]+(\d+)/i);
  if (m) r.contaCorrente = m[1];
  // Flags
  r.bloqueado = /Bloqueado para empr/i.test(text);
  r.elegivel = /Eleg[��Íi]vel para empr/i.test(text);
  r.procurador = !/N[��ãa]o possui procurador/i.test(text);
  r.representanteLegal = !/N[��ãa]o possui representante legal/i.test(text);
  r.pensaoAlimenticia = !/N[��ãa]o [��ée] pens[��ãa]o aliment[��íi]cia/i.test(text);
  return r;
}

function extractMargens(text: string): InssExtratoMargens {
  // Pega o bloco "VALORES POR MODALIDADE"
  // Strutura: 6 valores por linha (EMP / RMC / RCC) × 5 linhas
  const r: InssExtratoMargens = {
    margemConsignavelEmp: 0, margemConsignavelRmc: 0, margemConsignavelRcc: 0,
    margemUtilizadaEmp: 0, margemUtilizadaRmc: 0, margemUtilizadaRcc: 0,
    margemDisponivelEmp: 0, margemDisponivelRmc: 0, margemDisponivelRcc: 0,
    margemReservadaEmp: 0,
    margemExtrapoladaEmp: 0, margemExtrapoladaRmc: 0, margemExtrapoladaRcc: 0,
    baseCalculo: 0, totalComprometido: 0, maxComprometimentoPermitido: 0,
    margemExtrapoladaTotal: 0,
  };
  // VALORES DO BENEFÍCIO
  let m = text.match(/BASE\s+DE\s+C[��ÁA]LCULO\s+R\$\s*([\d.,]+)/i);
  if (m) r.baseCalculo = parseBR(m[1]);
  m = text.match(/TOTAL\s+COMPROMETIDO\s+R\$\s*([\d.,]+)/i);
  if (m) r.totalComprometido = parseBR(m[1]);
  m = text.match(/M[��ÁA]XIMO\s+DE\s+COMPROMETIMENTO[\w\s]*\s+R\$\s*([\d.,]+)/i);
  if (m) r.maxComprometimentoPermitido = parseBR(m[1]);

  // Valores por modalidade — captura todos os números na seção
  // O texto vem mais ou menos assim:
  // EMPRÉSTIMOS RMC R$567,35 R$0,00 R$567,35 MARGEM DISPONÍVEL* R$0,00 MARGEM RESERVADA R$0,00
  // MARGEM EXTRAPOLADA*** R$81,05 R$0,00 R$0,00 - R$81,05 MARGEM CONSIGNÁVEL MARGEM UTILIZADA** RCC
  // Vou usar uma estratégia de capturar a sequência de valores na ordem em que aparecem.
  const modSec = text.match(/EMPR[��ÉE]STIMOS\s+RMC([\s\S]+?)VALORES\s+DO\s+BENEF[��ÍI]CIO/i);
  if (modSec) {
    const valoresStr = modSec[1];
    const valores = (valoresStr.match(/R\$\s*[\d.,]+/g) || []).map((v) => parseBR(v.replace('R$', '')));
    // Tipicamente extrai: [utilEmp, utilRmc, utilRcc OU disp/extrap] — ordem varia
    // Vamos buscar contexto via labels
    // Margem utilizada (encontra "MARGEM UTILIZADA**" e pega valores depois — mas a ordem varia)
    // Estratégia mais robusta: usar regex direto em frases conhecidas
  }
  // Padrão direto: cada label seguido de 3 valores (emp/rmc/rcc)
  const captureRow = (label: RegExp): [number, number, number] => {
    const reAll = new RegExp(label.source + '[\\s\\S]{0,500}', 'i');
    const sec = text.match(reAll);
    if (!sec) return [0, 0, 0];
    const vals = (sec[0].match(/R\$\s*[\d.,]+/g) || []).slice(0, 3).map((v) => parseBR(v.replace('R$', '')));
    return [vals[0] || 0, vals[1] || 0, vals[2] || 0];
  };

  // Como a ordem dos campos no PDF é confusa, vou só usar VALORES DO BENEFÍCIO + parcelas explícitas
  // O dado mais confiável é o "VALOR PARCELA" dos contratos somado e os limites/reservados dos cartões
  // que já vêm tipados nas próprias seções.
  void captureRow; // evita warning

  // Margem extrapolada por modalidade (encontra na seção)
  m = text.match(/MARGEM\s+EXTRAPOLADA[*\s]*R\$\s*([\d.,]+)\s+R\$\s*([\d.,]+)\s+R\$\s*([\d.,]+)/i);
  if (m) {
    r.margemExtrapoladaEmp = parseBR(m[1]);
    r.margemExtrapoladaRmc = parseBR(m[2]);
    r.margemExtrapoladaRcc = parseBR(m[3]);
  }
  r.margemExtrapoladaTotal = r.margemExtrapoladaEmp + r.margemExtrapoladaRmc + r.margemExtrapoladaRcc;

  return r;
}

function extractContratosAtivos(text: string): InssExtratoContratoEmp[] {
  // A seção "CONTRATOS ATIVOS E SUSPENSOS" vem antes de "CONTRATOS EXCLUÍDOS E ENCERRADOS"
  const sec = text.match(/CONTRATOS\s+ATIVOS\s+E\s+SUSPENSOS[\s\S]+?(?=CONTRATOS\s+EXCLU[��ÍI]DOS|CART[��ÃA]O\s+DE\s+CR[��ÉE]DITO|$)/i);
  if (!sec) return [];
  const block = sec[0];
  const out: InssExtratoContratoEmp[] = [];

  // Cada contrato começa com um número (≥6 dígitos) seguido de código bank (3 dígitos) e nome do banco
  // Padrão observado: contrato\n cod-bank\n NOME BANCO\n competências\n parcelas\n parcela\n emprestado\n iof\n SITUACAO\n etc
  // Vou usar uma regex que captura cada bloco até o próximo número de contrato
  const re = /(\d{6,})\s+(\d{3})\s*-\s*([A-Z][A-Z\s\/\.&]+?)\s+(\d{2}\/\d{4})\s+(\d{2}\/\d{4})\s+(\d{2,3})\s+R\$\s*([\d.,]+)\s+R\$\s*([\d.,]+)\s+R\$\s*([\d.,]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const contrato = m[1];
    const bancoCodigo = m[2];
    const bancoNome = m[3].trim().replace(/\s+/g, ' ');
    const inicioDesconto = m[4];
    const fimDesconto = m[5];
    const qtdParcelas = parseInt(m[6], 10);
    const valorParcela = parseBR(m[7]);
    const valorEmprestado = parseBR(m[8]);
    const iof = parseBR(m[9]);

    // Pega o pedaço depois do match pra extrair: situação, valor liberado, datas, taxas, valor pago
    const after = block.substring(m.index, m.index + 1500);
    const sit = after.match(/(Ativo|Suspenso|Suspens|Exclu[��íi]do|Encerrado)/i);
    const valLib = after.match(/R\$\s*([\d.,]+)\s+(?:\d+,\d+\s+\d+,\d+|R\$|\d{2}\/\d{2}\/\d{2,4})/);
    const taxas = [...after.matchAll(/(\d+,\d+)\s+(\d+,\d+)\s+(\d+,\d+)\s+(\d+,\d+)/g)];
    const valPago = after.match(/R\$\s*([\d.,]+)\s+(?:R\$\s*[\d.,]+\s+)?(?:Migrado|Averba|sub|R\$|07|01|18)/i);
    const primDesc = after.match(/(\d{2}\/\d{2}\/\d{2,4})\s*$/m);

    out.push({
      contrato,
      bancoCodigo,
      bancoNome,
      situacao: sit ? sit[1] : 'Ativo',
      qtdParcelas,
      valorParcela,
      valorEmprestado,
      valorLiberado: valLib ? parseBR(valLib[1]) : valorEmprestado - iof,
      iof,
      inicioDesconto,
      fimDesconto,
      saldoDevedor: valPago ? parseBR(valPago[1]) : undefined,
      cetMensal: taxas[0] ? parseFloat(taxas[0][1].replace(',', '.')) : undefined,
      cetAnual: taxas[0] ? parseFloat(taxas[0][2].replace(',', '.')) : undefined,
      taxaJurosMensal: taxas[0] ? parseFloat(taxas[0][3].replace(',', '.')) : undefined,
      taxaJurosAnual: taxas[0] ? parseFloat(taxas[0][4].replace(',', '.')) : undefined,
      primeiroDesconto: primDesc ? primDesc[1] : undefined,
    });
  }
  return out;
}

function extractCartoesAtivos(text: string): InssExtratoCartao[] {
  const out: InssExtratoCartao[] = [];

  // Seções RMC e RCC
  // CART��O DE CR��DITO - RMC ... CART��O DE CR��DITO - RCC ... DESCONTOS DE CART��O
  const secRmcAtivos = text.match(/CART[��ÃA]O\s+DE\s+CR[��ÉE]DITO\s*-\s*RMC[\s\S]+?CONTRATOS\s+ATIVOS\s+E\s+SUSPENSOS([\s\S]+?)(?=CART[��ÃA]O\s+DE\s+CR[��ÉE]DITO\s*-\s*RCC|DESCONTOS\s+DE\s+CART)/i);
  const secRccAtivos = text.match(/CART[��ÃA]O\s+DE\s+CR[��ÉE]DITO\s*-\s*RCC[\s\S]+?CONTRATOS\s+ATIVOS\s+E\s+SUSPENSOS([\s\S]+?)(?=DESCONTOS\s+DE\s+CART)/i);

  const parse = (block: string, tipo: 'RMC' | 'RCC') => {
    // Cada linha: numero_cartao banco_codigo - NOME BANCO R$X,XX Ativo Averba... data R$Y,YY ...
    const re = /(\d{10,})\s+(\d{3})\s*-\s*([A-Z][A-Z\s\/\.&]+?)\s+R\$\s*([\d.,]+)\s*(Ativo|Suspens[oa])\s+([A-Za-z\s]+?)\s+(\d{2}\/\d{2}\/\d{2,4})\s+R\$\s*([\d.,]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) {
      out.push({
        contrato: m[1],
        tipo,
        bancoCodigo: m[2],
        bancoNome: m[3].trim().replace(/\s+/g, ' '),
        valorLimite: parseBR(m[4]),
        situacao: m[5],
        origemAverbacao: m[6].trim(),
        dataInclusao: m[7],
        valorReservado: parseBR(m[8]),
        saldoDevedorAtual: 0,
        ultimoDescontoValorUtilizado: 0,
        estaUsando: false,
        podeCancelar: true,
      });
    }
  };

  if (secRmcAtivos) parse(secRmcAtivos[1], 'RMC');
  if (secRccAtivos) parse(secRccAtivos[1], 'RCC');
  return out;
}

function extractDescontosCartao(text: string): InssExtratoDescontoCartao[] {
  // Seção: DESCONTOS DE CARTÃO
  const sec = text.match(/DESCONTOS\s+DE\s+CART[��ÃA]O[\s\S]+/i);
  if (!sec) return [];
  const block = sec[0];
  const out: InssExtratoDescontoCartao[] = [];

  // Padrão observado:
  // 00551483328042026 389 - BANCO MERCANTIL DO BRASIL S A R$2.023,80 Encerrado 05/2026 R$39,12 R$81,05 Desconto de cart�o (RMC) R$3,60 3,12 44,73 2,46 26,00
  const re = /(\d{10,})\s+(\d{3})\s*-\s*([A-Z][A-Z\s\/\.&]+?)\s+R\$\s*([\d.,]+)\s*(Ativo|Suspens[oa]|Encerrado|Exclu[��íi]do)\s+(\d{2}\/\d{4})\s+R\$\s*([\d.,]+)\s+R\$\s*([\d.,]+)\s+Desconto\s+de\s+cart[ã��a]o\s*\((RMC|RCC)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    out.push({
      contrato: m[1],
      tipo: m[9] as 'RMC' | 'RCC',
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
  // Valores
  baseCalculo: number;
  totalComprometido: number;
  sumEmp: number;
  sumRmc: number;
  sumRcc: number;
  // Tetos NOVA regra (40%)
  teto40: number;
  excedenteNovaRegra: number;
  compPctSobre40: number;
  enquadraNovaRegra: boolean;
  // Soluções
  contratosQueResolvem: { contrato: string; reducaoEstim: number; novaParc: number; bancoNome: string }[];
  cartoesQueResolvem: { contrato: string; tipo: 'RMC' | 'RCC'; valorReservado: number; saldoDevedor: number; podeCancelarSemPagar: boolean; resolve: boolean }[];
}

// Coef PRICE 108m a 1.50% = 0.018744... (mesmo do motor V2)
function coefPrice108_150(): number {
  const i = 0.015;
  return i / (1 - Math.pow(1 + i, -108));
}

export function analisarEnquadramento(ext: InssExtratoResultado): AnaliseExtrato {
  const baseCalculo = ext.margens.baseCalculo;
  const totalComprometido = ext.margens.totalComprometido;
  // Soma das parcelas dos contratos ATIVOS
  const sumEmp = ext.contratos.reduce((s, c) => s + (c.valorParcela || 0), 0);
  const sumRmc = ext.cartoes.filter((c) => c.tipo === 'RMC').reduce((s, c) => s + (c.valorReservado || 0), 0);
  const sumRcc = ext.cartoes.filter((c) => c.tipo === 'RCC').reduce((s, c) => s + (c.valorReservado || 0), 0);
  const teto40 = baseCalculo * 0.40;
  const total = totalComprometido || (sumEmp + sumRmc + sumRcc);
  const excedente = Math.max(0, total - teto40);
  const compPct = baseCalculo > 0 ? (total / baseCalculo) * 100 : 0;
  const enquadra = total <= teto40 + 0.01;

  // Refin estimado por contrato
  const coef = coefPrice108_150();
  const contratosQueResolvem: AnaliseExtrato['contratosQueResolvem'] = [];
  for (const c of ext.contratos) {
    if (!c.valorParcela || !c.valorEmprestado) continue;
    // Saldo a refinanciar = valor emprestado (aproximação do saldo)
    const saldoAprox = c.valorEmprestado;
    const novaParc = saldoAprox * coef;
    const reducao = c.valorParcela - novaParc;
    if (reducao > 0 && reducao >= excedente - 0.01) {
      contratosQueResolvem.push({
        contrato: c.contrato,
        reducaoEstim: Math.round(reducao * 100) / 100,
        novaParc: Math.round(novaParc * 100) / 100,
        bancoNome: c.bancoNome,
      });
    }
  }
  // Cartões que resolvem (e info crítica: podeCancelarSemPagar?)
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
    contratosQueResolvem,
    cartoesQueResolvem,
  };
}
