# Third-party notices

PixB is Copyright (c) 2026 Vulptik and licensed under [AGPL-3.0-only](LICENSE). Third-party components, fonts, and tools retain their own licenses.

## Fonts

- Lora, by Cyreal, including the Latin subset used by PixB. [SIL Open Font License and attribution](public/fonts/lora-LICENSE.txt)
- Source Sans 3, by Adobe, including the API reference face and the Latin subset used by PixB. [SIL Open Font License and attribution](public/fonts/source-sans-3-LICENSE.txt)
- JetBrains Mono, by JetBrains. [SIL Open Font License and attribution](public/fonts/jetbrains-mono-LICENSE.txt)

## Code and container components

- JavaScript dependencies are listed in [package-lock.json](package-lock.json) and carry their own license terms.
- Icons use Lucide and its Feather-derived artwork. [ISC and MIT notices](public/licenses/lucide-react.txt)
- The app container builds a separate FFmpeg executable under the LGPL. The source archive, upstream license, and build configuration are under `/opt/pixb-media/share` in the image. The build recipe is in [docker/build-video-tools.sh](docker/build-video-tools.sh).
- Sharp uses libvips, which has its own LGPL terms. The development toolchain also uses [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) under GPL-3.0-or-later.
- The companion database image is derived from the [official PostgreSQL image](https://hub.docker.com/_/postgres). PostgreSQL and packages inherited from Node.js, Debian, and Alpine retain their upstream licenses.

The README screenshot uses generated sample photographs.

## Source and trademarks

Source code: https://github.com/Vulptik/pixb

The PixB name and logo are trademarks of Vulptik and are not covered by these licenses. See [TRADEMARKS.md](TRADEMARKS.md).
