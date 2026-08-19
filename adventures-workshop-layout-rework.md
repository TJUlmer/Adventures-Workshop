# Adventures Workshop — Layout & Navigation Rework

A walk-through of the live app (both your near-empty "Untitled Adventure" and the fully-built "Oz Adventure" set), cross-referenced against your tips-and-tricks file, to find exactly *why* those capabilities feel hidden and what to change so they don't.

## The core problem

The tool isn't missing features — it's missing a consistent *shape* for where features live. Nearly every "hidden" item in your tips file turns out to be a real, well-built control that's just placed inconsistently relative to similar controls elsewhere. Once you've found "replacement image" once, you'd expect to find it in the same visual spot everywhere else it appears — but it moves. Once you've learned the Hero editing pattern, you'd expect Villains and Minions to work the same way — but they don't. That inconsistency is what makes an otherwise coherent tool feel like it has secret passages.

Below is what I found for each pattern, with the exact locations, followed by prioritized fixes.

## What's happening, section by section

### 1. Heroes get four tabs; Villains and Minions get one long scroll

Open a Hero (e.g. "maui") and you get a clean sub-navigation: **Identity | [name] | Deck back | Action card defaults**. Each tab is a focused, short page.

Open a Villain (e.g. "Wicked Witch" in Oz Adventure) or a Minion, and there are no tabs at all — Identity, Decks, Deck back (with its replacement-image control), and presumably the action-card-default styling are all stacked into one continuous scroll. The underlying content is the same *kind* of information as a Hero's four tabs, just flattened.

This is probably the single biggest source of "I know this exists somewhere, I just can't find it" — because the muscle memory a user builds on Heroes (click the third tab for deck back, the fourth for card defaults) doesn't transfer to Villains or Minions, which make up most of a typical set's roster.

**Fix:** give Villain and Minion sheets the same tab structure as Hero sheets. This is a pure information-architecture change — the fields already exist, they just need the same shell around them.

### 2. "Replacement image" moves around the page depending on where you are

This control is genuinely everywhere, as your notes say — but it doesn't look or sit the same way twice:

- On a card's **Design** tab and on a Hero's **Deck back** tab, it's the first thing you see, under a clear "REPLACEMENT IMAGE" section label.
- On a Hero's own character-card tab (the "maui" tab), the equivalent control is the *last* thing on the page, below the Sidekick section, under an unlabeled "Character card design" heading — no "replacement image" text at all, just an icon and "No replacement image."
- On the Threat track and Settings pages it appears again in yet another framing (Nameplate logo, Initiative deck back).

Because the label, position, and heading text aren't consistent, a user has to re-discover the control fresh on every screen type rather than pattern-matching from the last place they found it.

**Fix:** standardize this into one recognizable component — same icon, same "REPLACEMENT IMAGE" label, same position (top of its panel) — every place it appears: character sheet, deck back, action card, threat board nameplate, box art, initiative deck back. One visual signature, learned once.

### 3. Threat track and Map look empty rather than "off"

Click the **Threat track** or **Map** top-level nav item on a fresh set and you land on what reads as a mostly blank page with faded placeholder content — the actual control that turns the feature on is a small toggle switch tucked in the top-right (Threat track) or inline in a small card (Map). It's easy to read this as "the villain has no threat track yet" rather than "there's a whole board-building tool one click away."

Contrast this with the **Components** page's empty state, which is already the right pattern: a centered icon, a sentence of explanation, and a real button ("+ Add a figure") — you can't miss it.

**Fix:** replace the corner toggle with a proper empty state matching Components: icon, one line explaining what a threat track/map is for, and a prominent "Build a threat track" / "Add a map" button that both enables the feature and drops the user into the builder.

### 4. The set-wide style (the top of the styling cascade) is buried under metadata, with no tabs of its own

Your notes describe the cascade as Set → Character → Card, and that's real and it works. But the *set* level lives on a single, very long page: click the "[Set name]" pill in the header, and you land on Set details (name/subtitle/description) → Publication (author/version) → Contents (counts) → and only after scrolling well past all of that, the actual Border/Ink/Pattern/Texture controls that are the base look for every card in the set.

Two problems here: first, that header pill reads as a project-name/breadcrumb control, not as "click here to set your set's visual identity," so people won't think to click it for styling. Second, once you're there, the styling controls are mixed in with unrelated metadata on one long scroll, instead of getting their own tab the way a Hero's "Action card defaults" does.

**Fix:** give the set-level page the same tabbed treatment as a character sheet — e.g. **Details | Publication | Style | Contents** — so "Style" is a clearly separate, short destination instead of something you scroll past three other topics to reach.

### 5. Set metadata is duplicated across two different top-level destinations

The Name/Subtitle/Description/Author/Version fields shown on the Cards page (nothing selected) are the *same* fields shown again on the **Settings** page. Settings then adds Box art and Initiative deck back at the bottom — but the Initiative deck itself is built elsewhere, under Cards → Initiative in the sidebar tree. So decorating the initiative deck's back requires knowing to leave the Cards section entirely and scroll to the bottom of a page named Settings, which has no visible connection to "Initiative" in the sidebar.

**Fix:** pick one home for set metadata (Settings is the more discoverable name for it) and stop duplicating it under Cards. Move "Initiative deck back" to live next to the Initiative deck itself, so decorating it doesn't require a trip to an unrelated tab.

### 6. Symbols live in total isolation from where you'd use them

**Symbols** is a top-level nav item, sitting alongside Home/Cards/Threat track/Map/etc. — but nothing in the ability-text editing fields where you'd actually *use* a symbol hints that this page exists. You have to already know to go create a symbol before you'll ever see it offered as an option next to a text box.

**Fix:** add a small "insert symbol" icon directly on ability-text fields that opens the symbol palette (including "create new") in place. Keep the standalone Symbols page for bulk management, but stop making it the only entry point.

### 7. The styling cascade is invisible as a *relationship*, even though it's a great mental model

Set → Character → Card is genuinely elegant once you know it (and the "from character" / "from template" inheritance labels next to each color swatch are a nice touch — that part already works well). But nothing in the UI shows the three levels *as connected* — they're three separately-styled destinations (a header pill, a tab named "Action card defaults," a tab named "Design") with no shared visual language tying them together.

**Fix:** add a small breadcrumb above styling panels — e.g. "Set style → Wicked Witch's cards → this card" — with each segment clickable to jump to that level. That turns the cascade from something explained in a text file into something visible at the point of use.

### 8. Six flat buttons on the Components page

`+ Sidekick token · + Minion token · + Threat track token · + Figure · + Health dial · + Game piece` sit as six co-equal buttons in the header. They're not visually grouped despite being conceptually different (tokens tied to game state vs. generic pieces vs. the health-dial generator), so a new user has to read all six to figure out which one they want.

**Fix:** group into two clusters (Tokens vs. Pieces/Figures) or collapse into a single "+ Add component" menu with the six options listed underneath, ordered by how commonly they're used.

## What's already working well (worth preserving as you rework)

- The small "from character" / "from template" text next to inherited color values is a genuinely good discoverability pattern — it's the one place the styling cascade explains itself in-context. Extend this pattern rather than replacing it.
- The "Design 1" badge that appears on a card's Design tab once you've made an override is a nice, quiet way of showing "you've customized something here" — worth using more broadly (e.g., on the Villain/Minion tabs once they exist).
- The Home page's "Set health" panel (Gaps vs. Polish, with inline "Fix" links) is an excellent pattern for surfacing what's incomplete — consider using the same gap/polish framing to *also* surface unused capabilities (e.g., "You haven't tried the styling cascade yet" or "No custom symbols created") rather than only structural gaps.

## Priority order for the rework

1. **Give Villains and Minions the same tabbed sheet as Heroes.** Highest impact, since most rosters are villain/minion-heavy, and it's the clearest case of "same content, inconsistent shell."
2. **Standardize the Replacement Image control's position and label everywhere it appears.**
3. **Replace the Threat track / Map corner-toggle empty states with full empty-state CTAs**, matching the Components page pattern.
4. **Split the set-level page into tabs (Details / Publication / Style / Contents)** so Style isn't buried under metadata.
5. **Resolve the Settings/Cards duplication** and relocate Initiative deck back next to the Initiative deck.
6. **Surface Symbols inline in text fields**, keeping the standalone page for management.
7. **Add a cascade breadcrumb** to make Set → Character → Card visible in the UI itself.
8. **Group the Components add-buttons.**

Items 1–3 are pure information-architecture moves — no new functionality required, just relocating and re-labeling existing controls — so they're likely the fastest wins relative to how much "hidden feature" frustration they'd resolve.
