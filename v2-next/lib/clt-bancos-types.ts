// Tipos do Catálogo de Bancos CLT (espelha tabela clt_bancos no Supabase)
export type ApiStatus = 'ativa' | 'manual' | 'manutencao';

export interface Banco {
  id: number;
  slug: string;
  nome: string;
  ativo: boolean;
  api_status: ApiStatus;
  exige_selfie: boolean;
  exige_termo: boolean;
  como_funciona?: string;
  observacoes?: string;
}

export interface Convenio {
  id: number;
  nome: string;
}

export interface BancoConvenio {
  id: number;
  banco_id: number;
  convenio_id: number;
  opera_novo: boolean;
  opera_refin: boolean;
  opera_port: boolean;
  opera_cartao: boolean;
  idade_min?: number | null;
  idade_max?: number | null;
  margem_minima?: number | null;
  valor_minimo?: number | null;
  valor_maximo?: number | null;
  prazo_min?: number | null;
  prazo_max?: number | null;
  taxa_minima?: number | null;
  taxa_maxima?: number | null;
  tempo_admissao_min_meses?: number | null;
  documentos_obrigatorios?: string[] | null;
  observacoes?: string | null;
}

export interface CatalogoResponse {
  success: boolean;
  bancos: Banco[];
  convenios: Convenio[];
  vinculos: BancoConvenio[];
  error?: string;
}
