# Trademark policy

"PixB", the PixB logo and app icon, and "by vulptik" are trademarks of Vulptik. The code license
(AGPL-3.0-only) covers the code. It does not grant any right to these trademarks.

The rules below let people use, run and share the code freely while making sure nobody mistakes a
fork for the official app.

## Allowed without asking

- Running unmodified or modified PixB on your own server, for yourself, your household or your
  team, under the PixB name.
- Saying truthfully that your project is based on or forked from PixB, for example
  "ShelfThing, a fork of PixB".
- Writing about, reviewing, teaching or linking to PixB by name.
- Sharing unmodified official images and releases from this repository under their original name.

## Not allowed without written permission

- Distributing a modified version, its container images or an app-catalog entry under the name
  PixB or a confusingly similar name.
- Using the PixB logo or app icon, or a confusingly similar one, in a modified version, its
  images, catalog listing, website or promotion.
- Offering PixB, modified or not, as a hosted service to the public under the PixB name or logo.
- Using PixB in a product name, company name, domain name or social media account.
- Suggesting that Vulptik made, endorses or supports your version.

## If you fork PixB

Before distributing a fork, give it a new name and icon: replace the files in `public/` (logo,
favicons and `manifest.json`), the brand mark in `components/shelf/Brand.tsx`, the footer credit in
`components/shelf/SiteFooter.tsx` and `messages/`, and the image names in `compose.production.yml`.
Publish images under your own registry names. The AGPL-3.0 still requires you to keep the copyright notices
and license, and to offer your source code to everyone who uses your version over a network.

Questions or permission requests: open an issue on the PixB repository.
