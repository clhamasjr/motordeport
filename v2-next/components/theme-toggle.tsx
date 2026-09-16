'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  applyWorkspaceTheme,
  getWorkspaceTheme,
  WORKSPACE_THEME_EVENT,
  WORKSPACE_THEME_STORAGE_KEY,
  type WorkspaceTheme,
} from '@/lib/workspace-theme';

export function ThemeToggle() {
  const [theme, setTheme] = useState<WorkspaceTheme>('light');

  useEffect(() => {
    setTheme(getWorkspaceTheme());

    function onThemeChange(event: Event) {
      setTheme((event as CustomEvent<WorkspaceTheme>).detail);
    }

    function onStorage(event: StorageEvent) {
      if (event.key !== WORKSPACE_THEME_STORAGE_KEY) return;
      const nextTheme: WorkspaceTheme = event.newValue === 'dark' ? 'dark' : 'light';
      applyWorkspaceTheme(nextTheme, { persist: false });
    }

    window.addEventListener(WORKSPACE_THEME_EVENT, onThemeChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(WORKSPACE_THEME_EVENT, onThemeChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  function toggleTheme() {
    applyWorkspaceTheme(theme === 'dark' ? 'light' : 'dark');
  }

  const dark = theme === 'dark';

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label={dark ? 'Ativar modo claro' : 'Ativar modo escuro'}
      title={dark ? 'Ativar modo claro' : 'Ativar modo escuro'}
      aria-pressed={dark}
      className="relative overflow-hidden"
    >
      <Sun className={`absolute size-4 transition-all duration-200 ${dark ? '-rotate-90 scale-75 opacity-0' : 'rotate-0 scale-100 opacity-100'}`} aria-hidden />
      <Moon className={`absolute size-4 transition-all duration-200 ${dark ? 'rotate-0 scale-100 opacity-100' : 'rotate-90 scale-75 opacity-0'}`} aria-hidden />
    </Button>
  );
}
