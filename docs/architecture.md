# Architecture

PixB is one Next.js app (React 19, TypeScript) with a PostgreSQL database through Prisma and files on
local disk. There's no separate API server, queue or object store: one container serves the pages,
the API and the files, and one container runs PostgreSQL.

## Where things live

| Looking for…             | Where                                                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pages                    | `app/(main)/` for the library, favorites, collections and settings; `app/(login)/` for sign-in, setup and password recovery; `app/(recipient)/s/` for shared-link pages |
| API endpoints            | `app/api/v1/{resource}/route.ts`, documented in the [file API](api.md)                                                                                                  |
| File delivery            | `app/raw/`, `app/dl/`, `app/thumb/`, `app/preview/`, `app/cover/`, `app/avatar/`                                                                                        |
| Resumable uploads        | `app/files/` (TUS endpoint) with `lib/server/tusServer.ts` and `lib/server/tusStorage.ts`                                                                               |
| UI components            | `components/shelf/` for the app's screens, `components/ui/` for shared pieces and motion helpers                                                                        |
| Server logic             | `lib/server/`, one module or folder per concern                                                                                                                         |
| Server actions           | `lib/actions/`                                                                                                                                                          |
| JSON shapes              | `lib/server/serializers/`                                                                                                                                               |
| Database schema          | `prisma/schema.prisma` and `prisma/migrations/`                                                                                                                         |
| Translations             | `messages/en.json`, `messages/fr.json`, with locale handling in `i18n/`                                                                                                 |
| Styles and motion tokens | `styles/`                                                                                                                                                               |
| Container startup        | `Dockerfile`, `docker/`                                                                                                                                                 |
| Tests                    | `tests/`, mirroring the source folders                                                                                                                                  |

## How a request flows

`proxy.ts` only tags page requests with their path; it never decides access. Each page, API route and
file route checks access itself:

- **Pages** use `lib/server/pageAuth.ts` and the `pixb_session` cookie.
- **API routes** accept that cookie or an `Authorization: Bearer` API key. Keys carry `read`,
  `write` and `delete` scopes (`lib/server/auth.ts`, `lib/server/library.ts`). Account security
  changes always need a real session, never a key.
- **File routes** serve originals and previews to their owner, or to anyone with an active share
  link. Everything else gets a 404, so private files can't be probed.

Responses go through the serializers, which turn database IDs into strings and never expose storage
paths or secrets.

## Files and previews

All paths on disk come from `lib/server/storagePaths.ts`, rooted at `STORAGE_PATH`. The web app
uploads through TUS so large files can resume; API clients can use a plain multipart
`POST /api/v1/uploads`. Once an upload is complete it's checked, saved as an original and recorded in
the `Media` table. Previews are made afterwards in `lib/server/medias/`: Sharp for images, and a
single frame from a slim FFmpeg build for video. A failed preview never touches the original.

Sharing is per file. Turning a link off rotates the file's public ID, so old links stop working for
good. Collections only organize files; they never grant access.

## Startup and housekeeping

In the container, `docker/entrypoint.sh` waits for PostgreSQL, checks the migration history, loads
the instance keys and applies migrations before Next.js starts. Then `instrumentation.ts` checks that
file storage is writable and starts the housekeeping schedule in `lib/server/maintenance.ts`: hourly
cleanup of expired sessions and abandoned uploads, and a daily storage recount.

## Data model

Twelve Prisma models: `User`, `Session`, `ApiKey`, `Media`, `Collection` and `CollectionMedia` for the
library; `TotpSecret`, `RecoveryCode`, `PasskeyCredential`, `AuthChallenge` and `PasswordReset` for
sign-in; and `Setting` for instance settings. The first migration also installs the `citext` and
`pg_trgm` extensions and SQL constraints Prisma can't describe, which is why the schema is applied
with `npm run db:init` and never `prisma db push`.
