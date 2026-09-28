# Direct Preview Editing — Session Handoff

**Updated:** 28 September 2026  
**Status:** Phases 0–4 are complete in production. Phase 5 (direct preview
editing for active Boost Effect, Bonus Attack and Tuck Effect fields) is
implemented on `codex/direct-preview-special-effects-preview` and awaits the
user's review of its hosted preview. Nothing from it is on `main`.

## User intent

- Desktop card authoring is the priority. Touch/mobile accommodations must not
  weaken the computer interaction.
- Mobile is primarily a viewing surface, with secondary authoring supported by
  safe full-editor fallbacks when the preview is too small or crowded.
- Phase 5 must be a separate commit on a new preview branch from current
  `main`.
- Nothing from Phase 5 reaches `main` until it has been reviewed in the hosted
  preview and the user explicitly approves promotion.
- When reporting work, include a plain-language explanation and a technical
  recap.

## Repository state at handoff

- The production feature baseline is merge commit
  `9ef768998fb7254698f79af2b9d10c05519f6efd`. `main` follows it with the
  Phase 5 roadmap and handoff and unrelated Tabletop Simulator storage work,
  ending at `70f02e8`.
- The Phase 5 preview branch `codex/direct-preview-special-effects-preview`
  starts from `70f02e8` and carries two commits: the pre-implementation review
  plus the Defense accessible-name correction, then Phase 5 itself.
- The baseline merge contains the exact reviewed Phase 4 tip
  `1edb0b519b3303e6fe258c26a4cc7c7340eb025e` plus the production artwork-export
  and print-readiness fixes.
- The historical `codex/direct-preview-editing-preview` branch must not be
  reused for Phase 5. Its local tip is `9392eef633637ace3e7e54c6363f7690fb08d95e`
  while its remote tip remains the reviewed `1edb0b5`.
- `DIRECT_PREVIEW_EDITING_PROJECT.md` on the preview branch is the
  authoritative roadmap. Its Phase 5 section records what was built, how the
  review's constraints were resolved, and which items await hosted review.

## Phase commits on the preview branch

- Phase 0: `a3205e9` — prototype direct preview title targeting.
- Phase 1: `746c7bc` — typed field mapping and preview-to-editor navigation.
- Foundation follow-up: `0c4f4c9` — direct placement preview dragging.
- Phase 2: `35b1239` — direct title and numeric editing.
- Phase 3: `b84386c` — direct formatted ability editing.
- Phase 4: `1edb0b5` — accessibility/responsive/release hardening and quantity
  controls.

These commits are already represented in the production merge on `main`.

## Hosted state

- Historical Phase 4 preview, exact commit `1edb0b5`:
  <https://adventures-workshop-nbmgcsbfs-adventures-workshop.vercel.app/>
- Verified production deployment for merge commit `9ef7689`:
  <https://adventures-workshop-563440yu9-adventures-workshop.vercel.app/>

The Phase 4 preview was left open for the user. A temporary local-only hero and
card named **Phase 4 Ready** exist in that preview origin's IndexedDB solely for
review. They are not repository or cloud data.

## Delivered behaviour

- Action-card title, supported numeric values, and existing ability paragraphs
  edit directly from a sibling overlay over the live preview.
- Empty, unsupported, ambiguous, narrow, or crowded targets open and focus the
  exact centre-editor control.
- Ability editing reuses the centre editor's rich-text selection, token,
  sanitization, paste, undo, caret, and IME core.
- Sessions keep a local draft, commit once through `workshop.editCard()`, cancel
  with Escape, restore focus, revalidate card/source identity, and block export
  while unresolved.
- Editing controls never mount inside `.plate`; renderer metadata is inert.
- Coarse-pointer targets expand to 44 px only when they remain non-overlapping.
  Ambiguous expanded targets fall back to the centre editor.
- The quantity shown beneath the preview has accessible up/down arrows using
  the same `1–20` **Copies in deck** limits and store command as the centre
  editor. Action, rules, and event/prose quantity fields use the safe command
  path rather than mutating component props.
- Forced-colour focus outlines and the existing global reduced-motion handling
  cover accessibility modes unavailable to the in-app browser emulator.

## Phase 5 objective and field contract

Phase 5 extends the same preview overlay and edit-session lifecycle. It does
not introduce a second renderer, persist new fields, or change normalization.

| Visible field | Stored source | Direct behaviour | Fallback or guard |
|---|---|---|---|
| Boost Effect text | `card.boostEffect` | New **plain** single-line editor kind when active and visible, blank or not: a blank capsule edits in place like a blank title (user decision) | Mark `.boost-effect-label` only: never the capsule (it overlaps the boost value) or the invisible title-clearance copy |
| Bonus Attack title | `card.bonusAttackTitle` | Formatted single-line edit when stored text is non-empty | The derived **Bonus Attack** label opens the centre field and must never be persisted |
| Bonus Attack value | `card.bonusAttackValue` | Numeric edit using existing `0–9` bounds while the effect is active | Hidden/off effects expose no preview target |
| Bonus Attack ability | `card.bonusAttackAbility` | Formatted multiline edit when non-empty | A blank ability is not rendered, so it has no target; reach it through the title fallback or centre editor |
| Tuck Effect text | `card.tuckEffect` | Formatted single-line edit when active and non-empty | Mark the whole bar in both orientations, so blank text still has a navigation target. The bar is a layered surface, so the ability text it covers stays direct |

### Pre-implementation code review (28 September 2026)

The project plan's Phase 5 section, **Constraints found in the pre-implementation
code review**, records four shipped behaviours that shape this work. In short:
the overlay's crowded rule applies at every size, so a new target overlapping
the boost value or title would silently turn their direct editing into
navigation; zero-width markers are discarded, so blank text needs a sized
target; Boost Effect needs a new plain-text editor kind because the renderer
prints it literally; and the editor placeholder and accessible names must be
made per-field. The `advanced` location exists but nothing emits or consumes it
yet.

Effect toggles, Tuck Effect orientation, special-effect colours, and the
corner badge remain centre-editor controls. Desktop mouse and keyboard use the
direct interaction; narrow, crowded, or ambiguous touch targets use the
existing exact centre-editor fallback.

Implementation must add exact field addresses in place of the unused coarse
`advanced` descriptor, add stable renderer and centre-editor markers, and
reuse `workshop.editCard()`, the local-draft session, rich-text core, numeric
validation, stale-card guards, focus restoration, artwork exclusion, and
export blocking already delivered in Phases 0–4.

## Phase 5 verification (development server)

- Pixel identity: ten Boost Effect, Tuck Effect and Bonus Attack cards
  photographed through the real export stage hash identically before and after
  the renderer changes, after confirming the hashes are stable across runs.
- Phase 0 geometry-only verification: 7 of 7. `npm run check` 0/0;
  `npm run build` passes with the existing chunk-size advisory.
- Every field exercised with mouse and keyboard: commit, Escape, Enter versus
  Ctrl+Enter, focus restoration, centre-editor sync, IndexedDB persistence,
  export blocking, `{{name}}` and bold round trips, 0–9 clamping.
- Fallbacks: derived Bonus Attack title and blank Tuck Effect focus their exact
  centre controls; a 280 px canvas routes all five fields to the centre editor.
- Fixed in passing, shared with Phases 2–4: text editors opened with the caret
  at the start of existing copy; single-line editors took a tall target's
  height. Recorded, not changed: a right Tuck bar hides the right edge of long
  ability lines.
- Evidence: `tools/baselines/direct-preview-editing-phase5/`.

## Phase 0–4 verification

- `npm run check`: 0 errors, 0 warnings.
- `npm run build`: passed. Vite still prints the pre-existing advisory that the
  main application chunk exceeds 500 kB; Phase 4 added no dependency or chunk.
- Hosted browser journey passed for title, ability, quantity, centre/preview
  synchronization, Escape, keyboard traversal, persistence, dark/light,
  phone fallback, 100%/200% preview zoom, bleed, and guides.
- Hosted browser console: 0 warnings/errors after the final quantity mutation
  fix.
- Shared direct link loaded from a fresh URL and exposed 0 preview-edit or
  quantity controls.
- `.plate` contained 0 buttons, inputs, or contenteditable elements.
- The deterministic Phase 0 export fixture regenerated successfully; all seven
  geometry checks passed.
- Strict decoded-pixel comparison continues to show environment-sensitive font
  rendering and line-ending variance. This is documented in Phase 3/4 evidence.
  Phase 4 changed no renderer, print, Tabletop Simulator, or export path.

Evidence, now on `main`:

- `tools/baselines/direct-preview-editing-phase0/`
- `tools/baselines/direct-preview-editing-phase1/`
- `tools/baselines/direct-preview-editing-phase2/`
- `tools/baselines/direct-preview-editing-phase3/`
- `tools/baselines/direct-preview-editing-phase4/`
- `tools/baselines/direct-preview-editing-phase5/` (preview branch)

## Remaining work

1. Verify the hosted deployment of the pushed preview branch: persistence,
   console cleanliness, `.plate` isolation, export safety, and a direct shared
   link exposing no preview-edit controls.
2. Report a layman explanation and a technical recap. Keep `main` untouched
   while the user reviews the hosted preview; fix findings on the same branch.
3. Only after explicit acceptance, promote the reviewed preview branch (both
   commits) into the then-current `main`, rerun proportionate checks, push,
   verify the exact production deployment, and tick the remaining Phase 5
   checklist items.

Suggested geometry command:

```powershell
node tools/mobile-baseline/evidence.mjs verify --manifest tools/baselines/direct-preview-editing-phase0/evidence-manifest.json --geometry-only
```

## Files to preserve

These unrelated untracked paths pre-dated the handoff and were deliberately not
staged, edited, deleted, or committed:

- `PROJECT_STATE.md`
- `PROJECT_STATE2.md`
- `map_logo.psd`
- `outputs/`
- `supabase/.temp/`
- `supabase/migrations/0017_dashboard_owner_views.sql`

Also preserve other worktrees and branches shown by `git branch -vv`; they are
outside this project's scope.
