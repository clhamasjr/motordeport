'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useCltGestaoDashboard } from '@/hooks/use-clt-gestao';
import { formatBRL, formatCpf, formatDateBR } from '@/lib/utils';
import { Activity, Users, AlertCircle, MessageSquare, Wifi, WifiOff, Building2 } from 'lucide-react';

export default function PainelOperacionalCltPage() {
  const { data, isLoading, error } = useCltGestaoDashboard();

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Activity className="size-6 text-orange-400" />
          CLT — Painel Operacional
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Painel admin/gestor: usuários ativos, consultas CLT do dia, propostas digitadas, conversas
          do agente IA. Atualiza a cada 60s.
        </p>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      )}

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 flex items-center gap-2 text-destructive">
            <AlertCircle className="size-4" /> {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* KPIs principais */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Kpi
              label="Usuários online"
              value={data.onlineCount || 0}
              cor="text-green-400"
            />
            <Kpi
              label="Consultas hoje"
              value={data.consultas?.hoje || 0}
              cor="text-cyan-400"
              hint={data.consultas?.emAndamento ? `${data.consultas.emAndamento} em andamento` : ''}
            />
            <Kpi
              label="Volume digitado"
              value={formatBRL(data.propostas?.totalValor || 0)}
              cor="text-yellow-400"
              isText
              hint={`${data.propostas?.total || 0} propostas`}
            />
            <Kpi
              label="Conversas IA"
              value={data.conversas?.abertas || 0}
              cor="text-purple-400"
              hint={data.conversas?.pausadas ? `${data.conversas.pausadas} pausadas` : 'abertas'}
            />
          </div>

          {/* Propostas por status */}
          {data.propostas?.perStatus && Object.keys(data.propostas.perStatus).length > 0 && (
            <Card>
              <CardContent className="p-3">
                <div className="text-[10px] uppercase tracking-wider font-bold mb-2 text-yellow-400">
                  Propostas por status (últimas 500)
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(data.propostas.perStatus).map(([k, v]) => (
                    <Badge key={k} variant="muted" className="text-xs px-3 py-1">
                      {k || '?'}: <strong className="ml-1 font-mono">{v}</strong>
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Usuários */}
          {data.users && data.users.length > 0 && (
            <Card>
              <CardContent className="p-0">
                <div className="p-3 border-b border-border">
                  <div className="text-[10px] uppercase tracking-wider font-bold text-cyan-400 flex items-center gap-1">
                    <Users className="size-3" /> Usuários ({data.users.length})
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/30">
                      <tr>
                        <th className="text-left p-2 font-semibold">Status</th>
                        <th className="text-left p-2 font-semibold">Nome</th>
                        <th className="text-left p-2 font-semibold">Login</th>
                        <th className="text-left p-2 font-semibold">Role</th>
                        <th className="text-right p-2 font-semibold">Consultas hoje</th>
                        <th className="text-right p-2 font-semibold">Propostas (500)</th>
                        <th className="text-right p-2 font-semibold">Volume</th>
                        <th className="text-left p-2 font-semibold">IP</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.users
                        .slice()
                        .sort((a, b) => Number(b.online) - Number(a.online) || b.propostas - a.propostas)
                        .map((u) => (
                          <tr key={u.id} className="hover:bg-muted/20">
                            <td className="p-2">
                              {u.online ? (
                                <span className="inline-flex items-center gap-1 text-green-400 text-[10px]">
                                  <Wifi className="size-3" /> ON
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-muted-foreground/60 text-[10px]">
                                  <WifiOff className="size-3" /> off
                                </span>
                              )}
                            </td>
                            <td className="p-2 font-medium">{u.name}</td>
                            <td className="p-2 font-mono text-[10px] text-muted-foreground">@{u.user}</td>
                            <td className="p-2">
                              <Badge variant={u.role === 'admin' ? 'success' : u.role === 'gestor' ? 'info' : 'muted'} className="text-[9px]">
                                {u.role}
                              </Badge>
                            </td>
                            <td className="p-2 text-right font-mono">{u.consultasHoje}</td>
                            <td className="p-2 text-right font-mono">{u.propostas}</td>
                            <td className="p-2 text-right font-mono text-yellow-400">
                              {u.propostasValor > 0 ? formatBRL(u.propostasValor) : '-'}
                            </td>
                            <td className="p-2 font-mono text-[10px] text-muted-foreground">{u.lastIp || '-'}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Consultas recentes */}
          {data.consultas?.recentes && data.consultas.recentes.length > 0 && (
            <Card>
              <CardContent className="p-0">
                <div className="p-3 border-b border-border">
                  <div className="text-[10px] uppercase tracking-wider font-bold text-cyan-400 flex items-center gap-1">
                    <Building2 className="size-3" /> Consultas recentes ({data.consultas.recentes.length})
                  </div>
                </div>
                <div className="overflow-x-auto max-h-[400px]">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/30 sticky top-0">
                      <tr>
                        <th className="text-left p-2 font-semibold">Status</th>
                        <th className="text-left p-2 font-semibold">CPF</th>
                        <th className="text-left p-2 font-semibold">Nome</th>
                        <th className="text-left p-2 font-semibold">Operador</th>
                        <th className="text-left p-2 font-semibold">Iniciada</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.consultas.recentes.map((c) => (
                        <tr key={c.id} className="hover:bg-muted/20">
                          <td className="p-2">
                            {c.status_geral === 'concluido' ? (
                              <Badge variant="success" className="text-[9px]">OK</Badge>
                            ) : (
                              <Badge variant="info" className="text-[9px]">⏳</Badge>
                            )}
                          </td>
                          <td className="p-2 font-mono text-[10px]">{formatCpf(c.cpf)}</td>
                          <td className="p-2">{c.nome_manual || '(sem nome)'}</td>
                          <td className="p-2 text-[10px] text-muted-foreground">
                            👤 {c.userName || '?'}
                          </td>
                          <td className="p-2 text-[10px] text-muted-foreground">
                            {formatDateBR(c.iniciado_em)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Conversas IA recentes */}
          {data.conversas?.recentes && data.conversas.recentes.length > 0 && (
            <Card>
              <CardContent className="p-0">
                <div className="p-3 border-b border-border">
                  <div className="text-[10px] uppercase tracking-wider font-bold text-purple-400 flex items-center gap-1">
                    <MessageSquare className="size-3" /> Conversas IA abertas (top {data.conversas.recentes.length})
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/30">
                      <tr>
                        <th className="text-left p-2 font-semibold">Telefone</th>
                        <th className="text-left p-2 font-semibold">Nome</th>
                        <th className="text-left p-2 font-semibold">Etapa</th>
                        <th className="text-left p-2 font-semibold">Banco</th>
                        <th className="text-left p-2 font-semibold">Última msg</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.conversas.recentes.map((c) => (
                        <tr key={c.id} className="hover:bg-muted/20">
                          <td className="p-2 font-mono text-[10px]">{c.telefone}</td>
                          <td className="p-2">{c.nome || '(sem nome)'}</td>
                          <td className="p-2">
                            <Badge variant={c.pausada_por_humano ? 'warning' : 'muted'} className="text-[9px]">
                              {c.pausada_por_humano ? '⏸ pausada' : c.etapa || '?'}
                            </Badge>
                          </td>
                          <td className="p-2 text-[10px]">{c.banco_escolhido || '-'}</td>
                          <td className="p-2 text-[10px] text-muted-foreground">
                            {c.last_message_at ? formatDateBR(c.last_message_at) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({
  label, value, cor, isText, hint,
}: {
  label: string;
  value: number | string;
  cor: string;
  isText?: boolean;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
        <div className={`${isText ? 'text-base' : 'text-2xl'} font-mono font-bold mt-1 ${cor}`}>{value}</div>
        {hint && <div className="text-[9px] text-muted-foreground/70 mt-0.5">{hint}</div>}
      </CardContent>
    </Card>
  );
}
