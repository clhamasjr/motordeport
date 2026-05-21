'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useGestaoDashboard } from '@/hooks/use-inss-gestao';
import { formatBRL, formatCpf, formatDateBR } from '@/lib/utils';
import { Activity, Users, AlertCircle, TrendingUp, Eye, Wifi, WifiOff } from 'lucide-react';

export default function GestaoInssPage() {
  const { data, isLoading, error } = useGestaoDashboard();

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-5">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-aurora flex items-center justify-center ring-1 ring-primary/30 shadow-[0_0_28px_-6px_hsl(var(--accent)/.7)] flex-shrink-0">
          <Activity className="size-6 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="text-gradient">INSS</span> · Painel Operacional
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Usuários ativos, consultas do dia, produção, audit log, chats Sofia. Atualiza a cada 60s.
          </p>
        </div>
      </div>

      {isLoading && <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}</div>}

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 flex items-center gap-2 text-destructive">
            <AlertCircle className="size-4" /> {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Kpi label="Usuários ativos" value={(data.users || []).filter((u) => u.online).length} cor="text-green-400" />
            <Kpi label="Consultas hoje" value={data.consultasHoje || 0} cor="text-cyan-400" />
            <Kpi label="Volume digitado" value={formatBRL(data.digitacao?.totalValor || 0)} cor="text-yellow-400" isText />
            <Kpi label="Chats Sofia" value={data.chats?.length || 0} cor="text-purple-400" />
          </div>

          {/* Produção por status */}
          {data.digitacao?.perStatus && Object.keys(data.digitacao.perStatus).length > 0 && (
            <Card>
              <CardContent className="p-3">
                <div className="text-[10px] uppercase tracking-wider font-bold mb-2 text-yellow-400">
                  Produção (digitações por status)
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(data.digitacao.perStatus).map(([k, v]) => (
                    <Badge key={k} variant="muted" className="text-xs px-3 py-1">
                      {k}: <strong className="ml-1 font-mono">{v}</strong>
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
                        <th className="text-center p-2 font-semibold">Consultas hoje</th>
                        <th className="text-center p-2 font-semibold">Digitações</th>
                        <th className="text-right p-2 font-semibold">Volume</th>
                        <th className="text-left p-2 font-semibold">Última sessão</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.users.map((u) => (
                        <tr key={u.id} className="hover:bg-muted/20">
                          <td className="p-2">
                            {u.online ? (
                              <Badge variant="success" className="text-[9px]"><Wifi className="size-3" /> online</Badge>
                            ) : (
                              <Badge variant="muted" className="text-[9px]"><WifiOff className="size-3" /> off</Badge>
                            )}
                          </td>
                          <td className="p-2 font-medium">{u.name}</td>
                          <td className="p-2 font-mono text-[10px]">{u.user}</td>
                          <td className="p-2"><Badge variant={u.role === 'admin' ? 'destructive' : u.role === 'gestor' ? 'warning' : 'info'} className="text-[9px]">{u.role}</Badge></td>
                          <td className="p-2 text-center font-mono">{u.consultasHoje || 0}</td>
                          <td className="p-2 text-center font-mono">{u.digitacao.total || 0}</td>
                          <td className="p-2 text-right font-mono text-yellow-400">{formatBRL(u.digitacao.valor || 0)}</td>
                          <td className="p-2 text-[10px] text-muted-foreground">{u.lastSession ? formatDateBR(u.lastSession) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Consultas recentes */}
          {data.consultas && data.consultas.length > 0 && (
            <Card>
              <CardContent className="p-0">
                <div className="p-3 border-b border-border">
                  <div className="text-[10px] uppercase tracking-wider font-bold text-cyan-400 flex items-center gap-1">
                    <Eye className="size-3" /> Consultas recentes
                  </div>
                </div>
                <div className="overflow-x-auto max-h-96">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/30 sticky top-0">
                      <tr>
                        <th className="text-left p-2 font-semibold">Quando</th>
                        <th className="text-left p-2 font-semibold">Tipo</th>
                        <th className="text-left p-2 font-semibold">CPF</th>
                        <th className="text-left p-2 font-semibold">Nome</th>
                        <th className="text-left p-2 font-semibold">Fonte</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.consultas.map((c) => (
                        <tr key={c.id} className="hover:bg-muted/20">
                          <td className="p-2 text-[10px] text-muted-foreground">{formatDateBR(c.created_at)}</td>
                          <td className="p-2"><Badge variant="muted" className="text-[10px]">{c.tipo}</Badge></td>
                          <td className="p-2 font-mono text-[10px]">{c.cpf ? formatCpf(c.cpf) : '—'}</td>
                          <td className="p-2">{c.nome || '—'}</td>
                          <td className="p-2 text-[10px]"><Badge variant="info" className="text-[9px]">{c.fonte}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Audit log */}
          {data.audit && data.audit.length > 0 && (
            <Card>
              <CardContent className="p-0">
                <div className="p-3 border-b border-border">
                  <div className="text-[10px] uppercase tracking-wider font-bold text-orange-400 flex items-center gap-1">
                    <TrendingUp className="size-3" /> Audit log
                  </div>
                </div>
                <div className="overflow-x-auto max-h-96">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/30 sticky top-0">
                      <tr>
                        <th className="text-left p-2 font-semibold">Quando</th>
                        <th className="text-left p-2 font-semibold">Ação</th>
                        <th className="text-left p-2 font-semibold">User ID</th>
                        <th className="text-left p-2 font-semibold">Detalhes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.audit.slice(0, 30).map((a) => (
                        <tr key={a.id} className="hover:bg-muted/20">
                          <td className="p-2 text-[10px] text-muted-foreground">{formatDateBR(a.created_at)}</td>
                          <td className="p-2"><Badge variant="muted" className="text-[10px]">{a.action}</Badge></td>
                          <td className="p-2 font-mono text-[10px]">{a.user_id}</td>
                          <td className="p-2 text-[10px] font-mono truncate max-w-md">
                            {typeof a.details === 'object' ? JSON.stringify(a.details).slice(0, 100) : String(a.details).slice(0, 100)}
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

function Kpi({ label, value, cor, isText }: { label: string; value: number | string; cor: string; isText?: boolean }) {
  return (
    <Card variant="gradient" interactive>
      <CardContent className="p-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
        <div className={`${isText ? 'text-base' : 'text-3xl'} font-mono font-bold mt-1.5 ${cor}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
