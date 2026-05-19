// ════════════════════════════════════════════════════════════════
// lib/gov-types.ts — Tipos do modulo Governos
// Espelha as tabelas gov_bancos, gov_convenios, gov_banco_convenio,
// gov_holerite_analises no Supabase (api/gov.js no V1).
// ════════════════════════════════════════════════════════════════

export interface Banco {
  id: number;
  slug: string;
  nome: string;
  ativo?: boolean;
  observacoes?: string | null;
}

export interface Convenio {
  id: number;
  slug: string;
  nome: string;
  uf: string | null;
  estado_nome: string | null;
  sheet_origem?: string | null;
  ativo?: boolean;
  atualizado_em?: string | null;
}

export interface Operacoes {
  novo: boolean;
  refin: boolean;
  port: boolean;
  cartao: boolean;
}

export interface AtributoBruto {
  label: string;
  valor: string;
  secao: 'principal' | 'portabilidade' | 'cartao' | 'publico_alvo';
}

export interface BancoConvenio {
  id: number;
  banco_id: number;
  banco_slug?: string;
  banco_nome?: string;
  suspenso: boolean;
  operacoes: Operacoes;
  margem_utilizavel: number | null;
  idade_min: number | null;
  idade_max: number | null;
  taxa_minima_port: number | null;
  data_corte: string | null;
  valor_minimo: string | null;
  qtd_contratos: string | null;
  atributos: Record<string, string>;
  atributos_brutos: AtributoBruto[];
}

// /api/gov listConvenios
export interface GrupoUf {
  uf: string;
  estado_nome: string | null;
  convenios: Convenio[];
}

export interface ListConveniosResponse {
  ok: boolean;
  total: number;
  grupos: GrupoUf[];
  convenios: Convenio[];
  error?: string;
}

// /api/gov getConvenio
export interface GetConvenioResponse {
  ok: boolean;
  convenio: Convenio;
  bancos: BancoConvenio[];
  error?: string;
}

// /api/gov listBancos
export interface ListBancosResponse {
  ok: boolean;
  total: number;
  bancos: Banco[];
  error?: string;
}

// /api/gov analisarHolerite — request
export interface AnalisarHoleriteRequest {
  arquivo_base64: string;
  arquivo_nome: string;
  arquivo_tipo: string;
  convenio_slug?: string;
  convenio_id?: number;
}

// Dados extraidos pela IA do holerite
export interface DadosExtraidosHolerite {
  nome: string | null;
  cpf: string | null;
  matricula: string | null;
  orgao: string | null;
  convenio_sugerido: string | null;
  uf: string | null;
  cargo: string | null;
  data_nascimento: string | null;
  idade: number | null;
  competencia: string | null;
  salario_bruto: number | null;
  salario_liquido: number | null;
  total_descontos: number | null;
  margem_consignavel_disponivel: number | null;
  margem_cartao_disponivel: number | null;
  descontos_consignados?: Array<{ descricao: string; valor: number }>;
  observacoes?: string | null;
}

export interface BancoAtende {
  banco_id: number;
  banco_slug?: string;
  banco_nome?: string;
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
  banco_slug?: string;
  banco_nome?: string;
  motivo: string;
}

export interface AnalisarHoleriteResponse {
  ok: boolean;
  analise_id: string;
  dados_extraidos: DadosExtraidosHolerite;
  convenio: Convenio | null;
  convenio_confianca: 'alta' | 'media' | 'baixa' | 'usuario' | null;
  bancos_atendem: BancoAtende[];
  bancos_nao_atendem: BancoNaoAtende[];
  duracao_ms: number;
  error?: string;
}

// Admin (upsert/delete)
export interface UpsertBancoConvenioRequest {
  id?: number;
  banco_id: number;
  convenio_id: number;
  opera_novo: boolean;
  opera_refin: boolean;
  opera_port: boolean;
  opera_cartao: boolean;
  suspenso: boolean;
  margem_utilizavel: number | string | null;
  idade_min: number | string | null;
  idade_max: number | string | null;
  taxa_minima_port: number | string | null;
  data_corte?: string | null;
  valor_minimo?: string | null;
  qtd_contratos?: string | null;
}

export interface UpsertBancoRequest {
  id?: number;
  slug?: string;
  nome: string;
  ativo?: boolean;
  observacoes?: string;
}
