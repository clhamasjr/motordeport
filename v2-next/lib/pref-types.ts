// ════════════════════════════════════════════════════════════════
// lib/pref-types.ts — Tipos do módulo PREFEITURAS (espelha tabelas pref_*)
// ════════════════════════════════════════════════════════════════

export type TipoConvenioPref =
  | 'prefeitura'
  | 'instituto_previdencia'
  | 'cartao_beneficio';

export type RegimeAtendido = 'RPPS' | 'RGPS' | 'AMBOS';

/** 1 linha de pref_convenios — usado tanto em listagem quanto detalhe */
export interface PrefConvenio {
  id: number;
  slug: string;
  nome: string;
  uf: string | null;
  estado_nome: string | null;
  municipio: string | null;
  tipo: TipoConvenioPref;
  sheet_origem: string | null;
  ativo?: boolean;
  atualizado_em?: string | null;
}

/** Operações que o banco realiza no convênio */
export interface OperacoesBanco {
  novo: boolean;
  refin: boolean;
  port: boolean;
  cartao: boolean;
}

/** 1 vínculo banco × convênio (tem todas as regras operacionais) */
export interface BancoConvenioPref {
  id: number;
  banco_id: number;
  banco_slug: string | null;
  banco_nome: string | null;
  suspenso: boolean;
  operacoes: OperacoesBanco;
  regime_atendido: RegimeAtendido;
  publico_ativo: boolean;
  publico_aposentado: boolean;
  publico_pensionista: boolean;
  margem_utilizavel: number | null;
  idade_min: number | null;
  idade_max: number | null;
  taxa_minima_port: number | null;
  prazo_max_meses: number | null;
  valor_minimo_op: number | null;
  valor_maximo_op: number | null;
  data_corte: string | null;
  valor_minimo: string | null;
  qtd_contratos: string | null;
  observacoes_admin: string | null;
  criado_por_admin: boolean;
  atributos: Record<string, string>;
  atributos_brutos: Array<{ label: string; valor: string; secao: string }>;
}

/** Resposta de /api/pref action:listConvenios */
export interface ListConveniosResponse {
  ok: boolean;
  total: number;
  grupos?: Array<{ uf: string; estado_nome: string | null; convenios: PrefConvenio[] }>;
  convenios: PrefConvenio[];
  error?: string;
}

/** Resposta de /api/pref action:getConvenio */
export interface GetConvenioResponse {
  ok: boolean;
  convenio: PrefConvenio;
  bancos: BancoConvenioPref[];
  error?: string;
}

/** Resposta de /api/pref action:listBancos */
export interface ListBancosResponse {
  ok: boolean;
  total: number;
  bancos: Array<{ id: number; slug: string; nome: string; observacoes?: string | null }>;
  error?: string;
}

/** Body do upsertBancoConvenio (admin) */
export interface UpsertBancoConvenioPayload {
  id?: number;
  banco_id: number;
  convenio_id: number;
  suspenso?: boolean;
  opera_novo?: boolean;
  opera_refin?: boolean;
  opera_port?: boolean;
  opera_cartao?: boolean;
  regime_atendido?: RegimeAtendido;
  publico_ativo?: boolean;
  publico_aposentado?: boolean;
  publico_pensionista?: boolean;
  margem_utilizavel?: string | number | null;
  taxa_minima_port?: string | number | null;
  idade_min?: number | null;
  idade_max?: number | null;
  prazo_max_meses?: number | null;
  valor_minimo_op?: number | null;
  valor_maximo_op?: number | null;
  data_corte?: string | null;
  qtd_contratos?: string | null;
  observacoes_admin?: string | null;
}

// ── Helpers de label/icone por tipo ──
export function tipoIcone(t: TipoConvenioPref): string {
  if (t === 'prefeitura') return '🏛️';
  if (t === 'instituto_previdencia') return '📋';
  if (t === 'cartao_beneficio') return '💳';
  return '🏙️';
}

export function tipoLabel(t: TipoConvenioPref): string {
  if (t === 'prefeitura') return 'Prefeitura';
  if (t === 'instituto_previdencia') return 'Instituto de Previdência';
  if (t === 'cartao_beneficio') return 'Cartão Benefício';
  return 'Convênio';
}

export function regimeLabel(r: RegimeAtendido): string {
  if (r === 'RPPS') return 'RPPS — Estatutário (instituto próprio)';
  if (r === 'RGPS') return 'RGPS — CLT/comissionado (INSS)';
  return 'Ambos os regimes';
}
