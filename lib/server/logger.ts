import crypto from 'crypto';
import { createRequire } from 'module';
import { NextResponse, type NextRequest } from 'next/server';
import pino, { type TransportTargetOptions } from 'pino';

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
const level = isTest ? 'silent' : isProduction ? 'info' : 'debug';
const prettyEnabled = !isProduction && !isTest;
const require = createRequire(import.meta.url);

const redactConfig = {
  paths: [
    'password',
    '*.password',
    'password_digest',
    '*.password_digest',
    'token',
    '*.token',
    'jwt',
    '*.jwt',
    'secret',
    '*.secret',
    'api_key',
    '*.api_key',
    'authorization',
    '*.authorization',
    'cookie',
    '*.cookie',
    'set-cookie',
    '*.set-cookie',
    'x-api-key',
    '*.x-api-key',
  ],
  censor: '[REDACTED]',
};

const pinoBase = {
  level,
  base: {
    service: 'pixb',
    env: process.env.NODE_ENV || 'development',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: redactConfig,
};

function buildLogger() {
  if (prettyEnabled) {
    const pretty = require('pino-pretty') as typeof import('pino-pretty');
    const prettyStream = pretty({
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
      sync: true,
    });
    return pino(pinoBase, prettyStream);
  }

  // Production: JSON to stdout; optional file when LOG_FILE is set (avoids mkdir in read-only images).
  const logFile = process.env.LOG_FILE?.trim();
  const targets: TransportTargetOptions[] = [
    { target: 'pino/file', options: { destination: 1 } },
    ...(logFile ? [{ target: 'pino/file', options: { destination: logFile, mkdir: true } }] : []),
  ];
  const transport = pino.transport({ targets });
  return pino(pinoBase, transport);
}

export const logger = buildLogger();

export function getRequestIdFromHeaders(headers?: Headers): string {
  if (!headers) return crypto.randomUUID();
  return headers.get('x-request-id') || headers.get('x-amzn-trace-id') || crypto.randomUUID();
}

export function createRequestLogger(input: { method?: string; url?: string; requestId?: string }) {
  const route = input.method && input.url ? `${input.method} ${input.url}` : undefined;
  return logger.child({
    request_id: input.requestId,
    route,
  });
}

function shouldLogRequest(
  headers?: Headers | Record<string, string | string[] | undefined>,
): boolean {
  if (!headers) return true;
  const internalHeader =
    headers instanceof Headers ? headers.get('x-internal-request') : headers['x-internal-request'];
  const internalValue = Array.isArray(internalHeader) ? internalHeader[0] : internalHeader;
  if (internalValue === '1') {
    return false;
  }
  return true;
}

function getPathname(url?: string) {
  if (!url) return undefined;
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export function withAppRouteLogger(
  handler: (request: NextRequest | Request) => Promise<Response> | Response,
): (request: NextRequest | Request) => Promise<Response>;
export function withAppRouteLogger<TContext>(
  handler: (request: NextRequest | Request, context: TContext) => Promise<Response> | Response,
): (request: NextRequest | Request, context: TContext) => Promise<Response>;
export function withAppRouteLogger<TContext>(
  handler: (request: NextRequest | Request, context?: TContext) => Promise<Response> | Response,
) {
  return async (request: NextRequest | Request, context?: TContext) => {
    const startedAt = Date.now();
    const headers = request?.headers;
    const requestId = getRequestIdFromHeaders(headers);
    const log = createRequestLogger({
      method: request?.method,
      url: getPathname(request?.url),
      requestId,
    });
    const logEnabled = shouldLogRequest(headers);

    if (logEnabled) {
      log.info({ event: 'http.request' }, 'Request received');
    }

    // CSRF protection: reject cross-origin state-changing requests with cookie auth.
    // Bearer token (API key) and internal server-side requests are exempt.
    const method = request?.method?.toUpperCase();
    if (method && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const authHeader = headers?.get('authorization') || '';
      const hasBearerToken = authHeader.startsWith('Bearer ');
      const isInternal = headers?.get('x-internal-request');

      if (!hasBearerToken && !isInternal) {
        const origin = headers?.get('origin');
        const secFetchSite = headers?.get('sec-fetch-site');

        // If Sec-Fetch-Site is present (modern browsers), check it
        if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
          return NextResponse.json({ message: 'CSRF validation failed' }, { status: 403 });
        }

        // If Origin is present, verify it matches the host
        if (origin) {
          const host = headers?.get('host');
          try {
            const originHost = new URL(origin).host;
            if (host && originHost !== host) {
              return NextResponse.json({ message: 'CSRF validation failed' }, { status: 403 });
            }
          } catch {
            return NextResponse.json({ message: 'CSRF validation failed' }, { status: 403 });
          }
        }
      }
    }

    try {
      const response = await handler(request, context);
      if (logEnabled) {
        log.info(
          { event: 'http.response', status: response.status, duration_ms: Date.now() - startedAt },
          'Request completed',
        );
      }
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error(
        { event: 'http.error', error: message, duration_ms: Date.now() - startedAt },
        'Request failed',
      );
      throw error;
    }
  };
}
