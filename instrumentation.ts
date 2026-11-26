export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    validateEnv();
    const { ensureStorageReady } = await import('@/lib/server/storageStatus');
    try {
      await ensureStorageReady();
    } catch (error) {
      // Next can retain a listening server after a rejected instrumentation
      // hook. Production must exit so the installer sees a failed startup.
      if (process.env.NODE_ENV === 'production') {
        console.error(error instanceof Error ? error.message : 'File storage is unavailable.');
        process.exit(1);
      }
      throw error;
    }
    const { startMaintenanceSchedule, stopMaintenanceSchedule } =
      await import('@/lib/server/maintenance');
    if (process.env.NEXT_PHASE !== 'phase-production-build') startMaintenanceSchedule();
    setupGracefulShutdown(stopMaintenanceSchedule);
  }
}

function validateEnv() {
  const errors: string[] = [];

  const jwtSecret = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET;
  if (!jwtSecret) {
    errors.push('JWT_SECRET is required');
  } else if (jwtSecret.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters');
  }

  if (process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length < 32) {
    errors.push('ENCRYPTION_KEY must be at least 32 characters when set');
  }

  const requiredDbVars = [
    'DATABASE_HOST',
    'DATABASE_PORT',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'POSTGRES_DB',
  ];
  for (const key of requiredDbVars) {
    if (!process.env[key]) {
      // Only warn if DATABASE_URL is also not set (direct URL mode)
      if (!process.env.DATABASE_URL) {
        errors.push(`${key} is required (or set DATABASE_URL directly)`);
      }
    }
  }

  if (errors.length > 0) {
    console.error('Environment validation failed:');
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    throw new Error(`Environment validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  }
}

function setupGracefulShutdown(stopMaintenance: () => Promise<void>) {
  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down gracefully...`);
    void stopMaintenance().catch(() => {
      console.error('Background maintenance did not finish during shutdown.');
    });

    // Give in-flight requests time to complete
    setTimeout(() => {
      console.log('Shutdown timeout reached, exiting.');
      globalThis.process.exit(0);
    }, 10_000);
  };

  globalThis.process.on('SIGTERM', () => shutdown('SIGTERM'));
  globalThis.process.on('SIGINT', () => shutdown('SIGINT'));
}
