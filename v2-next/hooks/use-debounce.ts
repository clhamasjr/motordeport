'use client';

import { useEffect, useState } from 'react';

/**
 * Hook utilitario: retorna o ultimo valor apos 'delay' ms sem mudancas.
 * Usado pra nao disparar queries pesadas a cada caractere digitado.
 *
 * Ex: const debounced = useDebounce(filtros, 600);
 *     useQuery({ queryKey: ['x', debounced], ... });
 */
export function useDebounce<T>(value: T, delay = 500): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  return debounced;
}
