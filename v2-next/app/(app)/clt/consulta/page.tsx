'use client';

import { useState, useEffect, useMemo } from 'react';
import { ConsultaForm } from '@/components/clt/consulta-form';
import { ConsultaCard } from '@/components/clt/consulta-card';
import { useConsultasRecentes } from '@/hooks/use-clt-fila';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCpf, formatDateBR } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

const PILHA_KEY = 'flowforce_clt_pilha_v2';

// Lê pilha persistida do localStorage (so client-side, sem quebrar SSR).
function lerPilhaPersistida(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PILHA_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

export default function ConsultaCltPage() {
  // Pilha de consultas abertas — persiste em localStorage pra sobreviver F5
  const [pilha, setPilha] = useState<string[]>([]);
  const [hidratada, setHidratada] = useState(false);
  const { data: recentes = [], isLoading } = useConsultasRecentes(50);

  // Hidrata depois do mount (evita mismatch SSR/client)
  useEffect(() => { setPilha(lerPilhaPersistida()); setHidratada(true); }, []);

  // Salva sempre que muda
  useEffect(() => {
    if (typeof window === 'undefined' || !hidratada) return;
    try { localStorage.setItem(PILHA_KEY, JSON.stringify(pilha)); } catch {}
  }, [pilha, hidratada]);

  // CRITICO: filtra a pilha persistida deixando so IDs que existem na lista
  // de recentes do backend. Isso elimina os 400/404 antes de eles acontecerem
  // (sem essa validacao, IDs antigos do localStorage faziam request inutil).
  // Enquanto recentes ainda esta carregando, NAO renderiza nada (espera).
  const recentesIds = useMemo(() => new Set(recentes.map((r) => r.id)), [recentes]);
  const pilhaValida = useMemo(() => {
    if (isLoading) return [];
    return pilha.filter((id) => recentesIds.has(id));
  }, [pilha, recentesIds, isLoading]);

  // Auto-limpa do localStorage os IDs orfaos descobertos na validacao
  useEffect(() => {
    if (isLoading || !hidratada) return;
    if (pilha.length === pilhaValida.length) return; // nada a limpar
    const orfaos = pilha.length - pilhaValida.length;
    console.info(`[pilha] removidos ${orfaos} ID(s) orfaos do localStorage`);
    setPilha(pilhaValida);
  }, [isLoading, hidratada, pilha, pilhaValida]);

  const adicionarPilha = (id: string) => {
    setPilha((prev) => (prev.includes(id) ? prev : [id, ...prev]));
  };

  const fecharDaPilha = (id: string) => {
    setPilha((prev) => prev.filter((x) => x !== id));
  };

  const limparTudo = () => {
    if (pilhaValida.length === 0) return;
    if (confirm(`Fechar todas as ${pilhaValida.length} consultas abertas?`)) setPilha([]);
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">💼 CLT — Consulta de Oportunidades</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Digite o CPF e os bancos consultam em paralelo. Cada card atualiza sozinho conforme termina.
        </p>
      </div>

      {/* Form */}
      <ConsultaForm onCreated={adicionarPilha} />

      {/* Pilha — consultas abertas (persiste em localStorage, mas so renderiza
          IDs que ainda existem no backend — evita 400 inutil em IDs antigos) */}
      {pilhaValida.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              📌 {pilhaValida.length} consulta(s) aberta(s) — fica salvo aqui mesmo se atualizar a tela
            </div>
            <Button variant="ghost" size="sm" onClick={limparTudo} className="text-xs h-7">
              Fechar todas
            </Button>
          </div>
          {pilhaValida.map((id) => (
            <ConsultaCard key={id} filaId={id} onClose={() => fecharDaPilha(id)} />
          ))}
        </div>
      )}

      {/* Recentes */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              📋 Consultas recentes
            </h2>
            <Badge variant="muted">{recentes.length}</Badge>
          </div>

          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          )}

          {!isLoading && recentes.length === 0 && (
            <div className="text-sm text-muted-foreground py-8 text-center">
              Nenhuma consulta recente. Comece digitando um CPF acima.
            </div>
          )}

          {!isLoading && recentes.length > 0 && (
            <div className="divide-y divide-border">
              {recentes.map((c) => {
                const aberto = pilha.includes(c.id);
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between py-2 gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {c.status_geral === 'concluido' ? (
                        <Badge variant="success" className="text-[10px]">OK</Badge>
                      ) : (
                        <Badge variant="info" className="text-[10px]">⏳</Badge>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate flex items-center gap-2">
                          {c.nome || '(sem nome)'}
                          {c.criada_por_nome && (
                            <span className="text-[10px] font-normal px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                              👤 {c.criada_por_nome}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          CPF {formatCpf(c.cpf)} · {formatDateBR(c.iniciado_em)}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant={aberto ? 'secondary' : 'outline'}
                      size="sm"
                      onClick={() => (aberto ? fecharDaPilha(c.id) : adicionarPilha(c.id))}
                    >
                      {aberto ? 'Fechar' : 'Abrir'}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
