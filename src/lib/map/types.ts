/**
 * The adventure map: spaces, and the paths between them.
 *
 * ## The one coordinate that matters
 *
 * Everything positional is a fraction of the map's **width**, including `y`.
 * Not of its own axis — of the width, both times. That is what keeps a space
 * circular: store `y` as a fraction of height and a 7.5%-wide space becomes an
 * ellipse the moment the map is not square, and every path meets it at the
 * wrong point.
 *
 * So `x` runs 0..1 and `y` runs 0..(1 / aspect). The board is one unit wide by
 * construction, which is also exactly what `cqw` gives the renderer for free.
 *
 * ## Where the numbers came from
 *
 * Measured off a printed Adventures map (Martian Invader, McMinnville OR) by
 * Hough-detecting its spaces and then profiling each one radially — 42 spaces,
 * radius standard deviation 1.6px on a 124px diameter, so the printed spaces
 * really are one size:
 *
 *   aspect              1.447        (13:9 is 1.444)
 *   space diameter      7.57% of the map's width
 *   the map is          13.2 x 9.1 space-diameters
 *   space outline       2.9% of a space's diameter
 *
 * The 13.2 and 9.1 are almost certainly a designed 13 x 9 — the sample is a
 * photograph of a printed mat and carries a worn edge outside the play area,
 * which is enough to explain the 1.6%. `DEFAULT_SPACE_DIAMETER` therefore takes
 * the *measured* fraction rather than 1/13: it is what was actually read off
 * the board, and a map that disagrees with the artwork behind it is worse than
 * one that disagrees with a round number.
 */
import type { Fill } from '$lib/cards/style';
import { solid } from '$lib/cards/style';
import type { Artwork } from '$lib/core/artwork';
import { createArtwork } from '$lib/core/artwork';
import type { Id } from '$lib/core/id';
import { createId } from '$lib/core/id';
/* Straight from the geometry module rather than via `renderer/index`, so the
   model does not pull the card faces in behind it — same as `threat/types.ts`. */
import { THREAT_TRACK } from '$lib/renderer/geometry';

export type MapSpaceId = Id<'MapSpace'>;
export type MapPathId = Id<'MapPath'>;

/** Which side of the rim a start marker sits on. */
export type MapStartSide = 'top' | 'right' | 'bottom' | 'left';

export type MapSize = 'small' | 'medium' | 'large';

/**
 * A board's shape, as one of three named presets rather than a free-form
 * width and height an author dials in by hand — there is no ruler to hold
 * an arbitrary pixel count to the way `DEFAULT_SPACE_DIAMETER` below is
 * held to the printed sample, so a fixed set of known shapes is what
 * a "size" control here can actually mean.
 *
 * `width`/`height` are the **exported PNG's own pixel dimensions**, not a
 * physical size — the board's physical printed width is `MAP_WIDTH_MM`,
 * the same for every preset so the map still lines up with the threat
 * track sitting above it (see there). Picking a size changes the board's
 * *shape* (its aspect ratio, so `mapHeightMm` prints a different height off
 * the same fixed width) and how many pixels that shape rasterises to; it
 * does not change how wide the board prints.
 */
export const MAP_SIZES: Readonly<Record<MapSize, { width: number; height: number }>> = {
  small: { width: 1337, height: 742 },
  medium: { width: 1337, height: 866 },
  large: { width: 1637, height: 1131 }
} as const;

/**
 * Width ÷ height of the `large` preset, 1.4475 — close to but not the same
 * as the 1.447 measured off the printed sample this file's own header
 * describes (13:9, 1.444, is the "designed" reading of that measurement).
 * `large` is a fixed export-pixel choice rather than a re-derivation of
 * that measurement, so the two are allowed to differ by this little; every
 * map's own default follows `large` by construction (see
 * `createAdventureMap`), so there is only one fallback to reason about.
 */
export const DEFAULT_MAP_ASPECT = MAP_SIZES.large.width / MAP_SIZES.large.height;

/**
 * The board's printed width, in millimetres.
 *
 * Taken from the threat track rather than chosen, because on the printed game
 * they are not two components — the track sits along the top of the map and the
 * two are one board. So the map's width is not free: it is the track's, and a
 * map that picked its own would print as a step.
 *
 * Derived rather than copied so the two cannot drift. Nothing renders the
 * combined board yet; this is here now so that adding it later is an addition
 * rather than a migration.
 */
export const MAP_WIDTH_MM = THREAT_TRACK.mm.width;

/** Printed height of the map alone, from its aspect. */
export function mapHeightMm(map: AdventureMap): number {
  return MAP_WIDTH_MM / (map.aspect || DEFAULT_MAP_ASPECT);
}

/** Printed height of map and threat track stacked — the whole playing surface. */
export function boardHeightMm(map: AdventureMap): number {
  return mapHeightMm(map) + THREAT_TRACK.mm.height;
}

/** The exported PNG's own pixel width, for this map's chosen `size`. */
export function mapPrintWidth(map: AdventureMap): number {
  return MAP_SIZES[map.size].width;
}

/** Space diameter as a fraction of the map's width. Measured: 0.0757. */
export const DEFAULT_SPACE_DIAMETER = 0.0757;

/** Space outline weight, as a fraction of a space's diameter. Measured: 0.029. */
export const DEFAULT_SPACE_STROKE = 0.029;

/**
 * Path weight, as a fraction of a space's diameter.
 *
 * Heavier than the outline on the printed board, because a path has to read as
 * a route at a glance from across a table while an outline only has to contain
 * a colour.
 */
export const DEFAULT_PATH_WIDTH = 0.055;

/**
 * A space on the map.
 *
 * `zones` is a list rather than a single fill, and that is the printed board's
 * doing: a space that sits on the border of two areas is drawn as a circle cut
 * into wedges, one per area. Two, three and four-way splits all appear on the
 * sample. One entry is the ordinary case and draws a plain disc, so the list
 * costs nothing until it is needed.
 */
export interface MapSpace {
  readonly id: MapSpaceId;
  /** Fraction of the map's width. */
  x: number;
  /** Also a fraction of the map's **width** — see the note at the top. */
  y: number;
  /** One fill per wedge, clockwise from twelve o'clock. Never empty. */
  zones: Fill[];
  /** Outline colour, or `null` to take the board's. */
  stroke: string | null;
  /**
   * A number or letter printed inside the space. Empty for most of them.
   */
  label: string;
  /**
   * Which player starts here, 1–5, or `null` for an ordinary space.
   *
   * Drawn as a small diamond sitting *on* the rim rather than inside the
   * circle, which is where the printed board puts it — inside would compete
   * with the space's own colour and with `label`, and the whole point of the
   * marker is that it reads from across the table without obscuring the space.
   */
  start: number | null;
  /**
   * Which side of the rim the marker sits on. Only meaningful while `start`
   * is set. A start space can fall on any edge of the board, so this is
   * per-space rather than a single map-wide direction.
   */
  startSide: MapStartSide;
  /**
   * Degrees clockwise, applied to `zones`' own wedges before they are drawn
   * — see `MapBoard.svelte`'s `wedge()`. `label`/`start`'s own diamond are
   * unaffected: a rotated space still reads its number upright and still
   * starts its marker from the side it was told to, only the coloured split
   * itself turns. Meaningless (and hidden in the editor) while `zones` is a
   * single plain fill, since a circle has no seam to turn.
   */
  rotation: number;
  /** Author's note. Never printed. */
  notes: string;
}

/**
 * A route between two spaces.
 *
 * Undirected: the printed board draws one line and a figure moves along it
 * either way. Stored as an unordered pair, so the editor has to guard against
 * adding the same link twice — see `pathExists`.
 */
export interface MapPath {
  readonly id: MapPathId;
  from: MapSpaceId;
  to: MapSpaceId;
}

export type MapNoteId = Id<'MapNote'>;

/**
 * Free copy placed by hand on the board — a region name, a rules reminder.
 *
 * Deliberately the same shape as `ThreatNote`, down to the field names: the
 * two are the same idea on two boards, and an author who has learnt one has
 * learnt the other. Positions follow the map's own convention — fractions of
 * the **width**, both axes — rather than the threat board's 0..1 of each side,
 * because a note has to stay put relative to the spaces around it.
 */
export interface MapNote {
  readonly id: MapNoteId;
  text: string;
  /** Fraction of the map's width. */
  x: number;
  /** Also a fraction of the map's **width** — see the note at the top. */
  y: number;
  /** Type size, as a percentage of the map's width. */
  size: number;
  /** Turn, in degrees clockwise. 0 is level. */
  rotation: number;
  color: string;
}

export function createMapNote(text = ''): MapNote {
  return {
    id: createId<MapNoteId>('mapnote'),
    text,
    x: 0.4,
    y: 0.1,
    size: 2.2,
    rotation: 0,
    color: '#f5f2ec'
  };
}

export interface AdventureMap {
  enabled: boolean;
  name: string;
  /**
   * Which of `MAP_SIZES` this board is exported at. Setting it also sets
   * `aspect` to match — see `size`'s own picker in `MapEditor.svelte` — but
   * the two are stored separately rather than `aspect` being derived at
   * read time, so a document written before `size` existed keeps the exact
   * `aspect` it always had (see `sets/normalize.ts`) instead of being
   * snapped to whichever preset happens to read closest.
   */
  size: MapSize;
  /** Width ÷ height. The artwork behind it should match, or it letterboxes. */
  aspect: number;
  /** The painted board. Everything else is drawn over it. */
  artwork: Artwork;
  /** Shown where the artwork does not reach, and behind a map with none. */
  background: Fill;
  /** Diameter as a fraction of the map's width — one size for every space. */
  spaceDiameter: number;
  spaceStroke: string;
  /**
   * Not part of `palette`/the "colours used" swatch, on purpose: that
   * swatch used to include this by simply reading it off the board like
   * every space's own fill, and the very first time it happened to land on
   * the same default as `spaceStroke`, repicking "the space outline"
   * silently recoloured every path too — the two had been folded into one
   * swatch entry because they shared a value, not because an author asked
   * to change them together. Its own picker sits beside "Behind the
   * artwork" instead, so recolouring paths is always a deliberate,
   * separate choice.
   */
  pathColor: string;
  /** Colour of the numeral printed on a start marker's diamond. */
  startInk: string;
  /**
   * Colours an author has explicitly added to the "Colour this space"
   * swatch, over and above whatever `usedColors` (in `MapEditor.svelte`)
   * already finds by reading the board — the "+" swatch appends here. Kept
   * even once nothing on the board uses them any more: adding one is a
   * deliberate choice to keep it on hand, not a record of the board's
   * current state the way `usedColors` is, so nothing here prunes it back.
   */
  palette: string[];
  spaces: MapSpace[];
  paths: MapPath[];
  /** Free copy, placed by hand anywhere on the board. */
  notes: MapNote[];
}

export function createMapSpace(x: number, y: number, fill?: Fill): MapSpace {
  return {
    id: createId<MapSpaceId>('space'),
    x,
    y,
    zones: [fill ?? solid('#cfd3d6')],
    stroke: null,
    label: '',
    start: null,
    startSide: 'top',
    rotation: 0,
    notes: ''
  };
}

export function createMapPath(from: MapSpaceId, to: MapSpaceId): MapPath {
  return { id: createId<MapPathId>('path'), from, to };
}

export function createAdventureMap(): AdventureMap {
  return {
    enabled: false,
    name: '',
    size: 'large',
    aspect: DEFAULT_MAP_ASPECT,
    artwork: createArtwork(),
    background: solid('#2c2a26'),
    spaceDiameter: DEFAULT_SPACE_DIAMETER,
    spaceStroke: '#101010',
    pathColor: '#101010',
    startInk: '#f5f2ec',
    palette: [],
    spaces: [],
    paths: [],
    notes: []
  };
}

/** Height of the board in the same unit `x` and `y` use — fractions of width. */
export function mapHeight(map: AdventureMap): number {
  return 1 / (map.aspect || DEFAULT_MAP_ASPECT);
}

export function findSpace(map: AdventureMap, id: MapSpaceId | null): MapSpace | null {
  if (id === null) return null;
  return map.spaces.find((space) => space.id === id) ?? null;
}

/** Undirected, so a link is a duplicate whichever end it was drawn from. */
export function pathExists(map: AdventureMap, from: MapSpaceId, to: MapSpaceId): boolean {
  return map.paths.some(
    (path) =>
      (path.from === from && path.to === to) || (path.from === to && path.to === from)
  );
}

/** Every space a given one connects to. Drives the editor's selection readout. */
export function neighbours(map: AdventureMap, id: MapSpaceId): MapSpaceId[] {
  const found: MapSpaceId[] = [];
  for (const path of map.paths) {
    if (path.from === id) found.push(path.to);
    else if (path.to === id) found.push(path.from);
  }
  return found;
}

/**
 * Spaces nothing connects to.
 *
 * A map is a graph before it is a picture, and an unreachable space is the one
 * error that looks completely fine — it draws exactly like every other space.
 * Surfacing it is cheaper than playtesting it.
 */
export function orphanSpaces(map: AdventureMap): MapSpace[] {
  const linked = new Set<MapSpaceId>();
  for (const path of map.paths) {
    linked.add(path.from);
    linked.add(path.to);
  }
  return map.spaces.filter((space) => !linked.has(space.id));
}
