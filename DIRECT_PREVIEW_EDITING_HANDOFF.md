# Direct Preview Editing — Session Handoff

**Updated:** 28 September 2026  
**Status:** Phases 0–4 are complete in production. Phase 5 is planned but not
implemented: add direct preview editing for active Boost Effect, Bonus Attack,
and Tuck Effect fields when their source is visibly represented on the card.

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

- The current checkout is `main` at
  `9ef768998fb7254698f79af2b9d10c05519f6efd`; `origin/main` is the same commit.
- That merge commit contains the exact reviewed Phase 4 tip
  `1edb0b519b3303e6fe258c26a4cc7c7340eb025e` plus the production artwork-export
  and print-readiness fixes.
- The historical `codex/direct-preview-editing-preview` branch must not be
  reused for Phase 5. Its local tip is `9392eef633637ace3e7e54c6363f7690fb08d95e`
  while its remote tip remains the reviewed `1edb0b5`.
- When implementation begins, create a fresh branch from the then-current
  `main`, recommended `codex/direct-preview-special-effects-preview`.
- `DIRECT_PREVIEW_EDITING_PROJECT.md` on `main` is now the authoritative
  roadmap. Its completed Phase 4 evidence remains historical truth and its
  unchecked Phase 5 section describes the next release.

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
| Boost Effect text | `card.boostEffect` | Plain single-line edit when active, visible, and non-empty | Blank text or a hidden boost assembly opens the centre field; never target the invisible title-clearance copy |
| Bonus Attack title | `card.bonusAttackTitle` | Formatted single-line edit when stored text is non-empty | The derived **Bonus Attack** label opens the centre field and must never be persisted |
| Bonus Attack value | `card.bonusAttackValue` | Numeric edit using existing `0–9` bounds while the effect is active | Hidden/off effects expose no preview target |
| Bonus Attack ability | `card.bonusAttackAbility` | Formatted edit when non-empty | Blank text opens the centre field |
| Tuck Effect text | `card.tuckEffect` | Formatted single-line edit when active and non-empty | Support both bottom and right orientation; blank text opens the centre field |

Effect toggles, Tuck Effect orientation, special-effect colours, and the
corner badge remain centre-editor controls. Desktop mouse and keyboard use the
direct interaction; narrow, crowded, or ambiguous touch targets use the
existing exact centre-editor fallback.

Implementation must refine the existing coarse `advanced` target descriptors
into exact field addresses, add stable renderer and centre-editor markers, and
reuse `workshop.editCard()`, the local-draft session, rich-text core, numeric
validation, stale-card guards, focus restoration, artwork exclusion, and
export blocking already delivered in Phases 0–4.

## Verification already completed

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

Evidence on the preview branch:

- `tools/baselines/direct-preview-editing-phase0/`
- `tools/baselines/direct-preview-editing-phase1/`
- `tools/baselines/direct-preview-editing-phase2/`
- `tools/baselines/direct-preview-editing-phase3/`
- `tools/baselines/direct-preview-editing-phase4/`

## Remaining work

1. Do not start Phase 5 until the user asks to begin implementation. At that
   point, update from remote and create
   `codex/direct-preview-special-effects-preview` from the latest accepted
   `main`; do not reuse the historical preview branch.
2. Implement the exact Phase 5 field contract above. Keep inactive, blank,
   derived, hidden, narrow, crowded, and unsupported cases on the safe
   centre-editor or inert paths described in the project plan.
3. Exercise the full Phase 5 fixture matrix, especially the duplicate invisible
   Boost Effect copy, derived Bonus Attack title, Bonus Attack `0–9` bounds,
   both Tuck Effect orientations, combined effects, formatted tokens, long-text
   reflow, and read-only/export surfaces.
4. Run `npm run check`, `npm run build`, `git diff --check`, focused browser
   verification, and the Phase 0 geometry-only evidence verification.
5. Commit Phase 5 separately and push only its preview branch. Verify the exact
   hosted deployment, including persistence, console cleanliness, `.plate`
   isolation, export safety, and a direct shared link.
6. Report both a layman explanation and a technical recap. Keep `main`
   untouched while the user reviews the hosted preview.
7. Only after explicit acceptance, promote the exact reviewed Phase 5 commit
   into the then-current `main`, rerun proportionate checks, push, verify the
   exact production deployment, and mark the Phase 5 checklist complete.

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
