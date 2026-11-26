'use client';

import UserProvider from './UserProvider';
import { AuthShell } from '@/components/shelf/AuthShell';

// Keep the signed-out entry independent of the authenticated shell's bundle.
export function LoginProviders({ children }: { children: React.ReactNode }) {
  return (
    <UserProvider initialUser={null}>
      <AuthShell>{children}</AuthShell>
    </UserProvider>
  );
}
