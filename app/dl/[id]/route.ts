import { fileRoute } from '@/lib/server/fileRoute';
export const GET = fileRoute('original', true);
export const HEAD = GET;
