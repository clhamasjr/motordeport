// ════════════════════════════════════════════════════════════════════
// Lista central de bancos CLT — TODA tela que mostra/filtra banco
// importa daqui pra ficar consistente.
// ════════════════════════════════════════════════════════════════════

import type { BancoSlug } from '@/lib/clt-types';

/**
 * Bancos OCULTOS da UI — saíram da operação ou foram substituídos.
 * Histórico (esteira/propostas antigas) ainda mostra label normalmente
 * via BANCO_LABEL completo, mas seletores/filtros novos NÃO incluem.
 */
export const BANCOS_OCULTOS: BancoSlug[] = [
  'v8_qi',       // V8 saiu da operação — substituído por Fintech do Corban (QI Tech)
  'v8_celcoin',  // idem — substituído por Fintech do Corban (Celcoin)
  'joinbank',    // QualiBanking — fora da operação atual
  'mercantil',   // tirado de produção (jun/2026)
];

/**
 * Label oficial de cada banco. Inclui TODOS (até ocultos), pra renderizar
 * historico de propostas/esteira sem aparecer slug bruto.
 */
export const BANCO_LABEL: Record<BancoSlug, string> = {
  presencabank: 'PresençaBank',
  multicorban: 'Multicorban',
  v8_qi: 'V8 (QI Tech)',
  v8_celcoin: 'V8 (Celcoin)',
  joinbank: 'QualiBanking',
  mercantil: 'Mercantil',
  handbank: 'Handbank · UY3',
  c6: 'C6 Bank',
  fintech_qi: 'Fintech do Corban (QI Tech)',
  fintech_celcoin: 'Fintech do Corban (Celcoin)',
  unno: 'Unno (ITAPEMA/QITech)',
  nossa_fintech: 'A NOSSA FINTECH',
};

/**
 * Bancos VISIVEIS — usados em seletores/filtros novos.
 * Ordem: os mais usados primeiro, conforme experiencia operacional.
 */
export const BANCOS_VISIVEIS: BancoSlug[] = [
  'fintech_qi',
  'fintech_celcoin',
  'handbank',
  'c6',
  'unno',
  'nossa_fintech',
  'presencabank',
];

/**
 * Igual a BANCOS_VISIVEIS mas em formato { slug, label } pra
 * componentes que renderizam pills/options.
 */
export const BANCOS_VISIVEIS_OPTS = BANCOS_VISIVEIS.map((slug) => ({
  slug,
  label: BANCO_LABEL[slug],
}));

/** Checa se um slug deve aparecer em selecoes novas */
export function isBancoVisivel(slug: string): boolean {
  return BANCOS_VISIVEIS.includes(slug as BancoSlug);
}
