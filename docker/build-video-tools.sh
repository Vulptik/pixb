#!/bin/sh
set -eu

# Keep the maintained 5.1 branch used by the previous Debian image. Updating
# either value requires rerunning the real codec/rotation/short-clip checks.
version=5.1.10
sha256=392306d6fc45dab0e9e0ea55381e071842e83a2fb31d320aeda40477a7766293
archive="/tmp/ffmpeg-${version}.tar.xz"
prefix=/opt/pixb-media
curl --fail --location --retry 3 --connect-timeout 30 \
  "https://ffmpeg.org/releases/ffmpeg-${version}.tar.xz" -o "$archive"
printf '%s  %s\n' "$sha256" "$archive" | sha256sum --check -
mkdir -p /tmp/pixb-ffmpeg "$prefix/share/source"
tar -xJf "$archive" --strip-components=1 -C /tmp/pixb-ffmpeg
cd /tmp/pixb-ffmpeg

# Retain native decoders, demuxers and parsers rather than defining a small
# arbitrary video allowlist. No audio processing, video encoding, devices,
# playback, network protocols or optional graphics/audio libraries are needed.
# PNG frames are resized and encoded as WebP by the app's existing Sharp.
./configure \
  --prefix="$prefix" \
  --disable-autodetect --enable-libdav1d --enable-zlib \
  --disable-shared --enable-static \
  --disable-programs --enable-ffmpeg \
  --disable-doc --disable-debug --disable-network \
  --disable-avdevice --disable-postproc --disable-swresample \
  --disable-encoders --enable-encoder=png \
  --disable-muxers --enable-muxer=image2 \
  --disable-filters --enable-filter=scale,transpose,hflip,vflip,format,setsar \
  --disable-protocols --enable-protocol=file \
  --disable-hwaccels
make -j "$(nproc)"
# Copy only the executable, not the intermediate static libraries/headers.
mkdir -p "$prefix/bin"
install -m 755 ffmpeg "$prefix/bin/ffmpeg"
strip "$prefix/bin/ffmpeg"
cp COPYING.LGPLv2.1 LICENSE.md "$prefix/share/"
cp "$archive" "$prefix/share/source/"
"$prefix/bin/ffmpeg" -hide_banner -buildconf > "$prefix/share/buildconf.txt" 2>&1
printf 'FFmpeg %s\nSource: https://ffmpeg.org/releases/ffmpeg-%s.tar.xz\nSHA256: %s\n' \
  "$version" "$version" "$sha256" > "$prefix/share/source/README.txt"
