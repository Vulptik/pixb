import { Writable } from 'node:stream';
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  writeError: null as Error | null,
  finalError: null as Error | null,
  space: vi.fn(),
  rm: vi.fn(),
  create: vi.fn(),
}));
vi.mock('fs', () => ({ createWriteStream: state.create }));
vi.mock('fs/promises', () => ({ mkdir: vi.fn(), rm: state.rm }));
vi.mock('@/lib/server/storagePaths', () => ({ getTusStorageDir: async () => '/safe/tus' }));
vi.mock('@/lib/server/storageStatus', () => ({ assertStorageCapacity: state.space }));
import { parseMultipartUpload } from '@/lib/server/uploads/multipart';
beforeEach(() => {
  vi.clearAllMocks();
  state.writeError = null;
  state.finalError = null;
  state.space.mockResolvedValue(undefined);
  state.rm.mockResolvedValue(undefined);
  state.create.mockImplementation(
    () =>
      new Writable({
        write(_chunk, _encoding, callback) {
          callback(state.writeError);
        },
        final(callback) {
          callback(state.finalError);
        },
      }),
  );
});
function request() {
  const form = new FormData();
  form.set('file', new File(['test bytes'], 'test.txt', { type: 'text/plain' }));
  return new Request('http://local/api/v1/uploads', { method: 'POST', body: form });
}
it('rejects low-space admission before opening an upload file', async () => {
  state.space.mockRejectedValueOnce(Object.assign(new Error('full'), { code: 'ENOSPC' }));
  await expect(parseMultipartUpload(request())).rejects.toMatchObject({ code: 'ENOSPC' });
  expect(state.create).not.toHaveBeenCalled();
});
it.each(['ENOSPC', 'EDQUOT', 'EACCES'])(
  'propagates a streamed %s failure without leaving a partial file or crashing',
  async (code) => {
    state.writeError = Object.assign(new Error('write failed'), { code });
    await expect(parseMultipartUpload(request())).rejects.toMatchObject({ code });
    expect(state.rm.mock.calls[0][0].replaceAll('\\', '/')).toMatch(/^\/safe\/tus\/multipart-/);
    expect(state.rm.mock.calls[0][1]).toEqual({ force: true });
    state.writeError = null;
    const result = await parseMultipartUpload(request());
    expect(result.file?.filename).toBe('test.txt');
  },
);
it('cleans a partial file when close/flush fails instead of reporting upload success', async () => {
  state.finalError = Object.assign(new Error('flush failed'), { code: 'ENOSPC' });
  await expect(parseMultipartUpload(request())).rejects.toMatchObject({ code: 'ENOSPC' });
  expect(state.rm).toHaveBeenCalled();
});
it('preserves an asynchronous open error that occurs before the first write', async () => {
  state.create.mockImplementationOnce(() => {
    const stream = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    queueMicrotask(() => stream.destroy(Object.assign(new Error('denied'), { code: 'EACCES' })));
    return stream;
  });
  await expect(parseMultipartUpload(request())).rejects.toMatchObject({ code: 'EACCES' });
});

function rawRequest(
  body: string | string[],
  contentType = 'multipart/form-data; boundary="test-boundary"',
  length?: string,
) {
  const chunks = Array.isArray(body) ? body : [body];
  return new Request('http://local/uploads', {
    method: 'POST',
    headers: { 'content-type': contentType, ...(length ? { 'content-length': length } : {}) },
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }),
    duplex: 'half',
  } as RequestInit);
}
const part = (headers: string, body: string) => `--test-boundary\r\n${headers}\r\n\r\n${body}\r\n`;
const end = '--test-boundary--\r\n';
it('requires a multipart boundary and a request body', async () => {
  await expect(parseMultipartUpload(new Request('http://local'))).rejects.toMatchObject({
    status: 400,
    message: 'Invalid multipart request',
  });
  await expect(
    parseMultipartUpload(
      new Request('http://local', {
        headers: { 'content-type': 'multipart/form-data; boundary=x' },
      }),
    ),
  ).rejects.toMatchObject({ status: 400, message: 'Missing request body' });
});
it('accepts an empty multipart body and handles an absent preamble boundary', async () => {
  expect(await parseMultipartUpload(rawRequest(end))).toEqual({ fields: new Map(), file: null });
  expect(await parseMultipartUpload(rawRequest('nothing here'))).toEqual({
    fields: new Map(),
    file: null,
  });
});
it('parses fields, ignores unnamed parts and malformed headers, and keeps only the first file', async () => {
  const body =
    part('X-Broken\r\nContent-Disposition: form-data; name="title"; invalid', 'Photo') +
    part('X-Other: ignored', 'unnamed') +
    part(
      'Content-Disposition: form-data; name="file"; filename*=photo.png\r\nContent-Type: image/png',
      'pixels',
    ) +
    part('Content-Disposition: form-data; name="second"; filename="second.txt"', 'discard') +
    end;
  const result = await parseMultipartUpload(rawRequest(body, undefined, '500'));
  expect(result.fields.get('title')).toBe('Photo');
  expect(result.fields.size).toBe(1);
  expect(result.file).toMatchObject({ filename: 'photo.png', mimeType: 'image/png', size: 6 });
  expect(state.create).toHaveBeenCalledOnce();
  expect(state.space).toHaveBeenCalledWith('/safe/tus', 500);
  await result.file!.cleanup();
  expect(state.rm).toHaveBeenCalledWith(result.file!.path, { force: true });
});
it('supports boundaries and header separators split across streamed chunks', async () => {
  const header =
    '--test-boundary\r\nContent-Disposition: form-data; name="file"; filename="test.bin"\r\n\r\n';
  const result = await parseMultipartUpload(
    rawRequest(
      [
        header.slice(0, 5),
        header.slice(5, -1),
        header.slice(-1),
        'a'.repeat(100),
        'b'.repeat(100),
        `\r\n${end}`,
      ],
      undefined,
      '-1',
    ),
  );
  expect(result.file).toMatchObject({
    filename: 'test.bin',
    mimeType: 'application/octet-stream',
    size: 200,
  });
  expect(state.space).toHaveBeenNthCalledWith(1, '/safe/tus', 0);
});
it('rejects oversized fields', async () => {
  const body = part('Content-Disposition: form-data; name="large"', 'x'.repeat(65537)) + end;
  await expect(parseMultipartUpload(rawRequest(body))).rejects.toMatchObject({
    status: 413,
    message: 'Multipart field is too large',
  });
});
it('rejects an oversized file and removes its temporary path', async () => {
  await expect(parseMultipartUpload(request(), { maxFileBytes: 3 })).rejects.toMatchObject({
    status: 413,
  });
  expect(state.rm).toHaveBeenCalledWith(expect.any(String), { force: true });
});
it('rechecks capacity during long streaming uploads', async () => {
  const header =
    '--test-boundary\r\nContent-Disposition: form-data; name="file"; filename="test.bin"\r\n\r\n';
  const result = await parseMultipartUpload(
    rawRequest([header, 'a'.repeat(1024 * 1024), 'b'.repeat(1024 * 1024), `\r\n${end}`]),
  );
  expect(result.file?.size).toBe(2 * 1024 * 1024);
  expect(state.space.mock.calls.length).toBeGreaterThanOrEqual(3);
});
it('removes both a completed file and an incomplete following file after malformed input', async () => {
  const body =
    part('Content-Disposition: form-data; name="file"; filename="test.bin"', 'data') +
    '--test-boundary\r\nContent-Disposition: form-data; name="field"\r\n\r\nno closing boundary';
  state.rm.mockRejectedValueOnce(new Error('cleanup denied'));
  await expect(parseMultipartUpload(rawRequest(body))).rejects.toMatchObject({
    status: 400,
    message: 'Malformed multipart request',
  });
  expect(state.rm).toHaveBeenCalledOnce();
});
