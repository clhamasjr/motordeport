export const WORKSPACE_THEME_STORAGE_KEY = 'flowforce-workspace-theme';
export const WORKSPACE_THEME_EVENT = 'flowforce:workspace-theme-change';

export type WorkspaceTheme = 'light' | 'dark';

export function getWorkspaceTheme(): WorkspaceTheme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.workspaceTheme === 'dark' ? 'dark' : 'light';
}

export function applyWorkspaceTheme(theme: WorkspaceTheme, options: { persist?: boolean; announce?: boolean } = {}) {
  if (typeof document === 'undefined') return;

  const { persist = true, announce = true } = options;
  const root = document.documentElement;

  root.dataset.workspaceTheme = theme;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;

  if (persist) {
    window.localStorage.setItem(WORKSPACE_THEME_STORAGE_KEY, theme);
  }

  if (announce) {
    window.dispatchEvent(new CustomEvent<WorkspaceTheme>(WORKSPACE_THEME_EVENT, { detail: theme }));
  }
}
