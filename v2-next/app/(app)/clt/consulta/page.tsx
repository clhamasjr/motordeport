'use client';

import { useState } from 'react';
import { ConsultaForm } from '@/components/clt/consulta-form';
import { ConsultaCard } from '@/components/clt/consulta-card';
import { useConsultasRecentes } from '@/hooks/use-clt-fila';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCpf, formatDateBR } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

export default function ConsultaCltPage() {
  // Pilha de consultas abertas (ids no estado)
  const [pilha, setPilha] = useState<string[]>([]);
  const { data: recentes = [], isLoading } = useConsultasRecentes(20);

  const adicionarPilha = (id: string) => {
    setPilha((prev) => (prev.includes(id) ? prev : [id, ...prev]));
  };

  const fecharDaPilha = (id: string) => {
    setPilha((prev) => prev.filter((x) => x !== id));
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

      {/* Pilha — consultas abertas */}
      {pilha.length > 0 && (
        <div className="space-y-4">
          {pilha.map((id) => (
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
                        <div className="font-medium text-sm truncate">{c.nome || '(sem nome)'}</div>
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
