# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Vite dev server, HMR, port 5173 (honours $PORT; falls back if taken)
npm run check    # svelte-check over the project — the only gate that exists
npm run build    # runs check, then builds to dist/
npm run preview  # serve the production build
```

`npm run build` will not produce output if `svelte-check` reports anything, so
`npm run check` is the fast inner loop. `tsconfig.json` turns on
`noUnusedLocals`, `noUnusedParameters` and `noUncheckedIndexedAccess` — an unused
import or an unguarded array index is a build failure, not a warning.

`.claude/launch.json` is configured, so the preview tooling can start the dev
server by name (`adventures-workshop`).

**There is no test suite and no test runner.** Correctness here is verified by
driving the running app and measuring what it renders — see *Verifying changes*.

TypeScript is pinned to `~6` because `svelte-check` does not run on 7 yet.

## Constraints that shape everything

**Zero runtime dependencies.** `package.json` has `devDependencies` only. The
ZIP writer, the PNG rasteriser, the WebGL model viewer, the STL/OBJ parsers and
the rich-text sanitiser are all hand-rolled for this reason. Reach for a library
only after establishing that hand-rolling is genuinely unreasonable.

**Local-first, offline, no backend.** The library — every set, indexed for the
Home screen — lives in IndexedDB, in `src/lib/storage/`; every user asset
(artwork, models, replacement images) is embedded as a data URL so a set
survives being handed to someone else as one file. Static chrome is served
from `public/assets` as stable URLs, never bundler-imported.

It was `localStorage` at first, and moved for a reason worth keeping: that
store is small — commonly around 5MB, **per origin**, shared across every set
in the library rather than metered per set — and a data URL costs its
picture's raw bytes plus another third on top for the base64 encoding. An
unedited camera photo routinely arrives at 3-10MB, so importing one was
enough on its own to leave nothing for the rest of the document, reported
only once autosave next ran, as a bare "storage is full" with no hint that a
single picture was the whole cause. IndexedDB's own ceiling is tied to
available disk space instead — commonly hundreds of megabytes at minimum —
which is the room a library of dozens of sets, each with its own artwork,
actually needs. `storage/indexeddb.ts` is the whole of the browser API this
touches, hand-rolled to the same zero-dependency rule as everything else; two
object stores, `sets` and `meta`, opened once and reused. `storage/library.ts`
builds the library on top of it, and every function there is `async` as a
result — there is no synchronous IndexedDB API to have kept any of it on. A
browser that still has the old `localStorage`-backed library, or older still
the single pre-library document, adopts it into IndexedDB once, automatically,
on first load after the upgrade (`migrateLibraryFromLocalStorage`,
`migrateLegacyDocument` in `storage/library.ts`) — idempotent and resumable,
so an interrupted migration leaves the old data in place to pick up next time
rather than losing it. `App.svelte` gates its first paint on that migration
and the session restore it is part of (`sessionReady`), because both are async
where they used to resolve before Svelte rendered at all, and rendering the
routes unconditionally in the meantime would show the Home screen and then
jump to whatever set was actually open.

**Deleting a set from the shelf is a soft delete.** One click on the trash
icon used to be exactly that final — `deleteSet` called `idbDelete` outright —
until an author lost work to it with nothing to undo. `deleteSet` now stamps
the index row's `LibraryEntry.deletedAt` and leaves the document in `SETS_STORE`
untouched; `activeEntries`/`deletedEntries` split one `readIndex()` read into
the ordinary shelf and Home's own "Recently deleted" section
(`workshop.library`/`workshop.deletedLibrary`, refreshed together by
`refreshLibrary()` so the two can never disagree about which bucket a row is
in). `restoreSet` clears the flag; `purgeSet` is the old unconditional
behaviour, renamed, and reachable only from "Delete forever" inside Recently
Deleted — nothing else in the app calls it, so losing a set for good is always
a second, separate decision from the first click. The one trap: `saveSet`
rebuilds its index row from `toEntry(set, …)` on every write, including
autosave, and `toEntry` has no notion of `deletedAt` at all — without
carrying the flag forward explicitly, the next autosave on a set sitting in
Recently Deleted would silently restore it. No sweep ever purges an old
deletion automatically; Recently Deleted holds everything until an author
acts on it.

Downscaling large images stays worth doing independently of which store backs
the library — see `core/image-import.ts`. `readArtworkFile` is what every
"choose an image" control in the app reads a file through: it decodes, and if
the picture is larger than it will ever need to be printed
(`ARTWORK_MAX_DIMENSION`, well above every card face's own bleed size),
downscales and re-encodes it before it ever reaches the document. A picture
already small enough is returned exactly as read; nothing here is lossy for a
file that did not need touching. IndexedDB lifted the acute ceiling this was
first built to relieve, but a library of unresized photos is still needless
weight on every parse, hash and save.

The one exception is `exports/`, and it earns itself. The `exports-folder`
plugin in `vite.config.ts` answers `/__workshop/export`: `GET` says where the
folder is, `POST` writes one file into it, and `DELETE` prunes a bundle folder
down to a manifest of the files that should survive.

`DELETE` is the only destructive thing in the app, so it is fenced harder than
the rest: one path segment directly under `exports/` (not the four `POST`
allows), a resolved-path containment check independent of the `SEGMENT` regex,
symlinks skipped rather than followed, only files removed and only ones the walk
itself found, directories removed only once empty, and an empty manifest
**refused** — because "keep nothing" is what a bug asks for, never a finished
export. It runs *after* the new files are written, so a failed export leaves the
previous good one intact. It exists because Tabletop Simulator
refers to card art by URL and will not read a data URI, so a TTS save is only
usable once its images have an address — and a page cannot learn its own
absolute path, while the dev server can. Dev only (`apply: 'serve'`), confined
to `exports/`, and every path segment matched against a slug-shaped pattern.
Nothing else in the app may depend on it. It is now only the direct-write
convenience for an explicitly local TTS export; the default online route never
probes it, because discovering a dev server must not silently turn a promised
multiplayer export back into one machine's `file://` save.

**Runes only.** `svelte.config.js` sets `runes: true`, so legacy `$:` reactivity
will not compile.

## Architecture

`README.md` covers the document model, the style cascade and the shell layout in
depth. What follows is what it does not, or where it has drifted.

### The renderer is the export

`src/lib/renderer/` draws cards as DOM, and `src/lib/export/card-image.ts`
photographs that same DOM. There is no second drawing path — an export that
redrew cards its own way would drift from what the author approved.

Rasterising goes: clone the live node → lay the clone out **at print size** →
freeze every computed style inline → rewrite asset URLs to data URIs → wrap in
an SVG `foreignObject` → draw to a canvas. Each step exists because of a
specific failure, documented in the file. The ones that bite:

- The clone **must** be sized before styles are read. Computed values are *used*
  values, so freezing a 411px preview's numbers renders the card at quarter
  scale in a corner.
- Computed `mask-image` URLs come back absolute, and serialisation escapes
  quotes — so URL rewriting happens on the DOM, before serialising.
- **A form control's text is a property, not an attribute, and does not survive
  `cloneNode`.** Anything rasterised must render its values as text.
  `ThreatBoard.svelte` takes an `editable` prop for exactly this: on for the
  editor, off for the exporter.

### The Tabletop Simulator export

Three files, split by what they know:

- `tabletop-simulator.ts` — which piles a set makes, and the object graph. Pure,
  no DOM.
- `tts-sheets.ts` — a pile drawn onto one sheet. TTS reads a deck as a single
  image plus a grid, at most 10 × 7 and never over 4096px a side, so cell size
  is *derived* from the card count rather than fixed.
- `tts-bundle.ts` — renders once against an explicit `online` or `local` hosting
  target. Online returns one saved-object JSON after its dependencies are
  uploaded; local writes to `exports/` or falls back to a ZIP.
- `cloud/tts-assets.ts` — establishes the author's Supabase identity and hosts
  generated sheets, boards, textures and OBJ meshes in the public `tts-assets`
  bucket. Its only interface to the exporter is deterministic `urlFor` plus a
  bounded `upload`, so storage-provider details never enter object planning.

Online is deliberately the export panel's default rather than a second export
mode: multiplayer is the least surprising result. Every hosted filename carries
the bytes' hash, including the otherwise-fixed health-dial meshes, because TTS
caches assets by URL and must receive a new URL after any generated file changes.
Public `HEAD` checks reuse unchanged objects; upload failure aborts the export
instead of quietly returning a local save. The local option remains for fully
offline work, requires the Saved Objects path, and its instructions document
TTS's own Cloud Manager → Upload All route for converting that save later.

The hosted URLs belong only to the exported JSON. They never replace embedded
data URLs in the IndexedDB document, so authoring remains local-first and works
offline. An online export creates an anonymous Supabase identity when necessary;
the UI says plainly that the temporary identity belongs to this browser. Public
objects live under `<owner-id>/<set-id>/<content-hashed filename>`, enforced by
`supabase/migrations/0012_tts_assets.sql`. Imported TTS saved objects are opaque:
if their JSON still points at `file://`, drive-letter or UNC assets, the exporter
cannot upload bytes it was never given and warns the author to use Upload All.

The piles are **one per figure**, plus rules, initiative and events — the
author's decks merged by who holds them, then split by card format because a TTS
sheet has one cell size. That split is also what gets the two scales right:
every object's `Transform` is a **uniform** scale, `mm.height / 88` against the
poker card TTS hands out, and the card's *shape* is left to the face image's
aspect ratio. This is a trap worth remembering — a custom card already takes its
proportions from the image, so scaling the axes separately applies the aspect a
second time: it stretched every event card flat and blew the threat track out to
eight times its width. Uniform, sized by height, is the fix (and what the
hand-made Oz export did). The threat track is a `CardCustom` at 70/88, its 7:1
strip carried by a 7:1 image. A pile of one card is a `CardCustom`, not a
one-card deck.

Components come through too, in precedence order: a **health dial** is the app's
own fixed component (see below); an attached TTS saved object is spliced in whole
(only its position is ours); a generated token is written as `.obj` + `.png` and
referenced as a `Custom_Model`; an attached mesh last. A dial with no name shows
"{character}'s health dial" once a figure is assigned — `figureLabel(figure,
ownerName)`.

### The health dial

A plain 50.8mm disc with the current health drawn across it and a trigger either
side. It is the app's component rather than the author's, so a `dial` figure
carries only the face image and a `dialRange`; `figures/health-dial.ts` owns the
rest.

The **mesh is generated**, not shipped — it is a circle, which is exactly what
`models/token.ts` already makes, so `HEALTH_DIAL_SPEC` is a `TokenSpec` and the
preview, the export and any future print all read the same one. One `.obj` is
written per export however many dials a set has, since the spec is fixed. The
face goes through `buildTokenArt`, which is what gets it the square the disc
samples and a band of rim colour round the edge; hand it the raw picture and it
arrives stretched with an unpainted rim.

The **saved object is** still a file, because a TTS component is more than a
mesh: `public/assets/templates/health dial.json` carries the counter's Lua and
the material, and export splices in the mesh URL, the face and the range —
`MIN_VALUE`/`MAX_VALUE`/`VALUE` rewritten in place via `models/tts.ts`'s
`readLuaConfig`/`writeLuaConfig`, which reads that table a line at a time rather
than as Lua. Keep every entry a plain scalar on its own line and the closing
brace in the first column. The script is a JSON string, so the readable way to
change it is to spawn the object in Tabletop Simulator, edit it there and save
it back out.

The Lua puts its triggers at **0.6 of the disc's radius**, in the model's own
units — which are inches. Change `HEALTH_DIAL_SPEC.diameterMm` without moving
them and they walk off the face.

Its buttons are measured in a unit of TTS's own, and the conversion was read off
the game rather than guessed: **about 700 button units to the model's inch**, from
a label set at 600 drawing its figures 0.857in tall on the two-inch disc.

Two rules about those buttons cost five rounds between them, both written up at
the head of the script. The one worth carrying away:

> **A TTS button with a transparent background draws no label.** Not a faint
> one — none, while the button stays perfectly clickable with a working tooltip.
> `color`'s alpha at nought and the text is simply absent.

That is where the dial's number went three times, and why its arrows were never
visible in *any* version — they were drawn on a clear background from the first
draft, which looks like the tidy thing to do. The other rule is that `draw` must
never call `self.clearButtons()`: clearing and creating in the same frame takes
the new buttons with the old, and the dial spawns bare.

A corollary worth knowing before believing anything else about TTS buttons: both
failures look identical to a label that is too big for its rect, so a lot of what
was concluded about rect sizes along the way was measured against contaminated
evidence. The rect proportions in the script are known to work, not known to be
minimal.

There was a supplied `Health Dial.obj` and a third-party saved object here until
the project could not get permission to redistribute them. Nothing of either
survives; that is why the dial is generated rather than shipped. The same went
for the two-sided token's Photoshop template, and for the sidekick token example
that came out of it.

Generated tokens (`models/token.ts`) are a flat prism the art wraps onto:
`circle`, or `polygon` with a side count (a hexagon is six sides — the old `hex`
shape, migrated on load). `diameterMm` is across the flats; a polygon's corners
follow. `twoSided` splits the reference image down the middle — front on the
left, back on the right — mapping each half to one face; otherwise the one
picture is shown on both and a rim-colour band fills the edge.

**`faceGeometry`'s `artExtent` and `tokenArtLayout` are one decision in two
places, and neither can be changed alone.** The art region of the texture
carries the *face's own aspect*, and the mesh maps the face onto it per-axis
(`u` to `extentX`, `t` to `extentZ`). That is a uniform mapping only because
the two agree; break the pairing either way and the picture distorts. Getting
this wrong took four passes, each of which looked like a fix and moved the
symptom somewhere else, so the failure modes are worth keeping:

- **Corner reach in the UV normalisation.** `points` are built at the true
  circumradius, which *has* to vary with side count. Feeding that same
  `unitRadius = 1/cos(π/sides)` into the normalisation (2.0 for a triangle,
  1.035 for a dodecagon) made the same flat-edge point sample a different
  fraction of the texture per `sides` — changing the shape read as the picture
  zooming, with `diameterMm` never having moved.
- **A square art region mapped per-axis onto a rectangular face** — the
  straightforward stretch.
- **A square art region mapped by one shared `Math.min(extentX, extentZ)`.**
  This stops the stretch, and is the trap: it looks correct on every regular
  piece and is *worse* on a rectangular one. The art is pinned to the largest
  square the face inscribes, so a wide piece bands its long axis with rim
  colour that **no `lengthMm` or `diameterMm` can ever trim off** — the
  letterbox belongs to the texture, not to the piece, so resizing the piece
  cannot touch it. Reported, correctly, as "it still distorts and I can't get
  rid of the rim."
- **Clamping UV to `[0,1]` in the mesh.** A vertex UV is baked once and then
  *linearly interpolated* across the triangle. A square's four corners sit on
  the diagonal, so all four clamp on both axes to a different corner of the
  texture — and a rasteriser handed that stretches the whole texture across the
  whole face. Indistinguishable from the first bug, produced a stage later.
  The clamp belongs to the texture's wrap mode (`models/gl.ts` sets
  `CLAMP_TO_EDGE`), which acts per *fragment*, after interpolation.

So a polygon's corners deliberately reach past the frame and sample the art's
edge pixel — in practice the rim colour a mismatched photo already sits on
(`buildTokenTexture` fits, never fills). Match the picture's aspect to the
piece's and it reaches every edge; a source that does not yet reach its
corners is the fix, not a mask.

Worth asserting rather than eyeballing, because every wrong version above
still *renders*: map a circle through the texture and back out through the
mesh's own UV into model millimetres, and check it is still circular. A
non-uniform mapping shows up immediately as an aspect other than 1.

One consequence to remember: the texture now depends on the piece's
proportions, not only its picture. `FiguresPanel`'s texture cache key carries
`tokenFaceAspect` for that reason — without it, resizing a piece rebuilds the
mesh against a texture still cut for the old shape, which from outside is
indistinguishable from the resize doing nothing at all.

A figure's reference image is a full `Artwork` (`core/artwork.ts` — the same
crop/transform/adjustments/effects block a card's own art uses), reachable
through `workshop.artworkFor({entity: 'figure', id})` like every other
artwork-owning entity. Only `transform.scale` is wired to the token pipeline
today, as **Zoom** in `FiguresPanel`, for one-sided and two-sided art alike.
`zoom` multiplies the existing fit-to-region scale rather than replacing it
with `ArtLayout`'s usual "1 = cover" convention: cover-by-default is what
every other `Artwork` consumer does, but a token's own "fit, not fill" is a
deliberate, previously-documented choice (the paragraph above), and
cover-by-default would have silently recropped every existing token's art the
moment this shipped. `scale = 1` therefore still means exactly the fit it
always meant; zooming in is what crops past it, clipped to the art region so
it cannot bleed into the rim strip below. Crop, colour grade and mask are wired into `artworkFor` the same as
everywhere else but not yet read by the token texture builder — reachable, not
yet applied.

### Silhouette tokens

A third `TokenShape` beside circle and polygon: the piece's own outline,
traced from its art's alpha channel rather than chosen from a fixed list of
regular shapes. Tabletop Simulator has an engine-side "Custom Token" feature
that does something similar, but only for the export — the app's own WebGL
preview would still show a disc. Full parity meant tracing, simplifying and
triangulating the outline **in this codebase**, so the same mesh serves the
live preview and every export, same as every other generated token. No
contour-tracing or polygon-triangulation code existed anywhere here before
this; `src/lib/models/silhouette.ts` is all of it, pure and DOM-free —
threshold → morphological open → largest connected region → Moore-neighbour
boundary trace (Jacob's stopping criterion, so a one-pixel neck cannot
truncate the loop early) → closed-loop Douglas-Peucker simplification → ear
clipping. `faceGeometry` (`models/token.ts`) reads the result as a fourth kind
of face alongside circle and polygon; the fan-from-`points[0]`
triangulation every existing shape used only works for a convex polygon, so
`buildTokenMesh` dispatches to `earClip` for `'silhouette'` and keeps the fan
(now `fanIndices`) for the other two, which never needed real triangulation
and still don't.

**Deliberately out of scope for v1**: only the largest connected alpha region
is traced — no interior holes, no disjoint islands — which is what keeps the
result a single closed loop and the rim-wall code (`i → (i+1) % n`) untouched.
A two-sided piece's outline comes from the front half only; both faces share
it. A trace that fails for any reason — no usable alpha, a polygon that still
self-intersects after simplification — is `null`, and `faceGeometry` falls
through to the circle every token already was, never to a fan drawn over a
concave polygon (which renders as visible spikes and reads as a bug, not a
limitation).

**The morphological open pass (erode then dilate, 3×3) is not optional
polish — it is what keeps the traced polygon simple.** Antialiased edges and
soft shadows in ordinary author artwork produce speckle and pixel-wide necks
that a raw boundary trace turns into a self-intersecting polygon, which ear
clipping cannot triangulate. It is also why a thin appendage — a sword, a
wisp of smoke — can get amputated in the trace: a heuristic, not a defect,
and the reason the Detail slider and an honest "could not trace this" message
both ship rather than being deferred as polish.

**A cross product's argument order is not a stylistic choice, and getting it
backwards fails silently.** `earClip`'s convexity test needs
`turn(prev, cur, next)` — the signed area at `cur`, ears the right way round.
It shipped as `turn(cur, prev, next)`, cross-product-equivalent to
`turn(prev, next, cur)`, which inverts every vertex's convexity: every
genuinely convex vertex read as reflex, no ear was ever found, and `earClip`
returned zero triangles for anything but a literal triangle. Every shape this
would have affected still *renders* — `faceGeometry` falls back to a circle
on any `earClip` failure — so the bug never crashed or looked wrong on
screen; a scratch harness catching it needed to assert triangle count
against `points.length - 2` and triangulated area against the polygon's own
shoelace area, exactly the "measure, don't eyeball" discipline this file
already holds itself to elsewhere. Renamed to `turn(a, b, c)` with a doc
comment naming the trap, since the function reads identically correct with
either argument order and only the sign tells you which one you have.

**The traced outline is persisted on the document, not computed on demand.**
Tracing needs a decoded image and a canvas — genuinely async — while
`buildTokenMesh` and everything downstream of it (the WebGL preview, every
exporter) needs to stay synchronous, the same as circle and polygon always
were. `TokenBuild.outline` (`figures/types.ts`) is the traced result;
`FiguresPanel` runs a debounced (~250ms) `$effect` that retraces on any
change to the source image, its zoom, two-sidedness or the Outline detail
slider, and writes the result back through `workshop.editFigure` once it
resolves — guarded by a monotonic per-figure run token so a fast slider drag
can't let a stale in-flight trace overwrite a newer one. The **previous**
outline stays on the document and in the preview while a retrace is in
flight; nothing here ever blanks to a circle mid-drag. Every *reader* —
`exportTokenModel`, the TTS bundle exporter, `AssetsOverview`'s snapshot —
calls `resolvedTokenSpec(figure, spec)` instead of using
`tokenSpecOf(figure.token)` directly: read-only, it retraces on the spot only
if the stored outline's key no longer matches the current source (a content
hash of the image plus aspect, zoom, two-sidedness and detail — see
`outlineKey`), and never writes to the document itself. Only the editor's own
effect writes; every export and preview path only ever resolves.

**`artPlacement` is one function read by both the printed texture and the
traced outline, and it has to be — this file already has a long history of
UV-mapping bugs in exactly this spot.** It used to be inline math inside
`buildTokenTexture` (`export/token-model.ts`); extracting it is what
guarantees the outline traced from the art and the picture actually printed
on the face agree about where the art sits. The alpha the tracer reads comes
from compositing the artwork **alone** at `artPlacement`'s placement — not
`buildTokenTexture`'s finished, rim-filled canvas, which is opaque everywhere
and would trace a rectangle every time.

**`Convex: true` in the Tabletop Simulator export was hardcoded, with a
comment reasoning that every app-generated mesh is a token or a miniature —
true until this shape.** A concave silhouette given a convex TTS collider
collides and stacks as its bounding hull rather than its actual outline.
`TtsModelComponent` gained an optional `convex` field (`export/
tabletop-simulator.ts`), defaulting to `true`, set `false` only for a
silhouette spec — found by re-reading `modelObject` directly rather than
trusting the comment, which was exactly the kind of stale justification this
codebase warns about elsewhere.

Schema v36 (`sets/types.ts`) adds `shape: 'silhouette'`, `TokenBuild.outline`
and `.outlineDetail`. `sets/normalize.ts` validates a stored outline
point-by-point — even length, no `NaN`, a string `key`, a hard length cap —
and drops it to `null` on anything malformed, same as every other
`normalizeSet` repair; it never rewrites `shape` back to `'circle'` itself,
because that would be permanent data loss where falling through to the
circle in `faceGeometry` is transient and self-healing the moment a fresh
trace lands. An older build opening a v36 document simply doesn't recognise
`'silhouette'` and repairs it the same way it repairs any other unrecognised
enum value — silently dropping the trace, which is the whole reason for the
version bump.

### The hero role

Villain and minion have always been the two selectable roles; `hero` is the
third, and — deliberately — the only new thing about it at the data-model
level is small. Health, move, attack type and ability text already existed on
`Character` for other reasons (the health dial's range, a figure's stat
block) and simply had nowhere to print before now.

**A hero's action card is one field, not a new card type.** `ActionCard.type`
stays `'action'`; `symbol` (one of the four combat symbols), `symbolValue` and
`owner` (`hero` / `sidekick` / `any` — who may play it) are new fields, read
only when the owning character's role is `hero`. Everywhere else —
`ActionCardFace`'s artwork, divider, boost disc, title, and the ability text's
own left-aligned layout the moment there are no attack/defense values to
separate it from — a hero card falls through the same code path a villain's
does, unchanged, because it was already correct. `symbol` is a **card type**
in the editor, not a "symbol": four short fixed choices with a visible effect
on the card, so it is a toggle beside "who may play this card" rather than a
menu. A `scheme` card prints no value at all — that is what the symbol means,
and it is why its glyph is drawn tall enough to fill the head on its own — so
the value control disappears rather than sitting at nought.

**Frame and ribbon are their own art, split out of one supplied file.**
`hero_action_card_border.png` paints the frame, the ribbon's head and a
leftover boost numeral into one picture; `tools/hero-card-assets.py` takes
them apart into `hero_action_frame.png`, `hero_action_ribbon.png`,
`hero_combat_banner.png` and `hero_action_ribbon_edge.png`. Regenerate rather
than hand-edit. Four things about that arrangement are worth keeping:

- The frame is **not** `outer_border.png`. The supplied art differs in one
  visible way — its bottom right corner takes the same radius as the other
  three, where the villain frame sweeps out to clear the copies count — and in
  one invisible one: its window sits four pixels further in.
- The ribbon **grows with its name**, exactly as the villain's does, and its
  top reaches the frame's inner edge. It hung from `NAME_TOP` for a while —
  the clearance the villain ribbon's *name* needs — which left it floating
  short of the border, and it was a fixed length for a while after that, which
  meant a long name simply ellipsised.
- **The combat head does not move.** It spans the whole ribbon and is cut to
  shape by art anchored to the ribbon's *top*, which is fixed, rather than to
  its bottom, which is wherever the name has pushed it. That is also what makes
  the seam between the two colours the head's own printed **chevron** rather
  than a line ruled across a box, which is all a single gradient could draw.
- **The three painted layers stack fill → head → outline, in that order.** The
  head is the ribbon's full width, so an outline under it is an outline the
  head paints out for the whole top third of the ribbon — which is exactly what
  it did for a pass.
- Below the head the ribbon is a plain rectangle the renderer draws, plus
  `hero_ribbon_point.png` at natural size anchored to its foot — the same
  split `banner_fill.png` already makes, for the same reason. The villain's
  own files could not stand in: that ribbon is 230 wide against this one's
  243, and its head flares 12px left of the run where this one tapers straight
  from the run's edges.
- The point's art carries `POINT_OVERLAP` rows of straight run above its
  taper, so the rectangle and the mask overlap rather than meeting on one row.
  A row where each contributes part of its alpha is a row that prints as a
  pale line across the ribbon.
- Every ribbon layer is squared up and clipped to one span **after** the
  resample onto the plate. Resizing to 2222 rows runs the filter across both
  axes even though the width does not change, and a hard vertical edge loses
  enough alpha to its ringing that the head and the point disagreed about
  their last column — which showed as the head overhanging its own outline.
- The ribbon's stroke is drawn in `divider`, like the villain's, and on a hero
  card `divider` is the frame's own cream — so what it prints is the pale
  channel the template shows between the ribbon and the artwork. It runs down
  the **right edge and round the foot, and nowhere else**.
- **The stroke is outside the colour, not eaten out of it.** The body runs
  147..379 and the stroke 380..398, so the ribbon's box is 252 wide and the
  fill's own run mask stops `edgeWidth` short of it. Laying a stroke over a
  full-width fill can only ever bite back into it, which is what made the foot
  come out solid stroke-colour and the corners look chewed.
- `hero_frame_plus_ribbon_stroke.png` is the authority on all of that: the
  supplied drawing of the frame and the stroke together, in one flat colour,
  on the same 1632 × 2218 canvas as every other piece of hero art — so it goes
  through the same resample onto the plate and needs no offset of its own. Clip it to the frame's window and what is left *is* the stroke —
  the bar, and the foot's ∨ — which is where the tool reads the ribbon's width,
  the stroke's weight and the foot's shape from, rather than inferring them
  from the border art. Its own numbers agree with the printed template's
  148..380 of tail against cream at 381..401.
- The tool **checks `geometry.ts`** against what it just derived, and says so
  per constant. The masks and the numbers that place them have drifted apart
  twice, and both times it printed as the ribbon's fill running past its own
  point — which looks like a mask bug and is not one.
- The head is squeezed from the border art's 147..389 into that 147..379. Ten
  pixels on a 1632px card, and it is what lets the stroke sit beside the head
  rather than over it.
- That outline is **not** a `.banner-ink`. Wearing both classes meant
  `.banner-ink`'s `mask-size` won the cascade and then computed to `auto`,
  because it is written in terms of two custom properties the hero outline
  does not set — and a mask that computes to `auto` is no mask at all, so the
  whole ribbon box came out in the outline's colour. A var that is not there
  does not fall back to the next declaration; it invalidates the one that
  won.
- **The ribbon is drawn under the frame**, so the window's rounded corner is
  what shapes its top and no join between the two can open. An earlier pass
  kept the ribbon's footprint opaque in the frame mask and drew the ribbon
  over it, which works right up until the frame quietly covers the whole
  ribbon — which is what it did.

`combat_banner.png` is the ribbon's head supplied on its own, and nothing uses
it. That is deliberate rather than an oversight: it is 254 × 414 where the
head drawn into the border is 243 × 403, and its taper is a different angle,
so a ribbon assembled from it would not meet the tail the border's own head
meets. The head comes out of the border for that reason. Keep the file — it is
the piece to reach for if the ribbon ever needs to be drawn away from its
frame.

Everything in the ribbon is measured off `Hero_Action_Card_Template.png` and
the supplied `ribbon_guides.png`, which gives the three Photoshop guides the
artwork was set to. **The ribbon's axis is 262, not the run's centre at
268.5** — the pennant is drawn a little asymmetrical and comes to its point at
262, which is where the guide is. The name in the tail is centred on that axis
by its *cap*, not by its line box: at `line-height` 0.88 against a face whose
ascent and descent come to 1.30 the two sit 6.7px apart, and `capTopToBoxTop`
solves that on the horizontal axis exactly as well as on the vertical one. The
icon is one of the four existing `CARD_SYMBOLS` files forced white with
`brightness(0) invert(1)`, the same filter printer-friendly mode already
applies to them.

`owner` is easy to misread as a range indicator — "ANY" printed in exactly the
spot a melee/ranged/either field would — and it very nearly became one. It is
not: a hero's own attack type is fixed per character and prints on the
character card; `owner` says who may play *this card*, and follows the same
empty-name fallback the existing ribbon name does.

**The character card is a genuinely new card, not a reskin.**
`HeroCharacterCardFace` is its own component, dispatched from `CardRenderer`
through a `statCard` prop keyed by character, the same shape as `cardback`: a
stat sheet is read off the character directly and was never going to live in
`set.cards`. `PreviewPanel` shows it above the deck back whenever a hero is
selected — it is the only thing in the character workspace that had no preview
at all, and its stats, ability and sidekick are all edited there.

Its chrome is the supplied `Hero_Character_Card_Template_*_frame.png` art,
split by `tools/hero-card-assets.py` into **a border and its ink** — and the
split is the whole of what this card exposes to an author:

- **border** — the pink outline and the bars between the bands, as a mask, so
  it takes a colour.
- **badge** / **badgeAccent** — the hero's own health shield and the small
  triangle notched into it, each its own mask.
- **moveInk** — the double-headed arrow *and* the word MOVE, one mask, taking
  the same colour as the digit between them: recolouring the move value means
  recolouring what names it, not just the number.
- **labelInk** — each band's own printed words, one mask **per band**: "HERO",
  "ATTACK" and "START HEALTH" on the name band, "SPECIAL ABILITY" on the
  ability panel, and the sidekick's own three. See below.
- **ink** — what is left, and none of it a word: the decorative arcs that
  frame a badge, and the sidekick's own health badge, which is fixed ink
  rather than a mask on every layout that shows it. A picture, already in the
  colours it prints, and not overlapping the border.

**The labels were part of `ink` until an author repainted a band and found the
white tab standing on it illegible.** The template's own pairing — white on
the two navy bands, black on the gold ability panel — is a default, not a
rule, so it had to become a choice the moment the field behind it did. Four
things about how that split was drawn:

- **Per band, not per word.** `CharacterBandStyle.labelInk` sits beside the
  `fill` and `artwork` it has to be read against, so the picker is where the
  problem is. Splitting to one picker per word would mean matching three
  colours across one flat field, which is not a thing to ask of anybody.
- **Cut on `CHARACTER_BAND_RUNS`' own boundaries**, the same three-way split
  the design object already makes — so a label can only ever belong to the
  band whose colour it is judged against, and a band's fill and its labels
  cannot drift onto two different boundaries.
- **Narrower than the band, deliberately.** `split_label_ink` takes two
  columns out of each band's rows — the rotated tab at x150..220 and the
  START HEALTH caption at x995..1205 — rather than whole rows, because those
  rows also carry things that are *not* words: the decorative arcs at
  x1280..1403, and the sidekick's own health badge. `LABEL_CAP_COLUMN` stops
  short of `CHARACTER_ATTACK_ROW.badgeX` (1209) so no badge art can reach it.
  Taking whole rows would have handed one picker two unrelated jobs.
- **The masks are shared only where the art genuinely is identical**, asserted
  by the split rather than assumed: `hero` and `ability` are pixel-identical
  in all four ink files, so each writes one file; the sidekick's is not — a
  3+ health swarm shifts its caption left — so it stays a per-layout record,
  and the quote layout gets `null` because it prints no sidekick band to
  label. Verified end to end by reconstructing each original ink file from
  its masks plus the residue: byte-identical alpha, no overlap, in all four.

Schema v47 is `CharacterBandStyle.labelInk` alone. An older document opens
with each band's sampled default and looks exactly as it always did; the bump
exists because an older build has no label masks and its own ink pictures
still carry the words, so a chosen colour would be silently dropped.

Under both go three band fills and whatever artwork each carries. The bands are
`CHARACTER_BAND_RUNS`, and there are **three, not five**: the hero's name band
and its attack row are one block, and so are the sidekick's, because the frame
rules a bar between each pair and nobody wants to match two colours across it.
The border covers every join and all four corners, so no fill needs a radius —
each simply runs `fillBleed` past its own edges.

This card still does not go through the style cascade. `Character.characterCard`
is its own small design object, because the sheet is one fixed layout and what
there is to choose is a border colour and three fills.

Two consequences of that:

- **The figures go over the art, the copy under it.** Under, so an over-long
  heading or ability runs out of sight behind the frame rather than across the
  tab strip. Over, because the health number sits *inside* the badge the art
  draws, and the move figure fills the hole left for it so exactly that a
  wider digit would be trimmed by its edges. The health number spent a pass
  hidden behind the badge.
- **Three frames, not one with pieces switched off**, because each is one flat
  picture with nothing in it to switch: quote, sidekick, and a derived third
  for a swarm sidekick with the lower health badge taken out. The token stack
  that replaces it is the only piece of chrome on the card the renderer draws,
  because how many discs it shows is the one thing here that depends on a
  number.

The move figure is set at 373px and squeezed to 0.56 of its drawn width, which
is not a substitution artefact: the printed "2" really is 106px across at that
height, because the frame leaves it a tall narrow slot beside the word MOVE.
Same case as the initiative card's MOVE badge — carried as a factor, never
dialled out of the size, which would take the height with it.

The band fills run `CHARACTER_CARD.fillBleed` past their own edges rather than
up to them. The frame is a 2218-row picture over a 2222-row plate, so its holes
sit up to four rows below the y this file measured, and the gold band's foot
showed a hairline of navy underneath. The separators are opaque, so the
overshoot cannot show.

Artwork goes behind the card **one band at a time**, not as one picture across
the sheet: the border's bars divide the card, and a picture crossing one would
be cut in half by one drawn over it. Each band is an `EntityRef` of its own
(`{ entity: 'characterBand', id, band }`) so the existing `ArtworkPanel` does
crop, placement and grade with nothing new behind it.

The health figure is centred on the badge's **ink centroid**, not its box
centre. The badge is a shield — full width for its top two thirds, then a taper
— so the two are eleven pixels apart, and the box centre reads low.

The two band headings print the character's and the sidekick's **full** names,
falling back to the words HERO and SIDEKICK the template sets. Full, because
this is the sheet a figure is introduced on — `Character.subtitle` is a
*shortened* name for the action cards' ribbon, which is the one place a name is
set at display size in a column two centimetres wide. The line beside the
copies count takes the full name too; it has a whole card's width to run in.

A sidekick is **one sub-object, not a list**: every character-card template
shows at most one sidekick concept — a single tracked individual, or an
undifferentiated swarm of identical copies, never several distinct companions
— so `Character.sidekick` has `enabled`, `multiple`, and either a tracked
`health` or a `count`, matching. `enabled: false` is what selects the
`Character.quote` panel instead; the templates confirm this by measurement,
not guess — the quote panel occupies exactly the sidekick band's and its
attack row's combined height, in the same file.

An attack type is **one supplied picture**, word and icon together, in the
colour that identifies it — `ATTACK_TYPE_SYMBOLS`. Nothing about it is set as
type, which is why adding `lunge`, `reach` and `large` beside `melee` and
`ranged` was adding three files and a line in `ATTACK_TYPES`. Two things
about them:

- **They do not share a scale.** `melee`, `ranged` and `reach` were exported
  at print size; `lunge` and `large` came out about 1.86× that. What is common
  is the *word*: its caps stand 58 in every file at print size, because on the
  card they are one size set once. So the two oversized files are scaled by
  their own word rather than by a guessed factor, and the ink inset that
  leaves is carried in `ATTACK_TYPE_SIZES` so all five still start on one
  line.
- They are drawn **over** the frame art, not under it like the rest of the
  copy. The hole the art leaves for this row is cut to whichever lockup the
  template happened to show, and `reach` is 85px wider than `melee`.

**Print sheets, PNG export and the Tabletop Simulator bundle do not know
about a hero yet.** `SetOutline` gained a `heroes` bucket alongside
`villains`/`minions`/`others`, shown first everywhere a roster is drawn, but
`card-pngs.ts`, `tabletop-simulator.ts` and `print/sheet.ts` still walk the
older buckets only. A hero can be fully authored — cards, sidekick, quote —
and previewed, but not yet exported outside a PNG of one card at a time. That
was the deliberately chosen scope for the first pass; wiring the character
card and hero decks into those three files is the natural next one.

### A card back's frame is drawn over full-bleed art, not around a window into it

Both deck-back faces used to box their inset art inside a *clipping* window —
`HeroCardbackFace` at the action card's own `INTERIOR`, `CardbackFace`
(villain/minion) at `CARDBACK.window`, a smaller box inside
`adventures_minion_cardback_nologo.png`'s own ring. That was the wrong model
for what these templates actually are: measured off their own alpha, neither
is a ring or a frame with a window *cut into* it — each is a single-colour
line (a thin rounded-rect for the hero, a border plus the rule above the
name for villain/minion) sitting near the bleed edge, drawn over whatever is
behind it, and nothing else. Boxing the art inside it left a wide unprinted
margin the reference art never has; both backs' art now runs the full bleed
canvas (full trim canvas for villain/minion, whose template carries no
bleed — `CARDBACK_BLEED`), with the line drawn *over* it.

`HERO_CARDBACK.frame` (143,143 to 1489,2080) is where the hero's own line
sits — the same four numbers as the action card's `INTERIOR`, coincidentally,
since this file does not read that constant. `CARDBACK.window`/`.radius`
were removed outright rather than left unused, since nothing needs a
clipping box's numbers once nothing clips to it.

Both lines are now a themed mask rather than a flat overlay —
`CardbackDesign.frame`, drawn the same "art as a CSS alpha mask over a
fill" way every other recolourable template border in this app is, with a
`FillEditor` in `CardbackPanel` for every role. Each role's own template has
its own line colour, so `createCardback`'s default is role-aware: `#f6eada`
for a hero (`hero_cardback_border.png`), `#ebe8d5` for villain/minion
(`adventures_minion_cardback_nologo.png`) — picking one colour for both would
read wrong the moment an author opened whichever role it wasn't sampled from.

**A hero's back prints no role line, so `CardbackPanel`'s "Role line" field
is gated to `character.role !== 'hero'`.** `HeroCardbackFace` has never read
`CardbackDesign.label` — only `CardbackFace` draws the two-line label/name
lockup — so the field was already inert there before this pass; hiding it is
what finally makes that visible rather than offering a control with nothing
to do.

Schema v35 is `CardbackDesign.frame` alone: it defaults to each role's own
sampled line colour, so an older document opens looking exactly as it always
did, and the bump exists only because an older build opening a v35 document
would otherwise silently drop a chosen frame colour back to that default.

### The ribbon's foot

The strip between a name ribbon's point and the divider, filled so the ribbon's
stroke and the divider bar read as one continuous line, with a symbol standing
in it — `ActionCard.showRibbonSymbol`/`ribbonSymbol`, drawn by
`ActionCardFace`'s `.ribbon-foot`. Modelled on `AbilityBlocks.bonusIcon`: the
symbol is a token string resolved through the same `parseAbilityText` lookup,
so a built-in and an author's own glyph are the same kind of thing, and its
size is a themed key (`CardTheme.ribbonSymbolSize`) rather than card data.

**The symbol itself is not recolourable, and that was tried and reverted.**
Every other themed shape in this file — the frame, the ribbon, the boost ring
— is single-colour art on transparency, which is what makes masking it to an
author's chosen colour work at all. The four combat symbols, and any custom
upload, are not: they are small multi-colour illustrations with an opaque
background, so masking one to a flat fill just painted a rectangle and hid
the art underneath it. What *is* an author's choice is `ribbonFoot` — the
strip's own fill, already one of `StylePanel`'s "Surfaces" — and
`ActionCardContent`'s "Ribbon symbol" section carries a second `FillEditor`
bound to that same field, a shortcut so changing it does not mean a trip to
Design for one colour. Same field, same cascade, two places to reach it.

**It has its own toggle rather than being "on when a symbol is chosen."** The
filled strip is the visible half of the idea — a card can want the unbroken
line with no glyph in it — so `ribbonSymbol: ''` means an empty foot, not the
absence of one.

**The strip has no measurable size, which is what dictates how it is drawn.**
Its top is wherever the ribbon's contents ended (the ribbon's length *is* its
contents — see `.banner`) and its bottom is wherever the body panel has pushed
the divider, so both ends move independently and neither is knowable without
measuring text, which nothing in this renderer is allowed to do. So it is not a
box fitted to the gap: it is one tall column standing *on* the divider
(`bottom: 100%` inside `.stack`, whose first flow child is the bar) and running
up **behind** the ribbon. Over-running upward costs nothing — the ribbon paints
over it, the printed frame covers the rest, and `.interior`'s own `overflow:
hidden` crops whatever reaches the top.

**Two layers, not one flat colour.** The field is `CardTheme.ribbonFoot` —
black on the printed card — and only a bar down its right edge, one ribbon
stroke wide (`BANNER.edge.width` / `HERO_RIBBON.edgeWidth`), is `divider`. That
bar is the whole point of the feature: it is the ribbon's own stroke carried
down into the divider, so the two read as one continuous line, and it has to be
able to differ from the field beside it. Right-aligned because a ribbon's stroke
sits flush with its outer edge on both layouts — hero 380..399 of 147..399,
villain 345..362 of 132..362 — so the bar inherits the alignment rather than
being placed. Painting the whole strip in `divider` (the first pass) got the
continuous line for free and made the field the wrong colour, which is not a
trade the printed card offers.

`ribbonFoot` is a `mono.ts` key too: printer-friendly mode would otherwise keep
a solid black block on an otherwise white card.

The strip carries no `z-index` — it must stay under `.divider`, which has one,
and under the ribbon, which is outside `.interior` and painted after it. That
last part is what preserves the ribbon's point: the ∨ notch is the ribbon's own
outline drawn *over* the strip, so the black starts at the point's edges rather
than being cut to fit them.

The symbol is centred on the **ribbon's own axis**, not the strip's: a hero's
ribbon comes to its point at 262, not at the middle of its run, and the glyph
has to stand over the point the way the name above it does. A villain's is
centred on its run, and its strip starts left of `INTERIOR.x` — that negative
offset is correct rather than a clamp waiting to happen, since the strip is
exactly as wide as the ribbon above it and the frame covers the overhang.

### The adventure map

`src/lib/map/` is the model, `renderer/MapBoard.svelte` draws it, and
`components/tools/MapEditor.svelte` is the page. Same three-way split as the
threat track, and the same rule: the board renders read-only and the editor lays
its affordances *over* it, so what gets exported cannot draw a handle.

**Everything positional is a fraction of the map's width — including `y`.** Not
of its own axis. Store `y` against the height instead and a 7.6%-wide space
becomes an ellipse the moment the map is not square, every path meets it at the
wrong point, and a dragged space drifts further from the cursor the lower it
goes. So `x` runs 0..1 and `y` runs 0..`1/aspect`. Measured after the fact: with
this, spaces render 80.7 × 80.7 px and a drag lands exactly where it was
dropped.

`MapBoard` is **SVG**, which is the opposite of every card face here. A card is
a stack of rectangles and masked artwork; a map is a graph. Paths stop at the
*edge* of a circle rather than its centre — trimmed rather than hidden behind
the disc, because a pale wedge would show the line through as a chord — and a
space split three ways is three arcs meeting at a point. Both are one line of
geometry in SVG and a pile of clip-paths in DOM. The artwork stays outside the
SVG as an ordinary element so `CardArt` can go on owning crop and grade.

Paths are quadratic beziers even when `MapPath.curve` is zero, so straight and
bowed routes share one trim/render path. `curve` is the bow as a fraction of
the distance between the two spaces; that keeps the shape stable when a space
is moved. The faint printed-board glow is a second copy of the same geometry,
locally rescaled out of the board's tiny `0..1` viewBox and blurred with CSS —
SVG `<filter>` references and a blurred element left at that fractional scale
both disappear in the DOM-photograph export pipeline. The full failure history
is deliberately kept above `PATH_GLOW_WIDTH_RATIO` in `MapBoard.svelte`.

`MapPath.oneWay`, `MapPath.modifier` and `MapPath.largeFighter` are independent
booleans. The first two produce
four printed states: ordinary black, black + attack modifier, orange arrow,
and orange arrow + attack modifier. The arrow's variable-length route is two
native SVG strokes (black outline, `AdventureMap.oneWayColor` core), while its
destination assembly is the tight 48×48 `path_arrowhead.png`. It is fetched and
converted to a data URL before photography rather than left as an external image
reference, turns to the bezier's arrival tangent, and places its first opaque row
on the destination rim. The generated shaft uses a flat origin and overlaps
beneath the PNG's cropped base by half its outline width, so the join cannot
expose independently-antialiased generated shapes. All refined pieces share a
10px orange shaft; their render scale derives from the generated orange-core
width, keeping the join aligned if path thickness changes. The trim remains a
real bezier subcurve trim; moving only the endpoint while retaining the original
control point changes the bow. Generated head/modifier geometry remains only as
a first-fetch/missing-asset fallback.
The black modifier is the pointed tag from Marmoreal; on an orange route it
uses the blank `path_arrow_modifier.png` body plus
`path_arrow_modifier_text.png`, centred by real arc length between the origin
rim and arrowhead shoulder. The body mirrors when direction reverses but the
separate text insert does not, keeping `+1` readable. Its position is shifted
three source pixels towards the tail because the blank body's orange-area
centroid is 2.7 pixels tailward of its canvas centre; applying that shift with
the direction sign keeps both orientations visually centred. The black tag sits at the
whole connection midpoint, follows its tangent, and mirrors its native
icon/value layout when needed.
The document's default path black is `#1b1b18`, matching the fixed outline
pixels in all three refined PNG pieces. v46 normalisation changes only the exact
former `#101010` default on an older map; any other stored path colour remains
untouched.
`largeFighter` places the exact supplied 48×48 restriction pin on the bezier;
when a combat modifier is also present, the pin moves along the real curve so
the two marks remain readable. Its public SVG is fetched and inlined before
photography rather than left as an external reference inside the exported SVG.

`from` → `to` is meaningful while either option is active. The first toggle
enabled from one endpoint deliberately makes that endpoint `from`; enabling
the second preserves the direction already printed. If establishing direction
reverses an existing pair, the editor negates `curve` at the same time: the bow
is signed relative to `from` → `to`, so endpoint swap plus sign swap preserves
the route's visible geometry. v39's misleading `modifier: 'oneway'` meant the
black pointed tag and normalises to `oneWay: false, modifier: true`, never to
an orange arrow.

Secret passages are not `MapPath`s. Each `MapSpace` optionally owns one
`MapSecretPassage` marker: its angle locates a medallion centre on that space's
rim, its curve bends an outward tail left/right, and its fade controls how soon
the tail becomes transparent. Values above the former 100% maximum extend the
tail itself, reaching twice that old maximum at 200% while still ending fully
transparent. Its `color` is per marker — shown as an exact hex
value and resettable to `DEFAULT_SECRET_PASSAGE_COLOR` — so authors can either
match two endpoints precisely or deliberately distinguish them. `symbolId`
points into the set's existing `customSymbols` registry; `MapBoard` receives
that registry in the editor, overview and off-screen export. Every marker uses
the supplied transparent-ring PNG, registered to its measured circle centre of
(37.5, 31.5) and 32px radius rather than the canvas midpoint. Its visible point
clusters form a measured 29.51° axis within the PNG, so `MapBoard` removes that
fixed artwork offset when rotating the ring. The points then stay on the space's
radial axis, leaving one aimed at the space centre and the other exactly
opposite; Tail curve bends only the fading route and does not rotate the ring.
With no resolved custom symbol, the dark pixels
of the supplied keyhole PNG are extracted into a second data URL and drawn
upright; an upload occupies that same non-rotating layer. The greyscale assets
are recoloured through a canvas into self-contained data URLs before entering
the board SVG because an SVG/CSS mask would fail in the map photograph pipeline.
A native disc at the ring's measured 0.78-radius inner boundary sits
behind either PNG, so the colour picker fills the medallion as well as the ring
and tail. Off-screen export pre-warms the exact colour variants before mounting
`MapBoard`, just as it does the one-way raster pieces. Matching medallions
communicate the gameplay connection even when their spaces sit across the map or their stairs point in
unrelated directions, so making the two endpoints share one bezier would remove
exactly the placement freedom the official treatment uses. The portal group is
drawn after the spaces so its medallion covers the rim beneath it. Sampling each
tail as short native SVG pieces makes opacity follow the curve without an image-
context gradient reference. Only ordinary black paths receive the faint glow: orange arrows and
secret passages deliberately do not. Normalisation converts the short-lived
v41 path-owned form into two independent space markers and drops the forced
line; v42's map-wide tint is copied into each marker when v43 loads it.

The editor grid keeps the map at the top-left directly below the mode controls.
Environment and Placed text form one flush stack beside it; the context-sensitive
Selected space/Selected environment inspector occupies the far-right column
with a 600px maximum height and only scrolls internally when its contents exceed
that cap. Space and environment selections are mutually exclusive, so selecting
a scene piece on the board or in its list immediately replaces the space controls
with the piece's position/size/order controls beside the still-visible map.
Zones and Board each take half of the map column immediately below it, with no
gap. The map and those panels share one flex column rather than separate grid rows:
a tall Selected space or Environment stack
therefore cannot enlarge the map's row and open an empty band above Zones. Zone
opacity/tile-size/colour controls remain before the pattern gallery. That
ordering is deliberate: settings that need live visual judgement remain
reachable while the board stays in view.

`AdventureMap.environment` is an ordered, back-to-front list of embedded scene
pieces painted after every space and before secret-passage markers and placed
text. Each `MapEnvironmentPiece` stores the source's measured aspect alongside
its width-based centre/size, rotation and opacity, so a render never decodes a
large data URL just to calculate layout. The editor accepts one or many PNGs,
can replace a layer without losing its geometry, and exposes explicit backward/
forward controls because array order is the exported z-order. v45 defaults an
older map to an empty list. A visible piece is also directly draggable on the
board; the editor preserves the grab offset and persists the gesture as one
edit on release. Layer rows can likewise be dragged before or after one another,
with the buttons retained as the keyboard-accessible equivalent. The layer list
has its own capped scroll viewport in the side stack; controls live in the shared
right inspector,
so adding many PNGs cannot push them down the page at all.

The numbers come from a printed Adventures map (Martian Invader, McMinnville OR),
Hough-detected and then profiled radially — 42 spaces, radius standard deviation
1.6px on a 124px diameter, so the printed spaces really are one size:

| | |
|---|---|
| aspect | 1.447 (13:9 is 1.444) |
| space diameter | 7.57% of map width |
| map measures | 13.2 × 9.1 space-diameters |
| space outline | 2.9% of a space's diameter |

The 13.2 × 9.1 is almost certainly a designed 13 × 9; the sample is a photograph
of a mat and carries a worn edge outside the play area, which covers the 1.6%.
`DEFAULT_SPACE_DIAMETER` takes the measured fraction rather than 1/13 — a map
that disagrees with the artwork behind it is worse than one that disagrees with
a round number.

**Every image in the bundle is named after its own contents.** Tabletop
Simulator caches textures *by URL*: re-export with new artwork under the same
filename and TTS keeps drawing the old bitmap, while the save points at the
right path and the file on disk is correct. Nothing reports it. `writeAsset`
puts a short content hash in the name so a changed image is a changed URL, which
is the only thing that cache respects. The name doubles as a de-duplicator —
identical bytes under the same base are written once, so a shared card back does
not land per pile — and the cost is that superseded files stay in the folder,
since the exporter writes and never deletes.

**`CardID` is an index, not a name.** It is the object's CustomDeck key times
100, plus the slot on that sheet — `deckObject` builds both from `sheetId`. A
`CardID` that does not resolve to a key present on the same object spawns a card
at the right size, in the right place, with **no texture and no error**: a plain
rectangle. The map shipped as `CardID: 200` against a deck keyed `1` and did
exactly that. Uniqueness across objects is not the point; each object carries
its own CustomDeck, so the threat track and the map are both `100` / `{1}`.

Worth asserting rather than eyeballing, because the failure is silent: for every
object and contained object, `floor(CardID / 100)` must be a key of its
`CustomDeck`, and that entry must have a `FaceURL`.

The map goes into the Tabletop Simulator save as its own `CardCustom`, beside
the threat track rather than merged into it. Its `Transform` is a **uniform**
scale sized by height, like every other object there — scaling the axes
separately applies the aspect a second time, which is the trap that once blew
the threat track out to eight times its width. It is placed at the track's
`posZ` less half of each one's depth, so the two meet edge to edge where they
meet on the printed board. Photographed at `MAX_SHEET_PIXELS`, because the
printed board is 5846px across and TTS refuses a texture over 4096.

The board's printed width is **not chosen** — `MAP_WIDTH_MM` is derived from
`THREAT_TRACK.mm.width`, because on the table the track runs along the top of
the map and the two are one board. A map that picked its own width would print
as a step. Nothing renders the combined surface yet; the constant and
`boardHeightMm()` are there so that adding it is an addition rather than a
migration. At the default aspect that is 495 × 343 mm of map, 413 mm with the
track.

The editor puts the board left and its controls right, not below: the board is
by far the tallest thing on the page, so a colour picker under it would be off
screen exactly when it is being used. The board column is `minmax(0, 1fr)` —
a bare `1fr` has an `auto` minimum, so the board would refuse to shrink and push
the panel off the page instead of sharing with it.

A space's `zones` is a *list* of fills, not one fill: the printed board draws a
space bordering two areas as a circle cut into wedges, and two, three and
four-way splits all appear. One entry short-circuits to a plain circle, because
a 360° arc is degenerate and renders as nothing at all.

`spaceOpacity` fades only those wedge fills, never their outlines, labels or
start markers. The editor's Numbers toggle is a construction overlay outside
`MapBoard`, so it cannot leak into an export. Its absolutely positioned labels
resolve against the `.board` grid item; removing that positioning context makes
them float relative to a page ancestor instead of over their spaces. A
colour-wide `MapZoneStyle` is a
different meaning of “zone”: it matches every wedge anywhere on the board by
colour and tiles a built-in or uploaded pattern over them. Built-in SVG pattern
markup is fetched, recoloured directly and drawn through a native SVG
`<pattern>`; CSS masking on SVG resolves to luminance here and makes the black
source shapes disappear. `photographMapBoard` pre-warms those async sources
before mounting the off-screen board, because one `tick()` is not enough to
wait for an effect-triggered fetch. The renderer comments above
`zonePatternDefs` carry the exact repro and export rationale.

### Assigning a rules or event card to one character

Ownership of a rules or event card lives on its **deck**, not the card
(`Deck.ownerId`), same as an action deck — and the scoped-export functions
(`decksForCharacter`/`cardsForCharacter`, `sets/scope.ts`'s `heroSlice`)
already respected it regardless of kind before any of this existed. What
was actually missing was a way to get more than one rules or event deck in
the first place: `workshop.addRulesCard()`/`addEventCard()` both go through
`ensureDeck(kind)`, which finds-or-creates the *one* unowned, set-level deck
of that kind — there was never a second deck for a card to move to, so a
rules card that should only travel with one character (two of Forgotten
Pantheons' rules cards belong only to Maui) had nowhere to go.

`workshop.ensureOwnedDeck(kind, ownerId)` is `ensureDeck`'s counterpart for
the owned case, and `workshop.setCardOwner(cardId, ownerId)` is what an
author actually reaches for: it resolves the right deck (owned or, for
`null`, the shared one) via one of those two `ensure*` calls, creating it on
first use, and moves the card into it with the existing `moveCard`.
`RulesCardContent`'s "Belongs to" field is the one place this is reachable
from — its `deckOptions` lists every existing deck of the card's own kind
(labelled by owner, or "Whole set") plus a synthetic `new:{characterId}`
entry for every character who does not yet have one of their own, so
picking a name is what creates their deck rather than requiring an author
to go build one by hand first. A character who already owns a deck of that
kind has no synthetic entry — their existing one is just another option in
the first list, so reassigning a card that already has a home is always a
pick from what exists, never a duplicate offer.

`DeckRow`'s own owner-select (in the sidebar tree) is the coarser sibling of
this: it reassigns an *entire* deck's owner in one move, which is right for
a whole rules deck that turns out to belong to one character, but wrong for
splitting a mixed deck card-by-card — moving every card in it. Both controls
write through the same `Deck.ownerId`, so a deck built one way is exactly as
reassignable through the other.

### Landscape rules cards

`RulesCard.landscape` is a per-card boolean, not a second `CardType`: the
heading and body fields are the same either way, so flipping it back and
forth is only ever a look, never a content change, and one deck can hold a
mix of portrait and landscape rules cards. There is no template art for this
orientation — nothing was supplied, and none of the other turned-sideways
templates in this codebase are a shortcut around that. `EventCardFace`
proves the point: despite `CARD_FORMATS.event`'s `mm`/`bleed` being a literal
transpose of `.initiative`'s, its `EVENT` geometry in `geometry.ts` was
measured independently off its own template files, not derived from
`INITIATIVE` by rotation — turning a header band 90° would print it
sideways, which is never what "landscape" means for a card whose heading
still reads left to right across the top.

`RULES_LANDSCAPE` is therefore not measured off anything — it is `RULES`'s
own margins, insets and header height (the last kept in absolute px, so the
type scale matches the portrait card) carried over onto the transposed
canvas, rather than `RULES`'s layout rotated. It says so in its own doc
comment, the same honesty this file's "measured, not estimated" convention
expects of every other geometry block, since this one really is provisional
until it can be checked against a real template.

`RulesCardFace` draws the landscape frame in plain CSS instead of a masked
image, and that was a discovery rather than a compromise: the portrait
frame's `.mask.frame` layer (`rules_border.png`) turned out to have nothing
in it worth stretching. Its only job, given `.bed`'s `seamBed` clip-path
already handles the anti-aliasing seam between the interior and the border,
is painting the outer margin in `theme.frame` — and `.interior` already has
a real CSS `border-radius` of its own, not one baked into the mask. So the
landscape branch skips the mask, the `.bed` seam layer and the `rules_border`
asset entirely: one full-bleed `theme.frame`-coloured div, painted behind an
`.interior` with its own radius, reproduces the identical look with nothing
to distort and no seam to fix in the first place, because there is only one
element drawing the corner rather than two independently-rounded layers that
have to agree.

**A `CardFormat`-per-`CardType` assumption lives in four separate,
hand-duplicated switches**, and a landscape rules card is a format that
depends on more than `type` — so all four needed their own branch:
`CardRenderer`'s inline `$derived.by`, `card-image.ts`'s `formatForCard`
(which alone is enough for PNG export, since `card-pngs.ts` calls it fresh
per card), `tabletop-simulator.ts`'s `formatFor`, and `print/sheet.ts`'s
`sizeFor`. Nothing here unifies the four into one shared function — that
would be a real refactor, out of scope for adding one orientation.

The TTS exporter needed more than a branch, because its piles are grouped by
`CardType` on the theory that "a TTS sheet has one cell size" — true, but a
landscape rules card sharing a portrait one's pile would force a shared cell
shape on cards that no longer share a format. `PileKey` is `CardType |
'rules-landscape'`; `pileKeyFor` reads the flag, `formatFor`/`pileLabel` take
a `PileKey` instead of a `CardType`, and `plansFor`'s grouping map carries the
card's real `CardType` alongside its cards so `backFor` — which still needs
the literal `'rules'` to fall through to the owning character's or the
villain's deck back — reads the type it always did. `print/sheet.ts`'s
`SIZES`/`sizeFor` gained a fourth `rulesLandscape` bucket the same way,
grouping pages by printed size exactly as the three existing buckets do; the
"rules cards print single-sided" warning needed no change, since it already
walks `outline(set).rules` regardless of which way a card is turned.

**A rules card's heading has its own alignment, and a landscape one draws its
own divider.** `RulesCard.headingAlign` (`HeadingAlign` — `'left' | 'center' |
'right'`, `sets/types.ts` v34) is a plain `text-align` on `.heading`, read
only for `type: 'rules'` — an `EventCard` shares the same face component but
has no such field, so `RulesCardFace`'s `headingAlign` derivation falls back
to `'left'` for it, matching what every card printed before this. The
landscape divider between the header band and the body is a second thing
`RULES_LANDSCAPE` cannot borrow from a template: portrait's rule is baked
into `rules_border.png`, so landscape draws its own — a plain `theme.divider`
bar centred on the header/body boundary (`RULES_LANDSCAPE.dividerHeight`, a
chosen weight rather than a measured one, same as the rest of that geometry
block). It is not exposed as its own `StylePanel` surface: `divider` was
never added to `PROSE_SURFACES` — doing so would offer a "Divider line"
control on a portrait rules card and on an event card, neither of which has
one to colour — so the landscape rule simply reads whatever `theme.divider`
already resolves to from the existing cascade.

**The rich text sanitiser allows more than one inline style now, and reads
them independently rather than as alternatives.** It used to allow exactly
one declaration (`--size`, rebuilt from a parsed number); colour
(`readTextColor`/`textColorStyle`, `color: #rrggbb`) and paragraph alignment
(`readTextAlign`/`textAlignStyle`, `text-align: left|center|right`) are two
more, each its own regex matched against each `;`-separated declaration in
turn rather than against the whole attribute — the change `declarations()`
exists for, since a run that is both resized and coloured needs both to
survive the same pass. Every declaration is still rebuilt from a parsed,
validated value, never copied through: `style` stays the one attribute an
author's own markup can never inject anything through. Size and colour each
nest as their own wrapping `<span>` — `TEXT_SIZE_CLASS`/`TEXT_COLOR_CLASS`
mark them so `RichTextEditor`'s `applySize`/`applyColor` can find and replace
a previous one without disturbing the other, which is why the two are
allowed to nest (`<span class="colored"><span class="sized">…`) rather than
merging into one span's `style` — merging would mean parsing back out which
declaration belonged to which apply function's "replace, don't layer" pass.
Alignment carries no such wrapper: `execCommand('justifyLeft'/'Center'/
'Right')` sets `text-align` on the nearest block ancestor itself (wrapping
bare text in a new `<div>` first if there is none), which is already an
allowed tag, so no bespoke `applyAlign` was needed the way size and colour
both require one — `RichTextEditor`'s `ALIGN_TOOLS` are `exec()`-based
buttons, exactly like Bold/Italic/Underline.

**A coloured run is independent of `theme.bodyInk` by construction, not by
extra code.** `theme.bodyInk` is still what an *uncoloured* run prints — the
face's `.body` sets `color` once, and a `.colored` span's own inline `color`
simply wins the cascade for whatever it wraps. So the failure mode the
request named ("the Body Text colour picker would affect the unaltered
text") never had a code path to begin with: `applyColor` never touches
`theme`, and `theme.bodyInk` never touches a `.colored` span's own `style`.

**The text-size control is a slider, not a stepper, and both were kept.**
`RichTextEditor`'s old `−`/`+` buttons nudged `TEXT_SIZE.step` per click; a
`.size-range` (a plain `<input type="range">`, styled to the same track/thumb
as `Slider.svelte` but at toolbar scale rather than that component's own
taller, labelled layout, which does not fit a 22px-high toolbar row) replaced
them for drag-to-size, and the existing numeric input stayed for typing an
exact percentage — the request was to replace the stepper specifically, not
to give up precise entry.

**Two compounding bugs in `applySize`/`applyColor`, found chasing a report
that "Reset" did not reset the size and moved the caret to the top of the
field.** Both survive selecting `.sized .sized` in a stored card's `body` and
diffing before/after — no template art or timing involved, purely DOM.

- **`commit()` can rebuild `editor.innerHTML` out from under a selection
  that still points into the old tree.** It only does this when
  `sanitizeRichText`'s output differs from what is already there — which is
  exactly what happens on a reset to normal: `applySize`/`applyColor` wrap
  the run in a bare, class-less, style-less `<span>` for "nothing to say",
  and the sanitiser's own unwrap-empty-span rule (see *the rich text
  sanitiser* below) strips it right back out. `editor.innerHTML = clean`
  destroys every node the live `Selection` pointed into, collapsing it — so
  the reselection at the end of the old `applySize` found its own `holder`
  disconnected and silently skipped, and the browser left the caret at
  whatever it defaults to on a fully-replaced contenteditable: position
  zero. `commit()` now captures the selection as **character offsets**
  (`offsetWithin`/`pointAtOffset`, via `Range.toString().length` and a
  `TreeWalker`) before any reassignment, and restores it after, unwrapping
  and all — offsets survive, node references never do. This lives in
  `commit()` itself rather than in each apply function, so it also covers
  ordinary typing if a browser-injected span (spellcheck, an extension) this
  sanitiser was always going to strip fires mid-edit.
- **Deeper, and the actual reason the size never changed at all: reselecting
  only the *contents* of the just-applied span, not the span itself, means
  the next size or colour change on that same run extracts just its text,
  leaving the now-empty wrapper behind in the live DOM rather than in the
  fragment the strip loop inspects.** A second size on an already-sized run
  therefore nested a new span inside the stale one instead of replacing it —
  invisible for two *different* sizes, since nested `--size` values don't
  compound, only override — and a reset to normal left the stale non-default
  size on the untouched outer span while the newly-bare inner one got
  unwrapped, which is the actual "doesn't reset" bug: the size was still
  there, just one level further out than either apply function ever looked.
  Two fixes, not one, because they cover different selections: `applySize`/
  `applyColor` now reselect with `Range.selectNode(holder)` rather than
  `selectNodeContents`, which is what keeps *our own* chained reselections
  correct; `widenToMarkerAncestors` additionally widens a *fresh* selection
  — including a real drag-selected one, which is never our own reselection —
  out through any `.sized`/`.colored` (or legacy `size-*`) ancestor whose
  content the selection happens to exactly span, climbing through
  intervening non-marker tags like `<b>` on the way, so the extracted
  fragment always contains whichever wrapper the strip loop is about to
  inspect rather than leaving it as an orphaned shell one level up. Without
  this second fix specifically, a size change on already-coloured text would
  have silently dropped the colour: the colour span would be left behind,
  empty, while the text moved out from under it into a new size-only
  wrapper.
- `syncSelectionFormatting`'s own caret-walk had to learn the same lesson in
  reverse: `Range.selectNode` puts `startContainer` on the *parent*, with
  `startOffset` pointing at the span among its siblings, not at the span or
  its text — walking up from `startContainer` as the size/colour walk always
  had would step over the just-applied span entirely and read whatever it
  sits inside, showing the toolbar as if the action just taken had not
  applied. It now indexes into `startContainer.childNodes[startOffset]`
  first when the container is an element, and only falls back to
  `startContainer` itself for the ordinary text-caret case.

### Home

`components/library/HomeScreen.svelte` (still under `library/` — see below) is
`navigation.svelte.ts`'s `{ kind: 'home' }` view, and is what used to be called
the library screen. The rename tracks a real change, not a relabel for its own
sake: the library screen only ever listed sets; Home also says what needs
doing before you open one, which is a different job and needed a name that
says so. `storage/library.ts` — the IndexedDB-backed collection of sets, and
`components/library/`, the folder — keep the old name on purpose: "library" is
still the right word for the data, it was only ever the wrong word for the
page looking at it. Renaming the folder to `home/` would have collided with
`components/home/`, which is the *other* Home — see below.

Two things are worth knowing before you open one:

- **Contributions waiting on a decision**, and **a fork whose original has
  moved on since it was copied.** `SetHome` (see below) already answered both
  questions for whichever one set happened to be open — `behindBy`, via
  `fetchSetSummaryBySlug(set.origin.slug)`, and `waiting`, via
  `listMyPublishedSets`/`openContributionCounts`. Home generalises the same
  two calls across every set in the library at once (two calls total, not one
  per set for the ones that scale that way; `fetchSetSummaryBySlug` is
  genuinely per-set, so those go out in parallel) rather than reimplementing
  either question, and renders the result as a strip above the shelf plus an
  inline note on the affected tile — the same "the original is now at
  revision N" wording `SetHome`'s own lineage line already uses, so the two
  places say the same thing about the same fact.

The shelf itself splits into **Published** and **Unpublished**, by whether
`listMyPublishedSets()` has a row for that local id under any scope. The
split is `null` rather than an empty set until that call has actually
answered *while signed in* — signed out, offline, and "signed in with zero
published sets" all have to read differently, because the first two are not
answers to "is this published," they are the absence of one. Getting this
wrong once already happened: reading only whether the fetch had returned,
not whether the visitor was signed in, put every set in the library under
"Unpublished" for a signed-out author whose sets were, in fact, published —
the local document has no way to know that on its own, only the server does,
and only for someone it recognises. `auth.signedIn` is read synchronously at
the top of the effect for the same reason it always has to be: reading it
only inside the `async` closure would make signing in *while the screen is
open* invisible to Svelte's dependency tracking, and the split would never
un-stick from "unknown."

**Home has no picture of its own to show**, and works around that rather than
fighting it. `LibraryEntry` deliberately carries no thumbnail (see "Every
character in every local set" above and `storage/library.ts` — the index is
kept light on purpose, an author's artwork lives only in the full document).
So the set grid, the promoted "Continue where you left off" card, and the
donut's own hover target all reuse the same `tint(seed)` hash-to-HSL swatch
the Characters view already used for a portrait-less character — the same
function, one more caller, not a new concept. A real per-set thumbnail is a
deliberately deferred idea, not a rejected one: it would mean either
denormalising a small picture into the index (a real schema/migration
decision) or rendering one from the open document on demand, and neither was
worth doing to answer "does this grid have any colour in it," which the tint
already answers for free.

The **"Library health" donut** replacing the old "Sets" stat tile is the same
three-state read the per-tile `.health-status` pill already gives
(blocked/rough/ready, from `entry.blockers`/`.gaps`) turned into three arcs
rather than a fourth taxonomy — the mockup this was built from also proposed
an "unpublished" slice, which was dropped because it conflates a health
question with a publish-status one the Published/Unpublished section headers
already answer on the same screen. The ring itself is the standard
percentage-donut trick — one `<circle>` per non-empty bucket, each dashed
down to its own share of `2πr` and rotated into place via a cumulative
negative `stroke-dashoffset` — computed against the circle's *actual*
circumference rather than an illustrative round number, so the three lengths
always sum to a complete ring exactly rather than approximately.

**A published row remembers its own `kind`, and that was worth a migration.**
`sets.scope` ('full' | 'hero' | 'villain', `0006_scoped_publishing.sql`) says
how much of a set was published, not what kind of set it is — a `scope:
'full'` row could be an adventure or a box of heroes, and nothing server-side
could tell them apart. Home's gallery sample wants four *permanently
labeled* slots — Adventures set, Heroes set, and two Single hero spots — and
guessing the first two from other columns would mean a label that is
sometimes wrong, which is worse than no label. `0009_set_kind.sql` adds
`sets.kind` (checked against `SET_KINDS`), `publishSet` sends `scoped.kind` on
every publish (`heroSlice` already forces `kind: 'heroes'` on a standalone
hero regardless of which box it came from, `sets/scope.ts` — so a lone hero is
correctly categorised for free), and `listPublicSets` gained a `kind` filter
alongside `scope`. `0010_hero_count_and_kind_backfill.sql` adds `hero_count`
beside it, because `character_count` counts the whole roster — villain and
minions included — and cannot answer "how many heroes", which is what splits
a one-hero box from a multi-hero one.

**Leaving 0009's column null and waiting for authors to republish was the
mistake, and it is worth keeping the reason.** The stated argument was that a
row "repairs itself on the next natural write, the same as
`LibraryEntry.blockers` does locally". That analogy does not hold: a local
index is rewritten constantly by an author simply working, while a *published
row* is rewritten only by a deliberate re-publish, which nobody performs
because a column appeared. So every existing row stayed `null`, both whole-box
slots read "None published yet" against a gallery that visibly had both, and
would have stayed that way indefinitely. 0010 backfills from each row's own
stored `document`, which is the authority rather than a guess: `document->
'set'->>'kind'` where the document carries one (schema v28+), and otherwise
inferred the way `sets/health.ts` already defines an adventure — it needs a
villain. That last rule deliberately differs from `normalizeSet`'s own
fallback, which opens a kind-less document as `'adventure'` unconditionally:
that default exists so pre-heroes-set documents still *open*, and every set
was an adventure back then. Applied to a villain-less box of three heroes it
is simply false. **The general rule: a denormalised column on a published row
needs a backfill in the same migration that adds it, because nothing else will
ever write it.**

**The gallery sample is four labeled slots, not a flat list — and still
queries rather than hardcodes.** Nothing pins a specific set's name or slug
into a slot; that breaks the moment its author unpublishes or renames it.
`gallerySlots` runs three parallel `listPublicSets` calls — `{ scope: 'full',
kind: 'adventure' }`, `{ scope: 'full', kind: 'heroes', heroes: 'multi' }`,
and `{ kind: 'heroes', heroes: 'single' }` — each an 8-wide pool sorted by
`popular`, and a small local Fisher-Yates
`pickRandom` chooses 1 / 1 / 2 from the pools **once, when the fetch
resolves**, storing the picks in state rather than a `$derived`: a derived
re-running `Math.random()` on every unrelated reactive tick (autosave
touching `entries`, for instance) would make the slots visibly reshuffle on
their own. A slot with nothing published in its category yet renders a
dashed "None published yet" placeholder at the same footprint a real tile
would take, rather than collapsing the grid — the categories are permanent
even when a category is still empty, and the picks genuinely rotate once
there is more than one candidate. The fetch runs regardless of library
size — the zero-state welcome panel shows all four slots full-width, and the
"Design your own adventure" card in the middle of a returning author's
`.top-row` shows the same four, condensed — so one fetch serves both rather
than each screen asking separately. Neither renders anything and neither
shows an error if the fetch fails or `cloudEnabled()` is false — same
silent-fallback precedent as the attention strip's own cloud calls, just
below.

**The three slots split on `kind` and `hero_count`, never on `scope`** — and
the first version got that wrong in a way worth naming, because `scope` reads
like the right axis and is not. It says how much of a set was published, so
`scope: 'hero'` found only a hero *sliced out of a box and published alone*,
while a published box whose entire content is one hero — which is what most
"single hero" sets actually are — never matched, and that slot sat empty
against a gallery holding three of them. The taxonomy is the author's own:
`kind: 'adventure'` is an Adventures set; `kind: 'heroes'` with more than one
hero is a Heroes set; `kind: 'heroes'` with exactly one is a Single hero,
which a sliced-out hero also satisfies on its own terms (`heroSlice` forces
`kind: 'heroes'`, and the slice holds one hero). Only the two whole-box slots
constrain `scope: 'full'`; the single-hero query deliberately does not, so
both shapes qualify. `GalleryQuery.heroes` is `'single' | 'multi'` rather
than a raw number because those are the only two cuts anything asks for.

**The "Design your own Unmatched adventure" pitch is not only a first-visit
thing, and `.top-row` is three columns, not two.** It used to live solely in
the zero-state, which meant a returning author who wanted the gallery for
inspiration, or simply forgot the Set → Characters → Cards → Publish shape,
had no way back to it short of deleting every set. A condensed version —
heading, four one-line steps, the same four gallery slots at a smaller
size, "Browse the gallery" — sits in the middle column instead, beside the
stat row/continue-card column and a third column holding Guides (moved up
from below the grid; it was always returning-author-only, this only
relocates it). Condensed deliberately in the middle column: the zero-state
version's per-step description paragraphs would be too much at a third of
the page's width. The left column's own two rows — the stat row and the
continue-card — were both originally laid out for two-thirds of the page and
had to restack for a third: the health donut now spans both stat-card
columns on its own row rather than sitting beside two narrower tiles, and
the continue-card goes from one horizontal row (thumb · body · actions) to a
vertical stack, its actions relying on a flex column's default `align-items:
stretch` for full-width buttons rather than a dedicated prop.

**A class name collided with itself, and cost more space than any of the
above.** The set-grid card's inner text stack was first named `.body` —
which a Svelte component does not scope per-element, only per-component, so
that selector's rules applied to *every* element carrying the class, and the
page's own scrollable container already had one (`<div class="body
scroll-y">`). Both rules merged onto both elements: every card silently
inherited the page container's own padding (`--space-7`/`--space-9`/
`--space-10`) stacked on top of `.open`'s, and the container gained an
unwanted `flex-direction: column; gap` from the card's side of the merge.
Renamed to `.card-body`. This was the dominant cause of the "wasted space"
report that prompted tightening the grid at all — the title-wrap-causes-
grid-stretch issue (`.card-title` now `nowrap` + ellipsis) and the old
two-row stats/meta split (now one `.meta` line) made it worse, but neither
was the main cost on its own.

The **"Continue where you left off" card** carries a "View gallery listing"
action now, beside "Continue editing" — reachable only because the existing
published-sets effect already fetches `listMyPublishedSets()`, whose rows
carry `slug`; that effect used to keep only `local_id` and throw the slug
away building a bare `Set<string>`. `publishedSlugByLocalId` keeps both, as a
`Map<SetId, string>` — the Published/Unpublished split below still just calls
`.has()` on it, so nothing else about that effect changed.

**A shelf tile now shows a real picture, cross-faded to a hero's character
card on hover — the same effect `GalleryScreen`'s own character tiles use,
reused rather than reinvented.** `LibraryEntry` still carries no thumbnail
(the "no picture on the index" reasoning above is unchanged), so `HomeScreen`
loads the full document once per set (`ensureCover`, gated by a plain
`Set<SetId>` so a re-render never re-requests one already in flight) and
reads `coverArtwork(set)` — already synchronous, no rendering, just picking
through fields that are already there — the instant it resolves. The
character-card half is the expensive one and stays lazy: `peekCard` only
photographs a card stage (`renderCharacterCards`, the same publish-time
function the gallery itself uses, genuinely local — nothing about it touches
the network) the first time a tile is hovered or focused, gated the same way
`GalleryScreen`'s own `peek` is and for the same stated reason: rendering
every tile's card stage the moment the shelf appears would cost far more
than the rest of the page for previews most of which nobody hovers. Read to
a data URL rather than kept as an object URL — `renderCharacterCards`' own
WebP is small enough that the base64 overhead is free, and it means nothing
here has to track object URLs for revocation on unmount.

`.thumb` grew from a 40px icon to a 63:88 card-proportioned tile for this —
a picture that small reads as a coloured square, not a picture, and the
character-card peek needs real size to be legible at all. The
`.thumb img.card-peek` selector is written out in full, not shortened to a
bare `.card-peek`, for the same specificity reason `GalleryScreen`'s own
`.cover img.card-peek` documents: the element-plus-class rule above it
(`.thumb img`) outranks a lone class regardless of source order, which
silently won `object-fit: cover` over the `contain` this rule sets and
cropped the stat block clean off.

### Guides

A guide is a short, step-by-step walkthrough of one thing the app does, shown
as a modal over whatever screen you were on. `guides/types.ts` is the shape,
`guides/content.ts` is every guide, `state/guides.svelte.ts` is which one is
open, and `components/guides/` draws it. Adding one is writing an entry and
dropping screenshots into `public/assets/guides/` — nothing registers, imports
or is told about it, because Home lists whatever is in the array.

**A guide is an overlay, not a place**, so it is its own store rather than a
`View` in `navigation.svelte.ts`. Closing one has to put you back exactly where
you were, which as a `View` would mean every guide remembering and restoring
what was underneath it — `openAuthor`'s `#returnTo` problem, for nothing. The
store is app-level, and `GuideModal` is mounted once in `App.svelte` above the
view switch, because half the topics worth a guide (adding decks, custom
symbols) are things an author is doing *inside* a set. Home's card is the first
entry point, not the only possible one.

**The screenshots are clean and every annotation is data.** A step's `hotspots`
are fractions of the image; `GuideShot` draws the boxes and the callouts.
Baking arrows into the picture was the alternative and is worse in three ways
that all cost time later: an image editor for every wording change, no way to
follow the app's own theme, and text that turns illegible on a narrow window
because it scales with the bitmap.

That makes one thing load-bearing that reads as tidiness: **the frame takes the
picture's own aspect ratio.** A hotspot is a fraction of the frame, so if the
frame is any other shape `object-fit: contain` letterboxes the image inside it
and every box lands where the picture is not — a portrait sidebar shot in a
landscape frame put a box meant for a 245px row across the whole dialog. The
aspect is read on mount *and* on `load`, because an image already in the cache
— every step you go back to — is `complete` before the component exists and its
`load` event has already been and gone.

**`GuideAction.run` is a name, not a callback**, resolved by `GuideModal` to a
real handler. Content that reached into the store would make a data file depend
on half the app, and a typo would be a crash inside a modal. It also lets the
modal *check* an action: a `setPage` action is hidden unless `navigation.inSet`,
so a guide read from Home never offers a button that goes somewhere unexpected.

**The dialog is a native `<dialog>` driven from the store**, the same as
`NewSetDialog` and for the same reasons — focus trapping, Escape, the top layer
and an inert background, none of which this app has a dependency to
reimplement. One thing the store cannot express, though: `dialog.open` is a DOM
property and nothing reactive can read it, so if the element is ever closed
without `onclose` running, the store still believes it is open — and
`open(sameId)` then changes no state, the effect never re-runs, and the guide
can never be opened again. `Guides.#opened` is a counter bumped by every
`open()` and read by the effect for no other purpose than to make re-opening
re-assert the DOM.

Worth knowing when verifying any of this in the preview browser: **that pane
does not fire `dialog`'s `close` event at all** — confirmed on a bare,
freshly-created `<dialog>`, not just this one. So the Escape path cannot be
exercised there, and a test that closes the element directly leaves the store
and the DOM disagreeing in a way that looks exactly like broken reactivity and
is not. (The other half of that afternoon: `import('/src/lib/state/guides.svelte.ts')`
from the console is a *different module instance* from the `$lib/state/guides.svelte`
the components import — the same trap the `?t=` cache-buster note records. Every
reading taken through it was of a store nothing was watching. Drive the UI.)

**The screenshots are captured, not drawn**, and repeatably:
`tools/capture-guide-shot.js` runs in the dev console and photographs a DOM
element with the app's own rasteriser (`renderPlateImage` with a synthetic
`format` — only `format.bleed` is read on the `bleed: true` path), and
`tools/guide-shots.py` trims, pads and converts to WebP. A guide's shots go
stale every time the UI they show moves, so one nobody can re-take is one
nobody will update. Three things that route learnt the hard way:

- **Form controls must be mirrored into attributes first.** A `<select>`'s
  chosen option is a property and does not survive `cloneNode` — the trap
  `ThreatBoard`'s `editable` prop exists for. Without it every select in a shot
  shows its *first* option: a deck owned by a character photographed as "Whole
  set", which is not a blank or an error but a confident picture of the wrong
  thing.
- **Flatten onto an opaque backdrop before writing.** Most panels here are
  tinted rather than painted, so photographed alone they keep their alpha and
  anything that later drops the alpha channel gets the colour at full strength.
  A dark orange band came back as a slab of pure orange.
- **Trim per edge, iteratively.** A single pass measured against the corner
  pixel does nothing to a panel whose header is a different colour from its
  body, and a whole-image "is this background" test crops a section's heading
  off. Per-edge works, but only if repeated: one border pixel down an edge puts
  a differing pixel in every row of the empty tail, so nothing is uniform until
  that column has been eaten.

**Not every screenshot has to come from that tool.** `guides-intake/` is a
second, simpler drop zone for shots someone already has or takes by hand —
see `guides-intake/README.md` for the convention. `guide-shots.py` converts
anything found there straight to WebP, untrimmed, on the theory that a
supplied picture is already framed the way it should end up; a DOM capture's
element bounds rarely are. Committed to the repo is only the README — the
folder itself, and anything dropped into it, is gitignored the same way
`exports/` is, so a half-finished set of screenshots for a guide nobody has
wired up yet never shows up as noise in `git status`.

`TitleBar` carries a "Home" button beside "Gallery" now, for the same reason
the gallery already paired the two: leaving a set used to mean finding
`SetNav`'s small back-chevron in the tab strip, which this replaces rather
than sits beside — two controls both meaning "leave this set" is redundant
chrome, not a convenience. `workshop.closeSet()`, not a bare
`navigation.openHome()`, is still what the button calls, because leaving a
set is what refreshes the library index and clears "last open," not merely a
view change.

Renaming the top-level page freed "Home" for exactly one thing, so the
set-level page that used to answer to it — `components/home/SetHome.svelte`,
the roster and completeness dashboard for one open set — needed a new label.
`SET_PAGE_META.home.label` is `'Edit'` now; the underlying `SetPage` key
stays `'home'`, since nothing reads that string except as an enum value and
renaming it would be churn with no visible effect. The component's own
filename and folder (`components/home/`) are unchanged for the same reason
`storage/library.ts` is: they name what the thing *is* — a set's own home —
not what a nav label currently calls it.

### Sharing and the gallery

**`GalleryScreen` and `SharedSetScreen` render outside `AppShell`** (see
`App.svelte`'s routing, alongside `HomeScreen`), so `TitleBar` — which
assumes a set is open (`workshop.adventure`, Save, Export) — was never an
option for either. Each carries its own inline `<header class="head">`
instead, and each used to offer only a single "back" button: "Home" on the
gallery, "Done" on a shared set. Both now also carry `ThemeToggle`,
`AccountMenu`, and (gated on `cloudEnabled()`) a link to the other of the
two — the same standing set of controls `HomeScreen`'s own header already
established as what a shell-less screen offers. `SharedSetScreen`'s own
"Done" stays alongside the new Home/Gallery buttons rather than being
replaced by them: it is the one control that remembers *where this set was
opened from* (`navigation`'s `#returnTo`) rather than naming a fixed
destination, and a button that already does something more specific than
"go Home" is worth keeping next to the ones that do not.

**Leaving a shared set through anything other than `navigation.leaveShared`
strands the URL.** A shared set is the one screen in this app with a real
path (`/shared/{slug}`, not a hash — see below), so the Home and Gallery
buttons added to its header call `navigation.leaveShared({ kind: 'home' })`
/ `leaveShared({ kind: 'gallery' })` rather than `navigation.openHome()` /
`openGallery()` directly: only `leaveShared` clears the `/shared/{slug}`
path first, and a bare `openHome()` would leave it in the address bar to
reassert itself on the next reload — the same trap `leaveShared`'s own doc
comment already warns about for "Done".

A set with no villain and no minions is a **gap, not a blocker**
(`sets/health.ts`). With heroes in, a box of them is a set in its own right,
and telling someone who has built one that it is not playable is simply wrong.

`src/lib/cloud/` talks to Supabase over plain HTTP — no client library, same
zero-dependency rule as everything else. The contract that shapes it: **the
cloud is a publish target, never the source of truth.** A published row is a
copy of a document that still lives in the author's browser, so losing the
network loses sharing rather than the set.

Row level security is the boundary, not the client. Two policies that look
alike and are not:

- `sets_public_read` exposes `visibility = 'public' and not hidden`. The
  tempting version — "unlisted *or* public" — would let one query return every
  share token in the database. An unlisted set is reachable only through
  `set_by_slug`, which is `security definer` and returns at most one row.
- `hidden` is held apart from `visibility` so a takedown leaves the author's own
  setting alone, and it kills the *link* as well as the listing — otherwise a
  moderated set vanishes from the shelf while every held URL still works.

**A public read must never carry a user token.** `listPublicSets`,
`fetchSetBySlug` and `record_set_view` pass `anonymous: true`, which sends the
project key even when someone is signed in. The RLS policy answers the same
either way, so the token buys nothing — but a *stale* one costs everything:
PostgREST refuses an expired JWT outright, so a session left overnight emptied
the gallery for its owner while every stranger saw it fine, and the screen said
"JWT expired". A shelf that is only there for people with a fresh session is not
a shelf, and a share link that fails because of the *reader's* session is the
worst failure the app has. Anything new that reads published data belongs on the
same footing.

`is_admin` is withheld by **column grant**, not by policy: a row policy cannot
see a column's old value, so "update your row but not that field" is not
expressible as a `with check`. Grants are checked first, so there is no route
through PostgREST to self-promote.

**`profiles.display_name` defaults to a real name, and that default is a
privacy problem an author can walk into without choosing it.** `handle_new_user`
seeds it from whatever the OAuth provider hands back at first sign-in — Google's
`full_name` — so signing in with Google used to mean a real name went out under
every set published and every contribution offered, with no screen that ever
asked. The trigger only runs once, at signup; nothing about it re-syncs later,
so `cloud/profile.ts`'s `updateOwnDisplayName` is not fighting it, only
overwriting what it wrote. `AccountMenu.svelte` is the one place that calls it
— a persistent menu in `TitleBar`, not folded into `SignInPanel`, because the
name someone wants to fix might belong to a session they signed into weeks ago
and the fix needs to be findable without first trying to publish something.
Fetching the row is never the boundary (`profiles_public_read using (true)`
means anyone can already read it); the fix is giving the value a UI at all.

`sets.owner_id` references **`profiles`**, not `auth.users` — PostgREST builds
embeds from foreign keys, and without one the gallery needed a second query per
tile to name the author. Nothing is lost by the swap: `profiles.id` cascades to
`auth.users` in turn. Note that cascade — deleting an account deletes its
published sets, which is easy to trigger by accident when tidying test users.

A gallery tile is drawn from the **row**, never the document: `document` is the
whole set, so thirty tiles would mean pulling thirty multi-megabyte documents to
show thirty pictures. `thumbnail_url` is filled at publish by downscaling the
box art (or the first character's artwork) to 512px of WebP.

Sorting is by `published_at`, not `updated_at` — the latter moves on every
re-publish, so "newest" would really mean "most recently edited".

`revision` is written by a **trigger**, never by the client, and moves only when
`document is distinct from old.document` — a visibility flip or a takedown is
not a new edition. It shipped declared-but-never-written, so every set read
"revision 1" while meaning nothing.

**A copy of a published set is a fork, and records what it came from.**
`SharedSetScreen` draws `AssetsOverview` read-only beside `ExportPanel` and one
copy button. There was a plain "Add to my library" here once and it was removed:
a copy that forgets its origin makes every share link a fork button — the
author's set edited onward under the author's name, and a gallery of
near-identical copies with nothing to tell them apart. The objection was never
to copying, it was to copying that erased the source. None of it is a lock: the
whole document is in the viewer's browser the moment the page draws, and the
`.json` export is a re-importable copy. What the fork route buys is a copy that
can later offer its changes *back*.

`SharedSetScreen`'s copy button is behind a `SHOW_FORK` constant. Off ever meant
only that the button was not drawn — `fork()`, `sets/fork.ts`, the fingerprint
it records and the lineage the row carries were never touched by the flag, and
a copy already taken always showed its way back to the library. Back on now
that the heroes release has shipped.

A copy's own lineage badge follows it to the shelf. `HomeScreen` (then
`LibraryScreen`; renamed when Home absorbed the library page) already
showed `originAuthor` (denormalised into `storage/library.ts`'s `LibraryEntry`
index, the same reason every field there is denormalised — a tile per set
would otherwise mean loading every document in the library to draw a list of
them); `originRevision` rides beside it now, in the same `· revision N` wording
`SetHome`'s own lineage line already uses. It is what tells two forks of the
same published set apart on a shelf that would otherwise show the same name
twice — fork it once at revision 4, again after the author publishes more, and
the second copy reads "revision 6" without opening either to find out. Shown
unconditionally rather than gated past revision 1, matching `SetHome`: a first
fork is still worth saying "revision 1", once there might be a second beside it.

`sets/fork.ts` holds the one rule everything else depends on: **a fork keeps
every id inside the document, and only the set's own id changes.** Card, deck,
character and figure ids are preserved so a change can later be described as
"this card moved and nothing else did"; re-minting them would work perfectly and
silently destroy that forever. The set's own id *must* change, because the
library is keyed by it and adopting under the published id would overwrite the
original author's working copy when they open their own share link.

`sets/fingerprint.ts` is the other half, and the part that cannot be added
later. Offering a change back needs a three-way comparison — base, theirs, mine
— and the base is not recoverable, because publishing overwrites and revision 2's
document stops existing when revision 3 is published. So a fork records a
content hash per entity *at the moment of copying*: enough to answer "was this
the same before?" for every card, at about 4 KB against several megabytes for a
second copy of the document. The canonical stringify sorts keys at every level
and must keep doing so — `JSON.stringify` preserves insertion order, so a card
that gains a previously-absent field round-trips with a different key order and
would otherwise read as edited when nothing changed. Arrays are deliberately not
sorted: order is meaningful in ability blocks, threat steps and map paths.

Lineage on the row is `forked_from` / `forked_from_revision`, `on delete set
null` — **never cascade**. `owner_id` already cascades from `profiles` and that
has destroyed a published set once; an original being deleted must orphan its
copies, not take other people's work with it. PostgREST embeds the origin by the
**column** name, `origin:forked_from(…)`. Naming the table instead —
`sets!forked_from(…)` — is a legal request that silently resolves the
self-reference *backwards* and returns the sets forked from this one, so an
original gets credited to its own copy while the copy shows nothing.
`set_summary_by_slug` answers "has the original moved on?" without the document,
because that question is one integer and `set_by_slug` would charge megabytes
for it.

**A shared set's link is the one URL in this app that is a real path rather
than a hash**, and `middleware.ts` (project root, alongside `vite.config.ts`)
is why. Everywhere else, routing lives entirely after `#` on purpose — see
`state/navigation.svelte.ts` — because a hash needs no server and works from
`file://`. A link unfurler (Discord, Slack, Twitter…) breaks that: it fetches
a URL with plain HTTP and reads whatever `<meta>` tags come back, never runs
the app's JavaScript, and a fragment never leaves the browser in an HTTP
request at all — so `#/shared/{slug}` cannot tell a bot which set is being
asked about, by the URL spec, not by any missing configuration. `shareUrl`
therefore hands out `…/shared/{slug}` as a real path now; `readSharedSlug`
reads that form *and* the old hash form, so a link already pasted somewhere
keeps working, and every in-app navigation still only ever writes the hash —
`shareUrl` is the one place that writes the path form at all.

`middleware.ts` is a Vercel Edge Middleware matching `/shared/:slug`,
deliberately self-contained rather than importing from `src/lib/cloud/` — it
runs outside Vite entirely, so `$lib` does not resolve there, and the one
PostgREST call it needs (the same anonymous `set_by_slug` RPC `fetchSetBySlug`
already makes, read `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` out of
`process.env` — already-configured Environment Variables, since the client
build needs them too; Vite's `VITE_` prefix only gates what reaches the
browser bundle, not what a server-side function may read) is small enough
that duplicating it beats a shared build step for it. It only ever answers a
request whose User-Agent names a known unfurling bot, with a tiny hand-written
HTML page carrying `og:title`/`og:description`/`og:image` — the image is
`thumbnail_url`, already sitting on the row from `publishSet`, so nothing here
renders a picture, it only ever echoes one that already exists. Every other
request — every real visitor — falls through untouched to `vercel.json`'s
rewrite, which serves the ordinary SPA exactly as if this file did not exist.
Untestable via `vite dev`, which has no Edge Runtime to run it in: verifying
it means an actual Vercel deploy, then either curling the URL with a spoofed
bot User-Agent or pasting a real link into Discord — which also means it
inherits Discord's own aggressive per-URL unfurl caching, so a fix does not
show up on a re-paste of the same slug without a cache-busting change.

`cloud/thumbnail.ts`'s `coverArtwork` — the function that decides what
picture becomes `thumbnail_url`, and now also what a shared link's preview
image shows — used to take "the first character in the set's array with
artwork," i.e. creation order, whatever role that character happened to be.
It now explicitly prefers the villain, then the first hero, before falling
back to that same creation-order search — matching how an author thinks about
their own adventure (see "Heroes, above Villains" in `SetSidebar`), not an
accident of which character was added first.

**A shared link's preview picture is not the gallery tile's.** It used to be
— `thumbnail_url` did both jobs — until a link posted to Discord showed a
hero's deck-back *replacement image* exactly as the author drew it: full
bleed, margin and all, because `renderThumbnail` has only ever been a
downscale of whatever `coverArtwork` finds, never a render. That is the right
job for a square gallery tile and the wrong one for a link preview, which is
read much larger and has no tile to crop into. `cloud/social-image.ts`'s
`renderSocialImage` is a second, purpose-built picture stored in its own
`social_image_url` column: box art still wins outright when an author
supplied one (unchanged from `coverArtwork`'s own priority), but failing
that, a set with heroes gets an actual **rendered, trimmed** picture of its
own cards — one hero's deck back beside their character card, several heroes'
deck backs in a grid two to a row, capped at four before it would read as a
contact sheet rather than a preview. Reuses `cloud/character-cards.ts`'s
stage exactly (`withCardStage`/`photograph`), just with `cardback` instead of
`statCard`, or both. A set with no heroes to compose from — villain-only, or
still early — falls through to the same downscale `renderThumbnail` already
does, checked *before* opening a card stage so that case pays nothing extra.

**This is the one column in this project that a migration cannot backfill.**
Every prior denormalised-column addition (`kind`, `hero_count`) backfilled
from the stored `document`, because the fact was already sitting in JSON a
migration's SQL could read. A composed picture is not a fact sitting
anywhere — producing one needs the browser's own DOM and canvas, which a
migration running on the server has neither of. So a row published before
this shipped simply keeps `social_image_url = ''` until its author
re-publishes, and `middleware.ts` falls back to `thumbnail_url` whenever it
is empty — an old link's preview does not regress, it just stays what it
already was.

**The shared-set screen's character filter is not a second picker.** It
reads as one — pick a hero and the overview above narrows to just their
content — but it is wired entirely through `ExportPanel`'s own scope
selector (`onscopechange`), the same one that already decides what "export
just this hero" produces via `sets/scope.ts`'s `computeScopedSet`. "What
will this export" and "what am I looking at" were the same question the
moment a viewer could filter at all, so `SharedSetScreen` mirrors that one
control's value into what it passes `AssetsOverview`, rather than growing a
second selector that could disagree with the first.

### Contributions

Rung 2, and the shape of the trust is the thing to hold on to: **a contribution
is a proposal, and nothing can make it more than that.** Accepting one edits the
owner's document in their own browser — `workshop.applyContribution` — and the
row only records the decision. There is no path by which a stranger's row
mutates a published set, and there must not be one.

The unit is **one entity**, never a field within one. A card whose name and
ability both changed is one offer, taken or not; two people's wording of the
same sentence is never merged. That is what makes the whole thing tractable.

Conflicts need no history. Each entry carries the entity's hash *at fork time*,
so the owner hashes what they currently hold and compares: equal means they have
not touched it and it applies cleanly, different means both moved and only they
can judge it. `reviewEntries` runs that at **review** time rather than at
submission, so an offer that sat for a month is judged against the set as it
actually is.

Two traps already paid for:

- `kindOf` matches the prefixes the factories actually mint — `char_` and
  `fig_`, not `character_` and `figure_`. Guessing them from the type names
  produced a `kindOf` that returned `null` for every character and figure, so
  their changes vanished from an offer without a word.
- A removal cannot be named by the contributor: they deleted it, so their
  document has nothing left to read a name off. `reviewEntries` relabels it from
  the owner's copy, which still has it — otherwise the owner is asked to approve
  deleting "Untitled card" when the card was called "Melting".
- **A `character`-kind entry drew nothing at all**, for any hero. A hero's
  stats *and* its printed character-card design (`Character.characterCard`,
  read by `HeroCharacterCardFace`) both live on the `Character`, not in
  `set.cards` — so `ContributionsScreen`'s original `cardIn(document, key)`,
  which only ever searched `set.cards`, silently found nothing for `kind:
  'character'` and the whole comparison was skipped. `heroIn(document, key)`
  is `cardIn`'s sibling for this case — looks the character up, returns it
  only when `role === 'hero'` — and renders through `CardRenderer`'s existing
  `statCard` prop, the same one `PreviewPanel` already uses for a hero's own
  sheet, rather than a second drawing path. Villain and minion `character`
  entries are unchanged by this and still render nothing: neither role has a
  printed character-card sheet for `statCard` to draw, so there is nothing
  new to show them.

The review screen renders the proposed card from a **preview document** —
`applyEntries(set, [entry])` — rather than from the set as it stands, because
`resolveStyleForCard` reads the set's and the character's layers, so a card
whose offer also changes a theme would otherwise be drawn under the wrong one.

RLS is the boundary, tested by attacking it. Two permissive `update` policies
OR together and each pins the status its own `with check` allows, which is what
stops a contributor marking their own offer accepted — their policy can only
ever write `withdrawn`. `payload`, `set_id` and `resolved_at` are outside the
update grant, so a decided offer cannot be rewritten into a different one and
the timestamp belongs to a trigger. `set_accepts_contributions` is `security
definer` for the same reason `set_by_slug` is: a policy checking `sets` directly
would refuse every offer to an *unlisted* set, which is most of them.

**Public credit is a narrower, separate question from the proposal itself.**
`set_contributors` answers only "did this set take anything from them", never
what — no payload, no title, no message, and only `status = 'accepted'` with at
least one key actually in `applied_keys`. That last clause matters: an offer can
be marked accepted with nothing taken (every entry conflicted and the owner
still wanted to close it out), and crediting someone for zero changes taken
would be a false credit. Safe to expose to `anon` at all because it reveals
nothing that is not already sitting in the published document — the changes are
visible either way; this only names who made them. The owner's own view
(`tallyContributors`, folded into Set Home) needs no equivalent function — RLS
already gives an owner full read of their own set's contributions — and it is
allowed to show *how many* changes landed per person, which the public credit
deliberately does not.

That is what `ExportPanel` exists for. The exporters always took a set rather
than reaching for the store, so the list of them could move out of `SetHome`
wholesale; `PrintScreen` and `AssetsOverview` take an optional `set` prop for
the same reason, falling back to the open one. Anything else that wants to work
on a set the author does not own must follow that rule — reach for
`workshop.adventure` and it will render the wrong set, or an empty one.

### Customizing an export

`sets/export-selection.ts`'s `ExportSelection` is a second, finer prune
layered on top of `sets/scope.ts`'s `PublishScope` — "leave the special deck
out of *this* export" rather than "publish just this hero." Deliberately its
own module rather than folded into `scope.ts`: a `PublishScope` result is a
document someone else's browser may hold onto for years, addressed by a
link, where an `ExportSelection` is never written to the document, never
sent anywhere, and — enforced by `ExportPanel` resetting it on every `scope`
change — never outlives the picker session that built it. `ExportPanel`
threads `set` through `scopedSet` (the `PublishScope`) through `finalSet`
(the `ExportSelection`) and every exporter reads only the last of those.

**Deck-level only, no per-card checkboxes — asked for by name.** A card
excluded on its own while its deck stays is already safe (the deck just
prints one card lighter), but "hide one card" was never the request; "toggle
off the special deck" was. Keeping the unit at the deck is what keeps this a
single `Set<DeckId>` rather than a tree of tri-state checkboxes that would
need to show a deck as "some cards on" — simpler to build and simpler for an
author scanning a long list to reason about.

**Decks are filtered first and cards are derived from the decks that
survive, never the reverse** — the same discipline `heroSlice`/`villainSlice`
already keep, for the same reason. `card-pngs.ts` and `tabletop-simulator.ts`
both build their output by walking decks and looking cards up by `deckId`
(via `queries.ts`'s `outline()`), so a card whose deck was removed out from
under it does not error, it just silently stops appearing in either export —
survivable, if confusing. The set-file export is not so forgiving: `json.ts`
serialises whatever it is handed with **no validation on write** (validation
is only ever a read-time concern, in `parseSetFile`), so a document with a
card pointing at a deck that is not in it would fail to re-import later with
"File contains a card that points at a missing deck." `applyExportSelection`
cannot produce that, not even transiently, because it never has an
independent "excluded cards" list to desync from "excluded decks" in the
first place.

`ExportSelector`'s dialog reads the set through `queries.ts`'s `outline()`
rather than walking `set.decks` itself, for the reason every other consumer
of it does: it is already grouped exactly the way `AssetsOverview` and the
sidebar show it, so "a hero's decks" or "the loose pile" can only mean one
thing across the whole app.

### Print sheets

`src/lib/print/` lays cards out on paper at true size. It is a **screen**, not an
exporter, and the browser's own print dialogue is the output — which is why
`registry.ts` no longer declares a `print-pdf` slot. A PDF written here would
have had to carry every card as a JPEG, because the app has no compression
beyond what a stored ZIP entry needs, and that is the worst possible treatment
of black line on white. Printed from the DOM the type stays vector.

Three files, split like the TTS export:

- `paper.ts` — A4 and Letter, the 10mm margin, the crop marks, the calibration
  rule. All millimetres, no bleed anywhere: bleed exists so a guillotine can
  miss, and someone cutting at a table is cutting *to* the line.
- `sheet.ts` — pure planning. Pages are grouped by printed size for the same
  reason a TTS sheet has one cell size, quantities become real cards, and each
  front page can be followed by its reverse with **each row reversed** — a
  long-edge duplex flip turns the sheet about its vertical axis. Initiative and
  rules cards have no drawable reverse and say so rather than printing a blank.
- `PrintSheet.svelte` / `PrintScreen.svelte` — the paper. `PrintScreen` renders
  **outside `AppShell`**, from `App.svelte`, because a print view nested in a
  title bar and a nav has three things to hide at print time and three chances
  to shift the sheet by a millimetre.

Rendering outside the shell has one consequence worth knowing: `base.css` sets
`body { overflow: hidden }` because "the shell owns all scrolling", so a screen
outside it owns its own or has none. It shipped without, and the sheets were
clipped at the fold — the first page cut off, the second unreachable.

Preview zoom is a property of the *preview*, undone entirely by `@media print`.
The reset is `!important` because it has to beat an inline `transform`, and the
failure it prevents is silent: printing while zoomed out would have produced
cards a third of true size, discovered only after they were cut. Measured: 20.71
× 28.93 mm on screen at Fit, 63 × 88 mm with the print rules applied.

`@page` has to go through `<svelte:head>`: it is attached to no element, so
Svelte has nothing to scope it to. Its margin is zero because the sheet holds
the margins in its own coordinates.

Every sheet prints a 100mm rule, and that is not decoration. Several browsers
default the print dialogue to "Fit to page", which scales the sheet a few per
cent — invisible until the cards will not sleeve.

### Printer-friendly mode

Black line on white, no artwork: `CardRenderOptions.printerFriendly`. Most of it
is `cards/mono.ts`, one more layer on the existing cascade above the card's own
overrides, so nothing in the document is touched. The ribbon keeps its outline
for free because that outline is drawn in `divider`, which is the one surface
that stays black.

What the cascade cannot reach is a stylesheet in `CardRenderer`: artwork is not
a colour, an initiative band's fill and ink are held on the **card** rather than
in the theme so there is no key to override, and the attack and defense symbols
are drawn light for a dark panel (`brightness(0)` inks them without filling
their boxes). Those overrides are `!important` because every value they beat is
an inline style written by a face component.

Measured, on an action card: 3.7% of the trimmed face is dark, against 53.9% in
colour.

**The hero's character card needs the most of any face, for a structural
reason.** It is the one card that does not go through the style cascade at all
— `Character.characterCard` is its own small design object — so `MONO_LAYER`
has nothing to override and the sheet printed in full colour. The whole of the
missing layer is CSS, scoped by a `hero-character` class on its `.face`,
because the face's class names are *not* all unique: `.fill`, `.border` and
`.move` are each shared with another template. `.move` had already collided —
the initiative card's MOVE badge is a mask, so `background: #000` is right for
it and painted this card's move numeral, which is a `<span>` of text, as a
black slab across the health badge. Renamed here to `.move-figure`; a
component's styles are scoped to the component, but a `:global` selector
written in *another* one is not.

The card's own split does the rest of the work: what the frame art draws is
line art and inks black, what an author fills goes white. The exception is the
border mask, which is not only the bars between the bands — it is also a 144px
band of colour around the whole card, pale pink on the printed sheet and 2.9mm
of solid black outside the trim if it is inked like everything else. It is
clipped back to the printed rectangle plus one `--keyline`, which turns the
band into the card's own outline and leaves every interior bar untouched — the
same trade every other template makes, except that here the drawn-back edge is
the border art's own inner boundary rather than a rule beside it. Measured:
25.4% of the trimmed face dark before the clip, 12.1% after, 0% saturated.

### Skin templates

`assets/resources/` holds the Photoshop files an author paints a piece's face
in — the dial's, and a two-sided token's — with a flattened `.png` beside each
so they can be looked at without Photoshop. They are **generated**, by
`tools/health-dial-skin.py` and `tools/token-skin.py`, from the numbers that
describe the piece: the dial's diameter, the Lua's trigger positions, and the UV
split a two-sided token uses (including the fact that the *centre pixel* of a
two-sided image is what paints the rim). Regenerate rather than hand-editing —
a guide drawn from a stale number is worse than no guide.

`tools/psdwrite.py` is enough of the PSD format to write them: an 8-bit RGB
document, RLE-compressed full-canvas layers, and a composite. Verify anything it
writes by reading it back with `psd_tools` and checking the stored composite
against a recomposite of the layers — Photoshop is stricter than most readers.

They live in `assets/`, not `public/`, because `public/` ships verbatim into
`dist/`. Nothing in the app fetches them.

### Geometry is measured, not estimated

`src/lib/renderer/geometry.ts` is the source of truth: every number was read off
a print template's alpha channel or ink, in **bleed pixels**, then converted to
percentages (`px`/`py`) and `cqw` (`pu`) so one markup is correct at a 120px
thumbnail and at 300 DPI. Text is positioned by cap height via
`capTopToBoxTop()`, not by CSS box.

To add or correct geometry, measure the template with Python/PIL rather than
eyeballing:

```bash
python -c "
from PIL import Image; import numpy as np
a = np.array(Image.open('public/assets/templates/outer_border.png').convert('RGBA'))[:,:,3]
print([(y, round((a[y]>128).mean(),3)) for y in range(0, a.shape[0], 100)])
"
```

**Nothing measures text at runtime.** Dynamic sizes — the name ribbon's length,
the body panel's height, the vertical rule's run — fall out of flex layout: type
is set in a vertical writing mode so its length *is* its box's height, and the
panel is bottom-anchored so growing it moves the divider. Where a size genuinely
cannot be laid out (the event heading), it is derived from the face's mean
advance in `renderer/fonts.ts`, still without measuring.

The card title is the same trick turned sideways. It used to be pinned at
`TITLE.capTop` with `white-space: nowrap` and an ellipsis, so a title one word
too long simply lost its tail — never a second line, because everything below
it (the rule, the value stack, the ability text) was *also* pinned, at fixed
offsets from the panel's own top, on the assumption that the title was
exactly one line tall. Letting the title wrap meant the rule and everything
under it had to start riding down with it, which a fixed offset cannot do —
so `TITLE_RULE.y` stopped being a position anything is placed *at* and became
one only the single-line case still lands on by construction.

`ActionCardFace` now puts the title in flow rather than pinning it — `panel-lead`
spacers before and after it, sized from `TITLE_BOX_TOP` and `TITLE_RULE_GAP`,
with the rule as a flow sibling right after — so a wrapped second line adds its
own line-box height to the title and carries the gap, the rule, and everything
below along with it, the same as the name ribbon's own length falling out of
its column. Bounded to two lines rather than left to run on indefinitely, so a
long title cannot push the ability text an unbounded distance down the card.

**That bound is a `max-height`, and it must not go back to `-webkit-line-clamp`.**
Clamping was the obvious way to do it and buys an ellipsis on the clipped line,
but `-webkit-line-clamp` needs `display: -webkit-box`, and legacy box layout
blockifies every child of the box — so once the title could carry an inline
symbol (`{{attack}}` in a title, same palette the ability fields use), every
symbol took a line of its own wherever it sat in the string. Wrapping the whole
run in a single inline child was tried and did not fix it. The title is an
ordinary block now with `max-height` at exactly `TITLE_MAX_LINES` line boxes,
which bounds the same thing through the inline layout every other piece of copy
on this card already uses.

What that gives up is the ellipsis, which this face can afford: `.split`,
`.half` and `.ability-block` all clip rather than ellipsise, so a clipped title
reads as the same "this does not fit" signal they do. Nothing legible is lost to
the clip — at this face's metrics (`line-height` 0.9 against a cap height of
0.703) the second line's capitals sit about 0.15em clear of the cut.

Everything from the rule down — the value stack's symbols and numbers, the
split body, the ability block — used to be positioned as an offset from the
panel's top (`inPanel`). Once the rule can move, that origin is wrong for all
of them, so they are positioned as an offset from the rule instead
(`belowTitleRule`), inside a `.below-title` wrapper that is `position: relative`
for exactly that reason. The wrapper's own top edge is wherever flow put the
rule — never a number — so nothing here needed to learn how many lines a
wrapped title used; CSS already knew.

### Standing in for Knockout

The printed cards are set in Knockout HTF, which cannot be redistributed. Three
files stand in for it, and they are **cuts, not weights** — which is how the
printed cards get their contrast in the first place:

| file | for | roles |
|---|---|---|
| `BebasNeue-Custom.ttf` | Knockout HTF48 Featherweight | name ribbon, card title |
| `Oswald-custom-condensed.ttf` | *by association, not by the record* | initiative labels and copy, rules heading, threat board |
| `Os-Custom-Junior.ttf` | HTF29 JuniorLiteweight, HTF49 Liteweight | ability text, quantity, boost + combat values |

Each carries one weight, so every role in `card-fonts.css` is 400: asking for
more buys a synthetic smear rather than a heavier drawing.

The Featherweight roles moved to Bebas Neue because it matches on the property
that cannot be fixed by measurement — stem weight, 0.158 of cap height against
0.160 — where the Oswald cut had to be squeezed into place. Bebas is **caps
only**: every lowercase codepoint is drawn as a capital, which is why it takes
those two roles rather than `--card-font-title` wholesale. The condensed Oswald
keeps the roles that carry mixed-case copy.

Compare a candidate face with `tools/font-compare.py`, which reports vertical
metrics, stem width, per-glyph overlap and the set widths `condense` is fitted
to. Run it against the Knockout **file** in `assets/fonts`, never against a
print template: the template's ink already carries the artwork's tracking, and
measuring through it folds that tracking into the face's width so it is applied
twice.

The glyph inventory is chosen **per pair**, not fixed. Lower case is compared
only when both faces draw it — and whether a face draws it cannot be read from
the cmap, because Bebas's 'a' is a separate glyph id whose outline is the
capital, so every lookup says the lower case is there. `fonts.draws_lowercase`
therefore compares the drawings: caps-only faces score 1.0000 against their own
capitals, mixed-case faces 0.35–0.46, so the test needs no careful threshold.
The mixed-case set-width strings (`MIXED_STRINGS`) come in on the same
condition, since `condense` for copy is a different question from `condense`
for a title.

**Both are cut to Knockout's own vertical metrics**, and that is what makes the
current arrangement simple where every earlier one was not. Caps stand at 0.666em
(the browser measures 0.672, its 1/64px resolution), the lining figures and the
x-height match too — so `inFace()` and `inFaceLeading()` are within a percent of
identity, and a size read off a template is very nearly the size to set. Every
stand-in before this kept Oswald's 0.81em caps, and the size, the leading and
the widths all had to be reconstructed around that.

What is still not free is **width**, and the useful thing learnt while fixing it
is that most of what looked like width error was not the face:

- **Tracking.** The artwork was set loose. At the template's own cap heights
  Knockout *itself* comes up 4% short of the printed ink on both the title
  (380px against 395) and the ability line (783 against 814). It is set as
  `tracking` per role, in em, and it is per role because the title wants
  0.012em and the copy 0.028em. Stretching glyphs to the same total would
  fatten every stroke to imitate something that happened between letters.
- **Size.** The title read 120.5 for a long time; the template's title stands
  84px to the cap, so it was set at 126. The event copy read 154.5 where its
  template says 123.7. Back-solve a size from ink rather than trusting a
  constant that has never been checked.
- **The face**, last and smallest: `TITLE.condense` is 380.0/374.2 — Knockout's
  own ink over the stand-in's, both at a matched cap height. Measured against
  the Knockout *file*, in `assets/fonts`, never against the template, so
  tracking cannot land in it twice. The ability copy needs none: it is within
  1% of Knockout, under what the measurement can resolve.

The MOVE badge's numeral is a separate case and always was — the template's "3"
is 97px where Knockout sets 176, so `numberCondense` is the artwork's own
distortion, not the substitution's.

A ratio is a multiple of the *nominal* size, so any `lineHeight` that does not
go through `inFaceLeading` silently changes its absolute leading when the face
does. `INITIATIVE.bodyLineHeight` is the only one, because it is the only
leading on any card with no artwork measurement behind it — the supplied
initiative art carries no sample copy. It has to be re-derived by hand on a face
change; everything else follows from `inFaceLeading`.

**Read the low-resolution templates anyway.** The event template is 373px at
trim, where a pixel becomes 5.49 at bleed, and that was taken as a reason not to
measure it. It is worth about 7% — against a size that was out by 25%, and a
leading a fifth too tight, not measuring cost far more than measuring would
have. The two errors had been cancelling, so correcting only the leading ran
ordinary copy off the bottom of the card.

### Derived assets

Some files in `public/assets/templates/` are **generated from the supplied
templates**, not authored:

- `initiative_frame.png` — `Initiative Card_border.png` with the band bars and
  label separators erased, so the renderer can draw those at whichever band
  positions a card actually has.
- `event_logo.png` / `event_logo_ink.png` — the Unmatched Adventures lockup
  lifted out of `event_back_template_blank.png` as two alpha layers (box, and
  the lettering knocked out of it).
- The hero card's five, all from `tools/hero-card-assets.py` — see *The hero
  role*. Its output prints the measurements `geometry.ts`'s `HERO_RIBBON` is
  checked against, so run it after touching a source template and compare.
- `banner_fill.png` and `banner_border.png` come from `banner_fill_raw.png` and
  `banner_border_raw.png` through `tools/card-masks.py`.
  **The supplied outline does not cover the supplied fill:** measured across
  all 86 rows of the pennant head, the border's left edge sits 1–3px *inside*
  the fill's while the right edges agree exactly, so a sliver of banner colour
  ran down the left of the point and past its tip. Present in the `_raw` art,
  so it is the drawing's own registration. **The outline wins:** an outline is
  what draws a shape's edge, so a fill poking out past it is the registration
  error rather than a wider ribbon, and the fill is clipped to sit `INSET`
  pixels inside it — far enough in to clear the outline's own antialiasing,
  since landing on it exactly still let a hair through at the point. Head rows
  only, because the straight run carries an outline on its right edge alone
  (`BANNER.edge`) and clipping to it there would shave 200px off the ribbon.

  **The outline is passed through untouched, and that is the whole of the
  antialiasing.** This is worth stating flatly because getting it wrong is what
  made the point jagged for two releases: the supplied outline already carries
  a real ramp that tracks the taper's sub-pixel position row by row (30/169,
  20/149, 12/132 …), and an earlier pass *softened* it — supersample ×4,
  re-threshold at 128, box-downscale. Re-thresholding a ramp discards exactly
  the sub-pixel information that made it a ramp. What came back was the same
  quantised `16, 239` step on every head row: an edge snapped to whole pixels.
  Measured on the taper's own sub-pixel crossings, the softened version lands
  on a pixel centre every row and steps −5, −6, −5, −5, −6; the supplied ramp
  steps a constant −5.23. **Antialiasing already in the art can only be
  preserved, never improved. Supersampling is for art that has none** — the
  fill, which is pure 0/255, and which turns out not to need it either since
  the clip overwrites every pixel it would change.

  The other half of the same lesson: the tool used to read the files it also
  *wrote*, which is what made it a one-shot generator with an
  `already_generated` guard bolted on — and running it a second time is what
  destroyed the outline's antialiasing in the first place. Reading `_raw` and
  writing the derived files makes it simply idempotent, and the guard is gone.
  `tools/hero-card-assets.py` had the same defect in the ∨ round the hero
  ribbon's foot (`np.where(lit, 255, 0)` over a LANCZOS resample) and takes the
  same fix — `foot_edge` keeps `stroke`'s own alpha. Two consequences there
  worth knowing, both found by measuring rather than looking: the fill under it
  has to be carved at the stroke's opaque **ridge** rather than at `lit`'s
  halfway point, or the pixels between leave 89 rows of the taper with a
  transparent hole in the ribbon; and the frame's own left window edge survives
  the resample at ~120 alpha down 1233 rows, which `lit`'s threshold used to
  drop for free and now has to be zeroed by hand.

  **The boost ring is not in that tool, and deliberately.** It had the same
  fault — its inner edge ran `255,255,239,16,0`, a whole transition crammed
  into one pixel — but supersampling cannot recover a curve thresholding has
  already destroyed. It did not have to: `BOOST_RING` is exactly the annulus's
  bounding box, so `ActionCardFace` draws the ring as a `border-radius: 50%`
  border of `outerRadius - innerRadius` instead of masking it out of
  `inner_border.png`, and the browser antialiases that exactly at any size.
  Both radii still come from `BOOST`, measured off that same art, so nothing
  moved. `inner_border.png` is unused as a result — the one template still
  referenced by `assets.ts` that nothing renders.

They were produced with Python/PIL from files still in the repo. If a source
template changes, regenerate rather than hand-editing.

The general trick throughout: template art is used as a **CSS alpha mask over a
fill**, so shapes keep their drawn form while taking any colour or gradient.
Chrome that must sample a gradient across the whole card is painted as a
full-card layer and cut to shape with `clip-path` (see `clipRect`/`seamBed`).

### The app's own theme: Light Slate / Twilight Blue

Not to be confused with the *card* style cascade two sections down — that is
an author's own design choices for their printed cards, carried in the
document. This is the app's chrome around it: `styles/tokens.css`, switched
by a `data-theme="light"`/`"dark"` attribute on `<html>`, with a `ThemeToggle`
in `TitleBar` and on Home. Light Slate (pale blue-grey) is the default;
Twilight Blue (a cooler, noticeably *brighter* dark theme than the old "Warm
Slate") is `:root[data-theme="dark"]`.

**Two full palettes, not one with overrides.** `:root` carries the complete
light theme and the dark block redefines every neutral, accent, text, border,
role-tint and shadow token from scratch, rather than starting from Warm
Slate's numbers and patching a few. A shadow tuned for a near-black canvas is
a heavy charcoal smear once the ground goes pale — alpha, not just hue, has to
change — and a hairline top-edge highlight that simulates light catching a
*dark* raised panel has nothing to catch on a white one, so light's
`--edge-highlight` is `transparent` rather than a fainter version of dark's.
Only what sits outside the surface palette — `--kind-*`, typography, spacing,
radii, motion, layout — lives once, unscoped, because a printed card must not
depend on which theme the app happens to be in (see *Style cascade*, next).

**`--role-*`/`--section-*` got their own light-theme step; `--kind-*` did
not, on purpose.** Both look like the same kind of token — a named accent
colour — but only one of them is tied to card data. `--kind-attack` etc.
mirror `CARD_KIND_META[kind].color` and must stay theme-independent for
exactly the reason above. `--role-hero`/`-villain`/`-minion`/`-sidekick` and
`--section-initiative`/`-event`/`-rules` are editor-chrome-only — nothing in
card data reads them — and `SetHome`'s roster prints a role as small coloured
text (`.roster-role`), which is the one place the dark theme's values would
fail contrast on a light ground outright. Deepened for light the same way the
four status colours (`--success`/`-warning`/-`danger`/`-info`) are, for the
same reason: `CharacterRow`'s delete-armed label prints `--danger` as text,
and `--rose-500` at the dark theme's L60% is a dark-ground colour.

**`--brand-gold` is gone, not repointed at blue.** It existed only because
`--accent-press` (`gold-600`) already *was* its value — the file said so:
"`--brand-gold` drops one step to `gold-600` so it stays a distinct, deeper
shade instead of colliding with `--accent`". A token that was already a spare
name for another token's value doesn't need to survive a re-theme; every
former `var(--brand-gold)` call site (the logo mark's gradient, `SetHome`'s
badges, `ValueControl`'s modified-state border, `SetEditor`'s
`WorkspaceHeader` `colorVar`, …) now reads `var(--accent-press)` directly,
and tracks whichever theme is active for free.

**Primitive ramps are redefined whole per theme, not flipped end-for-end.**
`--grey-1000` means "darkest step of *this* theme's own ramp" in both blocks
— light's `--grey-1000` is a dark navy, dark's is near-black — never
"whichever end happened to hold dark before." This is what lets the ~35
places outside the semantic layer that reach for a raw `--grey-*` (a
`Switch`/`Slider` track, `ModelViewer`'s void, `ArtworkPanel`'s placeholder
gradients, the card preview panel's own backdrop) track the active theme
automatically, without auditing each one — they were already asking for "the
darkest/lightest neutral available," which is exactly what the convention
still means once the ramp underneath it changes. Flipping which grey step
`--surface-canvas`/`--text-primary` point to, instead, would have kept "1000"
sometimes meaning darkest and sometimes lightest depending on which theme was
active — confusing on its own terms even before touching the ~35 direct
callers.

**The switch itself has to beat first paint, so it is not Svelte state
first.** `index.html` carries a small inline `<script>` in `<head>` that reads
`localStorage['workshop-theme']`, falls back to
`matchMedia('(prefers-color-scheme: dark)')`, and stamps `data-theme` before
the stylesheet is even parsed — set any later than that (inside `main.ts`,
after `mount()`) and every load flashes the wrong theme once, visibly, before
Svelte's effect catches up. `state/theme.svelte.ts` re-derives the identical
value the identical way for everything *after* that first paint — the click
handler, and a `readInitial()` that trusts the attribute the boot script
already set rather than recomputing it, so the two can't disagree about where
they started. `localStorage`, not IndexedDB: this is one small string, not a
multi-megabyte document, so none of the reasoning in *Local-first, offline,
no backend* about `localStorage`'s 5MB ceiling applies — `cloud/auth.svelte.ts`
already keeps the Supabase session the same way, for the same reason.

### Style cascade

`stock template → set.style → character.style → card.style`, flattened by
`resolveStyleForCard()`. Two things the README predates:

- **The stock layer is per template.** `stockTheme(type)` returns
  `EVENT_CARD_THEME` for event cards — they are a red placard, not a slate card.
- Each template declares which surfaces it actually draws
  (`ACTION_SURFACES`, `PROSE_SURFACES`, `EVENT_SURFACES` in `cards/theme.ts`),
  and `StylePanel` filters to them. A control for something a card cannot show
  reads as broken, not as inapplicable.

### Replacement images

Every card, a character's deck back, an event card's reverse, the initiative
deck's back and the threat board can each be given a **finished image** that
stands in for the composed thing entirely. Same shape everywhere: an `Artwork`
plus a `use…` flag, kept *alongside* the composition rather than instead of it,
so turning the flag off gets the design back untouched.

`components/workspace/ReplacementPanel.svelte` is the one control; it owns no
state, because the five places it appears mutate five different parts of the
document. Card replacements are applied in **`CardRenderer`**, ahead of every
face, so one branch covers all four templates — and because the export
photographs that same component, a replaced card exports replaced with nothing
further to do. The initiative back is the exception: nothing renders it, so
`backFor()` in `tabletop-simulator.ts` swaps the URL instead, which works because
a data URL is an address like any other to the sheet renderer.

### Schema

`SET_SCHEMA_VERSION` (currently 12) is checked on import; newer files are
refused. There is no migration ladder — `sets/normalize.ts` repairs on load,
filling absent fields from the factories. **Any new persisted field needs a
branch there**, or existing documents load without it. Absent is meaningfully
different from empty in places (a step's `fill: null` means "follow the board").

**`normalizeSet` must be idempotent**, and this is not a nicety. The usual
shape there is `{ ...createThing(), ...fields read from the raw value }`, and a
factory that stamps `now()` will hand every load a fresh timestamp for any
field the branch does not explicitly carry over. `figure()` did exactly that
with `createdAt`/`updatedAt`: every load silently destroyed both, and once
fingerprints existed it also meant a freshly-taken fork reported every one of
its components as edited, because hashing the same document twice gave two
answers. Anything a factory generates — a timestamp, an id — must be read back
from the raw value when it is there. Worth asserting rather than assuming:
normalise a document three times and compare `fingerprintSet` across the
passes; they must be identical.

**The app was renamed from Adventures Workshop to Unmatched Labs; the on-disk
format string was not.** `SET_FILE_FORMAT` (`src/lib/export/json.ts`) is still
`'adventures-workshop-set'`, checked on every `.json` import
(`parseSetFile`). It is never displayed — only the user-facing rejection
message next to it changed — and it is stamped into every set file anyone has
ever exported. Rewriting it would make the new build refuse every one of
those files on the strength of a cosmetic rename. A string like this earns a
change only when the shape it identifies changes, not when the product wearing
it does.

### Other subsystems

- `src/lib/models/` — STL (binary + ASCII) and OBJ parsing into an unindexed,
  flat-shaded `Mesh`, plus `token.ts`, which *generates* a disc or an N-sided
  prism from a spec. Built at **1 unit = 1 inch** for Tabletop Simulator.
- `src/lib/threat/` + `renderer/ThreatBoard.svelte` — the threat track, laid out
  as the printed 495 × 70 mm strip and sized in `cqw` so it never needs
  scrolling. Track and slots share one red bed (`.arena`), which takes the
  strip's spare width so the win burst is always hard right. Spaces sit a
  `spaceGap` apart (a margin between them, not before the arrow, which still
  butts the last space); `THREAT_MAX_SPACES` solves for that gap. The track takes
  only the width its spaces need — its printed share is a `max-width` ceiling —
  so the gap after the arrow falls to the slots. A slot's name sets *inside* its
  well and its note below it; the wells are top-aligned so a growing note never
  lifts the box. Adding a space or a slot lives under the board, not on it. Every
  field that carries printed copy is a `textarea`, never an `input`: an input
  cannot wrap, which is what once showed one clipped line in the editor where the
  export set two. The overview (`AssetsOverview`) draws this same component
  read-only rather than a sketch of it, so it shows what prints.
- `src/lib/text/rich-text.ts` — allowlist sanitiser. Attributes are allowlisted
  **by value**: every permitted inline style (size, colour, alignment — see
  *Landscape rules cards*) is rebuilt from a parsed, validated value, never
  passed through.
- `src/lib/text/tokens.ts` — inline `{{…}}` tokens, and **a custom symbol has
  two forms**. It is *stored* as `{{custom:symbol_<uuid>}}` and always will
  be: the id is what survives a rename, so renaming a symbol never has to
  rewrite every card that uses it, and a card cannot be broken by one.
  `{{hook}}` is the *display* form, translated by `toDisplayTokens` /
  `toStoredTokens` at the only two fields that ever show token text —
  `AbilityField` and `TokenInput`. Rich text has never shown a token (it
  carries a real `<img data-symbol-id>`), so there is nothing to translate
  there, and the document is untouched by any of this.

  A name earns the short form only if it is unambiguous (`namedSymbols`):
  non-blank, shaped like a token, not one a built-in already claims
  (`attack`, `name`, …), and not shared with another symbol — a duplicate
  poisons the name for *both* rather than letting the first win. Anything
  else keeps the id form in the editor too, so what is shown is always
  something that can be typed back. `SymbolsPanel` prints which form each
  symbol will use, because that fallback is otherwise silent.

  Both fields hold the display text as their own `$state` rather than
  deriving it, since it *is* the DOM value while someone types. The re-sync
  guard is a **round trip** — redraw only when `toStoredTokens(display)` no
  longer equals `value` — not "did `value` change since I wrote it". That
  first version missed a rename: renaming leaves the stored text identical,
  so the field went on showing the old name indefinitely.

## Verifying changes

The established loop, and the one that catches real bugs:

1. `npm run check`.
2. Start the dev server, drive the app with JS in the page, then **measure the
   rendered DOM in template-pixel space** and compare against the template
   numbers — do not judge by eye.
3. For anything visual, rasterise via `renderPlateImage` / `renderThreatTrackImage`
   and sample pixels, or check geometry by computing a signed volume. That is
   what caught an inside-out token mesh and a letterboxed pattern tile.

Traps that have cost real time here:

- `document.fonts.ready` resolving does **not** mean a face is usable by canvas
  `measureText` — call `document.fonts.load("100px 'Family'")` first, or you
  will measure the fallback.
- `image.decode()` can stall indefinitely in a backgrounded renderer. Prefer
  `image.onload`.
- **An `<img>` inside a rasterised `foreignObject` must already be loaded before
  the tree is serialised.** Neither `load` nor `decode()` on the SVG wrapper
  waits for the pictures inside it. Swapping an asset's `src` for a data URI on
  the *clone* — moments before serialising — silently dropped the attack and
  defense symbols from the first two cards of a cold export, and left every card
  after them correct, which is what made it look like anything but what it was.
  `inlineLiveImages` does the swap on the **live** node instead, which is the
  head start a card's own artwork always had and why artwork never showed the
  fault. Check a first card, not a middle one.
- Importing a store module with a `?t=` cache-buster creates a *separate* module
  instance with empty state.
- **A card's look must hang off `.plate`, never off an ancestor of it.**
  `card-image.ts` rasterises by cloning the *plate* into a bare holder and
  freezing computed styles there, so a rule matching `.frame .something` has
  stopped applying by the time those styles are read. Printer-friendly mode was
  first classed on `.frame`, which looked right on screen and in the print view
  and photographed the artwork back in, in colour — caught by sampling a
  rasterised mono card and finding 45% of it salmon pink.
- **`base.css` resets every `img` to `display: block`, so an image used as
  inline content needs `display: inline-block` back.** Without it the glyph is
  a block-level box and breaks the line either side of itself — a symbol in an
  action card's title printed the words on one line and the shield alone on
  the next, with nothing near the box's width to blame it on (105px of text
  plus an 18px glyph in a 289px box). `.title-symbol` was the only symbol on
  `ActionCardFace` missing the override, and that is exactly why it was easy
  to miss: every *other* symbol on that face is absolutely positioned, where
  `block` is correct and no override is wanted. Two separate bugs produce the
  same "a symbol adds a line break" report — this one and the `pre-wrap` one
  below — so check `getComputedStyle(img).display` before assuming whitespace.
- **Inside `white-space: pre-wrap`, the source file's own indentation prints.**
  Ability copy sets it so an author's newlines survive (`AbilityText`'s
  `.line`, `HeroCharacterCardFace`'s `.ability-text`), which also means a
  readably-formatted `{#each}`/`{#if}` around an inline `<img>` emits a real
  line break either side of every symbol: a one-line ability with two symbols
  measured 5.05 line boxes instead of 1.02. Every such loop is therefore
  written with no line break between the branch tags and the element — ugly on
  purpose, and commented as such in all three places (`ActionCardFace`'s title
  loop learnt it first, the other two repeated the mistake). Measure it as
  `element.height / line-height`, not with `Range.getClientRects()`: that
  returns one rect per inline box, so a correctly-rendered line containing two
  vertically-offset images still reports four rects and looks like a bug.
- **`position: absolute` with `z-index: auto` does not make a stacking
  context, so a child's `z-index` escapes to the nearest one that is.**
  `ActionCardFace`'s `.divider`/`.title`/`.rule`/`.below-title` carry
  `z-index: 1` to sit above `.pattern`/`.custom-pattern` (see `.title`'s note
  on the `foreignObject` rasteriser). Their parent `.interior` was
  `position: absolute` with no `z-index`, so those 1s resolved against the
  *plate* instead — and a positioned element with `z-index: 1` paints above
  one with `z-index: auto` whatever the DOM order, which is what
  `.outer-border` is. The frame was painted *under* the divider. Invisible on
  a villain or minion, whose window is exactly `INTERIOR` (143..1488) so
  there is nothing to stick out past; a hero's window is 148..1484, so the
  divider printed 5px into the frame on the left and 4px on the right.
  `overflow: hidden` still clipped it to `INTERIOR`, which is why it looked
  like a tidy couple-pixel overhang rather than anything wilder. Fixed with
  `isolation: isolate` on `.interior` — it scopes the z-indexes to the box
  they were meant for without touching layout or their relative order. When
  something inside the interior paints over the frame, check for a leaked
  `z-index` before touching geometry.
- **The stock `artBackground` is `#ffffff`, and it shows wherever artwork
  does not reach.** Art with rounded (transparent) corners over that default
  prints a thin white curve at the art window's own rounded corner — the
  interior's radius is 46, and anywhere the picture pulls inside that, white
  is what is behind it. Measured: pure 255,255,255 for four pixels between
  dark art and a dark frame, following the arc. Reported, reasonably, as "a
  gap between the artwork and the frame". It is not a geometry bug — check
  the artwork's own alpha and `theme.artBackground` before hunting the
  corner maths.
- `clip-path` clips `box-shadow` and `outline` away entirely.
- A negative margin on a `flex: 1 1 0` item wins it extra width.
- An SVG asked for a shape that is not its own letterboxes rather than
  stretching (`preserveDrawingBuffer` aside, this is why `patternAspect` exists).
- **A box sized "only as large as the calibrated case needs" is a box that
  clips the first quote longer than that case.** The hero character card's
  quote panel (`HeroCharacterCardFace`) took two passes to get right. The
  first kept the box symmetric around the calibrated single-line position,
  bounded by whichever side (up to the quote marks, down to the attribution
  line) was tighter — correct for a short quote, but it meant the *other*
  side's extra room sat unused even for a long one, so `fitScale` was
  shrinking text to fit a box smaller than the band actually is. Widening the
  box only after `fitScale` hit its floor and still overflowed fixed some
  cases and not others, and while chasing the rest a real Svelte trap turned
  up: assigning a `$state` variable back to the value it already holds does
  not re-trigger an effect that depends on something derived from it — a
  second effect reading a `$derived` box height built from that flag never
  re-ran when an edit left the flag unchanged, so the panel kept showing
  whatever text had last actually flipped it, one edit behind the field.
  Both problems went away together: the box now uses the full asymmetric room
  — up to the marks, down to the attribution or the band's own foot —
  *unconditionally*, not as a fallback, so there is only one box, one effect,
  and nothing conditional to desync. What that unconditional sizing gives up:
  a short quote's visual centre sits a few pixels off the calibrated
  single-line position rather than exactly on it (the two margins differ by
  about 26px on Red's own card, so half that as a shift) — not a trade a
  symmetric-by-default design would make, and worth it anyway.
- **A shrink-to-fit floor tuned for gameplay text is not automatically right
  for decorative flavour text.** `fitScale`'s default `min: 0.7` exists so
  ability copy never becomes illegible — right for text someone has to read
  to play, wrong for a quote nobody needs to parse at a glance. An author's
  own 241-character quote still overflowed the widened quote panel at 0.7;
  passing `{ min: 0.5 }` to `fitScale` for that one call site (not the
  default, and not `abilityBox`'s) cleared it with room to spare. `overflow:
  hidden` is still the backstop past *that* floor — this only moved where it
  starts being needed, which is the honest ceiling: a fixed-size printed
  panel cannot fit arbitrarily long text at any readable size, and no amount
  of box-widening or floor-lowering changes that for a true outlier.
- **A `fitScale` floor is relative to whatever size it is handed, not to the
  calibrated base — dividing by an author-facing multiplier is what keeps a
  floor meaning the same absolute size at every setting of that multiplier.**
  `0.5` on its own looked like a fix and was not one: `--fit-scale` multiplies
  `quoteTextSize`, which is *already* `design.quoteScale` (the "Quote text
  size" slider, 60–160%) times the calibrated base size. At the slider's own
  160% ceiling, a bare `0.5` floor bottoms out at `1.6 × 0.5 = 0.8` of the
  base — 80%, nowhere near small enough for a longer quote to shrink into the
  same band a 100%-scale one fits in. An author who both lengthened a quote
  and turned the slider up hit that effective floor without the panel ever
  reaching the `0.5` the code promised, and reported it as the same clipping
  bug a second time. `QUOTE_MIN_SCALE / design.quoteScale` is what
  `fitScale`'s `min` is actually passed, so the floor stays an absolute
  fraction of the base size regardless of what the slider is doing on top of
  it. The general shape of the mistake: a "floor" or "ceiling" constant is
  only absolute if nothing between it and the base value can independently
  scale — check what a `%`/multiplier value is being computed *against*
  before trusting a plain numeric bound on top of it.

## Writing code here

Match the surrounding code, which is deliberate about this: comments explain
*why* a thing is the way it is — usually the failure that forced it — and never
restate what the line does. Several files carry the history of a bug in a
comment precisely so it is not reintroduced. Follow that.

British spelling in prose and comments; `colour` in user-facing copy, `color`
only where a CSS or DOM API demands it.

**`-ize`, not `-ise`**, which is Oxford spelling and so not a departure from
the above: `organizer`, `organizing`, `recognize`. The collections feature is
written that way throughout — table names, policies, functions and copy — so
a well-meant "fix" to `organiser` would break the schema as well as the
prose. The true British/American splits (`colour`, `centre`, `licence`) are
unaffected and stay as they are.
