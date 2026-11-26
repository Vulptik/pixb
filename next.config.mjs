import createNextIntlPlugin from 'next-intl/plugin';
import { networkInterfaces } from 'node:os';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/** @type {import('next').NextConfig} */

// Increase the maximum number of listeners to prevent MaxListenersExceededWarning
// This is needed for Next.js 15 + Turbopack in development mode
if (process.env.NODE_ENV === 'development') {
  process.setMaxListeners(20);

  // Optional: Add specific handling for SIGINT and SIGTERM to prevent accumulation
  const originalListeners = process.listenerCount('SIGINT') + process.listenerCount('SIGTERM');
  if (originalListeners > 15) {
    console.warn(
      `High number of process listeners detected: ${originalListeners}. This is normal with Turbopack in development mode.`,
    );
  }
}

const nextConfig = {
  // Keep local performance builds separate from the running development server.
  distDir: process.env.PIXB_PERF_BUILD === '1' ? '.next-pixb/performance' : '.next',
  // Automatically memoizes components, reducing unnecessary re-renders
  reactCompiler: true,
  agentRules: false,
  devIndicators: false,
  // Generate source maps for client bundles in production (helps debugging and Lighthouse audits)
  productionBrowserSourceMaps: false,
  compiler: {
    // Strip console.* in production builds (keep errors and warnings)
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false,
    // Remove unused React imports
    reactRemoveProperties:
      process.env.NODE_ENV === 'production' ? { properties: ['^data-testid$'] } : false,
  },
  experimental: {
    // Enable file system cache for development, faster compilations
    turbopackFileSystemCacheForDev: true,
    // Optimize package imports to reduce bundle size
    optimizePackageImports: ['lucide-react', 'formik', 'yup'],
  },
  // Turbopack configuration (simplified for Next.js 16)
  turbopack: {
    rules: {
      // Optimize SVG handling
      '*.svg': {
        loaders: ['@svgr/webpack'],
        as: '*.js',
      },
    },
  },
  // Produce a smaller, self-contained production output
  output: 'standalone',
  outputFileTracingExcludes: {
    '/**': ['./node_modules/ffmpeg-static/**/*'],
  },
  webpack: (config, { dev }) => {
    // Vendored dependencies are immutable to webpack's cache. Invalidate the
    // old Flight client when the local-only timing guard is first introduced.
    if (dev && config.cache?.type === 'filesystem') {
      config.cache.version += '|pixb-react-dev-timing-2';
    }
    config.infrastructureLogging = {
      ...(config.infrastructureLogging || {}),
      level: 'error',
    };
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      {
        module: /node_modules\/file-type\/source\/index\.js/,
        message: /Critical dependency: the request of a dependency is an expression/,
      },
    ];
    return config;
  },
  // Exclude polyfills - target modern browsers only
  excludeDefaultMomentLocales: true,
  // Optimize performance
  poweredByHeader: false,
  compress: true,
  generateBuildId: async () => {
    // Generate a unique build ID to prevent stale Server Action references
    return process.env.BUILD_ID || `build-${Date.now()}`;
  },
  allowedDevOrigins: [
    'localhost',
    '127.0.0.1',
    ...Object.values(networkInterfaces())
      .flat()
      .filter((address) => address?.family === 'IPv4' && !address.internal)
      .map((address) => address.address),
  ],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "media-src 'self' blob:",
              "frame-ancestors 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
  images: {
    unoptimized: true,
  },
};

export default withNextIntl(nextConfig);
