# AGENTS.md

Shared always-relevant context for AI coding tools working on **Unmatched Labs**.
Kiro reads this automatically; Claude Code's fuller guidance lives in `CLAUDE.md`, and
Kiro's expanded steering lives in `.kiro/steering/`. Keep all three consistent.

## Product

A local-first builder for custom **Unmatched Adventures** sets — heroes, villains,
minions, initiative decks, rules and event cards, the adventure map, threat track,
and the printable card art. Authors are Unmatched fans, not developers. Authoring
works fully offline: the document lives in the browser (IndexedDB) and leaves the
machine only on export. Signing in is optional, needed only to publish, share, or
contribute back — the cloud (`src/lib/cloud/`, hand-rolled Supabase HTTP) is a
publish target, never the source of truth.

Shell is three panes: set hierarchy (left), workspace editor (centre), live card
preview (right). The card editor splits **Content** (per-card) from **Design** (set once).

## Stack and commands

Svelte 5 (runes) + TypeScript + Vite.

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
  writer, PNG rasteriser, WebGL viewer, STL/OBJ parsers, rich-text sanitiser and the
  Supabase client are all hand-rolled for this reason. Only reach for a library when
  hand-rolling is genuinely unreasonable.
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
  `editable` prop). Print sheets (`src/lib/print/`) are a browser-print screen, not
  a file exporter — there is no `print-pdf` slot.
- **Geometry is measured, not estimated.** `renderer/geometry.ts` holds numbers read
  off print templates in bleed pixels, converted to `%` and `cqw`. Text is placed by
  cap height via `capTopToBoxTop()`. Measure templates with Python/PIL; do not eyeball.
- **Nothing measures text at runtime.** Dynamic sizes fall out of flex layout
  (vertical writing mode, bottom-anchored panel).
- **Template art is a CSS alpha mask over a fill**, so shapes take any colour.
- **The document is four flat arrays** related by ID (`characters`, `decks`, `cards`),
  plus set-level singletons (style, threat track, map); every grouping the UI shows is
  derived. `sets/queries.ts` holds the derivations. IDs are branded types, preserved
  across a fork except the set's own.
- **Style cascade:** `stock template → set.style → character.style → card.style`,
  flattened by `resolveStyleForCard()`. Overrides are sparse — "inherit" is an
  absent key. Card colours are concrete values, never `var(--…)`. The hero character
  card is the one card that does not go through this cascade.
- **Roles:** `hero`, `villain`, `minion`, `sidekick` — `sidekick` is a field on a
  hero (`Character.sidekick`), not a directly-selectable roster role.
- **One store:** `state/workshop.svelte.ts`. Editors read their subject from the
  store, never as a prop. Shared child editors address subjects by typed reference
  (`{ entity: 'card', id }`) and mutate through store commands. Library commands are
  `async` (IndexedDB has no sync API).
- **Any new persisted field needs a branch in `sets/normalize.ts`**, or existing
  documents load without it. `SET_SCHEMA_VERSION` is 31; newer files are refused.
  `normalizeSet` must be idempotent.
- **`src/styles/tokens.css` is the only source of colour.** No component hardcodes a hex.
- **Comments explain *why*** — usually the failure that forced the code — and never
  restate the line. Some carry a bug's history so it is not reintroduced.
- **British spelling** in prose and comments; `colour` in user-facing copy, `color`
  only where a CSS or DOM API demands it.

## Persistence and cloud

- **Storage is IndexedDB** (`src/lib/storage/`), not `localStorage` — it moved
  because `localStorage`'s ~5MB-per-origin ceiling was too small for embedded
  artwork. Migration from the old `localStorage` library is automatic and runs
  on every startup.
- **Deleting a set is a soft delete** (`deletedAt` on its index row); permanent
  removal is a separate, explicit "Delete forever" action.
- **Cloud reads that are meant to be public must never carry a user's own access
  token** — a stale token breaks the read for its own owner while strangers see it
  fine. RLS is the actual security boundary, not the client.
- **A fork preserves every entity id and records a per-entity content hash**
  (`SetOrigin.fingerprint`) at copy time, because there is no server-side revision
  history to diff against later.
- **A contribution is a proposal only** — accepting one mutates the owner's own
  document in their own browser; the database row never lets a stranger's write
  touch a published set directly.

## Known traps

- `document.fonts.ready` does not mean canvas `measureText` can use the face — call
  `document.fonts.load("100px 'Family'")` first.
- `image.decode()` can stall in a backgrounded renderer; prefer `image.onload`.
- Importing a store with a `?t=` cache-buster creates a separate, empty instance.
- `clip-path` clips `box-shadow` and `outline` away entirely.
- A negative margin on a `flex: 1 1 0` item wins it extra width.

## Further reading

`README.md` (document model, cascade, shell), `CLAUDE.md` (full architecture,
including cloud/gallery/contributions/hero/map detail), `CHANGELOG.md` (how it
was built and what is still open), `COLLABORATION.md` (fork/contribution design),
`SET-HEALTH.md` (set-health checks), `.kiro/steering/` (expanded, auto-loaded
topic guidance).
