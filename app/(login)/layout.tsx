import { LoginProviders } from '@/components/providers/LoginProviders';
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <LoginProviders>{children}</LoginProviders>;
}
