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

## Every check

### Blockers

| Check | Fires when |
| --- | --- |
| No villain | No character has the `villain` role. |
| No minions | No character has the `minion` role. |
| No cards | The set has no cards at all. |

### Gaps

| Check | Fires when |
| --- | --- |
| No initiative deck | No deck of kind `initiative` exists. |
| No threat track | `threat.enabled` is off. |
| No health dial | A villain or minion has no component of kind `dial` assigned to it. |
| No figure or token | A villain or minion has no component of kind `figure` or `token` assigned to it. |
| Unnamed character | Any character's name is blank. |
| Untitled cards | A card still falls back to its "Untitled …" label. |
| Cards without artwork | An **action** card has no artwork. Other templates carry none, so they are not counted. |
| Cards with no rules text | Action: both ability blocks empty. Initiative: Right Now *and* End of Round empty. Rules and event: empty body. |

The dial and figure checks count **per character**, not per set — one dial does
not cover three minions. They only look at villains and minions, since those are
the figures that go on the board.

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
