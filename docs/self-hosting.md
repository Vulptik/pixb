# Self-hosting PixB

Everything you need to install, configure, upgrade and back up PixB with Docker Compose.

## Install

Every release attaches `compose.production.yml` and `env.example`. Put them in an empty folder, save
`env.example` as `.env`, and set `PUBLIC_URL` to the address people will use, including the port if
there is one (for example `https://files.example.com`). Then:

```sh
docker compose -f compose.production.yml pull
docker compose -f compose.production.yml run --rm --no-deps init-config
docker compose -f compose.production.yml up -d --wait app
```

Open `/setup` to create the first administrator. **Keep `/setup` private until then:** whoever
reaches it first creates that account.

The app listens on `127.0.0.1:3010`; `PIXB_BIND_ADDRESS` and `PIXB_PORT` change that. `init-config`
creates the instance keys and database password, only when you run it, and never replaces secrets
that already exist.

### Build from source

Clone the release you want and build with the build override, which names the images `pixb:local`
and `pixb-postgres:local`:

```sh
git clone --branch v1.0.0 https://github.com/Vulptik/pixb.git
cd pixb
docker compose -f compose.production.yml -f compose.build.yml build
```

Set `PIXB_IMAGE=pixb:local` and `PIXB_DATABASE_IMAGE=pixb-postgres:local` in `.env`, then run
`init-config` and start the app as above, without the `pull`.

## Configuration

| Setting                             | What it does                                                           |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `PUBLIC_URL`                        | The address people use. A plain origin: no path, query or credentials. |
| `PIXB_BIND_ADDRESS`                 | Host address the app listens on (default `127.0.0.1`).                 |
| `PIXB_PORT`                         | Host port (default `3010`).                                            |
| `PIXB_VERSION`                      | App image version. Defaults to the release the Compose file came from. |
| `PIXB_DATABASE_VERSION`             | Database image version. Change it only when release notes say so.      |
| `PIXB_IMAGE`, `PIXB_DATABASE_IMAGE` | Replace the image names entirely, for example with your own builds.    |

Administrators can override the public address under Settings → Instance → Advanced. Hosting under
a subpath isn't supported. Email (SMTP) is optional and only sends password resets. Accounts have no
storage limit unless an administrator sets one.

**Behind a reverse proxy,** make the proxy overwrite `X-Forwarded-Host` and `X-Forwarded-Proto`, and
don't let anything else reach the app directly. Passkeys are tied to the domain people use, so moving
to a new domain means adding them again.

## Your data

Everything lives in four volumes. Back them up together:

| Volume            | Contents                                        |
| ----------------- | ----------------------------------------------- |
| `config`          | Signing and encryption keys                     |
| `database-secret` | The database password                           |
| `files`           | Originals, avatars, previews, resumable uploads |
| `database`        | PostgreSQL 18 data                              |

The app runs as UID and GID 1001. If you use host folders instead of named volumes, give that user
access yourself. **Never delete volumes or regenerate secrets to fix an error:** PixB refuses to
start with keys from another installation, and new keys can't read existing data.

At startup PixB checks the database before changing anything and stops, without repairing anything,
if it finds a schema it doesn't recognize or a failed migration. Keep your data as it is, read the
logs, and go back to the matching image or a backup.

## Upgrade

1. Read the release notes for every version you're skipping.
2. Take a [backup](#back-up).
3. Set `PIXB_VERSION` in `.env` to the new version, then:

```sh
docker compose -f compose.production.yml pull app
docker compose -f compose.production.yml up -d --no-deps --pull never --wait app
```

The new version applies its database migrations on start. Check existing files, a new upload and your
share links before letting people back in. PixB never downgrades a database, so going back means
[restoring](#restore) the backup you took.

## Back up

The backup tool lives in the repository: run it from a checkout of the release you're running, with
Node 26.13 or later. It stops the app while it copies and starts it again afterwards.

```sh
node scripts/backup.mjs backup pixb-production /private/backups/pixb-backup
node scripts/backup.mjs verify /private/backups/pixb-backup
```

A backup holds a database dump, all files and secrets, the Compose file, and a manifest with
checksums and the exact image IDs. **It isn't encrypted,** so keep it somewhere private, with a copy
off the host. **Images are recorded, not included:** save them too, or you can't restore on a new
machine.

```sh
docker image save --output /private/pixb-images.tar APP_IMAGE_ID DATABASE_IMAGE_ID
```

The tool never overwrites an existing folder. A folder marked `.incomplete` is a failed backup.

## Restore

A restore never touches the original installation. It creates a new, separate one from the backup,
with the exact recorded images (load them first with `docker image load`):

```sh
node scripts/backup.mjs restore /private/backups/pixb-backup \
  https://files.example.com /private/restores/pixb
```

The restored app listens on a free local port, which the tool prints, and is managed with the
`compose.restore.yml` it writes. Settings, share links and passkeys come back as they were, so
review them before exposing a copy. Switching traffic and removing the old installation are up to
you.

## Recover the administrator password

This resets the first administrator's password; their authenticator app and passkeys stay.

1. Make sure only you can reach PixB.
2. In the app container, run `node docker/db-check.js arm-recovery`.
3. Recreate the app with `RECOVERY_MODE=true`.
4. Open `/recover` and set the new password. It works once.
5. Remove `RECOVERY_MODE` and recreate the app.

## Storage errors

Uploads keep a 128 MiB free-space margin. `507 storageFull` means the disk is full; `503
storageUnavailable` means the storage mount or its permissions broke. Fix the cause and retry:
resumable uploads carry on from where they stopped. A failed preview never removes the original.

## Housekeeping

PixB cleans up expired sessions and abandoned uploads every hour and recounts storage every day, with
no cron job needed. It logs orphaned files but never deletes them on its own.
`scripts/maintenance.ts` lists them and can remove one at a time with `--delete-orphan`.

`GET /api/health` reports whether the app is up.
