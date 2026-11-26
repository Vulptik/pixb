import path from 'path';

function getStorageRoot(): string {
  const configured = process.env.STORAGE_PATH?.trim();
  if (!configured) return path.join(process.cwd(), 'storage');
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

export async function getMediaStorageDir(): Promise<string> {
  return path.join(getStorageRoot(), 'uploads');
}

export async function getTusStorageDir(): Promise<string> {
  return path.join(getStorageRoot(), 'tus-uploads');
}
