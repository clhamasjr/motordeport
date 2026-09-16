'use client';

import { useId, useRef, useState } from 'react';
import { FileCheck2, Paperclip, Trash2, UploadCloud } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  label: string;
  hint?: string;
  file: File | null;
  onChange: (file: File | null) => void;
  accept?: string;
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
  const inputId = useId();
  const descriptionId = `${inputId}-description`;
  const errorId = `${inputId}-error`;
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);

  function pick(nextFile: File | null) {
    setError('');
    if (!nextFile) {
      onChange(null);
      return;
    }
    if (nextFile.size > maxMB * 1024 * 1024) {
      setError(`O arquivo ultrapassa ${maxMB} MB. Reduza ou comprima antes de continuar.`);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    const type = nextFile.type;
    if (!(type === 'application/pdf' || type.startsWith('image/'))) {
      setError('Formato não suportado. Envie um arquivo PDF, JPG, PNG ou WEBP.');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    onChange(nextFile);
  }

  function clearFile() {
    setError('');
    if (inputRef.current) inputRef.current.value = '';
    onChange(null);
  }

  return (
    <Card
      className={cn(
        'border-dashed transition-colors',
        dragActive && 'border-primary bg-primary/5',
        error && 'border-destructive/40',
      )}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragActive(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        pick(event.dataTransfer.files?.[0] ?? null);
      }}
    >
      <CardContent className="p-5 text-center sm:p-6">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={accept}
          className="sr-only"
          aria-describedby={`${descriptionId}${error ? ` ${errorId}` : ''}`}
          onChange={(event) => pick(event.target.files?.[0] ?? null)}
        />

        {!file ? (
          <>
            <div className="mx-auto flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
              <UploadCloud className="size-5" aria-hidden />
            </div>
            <label htmlFor={inputId} className="mt-3 block text-sm font-semibold text-foreground">{label}</label>
            {hint && <p className="mx-auto mt-1 max-w-xl text-xs leading-5 text-muted-foreground">{hint}</p>}
            <Button type="button" size="sm" variant="outline" onClick={() => inputRef.current?.click()} className="mt-4 gap-2">
              <Paperclip className="size-4" aria-hidden />
              Selecionar arquivo
            </Button>
            <p id={descriptionId} className="mt-2 text-[11px] text-muted-foreground">
              Arraste aqui ou selecione PDF, JPG, PNG ou WEBP · máximo de {maxMB} MB
            </p>
          </>
        ) : (
          <>
            <div className="mx-auto flex size-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20">
              <FileCheck2 className="size-5" aria-hidden />
            </div>
            <div className="mt-3 flex items-center justify-center gap-2 text-sm font-semibold">
              <span className="max-w-[280px] truncate">{file.name}</span>
            </div>
            <p id={descriptionId} className="mt-1 text-[11px] text-muted-foreground">
              {(file.size / 1024).toFixed(0)} KB · {file.type || 'tipo não informado'}
            </p>
            <Button type="button" size="sm" variant="outline" onClick={clearFile} className="mt-4 gap-2">
              <Trash2 className="size-3.5" aria-hidden />
              Trocar arquivo
            </Button>
          </>
        )}

        {error && (
          <p id={errorId} role="alert" className="mt-3 text-xs font-medium text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
