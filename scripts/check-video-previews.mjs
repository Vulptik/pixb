// Called by check-container-startup.mjs. Full host FFmpeg creates fixtures only;
// the disposable app must decode them with its own minimal production binary.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import sharp from 'sharp';

export async function checkVideoPreviews(origin, cookie) {
  const root = path.resolve('.local-rebuild');
  mkdirSync(root, { recursive: true });
  const work = mkdtempSync(path.join(root, 'video-check-'));
  if (!work.startsWith(root + path.sep) || !path.basename(work).startsWith('video-check-')) {
    throw new Error('Unsafe video-fixture cleanup path');
  }
  const run = (args) => {
    assert.ok(ffmpeg, 'Install full host ffmpeg-static to create test fixtures');
    const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 2 * 1024 ** 2,
    });
    assert.equal(result.status, 0, result.error?.message || result.stderr);
  };
  const source =
    'color=c=0xd7ac67:s=192x128:r=10,drawbox=x=96:y=0:w=96:h=128:color=0x426aaa:t=fill';
  const encode = (name, type, options, duration = '0.2', expectedSize) => {
    const filename = path.join(work, name);
    run(['-f', 'lavfi', '-i', source, '-t', duration, ...options, '-threads', '1', filename]);
    return { name, type, filename, expectedSize, timestamp: duration === '0.2' ? '0' : '1' };
  };
  try {
    const fixtures = [
      encode('h264-short.mp4', 'video/mp4', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p']),
      encode('h264-long.mp4', 'video/mp4', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'], '1.3'),
      encode('hevc-10bit.mov', 'video/quicktime', [
        '-c:v',
        'libx265',
        '-pix_fmt',
        'yuv420p10le',
        '-tag:v',
        'hvc1',
        '-x265-params',
        'pools=1:frame-threads=1:log-level=error',
      ]),
      encode('vp8.webm', 'video/webm', ['-c:v', 'libvpx', '-pix_fmt', 'yuv420p']),
      encode('vp9.webm', 'video/webm', ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p']),
      encode('av1.mkv', 'video/x-matroska', [
        '-c:v',
        'libaom-av1',
        '-cpu-used',
        '8',
        '-pix_fmt',
        'yuv420p',
      ]),
      encode('prores.mov', 'video/quicktime', [
        '-c:v',
        'prores_ks',
        '-profile:v',
        '2',
        '-pix_fmt',
        'yuv422p10le',
      ]),
      encode('mpeg4.avi', 'video/x-msvideo', ['-c:v', 'mpeg4', '-q:v', '2']),
      // Enough transport packets for reliable probing of the TS container.
      encode('mpeg2.ts', 'video/mp2t', ['-c:v', 'mpeg2video', '-pix_fmt', 'yuv420p'], '2'),
      encode('mjpeg.avi', 'video/x-msvideo', [
        '-c:v',
        'mjpeg',
        '-pix_fmt',
        'yuvj420p',
        '-q:v',
        '2',
      ]),
      encode(
        'anamorphic.mp4',
        'video/mp4',
        ['-vf', 'setsar=2/1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p'],
        '0.2',
        [384, 128],
      ),
    ];
    const large = path.join(work, '4k.mp4');
    run([
      '-f',
      'lavfi',
      '-i',
      'color=c=0xd7ac67:s=3840x2160:r=10,drawbox=x=1920:y=0:w=1920:h=2160:color=0x426aaa:t=fill',
      '-t',
      '0.2',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-threads',
      '1',
      '-pix_fmt',
      'yuv420p',
      large,
    ]);
    fixtures.push({
      name: '4k.mp4',
      type: 'video/mp4',
      filename: large,
      timestamp: '0',
      expectedSize: [3840, 2160],
    });
    for (const angle of [90, 180, 270]) {
      const rotated = path.join(work, `rotated-${angle}.mp4`);
      run([
        '-display_rotation:v:0',
        String(angle),
        '-i',
        fixtures[1].filename,
        '-c',
        'copy',
        rotated,
      ]);
      fixtures.push({
        name: `rotated-${angle}.mp4`,
        type: 'video/mp4',
        filename: rotated,
        timestamp: '1',
        expectedSize: angle === 180 ? [192, 128] : [128, 192],
      });
    }
    const audio = path.join(work, 'with-audio.mp4');
    run([
      '-f',
      'lavfi',
      '-i',
      source,
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=8000',
      '-t',
      '1.3',
      '-c:v',
      'libx264',
      '-threads',
      '1',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      audio,
    ]);
    fixtures.push({ name: 'with-audio.mp4', type: 'video/mp4', filename: audio, timestamp: '1' });

    for (const fixture of fixtures) {
      const original = readFileSync(fixture.filename);
      const form = new FormData();
      form.set('file', new File([original], fixture.name, { type: fixture.type }));
      const uploaded = await fetch(`${origin}/api/v1/uploads`, {
        method: 'POST',
        headers: { Cookie: cookie },
        body: form,
      });
      assert.equal(uploaded.status, 201, await uploaded.clone().text());
      const file = (await uploaded.json()).file;
      const referencePath = path.join(work, 'reference.png');
      // Independent full FFmpeg reference: retain source resolution, normalize
      // sample aspect ratio, and let FFmpeg apply the container's rotation.
      run([
        '-ss',
        fixture.timestamp,
        '-i',
        fixture.filename,
        '-map',
        '0:v:0',
        '-frames:v',
        '1',
        '-vf',
        'scale=iw*sar:ih,setsar=1',
        '-c:v',
        'png',
        '-threads',
        '1',
        referencePath,
      ]);
      const reference = readFileSync(referencePath);
      if (fixture.expectedSize) {
        const meta = await sharp(reference).metadata();
        assert.deepEqual([meta.width, meta.height], fixture.expectedSize, fixture.name);
      }
      for (const [link, width, height] of [
        [file.links.thumbnail, 200, 200],
        [file.links.poster, 1280, 720],
      ]) {
        let bytes;
        for (let i = 0; i < 100; i++) {
          const response = await fetch(new URL(new URL(link, origin).pathname, origin), {
            headers: { Cookie: cookie },
          });
          if (response.ok) {
            assert.match(response.headers.get('content-type'), /^image\/webp/);
            bytes = Buffer.from(await response.arrayBuffer());
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        assert.ok(bytes, `Missing preview: ${fixture.name}`);
        const meta = await sharp(bytes).metadata();
        assert.deepEqual([meta.width, meta.height], [width, height], fixture.name);
        const actual = await sharp(bytes).removeAlpha().raw().toBuffer();
        const expected = await sharp(reference)
          .resize(width, height, { fit: 'cover', position: 'centre' })
          .removeAlpha()
          .raw()
          .toBuffer();
        assert.equal(actual.length, expected.length);
        let error = 0;
        for (let i = 0; i < actual.length; i++) error += Math.abs(actual[i] - expected[i]);
        assert.ok(
          error / actual.length < 6,
          `Wrong preview orientation/aspect/colors: ${fixture.name} (${error / actual.length})`,
        );
      }
      const downloaded = await fetch(
        new URL(new URL(file.links.original, origin).pathname, origin),
        {
          headers: { Cookie: cookie },
        },
      );
      assert.equal(downloaded.status, 200);
      assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), original);
      console.log(`PASS video previews and original bytes: ${fixture.name}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
