// ──────────────────────────────────────────────────────────────────
// INSS Base Parser — port direto de processBase do V1 (linha ~1257)
// Lê uma planilha XLSX → roda motor → gera analise + elegiveis + rmcAll.
// ──────────────────────────────────────────────────────────────────

import {
  ESP_AUX, ESP_INV, ESP_LOAS, B1P,
  pV, pP, pC, pEN, cAge, cBY,
  testarTodos, ORDEM, BD, IDADE_MAX,
  type BancoSimul,
} from '@/lib/inss-motor';
import {
  calcPortRefin108, calcViaBrbInconta,
  type PortRefin108Result, type ContratoReducao,
} from '@/lib/inss-motor';

const TROCO_MIN_ENQUADRADO = 250;

// ──────────────────────────────────────────────────────────────────
// Tipos da base processada
// ──────────────────────────────────────────────────────────────────

export interface ElegivelDestino {
  banco: string;
  troco: number;
  vc: number;
  taxa: number;
}

export type CompStatusBase =
  | 'dentro_regra'
  | 'fora_regra_resolvivel'
  | 'fora_regra_inviavel'
  | 'sem_dados';

export interface ElegivelRow {
  nome: string;
  cpf: string;
  ben: string;
  esp: string;
  con: string;
  cod: string;
  par: number;
  sal: number;
  prazo: string;
  pag: number;
  idade: number | string;
  isInv: boolean;
  is1p: boolean;
  taxaOrig: number;
  valorBeneficio: number;
  dest: string;
  troco: number;       // troco do testarTodos (96m, melhor destino)
  vc: number;
  taxa: number | string;
  ok: boolean;
  destinos: ElegivelDestino[];
  t1: string;
  t2: string;
  t3: string;
  // ── Banco de rede (recebe + concentração de contratos) ──
  bancoPagador?: string;        // código do banco onde recebe o benefício (coluna "Banco")
  bancoRede?: boolean;          // recebe no banco E todos os contratos estão nesse banco
  bancoRedeConhecido?: boolean; // bancoRede E o banco está na lista (001/033/104/341)
  // Enriquecimento de enquadramento (post-process)
  compPct?: number;
  compStatus?: CompStatusBase;
  resolveExc?: boolean;
  elegRealOk?: boolean;
  /** Este contrato faz parte do combo BRB (até 3 contratos) que enquadra o CPF. */
  viaInconta?: boolean;
  /** Quando NENHUM banco aceita este contrato: motivo resumido (export "todos + motivo"). */
  motivoSemDestino?: string;
  reducaoEstim?: number;        // redução parcela (refin 108m no destino real)
  parcelaNovaEstim?: number;
  // ── PORT + REFIN 108m no destino real ──
  portRefin108?: {
    banco: string;
    taxa: number;
    coef: number;
    refin_novaParc: number;
    refin_reducao: number;
    port_troco: number;          // troco mantendo parcela atual em 108m
    port_vc: number;
    tabelaUsada: 'alta' | 'baixa'; // qual tabela do banco foi escolhida
  };
  _semContrato?: boolean;
}

export interface RmcRow {
  nome: string;
  cpf: string;
  ben: string;
  esp: string;
  t1: string; t2: string; t3: string;
  tRmc: string; cRmc: string; vRmc: number;
  tRcc: string; cRcc: string; vRcc: number;
  mrgCart: number; mrgCartNova: number; mrgEmpNova: number;
  temRmc: boolean; temRcc: boolean; temCartao: boolean;
  valorBeneficio: number;
}

export type LoasStatus = 'sem_dados' | 'com_margem' | 'extrapolado_emp' | 'extrapolado_cartoes';

export interface LoasRow {
  nome: string;
  cpf: string;
  ben: string;
  esp: string;
  t1: string; t2: string; t3: string;
  idade: number | string;
  numCartoes: number;
  sumEmp: number;
  beneficio: number;
  tetoEmp: number;
  pctEmp: number;
  margemLivreEmp: number;
  margemLivreCart: number;
  statusLoas: LoasStatus;
  temRmc: boolean;
  temRcc: boolean;
  vRmc: number;
  vRcc: number;
}

export interface MapaBanco {
  banco: string;
  n: number;
  total: number;
  vcTotal: number;
  med: number;
  vcMed: number;
}

export interface CompPorCpf {
  compPct: number;
  compStatus: CompStatusBase;
  excedente: number;
  benef: number;
  teto40: number;       // LEGADO da MP 1355 (caiu em set/2026) — hoje contém o teto global 45%
  teto45: number;       // teto GLOBAL vigente (35% emp + 5% RMC + 5% RCC)
  /** Teto de empréstimo: 35% do benefício SEMPRE (regra vigente pós-MP 1355). */
  tetoEmpReal: number;
  /** Cliente tem RMC ou RCC? */
  temAlgumCartao: boolean;
  sumEmp: number;
  vRmc: number;
  vRcc: number;
  total: number;
  /** Presente quando NENHUM contrato sozinho resolve, mas o BRB INCONTA
   *  enquadra portando até 3 contratos (regra 07/05/2026). */
  viaInconta?: { n: number; reducaoTotal: number; contratos: string[] };
}

export interface BaseProcessada {
  analise: ElegivelRow[];
  elegiveis: ElegivelRow[];
  rmcRcc: RmcRow[];
  mapaArr: MapaBanco[];
  taxaDist: Record<string, number>;
  compByCpf: Record<string, CompPorCpf>;
  loasAll: LoasRow[];
  fname: string;
  loadedAt: number;
}

// ──────────────────────────────────────────────────────────────────
// Helpers de header (V1: findFirst / findAllPos)
// ──────────────────────────────────────────────────────────────────

// Normaliza string pra comparação de headers:
//   1) lowercase
//   2) NFD decomposition: "é" → "e" + combining-accent
//   3) remove combining diacritics (U+0300..U+036F)
//   4) remove qualquer char não-alfanumérico
// Resultado: "Espécie" → "especie", "Benefício" → "beneficio"
const COMBINING = /[̀-ͯ]/g;
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

// Bancos de rede (varejo) conhecidos: BB, Santander, Caixa, Itaú.
export const BANCOS_REDE = ['001', '033', '104', '341'];

// Extrai o código (3 dígitos) do banco pagador a partir da coluna "Banco",
// que pode vir como "001", "1", "001 - Banco do Brasil" ou só o nome.
function bancoPagadorCod(v: unknown): string {
  if (v == null || v === '') return '';
  const s = String(v).trim();
  const m = s.match(/(\d{1,3})/);
  if (m) return m[1].padStart(3, '0');
  const up = s.toUpperCase();
  if (/BRASIL|\bBB\b/.test(up)) return '001';
  if (/SANTANDER/.test(up)) return '033';
  if (/CAIXA|\bCEF\b/.test(up)) return '104';
  if (/ITA[UÚ]/.test(up)) return '341';
  if (/BRADESCO/.test(up)) return '237';
  return '';
}

function findAllPos(H: string[], nm: string): number[] {
  const r: number[] = [];
  const n = normalize(nm);
  for (let i = 0; i < H.length; i++) {
    const h = normalize(String(H[i] || ''));
    if (h === n) r.push(i);
  }
  return r;
}

function findFirst(H: string[], ns: string[]): number {
  for (const nm of ns) {
    const n = normalize(nm);
    for (let i = 0; i < H.length; i++) {
      const h = normalize(String(H[i] || ''));
      if (h === n) return i;
    }
  }
  return -1;
}

// ──────────────────────────────────────────────────────────────────
// Motor principal: matriz → BaseProcessada
// ──────────────────────────────────────────────────────────────────

// Coef PRICE 108 meses @ 1.85% (teto INSS, nova regra) — empréstimo novo
const COEF185 = 0.02153;
const COEF_CART = 0.029214;

export function processBase(data: unknown[][], fname = ''): BaseProcessada | null {
  if (!data || data.length < 2) return null;

  const H = data[0].map((h) => (h ? String(h).trim() : ''));
  const rows = data.slice(1);

  // Posições das colunas (espelho do V1)
  const cNm = findFirst(H, ['Nome']);
  const cCP = findFirst(H, ['CPF']);
  const cBn = findFirst(H, ['Beneficio']);
  const cEs = findFirst(H, ['Especie', 'Espécie', 'Especie do Beneficio', 'Espécie do Benefício', 'Esp']);
  const cNs = findFirst(H, ['Data Nascimento']);
  const cDI = findFirst(H, ['DIB']);
  const cT1 = findFirst(H, ['Telefone1']);
  const cT2 = findFirst(H, ['Telefone2']);
  const cT3 = findFirst(H, ['Telefone3']);
  const cVB = findFirst(H, ['Valor Beneficio', 'Valor Benefício', 'ValorBeneficio', 'Valor do Beneficio', 'Valor do Benefício', 'Renda', 'Salario', 'Salário', 'Valor Renda', 'Vlr Beneficio', 'Vlr Renda']);
  const cMg = findFirst(H, ['Margem']);
  // Banco pagador (onde o cliente recebe o benefício) — coluna "Banco"
  const cBanco = findFirst(H, ['Banco', 'Banco Pagamento', 'Banco Pagador', 'Banco do Beneficio', 'Banco Benefício', 'Banco Recebimento']);

  const allTE = findAllPos(H, 'Tipo Emprestimo');
  const allCon = findAllPos(H, 'Contrato');
  const allCod = findAllPos(H, 'Codigo');
  const allVE = findAllPos(H, 'Valor Emprestimo');
  const allMC = findAllPos(H, 'Margem Cartao');
  const allVP = findAllPos(H, 'Valor Parcela');
  const allPr = findAllPos(H, 'Prazo');
  const allSQ = findAllPos(H, 'Saldo Quitacao');
  const allTx = findAllPos(H, 'Taxa');

  // Identifica blocos de cartão (RMC/RCC) — agrupa Tipo Emprestimo + Margem Cartao próximos
  const cardBlocks: { te: number; mc: number }[] = [];
  for (const te of allTE) {
    const mc = allMC.find((m) => m > te && m < te + 8);
    if (mc !== undefined) cardBlocks.push({ te, mc });
  }
  type CardB = { tipo: number; con?: number; cod?: number; val?: number; mc: number };
  let rmcB: CardB | null = null;
  let rccB: CardB | null = null;
  if (cardBlocks.length >= 1) {
    const { te, mc } = cardBlocks[0];
    rmcB = { tipo: te, con: allCon.find((c) => c > te && c < te + 8), cod: allCod.find((c) => c > te && c < te + 8), val: allVE.find((v) => v > te && v < te + 8), mc };
  }
  if (cardBlocks.length >= 2) {
    const { te, mc } = cardBlocks[1];
    rccB = { tipo: te, con: allCon.find((c) => c > te && c < te + 8), cod: allCod.find((c) => c > te && c < te + 8), val: allVE.find((v) => v > te && v < te + 8), mc };
  }

  // Linhas de contrato — agrupa Contrato + Codigo + Parcela + Prazo + Saldo + Taxa próximos
  const lbs: { cc: number; ck?: number; cp: number; cz?: number; cs?: number; ctx?: number }[] = [];
  for (const vp of allVP) {
    const con = [...allCon].filter((c) => c < vp).pop();
    const cod = allCod.find((c) => c > (con! - 1) && c < vp);
    const prz = allPr.find((p) => p > vp && p < vp + 4);
    const sq = allSQ.find((s) => s > vp && s < vp + 5);
    const tx = allTx.find((t) => t > (con! - 1) && t < vp + 8);
    if (con !== undefined) lbs.push({ cc: con, ck: cod, cp: vp, cz: prz, cs: sq, ctx: tx });
  }

  const cMDE = findFirst(H, ['Margem Disponivel Emprestimo', 'MargemDisponivelEmprestimo', 'Margem Emprestimo']);
  const cMDR = findFirst(H, ['Margem Disponivel Rcc', 'MargemDisponivelRcc', 'Margem Rcc', 'Margem Disponivel Cartao']);

  const analise: ElegivelRow[] = [];
  const elegiveis: ElegivelRow[] = [];
  const rmcAll: RmcRow[] = [];
  const loasAll: LoasRow[] = [];

  const g = (r: unknown[], c: number) => (c != null && c >= 0 && r[c] != null ? String(r[c]).trim() : '');
  const gv = (r: unknown[], c: number) => (c != null && c >= 0 ? pV(r[c]) : 0);
  const gr = (r: unknown[], c: number) => (c != null && c >= 0 ? r[c] : null);

  for (const row of rows) {
    const nome = g(row, cNm), cpf = g(row, cCP);
    if (!nome && !cpf) continue;
    const ben = g(row, cBn), esp = g(row, cEs);
    const t1 = g(row, cT1), t2 = g(row, cT2), t3 = g(row, cT3);
    const valorBeneficio = cVB >= 0 ? gv(row, cVB) : 0;
    const eN = pEN(esp);
    const isInv = ESP_INV.includes(eN);
    const isLoas = ESP_LOAS.includes(eN);
    const isAux = ESP_AUX.includes(eN) || String(esp).toUpperCase().includes('AUXIL');
    const ai = cAge(gr(row, cNs));
    const idade: number | null = ai ? ai.age : null;
    const bY = cBY(gr(row, cDI));
    if (isAux) continue;

    const tRmc = rmcB ? g(row, rmcB.tipo) : '';
    const cRmc = rmcB ? pC(gr(row, rmcB.cod!) ?? '') : '';
    const vRmc = rmcB ? gv(row, rmcB.val!) : 0;
    const tRcc = rccB ? g(row, rccB.tipo) : '';
    const cRcc = rccB ? pC(gr(row, rccB.cod!) ?? '') : '';
    const vRcc = rccB ? gv(row, rccB.val!) : 0;

    const margemBase = cMg >= 0 ? gv(row, cMg) : 0;
    const mRmc = rmcB && rmcB.mc != null ? gv(row, rmcB.mc) : 0;
    const mRcc = rccB && rccB.mc != null ? gv(row, rccB.mc) : 0;
    const mDE = cMDE >= 0 ? gv(row, cMDE) : 0;
    const mDR = cMDR >= 0 ? gv(row, cMDR) : 0;
    const margem = margemBase > 0 ? margemBase : Math.max(mRmc, mRcc, mDE, mDR);

    const realRmc = !!(cRmc && cRmc !== '000' && (vRmc > 0 || tRmc.toUpperCase().includes('RMC')));
    const realRcc = !!(cRcc && cRcc !== '000' && (vRcc > 0 || tRcc.toUpperCase().includes('RCC')));
    const temCartao = realRmc || realRcc;

    let margemCartNova = 0, margemEmpNova = 0;
    if (margem > 0 && !temCartao) {
      margemEmpNova = Math.round((margem / COEF185) * 100) / 100;
      margemCartNova = Math.round((margem / COEF_CART) * 100) / 100;
    }
    if (temCartao || margem > 0) {
      rmcAll.push({
        nome, cpf, ben, esp, t1, t2, t3,
        tRmc, cRmc: realRmc ? cRmc : '', vRmc: Math.round(vRmc * 100) / 100,
        tRcc, cRcc: realRcc ? cRcc : '', vRcc: Math.round(vRcc * 100) / 100,
        mrgCart: Math.round(margem * 100) / 100,
        mrgCartNova: margemCartNova, mrgEmpNova: margemEmpNova,
        temRmc: realRmc, temRcc: realRcc, temCartao,
        valorBeneficio: Math.round(valorBeneficio * 100) / 100,
      });
    }

    // ── LOAS/BPC (espécies 87/88) — só contrato novo, sem portabilidade ──
    // 35% empréstimo puro (sem teto separado de cartão). Cartão averbado é
    // flag, não tem 5% próprio.
    if (isLoas) {
      let sumEmpLoas = 0;
      for (const lb of lbs) { const par = gv(row, lb.cp); if (par > 0) sumEmpLoas += par; }
      const numCartoes = (realRmc ? 1 : 0) + (realRcc ? 1 : 0);
      // LOAS/BPC: teto de empréstimo é 30% (não 35%).
      const benefLoas = valorBeneficio || (sumEmpLoas > 0 ? sumEmpLoas / 0.30 : 0);
      const tetoEmpLoas = benefLoas * 0.30;
      const margemLivreEmp = benefLoas > 0 ? Math.max(0, tetoEmpLoas - sumEmpLoas) : 0;
      const margemLivreCart = 0; // sem teto separado de cartão em LOAS
      const pctEmp = benefLoas > 0 ? Math.round(sumEmpLoas / benefLoas * 1000) / 10 : 0;
      const statusLoas: LoasStatus = !benefLoas
        ? 'sem_dados'
        : numCartoes >= 2
          ? 'extrapolado_cartoes'
          : sumEmpLoas >= tetoEmpLoas - 0.01
            ? 'extrapolado_emp'
            : 'com_margem';
      loasAll.push({
        nome, cpf, ben, esp, t1, t2, t3,
        idade: idade ?? '-',
        numCartoes,
        sumEmp: Math.round(sumEmpLoas * 100) / 100,
        beneficio: Math.round(benefLoas * 100) / 100,
        tetoEmp: Math.round(tetoEmpLoas * 100) / 100,
        pctEmp,
        margemLivreEmp: Math.round(margemLivreEmp * 100) / 100,
        margemLivreCart: Math.round(margemLivreCart * 100) / 100,
        statusLoas,
        temRmc: !!realRmc, temRcc: !!realRcc,
        vRmc: Math.round(vRmc * 100) / 100,
        vRcc: Math.round(vRcc * 100) / 100,
      });
      continue; // LOAS não porta — pula loop de contratos
    }

    const bancoPag = bancoPagadorCod(gr(row, cBanco));
    const rowRegs: ElegivelRow[] = [];
    for (const lb of lbs) {
      const con = g(row, lb.cc);
      const par = gv(row, lb.cp);
      const sal = lb.cs != null ? gv(row, lb.cs) : 0;
      const [rest, tot, pag] = lb.cz != null ? pP(row[lb.cz]) : [0, 0, 0];
      const cod = lb.ck != null ? pC(gr(row, lb.ck) ?? '') : '';
      let txOrig = 0;
      if (lb.ctx != null) {
        const v = gr(row, lb.ctx);
        if (v != null && v !== '') {
          txOrig = parseFloat(String(v).replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
        }
      }
      if (!con && par === 0 && sal === 0) continue;
      const i1 = B1P.includes(cod);
      const todosDest: BancoSimul[] = testarTodos(par, sal, pag, cod, isInv, idade, bY, rest, eN, con, txOrig);
      // Ordena pela PRIORIDADE COMERCIAL (ORDEM) — primeiro que aceita ganha
      todosDest.sort((a, b) => ORDEM.indexOf(a.banco) - ORDEM.indexOf(b.banco));
      const res = todosDest.length ? todosDest[0] : null;
      const motivoSemDest = res ? undefined : motivoSemDestino(par, sal, pag, cod, idade, isInv, eN, txOrig, i1);
      const reg: ElegivelRow = {
        nome, cpf, ben, esp, con, cod,
        par: Math.round(par * 100) / 100,
        sal: Math.round(sal * 100) / 100,
        prazo: `${rest}/${tot}`,
        pag, idade: idade ?? '-', isInv, is1p: i1, taxaOrig: txOrig,
        valorBeneficio: Math.round(valorBeneficio * 100) / 100,
        dest: res ? res.banco : '-',
        troco: res ? Math.round(res.troco * 100) / 100 : 0,
        vc: res ? Math.round(res.vc * 100) / 100 : 0,
        taxa: res ? res.taxa : '-',
        ok: !!res,
        motivoSemDestino: motivoSemDest,
        destinos: todosDest.map((d) => ({
          banco: d.banco,
          troco: Math.round(d.troco * 100) / 100,
          vc: Math.round(d.vc * 100) / 100,
          taxa: d.taxa,
        })),
        t1, t2, t3,
      };
      rowRegs.push(reg);
    }
    // ── Banco de rede ── recebe no banco (coluna "Banco") que concentra TODOS
    // os contratos. bancoRedeConhecido = esse banco está na lista 001/033/104/341.
    const codsCtr = rowRegs.map((r) => r.cod).filter(Boolean);
    const bancoRede = !!bancoPag && codsCtr.length > 0 && codsCtr.every((c) => c === bancoPag);
    const bancoRedeConhecido = bancoRede && BANCOS_REDE.includes(bancoPag);
    for (const reg of rowRegs) {
      reg.bancoPagador = bancoPag || undefined;
      reg.bancoRede = bancoRede;
      reg.bancoRedeConhecido = bancoRedeConhecido;
      analise.push(reg);
      if (reg.ok) elegiveis.push(reg);
    }
  }

  // Agrupamento por banco destino
  const mapa: Record<string, MapaBanco> = {};
  for (const e of elegiveis) {
    if (!mapa[e.dest]) mapa[e.dest] = { banco: e.dest, n: 0, total: 0, vcTotal: 0, med: 0, vcMed: 0 };
    mapa[e.dest].n++;
    mapa[e.dest].total += e.troco;
    mapa[e.dest].vcTotal += e.vc;
  }
  const mapaArr = ORDEM.map((b) => mapa[b] || { banco: b, n: 0, total: 0, vcTotal: 0, med: 0, vcMed: 0 })
    .filter((m) => m.n > 0)
    .map((m) => ({ ...m, med: m.n ? m.total / m.n : 0, vcMed: m.n ? m.vcTotal / m.n : 0 }));

  const taxaDist: Record<string, number> = {};
  for (const e of elegiveis) {
    for (const d of e.destinos || []) {
      const k = String(d.taxa);
      taxaDist[k] = (taxaDist[k] || 0) + 1;
    }
  }

  // ── Enriquecimento de enquadramento ──
  const rmcByCpf: Record<string, RmcRow> = {};
  for (const r of rmcAll) rmcByCpf[r.cpf] = r;
  const sumEmpByCpf: Record<string, number> = {};
  for (const a of analise) sumEmpByCpf[a.cpf] = (sumEmpByCpf[a.cpf] || 0) + (a.par || 0);

  const compByCpf: Record<string, CompPorCpf> = {};
  for (const cpf of new Set(analise.map((x) => x.cpf))) {
    const x = rmcByCpf[cpf];
    const sumEmp = sumEmpByCpf[cpf] || 0;
    const vRmc = x?.vRmc || 0;
    const vRcc = x?.vRcc || 0;
    // Regra VIGENTE (pós-queda da MP 1355, 02/09/2026): emp ≤ 35% SEMPRE
    // + 5% RMC + 5% RCC = teto global 45%. O "40% sem cartão" caiu com a MP.
    const temAlgumCartao = !!(x?.temRmc || x?.temRcc);
    const benef = x?.valorBeneficio || (sumEmp > 0 ? sumEmp / 0.35 : 0);
    if (!benef) {
      compByCpf[cpf] = {
        compPct: 0, compStatus: 'sem_dados', excedente: 0, benef: 0,
        teto40: 0, teto45: 0, tetoEmpReal: 0, temAlgumCartao,
        sumEmp, vRmc, vRcc, total: sumEmp + vRmc + vRcc,
      };
      continue;
    }
    const total = sumEmp + vRmc + vRcc;
    const pct = (total / benef) * 100;
    const teto45 = benef * 0.45;  // teto GLOBAL (35 emp + 5 RMC + 5 RCC)
    const teto40 = teto45;        // campo LEGADO da época da MP — agora = global 45%
    // Teto EMP: 35% SEMPRE (regra vigente)
    const tetoEmpReal = benef * 0.35;
    // Excedente a cobrir reduzindo parcela de emp: estouro do global OU do emp
    // (virada da MP: quem usou os 40% fica negativo nos 35%).
    const excedente = Math.max(0, total - teto45, sumEmp - tetoEmpReal);
    const enquadra = total <= teto45 + 0.01 && sumEmp <= tetoEmpReal + 0.01;
    compByCpf[cpf] = {
      compPct: pct,
      compStatus: enquadra ? 'dentro_regra' : 'sem_dados', // refinado abaixo
      excedente,
      benef, teto40, teto45, tetoEmpReal, temAlgumCartao,
      sumEmp, vRmc, vRcc, total,
    };
  }

  // Marca cada reg com compStatus/elegRealOk/reducaoEstim/parcelaNovaEstim
  //
  // Estratégia de escolha de tabela (mesma da consulta unitária):
  //   - Cliente ENQUADRADO (regra vigente 35+5+5=45%): prioriza tabelaAlta (1.85%
  //     = mais comissão pro correspondente) SE troco_alta >= R$250.
  //     Senão, fallback tabelaBaixa pra garantir troco aceitável.
  //   - Cliente NÃO ENQUADRADO: usa tabelaBaixa (max redução pra enquadrar).
  //
  // Roda calcPortRefin108 nos destinos (já em ORDEM de prioridade comercial)
  // e fica com o PRIMEIRO que gera cenário válido — não o de maior troco.
  for (const reg of analise) {
    const c = compByCpf[reg.cpf];
    if (!c) {
      reg.compPct = 0; reg.compStatus = 'sem_dados'; reg.resolveExc = false;
      reg.elegRealOk = false; reg.reducaoEstim = 0; reg.parcelaNovaEstim = 0;
      continue;
    }
    reg.compPct = Math.round(c.compPct * 10) / 10;

    const enquadrado = c.compStatus === 'dentro_regra';
    let melhor: { pr108: PortRefin108Result; tabelaUsada: 'alta' | 'baixa'; troco: number; reducao: number } | null = null;

    if (reg.ok && reg.sal > 0 && reg.par > 0 && reg.destinos && reg.destinos.length > 0) {
      // Reconstrói candidatos BancoSimul a partir dos destinos
      for (const d of reg.destinos) {
        const bSim: BancoSimul = { banco: d.banco, troco: d.troco, vc: d.vc, taxa: typeof d.taxa === 'number' ? d.taxa : parseFloat(String(d.taxa)) || 0 };
        const r = calcPortRefin108(reg.par, reg.sal, bSim, reg.taxaOrig, reg.cod);
        if (!r || !r.taxaOrigVale) continue;

        // Calcula valores do cenário escolhido (mesma lógica da consulta unitária)
        let refin_novaParc: number;
        let refin_reducao: number;
        let port_novaParc: number;
        let port_vc: number;
        let port_troco: number;
        let taxaUsada: number;
        let coefUsado: number;
        let tabelaUsada: 'alta' | 'baixa';

        if (enquadrado) {
          // Cliente JÁ ENQUADRA: tabelaAlta (mais comissão) se troco>=250, senão baixa
          const cenarioEsc = r.tabelaAlta.port_troco >= TROCO_MIN_ENQUADRADO
            ? r.tabelaAlta
            : r.tabelaBaixa;
          tabelaUsada = cenarioEsc === r.tabelaAlta ? 'alta' : 'baixa';
          taxaUsada = cenarioEsc.taxa;
          coefUsado = cenarioEsc.coef;
          refin_novaParc = cenarioEsc.refin_novaParc;
          refin_reducao = cenarioEsc.refin_reducao;
          port_novaParc = cenarioEsc.port_novaParc;
          port_vc = cenarioEsc.port_vc;
          port_troco = cenarioEsc.port_troco;
        } else {
          // FORA DA REGRA: reduz EXATAMENTE o excedente, troco = sobra do VC
          const cenarioBase = r.tabelaBaixa;
          tabelaUsada = 'baixa';
          taxaUsada = cenarioBase.taxa;
          coefUsado = cenarioBase.coef;
          const exced = c.excedente;
          const novaParcAlvo = Math.max(0, reg.par - exced);
          const vcAlvo = coefUsado > 0 ? novaParcAlvo / coefUsado : 0;
          if (vcAlvo >= reg.sal) {
            // Viável: reduz exato e gera troco
            refin_novaParc = novaParcAlvo;
            refin_reducao = reg.par - novaParcAlvo;
            port_novaParc = novaParcAlvo;
            port_vc = vcAlvo;
            port_troco = vcAlvo - reg.sal;
          } else {
            // VC < saldo: cai pra refin puro (max redução, sem troco)
            refin_novaParc = cenarioBase.refin_novaParc;
            refin_reducao = cenarioBase.refin_reducao;
            port_novaParc = cenarioBase.refin_novaParc;
            port_vc = reg.sal;
            port_troco = 0;
          }
        }

        const trocoEf = port_troco;
        const reducaoEf = refin_reducao;
        // Critério de "melhor": enquadrado por troco desc, não-enquadrado por redução desc
        const candScore = enquadrado ? trocoEf : reducaoEf;
        const melhorScore = melhor ? (enquadrado ? melhor.troco : melhor.reducao) : -Infinity;

        // Prioridade comercial: destinos já vêm em ORDEM, o primeiro válido fica.
        void candScore; void melhorScore;
        if (!melhor) {
          melhor = {
            pr108: {
              ...r,
              taxa: taxaUsada,
              coef: coefUsado,
              refin_novaParc,
              refin_reducao,
              port_novaParc,
              port_vc,
              port_troco,
            },
            tabelaUsada,
            troco: trocoEf,
            reducao: reducaoEf,
          };
        }
      }
    }

    const reduz = melhor ? Math.max(0, melhor.reducao) : 0;
    reg.reducaoEstim = Math.round(reduz * 100) / 100;
    reg.parcelaNovaEstim = reduz > 0 ? Math.round((reg.par - reduz) * 100) / 100 : 0;
    if (melhor) {
      reg.portRefin108 = {
        banco: melhor.pr108.banco,
        taxa: Math.round(melhor.pr108.taxa * 100) / 100,
        coef: melhor.pr108.coef,
        refin_novaParc: Math.round(melhor.pr108.refin_novaParc * 100) / 100,
        refin_reducao: Math.round(melhor.pr108.refin_reducao * 100) / 100,
        port_troco: Math.round(melhor.pr108.port_troco * 100) / 100,
        port_vc: Math.round(melhor.pr108.port_vc * 100) / 100,
        tabelaUsada: melhor.tabelaUsada,
      };
    }

    if (enquadrado) {
      reg.compStatus = 'dentro_regra';
      reg.resolveExc = false;
      reg.elegRealOk = true;
    } else if (c.excedente > 0) {
      reg.resolveExc = reg.ok && reduz >= c.excedente - 0.01;
      reg.compStatus = reg.resolveExc ? 'fora_regra_resolvivel' : 'fora_regra_inviavel';
      reg.elegRealOk = reg.resolveExc;
    } else {
      reg.compStatus = 'sem_dados';
      reg.resolveExc = false;
      reg.elegRealOk = !!reg.ok;
    }
  }

  // Promove compStatus do CPF baseado nos contratos (algum resolve?)
  for (const cpf of Object.keys(compByCpf)) {
    const c = compByCpf[cpf];
    if (c.excedente <= 0) continue;
    const regsCpf = analise.filter((a) => a.cpf === cpf);
    let algumResolve = regsCpf.some((a) => a.resolveExc);

    // Nenhum contrato sozinho cobre o excedente → BRB INCONTA porta ATÉ 3
    // contratos (os de maior redução, só os que o INCONTA aceita como
    // destino). Mesma lógica de calcEnquadramentoPlus/VIA_PORT_MULTI da
    // consulta unitária — antes o lote marcava esses CPFs como inviáveis.
    if (!algumResolve) {
      const aceitos = regsCpf.filter((a) =>
        a.ok && a.par > 0 && a.sal > 0 && (a.destinos || []).some((d) => d.banco === 'BRB'));
      const ctrs: ContratoReducao[] = aceitos.map((a) => ({ par: a.par, sal: a.sal, con: a.con, cod: a.cod }));
      const via = calcViaBrbInconta(c.excedente, ctrs);
      if (via.enquadra) {
        algumResolve = true;
        const usados = new Set(via.contratos.map((v) => v.contrato));
        c.viaInconta = {
          n: via.contratos.length,
          reducaoTotal: Math.round(via.reducaoTotal * 100) / 100,
          contratos: via.contratos.map((v) => v.contrato || '?'),
        };
        for (const a of aceitos) {
          if (usados.has(a.con)) { a.viaInconta = true; a.resolveExc = true; a.elegRealOk = true; }
        }
      }
    }

    c.compStatus = algumResolve ? 'fora_regra_resolvivel' : 'fora_regra_inviavel';
    // Propaga pro contrato: sem isso o rótulo "outro resolve" nunca aparecia.
    for (const a of regsCpf) a.compStatus = c.compStatus;
  }

  // Sintéticos pra clientes "dentro_regra" sem nenhum contrato portável
  const elegCpfs = new Set(elegiveis.map((e) => e.cpf));
  for (const cpf of Object.keys(compByCpf)) {
    if (compByCpf[cpf].compStatus === 'dentro_regra' && !elegCpfs.has(cpf)) {
      const c = compByCpf[cpf];
      const ana = analise.find((a) => a.cpf === cpf);
      if (ana) {
        const synth: ElegivelRow = {
          ...ana, _semContrato: true, dest: '-', troco: 0, vc: 0, taxa: '-', ok: false, destinos: [],
          compPct: Math.round(c.compPct * 10) / 10, compStatus: 'dentro_regra',
          elegRealOk: true, resolveExc: false, reducaoEstim: 0, parcelaNovaEstim: 0,
        };
        elegiveis.push(synth);
      }
    }
  }

  return {
    analise,
    elegiveis,
    rmcRcc: rmcAll,
    mapaArr,
    taxaDist,
    compByCpf,
    loasAll,
    fname,
    loadedAt: Date.now(),
  };
}

/**
 * Lê arquivo XLSX/XLS/CSV e retorna BaseProcessada.
 * Usa SheetJS (xlsx) — precisa estar instalado no package.json.
 */
export async function parseFileToBase(file: File): Promise<BaseProcessada | null> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const firstSheet = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, defval: '' });
  return processBase(data, file.name);
}

// ──────────────────────────────────────────────────────────────────
// MOTIVOS — pro export "todos + motivo" da higienização em lote
// ──────────────────────────────────────────────────────────────────

/** Por que NENHUM banco da ORDEM aceita este contrato — resumo em 1 linha. */
export function motivoSemDestino(
  par: number, sal: number, pag: number, cod: string, idade: number | null,
  isInv: boolean, eN: number, txOrig: number, i1: boolean,
): string {
  if (eN && ESP_LOAS.includes(eN)) return 'LOAS/BPC (87/88) não porta';
  if (idade !== null && idade > IDADE_MAX) return `Idade ${idade} acima do teto de ${IDADE_MAX} anos`;
  if (!sal) return 'Sem saldo devedor na planilha';
  if (!par) return 'Sem valor de parcela na planilha';
  const motivos: string[] = [];
  for (const b of ORDEM) {
    const r = BD[b];
    if (!r) continue;
    if (r.block.includes(cod)) { motivos.push(`${b}: origem ${cod} bloqueada`); continue; }
    if (r.espBlock && eN && r.espBlock.includes(eN)) { motivos.push(`${b}: espécie ${eN} não atendida`); continue; }
    if (isInv && r.blockInv) { motivos.push(`${b}: não porta invalidez`); continue; }
    if (isInv && r.invRules?.minAge && idade !== null && idade < r.invRules.minAge) { motivos.push(`${b}: invalidez só a partir de ${r.invRules.minAge} anos`); continue; }
    if (r.idadeMax && idade !== null && idade > r.idadeMax) { motivos.push(`${b}: idade acima de ${r.idadeMax}`); continue; }
    if (r.pMin && par < r.pMin) { motivos.push(`${b}: parcela abaixo de R$ ${r.pMin}`); continue; }
    if (r.sMin && sal < r.sMin) { motivos.push(`${b}: saldo abaixo de R$ ${r.sMin}`); continue; }
    const pgR = (r.pgMinMap && r.pgMinMap[cod] !== undefined) ? r.pgMinMap[cod] : (i1 ? 1 : r.pgMin);
    if (pgR && pag < pgR) { motivos.push(`${b}: ${pag} pagas (mínimo ${pgR})`); continue; }
    let minTx: number | undefined;
    if (r.taxaOrigemMin && r.taxaOrigemMin[cod] !== undefined) minTx = r.taxaOrigemMin[cod];
    else if (r.taxaOrigemMinDefault !== undefined) minTx = r.taxaOrigemMinDefault;
    if (minTx && txOrig > 0 && txOrig < minTx) { motivos.push(`${b}: taxa origem ${txOrig.toFixed(2)}% abaixo de ${minTx}%`); continue; }
    motivos.push(`${b}: troco/valor fora do mínimo`);
  }
  const todos = (k: string) => motivos.length > 0 && motivos.every((m) => m.includes(k));
  if (todos('bloqueada')) return `Origem ${cod} bloqueada em todos os bancos`;
  if (todos('saldo abaixo')) {
    const min = Math.min(...ORDEM.map((b) => BD[b]?.sMin || Infinity));
    return `Saldo R$ ${sal.toFixed(2)} abaixo do mínimo (menor mínimo: R$ ${min})`;
  }
  if (todos('pagas')) return `${pag} parcelas pagas — abaixo do mínimo em todos os bancos`;
  if (todos('troco/valor')) return 'Troco abaixo do mínimo em todos os destinos';
  return motivos.slice(0, 3).join(' · ');
}

const fmtR = (v: number) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Observação em 1 linha: situação de enquadramento + aceitação bancária do contrato. */
export function descreverMotivo(reg: ElegivelRow, comp?: CompPorCpf): string {
  const partes: string[] = [];
  const st = reg.compStatus || comp?.compStatus || 'sem_dados';
  if (st === 'sem_dados' || !comp || !comp.benef) {
    partes.push('Enquadramento não calculado (sem valor do benefício na planilha)');
  } else {
    const excEmp = Math.max(0, comp.sumEmp - comp.tetoEmpReal);
    const excGlob = Math.max(0, comp.total - comp.teto45);
    const onde = excEmp > 0.01
      ? `empréstimo ${fmtR(comp.sumEmp)} > teto 35% ${fmtR(comp.tetoEmpReal)}`
      : excGlob > 0.01 ? `total ${fmtR(comp.total)} > teto 45% ${fmtR(comp.teto45)}` : '';
    if (st === 'dentro_regra') {
      partes.push(`Enquadra (comprometimento ${comp.compPct.toFixed(1)}%)`);
    } else if (st === 'fora_regra_resolvivel') {
      const sol = reg.viaInconta
        ? `combo BRB (${comp.viaInconta?.n ?? '?'} contratos) resolve`
        : reg.resolveExc
          ? 'este contrato resolve com port+refin'
          : comp.viaInconta
            ? `combo BRB (${comp.viaInconta.n} contratos) em outros contratos do CPF`
            : 'outro contrato do CPF resolve';
      partes.push(`Fora da regra: excede ${fmtR(comp.excedente)} (${onde}) — ${sol}`);
    } else if (st === 'fora_regra_inviavel') {
      partes.push(`Fora da regra: excede ${fmtR(comp.excedente)} (${onde}) — nenhum contrato reduz o suficiente e o combo BRB (até 3) não cobre`);
    }
  }
  if (!reg.ok && !reg._semContrato) {
    partes.push(`Nenhum banco aceita este contrato: ${reg.motivoSemDestino || 'motivo não identificado'}`);
  }
  return partes.join(' | ');
}
