---
inclusion: auto
description: The verification loop for a project with no test suite, plus the traps that have already cost real time. Apply before claiming any change works, and whenever debugging rendering, fonts, canvas, layout or store state.
---

# Verifying changes

There is no test suite. This is the loop that catches real bugs:

1. **`npm run check`.** It is the only gate; `npm run build` will not emit if it
   reports anything.
2. **Drive the running app.** Start the dev server, drive the app with JS in the
   page, then **measure the rendered DOM in template-pixel space** and compare
   against the template numbers. Do not judge by eye.
3. **For anything visual, rasterise and sample.** Use `renderPlateImage` /
   `renderThreatTrackImage` and sample pixels, or check geometry by computing a
   signed volume. That is what caught an inside-out token mesh and a letterboxed
   pattern tile.

Do not start the dev server as a blocking foreground command. `.claude/launch.json`
registers it as `adventures-workshop` on port 5173 for Claude Code's preview
tooling; under Kiro, run it as a background process or have the developer start it.

## Storage and cloud changes need their own check

- **Storage lives in IndexedDB, not `localStorage`.** Verify a persistence change
  by inspecting IndexedDB directly (devtools Application tab, or driving the app
  and reading it back through `storage/library.ts`'s own functions) — do not
  assume a `localStorage` inspection tells you anything current.
- **Cloud/RLS changes should be verified by attacking them**, the same way the
  existing policies were: try the write or read a policy is supposed to refuse
  (as an anonymous caller, as a non-owner, with a stale/forged token) and confirm
  it is actually refused, not just that the intended path works. `CLAUDE.md`'s
  "Sharing and the gallery" and "Contributions" sections record what was already
  tested this way.

## Traps that have cost real time here

- **`document.fonts.ready` resolving does not mean a face is usable by canvas
  `measureText`.** Call `document.fonts.load("100px 'Family'")` first, or you will
  measure the fallback.
- **`image.decode()` can stall indefinitely** in a backgrounded renderer. Prefer
  `image.onload`.
- **Importing a store module with a `?t=` cache-buster creates a *separate* module
  instance** with empty state.
- **`clip-path` clips `box-shadow` and `outline` away entirely.**
- **A negative margin on a `flex: 1 1 0` item wins it extra width.**
- **An SVG asked for a shape that is not its own letterboxes rather than
  stretching.** This is why `patternAspect` exists.
