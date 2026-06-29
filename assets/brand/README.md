# Brain Memory — brand icon exports

The firing-neuron "activation" mark in the technical-white identity's brand cyan
(`#46C6FF`). Regenerate everything from the canonical geometry with
`website/scripts/gen-icon.mjs` (favicons/app icon) — these files mirror that mark
for use on external surfaces.

## Which file to use

| You're placing it on…            | Use                                   |
|----------------------------------|---------------------------------------|
| A **dark** UI / near-black tile  | `icon-dark.svg` · `png/icon-dark-*.png` |
| A **light** UI / paper surface   | `icon-light.svg` · `png/icon-light-*.png` |
| A surface that already has a bg (no tile) | `mark-dark.svg` (light/white mark) · `mark-light.svg` (deep-cyan mark) |

- **Tiles** (`icon-*`) include the rounded-square background and are self-contained.
- **Marks** (`mark-*`) are transparent — the neuron only.
- **Dark** keeps the white-hot core; **light** deepens the cyans + uses a dark-cyan
  core so the mark stays legible on paper.

PNG sizes: 1024 / 512 / 256 / 128 / 64.

## Wide images

`linkedin_cover.png` / `linkedin_cover_light.png` — 6336×1584 (4× the 1584×396
LinkedIn banner): the app tile centered on a flat canvas, no text (dark =
`#252525`, light = paper). Regenerate with
`node website/scripts/gen-linkedin-cover.mjs` (writes `website/public/`).
