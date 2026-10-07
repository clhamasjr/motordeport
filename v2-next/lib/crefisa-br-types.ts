// ════════════════════════════════════════════════════════════════════
// lib/crefisa-br-types.ts — Crefisa "Baixa Renda" (Bolsa Família)
//
// Produto: convenioId2tech 38 / codigoConvenioCrefisa 70567.
// Backend: /api/crefisa-br
// ════════════════════════════════════════════════════════════════════

export type EtapaBR =
  | 'SEM_SESSAO'
  | 'BLOQUEADO'
  | 'NAO_ELEGIVEL'
  | 'SEM_RETORNO'
  | 'AGUARDA_OPENFINANCE'
  | 'ELEGIVEL'
  | 'COMPARTILHADO'
  | 'COM_OFERTA'
  | 'SEM_OFERTA'
  | 'DIGITADA'
  | 'ERRO';

export interface PerfilProposta {
  codigoPerfil: number;
  nomePerfil: string;
  mensagem: string;
  permiteEmissao: boolean;
  somaParcelas: number;
}

export interface RegraOperacaoBR {
  tipoSimulacao: 1 | 2;
  nome: 'NOVO' | 'REFIN';
  valorMin: number;
  valorMax: number;
  parcelaMin: number;
  parcelaMax: number;
  prazoMin: number;
  prazoMax: number;
}

export interface OpcaoId { id: number; nome: string }

export interface RegrasBR {
  convenio: string;
  convenioId2tech: number;
  codigoConvenioCrefisa: number;
  operacoes: RegraOperacaoBR[];
  /** Atalhos no formulário — NÃO é lista fechada; a Crefisa é quem valida */
  bancosSugeridos: { codigo: number; nome: string }[];
  escolaridades: OpcaoId[];
  estadosCivis: OpcaoId[];
}

export interface EnderecoCep {
  cep: string;
  logradouro: string;
  bairro: string;
  cidade: string;
  uf: string;
}

/** Referência de documento já enviado ao S3 — vai assim na proposta */
export interface DocumentoBR {
  codigoDocumento: number;
  nomeDocumento: string;
  base64: string;
  urlDocumento: string;
}

/** Resposta da action `fluxo` — diz em que ponto o CPF está e o que fazer. */
export interface FluxoBR {
  success: boolean;
  cpf: string;
  etapa: EtapaBR;
  approved: boolean;
  mensagem: string;
  proximoPasso: string;
  clienteNovo?: boolean | null;
  permiteCaptura?: boolean | null;
  perfilProposta?: PerfilProposta[];
  /** Só vem quando etapa === 'ELEGIVEL' */
  nis?: string;
  matriculaRenda?: string;
  digito?: string;
  /** Código "REVERSO" do calendário BF (sai do último dígito do NIS) */
  dataPagamento?: number | null;
  valorBeneficio?: number | null;
  descricaoBeneficio?: string | null;
  docsObrigatorios?: string;
  regras?: RegrasBR;
}

export interface StatusOpenFinanceBR {
  success: boolean;
  compartilhado: boolean;
  etapa: 'COMPARTILHADO' | 'AGUARDA_OPENFINANCE' | 'SEM_SESSAO';
  mensagem: string;
  dadosBancarios: DadoBancarioOF[];
}

export interface DadoBancarioOF {
  codigoBanco?: string | number;
  nomeBanco?: string;
  agencia?: string;
  conta?: string;
  digitoConta?: string;
  [k: string]: unknown;
}

/** Shape real da Crefisa (validado ao vivo 05/10/2026) */
export interface SimulacaoBR {
  quantidadeParcelas: number;
  valorParcela: number;
  valorSolicitado: number;
  valorCreditado: number;
  dataPrimeiroVencimento: string;
  /** Marcado pelo backend: parcela dentro da faixa R$25–159 */
  contratavel: boolean;
  [k: string]: unknown;
}

export interface ResultadoSimulacaoBR {
  etapa: 'COM_OFERTA' | 'SEM_OFERTA' | 'SEM_SESSAO';
  approved: boolean;
  success: boolean;
  mensagem: string;
  simulacoes?: SimulacaoBR[];
  dataPagamento?: number;
  valorLimiteTomado?: number | null;
  dataLiberacao?: string | null;
}

export interface StatusSessaoBR {
  success: boolean;
  sessao: 'ativa' | 'expirada' | 'sem-sessao';
  viva: boolean;
  bearerPreview?: string;
  temCookie?: boolean;
  atualizadoEm?: string | null;
  mensagem: string;
}

/** Rótulo + cor de badge por etapa, pra tela não repetir switch. */
export const ETAPA_BR_LABEL: Record<EtapaBR, { label: string; variant: 'success' | 'warning' | 'destructive' | 'info' | 'muted' }> = {
  SEM_SESSAO: { label: 'SEM SESSÃO', variant: 'destructive' },
  BLOQUEADO: { label: 'BLOQUEADO', variant: 'destructive' },
  NAO_ELEGIVEL: { label: 'NÃO ELEGÍVEL', variant: 'muted' },
  SEM_RETORNO: { label: 'SEM RETORNO', variant: 'muted' },
  AGUARDA_OPENFINANCE: { label: 'AGUARDA OPEN FINANCE', variant: 'warning' },
  ELEGIVEL: { label: 'ELEGÍVEL', variant: 'success' },
  COMPARTILHADO: { label: 'COMPARTILHADO', variant: 'success' },
  COM_OFERTA: { label: 'COM OFERTA', variant: 'success' },
  SEM_OFERTA: { label: 'SEM OFERTA', variant: 'muted' },
  DIGITADA: { label: 'DIGITADA', variant: 'success' },
  ERRO: { label: 'ERRO', variant: 'destructive' },
};
