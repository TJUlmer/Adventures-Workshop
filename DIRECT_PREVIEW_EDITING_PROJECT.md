# Unmatched Labs Direct Preview Editing Project

**Status:** Core milestone complete in production; Phase 5 special-effect
editing planned
**Last updated:** 28 September 2026
**Scope:** Desktop-first editing of selected action-card fields, including
active special-effect text, from the live right-hand preview, with a safe
centre-editor fallback on narrow layouts

## Purpose

Let an author select visible text or values on the rendered card and edit the
source field without first searching through the centre workspace.

The intended experience is direct: selecting the title, combat value, defence
value, boost value, or an existing ability paragraph should open an editor at
that part of the card. Selecting an empty or structurally complex ability area
should reveal and focus the corresponding Ability Text control in the centre
workspace.

The completed first milestone is already in production. Phase 5 extends the
same interaction to visible Boost Effect, Bonus Attack, and Tuck Effect fields
without changing how authors enable or configure those optional structures.

This must not turn the rendered card into a form. The renderer is also the
export, and it converts stored rich text, name tokens, and symbol tokens into
final display HTML. The implementation therefore needs a preview-only editing
layer outside the photographed `.plate`, backed by the same store commands and
formatted-text controls as the centre editor.

---

## Outcomes

When this project is complete:

- An author can select a visible action-card title and edit it at the card.
- An author can select a visible combat, attack, defence, or numeric boost
  value and edit it at the card.
- An author can select an existing plain, timed, split-card, or Bonus ability
  paragraph and edit that exact stored field.
- When a Boost Effect is active and has visible text, an author can edit that
  text directly at the card.
- When a Bonus Attack is active, an author can directly edit its visible
  stored title, value, and non-empty ability text without accidentally saving
  the derived **Bonus Attack** title fallback.
- When a Tuck Effect is active and has visible text, an author can edit it in
  either bottom or right orientation.
- An author can adjust **Copies in deck** with accessible up/down controls
  beside the quantity beneath the preview.
- Selecting an ability heading, empty ability region, unsupported value, or
  other structural area reveals the correct Content control in the centre
  workspace.
- Preview edits and centre-editor edits remain two views of the same card;
  there is no duplicate document state.
- Formatting, `{{name}}`, built-in symbols, custom symbols, paste
  sanitization, selection, and IME composition remain intact.
- Pointer and keyboard users can discover, activate, commit, and cancel a
  preview edit.
- Narrow or crowded previews fall back to the centre editor instead of
  presenting overlapping or unusably small controls.
- Card PNGs, print output, Tabletop Simulator output, and all read-only card
  renderings remain unchanged.
- Every release phase is committed separately and checked in its hosted
  preview branch. Phase 5 is not promoted to `main` until its hosted result
  has been reviewed and explicitly approved.

## Non-goals

- Making renderer text nodes themselves `contenteditable`.
- Adding inputs, buttons, focus rings, or other editing chrome inside
  `.plate`.
- Adding persisted fields, changing the set schema, or changing
  normalization.
- Creating a second card renderer or a separate export drawing path.
- Editing text baked into a whole-face replacement image.
- Editing derived labels such as **Immediately**, **During Combat**, and
  **After Combat**. These labels identify the stored paragraph to edit.
- Editing a resolved ribbon or character name as though it were the card
  title.
- Adding or removing optional ability blocks from the card surface. Structural
  changes remain in the centre editor.
- The first production milestone intentionally excluded Boost Effect, Bonus
  Attack, Tuck Effect, and corner-badge fields. Phase 5 adds the visible Boost
  Effect, Bonus Attack, and Tuck Effect fields; the corner badge remains a
  centre-editor task.
- Enabling or disabling optional effects, changing Tuck Effect orientation,
  or changing special-effect colours from the card surface. Those structural
  and design choices remain in the centre editor.
- Direct editing of initiative, event, rules, character, cardback, sample, or
  public/shared card renderings in the first milestone.
- A mobile-specific redesign. Narrow layouts receive a safe navigation
  fallback as part of normal responsive behaviour.
- A new runtime dependency or test framework.

---

## Product decisions

These are the recommended working decisions. Phase 0 may tune them in response
to prototype evidence, but later phases should not quietly introduce a second
interaction model.

### Desktop-first authoring

- Creating and refining cards is designed first for a computer with a mouse
  and keyboard. Desktop discoverability, precision, and editing speed must not
  be weakened to make one interaction model fit every device.
- Mobile remains an important viewing surface and a supported secondary
  authoring surface. When its preview is too small or crowded for precise
  targeting, it reveals and focuses the existing full editor instead of
  forcing desktop-sized compromises into the computer experience.
- Touch accommodations may enlarge safe targets or choose the centre-editor
  fallback, but they must not add a mode, extra confirmation, or less direct
  pointer behaviour for desktop authors.

### The renderer remains read-only

- `ActionCardFace.svelte` and `AbilityText.svelte` may expose inert semantic
  field markers such as `data-card-edit-target`.
- The interactive targets, outlines, inputs, toolbars, and popovers belong in
  a sibling overlay inside the authoring preview's card canvas and outside
  `.plate`.
- Field markers identify source data; they do not mutate the store and do not
  style printed output.
- Public, shared, print, export, sample, cardback, and other renderer consumers
  remain non-interactive even if they contain the inert metadata.
- Export verification compares unchanged-document output before and after the
  feature. An open editor must never appear in an exported image.

### Direct editing uses an anchored editor

To the author, editing should feel attached to the selected card text. Under
the surface, the stored source value is loaded into a preview-only editor
positioned over or beside the rendered field.

- Hover or keyboard focus gives a restrained editable-field affordance.
- Activating a supported title or number opens an anchored single-field
  editor.
- Activating an existing ability paragraph opens an anchored formatted-text
  editor for that exact source path.
- Activating blank ability space or a structural decoration reveals the
  corresponding centre-editor section.
- Activating a timing label targets its paragraph; the label itself remains
  fixed.
- The popover offers an **Open full editor** action for ability work that
  grows beyond a quick correction.
- Artwork adjustment and text editing are mutually exclusive. Entering one
  closes or finishes the other.

### Edit-session behaviour

Phase 0 will prove the exact event handling, using this contract as the
default:

- An edit session holds the original value and a local draft.
- The card's stored value changes once when the session commits, using
  `workshop.editCard()`.
- **Escape** cancels and restores the original value.
- **Enter** commits a single-line title or number.
- **Ctrl+Enter** or **Command+Enter** commits multiline ability text; ordinary
  Enter remains available for a line break where the existing editor allows
  one.
- Moving focus entirely outside the editor commits a valid draft. Moving
  focus to the editor's own toolbar does not.
- Selecting another editable field commits the valid current draft before
  opening the next field.
- Export is unavailable while a draft is unresolved. The author must commit
  or cancel the draft before exporting, so export never makes a hidden write.
- If the card is deleted, replaced, or no longer matches the request's
  `cardId`, the stale session closes without writing to another card.

Phase 0 confirmed that direct targets do not require a separate **Edit text**
mode. Artwork adjustment commits a valid draft or cancels an invalid one
before it takes pointer ownership.

### Preview-to-editor navigation is shared UI state

The selected card remains document state, but pane, tab, target, and focus
requests are ephemeral view state.

- A typed request carries at least the card ID, logical region, field, and
  original Bonus index when applicable.
- `CardEditor.svelte` consumes the request, opens **Content**, waits for the
  target to exist, scrolls it into view, and focuses it.
- `EditorPanes.svelte` observes the same request and reveals **Edit** on a
  one-pane or tablet layout.
- A monotonically increasing request revision allows repeated activation of
  the same field and lets sibling components react independently.
- Every focus and mutation path rechecks the card ID. A delayed request must
  never land on the next selected card.
- Stable editor-target attributes replace label-text searches or brittle DOM
  traversal.

### Responsive behaviour

- A comfortably sized desktop preview offers direct anchored editing.
- A wide touch device may use the same interaction with coarse-pointer hit
  areas that do not overlap.
- When the card is too small for reliable targeting, activation opens the
  centre editor instead of forcing a tiny popover.
- On a one-pane phone layout, a navigation request reveals the **Edit** pane
  before scrolling and focusing the field.
- Preview zoom, preview scrolling, bleed, guides, and pane resizing may move
  a target. The overlay recomputes its geometry rather than changing renderer
  layout.

### Field support contract

| Visible card region | Stored source | First-milestone behaviour | Important condition |
|---|---|---|---|
| Card title | `card.title` | Direct formatted editing | The display fallback `Card Title` edits the empty source; it is never saved as real copy |
| Ordinary hero combat value | `card.symbolValue` | Direct numeric editing | Only when the number is visibly rendered |
| Villain/minion attack | `card.attack` | Direct numeric editing | Includes the visible attack side of a split card |
| Villain/minion defence | `card.defense` | Direct numeric editing | Includes the visible defence side of a split card |
| Hero split attack/defence | `card.attack` / `card.defense` | Direct numeric editing | The target descriptor must preserve the side |
| Numeric boost | `card.boost` | Direct numeric editing | A custom boost symbol routes to the centre Boost control instead of exposing a hidden number |
| Primary plain ability | `card.ability.plain` | Direct formatted editing when text exists | Blank ability space opens the primary Ability Text stack |
| Primary timing paragraph | `card.ability.immediately`, `.duringCombat`, or `.afterCombat` | Direct formatted editing when text exists | The fixed timing label targets the paragraph but is not editable |
| Split defence plain/timing paragraph | `card.defenseAbility.*` | Direct formatted editing when text exists | It must never write to the primary side |
| Bonus ability paragraph | `card.ability.bonusAbilities[index].text` or the split-side equivalent | Direct formatted editing when text exists | Preserve the original array index before filtering empty entries |
| Boost Effect text | `card.boostEffect` | Phase 5 direct plain single-line editing when text exists | Only when `showBoostEffect` is on and a boost assembly is visibly rendered; target the visible copy, not its invisible title-clearance duplicate |
| Bonus Attack title | `card.bonusAttackTitle` | Phase 5 direct formatted single-line editing when stored text exists | The derived **Bonus Attack** fallback opens the centre control and is never persisted as source text |
| Bonus Attack value | `card.bonusAttackValue` | Phase 5 direct numeric editing | Only when `showBonusAttack` is on; use the centre control's `0–9` bounds |
| Bonus Attack ability | `card.bonusAttackAbility` | Phase 5 direct formatted editing when text exists | Blank or absent text opens the centre control so optional structure stays explicit |
| Tuck Effect text | `card.tuckEffect` | Phase 5 direct formatted single-line editing when text exists | Only when `showTuckEffect` is on; support both bottom and right orientations |
| Empty or absent value | Relevant centre control | Centre-editor navigation | Optional structure is added or removed in the centre editor |
| Ribbon/owner name | Derived owner/card-name source | Centre-editor navigation only | Do not overwrite a resolved display name |
| Whole-face replacement | Image data | No direct targets | Explain that the composed text is part of the replacement image |
| Read-only/sample/cardback surface | Not applicable | No interaction | Authoring overlay is not mounted |

Phase 5 implements the Boost Effect, Bonus Attack, and Tuck Effect rows above
using the first milestone's proven target and editor systems. The corner badge
and other directly authored display fields remain candidates for a later
extension.

---

## Success criteria shared by every phase

- No input, contenteditable region, button, focus outline, or toolbar is
  mounted inside `.plate`.
- Only inert semantic metadata may be added to rendered output.
- All preview mutations use `workshop.editCard()` and the same validation as
  the centre editor.
- No schema, normalizer, IndexedDB, cloud, publication, or collaboration
  change is required.
- The centre editor immediately reflects a committed preview edit, and the
  preview immediately reflects a committed centre-editor edit.
- Original source values—not the renderer's resolved HTML—feed preview
  editors.
- Bold, italic, line breaks, `{{name}}`, built-in symbols, custom-symbol IDs,
  paste sanitization, and IME input survive a round trip.
- Empty-title fallback text is never persisted accidentally.
- A visible second Bonus ability always maps to its original index even when
  the first Bonus entry is empty.
- Primary and split-defence ability paths cannot cross-write.
- Direct numeric inputs use the same bounds as the centre controls: hero
  value `0–9`, boost `1–9`, and villain/minion attack and defence `0–20`.
- Pointer, keyboard, and coarse-pointer users receive an unambiguous target,
  visible focus, a cancellation path, and a way to open the full editor.
- Overlay geometry remains attached through zoom, scroll, pane resize, text
  reflow, bleed changes, and guide changes.
- Text-edit and artwork-adjustment modes cannot compete for the same pointer
  session.
- No direct editing appears in public, shared, print, export, contribution,
  sample, cardback, or replacement-image surfaces.
- Representative unchanged PNGs retain the same dimensions and decoded
  pixels.
- Desktop preview zoom, resizing, export, and artwork adjustment retain their
  existing behaviour.
- `npm run check` and `npm run build` pass before a phase is considered ready
  for hosted-preview review.
- Each release phase is committed and pushed to its preview branch and
  accepted there before its reviewed commit is promoted to `main`.

---

## Roadmap at a glance

| Phase | Deliverable | Size | Milestone |
|---|---|---:|---|
| 0 | Interaction contract, field map, and export baseline | Small | Preparation |
| 1 | Semantic targets and preview-to-editor navigation | Medium | Navigation foundation |
| 2 | Direct title and numeric editing | Medium | Direct-edit MVP |
| 3 | Direct existing-ability editing | Medium–large | Complete action-card milestone |
| 4 | Accessibility, responsive, export, and staged-release hardening | Medium | Release |
| 5 | Active special-effect text and Bonus Attack value | Medium | Action-card extension |

The navigation-only foundation is approximately 1–2 focused development days.
A polished first action-card milestone is approximately 5–8 focused
development days if the phases proceed cleanly. Allow a 1–2 week planning
envelope for one implementer when hosted-preview feedback and edge-case fixes
are included. Phase 5 is a focused follow-on to that completed milestone;
extending the interaction to every card template is a separate project
estimate.

---

## Phase 0 — Lock the interaction contract and baseline

**Goal:** Prove that a card field can be targeted accurately without changing
the renderer or exported output, and document one edit lifecycle before store
mutations begin.

### What the author gets

One representative title target can be discovered and activated in the live
preview with pointer and keyboard. The prototype demonstrates where the editor
will appear and how a crowded preview falls back to the centre editor, but it
does not yet need to save the title.

### Work

- [x] Define the typed field-address contract, including `cardId`, logical
  region, field, and optional original Bonus index.
- [x] Record the supported, navigation-only, and deferred field matrix in
  code-facing terms.
- [x] Confirm that targets are normally available without a separate
  **Edit text** mode; retain a mode only if prototype evidence shows that
  ordinary preview navigation becomes ambiguous.
- [x] Define the edit-session state machine: inactive, targeting, editing,
  committing, cancelling, and invalidated.
- [x] Confirm Enter, multiline, blur, Escape, export, card-switch, and
  artwork-adjustment behaviour.
- [x] Add or prototype one inert title marker and one sibling overlay target.
- [x] Verify target alignment at fitted width, minimum preview width, 100%,
  and 200% zoom, with bleed and guides both on and off.
- [x] Verify pointer activation, keyboard focus/activation, focus return, and
  the narrow-layout centre-editor fallback.
- [x] Capture representative action-card screenshots, `.plate` structure,
  export dimensions, and PNG fingerprints for later comparison.
- [x] Include fixtures for ordinary hero, split hero, villain/minion,
  formatted ability text, only Bonus ability 2 populated, custom boost symbol,
  and whole-face replacement.
- [x] Document that no stored field or schema change is proposed.

### Likely files

- `DIRECT_PREVIEW_EDITING_PROJECT.md`
- `src/lib/components/preview/PreviewPanel.svelte`
- `src/lib/renderer/ActionCardFace.svelte`
- A possible prototype `PreviewFieldOverlay.svelte`
- Existing browser-evidence tooling where reusable

### Exit criteria

- [x] The field-address and edit-session contracts have no unresolved state
  transition.
- [x] The title target stays aligned across the supported preview geometry.
- [x] Pointer and keyboard users can discover and activate the prototype.
- [x] A narrow or overlapping target falls back to the centre editor.
- [x] No editor control or visual state enters `.plate`.
- [x] Export dimensions and decoded-pixel fingerprints are recorded as the
  Phase 0 baseline for comparisons in later phases.
- [x] `npm run check` and `npm run build` pass.
- [x] The Phase 0 commit is pushed and accepted in the hosted preview before
  work proceeds to Phase 1.

---

## Phase 1 — Semantic targets and preview-to-editor navigation

**Goal:** Make every supported visible field select the exact existing centre
control before adding direct mutation at the card.

### What the author gets

Selecting the title, a visible value, an existing ability paragraph, or an
ability region takes the author directly to the matching Content field. On a
narrow layout, the app reveals the Edit pane automatically instead of leaving
the author in Preview.

### Work

- [x] Add a typed ephemeral card-editor view module modelled on the existing
  cross-sibling character-editor state pattern.
- [x] Give every request a monotonically increasing revision so reselecting
  the same target still triggers navigation.
- [x] Revalidate `cardId` before every focus and mutation.
- [x] Let `CardEditor.svelte` consume a request, switch to **Content**, await
  rendering, scroll to the stable target, and focus it.
- [x] Let `EditorPanes.svelte` consume the same request and reveal **Edit** on
  tablet and phone layouts.
- [x] Add stable semantic editor targets to `ActionCardContent.svelte`,
  `AbilityStack.svelte`, `AbilityField.svelte`, `FormattedTextField.svelte`,
  and numeric controls as needed.
- [x] Add inert renderer markers for title, hero value, attack, defence,
  numeric boost, primary ability paths, split-defence paths, timing paths, and
  Bonus paths.
- [x] Pass a semantic source prefix into `AbilityText.svelte` so a paragraph
  knows whether it belongs to the primary or split-defence ability.
- [x] Preserve each Bonus ability's original array index before filtering
  empty entries for display.
- [x] Add a preview-only overlay that measures renderer markers and exposes
  accessible hotspot buttons outside `.plate`.
- [x] Recompute geometry after renderer changes, preview resize, zoom, bleed,
  guide changes, and scrolling.
- [x] Gate the overlay to a selected editable action card in the authoring
  preview.
- [x] Disable targets for samples, cardbacks, replacements, read-only
  surfaces, and while artwork adjustment is active.
- [x] Route an empty rendered ability region to the correct Ability Text
  stack. A blank split-defence side has no separate region on the composed
  card and remains a structural centre-editor action rather than gaining an
  invented card-surface target.
- [x] Route a custom boost symbol to the centre Boost control without exposing
  a hidden numeric value.

### Likely files

- `src/lib/state/card-editor-view.svelte.ts` (new)
- `src/lib/components/layout/EditorPanes.svelte`
- `src/lib/components/workspace/CardEditor.svelte`
- `src/lib/components/workspace/ActionCardContent.svelte`
- `src/lib/components/workspace/AbilityStack.svelte`
- `src/lib/components/workspace/AbilityField.svelte`
- `src/lib/components/workspace/FormattedTextField.svelte`
- `src/lib/components/preview/PreviewPanel.svelte`
- `src/lib/components/preview/PreviewFieldOverlay.svelte` (new)
- `src/lib/renderer/ActionCardFace.svelte`
- `src/lib/renderer/AbilityText.svelte`

### Exit criteria

- [x] Every supported visible target focuses the exact centre-editor field.
- [x] Empty rendered ability regions focus the correct stack without
  inventing a target for structurally absent split-defence copy.
- [x] Repeated activation of an already selected card and field still reveals
  and focuses Edit.
- [x] Timing labels select their paragraph without becoming editable labels.
- [x] Bonus ability 2 focuses index `1` even when Bonus ability 1 is empty.
- [x] Primary and split-defence requests cannot cross.
- [x] A delayed request cannot focus the next selected card.
- [x] Desktop, tablet, and phone pane behaviour is coherent.
- [x] Preview resize, zoom, scroll, bleed, and guides do not detach targets.
- [x] No editing affordance appears in exported or read-only output.
- [x] `npm run check` and `npm run build` pass.
- [x] The Phase 1 commit is pushed and accepted in the hosted preview before
  work proceeds to Phase 2.

---

## Phase 2 — Direct title and numeric editing

**Goal:** Let authors make the most common short corrections at the card while
using the same validation and store command as the centre editor.

### What the author gets

Selecting a card title, combat value, attack, defence, or numeric boost opens a
small editor at that position. Changes appear in the card and centre workspace
after commit; Escape safely abandons the draft.

### Work

- [x] Implement the Phase 0 edit-session state machine in the preview overlay.
- [x] Load the original stored source rather than reading displayed renderer
  HTML.
- [x] Reuse or extract the existing formatted-text behaviour for card titles.
- [x] Preserve title bold, italic, name tokens, symbol tokens, paste
  sanitization, caret, selection, and IME behaviour.
- [x] Ensure the visible `Card Title` fallback opens an empty draft rather
  than treating the fallback as stored text.
- [x] Add compact numeric editing for `symbolValue`, `attack`, `defense`, and
  `boost`.
- [x] Reuse the centre editor's numeric parsing, null handling, and bounds.
- [x] Commit through `workshop.editCard()` once per completed edit session.
- [x] Keep the overlay visually stable while the committed title or value
  changes renderer geometry.
- [x] Define and display a clear focus/selected state without styling the
  renderer node itself.
- [x] Commit a valid draft before opening another target; cancel on Escape.
- [x] Close safely when the card changes, is deleted, becomes a replacement,
  or enters artwork-adjustment mode.
- [x] Suppress direct controls for scheme values, missing/null values, custom
  boost symbols, samples, cardbacks, and replacement images.
- [x] Ensure exporting with an active draft follows the deterministic Phase 0
  decision.

### Likely files

- `src/lib/components/preview/PreviewFieldOverlay.svelte`
- A possible new `PreviewFieldEditor.svelte`
- `src/lib/components/preview/PreviewPanel.svelte`
- `src/lib/components/workspace/FormattedTextField.svelte`
- Shared formatted-text and numeric helpers only where extraction avoids
  duplicate behaviour
- `src/lib/state/card-editor-view.svelte.ts`

### Exit criteria

- [x] Title edits round-trip without losing formatting or tokens.
- [x] The empty title fallback never becomes stored copy unless the author
  explicitly types it.
- [x] Hero ordinary value, villain/minion attack and defence, split values,
  and numeric boost update the intended field.
- [x] Out-of-range or invalid numeric values cannot persist.
- [x] The centre editor reflects a committed preview edit immediately.
- [x] Cancel, commit, blur, field switching, card switching, and deletion have
  consistent outcomes.
- [x] A custom boost symbol does not reveal or mutate a hidden numeric value.
- [x] Keyboard-only operation includes discover, activate, edit, commit,
  cancel, and focus return.
- [x] Representative export dimensions and export structure remain unchanged.
  Strict decoded-pixel verification retains the cross-run variance documented
  in Phase 0 and Phase 1; Phase 2 changes no renderer or export code.
- [x] `npm run check` and `npm run build` pass.
- [x] The Phase 2 commit is pushed and accepted in the hosted preview before
  work proceeds to Phase 3.

### Direct-edit MVP gate

At this point an author can select the most common short fields on an action
card, correct them, cancel mistakes, and continue editing without searching
through the centre form. Ability selection already reaches the correct centre
field even though direct ability editing arrives in Phase 3.

---

## Phase 3 — Direct existing-ability editing

**Goal:** Let an author correct any already-rendered first-milestone ability
paragraph without corrupting its formatting, tokens, identity, or split side.

### What the author gets

Selecting existing plain, Immediately, During Combat, After Combat,
split-defence, or Bonus ability text opens a formatted editor at that
paragraph. Selecting blank ability space or choosing **Open full editor** takes
the author to the complete Ability Text controls in the centre.

### Work

- [x] Reuse or extract the existing `FormattedTextField` editing core rather
  than adding a second sanitizer, selection model, or token conversion path.
- [x] Open the editor from the original stored ability value, never from
  `renderActionText()` output.
- [x] Map primary plain and all three timing paragraphs to their exact source.
- [x] Map split-defence plain and timing paragraphs to `defenseAbility`.
- [x] Map Bonus paragraphs using their original array index and side.
- [x] Keep timing labels, Bonus icons, dividers, colours, and other structural
  decorations non-editable.
- [x] Provide a clear **Open full editor** action inside the anchored ability
  editor.
- [x] Route blank ability space and missing blocks to the complete centre
  stack.
- [x] Preserve bold, italic, multiline text, built-in symbols, custom-symbol
  IDs, `{{name}}`, paste sanitization, caret, selection, and IME composition.
- [x] Keep toolbar interaction within the active session rather than treating
  it as an outside-focus commit.
- [x] Preserve normal rich-text undo behaviour while the local draft is open.
- [x] Handle copy reflow without losing selection or detaching the editor.
- [x] Preserve the renderer's existing empty/whitespace title-rule semantics.
- [x] Close or commit coherently if the selected ability becomes empty,
  hidden, or structurally changed from the centre editor.
- [x] Keep unsupported advanced action-card text fields navigation-only or
  centre-editor-only for this milestone.

### Likely files

- `src/lib/components/preview/PreviewFieldOverlay.svelte`
- `src/lib/components/preview/PreviewFieldEditor.svelte`
- `src/lib/components/workspace/FormattedTextField.svelte`
- `src/lib/components/workspace/AbilityField.svelte`
- `src/lib/components/workspace/AbilityStack.svelte`
- `src/lib/renderer/AbilityText.svelte`
- Shared contenteditable selection/token helpers

### Exit criteria

- [x] Existing primary plain and timing paragraphs edit their exact fields.
- [x] Existing split-defence paragraphs never write to the primary side.
- [x] Existing Bonus ability 2 edits index `1` even if index `0` is empty.
- [x] Timing labels remain fixed while selecting the associated text.
- [x] Blank space and absent ability blocks open the correct centre stack.
- [x] Bold, italic, multiline copy, symbols, custom symbols, `{{name}}`, paste,
  undo, caret, selection, and IME input survive a save/reload round trip.
- [x] Reflow during editing does not lose focus or strand the popover.
- [x] Escape, commit, toolbar use, Open full editor, and card switching follow
  the shared edit-session contract.
- [x] Exporting cannot capture the editor or omit an unresolved draft
  silently.
- [x] Representative export geometry and export structure remain unchanged.
  Strict decoded-pixel verification retains the cross-environment variance
  documented in earlier phases; Phase 3 changes no renderer or export code.
- [x] `npm run check` and `npm run build` pass.
- [x] The Phase 3 commit is pushed and accepted in the hosted preview before
  work proceeds to Phase 4.

### Complete action-card milestone gate

The first milestone is complete when this journey succeeds in the hosted
preview:

1. Open an editable action card.
2. Edit its title from the right preview and commit.
3. Edit every visible numeric field that applies to the card.
4. Edit an existing plain or timed ability paragraph.
5. Edit the split-defence side without changing the primary side.
6. Edit Bonus ability 2 while Bonus ability 1 is empty.
7. Cancel one title, numeric, and ability draft with Escape.
8. Open the full centre editor from blank ability space.
9. Save, reload, and confirm the committed edits persist.
10. Export the card and compare it with the same card exported from the centre
    editing path.

---

## Phase 4 — Accessibility, responsive, export, and staged-release hardening

**Goal:** Verify direct preview editing as a coherent authoring interaction
across supported cards, preview states, input methods, and the preview-to-main
deployment path.

### What the author gets

The feature behaves predictably with mouse, keyboard, and touch-capable
hardware, survives common state changes, never contaminates output, and has
been approved in the hosted preview before production promotion.

The quantity shown beneath the card now has compact up/down controls. They
update the same **Copies in deck** value as the centre editor, retain its
`1–20` limits, and grow into larger non-overlapping controls for coarse
pointers without changing the desktop interaction.

### Required fixture matrix

- Ordinary hero attack, defence, versatile, and hybrid cards.
- Hero scheme with no combat value.
- Hero split card with a shared ability.
- Hero split card with a separate defence ability.
- Villain and minion unsplit and split cards.
- Null attack or defence values.
- Numeric boost and custom-symbol boost.
- Empty and formatted card titles.
- Plain ability plus all three timing paragraphs.
- Only Bonus ability 2 populated.
- Whole-face replacement.
- Artwork adjustment active and inactive.
- Fitted preview, minimum preview width, 100%, and 200% zoom.
- Bleed and guides on and off.
- Desktop three-pane, tablet, and phone one-pane layouts.
- Light and dark themes.

### Work

- [x] Verify accessible names describe both the visible field and action, for
  example “Edit card title” rather than only “Card Title”.
- [x] Verify logical focus order, visible focus, activation with Enter/Space,
  Escape cancellation, and focus restoration.
- [x] Verify the anchored editor does not trap focus and its toolbar remains
  operable by keyboard.
- [x] Verify reduced motion, 200% browser zoom, larger OS text, and high
  contrast where available.
- [x] Verify coarse-pointer hit areas do not overlap at every supported
  preview size.
- [x] Route crowded or ambiguous targets to the centre editor.
- [x] Verify phone/tablet navigation reveals Edit, selects Content, scrolls,
  focuses, and leaves the software keyboard's completion route reachable.
- [x] Verify preview scroll, zoom, resizer movement, orientation changes, and
  text reflow cannot strand an editor.
- [x] Verify card switching, pane switching, deletion, replacement activation,
  artwork adjustment, and export close or finish an edit session coherently.
- [x] Verify no direct interaction is mounted in read-only, public, shared,
  print, contribution, sample, cardback, and replacement-image contexts.
- [x] Compare representative `.plate` signatures, PNG dimensions, and decoded
  pixels with the Phase 0 baseline.
- [x] Verify print and Tabletop Simulator outputs remain unchanged.
- [x] Verify persistence after reload and the existing autosave/status
  behaviour.
- [x] Run `npm run check`.
- [x] Run `npm run build`.
- [x] Push the completed phase to the preview branch and verify its hosted
  production build, including direct shared/deep links.
- [x] Record remaining limitations in this plan and user-facing copy where
  necessary.
- [x] After every phase is accepted, promote the cumulative preview branch to
  `main` and verify the production URL.

### Exit criteria

- [x] Every first-milestone field works with mouse and keyboard.
- [x] Wide touch hardware has usable non-overlapping targets.
- [x] Narrow layouts reliably open the matching centre editor.
- [x] No stale session can write to another card or ability side.
- [x] Formatting, tokens, selection, and IME behaviour match the centre
  editor.
- [x] Text editing and artwork adjustment never compete for pointer ownership.
- [x] Unchanged export dimensions match the baseline. Decoded pixel sampling
  retains the documented cross-environment font/rendering variance; Phase 4
  changes no renderer, print, or export path.
- [x] All unsupported and read-only surfaces remain visibly non-interactive.
- [x] `npm run check` finishes without errors or warnings and `npm run build`
  succeeds. Vite retains its existing advisory about the main bundle exceeding
  500 kB; Phase 4 adds no dependency or new bundle.
- [x] The hosted preview is accepted before the same commit reaches `main`.
- [x] Production loads, deep links work, and the core authoring journey passes
  after promotion.

### Phase 4 verification notes and remaining limits

- The user accepted the hosted Phase 4 preview on 28 September 2026. The
  cumulative preview branch was then merged into the latest `main`, preserving
  the newer artwork-export and print-readiness fixes already in production.

- The deterministic Phase 0 fixture covers ordinary and split hero cards,
  villain and minion cards, formatted text with only Bonus ability 2 present,
  a custom boost symbol, and a whole-face replacement. All seven geometry
  checks pass after regeneration.
- Desktop, 320 px phone, light/dark theme, 100%/200% preview zoom, bleed,
  guides, keyboard traversal, focus restoration, autosave/reload, action-card
  and rules-card quantity controls were exercised in the browser. No browser
  warnings or errors were reported on the fresh verified page.
- Direct anchored editing still requires a rendered card canvas at least
  320 px wide. Narrow canvases and coarse-pointer targets that would overlap
  intentionally open the exact centre-editor control instead.
- The in-app test browser cannot emulate operating-system font enlargement or
  forced-colour mode. Global reduced-motion handling and the preview's explicit
  forced-colour focus outlines were therefore verified by source inspection;
  the responsive fallback was exercised at equivalent constrained widths.
- Strict decoded-pixel sampling remains environment-sensitive to browser font
  rendering. Geometry, dimensions and renderer isolation are the stable release
  gates; Phase 4 touches preview-only components.

---

## Phase 5 — Active special-effect direct editing

**Goal:** Extend the production interaction to Boost Effect, Bonus Attack, and
Tuck Effect fields when those effects are active and their source is visibly
represented on the card.

### What the author gets

An author can make quick corrections directly where active special-effect
content appears. Non-empty Boost Effect and Tuck Effect text can be selected
at the card. An active Bonus Attack exposes its stored title, numeric value,
and non-empty ability text. Empty or derived content opens the exact centre
control so the preview never invents or silently saves source text.

Desktop pointer and keyboard behaviour remains the primary interaction. A
small, crowded, or coarse-pointer target uses the existing centre-editor
fallback instead of weakening the desktop experience.

### Required fixture matrix

- Boost Effect on and off, with numeric boost, custom-symbol boost, and no
  visible boost assembly.
- Non-empty and blank Boost Effect text, verifying that only the visible copy
  is targeted when the renderer also emits an invisible title-clearance copy.
- Bonus Attack on and off for hero, villain, and minion cards.
- Non-empty formatted Bonus Attack title and the empty-source derived
  **Bonus Attack** fallback.
- Bonus Attack value at `0` and `9`, plus invalid drafts outside that range.
- Non-empty formatted Bonus Attack ability and a blank ability.
- Tuck Effect on and off, bottom and right orientations, with non-empty
  formatted text and blank text.
- `{{name}}`, built-in symbols, custom symbols, paste sanitization, selection,
  undo, and IME composition in formatted special-effect fields.
- Boost Effect, Bonus Attack, and Tuck Effect active together, including long
  text that changes card layout.
- Fitted preview, minimum preview width, 100% and 200% zoom, bleed and guides,
  desktop/tablet/phone layouts, mouse, keyboard, and coarse pointer.
- Artwork adjustment, whole-face replacement, sample, cardback, public,
  shared, print, and export surfaces.

### Work

- [ ] Refine the typed advanced target address so Boost Effect, Bonus Attack
  title/value/ability, and Tuck Effect identify exact stored fields rather
  than a coarse section.
- [ ] Add stable centre-editor targets for each Phase 5 field and route blank,
  derived, hidden, narrow, crowded, or unsupported cases to those controls.
- [ ] Add an inert marker only to the visible Boost Effect text; do not mark
  the invisible copy used to reserve title clearance.
- [ ] Add direct plain single-line editing for a non-empty visible
  `card.boostEffect`, matching its existing centre `TextInput` semantics.
- [ ] Add direct formatted single-line editing for a non-empty stored
  `card.bonusAttackTitle`. Treat the displayed **Bonus Attack** fallback as
  navigation-only so it can never become persisted copy by accident.
- [ ] Add direct numeric editing for visible `card.bonusAttackValue`, reusing
  the existing `0–9` validation and session lifecycle.
- [ ] Add direct formatted editing for non-empty
  `card.bonusAttackAbility`; route a blank ability to the centre editor.
- [ ] Add direct formatted single-line editing for non-empty
  `card.tuckEffect` in both bottom and right orientations.
- [ ] Mount no target when the corresponding effect is off or the source is
  not visibly rendered.
- [ ] Keep effect toggles, Tuck Effect orientation, special-effect colours,
  and corner-badge editing in the centre editor.
- [ ] Reuse the established local-draft, commit/cancel, focus restoration,
  stale-card validation, artwork mutual exclusion, and export-blocking rules.
- [ ] Verify marker and anchored-editor geometry through text reflow, zoom,
  scroll, pane resize, bleed, guides, and both Tuck Effect orientations.
- [ ] Verify that no editor control enters `.plate` and that unchanged
  renderer/export geometry remains stable.
- [ ] Run `npm run check`, `npm run build`, `git diff --check`, focused browser
  verification, and the Phase 0 geometry evidence check.
- [ ] Commit Phase 5 separately on its new preview branch, push it, and verify
  the exact hosted deployment and a direct shared link.
- [ ] Present a layman summary and technical recap for review. Promote to
  `main` only after explicit hosted-preview acceptance.

### Likely files

- `src/lib/cards/edit-targets.ts`
- `src/lib/renderer/ActionCardFace.svelte`
- `src/lib/components/preview/PreviewPanel.svelte`
- `src/lib/components/preview/PreviewFieldOverlay.svelte`
- `src/lib/components/preview/PreviewFieldEditor.svelte`
- `src/lib/components/workspace/ActionCardContent.svelte`
- `src/lib/components/workspace/FormattedTextField.svelte`
- Existing direct-preview evidence fixtures and manifests

No persisted field, schema version, normalizer, storage, cloud, publication,
or collaboration change is expected: all Phase 5 source fields already exist.

### Exit criteria

- [ ] Every visible supported Phase 5 field opens the exact source field and
  commits once through `workshop.editCard()`.
- [ ] Inactive, blank, derived, hidden, narrow, crowded, and unsupported cases
  navigate safely to the centre editor or remain inert as specified.
- [ ] The derived **Bonus Attack** fallback is never persisted, and the
  invisible Boost Effect clearance copy never creates a duplicate target.
- [ ] Bottom and right Tuck Effect orientations retain aligned, non-overlapping
  targets through supported preview geometry.
- [ ] Plain Boost Effect and formatted Bonus Attack/Tuck Effect semantics match
  their existing centre controls, including token and IME behaviour where
  applicable.
- [ ] Effects cannot be enabled, disabled, recoloured, or reoriented from the
  card surface, and the corner badge remains centre-only.
- [ ] No direct interaction appears in replacement, sample, cardback, public,
  shared, print, export, or other read-only contexts.
- [ ] No editor control enters `.plate`; export dimensions and geometry checks
  remain stable.
- [ ] `npm run check`, `npm run build`, and focused browser verification pass.
- [ ] The hosted Phase 5 preview is accepted before the reviewed commit is
  promoted to `main`.

---

## Principal risks

| Risk | Failure | Mitigation |
|---|---|---|
| Editing controls enter `.plate` | Inputs, cursors, or focus rings appear in PNG output | Keep all semantic controls in a sibling overlay; gate every phase on export fingerprints |
| Rendered HTML is treated as source | `{{name}}`, symbol tokens, formatting, or custom-symbol IDs are corrupted | Load and save the original stored value through the existing formatted-text conversion path |
| Bonus filtering loses identity | Visible Bonus ability 2 writes to Bonus ability 1 | Preserve the original array index before filtering empty entries |
| Split paths are confused | Primary text overwrites defence text or vice versa | Carry the logical region in every target, focus request, and mutation |
| A delayed focus request survives selection change | The wrong card receives focus or a mutation | Carry and revalidate `cardId`; invalidate requests and sessions on mismatch |
| Text reflow moves the target | The editor jumps, loses selection, or becomes detached | Keep a stable edit-session shell and recompute geometry after layout changes |
| Zoom, scroll, or resize leaves stale coordinates | A hotspot or editor no longer aligns with its field | Observe plate/target size and stage scrolling; recompute after Svelte `tick()` |
| Artwork adjustment and text editing overlap | Pointer gestures move art while the user intends to edit text | Make the modes mutually exclusive and finish one before entering the other |
| Hidden values become exposed | Scheme, null, or custom-symbol semantics change | Create direct targets only for visibly printed supported values |
| Live writes make cancellation ambiguous | Partial drafts autosave before Escape | Use a local draft and one explicit store commit per session |
| Rich-text logic is duplicated | Paste, tokens, caret, selection, or IME behaviour diverges | Extract or reuse the existing formatted-text core |
| Small previews create overlapping hotspots | The wrong field opens | Enforce a minimum usable screen-space region and fall back to centre navigation |
| Derived labels appear editable | Timing or ribbon text writes to an unrelated field | Mark derived display as navigation-only and name targets by source field |
| Placeholder copy is persisted | `Card Title` becomes real user data | Initialize from the empty source rather than renderer fallback text |
| Bonus Attack fallback is persisted | The derived **Bonus Attack** label becomes authored text | Treat the fallback as navigation-only and initialize from the empty stored source |
| Boost Effect exposes duplicate targets | Its visible text and invisible title-clearance copy both become interactive | Mark only the visible renderer node and include a fixture that asserts one target |
| Inactive effect data becomes editable | Hidden stored Boost, Bonus Attack, or Tuck text is exposed from the preview | Emit a marker only when the effect is active and the exact source is visibly represented |
| Right-oriented Tuck Effect geometry drifts | Its narrow vertical target overlaps or detaches after reflow | Measure the rendered marker in both orientations and apply the existing crowded-target fallback |
| Export occurs with an unresolved draft | Export omits the visible edit or captures transient UI | Finish or block deterministically according to the Phase 0 contract |
| Public renderer metadata is mistaken for authority | A shared card appears editable | Mount interaction only in the editable authoring `PreviewPanel`; metadata remains inert |

---

## Implementation discipline

- Keep the renderer as the export. Do not create an interactive rendering
  path or mutate rendered HTML.
- Keep every form control and focus treatment outside `.plate`.
- Treat `data-card-edit-target` as inert source metadata, not application
  state.
- Use one typed field-address contract across renderer markers, overlay
  targets, centre focus, and store mutations.
- Revalidate the card ID and ability side at the last responsible moment.
- Use `workshop.editCard()` for every committed document change.
- Reuse formatted-text, sanitization, token, selection, and numeric validation
  code rather than creating preview-specific variants.
- Keep pane, tab, target, hover, focus, and draft state ephemeral.
- Do not add a runtime dependency, schema field, or normalizer branch for this
  interaction.
- Comments should explain the export, token, identity, or focus failure they
  prevent.
- Land one logically separated commit per phase.
- Update this plan as prototype evidence resolves decisions; replace stale
  assumptions rather than appending contradictory notes.

## Preview-first delivery workflow

The completed Phases 0–4 were reviewed together and promoted to production on
28 September 2026. Phase 5 is a separate follow-on release and follows the
same preview-first promotion path:

1. Begin from the current accepted `main` commit on a dedicated preview
   branch, recommended `codex/direct-preview-special-effects-preview`. Do not
   reuse the historical Phases 0–4 branch.
2. Implement only the current phase and update its checkboxes and evidence.
3. Run `npm run check`, `npm run build`, export comparisons where applicable,
   and focused browser verification.
4. Commit the phase separately and push the preview branch.
5. Verify the hosted preview deployment, including a direct deep link and the
   phase's end-to-end authoring path.
6. Present both a plain-language summary and a technical log for review.
7. Fix preview-only findings on the same branch and repeat the checks.
8. Promote the accepted Phase 5 preview commit to `main` only after explicit
   approval, then verify the production deployment.

This workflow makes the hosted preview build—not only the development
server—the approval surface, while preserving a known-good `main` until the
entire project is ready.

## Recommended delivery order

1. Phase 0 interaction contract, prototype, and export baseline.
2. Phase 1 semantic targets and preview-to-editor navigation.
3. Phase 2 direct title and numeric editing.
4. Phase 3 existing ability paragraph editing.
5. Phase 4 hardening, hosted-preview acceptance, and production promotion.
6. Phase 5 active Boost Effect, Bonus Attack, and Tuck Effect editing, followed
   by a new hosted-preview review and explicit production approval.

Do not begin by making renderer text `contenteditable`. It appears smaller in
scope, but it would introduce the project's highest risks immediately: lossy
token round-tripping, browser-controlled DOM mutations, caret conflicts with
Svelte rendering, and editing chrome leaking into photographed output.
