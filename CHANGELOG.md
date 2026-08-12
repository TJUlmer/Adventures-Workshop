# Changelog

How Adventures Workshop got built, day by day.

This is a working record rather than a release history — the project has no
version tags and was never under version control, so the timeline below is
reconstructed from three things that *were* kept: the schema versions in
`sets/types.ts`, the file dates, and the notes left in `CLAUDE.md` and the code
itself explaining why each decision was made.

Dates are the days work happened, not releases. The schema version is the one
useful hard marker: it only moves when the saved document's shape changes, and
each bump names what changed.

---

## Week one — the shape of the thing

### 20–21 July · Templates and measurement

Before any editor existed, the question was whether a browser could draw an
Unmatched card accurately enough to print. The answer decided everything after
it.

- The print templates went in: action card frame, borders, banner, boost ring,
  the initiative and rules frames.
- Established the approach that never changed — **template art as a CSS alpha
  mask over a fill**. The drawn shape stays exactly as drawn while taking any
  colour or gradient, which is what makes the border customisable without
  redrawing it.
- Every position measured off the templates' alpha channel and ink in **bleed
  pixels**, then converted to percentages and `cqw` so one set of markup is
  correct at a 120px thumbnail and at 300 DPI.

### 28–29 July · The editor

The biggest single push — about 68 files across two days.

- The three-pane shell: set hierarchy, workspace, live preview.
- The design system (`tokens.css` plus the UI primitives) — no component
  hardcodes a colour, so the whole app re-tunes from one file.
- The document model settled into four flat arrays related by ID
  (characters, decks, cards) rather than a tree, so re-parenting anything is a
  one-field edit and every grouping the sidebar shows stays *derived*.
- The runes store, selection model and autosave to `localStorage`.
- **Schema v2** — decks became first-class; artwork became a reference plus a
  crop rectangle instead of a focal point; the style cascade arrived.
- **Schema v3** — cards became *template-shaped* rather than one generic card:
  separate attack and defense values, timed ability blocks, and a theme built
  from fills.

### 30 July · Card types and the sidebar

- **Schema v4** — event cards (called "modifier" at the time), split action
  cards, per-band initiative styling, card type text, character assignment and
  move value.
- Sidebar grouping, the workspace editors and the rich-text sanitiser.
- Symbols became **tokens**: the palette inserts `{{attack}}` at the caret and
  the renderer swaps in the print-resolution image, so the stored text stays
  plain and searchable.

### 31 July · Physical components

- The STL and OBJ parsers, and the WebGL model viewer — all hand-rolled, like
  everything else here, because the project carries **zero runtime
  dependencies**.
- Generated tokens: a flat prism the artwork wraps onto, built at 1 unit = 1
  inch so it drops into Tabletop Simulator at the size it was drawn.
- **Schema v5** — set-level tools: the threat track, figures, box art, and
  per-character card backs.
- **Schema v6** — "modifier" renamed to "event" throughout. Old documents still
  carry the old value and are mapped on load.

---

## Week two — making it produce something

### 3–4 August · The Tabletop Simulator export

The point at which the app stopped being a card editor and became a way to get
a set onto a table.

- **The whole set as one saved object.** One pile per figure plus rules, and
  initiative and events as their own piles — because a TTS deck is a single
  sheet of one cell size, so a pile can only ever hold one card format. That
  split is also what gets the two card scales right.
- A dev-only Vite plugin writing into `exports/`, because TTS refers to card art
  by URL and will not read a data URI — and a page cannot learn its own absolute
  path while the dev server can. Falls back to a ZIP with the URLs blanked
  wherever it is not available.
- **Schema v7** — generated tokens gained a side count and a two-sided flag; the
  `hex` shape became a six-sided polygon (old hex tokens map on load).
- Two bugs worth remembering, both since documented in the code:
  - Every card object's `Transform` must be a **uniform** scale. A TTS custom
    card already takes its shape from the face image's aspect ratio, so scaling
    the axes separately applies the aspect a second time — it stretched every
    event card flat and blew the threat track out to eight times its width.
  - The first two cards of a cold export lost their attack and defense symbols.
    An `<img>` inside a rasterised `foreignObject` must already be loaded before
    the tree is serialised, and neither `load` nor `decode()` on the SVG wrapper
    waits for the pictures inside it. Swapping the source on the *clone* was too
    late; it now happens on the live node.

### 4 August · Threat track and components

- The threat track laid out as the printed 495 × 70 mm strip, sized in `cqw` so
  it never needs scrolling, with the track and slots sharing one bed so the win
  burst is always hard right.
- Health dials, tokens and game pieces gained proper editors.
- **Schema v8** — dials gained a value range; an event card's reverse heading
  gained a placement.

---

## Week three — accuracy, and owning the assets

### 5 August · Type

Three sessions chasing the same problem: the printed cards are set in Knockout
HTF, which cannot be redistributed, and every stand-in had been drawn to
Oswald's metrics rather than Knockout's.

- Swapped in a custom face, then a second one, then finally **two cuts** —
  condensed for the name ribbon and title, "Junior" for ability text, quantity,
  boost and combat values. Two cuts rather than two weights, because that is how
  the printed cards get their contrast.
- Both are drawn to **Knockout's own cap height**, which collapsed most of the
  machinery: sizes read off a template are now very nearly the sizes to set.
- Found that most of what looked like a font mismatch was not the font at all:
  the artwork was **tracked out about 4%**, and two type sizes had simply been
  recorded wrong (the title was set at 126, not 120.5; the event copy at 123.7,
  not 154.5 — a quarter too large, with a leading error cancelling it out).

### 5 August · Redrawing the health dial

The supplied dial model and its saved object could not be licensed, so both were
removed and rebuilt from nothing.

- The mesh is now **generated** rather than shipped — it is a circle, which the
  token generator already makes, so the dial is a spec and nothing more.
- An original counter script: the health across the middle of the disc, a
  trigger either side, click the number to reset.
- A **Photoshop skin template**, generated by script from the dial's real
  dimensions so its guides cannot drift, along with a hand-rolled PSD writer
  (`tools/psdwrite.py`) — the file format, but only the parts needed.

### 6 August · Assets, accuracy and replacements

- Recreated the two-sided token skin template for the same licensing reason,
  marking the thing no one would guess: the pixel at the dead centre of a
  two-sided image is what paints the token's rim.
- Reorganised where things live — working files out of `public/` (which ships
  verbatim into the build) and into `assets/`, which does not.
- New minion/villain card back and initiative card back.
- Fixed the boost value, which sat 12px low in an 89px disc. The cause was
  structural rather than a bad number: centring a text *box* does not centre the
  digits inside it, because a digit stands on the baseline rather than in the
  middle of its em. No line-height could have fixed it.
- **Schema v9** — **full replacement images**. Every card, an event card's
  reverse, and the initiative deck's back can each be given a finished image
  standing in for the composed thing entirely, joining the deck back and threat
  board that already had one. Kept *alongside* the composition, so switching it
  off gets the design back untouched.

---

## Week four — paper, sharing, and the board

### 7 August · Print sheets, and a printer-friendly mode

The `print-pdf` slot had been sitting registered-and-disabled since week two.
Building it established that a PDF was the wrong answer: with no compression in
the app beyond what a stored ZIP entry needs, every card would have gone into
the file as a JPEG — the worst possible treatment of black line on white.
Printed from the DOM instead the type stays vector, and the browser's own
dialogue writes a better PDF than we could.

- `src/lib/print/` — A4 and Letter, a 10mm margin, crop marks in the margins,
  and pages grouped by printed size for the same reason a TTS sheet has one cell
  size. No bleed anywhere: bleed exists so a guillotine can miss, and someone
  cutting at a table is cutting *to* the line.
- Cards butt against each other with no gutter, so one cut serves the two either
  side of it. Backs can follow each sheet with **each row reversed**, which is
  what a long-edge duplex flip does to the paper.
- Every sheet prints a **100mm rule**. Several browsers default the print
  dialogue to "Fit to page", which scales the sheet a few per cent — invisible
  until the cards will not sleeve.
- **Printer-friendly mode**: black line on white, no artwork. Mostly one more
  layer on the existing style cascade, above the card's own overrides, so
  nothing in the document is touched. Measured: 3.7% of the trimmed face is
  dark, against 53.9% in colour.
- The trap that cost the most: a card's look must hang off `.plate`, never off
  an ancestor. The exporter clones *the plate* and freezes computed styles
  there, so mono classed on `.frame` looked right on screen and in the print
  view and photographed the artwork back in, in colour — caught by sampling a
  rasterised mono card and finding 45% of it salmon pink.
- Rendering the print screen outside the app shell had a second consequence:
  `base.css` sets `body { overflow: hidden }` because "the shell owns all
  scrolling", so a screen outside it owns its own or has none. It shipped
  without, and the sheets were clipped at the fold.

### 7 August · Bebas Neue, and tools to judge a face by

- The name ribbon and card title moved to **`BebasNeue-Custom`** — Regular with
  six glyphs redrawn (J, 1, 6, 8, 3, G). Almost all of the gain is the J:
  Regular's is a narrow hook where Featherweight's is wide, scoring 0.10 overlap
  against it; the redraw takes it to 0.90.
- That is not only a shape fix. `condense` is one constant per role, so it has
  to hold for whatever copy a card carries — and against Regular it did not,
  swinging 7.3% depending on how many J's a name had. Against Custom the same
  strings sit inside 2.1%.
- `tools/fonts.py`, `tools/font-compare.py` and `tools/font-atlas.py`: vertical
  metrics, stem width, per-glyph overlap and the set widths `condense` is fitted
  to, plus the visual comparison sheet. Two overlaps are reported, because they
  disagree on exactly the glyphs worth knowing about — aligning by ink corner
  asks "is this the same letter", aligning by pen origin asks "will it land in
  the same place".
- Confirmed along the way that `TITLE.condense` is measured from **ink**, not
  from the element box. The same string measures 411.2 as ink and 418.0 as a
  span, because a box carries the sidebearings and the trailing letter-space.
  Reading the box would have set the title 1.7% narrow.

### 7–8 August · Sharing, without an account

The first thing in the project that talks to a server. It is a **publish
target, never the source of truth**: a published row is a copy of a document
that still lives in the author's browser, and losing the network loses sharing
rather than the set.

- Supabase, hand-rolled against plain HTTP rather than the official client,
  because PostgREST, Storage and Auth are all two headers and `package.json` has
  no runtime dependencies to spend.
- Row level security is the actual boundary, and the easy version of it is
  wrong. "Readable if unlisted or public" would have let one query return every
  share token in the database. The policy exposes **public sets only**, and an
  unlisted set is reachable solely through a `security definer` function that
  takes a token and returns at most one row. Verified by attacking it as an
  anonymous caller.
- Publishing lifts every embedded data URL out into Storage and fetching puts
  them back, so a downloaded set is an ordinary local document — no network
  dependency, and no tainted canvas breaking PNG export somewhere far from the
  cause. The transform *walks* the document rather than naming the eleven
  `Artwork` fields, which is how it caught the figure mesh that is not an
  `Artwork` at all.
- **Anonymous sign-ins** rather than a hand-rolled edit-token scheme: Supabase
  hands a throwaway account the same `authenticated` role, so every policy and
  the storage path prefix work unchanged, and linking an email later carries
  everything published across. A restrictive policy keeps throwaway accounts out
  of the public gallery.
- Sign-in is by emailed **code**, not a magic link: a link opens a new tab, and
  the author's document lives in the `localStorage` of the tab they are already
  in.

### 8 August · The adventure map

Measured off a printed Adventures map (Martian Invader, McMinnville OR) before
anything was built — Hough-detected and then profiled radially, 42 spaces with a
radius standard deviation of 1.6px on a 124px diameter, so the printed spaces
really are one size. Aspect 1.447, space diameter 7.57% of the map's width, the
board 13.2 × 9.1 space-diameters.

- **Schema v10** — spaces, the paths between them, and the board they are
  painted on. Absent on an older document, which opens with the map switched off
  and empty.
- Everything positional is a fraction of the map's **width, including `y`**.
  Store `y` against the height and a space becomes an ellipse the moment the map
  is not square, every path meets it at the wrong point, and a dragged space
  drifts further from the cursor the lower it goes.
- `MapBoard` is **SVG**, which is the opposite of every card face here. A card
  is a stack of rectangles; a map is a graph. Paths stop at the *edge* of a
  circle rather than its centre, and a space split three ways is three arcs
  meeting at a point — one line of geometry each in SVG, a pile of clip-paths in
  DOM.
- The editor is three verbs on one surface: place, link, move. Link is a
  **toggle**, so a pair that is already joined unlinks; the selected space also
  lists its connections, each removable on its own, which is how anyone finds
  out the toggle exists.
- The board's printed width is not chosen — it is derived from the threat
  track's, because on the table the track runs along the top of the map and the
  two are one board. 495 × 343 mm of map, 413 mm with the track.
- Board artwork, an Export PNG button, and the map as its own `CardCustom` in
  the Tabletop Simulator save.

### 8 August · Two silent export bugs

Both found by driving the real thing rather than reading the code, and both
would have stayed invisible indefinitely.

- **`CardID` is an index, not a name.** It is the object's CustomDeck key times
  100 plus the slot on that sheet. The map shipped as `CardID: 200` against a
  deck keyed `1`, so TTS went looking for a sheet that was not there and spawned
  the card at the right size, in the right place, with **no texture and no
  error** — a plain rectangle. Now asserted across every object in a generated
  save.
- **Tabletop Simulator caches textures by URL.** Re-export with new artwork
  under the same filename and TTS keeps drawing the old bitmap, while the save
  points at the right path and the file on disk is correct. Nothing reports it.
  Every image in a bundle is now named after its own contents, which also
  de-duplicates a shared card back to one file.
- That left superseded files accumulating, so the dev-server plugin gained a
  third verb: `DELETE` prunes a bundle folder down to a manifest of the files
  that should survive. It runs **after** the new files are written — clearing
  first would open a window with no usable export, and a failed export would
  have destroyed the last good one on its way to failing. It is the only
  destructive thing in the app and is fenced accordingly, down to refusing an
  empty manifest, because "keep nothing" is what a bug asks for and never what a
  finished export wants.

---

## Week five — a shelf to put sets on

### 9–11 August · The community gallery

Sharing already worked; what it lacked was a way to find anything. Publishing a
set and handing someone the link is a private act, and a gallery is a public one
— which is mostly a question about identity and about what happens when
something posted should not have been.

- **Identity is OAuth**: Discord and Google, plus the email codes that still do
  not deliver. A `profiles` row is minted by a trigger on sign-up, so a
  display name and an avatar exist before anything needs them.
- `sets.owner_id` now references **`profiles`** rather than `auth.users`.
  PostgREST builds its embeds from foreign keys, and without one the gallery
  needed a second query per tile just to name the author. Worth knowing: the
  cascade still reaches `auth.users`, so deleting an account deletes its
  published sets — easy to trigger by accident while tidying test users, and it
  was triggered by accident at least once.
- Two policies that look alike and are not. `sets_public_read` exposes
  `visibility = 'public' and not hidden`; the tempting version — "unlisted *or*
  public" — would let a single query return every share token in the database.
  An unlisted set stays reachable only through `set_by_slug`, which is
  `security definer` and returns at most one row.
- `hidden` is held apart from `visibility` so a takedown leaves the author's own
  setting alone, and so it kills the **link** as well as the listing —
  otherwise a moderated set would vanish from the shelf while every held URL
  went on working.
- `is_admin` is withheld by **column grant**, not by policy. A row policy cannot
  see a column's old value, so "update your row but not that field" is not
  expressible as a `with check`. Grants are checked first, so there is no route
  through PostgREST to self-promote — verified by trying it, and being refused.
- A tile is drawn from the **row**, never the document: `document` is the whole
  set, so thirty tiles would mean pulling thirty multi-megabyte documents to
  show thirty pictures. `thumbnail_url` is filled at publish by downscaling the
  box art (or the first character's artwork) to 512px of WebP.
- Sorted by `published_at` rather than `updated_at` — the latter moves on every
  re-publish, so "newest" would have meant "most recently edited".

### 11–12 August · Publishing a second edition

Re-publishing already updated in place: the upsert is on `(owner_id, local_id)`
and the slug is deliberately absent from the payload, so an author's v2 reaches
everyone holding the v1 link. What was missing was any sign that it had
happened.

- `revision` had existed since the first migration and nothing ever wrote it.
  A trigger owns it now, and moves it only when the **document** differs — a
  visibility flip or a moderator hiding something is not a new edition. A
  client-supplied value is ignored, which is the property worth having.
- An optional **change note**, offered only once a set is out there: on a first
  publish there is nothing to have changed. Cleared on success, because a note
  describes one update rather than the set.
- Dates where they are read: `Updated … · rev N` on a gallery tile (the
  revision only once it is above 1 — "rev 1" on every tile is noise), and the
  published date, the updated date and the latest note on the shared page.

### 12 August · A shared set is read, not adopted

Opening a share link used to show four cards and a button that copied the set
into your library. Both halves were wrong.

- **The whole set, not a sample.** The shared page now draws `AssetsOverview`
  read-only — every deck, both faces of every event card, the deck backs, the
  threat track and the map — through the same component the author reviews with.
  One drawing path, so what a stranger sees cannot drift from what was approved.
- **No adopting.** "Add to my library" made every share link a fork button: the
  author's set would go on being edited by someone else under the author's name,
  and the gallery would fill with near-identical copies. What a viewer gets
  instead is every export — print sheets, PNGs, the Tabletop Simulator bundle,
  the `.json` — which are all ways to *play* a set rather than to claim it.
  This is a courtesy and not a lock, and worth being honest about: the document
  is in the viewer's browser the moment the page draws, and the `.json` export
  is a copy of it. What went is the one-click path from someone else's set to
  yours.
- The export list moved out of Set Home into `components/export/ExportPanel`,
  which was possible only because the exporters had always taken a set rather
  than reaching into the store. `PrintScreen` and `AssetsOverview` learnt the
  same trick — a `set` prop, falling back to the open one — since a published
  set is never in the library and there is nothing there for them to read.
- Measured on a published two-character set: 12 card faces, both boards and all
  four exports on the shared page, and its print view planned 9 cards across 3
  sheets while the workshop's own open set was empty — which is what proves the
  screen is reading the document it fetched.

### 12 August · Forking, with lineage

Rung 1 of collaboration. The goal is a master owner with others able to submit
changes, and this is the copy mechanism underneath it — specified in
`COLLABORATION.md` and built backwards from the rung that follows, because two
of its decisions are free now and impossible later.

- **The gallery stopped depending on the reader's session.** `listPublicSets`
  and `fetchSetBySlug` were sending the viewer's own access token, which the
  policy ignores and PostgREST refuses once it expires — so the shelf went
  empty for its owner while every stranger saw it fine, and the screen said
  "JWT expired". Public reads now send the project key whatever else is
  happening. Verified by poisoning a stored session and watching the gallery
  render anyway.
- **A fork keeps every id inside the document; only the set's own id changes.**
  Preserved ids are what let a change later be described as "this card moved and
  nothing else did". Re-minting them would have worked perfectly and destroyed
  that silently.
- **A fork records a content hash per entity, not the entities.** Offering a
  change back needs a three-way comparison against the version the copy started
  from, and that version is not recoverable — publishing overwrites, so
  revision 2's document stops existing when revision 3 appears. Storing the
  base document would double every copy's footprint in `localStorage`; storing
  a hash per card answers the only question ever asked of it, at about 4 KB.
  Measured: a fresh copy compares clean, and one edited card reports exactly
  one changed entity.
- The hash is FNV-1a 64, hand-rolled over 16-bit limbs because JavaScript's
  bitwise operators are 32-bit and `BigInt` is an order of magnitude slower
  over embedded artwork. Checked against the published test vectors and against
  a `BigInt` reference over three thousand random strings.
- Lineage on the row is `on delete set null`, **never** cascade. `owner_id`
  already cascades from `profiles` and that has destroyed a published set once;
  an original being deleted must orphan its copies rather than take other
  people's work with it.
- **PostgREST embeds a self-reference by the column name, not the table name.**
  `origin:sets!forked_from(…)` is a legal request that resolves the
  relationship backwards — it returns the sets forked *from* this one, as an
  array — so the original was credited to its own copy and the copy showed
  nothing at all. `origin:forked_from(…)` picks the many-to-one direction.
  Caught on screen, not in review.

### 12 August · Contributions

Rung 2, and the point of the whole exercise: a master owner, with other people
able to submit changes.

- **A contribution is a proposal and cannot be anything else.** Accepting one
  edits the owner's document in the owner's browser; the row records the
  decision. Nothing lets a stranger's row mutate a published set.
- The unit is one **entity** — a card, a deck, a character, a figure, or one of
  the set's un-addressed parts. Never a field within one, so two people's
  wording of the same sentence is never merged, and an owner is always looking
  at a whole card and saying yes or no to it.
- Conflicts are found without any history, from the hash each entry carries
  from fork time — and judged at **review** time, so an offer that waited a
  month is measured against the set as it actually is rather than as it was.
- The review screen draws the card. Before and after, side by side, through the
  same renderer that exports it, with the "after" rendered from a preview
  document so its style cascade resolves as it would if taken.
- Partial acceptance is the normal case, so it is the default shape: everything
  clean is pre-ticked, every conflict is left for the owner to opt into, and the
  row records exactly which entries were taken.

Both traps were found by driving it rather than by reading it:

- **`kindOf` was matching prefixes that do not exist.** The factories mint
  `char_` and `fig_`, not `character_` and `figure_`, so every character and
  figure change was being silently dropped from an offer.
- **A removal cannot be named by the person who removed it.** Their document has
  nothing left to read a name off, so the offer arrived asking the owner to
  approve deleting "Untitled card" — when the card was called "Melting". The
  owner still has it, so the review pass relabels from their copy.

RLS was tested by attacking it, in rolled-back transactions: a contributor
marking their own offer accepted is refused, rewriting a payload is refused by
the column grant, forging `contributor_id` is refused, a stranger sees zero rows
and resolves nothing, offers to private and hidden sets are refused while
unlisted ones are allowed, and a decided offer cannot be reopened.

### 12 August · What testing contributions with two accounts found

- **`normalizeSet` was not idempotent, and figures paid for it.** `figure()`
  built on `createFigure()`, which stamps `createdAt` and `updatedAt` with
  `now()`, and the branch set every other field explicitly — so each load handed
  every figure a fresh pair of timestamps and destroyed the real ones. A
  data-loss bug on its own, and once fingerprints existed it also meant a
  freshly-taken fork reported all of its components as edited before anyone had
  touched anything. Measured after the fix: fourteen entities, zero drift across
  three normalise passes, and a fresh copy reports nothing.
- **Entities were labelled by reading `.name`.** An action card is often named
  by its `title` and a rules or event card by its `heading`, so well-named cards
  came through review as "Untitled card"; a health dial takes its name from the
  character it belongs to and had none of its own. Now through `cardLabel`,
  `characterLabel`, `deckLabel` and `figureLabel` — the helpers every other
  screen already used.
- **"Go to my library" went to the gallery.** It called `leaveShared()`, which
  returns you where you came from — correct for "Done", wrong for a button that
  names its destination. `leaveShared` now takes an optional target, and "Done"
  still goes back where it came from.
- Offering changes back moved above Export on Set Home. It is the thing to do
  *with* a copied set, and under a list of file formats it read as an
  afterthought.
- **Publishing a fork now stops and asks.** Not a block — a variant or a
  continuation with permission is a legitimate thing to publish, and the app
  cannot tell which is which. But the two paths look identical from the share
  panel and only one is what most people mean, so a first publish of a set with
  an `origin` explains the difference and points at the contribution panel
  first. Re-publishing does not ask again.

---

## Still open

- **The health dial's buttons in Tabletop Simulator.** Five rounds, and the
  cause turned out to be one line the whole time: **a TTS button with a
  transparent background draws no label at all**, while staying perfectly
  clickable with a working tooltip. That is why the number kept vanishing
  whenever its plate was switched off, and why the arrows were never visible in
  any version — they were drawn on a clear background from the first draft.

  Two other genuine traps surfaced on the way, and both are also written up in
  the script so they cannot be reintroduced: `draw` must never call
  `self.clearButtons()` (clearing and creating in the same frame takes the new
  buttons with the old), and where two rects overlap the button made first takes
  the click. Worth noting for anyone reading the rect sizes: several conclusions
  drawn about them along the way were measured against contaminated evidence,
  since a transparent button and an undersized rect fail identically.
- **Email sign-in delivery.** The code path works; the mail does not leave.
  Custom SMTP points at a domain that is not verified with the sending provider,
  so every one-time code fails at the last step. Anonymous sharing works and is
  the path the UI leads with until this is sorted.
- **Merging the map and threat track into one Tabletop Simulator object.** They
  are one board on the table and currently arrive as two cards laid against each
  other. Two objects can be separated by hand; one merged image cannot, and
  merging bakes the track into the map at a fixed scale — worth deciding rather
  than drifting into.
- **Map polish.** Space labels, zone colours and board artwork are in; crop and
  grade for that artwork, a combined print sheet for the whole playing surface,
  and anything resembling a template library are not.
- **Direct manipulation of artwork** — scale, offset and crop are sliders; the
  model already supports everything dragging would write.
- **Storage headroom.** Embedded artwork is stored as data URLs, which will
  outgrow `localStorage` on a set with many images. The autosave failure is
  surfaced rather than swallowed; the real fix is IndexedDB or a file handle.
