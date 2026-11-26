import { beforeEach, expect, it, vi } from 'vitest';
import { GET } from '@/app/og/[image]/route';

const state = vi.hoisted(() => ({ publicUrl: '' }));
vi.mock('@/lib/server/instance', () => ({
  getInstanceSettings: async () => ({ publicUrl: state.publicUrl }),
}));

function requestImage(image: string, host = 'local.example.test') {
  const request = new Request(`http://${host}/og/${image}`);
  return GET(request, { params: Promise.resolve({ image }) });
}

async function renderImage(image: string, host?: string) {
  const response = await requestImage(image, host);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/png');
  expect(response.headers.get('cache-control')).toBe('no-store');
  const png = Buffer.from(await response.arrayBuffer());
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(630);
  return png;
}

beforeEach(() => {
  state.publicUrl = '';
});

it('renders distinct previews by locale and configured public URL', async () => {
  state.publicUrl = 'https://files.example.test';
  const english = await renderImage('pixb-en.png');
  const french = await renderImage('pixb-fr.png');
  expect(english.equals(french)).toBe(false);
  expect(english.equals(await renderImage('pixb-en.png', 'another-proxy.example.test'))).toBe(true);

  state.publicUrl = 'https://photos.example.test';
  expect(english.equals(await renderImage('pixb-en.png'))).toBe(false);
});

it('renders the request origin when the public URL is unset', async () => {
  const first = await renderImage('pixb-en.png', 'first.example.test');
  const second = await renderImage('pixb-en.png', 'second.example.test');
  expect(first.equals(second)).toBe(false);
});

it('returns 404 for an unsupported image name', async () => {
  expect((await requestImage('pixb-es.png')).status).toBe(404);
});
