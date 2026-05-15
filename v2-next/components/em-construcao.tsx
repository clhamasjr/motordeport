'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ExternalLink, Construction, Check } from 'lucide-react';
import Link from 'next/link';

interface Props {
  titulo: string;
  v1Path?: string;
  proximaSessao?: string;
}

export function EmConstrucao({ titulo, v1Path, proximaSessao }: Props) {
  const v1Url = v1Path
    ? `https://motordeport.vercel.app${v1Path.startsWith('/') ? v1Path : '/' + v1Path}`
    : 'https://motordeport.vercel.app';

  return (
    <div className="max-w-3xl mx-auto p-6">
      <Link href="/inicio" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="w-4 h-4" />
        Voltar pro início
      </Link>

      <Card>
        <CardContent className="p-8 text-center space-y-5">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-yellow-500/10 flex items-center justify-center">
            <Construction className="w-8 h-8 text-yellow-500" />
          </div>

          <div>
            <h1 className="text-2xl font-bold tracking-tight">{titulo}</h1>
            <p className="text-muted-foreground mt-2">
              Esta tela ainda não foi migrada pro V2.
            </p>
            {proximaSessao && (
              <p className="text-xs text-muted-foreground mt-1 italic">
                Previsão: {proximaSessao}
              </p>
            )}
          </div>

          <div className="border-t border-border pt-5 space-y-4">
            <p className="text-sm">
              Enquanto isso, use a <b>versão V1</b> normalmente — toda operação continua funcionando lá.
            </p>
            <Button asChild className="gap-2">
              <a href={v1Url} target="_blank" rel="noreferrer">
                <ExternalLink className="w-4 h-4" />
                Acessar no Sistema V1
              </a>
            </Button>
          </div>

          <div className="text-xs text-muted-foreground text-left bg-secondary/30 rounded-md p-3 space-y-1">
            <div className="font-bold mb-1">📋 Status da migração V2</div>
            <div className="flex items-center gap-2"><Check className="w-3 h-3 text-green-500"/> Login + Dashboard inicial</div>
            <div className="flex items-center gap-2"><Check className="w-3 h-3 text-green-500"/> Consulta Unitária CLT</div>
            <div className="text-muted-foreground/60">⏳ {titulo} ← você está aqui</div>
            <div className="text-muted-foreground/60">⏳ Outras telas em sequência</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
