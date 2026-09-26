# Mobile UI Phase 0 baseline

This baseline separates two kinds of evidence:

- **Rendered output** comes from a deterministic set document and the application’s real exporters.
- **UI screenshots** come from the real application at fixed viewports on an isolated local origin.

Neither workflow needs a package dependency. The exporter page builds its document in memory and never
imports the workshop store, so it cannot change IndexedDB or the last-open set. The screenshot controller
is guarded by `import.meta.env.DEV` and an explicit query parameter, and is removed from production builds.

## Generate rendered-output evidence

From the repository root, start a dedicated development origin:

```powershell
npm run dev -- --host 127.0.0.1 --port 5174
```

Open <http://127.0.0.1:5174/tools/mobile-baseline/run.html>. Wait until the page title begins with
`DONE`. The page does all of the following through the existing development-only export endpoint:

1. creates the Phase 0 fixture with fixed IDs and timestamps;
2. round-trips it through `parseSetFile` without touching the workshop store;
3. writes `exports/mobile-ui-baseline/fixture.awset.json`;
4. writes trim and bleed card ZIPs plus direct map and threat PNGs;
5. runs the normal Tabletop Simulator exporter into `exports/mobile-ui-baseline-tts`.

The frozen fixture and selected rendered artefacts used as the durable Phase 0 record live in
`tools/baselines/mobile-ui-phase0/`. Regenerate into `exports/` first, compare deliberately, and only
replace committed evidence when an output change is accepted.

Capture or refresh the manifest with Node’s built-in modules only:

```powershell
node tools/mobile-baseline/evidence.mjs capture
node tools/mobile-baseline/evidence.mjs verify
```

`verify --geometry-only` is the cross-machine gate. It checks image dimensions while tolerating pixel
differences caused by browser, OS, GPU, and font rasterisation. Ordinary verification decodes supported
PNGs, reverses their scanline filters, and hashes the resulting pixel samples. This compares actual pixels
rather than unstable encoder output.

### What is intentionally normalised

- Card ZIP container hashes are informational because the hand-rolled ZIP writer records the current
  DOS timestamp. Every stored entry is hashed independently and compared instead.
- `.awset.json` files normalise `exportedAt`.
- Tabletop Simulator save files normalise their `Date` field and the absolute `file:///` path leading
  to `mobile-ui-baseline-tts`.
- Text import instructions normalise the corresponding absolute Windows path.

Raw PNG hashes remain informational because the browser encoder can produce different container bytes for
identical pixels. JPEGs and unsupported PNG variants still use their encoded hashes. A decoded-pixel
mismatch with matching dimensions means the visual output changed, not necessarily its geometry; review
it on the recorded platform before accepting it.

## Capture UI screenshots

Use the same dedicated origin so the fixed fixture belongs to a separate IndexedDB database from the
author’s normal `:5173` library. Do not clear either origin.

1. Open <http://127.0.0.1:5174/tools/mobile-baseline/load.html> and choose **Load fixed fixture**.
   The loader also fixes light theme and the 424px desktop preview preference on this isolated origin.
2. Open Cards, select **Breakwater**, and leave its **Content** section active.
3. Navigate to
   <http://127.0.0.1:5174/?mobile-baseline=1&mobile-baseline-view=cards>.
4. Set the browser viewport itself to `320×568`, `390×844`, `1024×768`, then `1440×900` at
   100% zoom and DPR 1.
5. At each size choose **Capture baseline PNG** in the development-only controller. Wait for its
   completion status before changing the viewport.
6. Review the raw files in `exports/guides-raw/mobile-ui-phase0/`, then copy accepted captures to
   `tools/baselines/mobile-ui-phase0/screenshots/` and refresh the evidence manifest.

The controller mirrors live form values before using `renderPlateImage`, flattens the backdrop, and
writes a PNG with the exact viewport dimensions. Do not use `tools/guide-shots.py` for regression
evidence: it crops and converts screenshots to lossy WebP for documentation.

Phase 0’s durable screenshot scope is the Cards Content workspace at its phone, tablet, and desktop
pane states. Later phases should add route- or theme-specific captures when they change those surfaces.
The active view, selection, viewport, theme, browser, OS, and fixture SHA are recorded in the baseline
metadata and provenance files.

## Expected rendered dimensions

These are geometry gates, independent of pixel hashes:

| Artefact | Trim | Bleed |
|---|---:|---:|
| Action / hero character card | 1478×2065 | 1632×2222 |
| Rules portrait | 1478×2065 | 1632×2218 |
| Rules landscape | 2064×1478 | 2218×1632 |
| Initiative | 1326×2020 | 1524×2232 |
| Event | 2033×1335 | 2232×1524 |
| Threat board | 1637×232 | n/a |
| Large map | 1637×1131 | n/a |

The non-hero deck back is currently 373×520. TTS sheets are capped at 3072 pixels and use JPEG for
faces; their exact grid depends on the expanded card quantities in the fixture.
