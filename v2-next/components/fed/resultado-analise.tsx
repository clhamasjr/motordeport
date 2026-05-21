'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatBRL, formatCpf, formatDateBR } from '@/lib/utils';
import {
  AnaliseHoleriteResponse,
  categoriaLabel,
  confiancaLabel,
  orgaoIcone,
} from '@/lib/fed-types';
import {
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';
import { TabelaContratos } from './tabela-contratos';
import { SimulacaoPortTable } from './simulacao-port-table';
import { EnquadramentoCard } from './enquadramento-card';

interface Props {
  r: AnaliseHoleriteResponse;
}

export function ResultadoAnalise({ r }: Props) {
  const [verNaoAtendem, setVerNaoAtendem] = useState(false);
  const d = r.dados_extraidos || ({} as AnaliseHoleriteResponse['dados_extraidos']);
  const c = r.convenio;
  const atendem = r.bancos_atendem || [];
  const naoAtendem = r.bancos_nao_atendem || [];
  const contratos = d.contratos_ativos || [];
  const simulacao = r.simulacao_port || [];

  const campos: Array<[string, string | number | null | undefined]> = [
    ['Nome', d.nome],
    ['CPF', d.cpf ? formatCpf(d.cpf) : null],
    ['Matrícula', d.matricula],
    ['Cargo', d.cargo],
    ['Órgão', d.orgao],
    ['Categoria', d.categoria_servidor],
    ['Órgão Federal', d.orgao_federal],
    ['Patente', d.patente],
    ['Situação militar', d.situacao_militar],
    ['PREC-CP', d.prec_cp],
    ['Data nasc.', d.data_nascimento ? formatDateBR(d.data_nascimento) : null],
    ['Idade', d.idade ? d.idade + ' anos' : null],
    ['Competência', d.competencia],
    ['Salário bruto', d.salario_bruto != null ? formatBRL(d.salario_bruto) : null],
    ['Salário líquido', d.salario_liquido != null ? formatBRL(d.salario_liquido) : null],
    ['Total descontos', d.total_descontos != null ? formatBRL(d.total_descontos) : null],
    [
      'Margem consig. disp.',
      d.margem_consignavel_disponivel != null
        ? formatBRL(d.margem_consignavel_disponivel)
        : null,
    ],
    [
      'Margem cartão disp.',
      d.margem_cartao_disponivel != null ? formatBRL(d.margem_cartao_disponivel) : null,
    ],
  ];

  return (
    <div className="space-y-3">
      {/* ── Dados extraídos ── */}
      <Card>
        <CardContent className="p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-3">
            📊 Dados Extraídos
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
            {campos.map(([lab, v]) =>
              v == null || v === '' ? null : (
                <div key={lab}>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {lab}
                  </div>
                  <div className="font-semibold text-foreground mt-0.5">{String(v)}</div>
                </div>
              ),
            )}
          </div>
          {d.observacoes && (
            <div className="mt-3 text-xs rounded p-2.5 bg-yellow-500/5 border-l-2 border-yellow-500">
              <b className="text-yellow-500">Obs IA:</b> {d.observacoes}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Convênio identificado ── */}
      {c ? (
        <Card>
          <CardContent className="p-4 flex justify-between flex-wrap gap-3 items-center">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Convênio identificado
              </div>
              <div className="font-bold text-base mt-0.5">
                {orgaoIcone(c.orgao)} {c.nome}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {categoriaLabel(c.categoria)}
                {c.orgao && ' · ' + c.orgao}
              </div>
            </div>
            <Badge variant="muted" className="text-[10px]">
              Confiança: {confiancaLabel(r.convenio_confianca)}
            </Badge>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-yellow-500/40">
          <CardContent className="p-3 flex items-start gap-2 text-xs text-yellow-500">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              Convênio não identificado. Selecione manualmente acima e re-analise para ver os
              bancos que atendem.
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Bancos que atendem ── */}
      {atendem.length > 0 && (
        <Card className="border-green-500/30">
          <CardContent className="p-4">
            <div className="text-sm font-bold text-green-400 mb-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              {atendem.length} banco(s) atendem este servidor
            </div>
            <div className="space-y-2">
              {atendem.map((b) => {
                const reg = b.regras;
                const ops = [
                  reg.opera_novo && 'Novo',
                  reg.opera_refin && 'Refinanciamento',
                  reg.opera_port && 'Portabilidade',
                  reg.opera_cartao && 'Cartão',
                ].filter(Boolean) as string[];
                return (
                  <div
                    key={b.banco_id}
                    className="bg-background/50 border border-border rounded-md p-3"
                  >
                    <div className="flex justify-between flex-wrap gap-2 mb-2">
                      <div className="font-bold text-sm">{b.banco_nome}</div>
                      <div className="flex gap-1 flex-wrap">
                        {ops.map((o) => (
                          <Badge key={o} variant="success" className="text-[10px]">
                            {o}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="text-[11px] text-muted-foreground space-y-0.5">
                      {(reg.idade_min || reg.idade_max) && (
                        <div>
                          Idade {reg.idade_min || '?'}-{reg.idade_max || '?'}
                        </div>
                      )}
                      {reg.margem_utilizavel != null && (
                        <div>Margem utilizável {(reg.margem_utilizavel * 100).toFixed(0)}%</div>
                      )}
                      {reg.taxa_minima_port != null && (
                        <div>
                          Taxa min. port {(reg.taxa_minima_port * 100).toFixed(2).replace('.', ',')}% a.m.
                        </div>
                      )}
                    </div>
                    {b.observacoes && b.observacoes.length > 0 && (
                      <ul className="mt-2 text-[11px] text-muted-foreground space-y-0.5 list-disc list-inside">
                        {b.observacoes.map((o, i) => (
                          <li key={i}>{o}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Bancos que NÃO atendem (colapsável) ── */}
      {naoAtendem.length > 0 && (
        <Card>
          <CardContent className="p-3">
            <button
              onClick={() => setVerNaoAtendem((v) => !v)}
              className="w-full flex items-center gap-2 text-xs font-bold text-muted-foreground hover:text-foreground"
            >
              {verNaoAtendem ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <XCircle className="w-3 h-3 text-destructive" />
              {naoAtendem.length} banco(s) NÃO atendem
              <span className="text-[10px] text-muted-foreground/70 ml-1">
                (clique pra ver motivo)
              </span>
            </button>
            {verNaoAtendem && (
              <div className="mt-3 space-y-1">
                {naoAtendem.map((b) => (
                  <div
                    key={b.banco_id}
                    className="bg-background/50 rounded p-2 text-xs flex flex-wrap gap-2"
                  >
                    <b className="text-foreground">{b.banco_nome}</b>
                    <span className="text-destructive">— {b.motivo}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Extrato (contratos + enquadramento + simulação port) ── */}
      {(contratos.length > 0 || d.extrato_erro) && (
        <TabelaContratos contratos={contratos} erro={d.extrato_erro} />
      )}
      {r.enquadramento && <EnquadramentoCard enquadramento={r.enquadramento} />}
      {simulacao.length > 0 && (
        <SimulacaoPortTable
          simulacao={simulacao}
          estourou={!!r.enquadramento?.estourou}
        />
      )}
    </div>
  );
}
