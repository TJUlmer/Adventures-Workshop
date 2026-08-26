import type { CharacterId } from '$lib/characters/types';
import type { Artwork } from '$lib/core/artwork';
import { createArtwork } from '$lib/core/artwork';
import type { Id, IsoDateTime } from '$lib/core/id';
import { createId, now } from '$lib/core/id';
import { healthDialSpec } from '$lib/figures/health-dial';
import type { TokenShape, TokenSpec } from '$lib/models/token';
import { DEFAULT_OUTLINE_DETAIL } from '$lib/models/silhouette';
import type { TokenOutline } from '$lib/models/silhouette';

export type FigureId = Id<'Figure'>;

/**
 * Physical components a set needs beyond its cards.
 *  - `figure` — a miniature standing in for a character on the board.
 *  - `token`  — a marker the rules place, remove or move.
 *  - `dial`   — a health dial. Every villain and minion needs one, which is
 *               why it is its own kind rather than a `piece`: the set's health
 *               check counts them per figure.
 *  - `piece`  — anything else: a board overlay, a deck box insert.
 */
export const FIGURE_KINDS = ['figure', 'token', 'dial', 'piece'] as const;
export type FigureKind = (typeof FIGURE_KINDS)[number];

export const FIGURE_KIND_LABELS: Readonly<Record<FigureKind, string>> = {
  figure: 'Figure',
  token: 'Token',
  dial: 'Health dial',
  piece: 'Game piece'
} as const;

/**
 * A 3D model file, kept as a data URL alongside its name.
 *
 * Models are stored rather than linked for the same reason artwork is: the set
 * has to survive being handed to someone else as one file.
 */
export interface ModelFile {
  name: string;
  /** Data URL. `null` when only a reference image has been supplied. */
  source: string | null;
  /** Bytes, so the UI can warn before the document outgrows storage. */
  size: number;
}

/**
 * A token this app builds rather than one the author sculpts: a flat prism
 * carrying the component's reference image.
 *
 * `enabled` rather than a separate figure kind, because it is the same
 * component either way — the question is only whether the piece is generated
 * here or attached as a file.
 */
export interface TokenBuild {
  enabled: boolean;
  shape: TokenShape;
  /** Sides when `shape` is `polygon`; ignored for a circle. */
  sides: number;
  /**
   * The piece's reach on its own X axis — across the flats for a polygon,
   * across the circle for a disc.
   */
  diameterMm: number;
  /**
   * The piece's reach on its own Z axis, when it differs from `diameterMm`.
   *
   * Only a polygon reads this — a circle has one radius and stays a circle,
   * which is why there is no equivalent "stretch" for `shape: 'circle'`. A
   * regular polygon (the only kind `MIN_POLYGON_SIDES`–`MAX_POLYGON_SIDES`
   * used to make) is what you get when this equals `diameterMm`; a four-sided
   * one at that point is a square by construction, which was the actual
   * complaint this field exists to answer — there was no way to make a
   * rectangle, because a "4-sided polygon" can only ever be regular. Equal to
   * `diameterMm` at creation and independent of it afterward, the same
   * relationship `thicknessMm` already has to `diameterMm`.
   */
  lengthMm: number;
  thicknessMm: number;
  /** The edge of the piece, where the artwork does not reach. */
  rimColor: string;
  /**
   * The reference image is two faces side by side — front on the left, back on
   * the right — wrapped one to each side of the piece. Off, the one picture is
   * shown on both faces.
   */
  twoSided: boolean;
  /**
   * The outline traced from the reference image's alpha, for `shape:
   * 'silhouette'` — see `models/silhouette.ts`. Stored rather than
   * recomputed on demand: it is what the preview showed and what the `.obj`
   * is written from, and a lossy trace at an author-chosen tolerance is
   * authored data, not a cache. `null` until traced, or when the most
   * recent trace failed — either way `faceGeometry` falls back to the
   * circle every token starts as.
   */
  outline: TokenOutline | null;
  /**
   * How closely the trace follows the picture's edge — the Douglas-Peucker
   * tolerance, in the tracer's own pixel units. Lower is more faithful and
   * more points. Author-facing because the right value is image-dependent
   * (a hard-edged logo wants little smoothing, a feathered painting wants
   * more), and without this knob an author with a fussy picture has no way
   * to rescue a bad trace.
   */
  outlineDetail: number;
}

export function createTokenBuild(enabled = false): TokenBuild {
  return {
    enabled,
    shape: 'circle',
    sides: 6,
    diameterMm: 30,
    lengthMm: 30,
    thicknessMm: 2,
    rimColor: '#1a1a1a',
    twoSided: false,
    outline: null,
    outlineDetail: DEFAULT_OUTLINE_DETAIL
  };
}

/** The mesh/texture spec a build describes. One reading, shared by every path. */
export function tokenSpecOf(token: TokenBuild): TokenSpec {
  return {
    shape: token.shape,
    sides: token.sides,
    diameterMm: token.diameterMm,
    lengthMm: token.lengthMm,
    thicknessMm: token.thicknessMm,
    twoSided: token.twoSided,
    outline: token.outline
  };
}

/**
 * The mesh spec this figure is built from, or `null` when it stands for a
 * sculpt of its own — a plain `figure`, or a `token`/`piece` with its build
 * switched off — that no generated prism speaks for.
 *
 * A dial is a disc the app owns rather than one the author shapes, so most of
 * its spec is fixed rather than read off `token` — but it is the same
 * generated prism underneath, and going through this one function is what
 * keeps every reader (the editor's live preview, an Overview thumbnail)
 * agreeing on which figures are generated at all, rather than each
 * re-deriving it.
 *
 * `token.twoSided` *is* read off the figure even for a dial, though the rest
 * of `token` is ignored — see `healthDialSpec`. It is stored there rather
 * than as a field of its own because it already means exactly the same thing
 * it means for a real token build, and `TokenBuild` exists on every figure
 * regardless of kind.
 */
export function generatedTokenSpec(figure: Figure): TokenSpec | null {
  if (figure.kind === 'dial') return healthDialSpec(figure.token.twoSided);
  return figure.token.enabled ? tokenSpecOf(figure.token) : null;
}

/**
 * Kinds that are a generated token by default.
 *
 * A token and a game piece *are* the flat prism this builds, so the build is on
 * the moment one is added rather than a switch to find. A figure is a sculpt and
 * a dial is its own fixed model, so neither starts as a token.
 */
export function tokenByDefault(kind: FigureKind): boolean {
  return kind === 'token' || kind === 'piece';
}

export interface Figure {
  readonly id: FigureId;
  name: string;
  kind: FigureKind;
  /** The character this stands for, when it stands for one. */
  characterId: CharacterId | null;
  /** How many are needed in the box. */
  quantity: number;
  /** Reference image — a render, a photo, or concept art. */
  reference: Artwork;
  model: ModelFile | null;
  /**
   * A Tabletop Simulator saved object, stored as its own text.
   *
   * Kept raw rather than parsed into fields of our own: the file has a great
   * deal in it that this app has no opinion about — transforms, GUIDs, snap
   * points — and round-tripping it whole is the only way to be sure none of
   * that is lost. See `models/tts.ts`.
   */
  ttsSave: ModelFile | null;
  /** A generated piece, built from the reference image. */
  token: TokenBuild;
  /**
   * The health dial's range. The dial counts between these, starting full;
   * written into the shipped saved object's script on export. Only a `dial`
   * uses it.
   */
  dialRange: DialRange;
  notes: string;
  readonly createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface DialRange {
  min: number;
  max: number;
}

export function createDialRange(): DialRange {
  return { min: 0, max: 20 };
}

export function createFigure(kind: FigureKind = 'figure', name = ''): Figure {
  const timestamp = now();
  return {
    id: createId<FigureId>('fig'),
    name,
    kind,
    characterId: null,
    quantity: 1,
    reference: createArtwork(),
    model: null,
    ttsSave: null,
    token: createTokenBuild(tokenByDefault(kind)),
    dialRange: createDialRange(),
    notes: '',
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

/**
 * A figure's shown name.
 *
 * `ownerName` is what makes a dial default to "{character}'s health dial" — the
 * component is always *for* a figure, so once one is assigned its name follows
 * rather than staying "Untitled health dial". Absent it, the generic default.
 */
export function figureLabel(figure: Figure, ownerName: string | null = null): string {
  if (figure.name.trim().length > 0) return figure.name;
  if (figure.kind === 'dial' && ownerName && ownerName.trim().length > 0) {
    return `${ownerName}'s health dial`;
  }
  return `Untitled ${FIGURE_KIND_LABELS[figure.kind].toLowerCase()}`;
}
