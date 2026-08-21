# Set health

What the Home page means when it calls a set *Not playable yet* or *Playable,
still rough*, and every check behind it.

Health is deliberately a **list of concrete gaps rather than a score**. A
percentage tells you nothing you can act on; "3 cards have no artwork" does, and
it can be clicked. Everything below lives in
[`src/lib/sets/health.ts`](src/lib/sets/health.ts) — this file is the map, that
file is the code.

## The four statuses

The status is the worst severity present. It is not a tally: one blocker outranks
any number of polish items.

| Status | Shown when | Meaning |
| --- | --- | --- |
| **Not playable yet** | one or more **blockers** | Something the game cannot run without is missing. |
| **Playable, still rough** | no blockers, one or more **gaps** | It can be played, but a player would notice what is missing. |
| **Ready — a few polish items** | no blockers or gaps, some **polish** | Playable and complete; what is left is presentation. |
| **Complete** | no issues at all | Nothing outstanding. |

## The three severities

- **Blocker** — the adventure cannot be played. Reserved for missing *structure*:
  the figures that fight and the cards they fight with.
- **Gap** — playable, but incomplete in a way a player meets at the table: no
  rules text, no way to track health, nothing driving the villain's turn.
- **Polish** — presentation and credits. Never blocks anything.

## The set's kind decides which checks apply

A set is an **adventure** or a **heroes set** (`AdventureSet.kind`, see
`sets/types.ts`). Four checks belong to an adventure alone and are skipped
entirely for a heroes set — not softened, skipped:

| Skipped for a heroes set | Why |
| --- | --- |
| No villain | There is no antagonist by definition. |
| No minions | Same. |
| No initiative deck | It exists to drive the villain's turn. |
| No threat track | It exists for the villain to advance along. |

This is the whole reason the kind exists. Before it, a finished heroes set —
every hero drawn, dials and figures listed, a map — read "Playable, still
rough" forever, with four items on its list that could never be actioned.
Measured on Lucy & Piper: four gaps as an adventure, none as a heroes set.

**The map is deliberately not in that list.** Heroes need somewhere to fight
each other, which is why `MAP_SIZES` offers boards smaller than an adventure's.

A heroes set gains one check of its own: *No heroes* is a **blocker**, on the
same reasoning that makes "No cards" one — a heroes set is its heroes.

## Every check

### Blockers

| Check | Fires when |
| --- | --- |
| No villain | No character has the `villain` role. *Adventure only.* |
| No minions | No character has the `minion` role. *Adventure only.* |
| No heroes | No character has the `hero` role. *Heroes set only.* |
| No cards | The set has no cards at all. |

### Gaps

| Check | Fires when |
| --- | --- |
| No initiative deck | No deck of kind `initiative` exists. *Adventure only.* |
| No threat track | `threat.enabled` is off. *Adventure only.* |
| No health dial | A fielded character has no component of kind `dial` assigned to it. |
| No figure or token | A fielded character has no component of kind `figure` or `token` assigned to it. |
| Unnamed character | Any character's name is blank. |
| Untitled cards | A card still falls back to its "Untitled …" label. |
| Cards without artwork | An **action** card has no artwork. Other templates carry none, so they are not counted. |
| Cards with no rules text | Action: both ability blocks empty. Initiative: Right Now *and* End of Round empty. Rules and event: empty body. |

The dial and figure checks count **per character**, not per set — one dial does
not cover three minions. "Fielded" means every role that goes on the board:
heroes, villains and minions. Only a sidekick is excluded, because it is a stat
line on someone else's sheet rather than a piece with its own health.

Heroes were missing from that list until the kind was added, so a hero was
never once asked for a dial or a figure in any set. Invisible while heroes were
a minority of an adventure's roster; it would have meant the two checks that
matter most never ran at all in a heroes set.

### Polish

| Check | Fires when |
| --- | --- |
| Plain deck backs | A character's deck back has neither inset artwork nor a replacement image. |
| No figures or tokens | The set lists no components at all. |
| No box art | `boxArt` has no image. |
| No author credited | `meta.author` is blank. |

## Changing any of this

Each check is a few lines in `assessSet()` in
[`src/lib/sets/health.ts`](src/lib/sets/health.ts), pushing one object:

```ts
issues.push({ severity: 'gap', message: 'No threat track — …' });
```

- **To retune a severity**, change the `severity` on that push. Nothing else
  needs to move; the status text and the counts derive from it.
- **To add a check**, push another issue. Add a `cardId` if the issue points at
  one card, and the Home page grows a **Fix** button that jumps straight to it.
- **To rename a status**, edit `healthSummary()` in the same file — and this
  table with it.

Two judgement calls worth knowing about, because they are the ones most likely to
want changing:

- **"No minions" is a blocker, not a gap.** It is paired with the villain check
  on the assumption that an Adventures set is a villain *and* what it commands.
  A villain-only adventure would want this demoted to a gap.
- **"No threat track" is a gap, not a blocker.** The set is playable without one;
  it just is not the shape the format expects.
