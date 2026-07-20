// ──────────────────────────────────────────────────────────────────
// INSS Motor — port direto do index.html V1 (linhas ~929-1254)
// Regras de portabilidade INSS: bancos destino (QUALI/BRB/ICRED), taxas,
// troco mínimo, bloqueios por origem, regras por idade/invalidez.
// 100% client-side — nenhuma chamada de API.
// ──────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────
// CONSTANTES — Coeficientes PRICE
// ──────────────────────────────────────────────────────────────────

export interface CoefEntry { t: number; c: number }

// REFIN 96 meses. Teto INSS = 1.85%.
export const COEFS: CoefEntry[] = [
  { t: 1.85, c: 0.02299 }, { t: 1.83, c: 0.02360 }, { t: 1.80, c: 0.02451 },
  { t: 1.78, c: 0.02250 }, { t: 1.75, c: 0.021985 }, { t: 1.72, c: 0.02175 },
  { t: 1.70, c: 0.021604 }, { t: 1.68, c: 0.02145 }, { t: 1.66, c: 0.02130 },
  { t: 1.65, c: 0.02123 }, { t: 1.60, c: 0.02046 }, { t: 1.55, c: 0.02009 },
  { t: 1.50, c: 0.01973 },
];

// 108 meses (nova regra futura). PRICE: c = i/(1-(1+i)^-n).
export const COEFS_108: CoefEntry[] = [
  { t: 1.85, c: 0.02153 }, { t: 1.80, c: 0.02112 }, { t: 1.75, c: 0.02071 },
  { t: 1.70, c: 0.02031 }, { t: 1.66, c: 0.02000 }, { t: 1.65, c: 0.01992 },
  { t: 1.60, c: 0.01952 }, { t: 1.55, c: 0.01913 }, { t: 1.50, c: 0.01874 },
];

// Daycoval REFIN PORT INSS — 11 tabelas oficiais 805990-806002 (96m)
export const COEFS_DAY: CoefEntry[] = [
  { t: 1.85, c: 0.02283 }, { t: 1.80, c: 0.02243 }, { t: 1.77, c: 0.02219 },
  { t: 1.74, c: 0.02195 }, { t: 1.71, c: 0.02171 }, { t: 1.68, c: 0.02147 },
  { t: 1.66, c: 0.02132 }, { t: 1.62, c: 0.02101 }, { t: 1.60, c: 0.02085 },
  { t: 1.58, c: 0.02069 }, { t: 1.56, c: 0.02054 },
];

// ──────────────────────────────────────────────────────────────────
// REGRAS DE BANCO DESTINO (BD)
// ──────────────────────────────────────────────────────────────────

export interface VcMaxByAge { ageMax: number; vcMax: number }
export interface InvRules { minAge?: number; dibAgeRange?: [number, number]; dibMinYears?: number }

export interface BancoRegra {
  sMin: number;
  vcMax?: number;
  tMin: number;
  tMinPct?: number;
  pMin: number;
  pgMin: number;
  faixa: [number, number] | null;
  coefF: number | null;
  coefs?: CoefEntry[];
  block: string[];
  blockInv?: boolean;
  espBlock?: number[];
  pgMinMap?: Record<string, number>;
  /** Taxa mínima da ORIGEM por banco origem (cd → taxa%). Sobrescreve o default. */
  taxaOrigemMin?: Record<string, number>;
  /** Taxa mínima GLOBAL da origem aceita pelo destino (em %). 0 = qualquer taxa. */
  taxaOrigemMinDefault?: number;
  priorityFor?: string[];
  priorityRate?: number;
  contractPrefixBlock?: Record<string, string[]>;
  invRules?: InvRules;
  vcMaxByAge?: VcMaxByAge[];
}

export const BD: Record<string, BancoRegra> = {
  QUALI: {
    sMin: 2000, tMin: 250, pMin: 0, pgMin: 0, faixa: [1.66, 1.85], coefF: null,
    block: ['359','246','025','047','063','320','394','654','212','626','925','935','753','330','012','752','082','079','329','643','243'],
    pgMinMap: { '070': 12, '623': 12 },
    // QUALI voltou a comprar SAFRA (422), FACTA (149) e MERCANTIL (389) —
    // aceita esses 3 SEM restrição de taxa origem. Pros demais, mín 1,10%.
    taxaOrigemMin: { '422': 0, '149': 0, '389': 0 },
    taxaOrigemMinDefault: 1.10,
    invRules: { minAge: 55, dibAgeRange: [55, 57], dibMinYears: 15 },
  },
  FACTA: {
    sMin: 0, tMin: 100, pMin: 50, pgMin: 0, faixa: [1.75, 1.85], coefF: null,
    block: ['071','925','935','149','012','611','643','917'],
    pgMinMap: { '070': 12, '623': 12 },
    invRules: { minAge: 60 },
  },
  C6: {
    sMin: 2000, tMin: 50, pMin: 0, pgMin: 0, faixa: [1.55, 1.85], coefF: null,
    // ─── BLOCK — bancos que C6 NÃO porta (Carol GC C6, atualizado): ───
    //  336/626 = C6 próprio (auto-port bloqueado)
    //  707 = Daycoval
    //  121 = Agibank
    //  012 = Inbursa
    //  422 = Safra
    //  070 = BRB
    //  925 = BRB Cred CFI
    block: ['336','626','707','121','012','422','070','925'],
    // ─── PG MÍN POR ORIGEM ───
    // Tabela EXCLUSIVA (priority): 329 QI TECH / 149 FACTA / 935 FACTA CFI /
    //   643 PINE — ACIMA de 12 pagas
    // 254 PARANÁ BANCO: 13 pagas
    // 623 PAN: 37 pagas
    // Demais bancos CIP: aceita com MENOS de 12 pagas (sem restrição)
    pgMinMap: {
      '329': 12, // QI TECH
      '149': 12, // FACTA
      '935': 12, // FACTA Financeira
      '643': 12, // PINE
      '254': 13, // PARANÁ
      '623': 37, // PAN
    },
    blockInv: true,
    // Taxa mínima Port: 1,35%. Refin obrigatório se origem < 1,75%
    // (nosso motor sempre faz port+refin 108m, então origem ≥ 1,35 entra)
    taxaOrigemMinDefault: 1.35,
    // Tabela EXCLUSIVA pra portar: 329/149/935/643 — taxa priority 1,55%
    priorityFor: ['329','149','935','643'],
    priorityRate: 1.55,
    // QI TECH (329): bloqueia contratos com prefixo FIN, QUA, FDC
    contractPrefixBlock: { '329': ['FIN','QUA','FDC'] },
  },
  BRB: {
    sMin: 3000, tMin: 250, pMin: 0, pgMin: 0, faixa: null, coefF: 0.02299,
    block: ['070','623','935','149','012','071','925','380','079'],
    // BRB aceita port com QUALQUER taxa origem (sem mínimo)
    taxaOrigemMinDefault: 0,
    // ─── PG MÍN POR ORIGEM ───
    // BRB só compra contrato do C6 (336/626) com 12+ parcelas pagas.
    pgMinMap: { '336': 12, '626': 12 },
    invRules: { minAge: 60 },
  },
  // ── BRB INCONTA — banco destino de PORT INSS (regras oficiais 07/05/2026) ──
  // Prazo 108m · Taxa 1,85% (saldo mín R$ 3.000) e 1,79% (saldo mín R$ 4.000).
  // Port até 72 anos, a partir de 12 parcelas pagas, aceita QUALQUER taxa origem.
  // Limite por CPF (≤72 anos): R$ 150.000 → vcMax.
  // Troco mínimo de 1 parcela já é garantido pelo motor (tMinEff inclui a parcela).
  // Benefícios 32/92 (invalidez): só clientes ≥ 60 anos → invRules.minAge 60.
  // NÃO porta: PicPay(380), Bradescard(063), Inbursa(012), PagBank(290),
  //   C6(336/626), Agibank(121). ⚠ Santinvest: código a confirmar (não incluído ainda).
  BRB_INCONTA: {
    sMin: 3000, vcMax: 150000, tMin: 250, pMin: 0, pgMin: 12,
    faixa: [1.79, 1.85], coefF: null, coefs: COEFS_108,
    block: ['380', '063', '012', '290', '336', '626', '121'],
    taxaOrigemMinDefault: 0,
    invRules: { minAge: 60 },
  },
  DIGIO: {
    sMin: 4500, tMin: 250, pMin: 0, pgMin: 12, faixa: [1.50, 1.85], coefF: null,
    block: ['237','001','041','925'],
    pgMinMap: { '070': 12 },
    invRules: { minAge: 60 },
  },
  // ── DAYCOVAL — regras de portabilidade (comunicado jul/2026) ──
  // Porta TODOS os bancos (autorregulação), exceto C6 (336/626), Safra (422)
  // e Alfa (025). Troco mín 2% ou R$100 (o maior). Bancos de rede: mín 6
  // pagas (pgMin global). Acordos por origem no pgMinMap (0 = sem mínimo).
  // Remuneração agência/corban (360 dias) não afeta viabilidade — só comissão.
  DAYCOVAL: {
    sMin: 500, tMin: 100, tMinPct: 0.02, pMin: 20, pgMin: 6, faixa: [1.56, 1.85], coefF: null,
    coefs: COEFS_DAY,
    block: ['336','626','422','025'],
    pgMinMap: {
      '149': 24, '935': 24, // FACTA / FACTA CFI: 24 pagas
      '121': 15,            // Agibank: 15
      '012': 13,            // Inbursa: 13
      '623': 12,            // PAN: 12
      '341': 12,            // Itaú: 12 (acordo — prevalece sobre rede 6)
      '643': 0,             // PINE: sem mínimo
      '070': 0, '925': 0,   // BRB / BRB Cred: sem mínimo
      '329': 0,             // QI Sociedade de Crédito: sem mínimo
    },
    invRules: { minAge: 60 },
  },
  ICRED: {
    sMin: 3000, vcMax: 100000, tMin: 100, pMin: 0, pgMin: 0, faixa: [1.50, 1.85], coefF: null,
    block: ['329','643','935'],
    pgMinMap: { '623': 1, '336': 1 },
    // ICRED aceita port com taxa origem >= 1,10%
    taxaOrigemMinDefault: 1.10,
    vcMaxByAge: [
      { ageMax: 61, vcMax: 100000 }, { ageMax: 62, vcMax: 90000 },
      { ageMax: 63, vcMax: 80000 }, { ageMax: 64, vcMax: 70000 },
      { ageMax: 65, vcMax: 60000 }, { ageMax: 66, vcMax: 50000 },
      { ageMax: 67, vcMax: 40000 }, { ageMax: 68, vcMax: 30000 },
      { ageMax: 120, vcMax: 25000 },
    ],
    invRules: { minAge: 60 },
  },
};

// ORDEM = bancos ATIVOS no motor. FACTA/DIGIO desativados.
// C6 reativado (mar/2026) — aceita correspondentes BMG 318 e BRB 070 com pgMin=12.
// DAYCOVAL reativado (jun/2026) — 11 tabelas oficiais COEFS_DAY, faixa 1.56-1.85.
export const ORDEM = ['QUALI', 'C6', 'BRB', 'BRB_INCONTA', 'ICRED', 'DAYCOVAL'];

export const PICPAY_CODE = '380';
export const B1P: string[] = ['149','422','739','925','380','033','326','290','041','389','121'];
if (!B1P.includes(PICPAY_CODE)) B1P.push(PICPAY_CODE);

export const ESP_INV = [4, 5, 6, 32, 33, 34, 51, 83, 92];
export const ESP_AUX = [31, 36, 91, 94];
export const ESP_LOAS = [87, 88];
export const ESP_AGE_MIN: Record<number, number> = { 21: 45 };
export const CARTAO = { PAN: '623', BMG: '318', Daycoval: '707' };
export const IDADE_MAX = 72;
export const TROCO_MIN_GLOBAL = 250;

// ──────────────────────────────────────────────────────────────────
// PARSERS
// ──────────────────────────────────────────────────────────────────

/** Parser pt-BR universal: aceita number, "6056.96" ou "6.056,96". */
export function parseBR(v: unknown): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v).trim();
  if (!s) return 0;
  if (s.indexOf(',') >= 0) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
  const dots = (s.match(/\./g) || []).length;
  if (dots > 1) return parseFloat(s.replace(/\./g, '')) || 0;
  return parseFloat(s) || 0;
}

/** Parser de valor R$ (heurístico do V1, função pV). */
export function pV(v: unknown): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  let s = String(v).replace(/R\$\s*/g, '').replace(/\s/g, '');
  if (s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
  if (s.includes('.')) return parseFloat(s) || 0;
  const n = parseInt(s, 10);
  if (isNaN(n)) return 0;
  return n > 99 ? n / 100 : n;
}

/** Parser de prazo "rest/tot" — retorna [rest, tot, pag]. */
export function pP(v: unknown): [number, number, number] {
  if (v == null || v === '') return [0, 0, 0];
  const m = String(v).match(/(\d+)\s*[/\\]\s*(\d+)/);
  if (m) { const r = +m[1], t = +m[2]; return [r, t, t - r]; }
  const n = parseInt(String(v), 10);
  return [n || 0, n || 0, 0];
}

/** Parser de código de banco — padroniza pra 3 dígitos com zero à esquerda. */
export function pC(v: unknown): string {
  if (v == null || v === '') return '';
  return String(typeof v === 'number' ? Math.floor(v) : v).trim().padStart(3, '0');
}

/** Parser de espécie INSS — extrai o número do prefixo. */
export function pEN(e: unknown): number {
  if (!e) return 0;
  const s = String(e);
  // Caso 1: começa com dígitos — "87", "87 - BPC...", "41 - Aposent..."
  const m = s.match(/^(\d+)/);
  if (m) return parseInt(m[1], 10);
  // Caso 2: descrição textual do Multicorban (sem código numérico no início)
  //   espécie 87 = "BENEFÍCIO DE PRESTAÇÃO CONTINUADA DA ASSIST. SOCIAL À PESSOA PORTADORA DE DEFICIÊNCIA"
  //   espécie 88 = "BENEFÍCIO DE PRESTAÇÃO CONTINUADA DA ASSIST. SOCIAL AO IDOSO"
  if (/presta.*continuada|bpc\b|loas\b/i.test(s)) {
    return /idoso/i.test(s) ? 88 : 87;
  }
  return 0;
}

/** Calcula idade a partir de data de nascimento. */
export function cAge(ns: unknown): { age: number } | null {
  if (ns == null) return null;
  let d: Date;
  if (ns instanceof Date) d = ns;
  else if (typeof ns === 'number') d = new Date((ns - 25569) * 864e5);
  else {
    const s = String(ns).trim();
    const m = s.match(/(\d{2})[/-](\d{2})[/-](\d{4})/);
    if (m) d = new Date(+m[3], +m[2] - 1, +m[1]);
    else d = new Date(s);
  }
  if (!d || isNaN(d.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) a--;
  return { age: a };
}

/** Anos de benefício (DIB → hoje). */
export function cBY(dib: unknown): number | null {
  if (dib == null) return null;
  let d: Date;
  if (dib instanceof Date) d = dib;
  else if (typeof dib === 'number') d = new Date((dib - 25569) * 864e5);
  else {
    const s = String(dib).trim();
    const m = s.match(/(\d{2})[/-](\d{2})[/-](\d{4})/);
    if (m) d = new Date(+m[3], +m[2] - 1, +m[1]);
    else d = new Date(s);
  }
  if (!d || isNaN(d.getTime())) return null;
  const now = new Date();
  let y = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) y--;
  return y;
}

// ──────────────────────────────────────────────────────────────────
// COEFICIENTES PRICE
// ──────────────────────────────────────────────────────────────────

export function priceCoef(taxaPct: number, n: number): number {
  const i = (taxaPct || 0) / 100;
  if (i <= 0 || n <= 0) return 0;
  return i / (1 - Math.pow(1 + i, -n));
}

export function coefFor(taxaPct: number, n: number): number {
  const tbl = n === 108 ? COEFS_108 : COEFS;
  const exact = tbl.find((c) => Math.abs(c.t - taxaPct) < 0.001);
  if (exact) return exact.c;
  return priceCoef(taxaPct, n);
}

// ──────────────────────────────────────────────────────────────────
// MOTOR DE PORTABILIDADE
// ──────────────────────────────────────────────────────────────────

/** Acha melhor taxa de refin que satisfaz troco mínimo. */
export function bestR(
  p: number, s: number, t: number, fx: [number, number] | null, src?: CoefEntry[],
): { t: number; c: number; vc: number; tr: number } | null {
  const base = src || COEFS;
  const pool = fx ? base.filter((c) => c.t >= fx[0] && c.t <= fx[1]) : base;
  for (const { t: tx, c } of pool) {
    const vc = p / c, tr = vc - s;
    if (tr >= t) return { t: tx, c, vc, tr };
  }
  return null;
}

/** Verifica se banco aceita esse origem considerando TODAS as regras. */
export function bankAccepts(
  b: string, r: BancoRegra, cd: string, con: string, p: number, s: number, pg: number,
  i1: boolean, inv: boolean, age: number | null, bY: number | null, espN: number, taxaOrig: number,
): boolean {
  if (r.block.includes(cd)) return false;
  if (r.espBlock && espN && r.espBlock.includes(espN)) return false;
  if (inv && r.blockInv) return false;
  if (r.contractPrefixBlock && r.contractPrefixBlock[cd] && con) {
    const upC = String(con).toUpperCase();
    if (r.contractPrefixBlock[cd].some((pref) => upC.startsWith(pref))) return false;
  }
  if (r.pMin && p < r.pMin) return false;
  if (r.sMin && s < r.sMin) return false;
  // Pagas mínimas: acordo específico do destino (pgMinMap) PREVALECE sobre a
  // lista B1P (origens que liberam com 1 paga). Sem isso, acordos tipo
  // "Daycoval só porta FACTA com 24 pagas" eram ignorados pra origens em B1P.
  // `!== undefined` permite 0 explícito no map (= sem mínimo, ex: BRB no Daycoval).
  const pgR = (r.pgMinMap && r.pgMinMap[cd] !== undefined)
    ? r.pgMinMap[cd]
    : (i1 ? 1 : r.pgMin);
  if (pgR && pg < pgR) return false;
  // Taxa mínima da origem que o destino aceita:
  //   1. Se há regra específica por origem (taxaOrigemMin[cd]), usa essa
  //   2. Senão, se há taxaOrigemMinDefault, usa essa
  //   3. Senão, sem restrição de taxa origem
  //
  // Casos especiais:
  // - cd='000' (empréstimo novo, sem origem): pula verificação
  // - taxaOrig=0 (taxa desconhecida do extrato): NÃO REJEITA — assume que vale
  //   port. Antes era bloqueado, mas isso filtrava demais clientes válidos
  //   quando o Multicorban/PDF não retornava a taxa.
  if (cd && cd !== '000') {
    let minTx: number | undefined;
    if (r.taxaOrigemMin && r.taxaOrigemMin[cd] !== undefined) {
      minTx = r.taxaOrigemMin[cd];
    } else if (r.taxaOrigemMinDefault !== undefined) {
      minTx = r.taxaOrigemMinDefault;
    }
    if (minTx !== undefined && minTx > 0 && taxaOrig > 0) {
      // Taxa origem precisa ser >= mínima. Se taxaOrig=0 (desconhecida), deixa passar.
      if (taxaOrig < minTx) return false;
    }
  }
  if (age !== null) {
    if (age > IDADE_MAX) return false;
    if (inv && r.invRules) {
      const iv = r.invRules;
      if (iv.minAge && age < iv.minAge) return false;
      if (iv.dibAgeRange && age >= iv.dibAgeRange[0] && age <= iv.dibAgeRange[1] &&
        (bY === null || bY < (iv.dibMinYears || 0))) return false;
    }
  }
  return true;
}

function tMinFloor(b: string): number {
  return b === 'ICRED' ? 100 : TROCO_MIN_GLOBAL;
}

function vcExceedsLimit(r: BancoRegra, vc: number, age: number | null): boolean {
  if (r.vcMax && vc > r.vcMax) return true;
  if (r.vcMaxByAge && Array.isArray(r.vcMaxByAge) && age != null) {
    for (const tier of r.vcMaxByAge) {
      if (age <= tier.ageMax) return vc > tier.vcMax;
    }
  }
  return false;
}

export interface BancoSimul { banco: string; troco: number; vc: number; taxa: number; i1?: boolean; priority?: boolean }

export function tryBank(b: string, r: BancoRegra, p: number, s: number, age: number | null): BancoSimul | null {
  const tMinBanco = r.tMinPct ? Math.max(r.tMin || 0, s * r.tMinPct) : (r.tMin || 0);
  const tMinEff = Math.max(tMinBanco, p, tMinFloor(b));
  if (r.coefF) {
    const vc = p / r.coefF, tr = vc - s;
    if (tr < tMinEff) return null;
    if (vcExceedsLimit(r, vc, age)) return null;
    const tx = COEFS.find((x) => x.c === r.coefF);
    return { banco: b, troco: tr, vc, taxa: tx ? tx.t : 0 };
  }
  const res = bestR(p, s, tMinEff, r.faixa, r.coefs);
  if (res) {
    if (vcExceedsLimit(r, res.vc, age)) return null;
    return { banco: b, troco: res.tr, vc: res.vc, taxa: res.t };
  }
  return null;
}

/** Testa todos os bancos e retorna a MELHOR opção. */
export function testar(
  p: number, s: number, pg: number, cd: string, inv: boolean, age: number | null, bY: number | null,
  rest: number, espN: number, con: string, taxaOrig: number,
): BancoSimul | null {
  const i1 = B1P.includes(cd);
  if (espN && ESP_AGE_MIN[espN] && age !== null && age < ESP_AGE_MIN[espN]) return null;
  if (espN && ESP_LOAS.includes(espN)) return null;
  const c6 = BD.C6;
  if (ORDEM.includes('C6') && c6 && c6.priorityFor && c6.priorityFor.includes(cd) &&
    bankAccepts('C6', c6, cd, con, p, s, pg, i1, inv, age, bY, espN, taxaOrig)) {
    const tx = c6.priorityRate || 1.55;
    const coef = COEFS.find((x) => x.t === tx);
    if (coef) {
      const vc = p / coef.c, tr = vc - s;
      if (tr >= c6.tMin) return { banco: 'C6', troco: tr, vc, taxa: tx, i1 };
    }
  }
  for (const b of ORDEM) {
    const r = BD[b];
    if (!bankAccepts(b, r, cd, con, p, s, pg, i1, inv, age, bY, espN, taxaOrig)) continue;
    const res = tryBank(b, r, p, s, age);
    if (res) { res.i1 = i1; return res; }
  }
  return null;
}

/** Retorna TODAS as opções viáveis (vendedor escolhe). */
export function testarTodos(
  p: number, s: number, pg: number, cd: string, inv: boolean, age: number | null, bY: number | null,
  _rest: number, espN: number, con: string, taxaOrig: number,
): BancoSimul[] {
  const out: BancoSimul[] = [];
  const i1 = B1P.includes(cd);
  if (espN && ESP_AGE_MIN[espN] && age !== null && age < ESP_AGE_MIN[espN]) return out;
  if (espN && ESP_LOAS.includes(espN)) return out;
  const c6 = BD.C6;
  let c6Priority = false;
  if (ORDEM.includes('C6') && c6 && c6.priorityFor && c6.priorityFor.includes(cd) &&
    bankAccepts('C6', c6, cd, con, p, s, pg, i1, inv, age, bY, espN, taxaOrig)) {
    const tx = c6.priorityRate || 1.55;
    const coef = COEFS.find((x) => x.t === tx);
    if (coef) {
      const vc = p / coef.c, tr = vc - s;
      if (tr >= c6.tMin) { out.push({ banco: 'C6', troco: tr, vc, taxa: tx, i1, priority: true }); c6Priority = true; }
    }
  }
  for (const b of ORDEM) {
    if (b === 'C6' && c6Priority) continue;
    const r = BD[b];
    if (!bankAccepts(b, r, cd, con, p, s, pg, i1, inv, age, bY, espN, taxaOrig)) continue;
    const res = tryBank(b, r, p, s, age);
    if (res) { res.i1 = i1; out.push(res); }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────
// ENQUADRAMENTO — Regra HOJE: emp 35% + RMC 5% + RCC 5% = 45%
// ──────────────────────────────────────────────────────────────────

export interface ContratoReducao {
  par: number; sal: number;
  con?: string; contrato?: string;
  cod?: string; banco?: string;
}

export interface ReducaoResult {
  reducao: number; novaParc: number; taxa: number; prazo: number;
  contrato?: string; banco?: string;
}

export function calcReducaoPort(
  contrato: ContratoReducao, prazoMaxNovo = 108,
): ReducaoResult | null {
  if (!contrato || !contrato.par || !contrato.sal) return null;
  const taxaMin = 1.50;
  const coef = coefFor(taxaMin, prazoMaxNovo || 108);
  if (!coef) return null;
  const novaParc = contrato.sal * coef;
  const reducao = (contrato.par || 0) - novaParc;
  if (reducao <= 0) return null;
  return { reducao, novaParc, taxa: taxaMin, prazo: prazoMaxNovo || 108 };
}

/**
 * Calcula a redução de parcela usando um BANCO DESTINO REAL.
 * Usa a faixa de taxa do banco (taxa mínima) e prazo máximo (108m por padrão).
 * Pra port+refin: novaParc = saldo × coef(taxa_min_do_banco, 108m).
 * Só retorna resultado se a redução for positiva — se a taxa atual já é igual
 * ou menor que a do destino, port não vale.
 */
export function calcReducaoNoDestino(
  parcela: number,
  saldo: number,
  destino: BancoSimul,
  taxaOrigemAtual = 0,
  prazoMaxNovo = 108,
): ReducaoResult | null {
  if (!parcela || !saldo || !destino) return null;
  const r = BD[destino.banco];
  if (!r) return null;
  // Pega a taxa MAIS BAIXA da faixa do banco (best case pro cliente)
  // Se banco tem coefF fixo (BRB), usa esse coef direto
  let taxaUsada: number;
  let coef: number;
  if (r.coefF) {
    coef = r.coefF;
    const t = COEFS.find((x) => x.c === r.coefF);
    taxaUsada = t ? t.t : 1.85;
  } else if (r.faixa) {
    taxaUsada = r.faixa[0]; // taxa mínima da faixa
    coef = coefFor(taxaUsada, prazoMaxNovo);
  } else {
    return null;
  }
  // ⚠ Só faz sentido port se taxa atual > taxa destino
  // Se taxa origem é menor que a destino, cliente piora — pula
  if (taxaOrigemAtual > 0 && taxaOrigemAtual <= taxaUsada) return null;
  const novaParc = saldo * coef;
  const reducao = parcela - novaParc;
  if (reducao <= 0) return null;
  return {
    reducao, novaParc,
    taxa: taxaUsada,
    prazo: prazoMaxNovo,
    banco: destino.banco,
  };
}

/**
 * Calcula PORT + REFIN em 108m no banco destino — operação completa.
 * Diferente do `tryBank` (que usa 96m), aqui o prazo é 108m (nova regra).
 *
 * Retorna 2 cenários da MESMA operação:
 *   • REFIN PURO: nova_parcela = saldo × coef_108m (parcela reduz, troco = 0)
 *   • PORT MANTENDO PARCELA: parcela atual, troco = (parcela/coef_108m) - saldo
 *
 * Cliente escolhe na proposta qual fluxo seguir (na port real, o banco
 * acomoda nova_parcela em qualquer ponto entre os 2 cenários, e o troco
 * é proporcional).
 */
/** Cenário (1 taxa) de port+refin 108m num banco destino. */
export interface PortRefin108Cenario {
  taxa: number;
  coef: number;
  // Refin puro (parcela reduz ao máximo, sem troco)
  refin_novaParc: number;
  refin_reducao: number;
  // Port mantendo parcela (troco máximo)
  port_novaParc: number;
  port_vc: number;
  port_troco: number;
}

export interface PortRefin108Result {
  banco: string;
  prazo: number; // sempre 108
  /** Cenário de TABELA ALTA (1.85% = teto INSS) — MAIS comissão pro correspondente,
   *  MAIS troco quando port com parcela mantida, MENOS valor liberado em refin puro. */
  tabelaAlta: PortRefin108Cenario;
  /** Cenário de TABELA BAIXA (taxa mínima do destino) — MENOS comissão,
   *  MENOS troco em port, MAIOR redução em refin (cliente paga menos juros). */
  tabelaBaixa: PortRefin108Cenario;
  /** Compat com chamadas antigas — equivale a tabelaAlta. */
  taxa: number;
  coef: number;
  refin_novaParc: number;
  refin_reducao: number;
  port_novaParc: number;
  port_vc: number;
  port_troco: number;
  /** Banco destino aceita a taxa de origem? */
  taxaOrigVale: boolean;
}

function calcCenario(parcela: number, saldo: number, taxa: number): PortRefin108Cenario {
  const coef = coefFor(taxa, 108);
  const refin_novaParc = saldo * coef;
  const port_vc = parcela / coef;
  return {
    taxa,
    coef,
    refin_novaParc,
    refin_reducao: parcela - refin_novaParc,
    port_novaParc: parcela,
    port_vc,
    port_troco: port_vc - saldo,
  };
}

export function calcPortRefin108(
  parcela: number,
  saldo: number,
  destino: BancoSimul,
  taxaOrigemAtual = 0,
  /** Código do banco origem (3 dígitos). Permite checagem específica via
   *  taxaOrigemMin[cd] sobrescrevendo taxaOrigemMinDefault. */
  codOrigem = '',
): PortRefin108Result | null {
  if (!parcela || !saldo || !destino) return null;
  const r = BD[destino.banco];
  if (!r) return null;

  // Define as 2 taxas relevantes (alta e baixa) por tipo de banco
  let taxaAlta: number;
  let taxaBaixa: number;
  if (r.coefF) {
    // BRB tem coefF único — taxa fixa. Mesma alta e baixa.
    const t = COEFS.find((x) => x.c === r.coefF);
    taxaAlta = t ? t.t : 1.85;
    taxaBaixa = taxaAlta;
  } else if (r.faixa) {
    taxaAlta = r.faixa[1]; // teto da faixa (= 1.85% normalmente)
    taxaBaixa = r.faixa[0]; // piso da faixa
  } else {
    return null;
  }

  // taxaOrigVale: o banco destino aceita a taxa de origem?
  //   - Se há regra específica taxaOrigemMin[cd], usa essa (pode ser 0)
  //   - Senão, usa taxaOrigemMinDefault (regra global do banco)
  //   - Se taxaOrigemAtual=0 (taxa desconhecida) → assume que vale, NÃO bloqueia
  let minOrigem = 0;
  if (codOrigem && r.taxaOrigemMin && r.taxaOrigemMin[codOrigem] !== undefined) {
    minOrigem = r.taxaOrigemMin[codOrigem];
  } else if (r.taxaOrigemMinDefault !== undefined) {
    minOrigem = r.taxaOrigemMinDefault;
  }
  const taxaOrigVale = minOrigem <= 0
    ? true
    : (taxaOrigemAtual <= 0 ? true : taxaOrigemAtual >= minOrigem);

  const tabelaAlta = calcCenario(parcela, saldo, taxaAlta);
  const tabelaBaixa = calcCenario(parcela, saldo, taxaBaixa);

  return {
    banco: destino.banco,
    prazo: 108,
    tabelaAlta,
    tabelaBaixa,
    // Compat — campos legados apontam pra tabelaAlta (que era o esperado pra port com troco)
    taxa: tabelaAlta.taxa,
    coef: tabelaAlta.coef,
    refin_novaParc: tabelaAlta.refin_novaParc,
    refin_reducao: tabelaAlta.refin_reducao,
    port_novaParc: tabelaAlta.port_novaParc,
    port_vc: tabelaAlta.port_vc,
    port_troco: tabelaAlta.port_troco,
    taxaOrigVale,
  };
}

export type EnquadramentoStatus =
  | 'ENQUADRA' | 'ENQUADRA_TROCAR_CARTAO'
  | 'VIA_PORT_REDUCAO' | 'VIA_PORT_MULTI' | 'VIA_CANCELA_CARTAO'
  | 'INVIAVEL';

/** Enquadramento via BRB INCONTA portando ATÉ 3 contratos (regra 07/05/2026). */
export interface ViaBrbInconta {
  /** Contratos que o BRB INCONTA porta pra enquadrar (máx 3, os de maior redução). */
  contratos: ReducaoResult[];
  /** Soma da redução de parcela desses contratos. */
  reducaoTotal: number;
  /** true se a redução cobre o excedente dentro de 3 contratos. */
  enquadra: boolean;
  /** Quanto ainda falta cobrir se nem 3 contratos resolvem (0 se enquadra). */
  excedenteRestante: number;
}

export interface EnquadramentoFull {
  status: EnquadramentoStatus;
  detalhe: string;
  acao: string;
  excedente: number; sumTotal: number;
  tetoEmp35: number; tetoGlobal: number; tetoCartao: number;
  livreEmpAtual: number; livreNovo: number;
  reducaoTotal: number;
  reducaoDetalhes: ReducaoResult[];
  contratoSugerido?: ReducaoResult;
  cartaoSugerido?: { tipo: string; valor: number };
  /** Solução do BRB INCONTA (porta até 3 contratos) — sempre presente quando há excedente. */
  viaBrbInconta?: ViaBrbInconta;
}

/**
 * Redução de parcela de UM contrato se portado pro BRB INCONTA.
 * Usa a tabela TETO 1,85% / 108m (coef 0.02153) — cenário CONSERVADOR:
 * se enquadra a 1,85%, enquadra em qualquer tabela do BRB INCONTA.
 * (BRB INCONTA "reduz parcela no refin de port" — nova parcela = saldo × coef.)
 */
export function calcReducaoBrbInconta(c: ContratoReducao): ReducaoResult | null {
  if (!c || !c.par || !c.sal) return null;
  const coef = coefFor(1.85, 108); // 0.02153
  const novaParc = c.sal * coef;
  const reducao = c.par - novaParc;
  if (reducao <= 0) return null;
  return {
    reducao, novaParc, taxa: 1.85, prazo: 108,
    contrato: c.con || c.contrato, banco: c.cod || c.banco,
  };
}

/**
 * BRB INCONTA enquadra portando ATÉ 3 contratos (os de MAIOR redução).
 * Acumula até cobrir o excedente ou atingir 3 contratos. Redução conservadora
 * (tabela teto 1,85%). Retorna sempre — `enquadra` diz se resolveu em ≤3.
 */
export function calcViaBrbInconta(excedente: number, contratos: ContratoReducao[] = []): ViaBrbInconta {
  const MAX_CTR = 3;
  const reds = (Array.isArray(contratos) ? contratos : [])
    .map(calcReducaoBrbInconta)
    .filter((r): r is ReducaoResult => r != null)
    .sort((a, b) => b.reducao - a.reducao);
  const usados: ReducaoResult[] = [];
  let acc = 0;
  for (const r of reds) {
    if (acc >= excedente - 0.01) break;
    if (usados.length >= MAX_CTR) break;
    usados.push(r);
    acc += r.reducao;
  }
  const enquadra = acc >= excedente - 0.01 && usados.length > 0;
  return {
    contratos: usados,
    reducaoTotal: acc,
    enquadra,
    excedenteRestante: enquadra ? 0 : Math.max(0, excedente - acc),
  };
}

export function calcEnquadramentoPlus(
  beneficio: number, sumEmp: number, sumRmc: number, sumRcc: number,
  contratos: ContratoReducao[] = [],
): EnquadramentoFull {
  const tetoEmp35 = beneficio * 0.35;
  const tetoCartao = beneficio * 0.05;
  const tetoGlobal = beneficio * 0.45; // regra HOJE
  const sumTotal = sumEmp + sumRmc + sumRcc;
  const excedente = Math.max(0, sumTotal - tetoGlobal);
  const margemLivreEmp = Math.max(0, tetoEmp35 - sumEmp);

  const cartoes: { tipo: string; valor: number }[] = [];
  if (sumRmc > 0) cartoes.push({ tipo: 'RMC', valor: sumRmc });
  if (sumRcc > 0) cartoes.push({ tipo: 'RCC', valor: sumRcc });
  cartoes.sort((a, b) => a.valor - b.valor);

  let reducaoTotal = 0;
  const reducaoDetalhes: ReducaoResult[] = [];
  if (Array.isArray(contratos) && contratos.length) {
    for (const c of contratos) {
      const r = calcReducaoPort(c, 108);
      if (r) {
        reducaoTotal += r.reducao;
        reducaoDetalhes.push({ ...r, contrato: c.con || c.contrato, banco: c.cod || c.banco });
      }
    }
    reducaoDetalhes.sort((a, b) => b.reducao - a.reducao);
  }

  // BRB INCONTA — enquadra portando ATÉ 3 contratos (só relevante se há excedente).
  const viaBrbInconta = excedente > 0 ? calcViaBrbInconta(excedente, contratos) : undefined;

  const fmt = (v: number) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (sumTotal <= tetoGlobal && sumEmp <= tetoEmp35 && sumRmc <= tetoCartao && sumRcc <= tetoCartao) {
    const base = {
      excedente: 0, sumTotal, tetoEmp35, tetoGlobal, tetoCartao,
      livreEmpAtual: margemLivreEmp, livreNovo: tetoGlobal - sumTotal,
      reducaoTotal, reducaoDetalhes,
    };
    if (sumRmc > 0 && sumRcc > 0) {
      return { ...base, status: 'ENQUADRA_TROCAR_CARTAO', detalhe: `Cabe em 45%. Cliente tem RMC e RCC.`, acao: 'sem ajuste' };
    }
    return { ...base, status: 'ENQUADRA', detalhe: `Já cabe no enquadramento (≤ 45%).`, acao: 'sem ajuste' };
  }

  // Excedente > 0 — busca solução isolada
  const portSuf = reducaoDetalhes.find((r) => r.reducao >= excedente - 0.01);
  if (portSuf) {
    return {
      status: 'VIA_PORT_REDUCAO',
      detalhe: `Excede ${fmt(excedente)}. Refinanciar contrato ${portSuf.contrato || '?'} (${portSuf.banco || '?'}) reduz parcela em ${fmt(portSuf.reducao)} → enquadra.`,
      acao: 'port/refin 1 contrato',
      excedente, sumTotal, tetoEmp35, tetoGlobal, tetoCartao,
      livreEmpAtual: margemLivreEmp, livreNovo: tetoGlobal - sumTotal,
      reducaoTotal, reducaoDetalhes, contratoSugerido: portSuf, viaBrbInconta,
    };
  }

  const cartaoSuf = cartoes.find((c) => c.valor >= excedente - 0.01);
  if (cartaoSuf) {
    return {
      status: 'VIA_CANCELA_CARTAO',
      detalhe: `Excede ${fmt(excedente)}. Cancelar ${cartaoSuf.tipo} (${fmt(cartaoSuf.valor)}) enquadra.`,
      acao: `cancelar ${cartaoSuf.tipo}`,
      excedente, sumTotal, tetoEmp35, tetoGlobal, tetoCartao,
      livreEmpAtual: margemLivreEmp, livreNovo: tetoGlobal - sumTotal,
      reducaoTotal, reducaoDetalhes, cartaoSugerido: cartaoSuf, viaBrbInconta,
    };
  }

  // Nenhum contrato/cartão isolado resolve. BRB INCONTA porta até 3 contratos.
  if (viaBrbInconta && viaBrbInconta.enquadra) {
    const nCtr = viaBrbInconta.contratos.length;
    const nomes = viaBrbInconta.contratos.map((c) => c.contrato || c.banco || '?').join(' + ');
    return {
      status: 'VIA_PORT_MULTI',
      detalhe: `Excede ${fmt(excedente)}. BRB INCONTA enquadra portando ${nCtr} contrato${nCtr > 1 ? 's' : ''} (${nomes}) — reduz ${fmt(viaBrbInconta.reducaoTotal)} no total.`,
      acao: `BRB INCONTA — portar ${nCtr} contrato${nCtr > 1 ? 's' : ''}`,
      excedente, sumTotal, tetoEmp35, tetoGlobal, tetoCartao,
      livreEmpAtual: margemLivreEmp, livreNovo: tetoGlobal - sumTotal,
      reducaoTotal, reducaoDetalhes, viaBrbInconta,
    };
  }

  const maiorRed = reducaoDetalhes[0];
  const maiorCartao = cartoes[cartoes.length - 1];
  const melhorIsolada = Math.max(maiorRed?.reducao || 0, maiorCartao?.valor || 0);
  const falta = excedente - melhorIsolada;
  return {
    status: 'INVIAVEL',
    detalhe: `Excede ${fmt(excedente)}. Melhor isolada absorve ${fmt(melhorIsolada)} — falta ${fmt(falta)}. Nem o BRB INCONTA (3 contratos) resolve — precisa múltiplas operações.`,
    acao: 'múltiplas operações',
    excedente, sumTotal, tetoEmp35, tetoGlobal, tetoCartao,
    livreEmpAtual: margemLivreEmp, livreNovo: tetoGlobal - sumTotal,
    reducaoTotal, reducaoDetalhes, viaBrbInconta,
  };
}
