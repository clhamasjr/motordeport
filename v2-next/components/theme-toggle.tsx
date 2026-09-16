'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

const STORAGE_KEY = 'flowforce-workspace-theme';
type WorkspaceTheme = 'light' | 'dark';

function currentTheme(): WorkspaceTheme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.workspaceTheme === 'dark' ? 'dark' : 'light';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<WorkspaceTheme>('light');

  useEffect(() => {
    setTheme(currentTheme());
  }, []);

  function toggleTheme() {
    const nextTheme: WorkspaceTheme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.workspaceTheme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    window.localStorage.setItem(STORAGE_KEY, nextTheme);
    setTheme(nextTheme);
  }

  const dark = theme === 'dark';

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label={dark ? 'Ativar modo claro' : 'Ativar modo escuro'}
      title={dark ? 'Modo claro' : 'Modo escuro'}
      aria-pressed={dark}
      className="relative overflow-hidden"
    >
      <Sun className={`absolute size-4 transition-all duration-200 ${dark ? '-rotate-90 scale-75 opacity-0' : 'rotate-0 scale-100 opacity-100'}`} aria-hidden />
      <Moon className={`absolute size-4 transition-all duration-200 ${dark ? 'rotate-0 scale-100 opacity-100' : 'rotate-90 scale-75 opacity-0'}`} aria-hidden />
    </Button>
  );
}
