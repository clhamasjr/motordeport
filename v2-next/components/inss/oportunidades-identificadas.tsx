'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatBRL } from '@/lib/utils';
import { InssParsedResult } from '@/lib/inss-types';
import {
  testarTodos, calcPortRefin108, parseBR, pC, pEN, ESP_INV, ESP_AUX, ESP_LOAS, BD,
  type BancoSimul, type PortRefin108Result,
} from '@/lib/inss-motor';
import {
  TrendingUp, Sparkles, AlertTriangle,
  CheckCircle2, XCircle, Scissors, RefreshCw,
} from 'lucide-react';
import { EnviarOportunidadesButton } from './enviar-oportunidades';

// Coef pra estimativa rápida em 108 MESES @ 1.85% (teto INSS, tabela alta)
// Cliente com margem livre faz empréstimo novo 108m — coef PRICE = 0.02153
const COEF_EMP_185 = 0.02153;

// Rótulo de exibição do banco destino (chave do motor → nome amigável).
const BANCO_LABEL: Record<string, string> = { BRB_INCONTA: 'BRB INCONTA' };
const bl = (k: string) => BANCO_LABEL[k] ?? k;

// Diagnóstico do motivo de bloqueio pra contratos que ninguém aceita.
// Pega o "menos pior" — explica em 1 frase por que cada banco rejeitou.
function diagnosticarBloqueio(parcela: number, saldo: number, taxaOrig: number, codOrigem: string): string {
  const motivos: string[] = [];
  for (const banco of ['QUALI', 'C6', 'BRB', 'BRB_INCONTA', 'ICRED']) {
    const r = BD[banco];
    if (!r) continue;
    if (r.block && r.block.includes(codOrigem)) {
      motivos.push(`${banco}: bloqueia origem ${codOrigem}`);
      continue;
    }
    if (r.sMin && saldo < r.sMin) {
      motivos.push(`${banco}: saldo ${saldo.toFixed(0)} < mín ${r.sMin}`);
      continue;
    }
    // Taxa mínima da origem (específica do origem ou default do banco)
    let minTx: number | undefined;
    if (r.taxaOrigemMin && r.taxaOrigemMin[codOrigem] !== undefined) {
      minTx = r.taxaOrigemMin[codOrigem];
    } else if (r.taxaOrigemMinDefault !== undefined) {
      minTx = r.taxaOrigemMinDefault;
    }
    // Só rejeita se temos taxaOrig conhecida E é menor que o mínimo
    if (minTx !== undefined && minTx > 0 && taxaOrig > 0 && taxaOrig < minTx) {
      motivos.push(`${banco}: taxa orig ${taxaOrig.toFixed(2)}% < mín ${minTx}%`);
      continue;
    }
    // Se chegou aqui, é por troco mínimo
    motivos.push(`${banco}: troco < mínimo`);
  }
  // Se TODOS reclamaram de saldo, simplifica a mensagem
  if (motivos.every((m) => m.includes('saldo'))) {
    const minSaldo = Math.min(...Object.values(BD).map((r) => r.sMin || 0).filter((v) => v > 0));
    return `Saldo R$ ${saldo.toFixed(2)} < mínimo do menor banco (R$ ${minSaldo})`;
  }
  return motivos.slice(0, 2).join(' · ');
}

interface ContratoCalc {
  idx: number;
  contrato: string;
  bancoOrigem: string;
  codOrigem: string;
  parcela: number;
  saldo: number;
  taxaOrig: number;
  prazos: string;
  pagas: number;
  prazoRest: number;
  prazoTotal: number;
  destinos: BancoSimul[];
  destinoSelecionado: number;
  // Port+Refin 108m (operação UNIFICADA) — calculada com coef 108m
  portRefin108: PortRefin108Result | null;
  // TODOS os destinos calculados (ordenados por troco/redução desc)
  todosResultados: PortRefin108Result[];
  resolveExcedente: boolean;     // refin no destino 108m cobre o excedente?
  bloqueado: boolean;
  motivoBloqueio?: string;
}

interface SolucaoCartao {
  tipo: 'RMC' | 'RCC';
  valor: number;
  resolve: boolean;
}

interface AnaliseNovaRegra {
  // Inputs
  benef: number;
  sumEmp: number;
  sumRmc: number;
  sumRcc: number;
  total: number;
  compPct: number;

  // Cliente tem algum cartão (RMC ou RCC)?
  temAlgumCartao: boolean;

  // Tetos regra vigente pós-MP 1355 (35% emp + 5% RMC + 5% RCC = 45%).
  // teto40Total é nome LEGADO — contém o teto GLOBAL (45%). Ignorado se isLoas.
  teto40Total: number;
  tetoEmpComCartao: number;
  tetoEmpReal: number;
  tetoCartao: number;

  // Estado NOVA
  enquadraNovaRegra: boolean;
  excedente: number;
  margemLivreNova: number;

  // Soluções pra enquadrar (só se NÃO enquadra)
  contratosQueResolvem: ContratoCalc[];
  cartoesQueResolvem: SolucaoCartao[];

  // ── LOAS/BPC (espécies 87/88) ──────────────────────────────────────
  isLoas: boolean;
  // campos abaixo só significativos quando isLoas=true
  numCartoesLoas: number;       // total de cartões averbados (RMC + RCC)
  tetoEmpLoas: number;          // benef * 0.35
  margemLivreEmpLoas: number;   // tetoEmpLoas - sumEmp (≥ 0)
  margemLivreCartLoas: number;  // 0 — LOAS não tem teto separado de cartão
  pctEmpLoas: number;           // sumEmp / benef * 100
  statusLoas: 'sem_dados' | 'com_margem' | 'extrapolado_emp' | 'extrapolado_cartoes';
}

function calcularTudo(
  parsed: InssParsedResult,
  saldoOverrides: Record<number, number> = {},
): { contratos: ContratoCalc[]; analise: AnaliseNovaRegra } {
  const ben = parsed.beneficio || {};
  const b = parsed.beneficiario || {};
  const mrg = parsed.margem || {};
  const esp = ben.especie || '';
  const eN = pEN(esp);
  const isInv = ESP_INV.includes(eN);
  const isLoas = ESP_LOAS.includes(eN);
  const isAux = ESP_AUX.includes(eN) || String(esp).toUpperCase().includes('AUXIL');
  const idade = b.idade ? parseInt(String(b.idade), 10) : null;

  // DIB → anos de benefício
  let bY: number | null = null;
  if (ben.ddb) {
    const m = String(ben.ddb).match(/(\d{2})[/-](\d{2})[/-](\d{4})/);
    if (m) {
      const d = new Date(+m[3], +m[2] - 1, +m[1]);
      const now = new Date();
      bY = now.getFullYear() - d.getFullYear();
      if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) bY--;
    }
  }

  // ── Análise da regra VIGENTE (pós-queda da MP 1355, 02/09/2026) ──
  //
  // REGRA: emp ≤ 35% + RMC ≤ 5% + RCC ≤ 5% = teto global 45%.
  // O teto de "40% sem cartão" da MP 1355 MORREU junto com a MP — teto de
  // emp é 35% SEMPRE, com ou sem cartão. RMC/RCC seguem suspensos pra
  // CONTRATAR (INSS), mas as reservas de 5% + 5% voltam a existir.
  // Detecção de cartão: SÓ pela margem livre (fonte de verdade). Cartões
  // antigos no array parsed.cartoes podem ser histórico — ignorados.
  const benef = parseBR(ben.base_calculo) || parseBR(ben.valor) || 0;
  const sumEmp = parseBR(mrg.parcelas);
  const tetoCartao = benef * 0.05;
  const mrgRmcLivre = parseBR(mrg.rmc);
  const mrgRccLivre = parseBR(mrg.rcc);
  const temRmc = mrg.rmc != null && mrgRmcLivre < tetoCartao - 0.01;
  const temRcc = mrg.rcc != null && mrgRccLivre < tetoCartao - 0.01;
  const sumRmc = temRmc ? Math.max(0, tetoCartao - mrgRmcLivre) : 0;
  const sumRcc = temRcc ? Math.max(0, tetoCartao - mrgRccLivre) : 0;
  const total = sumEmp + sumRmc + sumRcc;
  const compPct = benef > 0 ? (total / benef) * 100 : 0;

  // Tem PELO MENOS 1 cartão averbado? (RMC OU RCC)
  const temAlgumCartao = temRmc || temRcc;

  const teto40Total = benef * 0.45; // teto GLOBAL 45% (nome legado da época da MP)
  // Teto emp: 35% SEMPRE (o 40% "sem cartão" caiu com a MP 1355)
  const tetoEmpReal = benef * 0.35;
  const tetoEmpComCartao = benef * 0.35; // legacy
  const enquadraNovaRegra = total <= teto40Total + 0.01 && sumEmp <= tetoEmpReal + 0.01
    && sumRmc <= tetoCartao + 0.01 && sumRcc <= tetoCartao + 0.01;
  // Excedente a cobrir reduzindo parcela de emp: estouro do global OU do emp
  // (caso da virada: quem usou os 40% da MP fica negativo nos 35%).
  const excedente = Math.max(0, total - teto40Total, sumEmp - tetoEmpReal);
  const margemLivreNova = Math.max(0, tetoEmpReal - sumEmp);

  // ── Roda motor pra cada contrato ──
  const contratosRaw = parsed.contratos || [];
  const contratos: ContratoCalc[] = [];

  for (let i = 0; i < contratosRaw.length; i++) {
    const c = contratosRaw[i];
    const parcela = parseBR(c.parcela);
    // Override do user tem precedência sobre o saldo do Multicorban
    const saldoOriginal = parseBR(c.saldo || c.saldo_quitacao);
    const saldo = saldoOverrides[i] !== undefined ? saldoOverrides[i] : saldoOriginal;
    if (!parcela || !saldo) continue;
    const taxaOrig = parseBR(c.taxa);
    const codOrigem = pC(c.banco_codigo || '');
    const restPg = parseInt(String(c.prazo || '0'), 10) || 0;
    const totPg = parseInt(String(c.prazo_original || '0'), 10) || 0;
    const pagas = Math.max(0, totPg - restPg);
    const prazos = totPg > 0 ? `${pagas}/${totPg}` : (restPg > 0 ? `?/${restPg}` : '—');
    const contrato = c.contrato || '';
    const bancoOrigem = c.banco || codOrigem || '?';

    let destinos: BancoSimul[] = [];
    let bloqueado = false;
    let motivo: string | undefined;

    if (isAux) {
      bloqueado = true;
      motivo = 'Auxílio — não permite consignado';
    } else if (isLoas) {
      // LOAS/BPC: só contrato novo, sem portabilidade
      bloqueado = true;
      motivo = 'LOAS/BPC — apenas contrato novo (sem portabilidade)';
    } else {
      try {
        destinos = testarTodos(parcela, saldo, pagas, codOrigem, isInv, idade, bY, restPg, eN, contrato, taxaOrig);
      } catch {
        destinos = [];
      }
      if (!destinos.length) {
        bloqueado = true;
        motivo = diagnosticarBloqueio(parcela, saldo, taxaOrig, codOrigem);
      }
    }

    // ── PORT + REFIN 108m: operação unificada ──
    // Cada destino tem 2 tabelas:
    //   tabelaAlta = teto da faixa (1.85% normalmente) = MAIS comissão correspondente
    //   tabelaBaixa = piso da faixa = MAIS troco/redução pro cliente
    //
    // ESTRATÉGIA DE ESCOLHA:
    //   - Cliente ENQUADRADO: prioriza tabelaAlta (max comissão) SE troco >= R$250.
    //     Se troco_alta < 250, fallback pra tabelaBaixa pra dar troco mínimo.
    //   - Cliente NÃO ENQUADRADO: usa tabelaBaixa (max redução pra enquadrar).
    //
    // Sempre escolhe o destino com MELHOR resultado dentro da estratégia.
    const TROCO_MIN_ENQUADRADO = 250;
    let portRefin108: PortRefin108Result | null = null;
    let todosCenarios: Array<{ result: PortRefin108Result; trocoEfetivo: number; reducaoEfetiva: number }> = [];
    if (!bloqueado && destinos.length > 0 && saldo > 0 && parcela > 0) {
      for (const d of destinos) {
        const r = calcPortRefin108(parcela, saldo, d, taxaOrig, codOrigem);
        if (!r || !r.taxaOrigVale) continue;
        // Escolhe cenário conforme estratégia:
        //   - Cliente ENQUADRADO: tabelaAlta (mais comissão) se troco >= 250, senão baixa
        //   - Cliente NÃO ENQUADRADO: reduz EXATAMENTE o excedente (e troco resultante)
        let refin_novaParc: number;
        let refin_reducao: number;
        let port_novaParc: number;
        let port_vc: number;
        let port_troco: number;
        let taxaUsada: number;
        let coefUsado: number;

        if (enquadraNovaRegra) {
          const cenarioEsc = r.tabelaAlta.port_troco >= TROCO_MIN_ENQUADRADO
            ? r.tabelaAlta
            : r.tabelaBaixa;
          taxaUsada = cenarioEsc.taxa;
          coefUsado = cenarioEsc.coef;
          refin_novaParc = cenarioEsc.refin_novaParc;
          refin_reducao = cenarioEsc.refin_reducao;
          port_novaParc = cenarioEsc.port_novaParc;
          port_vc = cenarioEsc.port_vc;
          port_troco = cenarioEsc.port_troco;
        } else {
          // FORA DA REGRA: tenta reduzir SÓ o excedente. Se VC < saldo, não viável
          // (banco não cobre o saldo) — cai pra refin puro tabelaBaixa (reduz mais).
          const cenarioBase = r.tabelaBaixa;
          taxaUsada = cenarioBase.taxa;
          coefUsado = cenarioBase.coef;
          const novaParcAlvo = Math.max(0, parcela - excedente);
          const vcAlvo = coefUsado > 0 ? novaParcAlvo / coefUsado : 0;
          if (vcAlvo >= saldo) {
            // Viável: reduz exato e gera troco
            refin_novaParc = novaParcAlvo;
            refin_reducao = parcela - novaParcAlvo;
            port_novaParc = novaParcAlvo;
            port_vc = vcAlvo;
            port_troco = vcAlvo - saldo;
          } else {
            // Não viável: cai pra refin puro (reduz máximo, sem troco)
            refin_novaParc = cenarioBase.refin_novaParc;
            refin_reducao = cenarioBase.refin_reducao;
            port_novaParc = cenarioBase.refin_novaParc;
            port_vc = saldo;
            port_troco = 0;
          }
        }

        const ajustado: PortRefin108Result = {
          ...r,
          taxa: taxaUsada,
          coef: coefUsado,
          refin_novaParc,
          refin_reducao,
          port_novaParc,
          port_vc,
          port_troco,
        };
        todosCenarios.push({
          result: ajustado,
          trocoEfetivo: port_troco,
          reducaoEfetiva: refin_reducao,
        });
      }
      // Ordena: enquadrado por TROCO desc, não-enquadrado por REDUÇÃO desc
      todosCenarios.sort((a, b) => {
        if (enquadraNovaRegra) return b.trocoEfetivo - a.trocoEfetivo;
        return b.reducaoEfetiva - a.reducaoEfetiva;
      });
      portRefin108 = todosCenarios[0]?.result || null;
    }

    // Resolve o excedente da nova regra?
    const resolveExcedente = !bloqueado && excedente > 0 &&
      !!portRefin108 && portRefin108.refin_reducao >= excedente - 0.01;

    contratos.push({
      idx: i, contrato, bancoOrigem, codOrigem, parcela, saldo, taxaOrig, prazos,
      pagas, prazoRest: restPg, prazoTotal: totPg,
      destinos, destinoSelecionado: 0,
      portRefin108,
      todosResultados: todosCenarios.map((c) => c.result),
      resolveExcedente,
      bloqueado, motivoBloqueio: motivo,
    });
  }

  // Soluções de cartão — na regra vigente (35+5+5) cancelar cartão SÓ resolve
  // estouro do teto GLOBAL (45%). Estouro do bucket de EMP (sumEmp > 35%) não
  // sai cancelando cartão — o cartão tem reserva própria, não devolve margem emp.
  const excedenteEmpBucket = Math.max(0, sumEmp - tetoEmpReal);
  const cartoesQueResolvem: SolucaoCartao[] = [];
  if (sumRmc > 0) cartoesQueResolvem.push({ tipo: 'RMC', valor: sumRmc, resolve: excedenteEmpBucket <= 0.01 && sumRmc >= excedente - 0.01 });
  if (sumRcc > 0) cartoesQueResolvem.push({ tipo: 'RCC', valor: sumRcc, resolve: excedenteEmpBucket <= 0.01 && sumRcc >= excedente - 0.01 });

  // ── Campos LOAS/BPC ───────────────────────────────────────────────
  // Regra NOVA: 35% emp puro (sem teto separado de cartão). Cartão averbado
  // é flag — não consome margem própria de 5%.
  const numCartoesLoas = (temRmc ? 1 : 0) + (temRcc ? 1 : 0);
  const tetoEmpLoas = benef * 0.35;
  const margemLivreEmpLoas = benef > 0 ? Math.max(0, tetoEmpLoas - sumEmp) : 0;
  const margemLivreCartLoas = 0; // sem teto separado de cartão em LOAS
  const pctEmpLoas = benef > 0 ? (sumEmp / benef) * 100 : 0;
  const statusLoas: AnaliseNovaRegra['statusLoas'] = !benef
    ? 'sem_dados'
    : numCartoesLoas >= 2
      ? 'extrapolado_cartoes'
      : sumEmp >= tetoEmpLoas - 0.01
        ? 'extrapolado_emp'
        : 'com_margem';

  const analise: AnaliseNovaRegra = {
    benef, sumEmp, sumRmc, sumRcc, total, compPct,
    temAlgumCartao,
    teto40Total, tetoEmpComCartao, tetoEmpReal, tetoCartao,
    enquadraNovaRegra, excedente, margemLivreNova,
    contratosQueResolvem: contratos.filter((c) => c.resolveExcedente),
    cartoesQueResolvem,
    // LOAS
    isLoas,
    numCartoesLoas, tetoEmpLoas, margemLivreEmpLoas,
    margemLivreCartLoas, pctEmpLoas, statusLoas,
  };

  return { contratos, analise };
}

interface Props {
  parsed: InssParsedResult;
  cpf?: string; // opcional pra retrocompat — passado pro card de oportunidades (WhatsApp)
}

export function OportunidadesIdentificadas({ parsed, cpf }: Props) {
  const [saldoOverrides, setSaldoOverrides] = useState<Record<number, number>>({});
  const { contratos, analise } = useMemo(
    () => calcularTudo(parsed, saldoOverrides),
    [parsed, saldoOverrides],
  );

  const ajustarSaldo = (idx: number, valor: number) => {
    setSaldoOverrides((prev) => ({ ...prev, [idx]: valor }));
  };
  const resetSaldo = (idx: number) => {
    setSaldoOverrides((prev) => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  };

  if (contratos.length === 0 && analise.benef === 0) return null;

  const {
    benef, total, compPct, teto40Total, tetoEmpReal, temAlgumCartao,
    enquadraNovaRegra, excedente, margemLivreNova, sumEmp,
    contratosQueResolvem, cartoesQueResolvem,
    isLoas, numCartoesLoas, tetoEmpLoas, margemLivreEmpLoas,
    margemLivreCartLoas, pctEmpLoas, statusLoas,
  } = analise;

  const numSolucoesContrato = contratosQueResolvem.length;
  const numSolucoesCartao = cartoesQueResolvem.filter((c) => c.resolve).length;
  const totalSolucoes = numSolucoesContrato + numSolucoesCartao;
  const inviavel = !enquadraNovaRegra && totalSolucoes === 0;

  const idadeNum = parsed.beneficiario?.idade ? parseInt(String(parsed.beneficiario.idade), 10) : null;
  const especieNum = pEN(parsed.beneficio?.especie || '');

  // Empréstimo Novo — teto emp 35% (LOAS e regular, regra vigente pós-MP 1355)
  const margemLivreParaEmpNovo = isLoas ? margemLivreEmpLoas : (enquadraNovaRegra ? margemLivreNova : 0);
  const empNovoVlr185 = margemLivreParaEmpNovo > 0 ? margemLivreParaEmpNovo / COEF_EMP_185 : 0;

  const empNovoOpcoes = useMemo(() => {
    if (margemLivreParaEmpNovo <= 0) return [] as BancoSimul[];
    if (!isLoas && !enquadraNovaRegra) return [] as BancoSimul[];
    try {
      return testarTodos(margemLivreParaEmpNovo, 0, 0, '000', false, idadeNum, null, 108, especieNum, '', 0);
    } catch {
      return [];
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoas, enquadraNovaRegra, margemLivreParaEmpNovo, idadeNum, especieNum]);

  // ── Linhas do "card de oportunidades" pro cliente (WhatsApp) ──
  // Resume em linguagem de cliente o que ele PODE fazer — sem montar proposta.
  const linhasOportunidade = useMemo(() => {
    const L: string[] = [];
    // Empréstimo novo (LOAS usa teto 35%; regular só se enquadra)
    if (margemLivreParaEmpNovo > 0 && empNovoVlr185 > 0) {
      L.push(`Empréstimo novo: até ${formatBRL(empNovoVlr185)} na conta (parcela ${formatBRL(margemLivreParaEmpNovo)}/mês em 108x)`);
    }
    if (!isLoas) {
      // Portabilidade com troco
      const comTroco = contratos.filter((c) => !c.bloqueado && c.portRefin108 && c.portRefin108.port_troco > 0);
      const trocoTotal = comTroco.reduce((s, c) => s + (c.portRefin108?.port_troco || 0), 0);
      if (trocoTotal > 0) {
        L.push(`Dinheiro extra trocando seu contrato de banco: até ${formatBRL(trocoTotal)} mantendo a mesma parcela`);
      }
      // Redução de parcela (quando fora de regra e há solução)
      if (!enquadraNovaRegra) {
        const reducaoMax = contratos
          .filter((c) => c.resolveExcedente && c.portRefin108)
          .reduce((s, c) => Math.max(s, c.portRefin108?.refin_reducao || 0), 0);
        if (reducaoMax > 0) {
          L.push(`Redução de parcela: até ${formatBRL(reducaoMax)}/mês a menos no seu desconto`);
        }
      }
    }
    return L;
  }, [isLoas, enquadraNovaRegra, margemLivreParaEmpNovo, empNovoVlr185, contratos]);

  return (
    <Card className={
      isLoas
        ? statusLoas === 'com_margem' ? 'border-blue-500/40 bg-blue-500/5'
          : statusLoas === 'extrapolado_cartoes' ? 'border-orange-500/40 bg-orange-500/5'
          : statusLoas === 'extrapolado_emp' ? 'border-red-500/40 bg-red-500/5'
          : 'border-border'
        : inviavel ? 'border-red-500/40 bg-red-500/5'
        : !enquadraNovaRegra ? 'border-yellow-500/40 bg-yellow-500/5'
        : 'border-green-500/30 bg-green-500/5'
    }>
      <CardContent className="p-4 space-y-3">

        {/* Enviar card de oportunidades pro cliente (WhatsApp) — sem montar proposta */}
        <div className="flex justify-end">
          <EnviarOportunidadesButton parsed={parsed} cpf={cpf} linhas={linhasOportunidade} />
        </div>

        {/* ═══════════════ LOAS/BPC ═══════════════════════════════════════ */}
        {isLoas ? (
          <>
            {/* Header LOAS */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg">🔵</span>
                <h3 className="font-bold text-base text-blue-300">LOAS / BPC — Regra especial 35%</h3>
                <Badge variant="info" className="text-[10px]">Espécie {parsed.beneficio?.especie}</Badge>
                <Badge variant="muted" className="text-[10px]">Sem portabilidade</Badge>
              </div>
              <Badge
                variant={statusLoas === 'com_margem' ? 'success' : 'destructive'}
                className="text-xs font-mono"
              >
                {pctEmpLoas.toFixed(1)}% / 35%
              </Badge>
            </div>

            {/* Aviso LOAS */}
            <div className="rounded-md bg-blue-500/10 border border-blue-500/30 p-3 text-xs text-blue-200">
              <strong>LOAS/BPC</strong> aplica regras diferentes do INSS regular:{' '}
              <strong>teto emp = 35%</strong> só pra empréstimo (sem teto separado de cartão),{' '}
              <strong>máximo 1 cartão</strong>,{' '}
              <strong>sem portabilidade</strong> — somente contratos novos.
            </div>

            {/* KPIs LOAS */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div className="rounded-md border border-border bg-card/50 p-2">
                <div className="text-[9px] uppercase text-muted-foreground font-semibold">Teto Emp (35%)</div>
                <div className="font-mono font-bold text-blue-300">{formatBRL(tetoEmpLoas)}</div>
              </div>
              <div className="rounded-md border border-border bg-card/50 p-2">
                <div className="text-[9px] uppercase text-muted-foreground font-semibold">Comprometido</div>
                <div className={`font-mono font-bold ${pctEmpLoas >= 35 ? 'text-red-400' : pctEmpLoas >= 25 ? 'text-yellow-400' : 'text-foreground'}`}>
                  {formatBRL(sumEmp)} ({pctEmpLoas.toFixed(1)}%)
                </div>
              </div>
              <div className="rounded-md border border-border bg-card/50 p-2">
                <div className="text-[9px] uppercase text-muted-foreground font-semibold">Cartões</div>
                <div className="font-mono font-bold">
                  {numCartoesLoas === 0
                    ? <span className="text-green-400">Sem cartão</span>
                    : numCartoesLoas === 1
                      ? <span className="text-yellow-400">1 cartão</span>
                      : <span className="text-red-400">⚠ {numCartoesLoas} cartões (extrapola)</span>
                  }
                </div>
              </div>
            </div>

            {/* Status LOAS */}
            {statusLoas === 'com_margem' && (
              <div className="rounded-md bg-green-500/10 border border-green-500/40 p-3 text-sm">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="size-5 text-green-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold text-green-400">✅ LOAS com margem disponível</div>
                    <div className="text-xs text-foreground mt-1">
                      Parcelas de emp <strong className="font-mono">{formatBRL(sumEmp)}</strong>{' '}
                      de <strong className="font-mono">{formatBRL(tetoEmpLoas)}</strong> (teto 35%).
                      Sobra <strong className="font-mono text-green-400">{formatBRL(margemLivreEmpLoas)}</strong> pra empréstimo novo.
                      {margemLivreCartLoas > 0 && (
                        <>{' '}Cliente sem cartão — pode contratar 1 cartão (margem{' '}
                          <strong className="font-mono text-cyan-400">{formatBRL(margemLivreCartLoas)}</strong>).</>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {statusLoas === 'extrapolado_emp' && (
              <div className="rounded-md bg-red-500/10 border border-red-500/40 p-3 text-sm">
                <div className="flex items-start gap-2">
                  <XCircle className="size-5 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold text-red-400">🔴 LOAS extrapolado — empréstimo acima de 35%</div>
                    <div className="text-xs text-foreground mt-1">
                      Parcelas de emp <strong className="font-mono text-red-400">{formatBRL(sumEmp)}</strong>{' '}
                      ≥ teto <strong className="font-mono">{formatBRL(tetoEmpLoas)}</strong>. Sem margem pra novo contrato.
                      <div className="mt-1 text-muted-foreground">LOAS não permite portabilidade — não há como liberar margem operacionalmente.</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {statusLoas === 'extrapolado_cartoes' && (
              <div className="rounded-md bg-orange-500/10 border border-orange-500/40 p-3 text-sm">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="size-5 text-orange-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold text-orange-400">🟠 LOAS extrapolado — {numCartoesLoas} cartões (máx 1)</div>
                    <div className="text-xs text-foreground mt-1">
                      LOAS permite no máximo 1 cartão. Cliente tem {numCartoesLoas} cartões averbados — operação inviável.
                    </div>
                  </div>
                </div>
              </div>
            )}
            {statusLoas === 'sem_dados' && (
              <div className="rounded-md bg-muted/30 border border-border p-3 text-sm text-muted-foreground">
                ⚪ Sem dados de benefício suficientes pra calcular enquadramento LOAS.
              </div>
            )}
          </>
        ) : (
          <>
        {/* ═══════════════ INSS REGULAR ════════════════════════════════ */}

        {/* Header */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-cyan-400" />
            <h3 className="font-bold text-base">Enquadramento INSS (35% emp + 5% RMC + 5% RCC = 45%)</h3>
            <Badge
              variant={temAlgumCartao ? 'muted' : 'info'}
              className="text-[10px]"
              title="Teto de empréstimo é 35% SEMPRE (o 40% sem cartão caiu junto com a MP 1355). Reservas de cartão: 5% RMC + 5% RCC."
            >
              {temAlgumCartao ? '📇 com cartão averbado' : '💸 sem cartão'} · emp ≤ 35%
            </Badge>
          </div>
          <Badge
            variant={inviavel ? 'destructive' : !enquadraNovaRegra ? 'warning' : 'success'}
            className="text-xs"
          >
            {compPct.toFixed(1)}% / 45%
          </Badge>
        </div>

        {/* Status principal */}
        {enquadraNovaRegra ? (
          <div className="rounded-md bg-green-500/10 border border-green-500/40 p-3 text-sm">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="size-5 text-green-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-green-400">✅ Cliente ENQUADRADO na regra vigente</div>
                <div className="text-xs text-foreground mt-1">
                  Comprometimento total <strong className="font-mono">{formatBRL(total)}</strong> de{' '}
                  <strong className="font-mono">{formatBRL(teto40Total)}</strong> (45%).
                  {margemLivreNova > 0 ? (
                    <>
                      {' '}Sobra <strong className="font-mono text-green-400">{formatBRL(margemLivreNova)}</strong> de
                      margem livre pra EMPRÉSTIMO{' '}
                      <span className="text-muted-foreground">
                        (teto emp 35% ={' '}
                        <span className="font-mono">{formatBRL(tetoEmpReal)}</span>)
                      </span>.
                    </>
                  ) : (
                    <> No limite — sem margem livre pra novas operações.</>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : inviavel ? (
          <div className="rounded-md bg-red-500/10 border border-red-500/40 p-3 text-sm">
            <div className="flex items-start gap-2">
              <XCircle className="size-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-red-400">❌ INVIÁVEL — sem operação isolada que enquadre</div>
                <div className="text-xs text-foreground mt-1">
                  Cliente extrapola em <strong className="font-mono text-red-400">{formatBRL(excedente)}</strong>{' '}
                  na regra vigente. Nenhum contrato sozinho reduz parcela suficiente
                  ({contratos.length > 0 && `melhor reduz ${formatBRL(Math.max(0, ...contratos.map((c) => c.portRefin108?.refin_reducao || 0)))}`}),
                  e {cartoesQueResolvem.length === 0 ? 'cliente não tem cartão pra cancelar' : 'cancelar cartão sozinho também não cobre'}.
                  <div className="mt-1 text-red-400 font-semibold">→ Não tem o que fazer com 1 operação só. Precisaria combinar várias.</div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-md bg-yellow-500/10 border border-yellow-500/40 p-3 text-sm">
            <div className="flex items-start gap-2">
              <AlertTriangle className="size-5 text-yellow-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-yellow-400">
                  ⚠ Cliente VAI EXTRAPOLAR — excedente {formatBRL(excedente)}
                </div>
                <div className="text-xs text-foreground mt-1">
                  Precisa de UMA operação que cubra esse valor. <strong className="text-green-400">{totalSolucoes}</strong> solução{totalSolucoes !== 1 ? 'ões' : ''} disponível{totalSolucoes !== 1 ? 'is' : ''}:
                </div>
              </div>
            </div>
          </div>
        )}
          </>
        )}

        {/* Soluções isoladas — só pro INSS regular fora de regra */}
        {!isLoas && !enquadraNovaRegra && totalSolucoes > 0 && (
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
              Soluções pra enquadrar (escolha 1):
            </div>

            {/* Cancelar cartão */}
            {cartoesQueResolvem.filter((c) => c.resolve).map((c) => (
              <div key={c.tipo} className="rounded-md border border-cyan-500/40 bg-cyan-500/5 p-2.5 flex items-center gap-2">
                <Scissors className="size-4 text-cyan-400 shrink-0" />
                <div className="flex-1 text-xs">
                  <div className="font-semibold text-cyan-400">Cancelar cartão {c.tipo}</div>
                  <div className="text-muted-foreground">
                    Libera <strong className="font-mono text-foreground">{formatBRL(c.valor)}</strong>{' '}
                    (≥ excedente <strong className="font-mono">{formatBRL(excedente)}</strong>) — libera a reserva de 5% do cartão.
                  </div>
                </div>
                <Badge variant="success" className="text-[10px]">RESOLVE</Badge>
              </div>
            ))}

            {/* Refin contratos — campos já calculados com redução exata + troco resultante */}
            {contratosQueResolvem.map((c) => {
              if (!c.portRefin108) return null;
              const r = c.portRefin108;
              return (
                <div key={c.idx} className="rounded-md border border-green-500/40 bg-green-500/5 p-2.5 flex items-center gap-2">
                  <RefreshCw className="size-4 text-green-400 shrink-0" />
                  <div className="flex-1 text-xs">
                    <div className="font-semibold text-green-400">
                      Port + Refin contrato <span className="font-mono">{c.contrato || '?'}</span> ({c.bancoOrigem}{' '}
                      {c.taxaOrig > 0 && <span className="text-muted-foreground">@ {c.taxaOrig.toFixed(2)}%</span>})
                      <span className="text-cyan-400 ml-1">
                        → {bl(r.banco)} @ {r.taxa.toFixed(2)}% / 108m
                      </span>
                    </div>
                    <div className="text-muted-foreground">
                      Parcela <strong className="font-mono text-foreground">{formatBRL(c.parcela)}</strong>{' '}
                      → <strong className="font-mono text-green-400">{formatBRL(r.refin_novaParc)}</strong>{' '}
                      (reduz <strong className="font-mono">{formatBRL(r.refin_reducao)}</strong>)
                      {r.port_troco > 0 && (
                        <> · troco <strong className="font-mono text-cyan-400">{formatBRL(r.port_troco)}</strong>{' '}
                        (VC {formatBRL(r.port_vc)} − saldo {formatBRL(c.saldo)})</>
                      )}
                    </div>
                  </div>
                  <Badge variant="success" className="text-[10px]">RESOLVE</Badge>
                </div>
              );
            })}
          </div>
        )}

        {/* Empréstimo Novo — LOAS: mostra se tem margem livre (35%); Regular: se enquadra */}
        {margemLivreParaEmpNovo > 0 && (
          <div className="rounded-lg border border-orange-500/40 bg-orange-500/5 p-3 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-[10px] uppercase tracking-wider font-bold text-orange-400">💰 Empréstimo Novo</div>
                {isLoas ? (
                  <Badge variant="info" className="text-[9px]">teto 35% LOAS</Badge>
                ) : (
                  <Badge
                    variant="info"
                    className="text-[9px]"
                    title="Teto de empréstimo: 35% do benefício (regra vigente pós-MP 1355)"
                  >
                    teto 35% emp
                  </Badge>
                )}
              </div>
              <TrendingUp className="size-4 text-orange-400" />
            </div>

            {/* BRB INCONTA — contrato novo INSS (parcela mín R$25, valor mín R$500, até 72a) */}
            {margemLivreParaEmpNovo >= 25 && empNovoVlr185 >= 500 && (idadeNum === null || idadeNum <= 72) ? (
              <div className="rounded-md border border-cyan-500/60 bg-cyan-500/10 p-3">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                  <Badge variant="success" className="text-[10px] font-mono">BRB INCONTA</Badge>
                  <span className="text-[10px] font-mono text-muted-foreground">108m · 1,85%</span>
                </div>
                <div className="flex items-end justify-between flex-wrap gap-x-6 gap-y-2">
                  <div>
                    <div className="text-2xl font-mono font-bold text-cyan-400">{formatBRL(empNovoVlr185)}</div>
                    <div className="text-[10px] text-muted-foreground">valor liberado na conta</div>
                  </div>
                  <div>
                    <div className="text-xl font-mono font-bold text-orange-400">{formatBRL(margemLivreParaEmpNovo)}<span className="text-xs text-muted-foreground font-normal">/mês</span></div>
                    <div className="text-[10px] text-muted-foreground">parcela (margem livre)</div>
                  </div>
                </div>
                <div className="text-[10px] text-muted-foreground mt-1.5">
                  Contrato novo INSS · taxa 1,85% em 108 meses · coef PRICE 0.02153 · parcela mín R$ 25 · valor mín R$ 500 · até 72 anos.
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-border bg-card/50 p-2 text-[10px] text-muted-foreground">
                {idadeNum !== null && idadeNum > 72
                  ? `Cliente com ${idadeNum} anos — acima do teto de 72 anos pra contrato novo 108m.`
                  : `Margem livre ${formatBRL(margemLivreParaEmpNovo)}/mês gera ${formatBRL(empNovoVlr185)} — abaixo dos mínimos do contrato novo (parcela R$ 25 / valor R$ 500).`}
              </div>
            )}

            {/* Outros destinos disponíveis pelo motor (opções secundárias) */}
            {empNovoOpcoes.length > 0 && (
              <div className="pt-2 border-t border-orange-500/20">
                <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1.5">
                  Outras opções por banco (referência):
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {empNovoOpcoes.map((b, i) => (
                    <div
                      key={b.banco}
                      className={`rounded-md border p-2 ${
                        i === 0 ? 'border-green-500/40 bg-green-500/5' : 'border-border bg-card/50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <Badge variant={i === 0 ? 'success' : 'outline'} className="text-[9px] font-mono">
                          {bl(b.banco)}
                        </Badge>
                        <span className="text-[9px] font-mono text-muted-foreground">{b.taxa.toFixed(2)}%</span>
                      </div>
                      <div className="font-mono font-bold text-sm mt-1 text-foreground">{formatBRL(b.vc)}</div>
                      {b.troco > 0 && b.troco !== b.vc && (
                        <div className="text-[9px] text-green-400 font-mono">+ troco {formatBRL(b.troco)}</div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="text-[9px] text-muted-foreground mt-1.5 italic">
                  💡 BRB INCONTA é a primeira opção operacional. Os bancos acima são alternativas.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Oportunidades de TROCO — só INSS regular (LOAS não porta) */}
        {!isLoas && enquadraNovaRegra && (() => {
          const comTroco = contratos
            .filter((c) => !c.bloqueado && c.portRefin108 && c.portRefin108.port_troco > 0)
            .sort((a, b) => (b.portRefin108?.port_troco || 0) - (a.portRefin108?.port_troco || 0));
          if (comTroco.length === 0) return null;
          const trocoTotal = comTroco.reduce((s, c) => s + (c.portRefin108?.port_troco || 0), 0);
          return (
            <div className="rounded-lg border border-cyan-500/40 bg-cyan-500/5 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <RefreshCw className="size-4 text-cyan-400" />
                  <h4 className="font-bold text-sm text-cyan-400">
                    💰 Port + Refin com TROCO ({comTroco.length} contrato{comTroco.length !== 1 ? 's' : ''})
                  </h4>
                </div>
                <Badge variant="info" className="text-xs font-mono">
                  Troco total: {formatBRL(trocoTotal)}
                </Badge>
              </div>
              <div className="text-[10px] text-muted-foreground">
                Cliente já enquadra — esses contratos podem virar dinheiro mantendo a parcela atual.
                Ordenado do MAIOR troco pro menor. Tabela alta = mais comissão.
              </div>
              <div className="space-y-1.5">
                {comTroco.map((c, i) => {
                  const r = c.portRefin108!;
                  return (
                    <div
                      key={c.idx}
                      className={`rounded-md border p-2 flex items-center gap-2 flex-wrap ${
                        i === 0
                          ? 'border-cyan-500/60 bg-cyan-500/10'
                          : 'border-border bg-card/50'
                      }`}
                    >
                      <Badge variant={i === 0 ? 'info' : 'outline'} className="text-[10px] font-mono shrink-0">
                        #{i + 1}
                      </Badge>
                      <div className="flex-1 min-w-0 text-xs">
                        <div className="font-semibold truncate">
                          <span className="font-mono">{c.contrato || '—'}</span>
                          <span className="text-muted-foreground"> · {c.bancoOrigem}</span>
                          {c.taxaOrig > 0 && <span className="text-yellow-400 ml-1">@ {c.taxaOrig.toFixed(2)}%</span>}
                          <span className="text-cyan-400 ml-1">→ {bl(r.banco)} @ {r.taxa.toFixed(2)}% / 108m</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          Saldo {formatBRL(c.saldo)} · parcela {formatBRL(c.parcela)} mantida ·
                          novo VC {formatBRL(r.port_vc)}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[9px] uppercase text-muted-foreground">Troco</div>
                        <div className="text-base font-mono font-bold text-cyan-400">
                          {formatBRL(r.port_troco)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Tabela de contratos pra contexto */}
        {contratos.length > 0 && (
          <details className={!enquadraNovaRegra ? '' : 'pt-2'} open>
            <summary className="cursor-pointer text-xs font-semibold py-1.5 hover:bg-muted/30 rounded px-2">
              📋 Ver todos os contratos ({contratos.length})
              <span className="text-[10px] text-muted-foreground font-normal ml-2">
                — clique no saldo pra editar e recalcular · ordenado por {enquadraNovaRegra ? 'troco' : 'redução'} desc
              </span>
            </summary>
            <div className="mt-1 overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="text-left p-2 font-semibold">Contrato</th>
                    <th className="text-left p-2 font-semibold">Origem</th>
                    <th className="text-right p-2 font-semibold">Taxa atual</th>
                    <th className="text-right p-2 font-semibold">Parcela</th>
                    <th className="text-right p-2 font-semibold">Saldo (editável)</th>
                    <th className="text-center p-2 font-semibold">Pagas/Prazo</th>
                    <th className="text-left p-2 font-semibold">→ Port+Refin 108m</th>
                    <th className="text-right p-2 font-semibold">Refin (reduz parc.)</th>
                    <th className="text-right p-2 font-semibold">Port (com troco)</th>
                    <th className="text-center p-2 font-semibold">Resolve?</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[...contratos].sort((a, b) => {
                    // Bloqueados vão pro fim
                    if (a.bloqueado && !b.bloqueado) return 1;
                    if (!a.bloqueado && b.bloqueado) return -1;
                    // Sem portRefin108 vai pro fim
                    if (!a.portRefin108 && b.portRefin108) return 1;
                    if (a.portRefin108 && !b.portRefin108) return -1;
                    if (!a.portRefin108 || !b.portRefin108) return 0;
                    // Enquadrado: por troco desc. Não enquadrado: por redução desc.
                    if (enquadraNovaRegra) return b.portRefin108.port_troco - a.portRefin108.port_troco;
                    return b.portRefin108.refin_reducao - a.portRefin108.refin_reducao;
                  }).map((c) => {
                    const melhorDest = c.destinos && c.destinos[0];
                    const saldoEditado = saldoOverrides[c.idx] !== undefined;
                    return (
                      <tr key={c.idx} className={c.bloqueado ? 'opacity-60' : c.resolveExcedente ? 'bg-green-500/5' : ''}>
                        <td className="p-2 font-mono">{c.contrato || '—'}</td>
                        <td className="p-2"><Badge variant="muted" className="text-[10px] font-mono">{c.codOrigem || '?'}</Badge></td>
                        <td className="p-2 text-right font-mono">
                          {c.taxaOrig > 0 ? (
                            <span className="text-yellow-400">{c.taxaOrig.toFixed(2)}%</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-2 text-right font-mono">{formatBRL(c.parcela)}</td>
                        <td className="p-2 text-right font-mono">
                          <div className="flex items-center gap-1 justify-end">
                            <Input
                              type="number"
                              step="100"
                              defaultValue={c.saldo}
                              onBlur={(e) => {
                                const v = parseFloat(e.target.value) || 0;
                                if (v !== c.saldo && v > 0) ajustarSaldo(c.idx, v);
                              }}
                              className={`h-7 text-xs font-mono text-right w-28 ${saldoEditado ? 'border-yellow-500/60 bg-yellow-500/5' : ''}`}
                            />
                            {saldoEditado && (
                              <button
                                onClick={() => resetSaldo(c.idx)}
                                className="text-[10px] text-muted-foreground hover:text-foreground"
                                title="Resetar pro saldo original"
                              >
                                ↺
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="p-2 text-center font-mono">{c.prazos}</td>
                        <td className="p-2">
                          {c.portRefin108 ? (
                            <div className="flex flex-col gap-0.5">
                              <Badge variant="success" className="text-[10px] font-mono w-fit">
                                {bl(c.portRefin108.banco)} · {c.portRefin108.taxa.toFixed(2)}%
                              </Badge>
                              <span className="text-[9px] text-muted-foreground font-mono">
                                108m · de {c.taxaOrig.toFixed(2)}% → {c.portRefin108.taxa.toFixed(2)}%
                              </span>
                            </div>
                          ) : melhorDest && c.taxaOrig > 0 ? (
                            <span className="text-[10px] text-muted-foreground">
                              taxa {c.taxaOrig.toFixed(2)}% ≤ destinos
                            </span>
                          ) : (
                            <span className="text-red-400 text-[10px]">{c.motivoBloqueio?.slice(0, 40) || '—'}</span>
                          )}
                        </td>
                        <td className="p-2 text-right">
                          {c.portRefin108 ? (
                            <div className="flex flex-col items-end gap-0.5">
                              <span className="font-mono text-green-400 text-xs">{formatBRL(c.portRefin108.refin_novaParc)}</span>
                              <span className="text-[9px] text-green-400/70 font-mono">
                                ↓ {formatBRL(c.portRefin108.refin_reducao)}/mês
                              </span>
                            </div>
                          ) : (<span className="text-muted-foreground">—</span>)}
                        </td>
                        <td className="p-2 text-right">
                          {c.portRefin108 && c.portRefin108.port_troco > 0 ? (
                            <div className="flex flex-col items-end gap-0.5">
                              <span className="font-mono text-cyan-400 text-xs">{formatBRL(c.portRefin108.port_troco)}</span>
                              <span className="text-[9px] text-muted-foreground font-mono">
                                parc R$ {formatBRL(c.portRefin108.port_novaParc)}
                              </span>
                            </div>
                          ) : (<span className="text-muted-foreground">—</span>)}
                        </td>
                        <td className="p-2 text-center">
                          {enquadraNovaRegra ? (
                            <span className="text-muted-foreground text-[10px]">—</span>
                          ) : c.resolveExcedente ? (
                            <Badge variant="success" className="text-[10px]">✓ SIM</Badge>
                          ) : (
                            <Badge variant="muted" className="text-[10px]">não</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {Object.keys(saldoOverrides).length > 0 && (
              <div className="text-[10px] text-yellow-400 mt-1 px-2">
                ⚠ {Object.keys(saldoOverrides).length} saldo(s) editado(s) manualmente —
                <button onClick={() => setSaldoOverrides({})} className="ml-1 underline hover:text-foreground">
                  resetar tudo
                </button>
              </div>
            )}
          </details>
        )}
      </CardContent>
    </Card>
  );
}
