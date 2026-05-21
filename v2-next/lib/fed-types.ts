// ════════════════════════════════════════════════════════════════
// lib/fed-types.ts — Tipos do módulo FEDERAL (espelha tabelas fed_*)
// Backend: api/fed.js (V1) — actions listConvenios, getConvenio,
// listBancos, analisarHolerite, listAnalises, getAnalise.
// ════════════════════════════════════════════════════════════════

export type CategoriaFed = 'civil' | 'militar';

export type OrgaoFed =
  | 'SIAPE'
  | 'SERPRO'
  | 'MARINHA'
  | 'EXERCITO'
  | 'AERONAUTICA';

export type OperacaoTipoFed =
  | 'completo'
  | 'novo_refin'
  | 'portabilidade'
  | 'cartao_consignado'
  | 'cartao_beneficio';

/** 1 linha de fed_convenios */
export interface FedConvenio {
  id: number;
  slug: string;
  nome: string;
  categoria: CategoriaFed | null;
  orgao: OrgaoFed | string | null;
  operacao_tipo: OperacaoTipoFed | string | null;
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

/** 1 vínculo banco × convênio (todas as regras operacionais) */
export interface FedBancoConvenio {
  id: number;
  banco_id: number;
  banco_slug: string | null;
  banco_nome: string | null;
  suspenso: boolean;
  operacoes: OperacoesBanco;
  margem_utilizavel: number | null;
  idade_min: number | null;
  idade_max: number | null;
  taxa_minima_port: number | null;
  data_corte: string | null;
  valor_minimo: string | null;
  qtd_contratos: string | null;
  atributos: Record<string, string>;
  atributos_brutos: Array<{ label: string; valor: string; secao: string }>;
}

/** Banco simples (cadastro fed_bancos) */
export interface FedBanco {
  id: number;
  slug: string;
  nome: string;
  observacoes?: string | null;
}

// ════════════════════════════════════════════════════════════════
// Responses do /api/fed
// ════════════════════════════════════════════════════════════════

export interface ListConveniosResponse {
  ok: boolean;
  total: number;
  grupos?: Array<{ categoria: CategoriaFed | string; convenios: FedConvenio[] }>;
  convenios: FedConvenio[];
  error?: string;
}

export interface GetConvenioResponse {
  ok: boolean;
  convenio: FedConvenio;
  bancos: FedBancoConvenio[];
  error?: string;
}

export interface ListBancosResponse {
  ok: boolean;
  total: number;
  bancos: FedBanco[];
  error?: string;
}

// ════════════════════════════════════════════════════════════════
// Análise de contracheque + simulação de port
// ════════════════════════════════════════════════════════════════

export interface DescontoConsignado {
  descricao: string;
  valor: number;
}

/** Contrato extraído do extrato de consignação */
export interface ContratoAtivo {
  numero: string;
  rubrica_codigo?: string;
  rubrica_descricao?: string;
  banco_extrato: string;
  tipo: 'emprestimo' | 'rmc' | 'rcc';
  parcela_valor: number;
  parcelas_pagas: number;
  parcelas_totais: number;
  parcelas_restantes: number;
  saldo_estimado: number;
  inicio?: string | null;
  fim?: string | null;
}

export interface ExtratoInfo {
  cpf?: string | null;
  matricula?: string | null;
  nome?: string | null;
  orgao?: string | null;
  data_emissao?: string | null;
  margem_total_facultativa_disponivel?: number | null;
  margem_total_cartao_disponivel?: number | null;
  margem_total_cb_disponivel?: number | null;
}

/** Dados extraídos do contracheque (e complementados pelo extrato) */
export interface DadosExtraidos {
  nome: string | null;
  cpf: string | null;
  matricula: string | null;
  orgao: string | null;
  orgao_federal: OrgaoFed | string | null;
  categoria_servidor: CategoriaFed | string | null;
  convenio_sugerido: string | null;
  cargo: string | null;
  patente: string | null;
  situacao_militar: string | null;
  prec_cp: string | null;
  data_nascimento: string | null;
  idade: number | null;
  competencia: string | null;
  salario_bruto: number | null;
  salario_liquido: number | null;
  total_descontos: number | null;
  margem_consignavel_disponivel: number | null;
  margem_cartao_disponivel: number | null;
  descontos_consignados?: DescontoConsignado[];
  observacoes?: string | null;
  // Extrato (quando enviado)
  extrato_arquivo_nome?: string | null;
  extrato_info?: ExtratoInfo | null;
  contratos_ativos?: ContratoAtivo[];
  extrato_erro?: string | null;
}

/** 1 banco que atende este servidor (resultado do cruzamento) */
export interface BancoAtende {
  banco_id: number;
  banco_slug: string | null;
  banco_nome: string | null;
  regras: {
    suspenso: boolean;
    opera_novo: boolean;
    opera_refin: boolean;
    opera_port: boolean;
    opera_cartao: boolean;
    idade_min: number | null;
    idade_max: number | null;
    margem_utilizavel: number | null;
    taxa_minima_port: number | null;
    atributos: Record<string, string>;
  };
  observacoes: string[];
}

export interface BancoNaoAtende {
  banco_id: number;
  banco_slug: string | null;
  banco_nome: string | null;
  motivo: string;
  regras?: BancoAtende['regras'];
}

/** Sugestão de banco para portar um contrato específico */
export interface SugestaoPort {
  banco_id: number;
  banco_slug: string | null;
  banco_nome: string;
  taxa_minima_port: number | null;
  parcela_port_pura: number | null;
  economia_port_pura: number | null;
  novo_pv_refin: number | null;
  troco_estimado: number | null;
  motivos_bloqueio: string[];
  atende: boolean;
}

/** Simulação completa de port pra 1 contrato */
export interface SimulacaoContrato {
  contrato: {
    numero: string;
    banco_origem: string;
    parcela_valor: number;
    parcelas_pagas: number;
    parcelas_totais: number;
    parcelas_restantes: number;
    saldo_estimado_sem_juros: number;
    saldo_devedor_estimado: number | null;
    taxa_origem_assumida: number;
    fim?: string | null;
  };
  sugestoes_top: SugestaoPort[];
  total_sugestoes: number;
  qtd_atendem: number;
}

/** Resposta de /api/fed action:analisarHolerite */
export interface AnaliseHoleriteResponse {
  ok: boolean;
  analise_id?: string;
  dados_extraidos: DadosExtraidos;
  convenio: FedConvenio | null;
  convenio_confianca: 'alta' | 'media' | 'baixa' | 'usuario' | string;
  bancos_atendem: BancoAtende[];
  bancos_nao_atendem: BancoNaoAtende[];
  simulacao_port: SimulacaoContrato[];
  duracao_ms?: number;
  error?: string;
}

// ════════════════════════════════════════════════════════════════
// Helpers de label/ícone
// ════════════════════════════════════════════════════════════════

export function orgaoIcone(o: string | null | undefined): string {
  if (o === 'SIAPE') return '🏛️';
  if (o === 'SERPRO') return '💻';
  if (o === 'MARINHA') return '⚓';
  if (o === 'EXERCITO') return '🪖';
  if (o === 'AERONAUTICA') return '✈️';
  return '🇧🇷';
}

export function categoriaLabel(c: string | null | undefined): string {
  if (c === 'civil') return '👔 Civil (SIAPE / SERPRO)';
  if (c === 'militar') return '🪖 Militar (Forças Armadas)';
  return c || 'Outro';
}

export function operacaoTipoLabel(t: string | null | undefined): string {
  if (t === 'novo_refin') return 'Novo / Refin';
  if (t === 'portabilidade') return 'Portabilidade';
  if (t === 'cartao_consignado') return 'Cartão Consignado';
  if (t === 'cartao_beneficio') return 'Cartão Benefício';
  if (t === 'completo') return 'Completo';
  return t || '';
}

export function tipoContratoIcone(t: ContratoAtivo['tipo']): string {
  if (t === 'emprestimo') return '💰';
  if (t === 'rmc') return '💳';
  if (t === 'rcc') return '🎟️';
  return '❓';
}

export function tipoContratoLabel(t: ContratoAtivo['tipo']): string {
  if (t === 'emprestimo') return 'Empréstimo';
  if (t === 'rmc') return 'RMC';
  if (t === 'rcc') return 'RCC';
  return t;
}

export function confiancaLabel(c: string | null | undefined): string {
  if (c === 'alta') return 'Alta';
  if (c === 'media') return 'Média';
  if (c === 'baixa') return 'Baixa';
  if (c === 'usuario') return 'Definida pelo usuário';
  return c || '—';
}
