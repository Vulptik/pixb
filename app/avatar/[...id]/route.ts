import { serveAvatarFile } from '@/lib/server/avatars/serve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string[] }> }) {
  const { id } = await params;

  const [token, maybeVariant] = id;
  if (!token) {
    return new Response('Avatar not found', {
      status: 400,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  const variant =
    maybeVariant === 'small' || maybeVariant === 'medium' || maybeVariant === 'large'
      ? maybeVariant
      : undefined;

  return serveAvatarFile(token, variant);
}
