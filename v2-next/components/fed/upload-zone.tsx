'use client';

import { useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Paperclip, Trash2 } from 'lucide-react';

interface Props {
  label: string;
  hint?: string;
  file: File | null;
  onChange: (f: File | null) => void;
  /** Padrão: PDF + qualquer imagem */
  accept?: string;
  /** Máximo em MB. Padrão 10 */
  maxMB?: number;
}

export function UploadZone({
  label,
  hint,
  file,
  onChange,
  accept = 'application/pdf,image/*',
  maxMB = 10,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  function pick(f: File | null) {
    if (!f) return onChange(null);
    if (f.size > maxMB * 1024 * 1024) {
      alert(`Arquivo > ${maxMB}MB. Reduza ou comprima.`);
      return;
    }
    const t = f.type;
    if (!(t === 'application/pdf' || t.startsWith('image/'))) {
      alert('Tipo não suportado. Use PDF, JPG, PNG ou WEBP.');
      return;
    }
    onChange(f);
  }

  return (
    <Card className="border-dashed">
      <CardContent className="p-5 text-center">
        {!file ? (
          <>
            <div className="text-sm text-muted-foreground mb-2">{label}</div>
            {hint && <div className="text-[11px] text-muted-foreground/80 mb-3">{hint}</div>}
            <input
              ref={inputRef}
              type="file"
              accept={accept}
              className="hidden"
              onChange={(e) => pick(e.target.files?.[0] || null)}
            />
            <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} className="gap-2">
              <Paperclip className="w-4 h-4" /> Selecionar arquivo
            </Button>
            <div className="text-[10px] text-muted-foreground/70 mt-2">
              PDF, JPG, PNG ou WEBP — máx {maxMB}MB
            </div>
          </>
        ) : (
          <>
            <div className="text-sm font-bold flex items-center justify-center gap-2">
              <Paperclip className="w-4 h-4 text-primary" />
              <span className="truncate max-w-[260px]">{file.name}</span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">
              {(file.size / 1024).toFixed(0)} KB · {file.type || 'application/octet-stream'}
            </div>
            <Button size="sm" variant="outline" onClick={() => onChange(null)} className="mt-3 gap-2">
              <Trash2 className="w-3.5 h-3.5" /> Trocar
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
