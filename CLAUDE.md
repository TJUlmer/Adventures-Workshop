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

**Local-first, offline, no backend.** The document lives in `localStorage`;
every user asset (artwork, models, replacement images) is embedded as a data URL
so a set survives being handed to someone else as one file. Static chrome is
served from `public/assets` as stable URLs, never bundler-imported.

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
Nothing else in the app may depend on it; the TTS exporter falls back to an
archive with the URLs left blank when it is not there.

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
- `tts-bundle.ts` — renders, then writes to `exports/` or falls back to a ZIP.

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

### Sharing and the gallery

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

They were produced with Python/PIL from files still in the repo. If a source
template changes, regenerate rather than hand-editing.

The general trick throughout: template art is used as a **CSS alpha mask over a
fill**, so shapes keep their drawn form while taking any colour or gradient.
Chrome that must sample a gradient across the whole card is painted as a
full-card layer and cut to shape with `clip-path` (see `clipRect`/`seamBed`).

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
  **by value**: the single permitted inline style is rebuilt from a parsed
  number, never passed through.

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
- `clip-path` clips `box-shadow` and `outline` away entirely.
- A negative margin on a `flex: 1 1 0` item wins it extra width.
- An SVG asked for a shape that is not its own letterboxes rather than
  stretching (`preserveDrawingBuffer` aside, this is why `patternAspect` exists).

## Writing code here

Match the surrounding code, which is deliberate about this: comments explain
*why* a thing is the way it is — usually the failure that forced it — and never
restate what the line does. Several files carry the history of a bug in a
comment precisely so it is not reintroduced. Follow that.

British spelling in prose and comments; `colour` in user-facing copy, `color`
only where a CSS or DOM API demands it.
