import { prisma } from '@/lib/db/prisma';
import { normalizePublicUrl } from '@/lib/server/publicUrl';
export type InstanceSettings = {
  publicUrl: string;
  publicUrlOverride: string;
  maxUploadSize: number;
};
type WritableSettings = Omit<InstanceSettings, 'publicUrlOverride'>;
const keys: Record<keyof WritableSettings, string> = {
  publicUrl: 'instance.public_url',
  maxUploadSize: 'instance.max_upload_size',
};
const defaults: InstanceSettings = {
  publicUrl: '',
  publicUrlOverride: '',
  maxUploadSize: 0,
};
let cache: InstanceSettings | null = null,
  at = 0;
const build = () => process.env.NEXT_PHASE === 'phase-production-build';
export function invalidateSettingsCache() {
  cache = null;
  at = 0;
}
export async function getInstanceSettings(): Promise<InstanceSettings> {
  if (build()) return defaults;
  if (cache && Date.now() - at < 60000) return cache;
  let rows: { key: string; value: string }[];
  try {
    rows = await prisma.setting.findMany({ where: { key: { in: Object.values(keys) } } });
  } catch (e) {
    if (process.env.NODE_ENV === 'test') return defaults;
    throw e;
  }
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const number = (key: keyof WritableSettings, min: number, fallback: number) => {
    const v = Number(map.get(keys[key]));
    return Number.isSafeInteger(v) && v >= min ? v : fallback;
  };
  cache = {
    publicUrl: normalizePublicUrl(map.get(keys.publicUrl) || process.env.PUBLIC_URL || ''),
    publicUrlOverride: normalizePublicUrl(map.get(keys.publicUrl) || ''),
    maxUploadSize: number('maxUploadSize', 0, 0),
  };
  at = Date.now();
  return cache;
}
export async function updateInstanceSettings(
  input: Partial<WritableSettings>,
): Promise<InstanceSettings> {
  const updates: Array<{ key: string; value: string }> = [];
  for (const field of Object.keys(keys) as (keyof WritableSettings)[]) {
    if (input[field] === undefined) continue;
    let value = String(input[field]).trim();
    if (field === 'publicUrl' && value) {
      value = normalizePublicUrl(value);
    }
    if (field === 'maxUploadSize') {
      const n = Number(value);
      if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid size');
    }
    updates.push({ key: keys[field], value });
  }
  await prisma.$transaction(
    updates.map(({ key, value }) =>
      prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } }),
    ),
  );
  invalidateSettingsCache();
  return getInstanceSettings();
}
export async function isSetupCompleted() {
  return (
    (await prisma.setting.findUnique({ where: { key: 'instance.setup_completed' } }))?.value ===
    'true'
  );
}
export async function getSetupStatus() {
  if (build()) return { required: false, setupCompleted: false, userCount: 0, settings: defaults };
  const [userCount, setupCompleted, settings] = await Promise.all([
    prisma.user.count(),
    isSetupCompleted(),
    getInstanceSettings(),
  ]);
  return { required: userCount === 0 && !setupCompleted, setupCompleted, userCount, settings };
}
