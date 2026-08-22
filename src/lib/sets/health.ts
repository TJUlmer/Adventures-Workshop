/**
 * "How complete is this set?"
 *
 * Deliberately a list of concrete, actionable gaps rather than a score. A
 * percentage tells an author nothing they can act on; "3 cards have no artwork"
 * does, and can be clicked.
 */
import { cardLabel } from '$lib/cards/factory';
import type { Card } from '$lib/cards/types';
import { abilityIsEmpty } from '$lib/cards/types';
import { characterLabel } from '$lib/characters/factory';
import type { Character } from '$lib/characters/types';
import { hasArtwork } from '$lib/core/artwork';
import type { FigureKind } from '$lib/figures/types';
import { richTextIsEmpty } from '$lib/text/rich-text';
import type { AdventureSet } from './types';

export type IssueSeverity = 'blocker' | 'gap' | 'polish';

export interface SetIssue {
  severity: IssueSeverity;
  message: string;
  /** Card to jump to, when the issue points at one. */
  cardId?: Card['id'];
}

export interface SetHealth {
  issues: SetIssue[];
  readonly blockers: number;
  readonly gaps: number;
}

/** Cards that carry art, so "missing artwork" means something per template. */
function wantsArtwork(card: Card): boolean {
  return card.type === 'action';
}

export function assessSet(set: AdventureSet): SetHealth {
  const issues: SetIssue[] = [];
  const heroesSet = set.kind === 'heroes';

  /*
   * Four checks an adventure owes and a heroes set does not.
   *
   * These used to run against every set as `gap`s, on the reasoning that a box
   * of heroes is still a box and should not be called unplayable. That was
   * half right: it stopped saying "broken", but it went on asking for a
   * villain, minions, an initiative deck and a threat track that a finished
   * heroes set will never have — so one could be complete in every way its
   * author cared about and still read "Playable, still rough" forever, with
   * four items on the list that could not be actioned.
   *
   * A kind is what makes the difference expressible: skipped entirely here,
   * rather than softened. The map is deliberately *not* in this group — heroes
   * need somewhere to fight each other, which is why `MAP_SIZES` offers boards
   * smaller than an adventure's.
   */
  if (!heroesSet) {
    if (set.characters.every((character) => character.role !== 'villain')) {
      issues.push({
        severity: 'gap',
        message: 'No villain — an adventure needs one, a box of heroes does not.'
      });
    }

    if (set.characters.every((character) => character.role !== 'minion')) {
      issues.push({
        severity: 'gap',
        message: 'No minions — an adventure wants at least one.'
      });
    }

    if (!set.decks.some((deck) => deck.kind === 'initiative')) {
      issues.push({
        severity: 'gap',
        message: 'No initiative deck — nothing drives the villain’s turn.'
      });
    }

    if (!set.threat.enabled) {
      issues.push({
        severity: 'gap',
        message: 'No threat track — the villain has nothing to advance.'
      });
    }
  }

  if (set.cards.length === 0) {
    issues.push({ severity: 'blocker', message: 'No cards yet.' });
  }

  /* A heroes set with nobody in it is as empty as an adventure with no cards,
     and saying so is more use than listing what is missing from a blank. */
  if (heroesSet && set.characters.every((character) => character.role !== 'hero')) {
    issues.push({ severity: 'blocker', message: 'No heroes yet — a heroes set is its heroes.' });
  }

  if (!set.map.enabled) {
    issues.push({ severity: 'gap', message: 'No map — there is nowhere to play.' });
  }

  /*
   * Every figure on the board needs two things in the box: something to stand
   * there, and a dial to track its health. Counted per character rather than
   * set-wide, because one dial does not cover three minions.
   *
   * **Heroes are fielded too**, and were missing from this list — so a hero
   * was never once asked for a dial or a figure, in any set. That was
   * invisible while heroes were a minority of an adventure's roster and is the
   * whole roster of a heroes set, where it would have meant the two checks
   * that matter most never ran at all. A sidekick is deliberately still out:
   * it is a stat line on someone else's sheet, not a piece with its own
   * health.
   */
  const fielded = set.characters.filter((character) => character.role !== 'sidekick');
  const componentsFor = (character: Character, kinds: readonly FigureKind[]): boolean =>
    set.figures.some(
      (figure) => figure.characterId === character.id && kinds.includes(figure.kind)
    );

  const noDial = fielded.filter((character) => !componentsFor(character, ['dial']));
  if (noDial.length > 0) {
    issues.push({
      severity: 'gap',
      message: `${noDial.length} figure${noDial.length === 1 ? '' : 's'} without a health dial.`
    });
  }

  const noPiece = fielded.filter((character) => !componentsFor(character, ['figure', 'token']));
  if (noPiece.length > 0) {
    issues.push({
      severity: 'gap',
      message: `${noPiece.length} character${noPiece.length === 1 ? '' : 's'} with no figure or token.`
    });
  }

  for (const character of set.characters) {
    if (character.name.trim().length === 0) {
      issues.push({ severity: 'gap', message: `A ${character.role} has no name.` });
    }
  }

  const unnamed = set.cards.filter((card) => cardLabel(card).startsWith('Untitled'));
  if (unnamed.length > 0) {
    issues.push({
      severity: 'gap',
      message: `${unnamed.length} card${unnamed.length === 1 ? '' : 's'} still untitled.`,
      ...(unnamed[0] ? { cardId: unnamed[0].id } : {})
    });
  }

  /*
   * `card.replacement` too, not just `card.artwork` — a card whose finished
   * image stands in for the whole composition (see "Replacement images" in
   * CLAUDE.md) still reads a picture on the table, and the checklist calling
   * that "missing" was simply wrong. Checked the same way `noBack` already
   * checks a cardback's own replacement below, not gated on `useReplacement`:
   * an image sitting there unused is still a picture attached, and this is
   * "is there a picture," not "which one is currently showing."
   */
  const missingArt = set.cards.filter(
    (card) => wantsArtwork(card) && !hasArtwork(card.artwork) && !hasArtwork(card.replacement)
  );
  if (missingArt.length > 0) {
    issues.push({
      severity: 'gap',
      message: `${missingArt.length} card${missingArt.length === 1 ? '' : 's'} without artwork.`,
      ...(missingArt[0] ? { cardId: missingArt[0].id } : {})
    });
  }

  const emptyText = set.cards.filter((card) => {
    if (card.type === 'action') return abilityIsEmpty(card.ability) && abilityIsEmpty(card.defenseAbility);
    if (card.type === 'initiative') return !card.rightNow.trim() && !card.endOfRound.trim();
    return richTextIsEmpty(card.body);
  });
  if (emptyText.length > 0) {
    issues.push({
      severity: 'gap',
      message: `${emptyText.length} card${emptyText.length === 1 ? '' : 's'} with no rules text.`,
      ...(emptyText[0] ? { cardId: emptyText[0].id } : {})
    });
  }

  const noBack = set.characters.filter(
    (character) =>
      !hasArtwork(character.cardback.artwork) && !hasArtwork(character.cardback.replacement)
  );
  if (noBack.length > 0) {
    issues.push({
      severity: 'polish',
      message: `${noBack.length} deck back${noBack.length === 1 ? '' : 's'} using the plain template.`
    });
  }

  if (set.figures.length === 0) {
    issues.push({ severity: 'polish', message: 'No figures or tokens listed.' });
  }

  if (!hasArtwork(set.boxArt)) {
    issues.push({ severity: 'polish', message: 'No box art.' });
  }

  if (set.meta.author.trim().length === 0) {
    issues.push({ severity: 'polish', message: 'No author credited.' });
  }

  return {
    issues,
    get blockers() {
      return issues.filter((issue) => issue.severity === 'blocker').length;
    },
    get gaps() {
      return issues.filter((issue) => issue.severity === 'gap').length;
    }
  };
}

/**
 * A short human read of the set's state, for the home page header.
 *
 * The four statuses and every check that feeds them are written up in
 * `SET-HEALTH.md`, which is the place to go when retuning what counts as a
 * blocker rather than reading it back out of this file.
 */
export function healthSummary(health: SetHealth): string {
  return healthSummaryFromCounts(health.blockers, health.gaps, health.issues.length);
}

/**
 * The same four statuses, from counts alone rather than a full `SetHealth` —
 * what `HomeScreen`'s shelf wants, since `LibraryEntry` denormalises
 * `blockers`/`gaps`/`issueCount` (see `storage/library.ts`) rather than the
 * full `issues` list. Every issue's own message and card id would be several
 * times the weight of the rest of the index put together, for a shelf that
 * only ever prints the one-line status, not the checklist.
 */
export function healthSummaryFromCounts(
  blockers: number,
  gaps: number,
  issueCount: number
): string {
  if (blockers > 0) return 'Not playable yet';
  if (gaps > 0) return 'Playable, still rough';
  if (issueCount > 0) return 'Ready — a few polish items';
  return 'Complete';
}

/** Characters missing a name, for a quick jump list. */
export function unnamedCharacters(set: AdventureSet): string[] {
  return set.characters
    .filter((character) => character.name.trim().length === 0)
    .map((character) => characterLabel(character));
}
