// ════════════════════════════════════════════════════════════════════
// Tipos da Consulta CLT — espelham o que /api/clt-fila retorna no V1
// (clt-fila.js action='status' + _filaToResult no index.html V1)
// ════════════════════════════════════════════════════════════════════

export type StatusBanco =
  | 'pending'
  | 'processando'
  | 'ok'
  | 'falha'
  | 'bloqueado'
  | 'em_manutencao'
  | 'pulado'
  | 'manual_aguardando';

export type StatusGeral = 'processando' | 'concluido';

export type BancoSlug =
  | 'presencabank' | 'multicorban'
  | 'v8_qi' | 'v8_celcoin'
  | 'joinbank' | 'mercantil' | 'handbank' | 'c6'
  | 'fintech_qi' | 'fintech_celcoin';

export interface BancoState {
  status: StatusBanco;
  disponivel?: boolean;
  processando?: boolean;
  emManutencao?: boolean;
  bloqueado?: boolean;
  precisaAutorizacao?: boolean;
  requiresLiveness?: boolean;
  linkAutorizacao?: string | null;
  mensagem?: string;
  retryable?: boolean;
  consultId?: string;
  simulationId?: string;
  statusAutorizacao?: string;
  ja_autorizado?: boolean;
  atualizado_em?: string;
  dados?: {
    margemDisponivel?: number;
    margemBase?: number;
    empregador?: string | null;
    empregadorCnpj?: string | null;
    matricula?: string | null;
    renda?: number | null;
    valorLiquido?: number;
    parcelas?: number;
    valorParcela?: number;
    seguroSugerido?: number;
    workerId?: string | number | null;
  };
}

export interface ClienteData {
  cpf?: string;
  nome?: string;
  dataNascimento?: string | null;
  sexo?: 'M' | 'F' | null;
  nomeMae?: string | null;
  idade?: number | null;
  telefones?: Array<{
    ddd: string;
    numero: string;
    completo: string;
    whatsapp?: boolean;
    fonte?: string;
  }>;
  emails?: string[];
}

export interface VinculoData {
  cnpj?: string | null;
  empregador?: string | null;
  matricula?: string | null;
  dataAdmissao?: string | null;
  cnae?: string | null;
  cbo?: string | null;
  fonte?: string;
}

export interface FilaConsulta {
  id: string;
  cpf: string;
  nome_manual?: string | null;
  incluir_c6?: boolean;
  status_geral: StatusGeral;
  bancos: Partial<Record<BancoSlug, BancoState>>;
  cliente?: ClienteData;
  vinculo?: VinculoData;
  iniciado_em: string;
  concluido_em?: string | null;
  criada_por_user_id?: number;
  criada_por_nome?: string;
  parceiro_id?: number | null;
}

export interface CriarConsultaParams {
  cpf: string;
  nome?: string;
  dataNascimento?: string;
  sexo?: 'M' | 'F';
  telefone?: string;
  incluirC6?: boolean;
  origem?: 'unitaria' | 'lote';
}

export interface CriarConsultaResponse {
  success: boolean;
  id?: string;
  cpf?: string;
  mensagem?: string;
  error?: string;
}

export interface StatusFilaResponse {
  success: boolean;
  fila?: FilaConsulta;
  error?: string;
}
