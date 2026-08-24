---
inclusion: always
---

# Tech

Svelte 5 (runes) + TypeScript + Vite. Browser-first: the document and every
export are local, but the app also talks to a Supabase backend for publishing,
the gallery and collaboration — see "Cloud" below.

## Commands

```bash
npm run dev      # Vite dev server, HMR, port 5173 (honours $PORT; falls back if taken)
npm run check    # svelte-check over the project — the only gate that exists
npm run build    # runs check, then builds to dist/
npm run preview  # serve the production build
```

`npm run build` will not produce output if `svelte-check` reports anything, so
`npm run check` is the fast inner loop.

`tsconfig.json` turns on `noUnusedLocals`, `noUnusedParameters` and
`noUncheckedIndexedAccess` — an unused import or an unguarded array index is a
**build failure**, not a warning.

`Start Adventures Workshop.cmd` launches the app for non-developer use.

## No test suite

**There is no test suite and no test runner.** Correctness is verified by driving
the running app and measuring what it renders. Do not add a test framework unless
explicitly asked. See `verifying-changes.md` for the loop that actually catches
bugs here.

## Version pins

TypeScript is pinned to `~6` because `svelte-check` does not run on 7 yet. Move the
pin when `svelte-check` catches up.

## Constraints that shape everything

**Zero runtime dependencies.** `package.json` has `devDependencies` only. The ZIP
writer, the PNG rasteriser, the WebGL model viewer, the STL/OBJ parsers, the
rich-text sanitiser, and the Supabase client (`src/lib/cloud/http.ts`, hand-rolled
against plain PostgREST/Storage/Auth HTTP) are all hand-rolled for this reason.
Reach for a library only after establishing that hand-rolling is genuinely
unreasonable.

**Local-first, offline-capable.** The library — every set, indexed for the Home
screen — lives in **IndexedDB** (`src/lib/storage/`), not `localStorage`; every
user asset is embedded as a data URL so a set survives being handed to someone
else as one file. Static chrome is served from `public/assets` as stable URLs,
**never bundler-imported**. Everything about authoring a set works with no network
at all.

**Cloud is a publish target, never the source of truth.** `src/lib/cloud/` talks
to Supabase for sharing, the public gallery, forking and contributions. A
published row is a copy of a document that still lives in the author's browser —
losing the network loses sharing, never the set. See `schema-and-persistence.md`
for the persisted `SetOrigin`/fork/contribution shapes.

**Runes only.** `svelte.config.js` sets `runes: true`, so legacy `$:` reactivity
will not compile.

## Subsystems

- `src/lib/models/` — STL (binary + ASCII) and OBJ parsing into an unindexed,
  flat-shaded `Mesh`, plus `token.ts`, which *generates* a disc or an N-sided
  prism from a spec. Built at **1 unit = 1 inch** for Tabletop Simulator.
- `src/lib/threat/` + `renderer/ThreatBoard.svelte` — the threat track, laid out as
  the printed 495 × 70 mm strip and sized in `cqw` so it never needs scrolling.
- `src/lib/map/` + `renderer/MapBoard.svelte` — the adventure map: spaces, the
  paths between them, and the board they sit on. SVG rather than DOM rectangles,
  because a map is a graph, not a stack of masked chrome.
- `src/lib/figures/` — the health dial and other physical components; a `dial`
  figure is the app's own fixed component (generated mesh + Lua counter script),
  not an author-designed one.
- `src/lib/print/` — A4/Letter print sheets. A screen the browser's own print
  dialogue outputs from, not a file exporter.
- `src/lib/cloud/` — hand-rolled Supabase HTTP: auth, sets (publish/fork/gallery),
  contributions, thumbnails.
- `src/lib/text/rich-text.ts` — allowlist sanitiser. Attributes are allowlisted **by
  value**: the single permitted inline style is rebuilt from a parsed number, never
  passed through.

## Tooling outside npm

Geometry work uses **Python with PIL and numpy** to read print templates. It is a
measurement tool, not a project dependency — see `geometry.md`. `tools/` also holds
one-off asset-derivation scripts (font comparison, hero card asset splitting, skin
template generation, the hand-rolled PSD writer) — regenerate derived assets from
these rather than hand-editing them.
