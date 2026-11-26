#!/bin/sh
set -eu

# Startup never resets schemas or baselines migration history.
DATABASE_URL="$(node docker/db-check.js database-url)"
export DATABASE_URL
node docker/startup.js
JWT_SECRET="$(node docker/config.js value JWT_SECRET)"
ENCRYPTION_KEY="$(node docker/config.js value ENCRYPTION_KEY)"
export JWT_SECRET ENCRYPTION_KEY
exec "$@"
