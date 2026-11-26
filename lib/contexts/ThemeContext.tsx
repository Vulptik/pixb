'use client';
import { createContext, useContext, useState, useLayoutEffect, useCallback } from 'react';
export const appThemes = [
  { id: 'light', nameKey: 'light', previewColor: '#825923', previewBg: '#f5f2eb' },
  { id: 'dark', nameKey: 'dark', previewColor: '#f2c077', previewBg: '#0f0f0f' },
];
type ThemeContextType = {
  themeId: string;
  setTheme: (id: string) => void;
  themes: typeof appThemes;
};
export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);
function apply(id: string) {
  document.documentElement.dataset.theme = id;
  document.documentElement.classList.toggle('dark', id === 'dark');
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', id === 'dark' ? '#0f0f0f' : '#f5f2eb');
}
export function ThemeProvider({
  children,
  initialTheme,
  persist = false,
}: {
  children: React.ReactNode;
  initialTheme?: string;
  persist?: boolean;
}) {
  const [themeId, setThemeId] = useState(initialTheme === 'dark' ? 'dark' : 'light');
  useLayoutEffect(() => {
    const cookie = document.cookie.match(/(?:^|;\s*)pixb_theme=(light|dark)(?:;|$)/)?.[1];
    const preference = matchMedia('(prefers-color-scheme: dark)');
    const initial =
      cookie ||
      (['light', 'dark'].includes(initialTheme || '')
        ? initialTheme!
        : preference.matches
          ? 'dark'
          : 'light');
    setThemeId(initial);
    apply(initial);
    const followSystem = () => {
      if (
        document.cookie.match(/(?:^|;\s*)pixb_theme=(light|dark)(?:;|$)/) ||
        ['light', 'dark'].includes(initialTheme || '')
      )
        return;
      const next = preference.matches ? 'dark' : 'light';
      setThemeId(next);
      apply(next);
    };
    preference.addEventListener?.('change', followSystem);
    return () => preference.removeEventListener?.('change', followSystem);
  }, [initialTheme]);
  const setTheme = useCallback(
    (id: string) => {
      if (id !== 'light' && id !== 'dark') return;
      setThemeId(id);
      apply(id);
      document.cookie = `pixb_theme=${id};path=/;max-age=31536000;SameSite=Lax`;
      if (persist)
        void fetch('/api/v1/user/update_theme', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ theme: id }),
        }).catch(() => {});
    },
    [persist],
  );
  return (
    <ThemeContext.Provider value={{ themeId, setTheme, themes: appThemes }}>
      {children}
    </ThemeContext.Provider>
  );
}
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('ThemeProvider is required');
  return context;
}
