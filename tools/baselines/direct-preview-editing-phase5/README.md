# Direct preview editing Phase 5 evidence

Phase 5 adds direct preview editing for the active special effects: Boost
Effect text, Bonus Attack title, value and ability, and Tuck Effect text in
both orientations. The effect toggles, Tuck Effect orientation, special-effect
colours and the corner badge remain centre-editor controls.

A blank Boost Effect behaves like a blank card title, as the user asked: once
the effect is on, clicking its empty capsule opens a plain single-line editor.
A blank Bonus Attack title (which prints the derived **Bonus Attack** label) and
a blank Tuck Effect open the exact centre control; a blank Bonus Attack ability
is not rendered and has no target.

`interaction-evidence.json` records the exercised checks. The renderer changes
(edit markers, the Boost Effect label carrying the capsule's left padding and a
one-line minimum height) were proved pixel-identical: ten Boost Effect, Tuck
Effect and Bonus Attack cards photographed through the real export stage hashed
identically before and after, after first confirming the hashes are stable
across repeated runs. The Phase 0 fixture's seven geometry checks pass.

Two defects shared with Phases 2–4 were found and fixed here: every preview
text editor opened with its caret at the start of the existing copy, and a
single-line editor took the full height of a tall target. One pre-existing
renderer behaviour is recorded but not changed: a right-hand Tuck Effect bar is
painted over the right edge of the ability column, so long ability lines are
partly hidden under it.
