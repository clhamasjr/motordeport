'use client';

import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  FedConvenio,
  orgaoIcone,
  operacaoTipoLabel,
} from '@/lib/fed-types';
import { ChevronRight } from 'lucide-react';

interface Props {
  convenio: FedConvenio;
  /** Link de destino quando clicar — se omitido, o card vira só visual */
  href?: string;
}

export function ConvenioCard({ convenio: c, href }: Props) {
  const inner = (
    <div className="p-4 flex items-center justify-between gap-3 hover:bg-secondary/30 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="font-bold text-sm flex items-center gap-2">
          <span className="text-base">{orgaoIcone(c.orgao)}</span>
          <span className="truncate">{c.nome}</span>
        </div>
        <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
          {c.orgao && <Badge variant="muted" className="text-[10px]">{c.orgao}</Badge>}
          {c.operacao_tipo && (
            <span>⚙️ {operacaoTipoLabel(c.operacao_tipo)}</span>
          )}
          {c.sheet_origem && (
            <span className="font-mono text-muted-foreground/70">· {c.sheet_origem}</span>
          )}
        </div>
      </div>
      {href && <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
    </div>
  );

  if (href) {
    return (
      <Card className="border-l-4 border-l-primary/40 overflow-hidden">
        <Link href={href}>{inner}</Link>
      </Card>
    );
  }
  return <Card className="border-l-4 border-l-primary/40 overflow-hidden">{inner}</Card>;
}
