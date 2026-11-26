# syntax=docker/dockerfile:1.7

# Stage 1: Base
FROM node:26.13.0-slim AS base

WORKDIR /app

# Shared OS dependencies for Prisma/runtime checks
RUN DEBIAN_FRONTEND=noninteractive apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates openssl && \
    rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json package-lock.json ./
RUN npm install --global npm@12.2.1

# Frame extraction tools, built independently of application compilation.
# Build dependencies and full FFmpeg static libraries stay in this stage.
FROM base AS video-tools
RUN DEBIAN_FRONTEND=noninteractive apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      build-essential nasm pkg-config curl xz-utils libdav1d-dev zlib1g-dev && \
    rm -rf /var/lib/apt/lists/*
COPY docker/build-video-tools.sh /tmp/build-video-tools.sh
RUN sh /tmp/build-video-tools.sh

# Stage 2: Full dependencies
FROM base AS full-deps

# Install all dependencies once
# --ignore-scripts skips postinstall prisma generate (schema not present yet); builder runs it explicitly
RUN --mount=type=cache,target=/root/.npm npm ci --include=optional --ignore-scripts

# Stage 3: Builder
FROM full-deps AS builder

WORKDIR /app

# Copy source code
COPY . ./

# Declare build args
ARG NODE_ENV=production
ARG NEXT_PUBLIC_API_VERSION=1
ARG NEXT_TELEMETRY_DISABLED=1

# Set environment variables for build
ENV NODE_ENV=$NODE_ENV \
    NEXT_PUBLIC_API_VERSION=$NEXT_PUBLIC_API_VERSION \
    NEXT_TELEMETRY_DISABLED=$NEXT_TELEMETRY_DISABLED

# Generate Prisma client (allow missing DB during build)
RUN PRISMA_ALLOW_MISSING_DB=1 npx prisma generate

# Build the application
RUN PRISMA_ALLOW_MISSING_DB=1 npm run build

# Stage 4: Add only the startup/migration dependencies to standalone output.
# Dependency analysis and download tooling stay in intermediate stages.
FROM builder AS runtime
RUN node scripts/prepare-container-runtime.mjs

# Stage 5: Runner
FROM base AS runner

WORKDIR /app

# Only the small AV1 decoder is external to the custom FFmpeg executable.
RUN DEBIAN_FRONTEND=noninteractive apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends libdav1d7 && \
    rm -rf /var/lib/apt/lists/*
COPY --from=video-tools /opt/pixb-media /opt/pixb-media

# Set production environment
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    FFMPEG_PATH=/opt/pixb-media/bin/ffmpeg \
    HOME=/app \
    NPM_CONFIG_CACHE=/tmp/.npm \
    PORT=3000 \
    PIXB_CONFIG_PATH=/app/config \
    HOSTNAME=0.0.0.0

# Create a non-root user
RUN addgroup --system --gid 1001 pixb && \
    adduser --system --uid 1001 --ingroup pixb pixb

# Standalone includes the app plus traced startup/migration dependencies.
COPY --from=runtime --chown=pixb:pixb /app/.next/standalone ./
COPY --from=builder --chown=pixb:pixb /app/.next/static ./.next/static
COPY --from=builder --chown=pixb:pixb /app/public ./public
COPY --chown=pixb:pixb LICENSE NOTICE.md ./

# Prisma CLI and its native migration engine are traced in the runtime stage.
# Migrations are applied only after the read-only startup preflight.
COPY --from=builder --chown=pixb:pixb /app/prisma ./prisma
COPY --from=builder --chown=pixb:pixb /app/prisma.config.ts ./prisma.config.ts

# DB check utility (used by entrypoint for migration checks)
COPY --chown=pixb:pixb docker/db-check.js ./docker/db-check.js
COPY --chown=pixb:pixb docker/startup.js ./docker/startup.js
COPY --chown=pixb:pixb docker/config.js ./docker/config.js
COPY --chown=pixb:pixb docker/backup.js ./docker/backup.js
LABEL pixb.backup-format="1"

# Directory setup (single layer)
RUN mkdir -p storage/uploads storage/tus-uploads /tmp/.npm config database-secret && \
    chown -R pixb:pixb storage /tmp/.npm config database-secret && \
    chmod 700 config database-secret

# Entrypoint for app startup
COPY --chown=pixb:pixb docker/entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Switch to non-root user
USER pixb

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Entrypoint handles startup checks
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# Start the application (standalone output)
CMD ["node", "server.js"]
