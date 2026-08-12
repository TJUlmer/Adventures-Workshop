import type { Fill } from '$lib/cards/style';
import type { CharacterId } from '$lib/characters/types';
import type { Artwork } from '$lib/core/artwork';
import { createArtwork } from '$lib/core/artwork';
import type { Id } from '$lib/core/id';
import { createId } from '$lib/core/id';
/* Imported straight from the geometry module, not via `renderer/index`, so the
   model does not pull the card faces in behind it. */
import { THREAT_MAX_SPACES } from '$lib/renderer/geometry';

export type ThreatStepId = Id<'ThreatStep'>;

/**
 * One space on the threat track: a hex with a numbered pennant beneath it.
 * The number is what the villain's threat rises by; the effect is optional and
 * fires when the marker reaches that space.
 */
export interface ThreatStep {
  readonly id: ThreatStepId;
  /** The number printed on the pennant. */
  value: number;
  /** Optional rules text for landing on this space. */
  effect: string;
  /**
   * The hex's own colour, or `null` to take the board's.
   *
   * Null rather than a concrete value so the last space keeps standing out on
   * its own — a space that has never been coloured should follow the board,
   * including the accent the trigger space is given.
   */
  fill: Fill | null;
  /**
   * The hex's own outline, or `null` to take the board's.
   *
   * Held apart from `fill` because the outline is what makes a space read as a
   * space on a printed board: an author colouring a space red on a black
   * outline should not have to give up one to set the other.
   */
  stroke: Fill | null;
  /**
   * The ribbon under the hex, or `null` to take the track's accent.
   *
   * Its own field rather than following the hex: the ribbon carries the number,
   * so it is often the one thing an author wants to keep legible while the hex
   * above it goes dark.
   */
  bannerFill: Fill | null;
  /** Ink for the number on the ribbon, or `null` for the printed white. */
  numberColor: string | null;
}

export type ThreatSlotId = Id<'ThreatSlot'>;

/**
 * A place on the board for a tile or a marker, to the right of the track.
 *
 * Every printed Adventures track has a row of these — fallen boroughs,
 * destroyed bridges, the pieces the villain's progress puts on the table — so
 * the board is somewhere to *put* things rather than only somewhere to read.
 */
export interface ThreatSlot {
  readonly id: ThreatSlotId;
  /** Printed under the slot, e.g. "Fallen borough 2". */
  label: string;
  /** Optional line of rules under the label. */
  note: string;
}

export type ThreatNoteId = Id<'ThreatNote'>;

/**
 * A line of text the author drops anywhere on the board.
 *
 * The printed boards all carry copy the layout does not account for — a rule
 * beside the slots, a caption over the track, a title in the corner — and no
 * fixed set of fields would cover every villain. Position is a fraction of the
 * board rather than a pixel offset, so a note stays where it was put whatever
 * width the board is being shown at.
 */
export interface ThreatNote {
  readonly id: ThreatNoteId;
  text: string;
  /** 0–1 across the board, from its top left. */
  x: number;
  y: number;
  /** Type size, as a percentage of the board's width. */
  size: number;
  /**
   * Turn, in degrees clockwise. 0 is level.
   *
   * Degrees rather than a fraction of a turn because that is the unit the
   * control shows and the unit CSS takes, so nothing converts on the way
   * through and there is no chance of the two disagreeing.
   */
  rotation: number;
  /**
   * Ink, as a concrete colour rather than a token.
   *
   * A note lands on the author's own artwork, so light copy on a light picture
   * has to be answerable. Concrete for the same reason a card's colours are:
   * printed text must not change because the editor's theme did.
   */
  color: string;
}

export interface ThreatTrack {
  /** Adventures without a threat track simply turn it off. */
  enabled: boolean;
  /** Which villain the track belongs to. */
  villainId: CharacterId | null;
  /** Line under the villain's name on the nameplate, usually a place. */
  subtitle: string;
  steps: ThreatStep[];
  /** Text in the arrow at the end of the track. */
  finalLabel: string;
  /** What happens when the marker runs off the end. */
  finalEffect: string;
  /** Tile and marker spaces, right of the track. */
  slots: ThreatSlot[];
  /** The burst at the far right. Blank prints "<villain> wins!". */
  winLabel: string;
  /** Free copy, placed by hand anywhere on the board. */
  notes: ThreatNote[];
  /**
   * The author's own lockup for the nameplate.
   *
   * The printed board carries the publisher's, which cannot be redistributed —
   * so the plate has stood empty behind a masked placeholder. This is the way
   * back in: make a logo anywhere and attach it. Absent, the placeholder is
   * drawn as before, so a board that never had one is unchanged.
   */
  logo: Artwork;
  /**
   * Artwork under the board, with everything else drawn over it.
   *
   * The whole point of a threat track is that it is the villain's, so the
   * board takes a picture the way a card does — placed, cropped and graded
   * with the same controls.
   */
  background: Artwork;
  /**
   * A finished board, made elsewhere, used instead of composing one. Kept
   * alongside the composition rather than replacing it, so switching back
   * costs nothing.
   */
  replacement: Artwork;
  useReplacement: boolean;
  /** How the track advances, in the author's own words. */
  rules: string;
  /** Track colour. Defaults to the printed red. */
  accent: string;
  /**
   * The outline every space takes unless it sets its own `stroke`.
   *
   * A plain colour rather than a `Fill`, the way `accent` is: the board-wide
   * default is one decision, and a space that wants a gradient outline says so
   * itself.
   */
  spaceStroke: string;
}

/** The stock outline colour, mirroring `--grey-950`. */
export const THREAT_SPACE_STROKE = '#0b0c11';

/** The stock note ink, mirroring `--grey-100`. */
export const THREAT_NOTE_COLOR = '#e7e9f3';

/** The number on a ribbon prints white, as it does on the real boards. */
export const THREAT_NUMBER_COLOR = '#ffffff';

export function createThreatStep(value: number, effect = ''): ThreatStep {
  return {
    id: createId<ThreatStepId>('threat'),
    value,
    effect,
    fill: null,
    stroke: null,
    bannerFill: null,
    numberColor: null
  };
}

/**
 * Whether another space would still fit the printed rail.
 *
 * The rail's room is a fixed printed dimension, so this is a constant compared
 * against a count — nothing is measured. Callers use it to refuse the edit *and*
 * to disable the control that would make it, so the cap is never a surprise.
 */
export function canAddThreatStep(track: ThreatTrack): boolean {
  return track.steps.length < THREAT_MAX_SPACES;
}

export function createThreatSlot(label = '', note = ''): ThreatSlot {
  return { id: createId<ThreatSlotId>('slot'), label, note };
}

/** Dropped in the middle of the board, where it cannot be missed. */
export function createThreatNote(text = ''): ThreatNote {
  return {
    id: createId<ThreatNoteId>('note'),
    text,
    x: 0.45,
    y: 0.12,
    size: 1.4,
    rotation: 0,
    color: THREAT_NOTE_COLOR
  };
}

/** Notes are placed by fraction, so they can never be dragged off the board. */
export function clampNotePosition(x: number, y: number): { x: number; y: number } {
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return { x: clamp(x), y: clamp(y) };
}

/** The stock track from the printed template: seven spaces, 1-2-3-4-4-5-5. */
export function createThreatTrack(): ThreatTrack {
  return {
    enabled: false,
    villainId: null,
    subtitle: '',
    steps: [1, 2, 3, 4, 4, 5, 5].map((value) => createThreatStep(value)),
    finalLabel: 'Do Something',
    finalEffect: '',
    slots: [createThreatSlot(), createThreatSlot(), createThreatSlot()],
    winLabel: '',
    notes: [],
    logo: createArtwork(),
    background: createArtwork(),
    replacement: createArtwork(),
    useReplacement: false,
    rules: '',
    accent: '#e01b24',
    spaceStroke: THREAT_SPACE_STROKE
  };
}

/** What the burst prints. Named after the villain unless the author says. */
export function threatWinLabel(track: ThreatTrack, villainName: string): string {
  const written = track.winLabel.trim();
  if (written) return written;
  return `${villainName || 'Villain'} wins!`;
}

/** Total threat the villain accumulates across the whole track. */
export function threatTotal(track: ThreatTrack): number {
  return track.steps.reduce((total, step) => total + step.value, 0);
}
