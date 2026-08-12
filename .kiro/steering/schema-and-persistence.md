---
inclusion: auto
description: Rules for persisted document shape. Apply when adding or changing any field that is saved, or when touching src/lib/sets/normalize.ts, src/lib/storage/, import/export serialisation, or SET_SCHEMA_VERSION.
---

# Schema and persistence

`SET_SCHEMA_VERSION` (currently **6**) is checked on import; files from a newer
schema are **refused**, not guessed at.

There is no migration ladder. What exists instead is repair: `sets/normalize.ts`
fills absent fields from the factories' defaults and renames what has been renamed
(the v6 `modifier` → `event` rename is the only one so far).

**Any new persisted field needs a branch in `normalize.ts`**, or existing documents
load without it.

**Absent is meaningfully different from empty** in places — a step's `fill: null`
means "follow the board", not "no fill". Do not collapse the two.

A real migration ladder lands when a *shape* changes, not just a name.

## Storage

The document lives in `localStorage`, autosaved from `src/lib/state/`. Embedded
artwork is stored as data URLs, which will outgrow `localStorage` on a set with many
images. The autosave failure is **surfaced in the status bar rather than swallowed** —
keep it that way. The real fix is IndexedDB or a file handle.
