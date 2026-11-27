# Contributing to PixB

Thanks for helping. PixB is meant to stay quiet and simple, so please start a
[discussion](https://github.com/Vulptik/pixb/discussions) about a new feature or design change
before building it. Questions and ideas are welcome there too. Bug reports, fixes and translations
are always welcome.

Development happens in the open on `main`, so open pull requests against `main`. Releases are tags
such as `v1.0.0`. Contributions are licensed under the same terms as the code or assets they change.

AI-assisted contributions are welcome. Mention it in the pull request if a tool wrote a large part
of the change, make sure the change works and its tests pass, and be ready to answer questions
about it.

When reporting a bug, include the PixB version or commit, how you run it, your browser and device,
and the steps that reproduce it. Security issues go through the private route in
[SECURITY.md](SECURITY.md), never a public issue.

## Run it locally

You need the Node.js version in `.node-version` and Docker Compose.

```sh
npm ci
npm run dev
```

That starts a local database, applies the schema, creates an administrator and opens PixB at
[localhost:3001](http://localhost:3001). Sign in as `admin@pixb.local` with the password in
`.local-rebuild/admin-password`. Your local uploads, database and secrets are kept between runs and
ignored by git.

## Where to start

Read the [architecture overview](docs/architecture.md) for how the pieces fit. Each row below names
where the code lives and the nearest quick check; run the full checks before opening a pull request.

| Change                                      | Code                                                                    | Nearest check                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Library, viewer, settings and other screens | `components/`, `app/(main)/`, `app/(login)/`, `styles/`                 | `npx vitest run tests/components`, then check it in the running app |
| File API, sharing and file delivery         | `app/api/v1/`, `app/raw/`, `app/dl/`, `app/thumb/`, `app/preview/`      | `npx vitest run tests/api tests/routes`                             |
| Accounts, sign-in, passkeys and API keys    | `lib/server/auth.ts`, `lib/server/webauthn.ts`, `lib/actions/`          | `npx vitest run tests/auth tests/actions`                           |
| Uploads, storage, previews and housekeeping | `lib/server/medias/`, `lib/server/tus*.ts`, `lib/server/maintenance.ts` | `npx vitest run tests/server`                                       |
| Translations                                | `messages/en.json`, `messages/fr.json`                                  | `npx vitest run tests/i18n`                                         |
| Database schema                             | `prisma/` (add a new migration)                                         | `npm run db:check`                                                  |
| Container images, startup and backups       | `Dockerfile`, `docker/`, `scripts/`                                     | The [container checks](#container-checks)                           |

## A few rules

- **Bug fixes come with a test** that fails before the fix and checks what people see or what API
  callers receive.
- **Coverage stays at or above 90%** for statements, branches, functions and lines. Add tests for
  new behavior rather than excluding it.
- **All visible text** goes through `next-intl`, with keys in both `messages/en.json` and
  `messages/fr.json`.
- **Keep the feel.** PixB should stay warm, calm and fluid: soft motion that respects reduced-motion
  settings, flat surfaces with crisp borders (no glow), no cards inside cards, and the shared custom
  scrollbar. Check visible changes in the running app at desktop and mobile sizes, and include
  screenshots or a short recording in the pull request.
- **Never edit a shipped migration.** Schema changes get a new migration.

Before opening a pull request, run:

```sh
npm run test:coverage
npm run lint
npm run typecheck
```

With the local app running, `npm run test:local` also exercises real HTTP, database and storage.

### Container checks

After changing the images, startup or backups, build them and run the checks. Each one uses throwaway
containers and volumes:

```sh
docker compose -f compose.production.yml -f compose.build.yml build
node scripts/check-postgres-image.mjs
node scripts/check-container-startup.mjs
node scripts/check-persistent-config.mjs
node scripts/check-storage-safety.mjs
node scripts/check-backup-restore.mjs
```

`node scripts/check-backup-restore.mjs --upgrade OLD_IMAGE NEW_IMAGE POSTGRES_IMAGE` rehearses an
upgrade between two app builds.

## Releases

Bump `version` in `package.json` and the `PIXB_VERSION` default in `compose.production.yml` (and
`PIXB_DATABASE_VERSION` when the database image changed), then push a matching tag such as `v1.0.0`.
The release workflow checks the versions, runs CI, publishes both images to GitHub Container
Registry with build provenance, and opens a draft release with the install files attached.

## License

PixB is licensed under [AGPL-3.0-only](LICENSE). The PixB name and logo are covered by the
[trademark policy](TRADEMARKS.md).
