import { prisma } from '../lib/db/prisma';
import { scanOrphanFiles, deleteOrphanFile } from '../lib/server/orphanFiles';
import { runMaintenance } from '../lib/server/maintenance';
async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--delete-orphan' && args[1]) await deleteOrphanFile(args[1]);
  if (args.includes('--apply')) {
    const result = await runMaintenance({ force: true });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'completed' || result.failed.length) process.exitCode = 1;
  } else {
    console.log(JSON.stringify(await scanOrphanFiles(), null, 2));
  }
}
main().finally(() => prisma.$disconnect());
