import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { publish } from '../docker/config.js';
import { prisma } from '../lib/db/prisma';
if (
  process.env.PIXB_LOCAL_DEV !== '1' ||
  process.env.NODE_ENV === 'production' ||
  !process.env.DATABASE_URL?.includes('@127.0.0.1:5435/pixb')
)
  throw new Error('Local seed is restricted to the isolated development database');
const email = 'admin@pixb.local';
const passwordFile = '.local-rebuild/admin-password';
function initialPassword() {
  if (!existsSync(passwordFile)) {
    const password =
      process.env.PIXB_LOCAL_ADMIN_PASSWORD || `${randomBytes(24).toString('base64url')}aA1!`;
    if (Buffer.byteLength(password) > 72)
      throw new Error('The local seed password exceeds 72 bytes.');
    publish(passwordFile, password);
  }
  const password = readFileSync(passwordFile, 'utf8');
  if (!password || Buffer.byteLength(password) > 72)
    throw new Error(`Invalid local seed password in ${passwordFile}.`);
  return password;
}
async function main() {
  // Preserve the persistent account and its credentials on subsequent starts.
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    await prisma.user.upsert({
      where: { email },
      update: { role: 1 },
      create: {
        email,
        username: 'admin',
        password_digest: await bcrypt.hash(initialPassword(), 12),
        role: 1,
        quota: 20,
        theme: 'system',
      },
    });
    console.log(`Local administrator password is stored in ${passwordFile}.`);
  } else if (existing.role !== 1) {
    await prisma.user.update({ where: { id: existing.id }, data: { role: 1 } });
  }
  await prisma.setting.upsert({
    where: { key: 'instance.setup_completed' },
    update: { value: 'true' },
    create: { key: 'instance.setup_completed', value: 'true' },
  });
  console.log('Isolated local development admin is ready.');
}
main().finally(() => prisma.$disconnect());
