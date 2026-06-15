'use client';

import { useState } from 'react';
import { ConsultaForm } from '@/components/inss/consulta-form';
import { ConsultaResultado } from '@/components/inss/consulta-resultado';
import { ConsultaInssView } from '@/lib/inss-types';
import { useConsultaBeneficio } from '@/hooks/use-inss-consulta';

interface ConsultaAberta {
  cpf: string;
  view: ConsultaInssView;
}

export default function ConsultaInssPage() {
  const [resultados, setResultados] = useState<ConsultaAberta[]>([]);
  const mutBenef = useConsultaBeneficio();
  const [trocandoCpf, setTrocandoCpf] = useState<string | null>(null);

  const adicionar = (cpf: string, view: ConsultaInssView) => {
    setResultados((prev) => {
      const semDuplicata = prev.filter((r) => r.cpf !== cpf);
      return [{ cpf, view }, ...semDuplicata];
    });
  };

  const remover = (cpf: string) => {
    setResultados((prev) => prev.filter((r) => r.cpf !== cpf));
  };

  // Troca o benefício aberto de um CPF (mantém a lista de benefícios pro switcher)
  const trocarBeneficio = async (cpf: string, nb: string, view: ConsultaInssView) => {
    setTrocandoCpf(cpf);
    try {
      const nova = await mutBenef.mutateAsync(nb);
      adicionar(cpf, { ...nova, lista: view.lista, auto_selected: nb });
    } catch {
      // toast tratado no hook
    } finally {
      setTrocandoCpf(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">🔍 INSS — Consulta de Oportunidades</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Consulta direta no INSS — extrato completo, margens, contratos e enquadramento na regra
          atual de 45%.
        </p>
      </div>

      <ConsultaForm onResult={adicionar} />

      {resultados.length > 0 && (
        <div className="space-y-4">
          {resultados.map((r) => (
            <ConsultaResultado
              key={r.cpf}
              cpf={r.cpf}
              view={r.view}
              onClose={() => remover(r.cpf)}
              onSwitchBeneficio={(nb) => trocarBeneficio(r.cpf, nb, r.view)}
              switching={trocandoCpf === r.cpf}
            />
          ))}
        </div>
      )}
    </div>
  );
}
