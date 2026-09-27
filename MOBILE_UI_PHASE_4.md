# Mobile UI Phase 4 — Mobile-safe Rich Text and Symbol Insertion

**Status:** Browser implementation and desktop regression checks complete; physical iOS and Android selection, keyboard, picker, and IME evidence remains

**Completed:** 26 September 2026

**Applies to:** Rules/event rich text, action-card formatted fields, plain token fields, formatting toolbars, and built-in/custom symbol insertion

This document records the implemented Phase 4 contract from
`MOBILE_UI_PROJECT.md`. It changes editor interaction and responsive toolbar
presentation only. It does not change the set schema, stored rich-text dialect,
token syntax, renderer, export geometry, storage authority, or publication
model.

## Plain-language summary

Formatting on a phone no longer depends on the browser keeping a text
selection alive while the author taps somewhere else. Each editor remembers
the last phrase or caret the author chose. Tapping Bold, Italic, alignment,
heading style, size, colour, or a symbol restores that exact place before the
edit is made. The same phrase can therefore be changed several times without
having to select it again after every tap.

The large rules toolbar is now one sideways-scrollable row instead of a stack
of rows that consumes most of a small screen. Action-card symbol rows use the
same pattern. On a touch device their buttons grow to comfortable tap targets,
but a swipe that begins on a button still scrolls the row normally.

This protection applies to all three text paths authors use: full rules/event
formatting, bold/italic action-card fields, and plain token text areas. Built-in
and uploaded symbols return to the last intended caret even if tapping the
toolbar temporarily dismisses the keyboard. Text entered through an IME is
left alone until composition finishes, instead of being sanitized in the
middle of a character.

## Selection and editing contract

Every contenteditable field owns a cloned `Range`. A component-lifetime
`selectionchange` listener refreshes it only when the browser reports a range
wholly inside that editor and the editor itself is active. Focus moving to a
toolbar button, number input, slider, or colour picker therefore does not
replace a useful selection with the browser's temporary or collapsed range.

`contenteditable-selection.ts` provides the shared DOM mechanics:

- reject ranges whose endpoints no longer belong to the editor;
- clone and reinstall valid ranges without deciding which control owns focus;
- fall back to the end of the editor for insertion when no caret has ever been
  recorded;
- bookmark a range before sanitation rebuilds `innerHTML`, then reconstruct it
  afterward.

The bookmark keeps both a DOM child path and a linear fallback. The linear
position counts text plus one editable position for each image and line break,
so a caret after an inline symbol cannot silently move to the symbol's other
side. The path preserves exact wrapper boundaries when the sanitizer keeps the
same structure; the linear value recovers when it legitimately unwraps or
merges nodes.

Rules-editor commands that require the browser editing host — bold, italic,
underline, lists, alignment, block style, and HTML symbol insertion — focus the
editor and reinstall the remembered range immediately before `execCommand`.
Size and colour are manual DOM operations. They temporarily detach the stale
live selection and operate on the cloned range, allowing the native slider or
colour input to retain focus throughout repeated changes.

When a selection exactly covers nested formatting, its boundary is widened to
include complete size, colour, bold, italic, underline, or strike wrappers.
This prevents an empty formatting shell from being left behind when size and
colour are layered in either order. Toolbar state also reads down through the
selected wrapper's first content branch, so a coloured span around a sized run
continues to report both values. Decimal size multipliers are rounded before
they are shown, avoiding floating-point values such as
`110.00000000000001` in the numeric control.

A genuine external redraw — card switch, undo, or custom-symbol rename —
clears the old range. Ordinary local commits do not.

## Pointer, keyboard, and composition behaviour

Toolbar and palette buttons now use pointer events. A primary mouse press
keeps desktop editor focus as before. Touch and pen presses are not cancelled,
so native scrolling, long-press selection, and pointer behaviour remain owned
by the browser. No pointer handler was added to an editable surface.

Both contenteditable implementations defer sanitation and store writes from
`compositionstart` until `compositionend`. Enter continues to respect
`KeyboardEvent.isComposing`. The plain textarea path keeps explicit start/end
indices on select, pointer-up, key-up, input, focus, and blur, then restores the
new caret after inserting a token.

Buttons retain keyboard activation and accessible names. Built-in, custom,
and figure-name symbol controls now all expose explicit insertion labels.

## Toolbar layout

The rules toolbar and shared symbol palette use `flex-wrap: nowrap`, own their
horizontal overflow, contain inline overscroll, and leave page-level vertical
scrolling untouched. Formatting groups and dividers do not shrink. The
existing **Select text to resize** explanation remains visible when no text
range is active.

Under `(any-pointer: coarse)`, rules formatting controls, swatches, size
inputs, and every shared symbol button receive at least the shared 44px touch
target. The action-card and plain-text field headers now give the palette a
bounded, shrinkable region, so it scrolls internally rather than widening the
page.

## Browser evidence

The fixed Phase 0 fixture was exercised in the in-app Chromium browser at
390×844 and 1440×900, browser zoom 100%, light theme, and a fine pointer.

At 390×844, the rules toolbar measured 346px visible against 870px of content,
with `flex-wrap: nowrap` and `overflow-x: auto`. The document remained exactly
390px wide. A fine-pointer action-card palette measured 306px by 306px; its
coarse-pointer rule expands every 22px visual button to the shared 44px target,
at which point that same row owns the additional horizontal overflow.

The rules editor passed this sequence:

- selected **Place the Regent**, moved focus to the heading field, then applied
  italic to the remembered phrase;
- continued with centre alignment and Header block style without reselecting;
- changed size from 100% to 105% and 110% while the slider retained focus;
- applied `#336699`, then changed size again to 115% while preserving the
  colour and the original bold wrapper;
- placed the caret after the final sentence, moved focus away, inserted the
  custom **spark** symbol, moved focus away again, and inserted Attack after
  it. Sanitization retained that order.

The action-card editor selected **Breakwater**, moved focus to another field,
then applied italic and bold in succession. At a remembered caret it inserted
`{{spark}}` followed by `{{attack}}`; the display tokens and stored custom id
remained in the existing token model. The plain initiative textarea placed
`{{attack}}` immediately after **defeated** after focus had moved to another
field.

At 1440×900, the document remained 1440px wide. The 660px rules toolbar owned
its 771px content overflow. A mouse activation applied italic and keyboard
activation of Underline continued on the same selection, producing nested
strong, italic, and underline markup without changing the surrounding copy.

Validation completed so far:

- `npm run check` — 0 errors and 0 warnings;
- `npm run build` — production build completed, with only the existing chunk
  size and mixed dynamic/static import warnings;
- `git diff --check` — passed for the Phase 4 files;
- Phase 0 rendered baseline geometry — all 53 files verified unchanged;
- rules selection restoration after unrelated focus — passed;
- repeated block, alignment, size, and colour changes — passed;
- native size-control focus across repeated changes — passed;
- built-in/custom HTML symbol order across sanitizer rebuilds — passed;
- formatted action-card selection and token insertion — passed;
- plain textarea caret restoration and token insertion — passed;
- desktop mouse and keyboard toolbar activation — passed;
- 390px and 1440px document-width regression checks — passed.

## Remaining device evidence

The in-app browser can constrain the real viewport but exposes a fine pointer
and a desktop text-selection implementation. It cannot substitute for native
mobile selection handles, software-keyboard resize/close behaviour, an
operating-system colour picker, or a real IME session.

Physical iOS Safari and Android Chrome testing therefore remains open for:

- long-pressing and adjusting a selected phrase with native handles;
- applying every rule-editor format while the software keyboard opens and
  closes;
- dragging the size slider and completing/cancelling the native colour picker;
- inserting built-in and uploaded symbols before, between, and after text;
- composing non-Latin text without a mid-composition rewrite;
- confirming the 44px controls and sideways palette scrolling with a thumb;
- repeating the path after backgrounding, foregrounding, and rotating the
  phone.
