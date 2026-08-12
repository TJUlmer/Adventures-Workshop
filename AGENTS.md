# AGENTS.md

Shared always-relevant context for AI coding tools working on **Adventures Workshop**.
Kiro reads this automatically; Claude Code's fuller guidance lives in `CLAUDE.md`, and
Kiro's expanded steering lives in `.kiro/steering/`. Keep all three consistent.

## Product

A local-first, offline builder for custom **Unmatched Adventures** sets — villains,
minions, initiative decks, rules and event cards, and the printable card art.
Authors are Unmatched fans, not developers. No backend, no account, no network call:
the document lives in `localStorage` and leaves the machine only on export.

Shell is three panes: set hierarchy (left), workspace editor (centre), live card
preview (right). The card editor splits **Content** (per-card) from **Design** (set once).

## Stack and commands

Svelte 5 (runes) + TypeScript + Vite. Browser only.

```bash
npm run dev      # Vite dev server, HMR, :5173
npm run check    # svelte-check — the only gate that exists
npm run build    # runs check, then builds to dist/
npm run preview  # serve the production build
```

`npm run build` emits nothing if `svelte-check` reports anything, so `npm run check`
is the inner loop. `tsconfig.json` enables `noUnusedLocals`, `noUnusedParameters` and
`noUncheckedIndexedAccess` — an unused import or unguarded index is a build failure.

TypeScript is pinned to `~6` because `svelte-check` does not run on 7 yet.

## Hard constraints

- **Zero runtime dependencies.** `package.json` has `devDependencies` only. The ZIP
  writer, PNG rasteriser, WebGL viewer, STL/OBJ parsers and rich-text sanitiser are
  hand-rolled for this reason. Only reach for a library when hand-rolling is
  genuinely unreasonable.
- **Runes only.** `svelte.config.js` sets `runes: true`; legacy `$:` will not compile.
- **No test suite, no test runner.** Do not add one unless asked. Verify by driving
  the app and measuring what it renders.
- **Static chrome is served from `public/assets`** as stable URLs, never
  bundler-imported. User assets are embedded as data URLs.

## Key conventions

- **The renderer is the export.** `src/lib/renderer/` draws cards as DOM;
  `src/lib/export/card-image.ts` photographs that same DOM. There is no second
  drawing path. Anything rasterised must render values as **text**, not in form
  controls — a control's value does not survive `cloneNode` (hence `ThreatBoard`'s
  `editable` prop).
- **Geometry is measured, not estimated.** `renderer/geometry.ts` holds numbers read
  off print templates in bleed pixels, converted to `%` and `cqw`. Text is placed by
  cap height via `capTopToBoxTop()`. Measure templates with Python/PIL; do not eyeball.
- **Nothing measures text at runtime.** Dynamic sizes fall out of flex layout
  (vertical writing mode, bottom-anchored panel).
- **Template art is a CSS alpha mask over a fill**, so shapes take any colour.
- **The document is four flat arrays** related by ID (`characters`, `decks`, `cards`);
  every grouping the UI shows is derived. `sets/queries.ts` holds the derivations.
  IDs are branded types.
- **Style cascade:** `stock template → set.style → character.style → card.style`,
  flattened by `resolveStyleForCard()`. Overrides are sparse — "inherit" is an
  absent key. Card colours are concrete values, never `var(--…)`.
- **One store:** `state/workshop.svelte.ts`. Editors read their subject from the
  store, never as a prop. Shared child editors address subjects by typed reference
  (`{ entity: 'card', id }`) and mutate through store commands.
- **Any new persisted field needs a branch in `sets/normalize.ts`**, or existing
  documents load without it. `SET_SCHEMA_VERSION` is 6; newer files are refused.
- **`src/styles/tokens.css` is the only source of colour.** No component hardcodes a hex.
- **Comments explain *why*** — usually the failure that forced the code — and never
  restate the line. Some carry a bug's history so it is not reintroduced.
- **British spelling** in prose and comments; `colour` in user-facing copy, `color`
  only where a CSS or DOM API demands it.

## Known traps

- `document.fonts.ready` does not mean canvas `measureText` can use the face — call
  `document.fonts.load("100px 'Family'")` first.
- `image.decode()` can stall in a backgrounded renderer; prefer `image.onload`.
- Importing a store with a `?t=` cache-buster creates a separate, empty instance.
- `clip-path` clips `box-shadow` and `outline` away entirely.
- A negative margin on a `flex: 1 1 0` item wins it extra width.

## Further reading

`README.md` (document model, cascade, shell in depth) · `SET-HEALTH.md` (set-health
checks) · `.kiro/steering/` (expanded, auto-loaded topic guidance).
