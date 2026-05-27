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
  | 'fintech_qi' | 'fintech_celcoin'
  | 'unno' | 'nossa_fintech';

export interface BancoState {
  status: StatusBanco;
  disponivel?: boolean;
  processando?: boolean;
  emManutencao?: boolean;
  bloqueado?: boolean;
  precisaAutorizacao?: boolean;
  requiresLiveness?: boolean;
  // Handbank/UY3: cliente já tem contrato ativo — bloqueado por impedimento
  // (não por falta de autorização). UI mostra "Já contratado" em vez de
  // "Aguarda autorização".
  jaTemContrato?: boolean;
  // Unno: uuid do TERMO de consentimento criado via POST /auth/api/v1/terms.
  // Usado pra re-checar status do termo (PENDING → AGREED) no proximo poll/
  // re-tentar. Sem termUuid o motor cria novo termo a cada re-tentar.
  termUuid?: string;
  // Unno: expiracao do termo (geralmente 45 dias). Mostrar pro operador
  // saber se pode confiar no link.
  expiraEm?: string;
  linkAutorizacao?: string | null;
  mensagem?: string;
  retryable?: boolean;
  consultId?: string;
  simulationId?: string;
  statusAutorizacao?: string;
  ja_autorizado?: boolean;
  atualizado_em?: string;
  // Mercantil: id da operação retornado por iniciarOperacao (necessário pra
  // chamar solicitarAutorizacao via SMS)
  operacaoId?: string | null;
  // Nome retornado pelo banco em operações que precisam autorização (Mercantil
  // retorna nome do cliente antes de qualquer simulação)
  nomeCliente?: string | null;
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
