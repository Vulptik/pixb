import crypto from 'crypto';
import { prisma } from '@/lib/db/prisma';
export async function generateUniqueMediaUid(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const uid = crypto.randomBytes(16).toString('base64url');
    if (!(await prisma.media.findFirst({ where: { uid }, select: { id: true } }))) return uid;
  }
  throw new Error('Could not allocate a unique file identifier');
}
