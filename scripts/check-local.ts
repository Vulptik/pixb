import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';
import { prisma } from '../lib/db/prisma';
import { deleteUserData } from '../lib/server/users/purge';
import type { LibraryFile, LibraryCollection, LibraryPage } from '../types/library';
if (
  process.env.PIXB_LOCAL_DEV !== '1' ||
  !process.env.DATABASE_URL?.includes('@127.0.0.1:5435/pixb')
)
  throw Error('Only the isolated local database may run acceptance checks');
const base = 'http://localhost:3001';
const run = Date.now().toString(36);
let assertions = 0;
const users: bigint[] = [];
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  assertions++;
  console.log(`PASS ${name}`);
}
async function call(url: string, options: RequestInit = {}, cookie?: string) {
  return fetch(new URL(url, base), {
    ...options,
    headers: { ...(cookie ? { cookie } : {}), ...options.headers },
  });
}
async function json<T>(url: string, options: RequestInit = {}, cookie?: string): Promise<T> {
  const r = await call(
    url,
    {
      ...options,
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...options.headers,
      },
    },
    cookie,
  );
  assert.ok(r.ok, `${options.method || 'GET'} ${url}: ${r.status} ${await r.clone().text()}`);
  return r.json() as Promise<T>;
}
function post(body: unknown, method = 'POST') {
  return { method, body: JSON.stringify(body) };
}
async function actor(suffix: string) {
  const email = `acceptance-${run}-${suffix}@pixb.local`;
  const password = `Local-Acceptance-${run}!`;
  const user = await prisma.user.create({
    data: {
      email,
      username: `check_${run}_${suffix}`,
      password_digest: await bcrypt.hash(password, 10),
      quota: 2,
    },
  });
  users.push(user.id);
  const result = await json<{ token: string }>(
    '/api/v1/sessions',
    post({ user: { login: email, password } }),
  );
  return { user, cookie: `pixb_session=${result.token}` };
}
async function upload(
  name: string,
  mime: string,
  bytes: Uint8Array,
  cookie: string,
  extra: Record<string, string> = {},
) {
  const form = new FormData();
  form.set('file', new File([bytes as BlobPart], name, { type: mime }));
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  const r = await call('/api/v1/uploads', { method: 'POST', body: form }, cookie);
  assert.equal(r.status, 201, await r.clone().text());
  return (await r.json()) as { file: LibraryFile; shareUrl: string | null; rawUrl: string };
}
function pdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const content = 'BT /F1 16 Tf 30 120 Td (PixB local acceptance) Tj ET';
  objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  let result = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(result));
    result += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const start = Buffer.byteLength(result);
  result +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => `${String(n).padStart(10, '0')} 00000 n \n`)
      .join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(result);
}
async function main() {
  const a = await actor('a'),
    b = await actor('b');
  const fixtures = path.resolve('.local-rebuild/fixtures');
  await mkdir(fixtures, { recursive: true });
  const png = await sharp(
    Buffer.from(
      '<svg width="640" height="480" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#e9c991"/><stop offset="1" stop-color="#665137"/></linearGradient></defs><rect width="640" height="480" fill="url(#g)"/><circle cx="470" cy="120" r="55" fill="#f8e4bd"/><path d="M0 430L210 220L400 430L500 300L640 450V480H0" fill="#39392f"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  await writeFile(path.join(fixtures, 'Quiet afternoon.png'), png);
  await writeFile(path.join(fixtures, 'A small note.pdf'), pdf());
  await writeFile(path.join(fixtures, 'Notes.txt'), 'A local PixB test file.');
  let one!: LibraryCollection, two!: LibraryCollection, file!: LibraryFile;
  await check('create two flat private collections', async () => {
    one = (
      await json<{ collection: LibraryCollection }>(
        '/api/v1/collections',
        post({ name: 'Local acceptance A' }),
        a.cookie,
      )
    ).collection;
    two = (
      await json<{ collection: LibraryCollection }>(
        '/api/v1/collections',
        post({ name: 'Local acceptance B' }),
        a.cookie,
      )
    ).collection;
    assert.notEqual(one.id, two.id);
  });
  await check('upload into a collection privately', async () => {
    const result = await upload('Quiet afternoon.png', 'image/png', png, a.cookie, {
      collection: one.id,
    });
    file = result.file;
    assert.equal(file.shared, false);
    assert.equal(result.shareUrl, null);
    assert.deepEqual(file.collections, [one.id]);
  });
  await check('deny anonymous and cross-user private files and metadata', async () => {
    for (const cookie of [undefined, b.cookie]) {
      for (const link of [file.links.original, file.links.thumbnail!, file.links.download])
        assert.equal((await call(link, {}, cookie)).status, 404);
      assert.equal(
        (await call(`/api/v1/medias/${file.id}`, {}, cookie)).status,
        cookie ? 404 : 401,
      );
    }
  });
  await check('owner reads private original and native ranges', async () => {
    const r = await call(file.links.original, { headers: { range: 'bytes=0-7' } }, a.cookie);
    assert.equal(r.status, 206);
    assert.equal((await r.arrayBuffer()).byteLength, 8);
  });
  await check('reject cross-user collection reads and mixed membership changes', async () => {
    assert.equal((await call(`/api/v1/medias?collection=${one.id}`, {}, b.cookie)).status, 404);
    assert.equal(
      (
        await call(
          `/api/v1/collections/${one.id}/members`,
          { ...post({ ids: [file.id] }), headers: { 'content-type': 'application/json' } },
          b.cookie,
        )
      ).status,
      404,
    );
  });
  await check('one file can belong to two collections without duplication', async () => {
    await json(`/api/v1/collections/${two.id}/members`, post({ ids: [file.id] }), a.cookie);
    await json(`/api/v1/collections/${two.id}/members`, post({ ids: [file.id] }), a.cookie);
    const data = await json<LibraryPage>('/api/v1/medias', {}, a.cookie);
    assert.equal(data.total, 1);
    assert.deepEqual(data.files[0].collections.sort(), [one.id, two.id].sort());
  });
  await check('removing collection membership leaves original intact', async () => {
    await json(
      `/api/v1/collections/${one.id}/members`,
      post({ ids: [file.id] }, 'DELETE'),
      a.cookie,
    );
    assert.equal((await call(file.links.original, {}, a.cookie)).status, 200);
    assert.equal(
      (await json<LibraryPage>(`/api/v1/medias?collection=${one.id}`, {}, a.cookie)).total,
      0,
    );
  });
  await check(
    'favorite and rename persist across requests without moving stored files',
    async () => {
      const before = await prisma.media.findUniqueOrThrow({ where: { id: BigInt(file.id) } });
      await json(
        `/api/v1/medias/${file.id}`,
        post({ favorite: true, name: 'Afternoon kept close.png' }, 'PATCH'),
        a.cookie,
      );
      const data = await json<LibraryPage>(
        '/api/v1/medias?favorite=true&q=kept&type=image',
        {},
        a.cookie,
      );
      assert.equal(data.files[0].name, 'Afternoon kept close.png');
      assert.equal(
        (await prisma.media.findUniqueOrThrow({ where: { id: before.id } })).file_data,
        before.file_data,
      );
    },
  );
  let shared!: { shareUrl: string; rawUrl: string; file: LibraryFile };
  await check('sharing produces a recipient page and separate direct URL', async () => {
    shared = await json(`/api/v1/medias/${file.id}/share`, post({}), a.cookie);
    assert.notEqual(shared.shareUrl, shared.rawUrl);
    assert.equal((await call(shared.shareUrl)).status, 200);
    assert.equal((await call(shared.rawUrl)).status, 200);
    const html = await (await call(shared.shareUrl)).text();
    assert.ok(html.includes('Afternoon kept close.png'));
    assert.ok(!html.includes('Local acceptance B'));
  });
  await check('repeated sharing preserves the same URL', async () => {
    assert.equal(
      (await json<{ shareUrl: string }>(`/api/v1/medias/${file.id}/share`, post({}), a.cookie))
        .shareUrl,
      shared.shareUrl,
    );
  });
  await check('revocation invalidates recipient and every old asset URL', async () => {
    const result = await json<{ file: LibraryFile }>(
      `/api/v1/medias/${file.id}/share`,
      post({}, 'DELETE'),
      a.cookie,
    );
    assert.equal(result.file.shared, false);
    for (const url of [
      shared.shareUrl,
      shared.rawUrl,
      shared.file.links.thumbnail!,
      shared.file.links.download,
    ]) {
      const response = await call(url);
      if (url === shared.shareUrl && response.status === 200) {
        // Next can stream the page shell before notFound() resolves. Assets
        // must still return HTTP 404; a streamed page must carry the 404 digest.
        assert.match(await response.text(), /NEXT_HTTP_ERROR_FALLBACK;404/);
      } else assert.equal(response.status, 404);
    }
    assert.equal((await call(result.file.links.original, {}, a.cookie)).status, 200);
    file = result.file;
  });
  await check('deleting a collection never deletes its member files', async () => {
    await json(`/api/v1/collections/${two.id}`, post({}, 'DELETE'), a.cookie);
    assert.equal((await call(file.links.original, {}, a.cookie)).status, 200);
    assert.equal((await json<LibraryPage>('/api/v1/medias', {}, a.cookie)).total, 1);
  });
  await check('PDF preview is owner-authorized and raw PDF remains a download', async () => {
    const r = await upload('A small note.pdf', 'application/pdf', pdf(), a.cookie);
    assert.equal((await call(r.file.links.preview!)).status, 404);
    const preview = await call(r.file.links.preview!, {}, a.cookie);
    assert.equal(preview.headers.get('content-type'), 'application/pdf');
    assert.match(preview.headers.get('content-disposition')!, /inline/);
    assert.match(
      (await call(r.rawUrl, {}, a.cookie)).headers.get('content-disposition')!,
      /attachment/,
    );
  });
  await check('unsafe active content is download-only', async () => {
    for (const [name, mime, body] of [
      ['unsafe.html', 'text/html', '<h1>test</h1>'],
      [
        'drawing.svg',
        'image/svg+xml',
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
      ],
    ]) {
      const r = await upload(name, mime, Buffer.from(body), a.cookie);
      assert.equal(r.file.links.preview, null);
      assert.match(
        (await call(r.rawUrl, {}, a.cookie)).headers.get('content-disposition')!,
        /attachment/,
      );
    }
  });
  await check(
    'resumable uploads bind ownership and can be completed after a HEAD request',
    async () => {
      const meta = `filename ${Buffer.from('Resumable.png').toString('base64')},filetype ${Buffer.from('image/png').toString('base64')},collection ${Buffer.from(one.id).toString('base64')}`;
      const created = await call(
        '/files',
        {
          method: 'POST',
          headers: {
            'Tus-Resumable': '1.0.0',
            'Upload-Length': String(png.length),
            'Upload-Metadata': meta,
          },
        },
        a.cookie,
      );
      assert.equal(created.status, 201, await created.text());
      const location = created.headers.get('location')!;
      const half = Math.floor(png.length / 2);
      const patch = (offset: number, data: Uint8Array, cookie: string) =>
        call(
          location,
          {
            method: 'PATCH',
            headers: {
              'Tus-Resumable': '1.0.0',
              'Upload-Offset': String(offset),
              'Content-Type': 'application/offset+octet-stream',
            },
            body: data as BodyInit,
          },
          cookie,
        );
      assert.equal((await patch(0, png.subarray(0, half), a.cookie)).status, 204);
      assert.equal(
        (await call(location, { method: 'HEAD', headers: { 'Tus-Resumable': '1.0.0' } }, b.cookie))
          .status,
        404,
      );
      const head = await call(
        location,
        { method: 'HEAD', headers: { 'Tus-Resumable': '1.0.0' } },
        a.cookie,
      );
      assert.equal(head.headers.get('upload-offset'), String(half));
      const done = await patch(half, png.subarray(half), a.cookie);
      assert.equal(done.status, 204, await done.text());
      const id = done.headers.get('x-pixb-file');
      assert.ok(id);
      const media = await json<{ file: LibraryFile }>(`/api/v1/medias/${id}`, {}, a.cookie);
      assert.equal(media.file.shared, false);
      assert.ok(media.file.collections.includes(one.id));
      const after = await call(
        location,
        { method: 'HEAD', headers: { 'Tus-Resumable': '1.0.0' } },
        a.cookie,
      );
      assert.equal(after.headers.get('upload-offset'), String(png.length));
    },
  );
  await check('API keys honor scopes and require explicit share=true', async () => {
    const key = await json<{ encoded_token: string }>(
      '/api/v1/api_keys',
      post({ api_key: { name: 'acceptance', expiration: 0, scopes: ['read'] } }),
      a.cookie,
    );
    const form = new FormData();
    form.set('file', new File([png], 'Scope.png', { type: 'image/png' }));
    assert.equal(
      (
        await call('/api/v1/uploads', {
          method: 'POST',
          headers: { authorization: `Bearer ${key.encoded_token}` },
          body: form,
        })
      ).status,
      403,
    );
    const writer = await json<{ encoded_token: string }>(
      '/api/v1/api_keys',
      post({ api_key: { name: 'writer', expiration: 0, scopes: ['write'] } }),
      a.cookie,
    );
    const shareForm = new FormData();
    shareForm.set('file', new File([png], 'API share.png', { type: 'image/png' }));
    shareForm.set('share', 'true');
    const r = await call('/api/v1/uploads', {
      method: 'POST',
      headers: { authorization: `Bearer ${writer.encoded_token}` },
      body: shareForm,
    });
    assert.equal(r.status, 201, await r.clone().text());
    assert.ok((await r.json()).shareUrl);
  });
  await check('non-admin users cannot read or change instance/users settings', async () => {
    assert.equal((await call('/api/v1/instance', {}, b.cookie)).status, 403);
    assert.equal((await call('/api/v1/users', {}, b.cookie)).status, 403);
    assert.equal((await call('/api/v1/settings/smtp', {}, b.cookie)).status, 401);
  });
  await check('native audio, video, text, and archive cards can be uploaded', async () => {
    const wav = Buffer.alloc(44 + 16000);
    wav.write('RIFF', 0);
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24);
    wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(16000, 40);
    await writeFile(path.join(fixtures, 'A quiet second.wav'), wav);
    assert.equal(
      (await upload('A quiet second.wav', 'audio/wav', wav, a.cookie)).file.kind,
      'audio',
    );
    assert.equal(
      (await upload('Notes.txt', 'text/plain', Buffer.from('local notes'), a.cookie)).file.kind,
      'document',
    );
    const zip = Buffer.from('504b05060000000000000000000000000000000000000000', 'hex');
    assert.equal(
      (await upload('Archive.zip', 'application/zip', zip, a.cookie)).file.kind,
      'other',
    );
    assert.ok(ffmpeg, 'ffmpeg is required for video acceptance');
    const video = path.join(fixtures, 'A quiet second.mp4');
    const result = spawnSync(
      ffmpeg!,
      ['-y', '-f', 'lavfi', '-i', 'color=c=0x8b7651:s=320x240:d=1', '-pix_fmt', 'yuv420p', video],
      { stdio: 'ignore' },
    );
    assert.equal(result.status, 0);
    const uploadedVideo = await upload(
      'A quiet second.mp4',
      'video/mp4',
      await readFile(video),
      a.cookie,
    );
    assert.equal(uploadedVideo.file.kind, 'video');
    for (const url of [uploadedVideo.file.links.thumbnail!, uploadedVideo.file.links.poster!]) {
      const response = await call(url, {}, a.cookie);
      assert.equal(response.status, 200);
      assert.ok(
        (await response.arrayBuffer()).byteLength > 8,
        'A short video needs a real preview frame, not an empty WebP header',
      );
    }
  });
  await check('server pagination never mixes users or loses stable ordering', async () => {
    const stored = await prisma.media.findUniqueOrThrow({ where: { id: BigInt(file.id) } });
    await prisma.media.createMany({
      data: Array.from({ length: 45 }, (_, i) => ({
        user_id: a.user.id,
        uid: `accept-${run}-${i}`,
        filename: `Page fixture ${i}.txt`,
        mime_type: 'text/plain',
        size: 1,
        file_data: stored.file_data,
        is_shared: false,
      })),
    });
    const first = await json<LibraryPage>(
      '/api/v1/medias?q=Page%20fixture&type=document',
      {},
      a.cookie,
    );
    const second = await json<LibraryPage>(
      '/api/v1/medias?q=Page%20fixture&type=document&page=2',
      {},
      a.cookie,
    );
    assert.equal(first.files.length, 40);
    assert.equal(first.hasMore, true);
    assert.equal(second.files.length, 5);
    assert.equal(new Set([...first.files, ...second.files].map((f) => f.id)).size, 45);
    assert.equal((await json<LibraryPage>('/api/v1/medias', {}, b.cookie)).total, 0);
  });
  await check('canceling an unfinished resumable upload leaves no library file', async () => {
    const before = (await json<LibraryPage>('/api/v1/medias', {}, b.cookie)).total;
    const created = await call(
      '/files',
      {
        method: 'POST',
        headers: {
          'Tus-Resumable': '1.0.0',
          'Upload-Length': String(png.length),
          'Upload-Metadata': `filename ${Buffer.from('Canceled.png').toString('base64')},filetype ${Buffer.from('image/png').toString('base64')}`,
        },
      },
      b.cookie,
    );
    assert.equal(created.status, 201);
    const location = created.headers.get('location')!;
    assert.equal(
      (await call(location, { method: 'DELETE', headers: { 'Tus-Resumable': '1.0.0' } }, b.cookie))
        .status,
      204,
    );
    assert.equal(
      (await call(location, { method: 'HEAD', headers: { 'Tus-Resumable': '1.0.0' } }, b.cookie))
        .status,
      404,
    );
    assert.equal((await json<LibraryPage>('/api/v1/medias', {}, b.cookie)).total, before);
  });
  await check('quota rejection leaves the library usable for a later retry', async () => {
    const own = await upload('Quota fixture.png', 'image/png', png, b.cookie);
    await prisma.media.update({ where: { id: BigInt(own.file.id) }, data: { size: 1073741824n } });
    await prisma.user.update({
      where: { id: b.user.id },
      data: { quota: 1, cached_quota_used: 1073741824n },
    });
    try {
      const form = new FormData();
      form.set('file', new File([png], 'Over quota.png', { type: 'image/png' }));
      const rejected = await call('/api/v1/uploads', { method: 'POST', body: form }, b.cookie);
      assert.equal(rejected.status, 400);
      assert.equal((await rejected.json()).code, 'quotaExceeded');
    } finally {
      await prisma.media.update({
        where: { id: BigInt(own.file.id) },
        data: { size: BigInt(png.length) },
      });
      await prisma.user.update({
        where: { id: b.user.id },
        data: { quota: 2, cached_quota_used: BigInt(png.length) },
      });
    }
    assert.equal(
      (await upload('Retry after quota.png', 'image/png', png, b.cookie)).file.shared,
      false,
    );
  });
  await check(
    'different file types are accepted and size limits preserve successful files',
    async () => {
      await prisma.user.update({ where: { id: a.user.id }, data: { role: 1 } });
      const original = (
        await json<{ settings: Record<string, unknown> }>('/api/v1/instance', {}, a.cookie)
      ).settings;
      try {
        await json('/api/v1/instance', post({ settings: { maxUploadSize: 1 } }, 'PATCH'), a.cookie);
        const form = new FormData();
        form.set('file', new File(['a note'], 'Accepted.txt', { type: 'text/plain' }));
        const accepted = await call('/api/v1/uploads', { method: 'POST', body: form }, a.cookie);
        assert.equal(accepted.status, 201);
        assert.equal((await accepted.json()).file.shared, false);
        const large = new FormData();
        large.set(
          'file',
          new File([Buffer.alloc(1048577)], 'Too large.png', { type: 'image/png' }),
        );
        assert.equal(
          (await call('/api/v1/uploads', { method: 'POST', body: large }, a.cookie)).status,
          413,
        );
        assert.equal(
          (await upload('Accepted in mixed batch.png', 'image/png', png, a.cookie)).file.shared,
          false,
        );
      } finally {
        await json('/api/v1/instance', post({ settings: original }, 'PATCH'), a.cookie);
        await prisma.user.update({ where: { id: a.user.id }, data: { role: 0 } });
      }
    },
  );
  console.log(
    `${assertions} live acceptance scenarios passed. Temporary actors will be removed; the persistent admin is untouched.`,
  );
}
main().finally(async () => {
  for (const id of users) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user?.email.startsWith(`acceptance-${run}-`))
      throw Error('Refusing to clean an unrelated account');
    await deleteUserData(id);
    await prisma.user.delete({ where: { id } });
  }
  await prisma.$disconnect();
});
