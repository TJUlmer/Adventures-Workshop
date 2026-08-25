# Supplying your own guide content

This folder is a drop zone, not a build input — nothing in the app reads
from here directly. It exists so you can hand over screenshots and step
text without going through the capture tooling in `tools/`.

## Layout

One subfolder per guide, named however you like (it doesn't have to match
the guide's eventual `id`):

```
guides-intake/
  sharing-a-set/
    01-export-panel.png
    02-copy-link.png
    notes.md
```

**Images** — any common format (PNG, JPG, WebP), any size, any names.
`tools/guide-shots.py` converts whatever it finds here straight to WebP in
`public/assets/guides/<subfolder-name>/`, keeping the original filename —
no cropping, no trimming, no resizing. Unlike the automated capture path
(`exports/guides-raw/`), these are assumed to already be framed exactly
the way you want them to end up.

Run it after adding files:

```bash
python tools/guide-shots.py
```

**Step text** — a plain `notes.md` (or `.txt`) in the same subfolder, one
step per section, in whatever shape is easiest for you to write — numbered
list, one paragraph per step, a rough sketch of what each screenshot shows.
It isn't parsed by anything; it's there for whoever wires the guide into
`src/lib/guides/content.ts` to read alongside the images.

## What happens next

Once the images and notes are here, the actual guide entry — the text as
it will read on the card, which screenshot goes with which step, and where
the hotspot boxes sit on each — still has to be written into
`src/lib/guides/content.ts` by hand (or by asking Claude to do it from what's
in this folder). This folder only gets the raw material into the repo; nothing
here is live until an entry references it.
