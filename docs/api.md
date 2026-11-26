# PixB file API

Base: `/api/v1`. Authenticate using `Authorization: Bearer <key>` or an application session cookie. A supplied bearer key always determines API scope, even when a session cookie also exists. IDs and file sizes are JSON strings. Responses never expose physical storage paths or saved credentials. Errors have an HTTP status and a `message` field; library errors also include a stable `code` for localization.

The admin instance endpoint returns `settings.publicUrl` as the effective address and `settings.publicUrlOverride` as the explicitly saved override (empty when inherited). `PATCH /instance` accepts `settings.publicUrl` to set/clear the override; the derived `publicUrlOverride` field is read-only. Precedence is stored override, then installation `PUBLIC_URL`, then request origin for ordinary links only. Password-reset mail requires one of the trusted configured addresses. URLs must be HTTP/HTTPS origins; subpath hosting is unsupported.

## Library

`GET /medias` requires read scope and returns `{files, total, page, hasMore}`. Pages contain up to 40 owner files. Optional query fields combine on the server:

| Field        | Values                                                |
| ------------ | ----------------------------------------------------- |
| `q`          | Case-insensitive filename search                      |
| `type`       | `all`, `image`, `video`, `audio`, `document`, `other` |
| `order`      | `newest` (default), `oldest`                          |
| `favorite`   | `true` to include only favorites                      |
| `shared`     | `true` to include only files with active share links  |
| `collection` | Owner collection ID                                   |
| `page`       | Positive page number, starting at 1                   |

`GET /medias/:id` requires read. `PATCH /medias/:id` requires write and accepts `{name?, favorite?}`. `DELETE /medias/:id` requires delete and removes the original, generated derivatives, and memberships. There is no recycle bin.

## Upload

`POST /uploads` requires write scope. Send multipart form data containing `file`, optionally `collection` (an owned collection ID). Uploads are private by default. Optional per-user quotas, content validation, and upload-size limits are enforced. There is no file-type allowlist.

New users, including the first administrator, have no per-user limit by default. In user create/update requests, `quota` is a non-negative whole number in GB; `0` means no per-user limit. Omitting it on create uses `0`; omitting it on update preserves the existing limit. User responses keep `quotaLimit: 0` for unrestricted accounts and return `quota.unlimited: true`, `quota.total: null`, and `quota.readable_total: null`; usage and file counts remain available. There is no instance-wide default-quota setting. Physical storage and configured per-file limits still apply.

**External uploaders must explicitly send `share=true` to publish an upload.** Omit that field for private uploads. A successful upload returns HTTP 201 with `{file, shareUrl, rawUrl}`. `shareUrl` is null for a private upload; `rawUrl` still requires owner authentication until sharing is enabled. Do not treat a private raw URL as a public link.

```sh
curl -H 'Authorization: Bearer YOUR_KEY' \
  -F 'file=@picture.png' -F 'share=true' \
  http://localhost:3001/api/v1/uploads
```

The web application uses authenticated resumable TUS at `/files`. Upload ownership is checked on creation, continuation, status, and cancellation. Uploads from within a collection gain that membership; otherwise files remain uncollected. API clients can use multipart without implementing TUS.

Storage failures return HTTP 507 (`storageFull`) or 503 (`storageUnavailable`). Multipart returns `{message, code}`; TUS returns the code in its response body. Free space or restore mount access before retrying. TUS preserves received bytes, and a fully received upload is reported complete only after library finalization succeeds. See [storage errors](self-hosting.md#storage-errors) for recovery.

## Sharing

`POST /medias/:id/share` requires write. It enables sharing and returns `{file, shareUrl, rawUrl}`. Repeating it returns the existing link. The recipient page and raw URL are separate.

`DELETE /medias/:id/share` requires write. It disables sharing and atomically rotates the public UID. Previous recipient and asset URLs stop working. Sharing again creates links using the new UID. Collection membership has no influence on public access.

Private asset requests by non-owners return 404, including metadata, originals, downloads, thumbnails, video posters, and PDF previews. Owners can authenticate asset reads with a session or a read-scoped key. Native media responses support byte ranges. `/preview/:uid` permits PDF only; it does not enable inline HTML or SVG.

## Collections

`GET /collections` requires read and returns `{collections}`. `POST /collections` requires write and accepts `{name}`. `PATCH /collections/:id` renames with `{name}`. `DELETE /collections/:id` requires delete and removes the collection and memberships, preserving files.

`POST /collections/:id/members` and `DELETE /collections/:id/members` require write and accept `{ids: ["file-id", ...]}` (1–200 IDs). Both operations are idempotent. Every collection and every selected file must belong to the authenticated user; mixed-owner requests fail without applying partial changes.

## Account and instance

The application retains authenticated user/profile, sessions, passkey/TOTP/recovery, and `/api_keys` endpoints. Keys can be created, listed without their secret, and revoked. Account security operations require a live session rather than a scoped uploader key. `/instance`, user administration, and `/settings/smtp` require an administrator. No registration, folders, public upload requests, or statistics API is provided.
