import { rm } from 'fs/promises';
import path from 'path';

import { prisma } from '@/lib/db/prisma';
import { logger } from '@/lib/server/logger';
import { deleteMediaFiles } from '@/lib/server/medias/storage';
import { getMediaStorageDir } from '@/lib/server/storagePaths';

const FILE_DELETE_BATCH_SIZE = 50;

export async function deleteUserData(userId: bigint): Promise<void> {
  if (
    process.env.PIXB_LOCAL_DEV === '1' &&
    (await prisma.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email ===
      'admin@pixb.local'
  )
    throw new Error('The persistent development admin must not be deleted');
  const medias = await prisma.media.findMany({
    where: { user_id: userId },
    select: { file_data: true },
  });

  for (let i = 0; i < medias.length; i += FILE_DELETE_BATCH_SIZE) {
    const batch = medias.slice(i, i + FILE_DELETE_BATCH_SIZE);
    await Promise.all(
      batch.map((media) =>
        deleteMediaFiles(media.file_data).catch((err) =>
          logger.warn({ err, file: media.file_data }, 'Failed to delete media files'),
        ),
      ),
    );
  }

  // Delete DB records in a transaction (memberships cascade with media and collections)
  await prisma.$transaction([
    prisma.media.deleteMany({ where: { user_id: userId } }),
    prisma.collection.deleteMany({ where: { user_id: userId } }),
    prisma.apiKey.deleteMany({ where: { user_id: userId } }),
    prisma.session.deleteMany({ where: { user_id: userId } }),
  ]);

  // Delete avatar files and entire user storage directory
  const baseDir = await getMediaStorageDir();
  const userDir = path.join(baseDir, userId.toString());
  await rm(userDir, { recursive: true, force: true }).catch((err) =>
    logger.warn({ err, dir: userDir }, 'Failed to delete user storage directory'),
  );
}
