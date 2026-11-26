'use client';

import { ThemeProvider } from '@/lib/contexts/ThemeContext';

// A distinct server/client entry keeps the root from resolving this shared
// provider through the authenticated layout's much larger client chunk group.
export function RootThemeProvider({
  children,
  initialTheme,
}: {
  children: React.ReactNode;
  initialTheme: string;
}) {
  return <ThemeProvider initialTheme={initialTheme}>{children}</ThemeProvider>;
}
