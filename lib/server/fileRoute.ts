import { serveFile, type FileVariant } from '@/lib/server/fileProxy';
import { logger } from '@/lib/server/logger';
export const fileRoute =
  (variant: FileVariant, download = false) =>
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    try {
      return await serveFile({
        virtualPath: (await context.params).id,
        variant,
        download,
        request,
      });
    } catch (error) {
      logger.warn({ error }, 'File response failed');
      return new Response(null, { status: 404 });
    }
  };
