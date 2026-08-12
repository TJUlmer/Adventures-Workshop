---
inclusion: always
---

# Tech

Svelte 5 (runes) + TypeScript + Vite. Browser-only, no backend.

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
writer, the PNG rasteriser, the WebGL model viewer, the STL/OBJ parsers and the
rich-text sanitiser are all hand-rolled for this reason. Reach for a library only
after establishing that hand-rolling is genuinely unreasonable.

**Local-first, offline, no backend.** The document lives in `localStorage`; every
user asset is embedded as a data URL. Static chrome is served from `public/assets`
as stable URLs, **never bundler-imported**.

**Runes only.** `svelte.config.js` sets `runes: true`, so legacy `$:` reactivity
will not compile.

## Subsystems

- `src/lib/models/` — STL (binary + ASCII) and OBJ parsing into an unindexed,
  flat-shaded `Mesh`, plus `token.ts`, which *generates* a disc or hex prism from a
  spec. Built at **1 unit = 1 inch** for Tabletop Simulator.
- `src/lib/threat/` + `renderer/ThreatBoard.svelte` — the threat track, laid out as
  the printed 495 × 70 mm strip and sized in `cqw` so it never needs scrolling.
- `src/lib/text/rich-text.ts` — allowlist sanitiser. Attributes are allowlisted **by
  value**: the single permitted inline style is rebuilt from a parsed number, never
  passed through.

## Tooling outside npm

Geometry work uses **Python with PIL and numpy** to read print templates. It is a
measurement tool, not a project dependency — see `geometry.md`.
