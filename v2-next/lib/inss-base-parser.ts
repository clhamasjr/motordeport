// ──────────────────────────────────────────────────────────────────
// INSS Base Parser — port direto de processBase do V1 (linha ~1257)
// Lê uma planilha XLSX → roda motor → gera analise + elegiveis + rmcAll.
// ──────────────────────────────────────────────────────────────────

import {
  ESP_AUX, ESP_INV, B1P,
  pV, pP, pC, pEN, cAge, cBY,
  testarTodos, ORDEM,
  type BancoSimul,
} from '@/lib/inss-motor';
import {
  calcReducaoPort,
} from '@/lib/inss-motor';

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
  troco: number;
  vc: number;
  taxa: number | string;
  ok: boolean;
  destinos: ElegivelDestino[];
  t1: string;
  t2: string;
  t3: string;
  // Enriquecimento de enquadramento (post-process)
  compPct?: number;
  compStatus?: CompStatusBase;
  resolveExc?: boolean;
  elegRealOk?: boolean;
  reducaoEstim?: number;
  parcelaNovaEstim?: number;
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
  teto45: number;
  sumEmp: number;
  vRmc: number;
  vRcc: number;
  total: number;
}

export interface BaseProcessada {
  analise: ElegivelRow[];
  elegiveis: ElegivelRow[];
  rmcRcc: RmcRow[];
  mapaArr: MapaBanco[];
  taxaDist: Record<string, number>;
  compByCpf: Record<string, CompPorCpf>;
  fname: string;
  loadedAt: number;
}

// ──────────────────────────────────────────────────────────────────
// Helpers de header (V1: findFirst / findAllPos)
// ──────────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
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

const COEF185 = 0.02299;
const COEF_CART = 0.029214;

export function processBase(data: unknown[][], fname = ''): BaseProcessada | null {
  if (!data || data.length < 2) return null;

  const H = data[0].map((h) => (h ? String(h).trim() : ''));
  const rows = data.slice(1);

  // Posições das colunas (espelho do V1)
  const cNm = findFirst(H, ['Nome']);
  const cCP = findFirst(H, ['CPF']);
  const cBn = findFirst(H, ['Beneficio']);
  const cEs = findFirst(H, ['Especie']);
  const cNs = findFirst(H, ['Data Nascimento']);
  const cDI = findFirst(H, ['DIB']);
  const cT1 = findFirst(H, ['Telefone1']);
  const cT2 = findFirst(H, ['Telefone2']);
  const cT3 = findFirst(H, ['Telefone3']);
  const cVB = findFirst(H, ['Valor Beneficio', 'Valor Benefício', 'ValorBeneficio', 'Renda', 'Salario', 'Valor Renda', 'Vlr Beneficio', 'Vlr Renda']);
  const cMg = findFirst(H, ['Margem']);

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
  let rmcB: { tipo: number; con?: number; cod?: number; val?: number; mc: number } | null = null;
  let rccB: typeof rmcB = null;
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
      const res = todosDest.length ? todosDest[0] : null;
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
        destinos: todosDest.map((d) => ({
          banco: d.banco,
          troco: Math.round(d.troco * 100) / 100,
          vc: Math.round(d.vc * 100) / 100,
          taxa: d.taxa,
        })),
        t1, t2, t3,
      };
      analise.push(reg);
      if (res) elegiveis.push(reg);
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
    const benef = x?.valorBeneficio || (sumEmp > 0 ? sumEmp / 0.35 : 0);
    if (!benef) {
      compByCpf[cpf] = { compPct: 0, compStatus: 'sem_dados', excedente: 0, benef: 0, teto45: 0, sumEmp, vRmc, vRcc, total: sumEmp + vRmc + vRcc };
      continue;
    }
    const total = sumEmp + vRmc + vRcc;
    const pct = (total / benef) * 100;
    const teto45 = benef * 0.45;
    const excedente = Math.max(0, total - teto45);
    compByCpf[cpf] = {
      compPct: pct,
      compStatus: total <= teto45 ? 'dentro_regra' : 'sem_dados', // será refinado abaixo
      excedente,
      benef, teto45, sumEmp, vRmc, vRcc, total,
    };
  }

  // Marca cada reg com compStatus/elegRealOk/reducaoEstim/parcelaNovaEstim
  for (const reg of analise) {
    const c = compByCpf[reg.cpf];
    if (!c) {
      reg.compPct = 0; reg.compStatus = 'sem_dados'; reg.resolveExc = false;
      reg.elegRealOk = false; reg.reducaoEstim = 0; reg.parcelaNovaEstim = 0;
      continue;
    }
    reg.compPct = Math.round(c.compPct * 10) / 10;
    let reduz = 0;
    if (reg.ok && reg.sal > 0 && reg.par > 0) {
      const rc = calcReducaoPort({ par: reg.par, sal: reg.sal }, 108);
      if (rc && rc.reducao > 0) reduz = rc.reducao;
    }
    reg.reducaoEstim = Math.round(reduz * 100) / 100;
    reg.parcelaNovaEstim = reduz > 0 ? Math.round((reg.par - reduz) * 100) / 100 : 0;
    if (c.compStatus === 'dentro_regra') {
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
    if (compByCpf[cpf].excedente > 0) {
      const algumResolve = analise.some((a) => a.cpf === cpf && a.resolveExc);
      compByCpf[cpf].compStatus = algumResolve ? 'fora_regra_resolvivel' : 'fora_regra_inviavel';
    }
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
