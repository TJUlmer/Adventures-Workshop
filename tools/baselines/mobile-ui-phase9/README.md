# Phase 9 mobile export evidence

`evidence-manifest.json` records a phone-sized export of the fixed Phase 0
fixture. The desktop comparison must reuse the same browser document: this
keeps the renderer's loaded fonts and image cache constant while the viewport
changes, so the check isolates responsive geometry from a cold-page raster
change.

## Phone-to-desktop procedure

1. Start the dedicated development origin from the repository root:

   ```powershell
   npm run dev -- --host 127.0.0.1 --port 5174
   ```

2. Open
   <http://127.0.0.1:5174/tools/mobile-baseline/run.html?profile=mobile-ui-phase9>,
   set the browser viewport to `390×844` at 100% zoom and DPR 1, and wait for
   the title to begin with `DONE`.
3. Capture that phone output before changing the viewport:

   ```powershell
   node tools/mobile-baseline/evidence.mjs capture --manifest tools/baselines/mobile-ui-phase9/evidence-manifest.json --root exports/mobile-ui-phase9 --root exports/mobile-ui-phase9-tts
   ```

4. Do not reload or navigate away. Resize that same tab to `1440×900`, choose
   **Run again**, and wait for `DONE` again. This overwrites the profile with
   the desktop render while retaining the same document and warmed resources.
5. Run the cross-viewport gate:

   ```powershell
   node tools/mobile-baseline/evidence.mjs verify --manifest tools/baselines/mobile-ui-phase9/evidence-manifest.json --geometry-only
   ```

## Strict and geometry-only verification

Strict verification (omit `--geometry-only`) compares normalized JSON/text,
decoded pixels for supported PNGs, encoded images where decoding is not
available, and exact file names. It is the strongest same-browser,
same-platform signal and deliberately reports browser, font, GPU, or encoder
raster differences:

```powershell
node tools/mobile-baseline/evidence.mjs verify --manifest tools/baselines/mobile-ui-phase9/evidence-manifest.json
```

Geometry-only verification is the cross-viewport gate. It still requires the
same file set, ZIP entries, image dimensions, and JSON/text structure. Only in
TTS paths and normalized TTS references, it replaces an eight-hex content hash
immediately before `.jpg`, `.jpeg`, `.png`, or `.webp`; it does not canonicalize
other names or extensions. A collision between two names after that replacement
is an error, so stale content-hash files cannot hide behind one canonical path.
Image pixels and encoded byte hashes are not compared in this mode.
