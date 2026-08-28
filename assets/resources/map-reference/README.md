# Map path/decoration reference

Isolated pieces taken from an official *Unmatched: Marmoreal* map photo
(Blackbando), supplied by the project owner as authorities for dynamic path
decorations in the adventure map (`src/lib/map/`). The newer `*_clean.png`
files replaced the earlier crude crops; the later `path_arrowhead.png`,
`path_arrow_modifier.png`, and `path_arrow_modifier_text.png` refine those
again and are now the implementation authority. These three pieces are copied
byte-for-byte to `public/assets/map/` and used directly. The black tags and
secret passage remain measurement references for native, configurable geometry.
The two-way modifier is still a not-yet-built decoration.

`source_marmoreal_map_detail.jpg` is the original supplied photo, kept for
re-isolating later if any of the pieces below turn out to be measured wrong.
That full source remains measurement-only and is never served. The three refined
orange pieces described above are the explicit public exceptions.

`source_large_fighter_icon_map_detail.png` is the separate supplied crop that
identifies the orange large-fighter marker. `icons/t-rex-pin.svg` is the exact
vector supplied later by the project owner and is now the implementation
authority; the earlier `icons/large_fighter_icon_reference.png` reconstruction
remains only as session history.

## What each crop is

| File | What it shows |
|---|---|
| `path_arrowhead.png` | Tight 48×48 orange arrowhead. Its point lands on the destination rim and the generated shaft overlaps beneath its cropped base. |
| `path_arrow_modifier.png` | Blank directional orange modifier body placed halfway, by arc length, between the origin rim and arrowhead shoulder. The body mirrors when the path reverses. |
| `path_arrow_modifier_text.png` | Separate `+1`/attack insert. It is overlaid without the body's direction mirror so the text remains readable left-to-right. |
| `path_arrow_oneway_clean.png`, `path_arrow_oneway_modifier_a_clean.png`, `path_arrow_oneway_modifier_b_clean.png` | Superseded full-arrow clean assemblies retained as reference history; no live renderer reference remains. |
| `path_secret_passage_magnifier.png` | Magnified authority for the grey/white secret-passage style. The implemented marker remains native so authors can rotate it, curve/fade its tail, set an exact colour, and use the padlock or a Symbols-tab upload. |
| `path_modifier_oneway_clean.png` | Clean black pointed tag reference (💥+1). It remains native geometry in `MapBoard.svelte` because the isolated official pixels retain their photographed diagonal. |
| `path_modifier_twoway_clean.png` | Clean symmetric reference (◄+1💥+1►), for the not-yet-built modifier that applies travelling either direction. |
| `combat_icons_grid.png` | The four combat-type tiles as one 2×2 block, in source layout: attack (red), scheme (tan/lightning), defense (blue), versatile (purple). |
| `icons/icon_attack.png`, `icon_scheme.png`, `icon_defense.png`, `icon_versatile.png` | The same four tiles, split into individual files. |
| `source_large_fighter_icon_map_detail.png` | Exact supplied map crop showing three large-fighter markers: thin broken orange circle/rays around a black dinosaur-footprint/exclamation glyph. Reference only. |
| `icons/t-rex-pin.svg` | Exact supplied 48×48 large-fighter pin, copied with identical vector markup to `public/assets/map/t-rex-pin.svg` and implemented as a per-connection toggle. |
| `icons/large_fighter_icon_reference.png` | Superseded transparent reconstruction retained as session history; it is not used by the tool. |

## Why these matter for "dynamic length/arc" paths

The remaining two-way modifier will still need to work along a path of *any*
length and curve, not just the angle and length photographed — see
`MapBoard.svelte`'s `.paths`/`.paths-glow` and `MapPath.curve`. The built forms
establish the path pattern: explicit curve geometry, tangent-aligned clean arrow
pieces, and direction stored on the path's existing `from`/`to` pair rather than baking
one reference angle into an image. Secret passages deliberately follow a
different model: matching per-space medallions with independently aimed,
curve-sampled tails, because their printed marks need not point at each other.
