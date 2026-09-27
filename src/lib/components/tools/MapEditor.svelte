<script lang="ts">
  /**
   * The map editor.
   *
   * The board itself is `MapBoard`, read-only, with every authoring affordance
   * laid over it here. That separation is the export boundary: pan/zoom,
   * screen-sized hit targets, selection rings and move handles must never be
   * able to alter the photographed map geometry.
   *
   * Touch editing is intentionally stateful. Navigate owns one-finger pan and
   * pinch; authoring modes only mutate after an explicit Add or Move action.
   * This is a little more ceremony than desktop click-and-drag, but it is what
   * keeps a scroll, pinch or interrupted pointer from becoming document data.
   */
  import { tick } from 'svelte';
  import { analyseMap } from '$lib/analysis/map';
  import MapBoard from '$lib/renderer/MapBoard.svelte';
  import { solid } from '$lib/cards/style';
  import { createArtwork, hasArtwork } from '$lib/core/artwork';
  import { readArtworkFile } from '$lib/core/image-import';
  import { photographMapBoard, saveExport, slugify } from '$lib/export';
  import { startPointerSession } from '$lib/interaction/pointer-session';
  import type { PointerSession, PointerSessionCancelReason } from '$lib/interaction/pointer-session';
  import {
    createMapNote,
    createMapEnvironmentPiece,
    createMapPath,
    createMapSecretPassage,
    createMapSpace,
    createMapZoneStyle,
    DEFAULT_SECRET_PASSAGE_COLOR,
    DEFAULT_SECRET_PASSAGE_FADE,
    findPath,
    findSpace,
    isAutoLargeFighterPath,
    LARGE_FIGHTER_CENTRE_THRESHOLD_MM,
    mapHeight,
    mapHeightMm,
    mapPrintSize,
    MAP_SIZES,
    MAP_WIDTH_MM,
    neighbours,
    pathExists,
    pathCentreDistanceMm,
    showsLargeFighterMarker,
    spaceZoneColors,
    zoneStyleFor
  } from '$lib/map/types';
  import type {
    AdventureMapId,
    MapEnvironmentPiece,
    MapEnvironmentPieceId,
    MapLabelCorner,
    MapNote,
    MapNoteId,
    MapSecretPassage,
    MapSize,
    MapSpaceId,
    MapStartSide,
    MapZoneStyle
  } from '$lib/map/types';
  import { PATTERN_NAMES, patternAspect, patternUrl } from '$lib/renderer/assets';
  import type { SetId } from '$lib/sets/types';
  import { customSymbolLabel } from '$lib/symbols/types';
  import { workshop } from '$lib/state/workshop.svelte';
  import {
    Button,
    ConfirmAction,
    EmptyState,
    HexInput,
    Icon,
    Slider,
    Switch,
    TextInput
  } from '$lib/ui';

  const set = $derived(workshop.adventure);
  const map = $derived(
    set.maps.find((entry) => entry.id === workshop.mapEditingId) ?? set.maps[0]!
  );
  /** What the export will actually produce — a preset's own row, or solved
      from `aspect` on `custom`. See `mapPrintSize`. */
  const printSize = $derived(mapPrintSize(map));

  const LABEL_CORNERS: ReadonlyArray<{
    value: MapLabelCorner;
    label: string;
    symbol: string;
  }> = [
    { value: 'top-left', label: 'Top left', symbol: '↖' },
    { value: 'top-right', label: 'Top right', symbol: '↗' },
    { value: 'bottom-left', label: 'Bottom left', symbol: '↙' },
    { value: 'bottom-right', label: 'Bottom right', symbol: '↘' }
  ];

  type Mode = 'navigate' | 'spaces' | 'link' | 'text' | 'environment';
  type MoveTarget =
    | { kind: 'space'; id: MapSpaceId }
    | { kind: 'note'; id: MapNoteId }
    | { kind: 'environment'; id: MapEnvironmentPieceId };
  type ViewGesture =
    | {
        kind: 'pan';
        pointerId: number;
        startClientX: number;
        startClientY: number;
        startX: number;
        startY: number;
      }
    | {
        kind: 'pinch';
        pointerIds: [number, number];
        startDistance: number;
        startCentreX: number;
        startCentreY: number;
        startScale: number;
        startX: number;
        startY: number;
      };

  let mode = $state<Mode>('navigate');
  let interactionRevision = 0;
  let selectMultiple = $state(false);
  let placementArmed = $state<'space' | 'text' | null>(null);
  let moveTarget = $state<MoveTarget | null>(null);
  let movingTarget = $state<MoveTarget | null>(null);
  let pointerSession: PointerSession | null = null;
  let artworkView = $state(false);
  /** Construction aid, never exported — see the toggle beside the modes. */
  let showNumbers = $state(false);
  /** The space the detail editor shows — always a member of `colorSelection` while it is non-empty. */
  let selected = $state<MapSpaceId | null>(null);
  /**
   * Every space a "Quick colour" swatch would paint. Kept in sync with
   * `selected` rather than derived from it, so more than one space can be
   * selected for colouring at once (see `selectSpace`) while the detail
   * editor below — label, connections, split, zone swatches — still only
   * ever has to make sense for the single space `selected` names.
   */
  let colorSelection = $state<Set<MapSpaceId>>(new Set());
  /** Which colour zone the "Zones" column's pattern editor is open on —
      independent of `selected`/`colorSelection`, which name a *space*. A
      zone is a colour, not a space, so it needs its own selection. */
  let selectedZoneColor = $state<string | null>(null);
  let linkFrom = $state<MapSpaceId | null>(null);
  let viewport = $state<HTMLDivElement | null>(null);
  let board = $state<HTMLDivElement | null>(null);
  let viewScale = $state(1);
  let viewX = $state(0);
  let viewY = $state(0);
  let viewGesture: ViewGesture | null = null;
  let pointerKeptForPinch: number | null = null;
  const viewPointers = new Map<number, { x: number; y: number }>();
  let artInput = $state<HTMLInputElement | null>(null);
  let artError = $state<string | null>(null);
  let sizeOperation = 0;
  let artworkOperation = 0;
  let zonePatternOperation = 0;
  let environmentOperation = 0;
  let disposed = false;
  let confirmingMapDelete = $state(false);
  let observedSetId: SetId | null = null;
  let observedMapId: AdventureMapId | null = null;

  $effect(() => {
    if (!set.maps.some((entry) => entry.id === workshop.mapEditingId)) {
      const first = set.maps[0];
      if (first) workshop.selectMapForEditing(first.id);
    }
  });

  function invalidateAsyncMapOperations(): void {
    sizeOperation += 1;
    artworkOperation += 1;
    zonePatternOperation += 1;
    environmentOperation += 1;
  }

  function isCurrentMap(setId: SetId, mapId: AdventureMapId): boolean {
    return !disposed && set.id === setId && workshop.mapEditingId === mapId;
  }

  function resetMapSelections(): void {
    interactionRevision += 1;
    cancelPointerSession('mode-change');
    finishEnvironmentReorder();
    invalidateAsyncMapOperations();
    mode = 'navigate';
    selected = null;
    colorSelection = new Set();
    selectedZoneColor = null;
    linkFrom = null;
    selectedNote = null;
    selectedEnvironment = null;
    placementArmed = null;
    moveTarget = null;
    selectMultiple = false;
    artworkView = false;
    replacingEnvironment = null;
    reorderingEnvironment = null;
    environmentDrop = null;
    zonePatternError = null;
    environmentError = null;
    artError = null;
  }

  /* Map IDs deliberately survive a fork, so map identity alone cannot detect
     an external set switch. Reset transient state whenever either half of the
     editor identity changes, including switches initiated outside this page. */
  $effect(() => {
    const nextSetId = set.id;
    const nextMapId = map.id;
    if (observedSetId === null && observedMapId === null) {
      observedSetId = nextSetId;
      observedMapId = nextMapId;
      return;
    }
    if (nextSetId === observedSetId && nextMapId === observedMapId) return;
    observedSetId = nextSetId;
    observedMapId = nextMapId;
    confirmingMapDelete = false;
    resetMapSelections();
    resetView();
  });

  function selectMap(mapId: AdventureMapId): void {
    if (mapId === map.id) return;
    cancelPointerSession('mode-change');
    workshop.selectMapForEditing(mapId);
    confirmingMapDelete = false;
    resetMapSelections();
    resetView();
  }

  function addMap(): void {
    const mapId = workshop.addMap();
    workshop.selectMapForEditing(mapId);
    confirmingMapDelete = false;
    resetMapSelections();
    resetView();
  }

  function removeCurrentMap(): void {
    if (!confirmingMapDelete) {
      confirmingMapDelete = true;
      return;
    }
    if (workshop.removeMap(map.id)) {
      resetMapSelections();
      resetView();
    }
    confirmingMapDelete = false;
  }
  let paletteInput = $state<HTMLInputElement | null>(null);
  let exporting = $state(false);
  let exportError = $state<string | null>(null);
  let selectedNote = $state<MapNoteId | null>(null);

  const START_SIDES: { value: MapStartSide; label: string }[] = [
    { value: 'top', label: 'Top' },
    { value: 'right', label: 'Right' },
    { value: 'bottom', label: 'Bottom' },
    { value: 'left', label: 'Left' }
  ];

  const SIZES: { value: MapSize; label: string }[] = [
    { value: 'small', label: 'Small' },
    { value: 'medium', label: 'Medium' },
    { value: 'large', label: 'Large' },
    { value: 'custom', label: 'Custom' }
  ];

  /**
   * An image's own width ÷ height, or `null` for anything that will not load.
   *
   * `onload` rather than `decode()`, which can stall indefinitely in a
   * backgrounded tab — the trap `core/image-import.ts` and `card-image.ts` both
   * document. Called only from the two handlers below, never from a render: the
   * board's aspect is a stored number precisely so nothing has to decode a
   * multi-megabyte data URL to lay the map out.
   */
  function imageAspect(source: string): Promise<number | null> {
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () =>
        resolve(
          image.naturalWidth > 0 && image.naturalHeight > 0
            ? image.naturalWidth / image.naturalHeight
            : null
        );
      image.onerror = () => resolve(null);
      image.src = source;
    });
  }

  /**
   * Sets `aspect` to match — see the doc comment on `AdventureMap.size`.
   *
   * A preset's aspect is its own. `custom` has none of its own, so it takes the
   * artwork's; with no artwork attached it keeps whatever aspect the board
   * already had, which is the only non-destructive answer — snapping to a
   * default would throw away the shape an author had already arrived at, and
   * every space on the board is positioned against it.
   */
  async function setSize(size: MapSize): Promise<void> {
    const operation = ++sizeOperation;
    if (size !== 'custom') {
      cancelPointerSession('mode-change');
      finishEnvironmentReorder();
      workshop.editMap((m) => {
        m.size = size;
        const preset = MAP_SIZES[size];
        m.aspect = preset.width / preset.height;
      });
      onViewportChange();
      return;
    }

    const setId = set.id;
    const mapId = map.id;
    const source = map.artwork.source;
    const aspect = source ? await imageAspect(source) : null;
    if (
      !isCurrentMap(setId, mapId) ||
      operation !== sizeOperation ||
      map.artwork.source !== source
    ) return;
    cancelPointerSession('mode-change');
    finishEnvironmentReorder();
    workshop.editMap((m) => {
      m.size = 'custom';
      if (aspect !== null) m.aspect = aspect;
    });
    onViewportChange();
  }

  /**
   * Every distinct colour in use anywhere on the board, in first-seen order.
   *
   * Most spaces of one kind — water, say — share a colour on the printed
   * sample, so this is what lets one of them be repicked once rather than
   * hunted down across however many spaces happen to share it. Three
   * things this deliberately leaves out:
   *
   * - The start-marker numeral's own colour: it prints on a diamond rather
   *   than the board itself, and has its own picker beside "Marker side" in
   *   the selected space's own panel, where an author is already looking
   *   when they place one.
   * - `map.pathColor` and `map.spaceStroke`: both used to be read here like
   *   every space's own fill, and the first time `pathColor` happened to
   *   share `spaceStroke`'s own default, repicking "the space outline"
   *   silently recoloured every path too — the two had folded into one
   *   swatch entry because they shared a value, not because an author asked
   *   to change them together. Neither is offered here any more; both stay
   *   at their printed default.
   */
  const usedColors = $derived.by(() => {
    const seen = new Set<string>();
    const order: string[] = [];
    const add = (color: string | null) => {
      if (!color) return;
      const key = color.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      order.push(color);
    };
    add(map.background.color);
    for (const space of map.spaces) {
      add(space.stroke);
      for (const zone of space.zones) add(zone.color);
    }
    for (const note of map.notes) add(note.color);
    return order;
  });

  /**
   * `usedColors` plus whatever an author has added by hand via the "+"
   * swatch (`map.palette`) — what "Colour this space" actually offers.
   * `usedColors` alone would cap the swatch at whatever already happens to
   * be on the board, which is exactly the five-or-so colours too few an
   * author starting a new region runs into.
   */
  const paletteColors = $derived.by(() => {
    const seen = new Set(usedColors.map((color) => color.toLowerCase()));
    const extra = map.palette.filter((color) => {
      const key = color.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return [...usedColors, ...extra];
  });

  /** Add a colour to `map.palette`, unless it is already offered. */
  function addToPalette(color: string): void {
    const key = color.toLowerCase();
    if (paletteColors.some((existing) => existing.toLowerCase() === key)) return;
    workshop.editMap((m) => m.palette.push(color));
  }

  /**
   * Change every use of `from` to `to` in one go — what a swatch in
   * `usedColors` actually does when repicked, rather than only changing the
   * one place a plain colour input would.
   *
   * Case-insensitive match, since a colour picked once and one typed by
   * hand into an older document can differ only in letter case and still be
   * the same colour to look at.
   */
  function recolor(from: string, to: string): void {
    zonePatternOperation += 1;
    const key = from.toLowerCase();
    workshop.editMap((m) => {
      if (m.background.color.toLowerCase() === key) m.background = solid(to);
      for (const space of m.spaces) {
        if (space.stroke && space.stroke.toLowerCase() === key) space.stroke = to;
        space.zones = space.zones.map((zone) =>
          zone.color.toLowerCase() === key ? { ...zone, color: to } : zone
        );
      }
      for (const note of m.notes) {
        if (note.color.toLowerCase() === key) note.color = to;
      }
      /* A zone's pattern is keyed by colour (see `MapZoneStyle`'s own doc
         comment) — repainting every wedge that had it without also renaming
         this would leave the pattern behind under a colour nothing on the
         board uses any more, orphaned rather than following the zone an
         author clearly still means. */
      for (const zone of m.zoneStyles) {
        if (zone.color.toLowerCase() === key) zone.color = to;
      }
    });
    if (selectedZoneColor && selectedZoneColor.toLowerCase() === key) selectedZoneColor = to;
  }

  const MODES: { value: Mode; label: string; hint: string }[] = [
    {
      value: 'navigate',
      label: 'Navigate',
      hint: 'Drag to pan and pinch to zoom without changing the map.'
    },
    {
      value: 'spaces',
      label: 'Spaces',
      hint: 'Select spaces here. Add Space and Move are deliberate one-action tools.'
    },
    { value: 'link', label: 'Link', hint: 'Choose two endpoints. The same pair unlinks.' },
    { value: 'text', label: 'Text', hint: 'Select text here. Add Text and Move are deliberate.' },
    {
      value: 'environment',
      label: 'Environment',
      hint: 'Select scenery here. Move it only after choosing Move.'
    }
  ];

  const topology = $derived(analyseMap(map));
  const selectedSpace = $derived(findSpace(map, selected));
  const selectedNoteEntry = $derived(
    map.notes.find((note) => note.id === selectedNote) ?? null
  );
  const selectedPortalSymbol = $derived(
    selectedSpace?.secretPassage?.symbolId
      ? set.customSymbols.find((symbol) => symbol.id === selectedSpace?.secretPassage?.symbolId) ?? null
      : null
  );
  const secretPassageColors = $derived.by(() => {
    const colours: string[] = [];
    const seen = new Set<string>();
    for (const space of map.spaces) {
      const colour = space.secretPassage?.color;
      if (!colour) continue;
      const key = colour.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      colours.push(colour);
    }
    return colours;
  });

  function topologySpaceLabel(space: { number: number; label: string }): string {
    return space.label ? `${space.label} (Space ${space.number})` : `Space ${space.number}`;
  }

  function topologySpaceList(spaces: ReadonlyArray<{ number: number; label: string }>): string {
    return spaces.map(topologySpaceLabel).join(', ');
  }

  /**
   * Select one space, or fold it into the running colour-selection.
   *
   * A plain click always means "just this one" — it replaces
   * `colorSelection` outright, the same as it always implicitly did before
   * there was a `colorSelection` to speak of. `additive` (a shift-click)
   * toggles membership instead: added spaces become `selected` too, so the
   * detail editor follows whichever was picked last; removing the space
   * that was `selected` hands the editor to another member of what is left,
   * or empties it out once none remain.
   */
  function selectSpace(id: MapSpaceId, additive: boolean): void {
    interactionRevision += 1;
    selectedEnvironment = null;
    selectedNote = null;
    if (!additive) {
      if (moveTarget?.kind !== 'space' || moveTarget.id !== id) moveTarget = null;
      selected = id;
      colorSelection = new Set([id]);
      return;
    }
    moveTarget = null;
    const next = new Set(colorSelection);
    if (next.delete(id)) {
      if (selected === id) {
        const [remaining] = next;
        selected = remaining ?? null;
      }
    } else {
      next.add(id);
      selected = id;
    }
    colorSelection = next;
  }

  function clearSelection(): void {
    interactionRevision += 1;
    selected = null;
    colorSelection = new Set();
    if (moveTarget?.kind === 'space') moveTarget = null;
  }

  function selectNote(id: MapNoteId | null): void {
    interactionRevision += 1;
    selectedNote = id;
    selectedEnvironment = null;
    clearSelection();
    if (!id || moveTarget?.kind !== 'note' || moveTarget.id !== id) moveTarget = null;
  }

  /**
   * Colour every zone of every space in `ids` the same picked colour — "the
   * space's colour" as a whole, whatever it is currently split into, not
   * just its first wedge.
   */
  function applyColorToSpaces(color: string, ids: Iterable<MapSpaceId>): void {
    const idSet = new Set(ids);
    if (idSet.size === 0) return;
    zonePatternOperation += 1;
    workshop.editMap((m) => {
      for (const space of m.spaces) {
        if (!idSet.has(space.id)) continue;
        space.zones = space.zones.map(() => solid(color));
      }
    });
  }

  /**
   * Colour one wedge of a split space, from the same palette "Colour this
   * space" reads — a space with more than one zone has no single colour of
   * its own for that swatch to mean any more, so each wedge gets its own
   * click-to-set row instead of author having to fall back to the eyedropper
   * to match one zone's colour to another's.
   */
  function applyColorToZone(color: string, index: number): void {
    if (!selectedSpace) return;
    const zone = selectedSpace.zones[index];
    if (!zone) return;
    zonePatternOperation += 1;
    workshop.editMap(() => {
      selectedSpace.zones[index] = { ...zone, color };
    });
  }

  /** Every colour zone on the board, with how many wedges belong to it —
      "Zones" column stats. Recomputed from the spaces themselves, same as
      `usedColors`, rather than trusting `map.zoneStyles` to list them: a
      colour is a zone whether or not it has a pattern yet. */
  const zones = $derived(spaceZoneColors(map));
  const selectedZone = $derived(selectedZoneColor ? zoneStyleFor(map, selectedZoneColor) : null);

  /**
   * Write one field of the selected zone's pattern, creating its
   * `zoneStyles` entry on first use — `zoneStyles` is sparse (see its own
   * doc comment), so most zones have nothing here until an author actually
   * picks a pattern for one.
   */
  function patchZone(color: string, patch: Partial<MapZoneStyle>): void {
    workshop.editMap((m) => {
      const existing = m.zoneStyles.find((z) => z.color.toLowerCase() === color.toLowerCase());
      if (existing) {
        Object.assign(existing, patch);
      } else {
        m.zoneStyles.push({ ...createMapZoneStyle(color), ...patch });
      }
    });
  }

  /** Choosing a built-in pattern always clears a custom one, and the other
      way round — "Pattern" and "Custom pattern" are one choice, not two
      that could both be on at once with only the last one drawn. */
  function setZonePatternName(color: string, name: string | null): void {
    zonePatternOperation += 1;
    patchZone(color, { patternName: name, customSource: null, customLabel: '' });
  }

  /**
   * Back to "no pattern" — removes the `zoneStyles` entry outright rather
   * than leaving one behind with both `patternName` and `customSource`
   * `null`, keeping the sparse-by-default discipline the rest of this
   * document already follows.
   */
  function clearZonePattern(color: string): void {
    zonePatternOperation += 1;
    workshop.editMap((m) => {
      m.zoneStyles = m.zoneStyles.filter((z) => z.color.toLowerCase() !== color.toLowerCase());
    });
  }

  let zonePatternInput = $state<HTMLInputElement | null>(null);
  let zonePatternError = $state<string | null>(null);
  let environmentInput = $state<HTMLInputElement | null>(null);
  let environmentError = $state<string | null>(null);
  let selectedEnvironment = $state<MapEnvironmentPieceId | null>(null);
  let replacingEnvironment = $state<MapEnvironmentPieceId | null>(null);
  let reorderingEnvironment = $state<MapEnvironmentPieceId | null>(null);
  let environmentReorderPointerId: number | null = null;
  let environmentDrop = $state<{
    id: MapEnvironmentPieceId;
    position: 'before' | 'after';
  } | null>(null);
  const selectedEnvironmentPiece = $derived(
    map.environment.find((piece) => piece.id === selectedEnvironment) ?? null
  );

  /** Space and scene-piece controls share one inspector. Keeping the two
      selections exclusive prevents a stale space editor sitting behind the
      environment editor and makes the heading always describe what is active. */
  function selectEnvironment(id: MapEnvironmentPieceId | null): void {
    interactionRevision += 1;
    selectedEnvironment = id;
    selectedNote = null;
    if (id) clearSelection();
    if (!id || moveTarget?.kind !== 'environment' || moveTarget.id !== id) moveTarget = null;
  }

  async function pickZonePattern(event: Event & { currentTarget: HTMLInputElement }): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || !selectedZoneColor) return;
    const operation = ++zonePatternOperation;
    const setId = set.id;
    const mapId = map.id;
    const color = selectedZoneColor;

    zonePatternError = null;
    try {
      const source = await readArtworkFile(file);
      if (
        !isCurrentMap(setId, mapId) ||
        operation !== zonePatternOperation ||
        !spaceZoneColors(map).some((zone) => zone.color.toLowerCase() === color.toLowerCase())
      ) return;
      cancelPointerSession('mode-change');
      finishEnvironmentReorder();
      patchZone(color, { patternName: null, customSource: source, customLabel: file.name });
    } catch (cause) {
      if (
        !isCurrentMap(setId, mapId) ||
        operation !== zonePatternOperation ||
        !spaceZoneColors(map).some((zone) => zone.color.toLowerCase() === color.toLowerCase())
      ) return;
      zonePatternError = cause instanceof Error ? cause.message : 'Could not read that file.';
    }
  }

  /**
   * Pointer position in the model's own units.
   *
   * Both axes divide by the board's **width**, which is not a typo — see the
   * note in `map/types.ts`. Dividing `y` by the height instead is the bug that
   * makes a space drift further from the cursor the further down the board it
   * is placed.
   */
  function toModel(event: PointerEvent): { x: number; y: number } | null {
    if (!board) return null;
    const box = board.getBoundingClientRect();
    if (box.width === 0) return null;
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.width };
  }

  function clampModelPoint(point: { x: number; y: number }): { x: number; y: number } {
    return {
      x: Math.min(1, Math.max(0, point.x)),
      y: Math.min(mapHeight(map), Math.max(0, point.y))
    };
  }

  /**
   * The space under the pointer, or `null`.
   *
   * Printed circles can be barely 20px wide on a phone. Selection instead
   * gets a 44px screen-space diameter, converted back through the one live
   * board transform so zoom never changes the model coordinates we store.
   */
  function spaceAt(point: { x: number; y: number }): MapSpaceId | null {
    const renderedWidth = board?.getBoundingClientRect().width ?? 0;
    const radius = Math.max(map.spaceDiameter / 2, renderedWidth > 0 ? 22 / renderedWidth : 0);
    let best: MapSpaceId | null = null;
    let bestDistance = radius;
    for (const space of map.spaces) {
      const distance = Math.hypot(space.x - point.x, space.y - point.y);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = space.id;
      }
    }
    return best;
  }

  const MIN_VIEW_SCALE = 1;
  const MAX_VIEW_SCALE = 4;

  function clampView(x: number, y: number, scale: number): { x: number; y: number } {
    if (!viewport || !board) return { x, y };
    const minimumX = Math.min(0, viewport.clientWidth - board.offsetWidth * scale);
    const minimumY = Math.min(0, viewport.clientHeight - board.offsetHeight * scale);
    return {
      x: Math.min(0, Math.max(minimumX, x)),
      y: Math.min(0, Math.max(minimumY, y))
    };
  }

  function setView(x: number, y: number, scale = viewScale): void {
    const nextScale = Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, scale));
    const next = clampView(x, y, nextScale);
    viewScale = nextScale;
    viewX = next.x;
    viewY = next.y;
  }

  function resetView(): void {
    viewScale = 1;
    viewX = 0;
    viewY = 0;
    viewGesture = null;
    viewPointers.clear();
  }

  function zoomView(nextScale: number): void {
    if (!viewport) return;
    const scale = Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, nextScale));
    const anchorX = viewport.clientWidth / 2;
    const anchorY = viewport.clientHeight / 2;
    const modelX = (anchorX - viewX) / viewScale;
    const modelY = (anchorY - viewY) / viewScale;
    setView(anchorX - modelX * scale, anchorY - modelY * scale, scale);
  }

  function cancelPointerSession(
    reason: PointerSessionCancelReason,
    preservePointerForPinch = reason === 'second-pointer'
  ): void {
    const active = pointerSession;
    pointerSession = null;
    if (preservePointerForPinch && active) pointerKeptForPinch = active.pointerId;
    active?.cancel(reason);
    movingTarget = null;
  }

  function stopViewGesture(): void {
    viewGesture = null;
    pointerKeptForPinch = null;
    viewPointers.clear();
  }

  function onViewportChange(): void {
    stopViewGesture();
    finishEnvironmentReorder();
    void tick().then(() => setView(viewX, viewY, viewScale));
  }

  function onPageInterruption(): void {
    stopViewGesture();
    finishEnvironmentReorder();
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') onPageInterruption();
  }

  function changeMode(next: Mode): void {
    interactionRevision += 1;
    cancelPointerSession('mode-change');
    stopViewGesture();
    finishEnvironmentReorder();
    mode = next;
    artworkView = false;
    placementArmed = null;
    moveTarget = null;
    linkFrom = null;
    replacingEnvironment = null;
    if (next !== 'spaces') selectMultiple = false;
  }

  function toggleArtworkView(): void {
    interactionRevision += 1;
    cancelPointerSession('mode-change');
    stopViewGesture();
    finishEnvironmentReorder();
    const next = !artworkView;
    if (next) invalidateAsyncMapOperations();
    artworkView = next;
    placementArmed = null;
    moveTarget = null;
    linkFrom = null;
    replacingEnvironment = null;
    confirmingMapDelete = false;
    if (artworkView) {
      mode = 'navigate';
      selectMultiple = false;
    }
  }

  function toggleMove(target: MoveTarget): void {
    interactionRevision += 1;
    cancelPointerSession('mode-change');
    finishEnvironmentReorder();
    artworkView = false;
    placementArmed = null;
    linkFrom = null;
    const same = moveTarget?.kind === target.kind && moveTarget.id === target.id;
    moveTarget = same ? null : target;
    if (!same) {
      mode = target.kind === 'space' ? 'spaces' : target.kind === 'note' ? 'text' : 'environment';
    }
  }

  function startTapOrPan(
    event: PointerEvent,
    onTap: (upEvent: PointerEvent) => void
  ): void {
    cancelPointerSession('superseded');
    const startX = viewX;
    const startY = viewY;
    pointerSession = startPointerSession(event, {
      snapshot: { startX, startY },
      cancelOnSecondPointer: false,
      onMove: (movement, _moveEvent, snapshot) => {
        setView(snapshot.startX + movement.deltaX, snapshot.startY + movement.deltaY);
      },
      onCommit: () => {
        pointerSession = null;
      },
      onCancel: () => {
        pointerSession = null;
      },
      onTap: (upEvent) => {
        pointerSession = null;
        onTap(upEvent);
      }
    });
  }

  function beginSpaceMove(event: PointerEvent, id: MapSpaceId): void {
    const point = toModel(event);
    const space = findSpace(map, id);
    if (!point || !space) return;
    cancelPointerSession('superseded');
    movingTarget = { kind: 'space', id };
    const session = startPointerSession(event, {
      snapshot: {
        id,
        x: space.x,
        y: space.y,
        offsetX: point.x - space.x,
        offsetY: point.y - space.y
      },
      cancelOnSecondPointer: false,
      onMove: (_movement, moveEvent, snapshot) => {
        const at = toModel(moveEvent);
        const current = findSpace(map, snapshot.id);
        if (!at || !current) return;
        current.x = Math.min(1, Math.max(0, at.x - snapshot.offsetX));
        current.y = Math.min(mapHeight(map), Math.max(0, at.y - snapshot.offsetY));
      },
      onCommit: () => {
        workshop.commitMapEdit();
        pointerSession = null;
        movingTarget = null;
      },
      onCancel: (_reason, _movement, snapshot) => {
        const current = findSpace(map, snapshot.id);
        if (current) {
          current.x = snapshot.x;
          current.y = snapshot.y;
        }
        workshop.cancelMapEdit();
        pointerSession = null;
        movingTarget = null;
      },
      onTap: () => {
        workshop.cancelMapEdit();
        pointerSession = null;
        movingTarget = null;
        selectSpace(id, selectMultiple);
      }
    });
    if (!session) {
      movingTarget = null;
      return;
    }
    pointerSession = session;
    workshop.beginMapEdit();
  }

  function beginNoteMove(event: PointerEvent, id: MapNoteId): void {
    const point = toModel(event);
    const note = map.notes.find((entry) => entry.id === id);
    if (!point || !note) return;
    cancelPointerSession('superseded');
    movingTarget = { kind: 'note', id };
    const session = startPointerSession(event, {
      snapshot: {
        id,
        x: note.x,
        y: note.y,
        offsetX: point.x - note.x,
        offsetY: point.y - note.y
      },
      cancelOnSecondPointer: false,
      onMove: (_movement, moveEvent, snapshot) => {
        const at = toModel(moveEvent);
        const current = map.notes.find((entry) => entry.id === snapshot.id);
        if (!at || !current) return;
        current.x = Math.min(1, Math.max(0, at.x - snapshot.offsetX));
        current.y = Math.min(mapHeight(map), Math.max(0, at.y - snapshot.offsetY));
      },
      onCommit: () => {
        workshop.commitMapEdit();
        pointerSession = null;
        movingTarget = null;
      },
      onCancel: (_reason, _movement, snapshot) => {
        const current = map.notes.find((entry) => entry.id === snapshot.id);
        if (current) {
          current.x = snapshot.x;
          current.y = snapshot.y;
        }
        workshop.cancelMapEdit();
        pointerSession = null;
        movingTarget = null;
      },
      onTap: () => {
        workshop.cancelMapEdit();
        pointerSession = null;
        movingTarget = null;
        selectNote(id);
      }
    });
    if (!session) {
      movingTarget = null;
      return;
    }
    pointerSession = session;
    workshop.beginMapEdit();
  }

  function beginEnvironmentMove(event: PointerEvent, id: MapEnvironmentPieceId): void {
    const point = toModel(event);
    const piece = map.environment.find((entry) => entry.id === id);
    if (!point || !piece) return;
    cancelPointerSession('superseded');
    movingTarget = { kind: 'environment', id };
    const session = startPointerSession(event, {
      snapshot: {
        id,
        x: piece.x,
        y: piece.y,
        offsetX: point.x - piece.x,
        offsetY: point.y - piece.y
      },
      cancelOnSecondPointer: false,
      onMove: (_movement, moveEvent, snapshot) => {
        const at = toModel(moveEvent);
        const current = map.environment.find((entry) => entry.id === snapshot.id);
        if (!at || !current) return;
        current.x = Math.min(1, Math.max(0, at.x - snapshot.offsetX));
        current.y = Math.min(mapHeight(map), Math.max(0, at.y - snapshot.offsetY));
      },
      onCommit: () => {
        workshop.commitMapEdit();
        pointerSession = null;
        movingTarget = null;
      },
      onCancel: (_reason, _movement, snapshot) => {
        const current = map.environment.find((entry) => entry.id === snapshot.id);
        if (current) {
          current.x = snapshot.x;
          current.y = snapshot.y;
        }
        workshop.cancelMapEdit();
        pointerSession = null;
        movingTarget = null;
      },
      onTap: () => {
        workshop.cancelMapEdit();
        pointerSession = null;
        movingTarget = null;
        selectEnvironment(id);
      }
    });
    if (!session) {
      movingTarget = null;
      return;
    }
    pointerSession = session;
    workshop.beginMapEdit();
  }

  function completeLink(hit: MapSpaceId | null): void {
    if (linkFrom !== null && !findSpace(map, linkFrom)) linkFrom = null;
    if (!hit || !findSpace(map, hit)) return;
    if (linkFrom === null) {
      linkFrom = hit;
      return;
    }
    if (linkFrom !== hit) {
      const from = linkFrom;
      if (pathExists(map, from, hit)) {
        workshop.editMap((m) => {
          m.paths = m.paths.filter(
            (path) =>
              !((path.from === from && path.to === hit) || (path.from === hit && path.to === from))
          );
        });
      } else {
        const path = createMapPath(from, hit);
        workshop.editMap((m) => m.paths.push(path));
      }
      selectSpace(hit, false);
    }
    linkFrom = null;
  }

  function attributeId<T extends string>(event: PointerEvent, attribute: string): T | null {
    const target = event.target instanceof Element ? event.target : null;
    return target?.closest(`[${attribute}]`)?.getAttribute(attribute) as T | null;
  }

  function onEditorPointerDown(event: PointerEvent): void {
    const point = toModel(event);
    if (!point) return;
    const hit = map.showSpacesAndPaths
      ? (attributeId<MapSpaceId>(event, 'data-map-space-target') ?? spaceAt(point))
      : null;

    if (mode === 'spaces') {
      if (!map.showSpacesAndPaths) return;
      if (hit) {
        if (moveTarget?.kind === 'space' && moveTarget.id === hit) {
          beginSpaceMove(event, hit);
        } else {
          startTapOrPan(event, () => selectSpace(hit, selectMultiple || event.shiftKey));
        }
        return;
      }
      startTapOrPan(event, (upEvent) => {
        if (placementArmed !== 'space') return;
        const point = toModel(upEvent);
        if (!point) return;
        const at = clampModelPoint(point);
        const space = createMapSpace(at.x, at.y);
        workshop.editMap((m) => m.spaces.push(space));
        placementArmed = null;
        selectSpace(space.id, false);
      });
      return;
    }

    if (mode === 'link') {
      if (!map.showSpacesAndPaths) return;
      startTapOrPan(event, () => completeLink(hit));
      return;
    }

    if (mode === 'text') {
      const noteId =
        attributeId<MapNoteId>(event, 'data-map-note-target') ??
        attributeId<MapNoteId>(event, 'data-map-note');
      if (noteId) {
        if (moveTarget?.kind === 'note' && moveTarget.id === noteId) {
          beginNoteMove(event, noteId);
        } else {
          startTapOrPan(event, () => selectNote(noteId));
        }
        return;
      }
      startTapOrPan(event, (upEvent) => {
        if (placementArmed !== 'text') return;
        const point = toModel(upEvent);
        if (!point) return;
        const at = clampModelPoint(point);
        const note = createMapNote();
        note.x = at.x;
        note.y = at.y;
        workshop.editMap((m) => m.notes.push(note));
        placementArmed = null;
        selectNote(note.id);
      });
      return;
    }

    if (mode === 'environment') {
      const environmentId =
        attributeId<MapEnvironmentPieceId>(event, 'data-map-environment-target') ??
        attributeId<MapEnvironmentPieceId>(event, 'data-environment-piece');
      if (environmentId) {
        if (moveTarget?.kind === 'environment' && moveTarget.id === environmentId) {
          beginEnvironmentMove(event, environmentId);
        } else {
          startTapOrPan(event, () => selectEnvironment(environmentId));
        }
        return;
      }
      startTapOrPan(event, () => selectEnvironment(null));
    }
  }

  function beginPinch(): void {
    if (viewPointers.size < 2 || !viewport) return;
    const entries = [...viewPointers.entries()].slice(0, 2);
    const first = entries[0];
    const second = entries[1];
    if (!first || !second) return;
    const dx = second[1].x - first[1].x;
    const dy = second[1].y - first[1].y;
    viewGesture = {
      kind: 'pinch',
      pointerIds: [first[0], second[0]],
      startDistance: Math.max(1, Math.hypot(dx, dy)),
      startCentreX: (first[1].x + second[1].x) / 2,
      startCentreY: (first[1].y + second[1].y) / 2,
      startScale: viewScale,
      startX: viewX,
      startY: viewY
    };
    for (const pointerId of viewGesture.pointerIds) {
      try {
        viewport.setPointerCapture(pointerId);
      } catch {
        // A pointer may have ended between the second contact and capture.
      }
    }
    pointerKeptForPinch = null;
  }

  function onViewportPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    viewPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (viewPointers.size >= 2) {
      cancelPointerSession('second-pointer');
      beginPinch();
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
      return;
    }
    if (mode === 'navigate' || artworkView) {
      viewGesture = {
        kind: 'pan',
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: viewX,
        startY: viewY
      };
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
      return;
    }
    onEditorPointerDown(event);
  }

  function onViewportPointerMove(event: PointerEvent): void {
    if (!viewPointers.has(event.pointerId)) return;
    viewPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!viewGesture || !viewport) return;
    if (viewGesture.kind === 'pan') {
      if (viewGesture.pointerId !== event.pointerId) return;
      event.preventDefault();
      setView(
        viewGesture.startX + event.clientX - viewGesture.startClientX,
        viewGesture.startY + event.clientY - viewGesture.startClientY
      );
      return;
    }

    const first = viewPointers.get(viewGesture.pointerIds[0]);
    const second = viewPointers.get(viewGesture.pointerIds[1]);
    if (!first || !second) return;
    event.preventDefault();
    const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
    const scale = Math.min(
      MAX_VIEW_SCALE,
      Math.max(MIN_VIEW_SCALE, viewGesture.startScale * (distance / viewGesture.startDistance))
    );
    const centreX = (first.x + second.x) / 2;
    const centreY = (first.y + second.y) / 2;
    const box = viewport.getBoundingClientRect();
    const modelX = (viewGesture.startCentreX - box.left - viewGesture.startX) / viewGesture.startScale;
    const modelY = (viewGesture.startCentreY - box.top - viewGesture.startY) / viewGesture.startScale;
    setView(centreX - box.left - modelX * scale, centreY - box.top - modelY * scale, scale);
  }

  function onViewportPointerEnd(event: PointerEvent): void {
    if (
      event.type === 'lostpointercapture' &&
      pointerKeptForPinch === event.pointerId
    ) {
      return;
    }
    viewPointers.delete(event.pointerId);
    if (
      viewGesture?.kind === 'pan' && viewGesture.pointerId === event.pointerId ||
      viewGesture?.kind === 'pinch' && viewGesture.pointerIds.includes(event.pointerId)
    ) {
      viewGesture = null;
    }
  }

  /** Keep inspector selections valid when undo removes the thing they name. */
  function undoMap(): void {
    interactionRevision += 1;
    invalidateAsyncMapOperations();
    cancelPointerSession('manual');
    stopViewGesture();
    if (!workshop.undoMap()) return;
    moveTarget = null;
    placementArmed = null;

    const spaceIds = new Set(map.spaces.map((space) => space.id));
    if (selected && !spaceIds.has(selected)) selected = null;
    colorSelection = new Set([...colorSelection].filter((id) => spaceIds.has(id)));
    if (linkFrom && !spaceIds.has(linkFrom)) linkFrom = null;
    if (selectedNote && !map.notes.some((note) => note.id === selectedNote)) selectedNote = null;
    if (
      selectedEnvironment &&
      !map.environment.some((piece) => piece.id === selectedEnvironment)
    ) {
      selectedEnvironment = null;
    }
    if (
      selectedZoneColor &&
      !spaceZoneColors(map).some(
        (zone) => zone.color.toLowerCase() === selectedZoneColor?.toLowerCase()
      )
    ) {
      selectedZoneColor = null;
    }
    onViewportChange();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && reorderingEnvironment) {
      finishEnvironmentReorder();
      return;
    }
    if (artworkView) return;
    if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== 'z') {
      return;
    }
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }
    if (!workshop.canUndoMap) return;
    event.preventDefault();
    undoMap();
  }

  $effect(() => () => {
    disposed = true;
    invalidateAsyncMapOperations();
    const active = pointerSession;
    pointerSession = null;
    active?.dispose();
    movingTarget = null;
    stopViewGesture();
  });

  function removeSelected(): void {
    if (selected === null) return;
    interactionRevision += 1;
    cancelPointerSession('manual');
    const id = selected;
    workshop.editMap((m) => {
      m.spaces = m.spaces.filter((space) => space.id !== id);
      // The paths go with it, or they would draw to a space that is not there.
      m.paths = m.paths.filter((path) => path.from !== id && path.to !== id);
    });
    // Only this one space, not the rest of `colorSelection` — deleting is
    // still a single-space action, gated on the detail editor being open.
    const remaining = new Set(colorSelection);
    remaining.delete(id);
    colorSelection = remaining;
    const [next] = remaining;
    selected = next ?? null;
    if (moveTarget?.kind === 'space' && moveTarget.id === id) moveTarget = null;
    if (linkFrom === id) linkFrom = null;
  }

  /**
   * The map as one PNG, at whichever `MAP_SIZES` preset `map.size` picked —
   * see `mapPrintWidth`.
   */
  async function exportMap(): Promise<void> {
    const mapSnapshot = structuredClone($state.snapshot(map));
    const customSymbols = structuredClone($state.snapshot(set.customSymbols));
    const setName = set.name;
    const authorName = set.meta.author;
    const filename = `${slugify(setName, 'adventure-set')}-${slugify(mapSnapshot.name, 'map')}.png`;
    exporting = true;
    exportError = null;
    try {
      // The faces have to be loaded before anything is measured, or every
      // space label is placed against a fallback.
      await document.fonts.ready;
      const blob = await photographMapBoard(mapSnapshot, {
        customSymbols,
        setName,
        authorName
      });
      if (!blob) throw new Error('The map did not render.');
      saveExport({
        filename,
        mimeType: 'image/png',
        blob
      });
    } catch (cause) {
      exportError = cause instanceof Error ? cause.message : 'Export failed.';
    } finally {
      exporting = false;
    }
  }

  /**
   * Read the board image into the document as a data URL.
   *
   * A data URL rather than a path, for the reason every other asset here is
   * one: a set has to survive being handed to someone else as a single file,
   * and a map pointing at `C:\...\board.png` would arrive blank.
   */
  async function pickArtwork(event: Event & { currentTarget: HTMLInputElement }): Promise<void> {
    const file = event.currentTarget.files?.[0];
    // Cleared straight away, or choosing the same file twice fires no event.
    event.currentTarget.value = '';
    if (!file) return;
    const operation = ++artworkOperation;
    const setId = set.id;
    const mapId = map.id;

    artError = null;
    try {
      const source = await readArtworkFile(file);
      /* On `custom` the board's shape *is* the picture's, so a new picture is a
         new shape — measured here, once, rather than at render time. Read before
         the edit so the whole change lands in one mutation. A preset keeps its
         own aspect and lets the picture letterbox, which is what choosing a
         preset means. Measuring every chosen image also handles a size change
         while the file is being read: the current size, not the size at file
         selection time, decides whether the measured aspect is applied. */
      const aspect = await imageAspect(source);
      if (!isCurrentMap(setId, mapId) || operation !== artworkOperation) return;
      cancelPointerSession('mode-change');
      finishEnvironmentReorder();
      const updatesAspect = map.size === 'custom' && aspect !== null;
      workshop.editMap((m) => {
        m.artwork.source = source;
        m.artwork.label = file.name;
        if (m.size === 'custom' && aspect !== null) m.aspect = aspect;
      });
      if (updatesAspect) onViewportChange();
    } catch (cause) {
      if (!isCurrentMap(setId, mapId) || operation !== artworkOperation) return;
      artError = cause instanceof Error ? cause.message : 'Could not read that file.';
    }
  }

  /**
   * Back to a fresh `Artwork`, so crop and grade go with the picture.
   *
   * `aspect` is deliberately left alone, even on `custom`. It is what every
   * space's `y` is stored against, so resetting it would move the whole board's
   * contents; a custom board that has lost its picture keeps the shape it was
   * built at until another picture gives it a new one.
   */
  function clearArtwork(): void {
    artworkOperation += 1;
    workshop.editMap((m) => (m.artwork = createArtwork()));
  }

  /**
   * What to call a space in the connections list.
   *
   * Its printed label when it has one, and its position in the list otherwise.
   * Position rather than a truncated id: an author reading "Space 4" can count
   * to it, where `space_9f2c…` names nothing they can see on the board.
   */
  function spaceName(id: MapSpaceId): string {
    const index = map.spaces.findIndex((space) => space.id === id);
    const found = index >= 0 ? map.spaces[index] : null;
    if (found?.label.trim()) return found.label.trim();
    return index >= 0 ? `Space ${index + 1}` : 'Unknown space';
  }

  /** Drop one path, leaving both spaces where they are. */
  function unlink(from: MapSpaceId, to: MapSpaceId): void {
    workshop.editMap((m) => {
      m.paths = m.paths.filter(
        (path) =>
          !((path.from === from && path.to === to) || (path.from === to && path.to === from))
      );
    });
  }

  /** How far the path between two spaces currently bows, for the slider below. */
  function pathCurve(from: MapSpaceId, to: MapSpaceId): number {
    return findPath(map, from, to)?.curve ?? 0;
  }

  /**
   * Set a path's curve from either end — the connections list shows the same
   * path once per space it touches, and both have to write the one record.
   */
  function setPathCurve(from: MapSpaceId, to: MapSpaceId, curve: number): void {
    workshop.editMap((m) => {
      const path = m.paths.find(
        (p) => (p.from === from && p.to === to) || (p.from === to && p.to === from)
      );
      if (path) path.curve = curve;
    });
  }

  async function openEnvironmentPicker(replace: MapEnvironmentPieceId | null = null): Promise<void> {
    const operation = ++environmentOperation;
    const setId = set.id;
    const mapId = map.id;
    replacingEnvironment = replace;
    /* `multiple` depends on this state. Let Svelte update the real input before
       opening it, or Replace inherits Add's multi-file chooser for one frame. */
    await tick();
    if (!isCurrentMap(setId, mapId) || operation !== environmentOperation || artworkView) return;
    environmentInput?.click();
  }

  /** PNGs stay embedded in the document and keep their measured aspect so the
      renderer never has to decode them merely to lay the board out. */
  async function pickEnvironmentPieces(
    event: Event & { currentTarget: HTMLInputElement }
  ): Promise<void> {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    const operation = ++environmentOperation;
    if (files.length === 0) {
      replacingEnvironment = null;
      return;
    }
    const setId = set.id;
    const mapId = map.id;
    const replaceId = replacingEnvironment;
    const selectionRevision = interactionRevision;
    const replaceLabel = replaceId
      ? (map.environment.find((piece) => piece.id === replaceId)?.label ?? null)
      : null;

    environmentError = null;
    try {
      const chosen = replaceId ? files.slice(0, 1) : files;
      if (chosen.some((file) => file.type !== 'image/png' && !file.name.toLowerCase().endsWith('.png'))) {
        throw new Error('Environment pieces must be PNG images.');
      }
      const imported = await Promise.all(
        chosen.map(async (file) => {
          const source = await readArtworkFile(file);
          return { source, label: file.name, aspect: (await imageAspect(source)) ?? 1 };
        })
      );
      if (!isCurrentMap(setId, mapId) || operation !== environmentOperation) return;
      if (replaceId && !map.environment.some((piece) => piece.id === replaceId)) return;
      cancelPointerSession('mode-change');
      finishEnvironmentReorder();

      if (replaceId) {
        const id = replaceId;
        workshop.editMap((m) => {
          const piece = m.environment.find((entry) => entry.id === id);
          const replacement = imported[0];
          if (!piece || !replacement) return;
          piece.source = replacement.source;
          if (piece.label === replaceLabel) piece.label = replacement.label;
          piece.aspect = replacement.aspect;
        });
        if (interactionRevision === selectionRevision) selectEnvironment(id);
      } else {
        let last: MapEnvironmentPieceId | null = null;
        workshop.editMap((m) => {
          for (const item of imported) {
            const piece = createMapEnvironmentPiece(
              item.source,
              item.label,
              item.aspect,
              0.5,
              mapHeight(m) / 2
            );
            m.environment.push(piece);
            last = piece.id;
          }
        });
        if (interactionRevision === selectionRevision) selectEnvironment(last);
      }
    } catch (cause) {
      if (!isCurrentMap(setId, mapId) || operation !== environmentOperation) return;
      environmentError = cause instanceof Error ? cause.message : 'Could not read those PNGs.';
    } finally {
      if (isCurrentMap(setId, mapId) && operation === environmentOperation) {
        replacingEnvironment = null;
      }
    }
  }

  function patchEnvironment(patch: Partial<MapEnvironmentPiece>): void {
    if (!selectedEnvironment) return;
    workshop.editMap((m) => {
      const piece = m.environment.find((entry) => entry.id === selectedEnvironment);
      if (piece) Object.assign(piece, patch);
    });
  }

  function moveEnvironment(delta: -1 | 1): void {
    if (!selectedEnvironment) return;
    workshop.editMap((m) => {
      const index = m.environment.findIndex((piece) => piece.id === selectedEnvironment);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= m.environment.length) return;
      const [piece] = m.environment.splice(index, 1);
      if (piece) m.environment.splice(target, 0, piece);
    });
  }

  function reorderEnvironment(
    sourceId: MapEnvironmentPieceId,
    targetId: MapEnvironmentPieceId,
    position: 'before' | 'after'
  ): void {
    if (sourceId === targetId) return;
    workshop.editMap((m) => {
      const sourceIndex = m.environment.findIndex((piece) => piece.id === sourceId);
      if (sourceIndex < 0) return;
      const [piece] = m.environment.splice(sourceIndex, 1);
      if (!piece) return;
      const targetIndex = m.environment.findIndex((entry) => entry.id === targetId);
      if (targetIndex < 0) {
        m.environment.splice(sourceIndex, 0, piece);
        return;
      }
      m.environment.splice(targetIndex + (position === 'after' ? 1 : 0), 0, piece);
    });
  }

  function finishEnvironmentReorder(): void {
    reorderingEnvironment = null;
    environmentDrop = null;
    environmentReorderPointerId = null;
  }

  function startEnvironmentPointerReorder(
    event: PointerEvent,
    id: MapEnvironmentPieceId
  ): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    finishEnvironmentReorder();
    reorderingEnvironment = id;
    environmentReorderPointerId = event.pointerId;
    environmentDrop = null;
    try {
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
    } catch {
      finishEnvironmentReorder();
    }
  }

  function onWindowPointerDown(event: PointerEvent): void {
    if (
      environmentReorderPointerId !== null &&
      event.pointerId !== environmentReorderPointerId
    ) {
      finishEnvironmentReorder();
    }
    const target = event.target instanceof Element ? event.target : null;
    /* Controls float inside the viewport but stop bubbling so they do not pan
       the board. Treating them as though the viewport arbiter will see this
       pointer would otherwise leave an in-flight authoring move alive. */
    const reachesViewportArbiter = viewport !== null &&
      event.composedPath().includes(viewport) &&
      !target?.closest('.viewport-controls');
    if (
      pointerSession &&
      event.pointerId !== pointerSession.pointerId &&
      !reachesViewportArbiter
    ) {
      cancelPointerSession('second-pointer', false);
    }
  }

  function targetEnvironmentPointerReorder(event: PointerEvent): void {
    if (!reorderingEnvironment || event.pointerId !== environmentReorderPointerId) return;
    event.preventDefault();
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest('[data-environment-row]');
    const id = target?.getAttribute('data-environment-row') as MapEnvironmentPieceId | null;
    if (!target || !id || id === reorderingEnvironment) {
      environmentDrop = null;
      return;
    }
    const box = target.getBoundingClientRect();
    environmentDrop = {
      id,
      position: event.clientY < box.top + box.height / 2 ? 'before' : 'after'
    };
  }

  function finishEnvironmentPointerReorder(event: PointerEvent): void {
    if (event.pointerId !== environmentReorderPointerId) return;
    if (reorderingEnvironment && environmentDrop) {
      reorderEnvironment(reorderingEnvironment, environmentDrop.id, environmentDrop.position);
    }
    finishEnvironmentReorder();
  }

  function cancelEnvironmentPointerReorder(event: PointerEvent): void {
    if (event.pointerId !== environmentReorderPointerId) return;
    finishEnvironmentReorder();
  }

  function removeEnvironment(): void {
    if (!selectedEnvironment) return;
    interactionRevision += 1;
    environmentOperation += 1;
    replacingEnvironment = null;
    cancelPointerSession('manual');
    const id = selectedEnvironment;
    workshop.editMap((m) => {
      m.environment = m.environment.filter((piece) => piece.id !== id);
    });
    selectedEnvironment = null;
    if (moveTarget?.kind === 'environment' && moveTarget.id === id) moveTarget = null;
  }

  /** Direction copy for the two directional toggles, stated from whichever endpoint is open. */
  function pathDirection(from: MapSpaceId, to: MapSpaceId): string {
    const path = findPath(map, from, to);
    if (!path || (!path.oneWay && !path.modifier) || path.from === from) {
      return `to ${spaceName(to)}`;
    }
    return `from ${spaceName(to)}`;
  }

  /**
   * Toggle a printed connection option. The first directional option enabled
   * from a plain path establishes selected-space → neighbour as its direction.
   * Once either is active, enabling the other preserves that established
   * direction. Large fighter is symmetric and never changes endpoint order.
   */
  function setPathOption(
    from: MapSpaceId,
    to: MapSpaceId,
    option: 'oneWay' | 'modifier' | 'largeFighter',
    enabled: boolean
  ): void {
    workshop.editMap((m) => {
      const path = m.paths.find(
        (p) => (p.from === from && p.to === to) || (p.from === to && p.to === from)
      );
      if (!path) return;
      if (option !== 'largeFighter' && enabled && !path.oneWay && !path.modifier) {
        /* `curve` is signed clockwise from `from` to `to`. Swapping only the
           endpoints would therefore bow an existing route to the opposite
           side at the exact moment an author makes it directional; negating
           the sign preserves the geometry while giving both options the same
           selected-space → neighbour direction. */
        if (path.from !== from) {
          path.from = from;
          path.to = to;
          path.curve = -path.curve;
        }
      }
      path[option] = enabled;
    });
  }

  function setSecretPassage(enabled: boolean): void {
    if (!selectedSpace) return;
    workshop.editMap(() => {
      selectedSpace.secretPassage = enabled ? createMapSecretPassage() : null;
    });
  }

  function patchSecretPassage(patch: Partial<MapSecretPassage>): void {
    if (!selectedSpace?.secretPassage) return;
    workshop.editMap(() => {
      if (selectedSpace.secretPassage) Object.assign(selectedSpace.secretPassage, patch);
    });
  }

  /**
   * Claim a start position for the selected space.
   *
   * Clearing the number off any other space that held it, because the marker
   * says "player 3 begins here" and two of those is not a thing a board can
   * mean. Clicking the number a space already has clears it, so the control
   * needs no separate off switch beyond the explicit one.
   */
  function setStart(n: number | null): void {
    if (!selectedSpace) return;
    const id = selectedSpace.id;
    const next = selectedSpace.start === n ? null : n;
    workshop.editMap((m) => {
      for (const space of m.spaces) {
        if (space.id === id) space.start = next;
        else if (next !== null && space.start === next) space.start = null;
      }
    });
  }

  /** Which side of the rim the selected space's start diamond sits on. */
  function setStartSide(side: MapStartSide): void {
    if (!selectedSpace) return;
    workshop.editMap(() => {
      selectedSpace.startSide = side;
    });
  }

  /** Turns a split space's wedges without moving the space itself. */
  function setSpaceRotation(degrees: number): void {
    if (!selectedSpace) return;
    workshop.editMap(() => {
      selectedSpace.rotation = degrees;
    });
  }

  function editNote(note: MapNote, mutate: (n: MapNote) => void): void {
    workshop.editMap(() => mutate(note));
  }

  function removeNote(note: MapNote): void {
    interactionRevision += 1;
    cancelPointerSession('manual');
    workshop.editMap((m) => (m.notes = m.notes.filter((n) => n.id !== note.id)));
    if (selectedNote === note.id) selectedNote = null;
    if (moveTarget?.kind === 'note' && moveTarget.id === note.id) moveTarget = null;
  }

  function setZoneCount(count: number): void {
    if (!selectedSpace) return;
    zonePatternOperation += 1;
    const zones = selectedSpace.zones;
    workshop.editMap(() => {
      while (zones.length > count) zones.pop();
      while (zones.length < count) zones.push(solid('#cfd3d6'));
    });
  }
</script>

<svelte:window
  onkeydown={onKeyDown}
  onpointerdowncapture={onWindowPointerDown}
  onblur={onPageInterruption}
  onpagehide={onPageInterruption}
  onresize={onViewportChange}
  onorientationchange={onViewportChange}
/>
<svelte:document onvisibilitychange={onVisibilityChange} />

<div class="page scroll-y">
  <header class="head">
    <div class="titles">
      <span class="eyebrow">Set tool</span>
      <h1 class="title">Map</h1>
    </div>

    <!--
      Photographed from a copy mounted off-screen, not from the board on screen:
      an export must not depend on this page being the one open, and the copy is
      the same component the overview and any future print will draw.
    -->
    <div class="head-actions">
      <Button
        size="sm"
        disabled={artworkView || !workshop.canUndoMap}
        title="Undo last map change (Ctrl+Z)"
        onclick={undoMap}
      >
        <Icon name="undo" size={13} />
        Undo
      </Button>
      <Button size="sm" disabled={!map.enabled || exporting} onclick={exportMap}>
        <Icon name="download" size={13} />
        {exporting ? 'Rendering…' : 'Export PNG'}
      </Button>
    </div>
  </header>

  <div class="map-switcher">
    <div class="map-tabs" role="tablist" aria-label="Maps in this set">
      {#each set.maps as entry, index (entry.id)}
        <button
          type="button"
          role="tab"
          class="map-tab"
          class:active={entry.id === map.id}
          aria-selected={entry.id === map.id}
          onclick={() => selectMap(entry.id)}
        >
          <span>{entry.name.trim() || `Map ${index + 1}`}</span>
          {#if !entry.enabled}<small>Off</small>{/if}
        </button>
      {/each}
    </div>
    <div class="map-switcher-actions">
      <Button size="sm" disabled={artworkView} onclick={addMap}>
        <Icon name="plus" size={13} />
        Map
      </Button>
      {#if set.maps.length > 1}
        <Button
          size="sm"
          disabled={artworkView}
          variant={confirmingMapDelete ? 'danger' : 'secondary'}
          onclick={removeCurrentMap}
        >
          {confirmingMapDelete ? 'Confirm delete' : 'Delete map'}
        </Button>
      {/if}
    </div>
  </div>

  {#if exportError}<p class="error" role="alert">{exportError}</p>{/if}

  <!--
    Off reads as a feature waiting to be started rather than an empty page —
    the same treatment the Components page already gives its own empty state.
    The switch below is kept for turning the map back *off*, which is why it
    only appears once there is a map to turn off; the call to action is the
    way in. See ThreatTracker, which has the identical arrangement.
  -->
  {#if !map.enabled}
    <EmptyState
      icon="grid"
      title="No map"
      description="The board the adventure is played on — spaces, the paths between them, and the artwork under it all. Nothing is lost while it is off, and it stays out of exports."
    >
      {#snippet actions()}
        <Button variant="primary" onclick={() => workshop.editMap((m) => (m.enabled = true))}>
          <Icon name="plus" size={13} />
          Add a map
        </Button>
      {/snippet}
    </EmptyState>
  {:else}
  <div class="panels">
    <section class="panel">
      <Switch
        checked={map.enabled}
        disabled={artworkView}
        label="This adventure has a map"
        hint="Off by default — not every set needs one"
        onchange={(value) => {
          workshop.editMap((m) => (m.enabled = value));
          if (!value) {
            resetMapSelections();
            resetView();
          }
        }}
      />
    </section>

    {#if map.enabled}
      <section class="panel">
        <div class="modes">
          {#each MODES as entry (entry.value)}
            <button
              type="button"
              class="mode"
              disabled={artworkView}
              class:active={mode === entry.value}
              aria-pressed={mode === entry.value}
              title={entry.hint}
              onclick={() => changeMode(entry.value)}
            >
              {entry.label}
            </button>
          {/each}
          <span class="mode-hint">{MODES.find((entry) => entry.value === mode)?.hint}</span>

          {#if mode === 'spaces'}
            <button
              type="button"
              class="mode action-mode"
              class:active={placementArmed === 'space'}
              aria-pressed={placementArmed === 'space'}
              onclick={() => {
                moveTarget = null;
                placementArmed = placementArmed === 'space' ? null : 'space';
              }}
            >
              <Icon name="plus" size={13} />
              {placementArmed === 'space' ? 'Cancel add' : 'Add space'}
            </button>
            <button
              type="button"
              class="mode"
              class:active={selectMultiple}
              aria-pressed={selectMultiple}
              onclick={() => {
                selectMultiple = !selectMultiple;
                if (selectMultiple) moveTarget = null;
              }}
            >
              Select multiple
            </button>
            <span class="selection-count" role="status">
              {colorSelection.size} selected
            </span>
            <button
              type="button"
              class="mode"
              disabled={colorSelection.size === 0}
              onclick={clearSelection}
            >Clear</button>
          {:else if mode === 'text'}
            <button
              type="button"
              class="mode action-mode"
              class:active={placementArmed === 'text'}
              aria-pressed={placementArmed === 'text'}
              onclick={() => {
                moveTarget = null;
                placementArmed = placementArmed === 'text' ? null : 'text';
              }}
            >
              <Icon name="plus" size={13} />
              {placementArmed === 'text' ? 'Cancel add' : 'Add text'}
            </button>
          {:else if mode === 'link'}
            <span class="selection-count" role="status">
              {linkFrom ? `${spaceName(linkFrom)} chosen · choose the second endpoint` : 'Choose the first endpoint'}
            </span>
            {#if linkFrom}
              <button type="button" class="mode" onclick={() => (linkFrom = null)}>Cancel link</button>
            {/if}
          {/if}

          <button
            type="button"
            class="mode"
            class:active={artworkView}
            aria-pressed={artworkView}
            title="Show only the board artwork here. This never changes the printed map."
            onclick={toggleArtworkView}
          >
            <Icon name="eye" size={13} />
            Artwork view
          </button>

          <!--
            A construction aid, not an editing mode: it changes nothing a click
            does, only what the board shows while working — so a toggle
            rather than another entry in `MODES`, which is only ever about
            what a click means. Never touches the document and never
            exported; see the overlay itself, drawn beside `MapBoard` rather
            than inside it, for why.
          -->
          <button
            type="button"
            class="mode"
            disabled={artworkView}
            class:active={showNumbers}
            title="Show each space's construction number — a label for finding it in this editor, not for the printed board"
            onclick={() => (showNumbers = !showNumbers)}
          >
            <Icon name="eye" size={13} />
            Numbers
          </button>

          <button
            type="button"
            class="mode"
            disabled={artworkView}
            class:active={map.showSpacesAndPaths}
            aria-pressed={map.showSpacesAndPaths}
            title={map.showSpacesAndPaths
              ? 'Hide all spaces and paths in this map, including previews and exports'
              : 'Show all spaces and paths in this map, including previews and exports'}
            onclick={() => {
              const visible = !map.showSpacesAndPaths;
              workshop.editMap((m) => (m.showSpacesAndPaths = visible));
              if (!visible) {
                interactionRevision += 1;
                selected = null;
                colorSelection = new Set();
                linkFrom = null;
                moveTarget = null;
                cancelPointerSession('mode-change');
              }
            }}
          >
            <Icon name="eye" size={13} />
            Spaces &amp; paths
          </button>

          <button
            type="button"
            class="mode"
            disabled={artworkView}
            class:active={map.autoLargeFighter}
            aria-pressed={map.autoLargeFighter}
            title="Automatically mark paths longer than {LARGE_FIGHTER_CENTRE_THRESHOLD_MM} mm centre to centre"
            onclick={() =>
              workshop.editMap((m) => (m.autoLargeFighter = !m.autoLargeFighter))}
          >
            <Icon name="move" size={13} />
            Auto large-fighter pins
          </button>

          <!--
            The one control worth reaching for as often as a mode — the
            board is nothing without its picture — sitting in what would
            otherwise be empty width on this row rather than pushing the
            far taller "Board" block above the map to make room for it.
          -->
          <div class="board-art">
            <input
              class="hidden-file"
              type="file"
              accept="image/*"
              disabled={artworkView}
              bind:this={artInput}
              onchange={pickArtwork}
            />
            <button
              type="button"
              class="art-chip"
              disabled={artworkView}
              onclick={() => artInput?.click()}
              title={hasArtwork(map.artwork) ? 'Replace board artwork' : 'Choose board artwork'}
            >
              <Icon name="image" size={13} />
              <span class="art-name">{map.artwork.label || 'Choose artwork'}</span>
            </button>
            {#if hasArtwork(map.artwork)}
              <button
                type="button"
                class="unlink"
                disabled={artworkView}
                title="Remove board artwork"
                aria-label="Remove board artwork"
                onclick={clearArtwork}
              >
                <Icon name="minus" size={12} />
              </button>
            {/if}
          </div>
        </div>

        {#if artError}<p class="error" role="alert">{artError}</p>{/if}

        {#snippet environmentInspector(piece: MapEnvironmentPiece, index: number)}
          <p class="stats">
            Layer {index + 1} of {map.environment.length} · at
            {(piece.x * 100).toFixed(1)}%, {((piece.y / mapHeight(map)) * 100).toFixed(1)}%
          </p>
          <div class="environment-controls">
            <div class="field">
              <span class="field-label">Layer name</span>
              <TextInput
                value={piece.label}
                aria-label="Environment layer name"
                oninput={(event) => patchEnvironment({ label: event.currentTarget.value })}
              />
            </div>
            <div class="environment-sliders">
              <Slider
                label="Horizontal position"
                value={piece.x}
                min={0}
                max={1}
                step={0.005}
                neutral={0.5}
                format={(value) => `${Math.round(value * 100)}%`}
                onchange={(x) => patchEnvironment({ x })}
              />
              <Slider
                label="Vertical position"
                value={piece.y / mapHeight(map)}
                min={0}
                max={1}
                step={0.005}
                neutral={0.5}
                format={(value) => `${Math.round(value * 100)}%`}
                onchange={(value) => patchEnvironment({ y: value * mapHeight(map) })}
              />
              <Slider
                label="Size"
                value={piece.width}
                min={0.02}
                max={1}
                step={0.01}
                neutral={0.18}
                format={(value) => `${Math.round(value * 100)}%`}
                onchange={(width) => patchEnvironment({ width })}
              />
              <Slider
                label="Rotation"
                value={piece.rotation}
                min={-180}
                max={180}
                step={1}
                neutral={0}
                format={(value) => `${Math.round(value)}°`}
                onchange={(rotation) => patchEnvironment({ rotation })}
              />
              <Slider
                label="Opacity"
                value={piece.opacity}
                min={0}
                max={1}
                step={0.01}
                neutral={1}
                format={(value) => `${Math.round(value * 100)}%`}
                onchange={(opacity) => patchEnvironment({ opacity })}
              />
            </div>
            <div class="environment-order">
              <Button size="sm" disabled={index <= 0} onclick={() => moveEnvironment(-1)}>
                Send backward
              </Button>
              <Button
                size="sm"
                disabled={index >= map.environment.length - 1}
                onclick={() => moveEnvironment(1)}
              >
                Bring forward
              </Button>
            </div>
            <div class="environment-actions">
              <Button
                size="sm"
                variant={moveTarget?.kind === 'environment' && moveTarget.id === piece.id
                  ? 'primary'
                  : 'secondary'}
                onclick={() => toggleMove({ kind: 'environment', id: piece.id })}
              >
                <Icon name="move" size={13} />
                {moveTarget?.kind === 'environment' && moveTarget.id === piece.id
                  ? 'Done moving'
                  : 'Move'}
              </Button>
              <Button size="sm" onclick={() => openEnvironmentPicker(piece.id)}>
                <Icon name="upload" size={13} />
                Replace
              </Button>
              {#key piece.id}
                <ConfirmAction
                  size="sm"
                  label="Delete environment layer"
                  confirmLabel="Delete environment layer — activate again to confirm"
                  confirmText="Confirm delete"
                  onconfirm={removeEnvironment}
                >
                  <Icon name="trash" size={13} />
                  Delete
                </ConfirmAction>
              {/key}
            </div>
          </div>
        {/snippet}

        {#snippet boardPanel()}
          <div class="block board-block">
            <h2 class="panel-title">Board</h2>

            <div class="zones">
              <span class="field-label">Size</span>
              {#each SIZES as entry (entry.value)}
                <button
                  type="button"
                  class="mode"
                  class:active={map.size === entry.value}
                  title={entry.value === 'custom'
                    ? 'Takes the board artwork’s own shape, so it is never stretched or letterboxed'
                    : `${MAP_SIZES[entry.value].width} × ${MAP_SIZES[entry.value].height} px exported`}
                  onclick={() => void setSize(entry.value)}
                >
                  {entry.label}
                </button>
              {/each}
            </div>

            <p class="hint">
              {MAP_WIDTH_MM} × {mapHeightMm(map).toFixed(0)} mm printed — the threat
              track's own width, because on the table they are one board — at
              {printSize.width} × {printSize.height} px exported.
            </p>

            <div class="board-wide">
              <Switch
                checked={map.showLabel}
                label="Show map title"
                hint="Print the UMLabs title plate and author credit"
                onchange={(showLabel) => workshop.editMap((m) => (m.showLabel = showLabel))}
              />
            </div>

            {#if map.showLabel}
              <div class="field board-wide">
                <span class="field-label">Map title</span>
                <TextInput
                  value={map.name}
                  placeholder={set.name}
                  aria-label="Map title"
                  oninput={(event) =>
                    workshop.editMap((m) => (m.name = event.currentTarget.value))}
                />
                <p class="hint">Leave blank to use the set name. The byline uses the set's author credit.</p>
              </div>

              <div class="field board-wide label-corners">
                <span class="field-label">Label corner</span>
                <div class="corner-buttons">
                  {#each LABEL_CORNERS as entry (entry.value)}
                    <button
                      type="button"
                      class="mode corner-button"
                      class:active={map.labelCorner === entry.value}
                      aria-label={entry.label}
                      title={entry.label}
                      aria-pressed={map.labelCorner === entry.value}
                      onclick={() => workshop.editMap((m) => (m.labelCorner = entry.value))}
                    >
                      {entry.symbol}
                    </button>
                  {/each}
                </div>
              </div>
            {/if}

            {#if map.size === 'custom'}
              <!--
                Said plainly, because "Custom" on its own does not explain
                itself: it is not a size to dial in, it is "follow the
                picture". The no-artwork case has to be named too, or the
                button looks like it did nothing.
              -->
              <p class="hint">
                {#if map.artwork.source}
                  Shaped by the board artwork, at {map.aspect.toFixed(3)} : 1 — so it is
                  never stretched or letterboxed. Choosing a different picture reshapes
                  the board to match it.
                {:else}
                  Attach board artwork below and the board will take its shape. Until
                  then it keeps the shape it already had, {map.aspect.toFixed(3)} : 1 —
                  every space's position is stored against it.
                {/if}
              </p>
            {/if}

            <!--
              One slider for every space's fill, not a control per space —
              a space's colour marks its terrain, and letting the artwork
              show through it is a decision about the whole board's look,
              the same way `spaceDiameter` is one size for every space
              rather than something dialled in space by space.
            -->
            <Slider
              label="Space opacity"
              value={map.spaceOpacity}
              min={0}
              max={1}
              step={0.01}
              neutral={1}
              format={(v) => `${Math.round(v * 100)}%`}
              onchange={(v) => workshop.editMap((m) => (m.spaceOpacity = v))}
            />

            <!--
              A `<div>`, not the `<label>` it was: the hex box beside the
              swatch is a second labelable element, and a `<label>` may hold
              only one — with two, a click resolves against the label rather
              than the box it landed on. The swatch takes its own
              `aria-label` in exchange.
            -->
            <div class="field">
              <span class="field-label">Behind the artwork</span>
              <div class="color-row">
                <input
                  type="color"
                  value={map.background.color}
                  aria-label="Behind the artwork"
                  oninput={(event) => {
                    const value = event.currentTarget.value;
                    workshop.editMap((m) => (m.background = solid(value)));
                  }}
                />
                <HexInput
                  value={map.background.color}
                  label="Behind the artwork, hex"
                  onchange={(color) => workshop.editMap((m) => (m.background = solid(color)))}
                />
              </div>
            </div>

            {#if usedColors.length > 0}
              <div class="field">
                <span class="field-label">Colours used — repick one to change it everywhere</span>
                <div class="swatches">
                  <!--
                    Keyed by `index`, not by `color` — this swatch's own
                    `value` is what changes on every drag frame inside the
                    native picker, and keying by the value itself made
                    each frame a *different* array entry, so Svelte tore
                    down and rebuilt this exact input mid-drag, which
                    closes the picker the instant it opens. Keyed by
                    position instead, the same DOM node — and the same
                    still-open picker — survives its own value changing
                    under it, the same way every other colour input on
                    this page already survives `map`'s own live updates.
                  -->
                  {#each usedColors as color, index (index)}
                    <input
                      type="color"
                      value={color}
                      aria-label="Recolour {color}"
                      oninput={(event) => recolor(color, event.currentTarget.value)}
                    />
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        {/snippet}

        {#snippet environmentPanel()}
          <div class="block environment-col">
            <div class="environment-head">
              <h2 class="panel-title">Environment</h2>
              <Button
                size="sm"
                onclick={() => {
                  changeMode('environment');
                  void openEnvironmentPicker();
                }}
              >
                <Icon name="plus" size={13} />
                Add PNG
              </Button>
            </div>
            <p class="hint">Transparent scenery painted above every space. Drag layers to reorder.</p>

            <input
              bind:this={environmentInput}
              class="hidden-file"
              type="file"
              accept="image/png,.png"
              multiple={replacingEnvironment === null}
              onchange={pickEnvironmentPieces}
            />

            {#if map.environment.length === 0}
              <p class="hint">Add trees, objects, or other transparent PNG pieces.</p>
            {:else}
              <ul class="environment-items">
                {#each map.environment as piece, index (piece.id)}
                  <li
                    data-environment-row={piece.id}
                    class:reordering={reorderingEnvironment === piece.id}
                    class:drop-before={environmentDrop?.id === piece.id && environmentDrop.position === 'before'}
                    class:drop-after={environmentDrop?.id === piece.id && environmentDrop.position === 'after'}
                  >
                    <button
                      type="button"
                      class="environment-row"
                      class:active={selectedEnvironment === piece.id}
                      aria-pressed={selectedEnvironment === piece.id}
                      onclick={() => {
                        changeMode('environment');
                        selectEnvironment(selectedEnvironment === piece.id ? null : piece.id);
                      }}
                    >
                      <span class="environment-thumb"><img src={piece.source} alt="" /></span>
                      <span class="environment-copy">
                        <span class="environment-name">{piece.label}</span>
                        <span class="environment-layer">Layer {index + 1}</span>
                      </span>
                      <span
                        class="environment-grip"
                        aria-hidden="true"
                        title="Drag to reorder layers"
                        onpointerdown={(event) => startEnvironmentPointerReorder(event, piece.id)}
                        onpointermove={targetEnvironmentPointerReorder}
                        onpointerup={finishEnvironmentPointerReorder}
                        onpointercancel={cancelEnvironmentPointerReorder}
                        onlostpointercapture={cancelEnvironmentPointerReorder}
                      >⋮⋮</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}

            {#if environmentError}<p class="error" role="alert">{environmentError}</p>{/if}
          </div>
        {/snippet}

        <!--
          Board on the left, controls on the right, so a colour can be changed
          while the space it belongs to is still in view. Below the map they
          would be off screen exactly when they are being used — the board is
          the tallest thing on the page by a long way.
        -->
        <div class="layout">
          <div class="map-stack">
          <div class="map-col">
          <div
            class="map-viewport"
            bind:this={viewport}
            role="region"
            aria-label="Adventure map workspace. {mode === 'navigate'
              ? 'Drag to pan and pinch to zoom.'
              : 'Use the selected editing mode, or switch to Navigate to pan.'}"
            onpointerdown={onViewportPointerDown}
            onpointermove={onViewportPointerMove}
            onpointerup={onViewportPointerEnd}
            onpointercancel={onViewportPointerEnd}
            onlostpointercapture={onViewportPointerEnd}
          >
            <div
              class="board"
              class:artwork-view={artworkView}
              class:moving={movingTarget !== null}
              bind:this={board}
              style:transform="translate({viewX}px, {viewY}px) scale({viewScale})"
              style:--view-scale={viewScale}
            >
              <MapBoard
                {map}
                customSymbols={set.customSymbols}
                setName={set.name}
                authorName={set.meta.author}
                highlight={artworkView ? [] : Array.from(colorSelection)}
                linking={!artworkView && mode === 'link' ? linkFrom : null}
              />

              {#if showNumbers && map.showSpacesAndPaths && !artworkView}
                <!-- Editor-only construction labels; the export mounts MapBoard alone. -->
                <div class="numbers" aria-hidden="true">
                  {#each map.spaces as space, index (space.id)}
                    <span
                      class="number"
                      style:left="{(space.x * 100).toFixed(3)}%"
                      style:top="{((space.y / mapHeight(map)) * 100).toFixed(3)}%"
                    >
                      {index + 1}
                    </span>
                  {/each}
                </div>
              {/if}

              {#if !artworkView}
                <div class="map-hit-layer">
                  {#if map.showSpacesAndPaths && (mode === 'spaces' || mode === 'link')}
                    {#each map.spaces as space, index (space.id)}
                      <button
                        type="button"
                        class="map-hit-target space-hit-target"
                        class:selected={colorSelection.has(space.id) || linkFrom === space.id}
                        class:move-armed={moveTarget?.kind === 'space' && moveTarget.id === space.id}
                        data-map-space-target={space.id}
                        style:--target-x="{(space.x * 100).toFixed(3)}%"
                        style:--target-y="{((space.y / mapHeight(map)) * 100).toFixed(3)}%"
                        style:--target-width="max(calc(44px / var(--view-scale)), {(map.spaceDiameter * 100).toFixed(3)}%)"
                        style:--target-height="max(calc(44px / var(--view-scale)), {((map.spaceDiameter / mapHeight(map)) * 100).toFixed(3)}%)"
                        aria-label="{mode === 'link' ? 'Choose' : 'Select'} {spaceName(space.id)}"
                        aria-pressed={colorSelection.has(space.id) || linkFrom === space.id}
                        onclick={(event) => {
                          if (event.detail !== 0) return;
                          if (mode === 'link') completeLink(space.id);
                          else selectSpace(space.id, selectMultiple || event.shiftKey);
                        }}
                      ><span aria-hidden="true">{index + 1}</span></button>
                    {/each}
                  {:else if mode === 'text'}
                    {#each map.notes as note, index (note.id)}
                      <button
                        type="button"
                        class="map-hit-target note-hit-target"
                        class:selected={selectedNote === note.id}
                        class:move-armed={moveTarget?.kind === 'note' && moveTarget.id === note.id}
                        data-map-note-target={note.id}
                        style:--target-x="{(note.x * 100).toFixed(3)}%"
                        style:--target-y="{((note.y / mapHeight(map)) * 100).toFixed(3)}%"
                        aria-label="Select placed text {index + 1}, {note.text.trim() || 'empty text'}"
                        aria-pressed={selectedNote === note.id}
                        onclick={(event) => {
                          if (event.detail === 0) selectNote(note.id);
                        }}
                      ></button>
                    {/each}
                  {:else if mode === 'environment'}
                    {#each map.environment as piece, index (piece.id)}
                      <button
                        type="button"
                        class="map-hit-target environment-hit-target"
                        class:selected={selectedEnvironment === piece.id}
                        class:move-armed={moveTarget?.kind === 'environment' && moveTarget.id === piece.id}
                        data-map-environment-target={piece.id}
                        style:--target-x="{(piece.x * 100).toFixed(3)}%"
                        style:--target-y="{((piece.y / mapHeight(map)) * 100).toFixed(3)}%"
                        style:--target-width="max(calc(44px / var(--view-scale)), {(piece.width * 100).toFixed(3)}%)"
                        style:--target-height="max(calc(44px / var(--view-scale)), {((piece.width / piece.aspect / mapHeight(map)) * 100).toFixed(3)}%)"
                        aria-label="Select environment layer {index + 1}, {piece.label}"
                        aria-pressed={selectedEnvironment === piece.id}
                        onclick={(event) => {
                          if (event.detail === 0) selectEnvironment(piece.id);
                        }}
                      ></button>
                    {/each}
                  {/if}
                </div>
              {/if}
            </div>

            <div
              class="viewport-controls"
              role="group"
              aria-label="Map zoom controls"
              onpointerdown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                aria-label="Zoom out"
                disabled={viewScale <= MIN_VIEW_SCALE}
                onclick={(event) => {
                  event.stopPropagation();
                  zoomView(viewScale / 1.35);
                }}
              >−</button>
              <span class="numeric">{Math.round(viewScale * 100)}%</span>
              <button
                type="button"
                aria-label="Zoom in"
                disabled={viewScale >= MAX_VIEW_SCALE}
                onclick={(event) => {
                  event.stopPropagation();
                  zoomView(viewScale * 1.35);
                }}
              >+</button>
              <button
                type="button"
                class="fit-view"
                disabled={viewScale === 1 && viewX === 0 && viewY === 0}
                onclick={(event) => {
                  event.stopPropagation();
                  resetView();
                }}
              >Fit</button>
            </div>
          </div>
          <p class="viewport-hint">
            {artworkView
              ? 'Artwork-only view. Editing is paused and exports are unchanged.'
              : mode === 'navigate'
                ? 'Drag to pan · pinch or use +/− to zoom'
                : 'Drag empty board to pan · use two fingers to pinch · editing only happens after a tap or explicit Move'}
          </p>
          </div>
          </div>

          <!-- DOM and visual order both stay interaction-first on narrow
               screens: map, selected item, visual layers, board settings. -->
          <aside class="side" class:editing-paused={artworkView} inert={artworkView}>

            <div class="block selected-block">
              <h2 class="panel-title">
                {selectedEnvironmentPiece
                  ? 'Selected environment'
                  : selectedNoteEntry
                    ? 'Selected text'
                    : selectedSpace
                      ? 'Selected space'
                      : 'Inspector'}
              </h2>
              <div class="selected-scroll">

              {#if selectedEnvironmentPiece}
                {@const environmentIndex = map.environment.findIndex(
                  (entry) => entry.id === selectedEnvironmentPiece.id
                )}
                {@render environmentInspector(selectedEnvironmentPiece, environmentIndex)}
              {:else if selectedNoteEntry}
                <p class="stats">
                  At {(selectedNoteEntry.x * 100).toFixed(1)}%,
                  {((selectedNoteEntry.y / mapHeight(map)) * 100).toFixed(1)}%
                </p>
                <div class="field">
                  <span class="field-label">Text</span>
                  <TextInput
                    value={selectedNoteEntry.text}
                    placeholder="Type here…"
                    aria-label="Placed text"
                    oninput={(event) => {
                      const next = event.currentTarget.value;
                      editNote(selectedNoteEntry, (note) => (note.text = next));
                    }}
                  />
                </div>
                <div class="field">
                  <span class="field-label">Colour</span>
                  <div class="color-row">
                    <input
                      type="color"
                      value={selectedNoteEntry.color}
                      aria-label="Text colour"
                      oninput={(event) =>
                        editNote(selectedNoteEntry, (note) => (note.color = event.currentTarget.value))}
                    />
                    <HexInput
                      value={selectedNoteEntry.color}
                      label="Text colour, hex"
                      onchange={(color) => editNote(selectedNoteEntry, (note) => (note.color = color))}
                    />
                  </div>
                </div>
                <div class="note-position-controls">
                  <Slider
                    label="Horizontal position"
                    value={selectedNoteEntry.x}
                    min={0}
                    max={1}
                    step={0.005}
                    neutral={0.5}
                    format={(value) => `${Math.round(value * 100)}%`}
                    onchange={(x) => editNote(selectedNoteEntry, (note) => (note.x = x))}
                  />
                  <Slider
                    label="Vertical position"
                    value={selectedNoteEntry.y / mapHeight(map)}
                    min={0}
                    max={1}
                    step={0.005}
                    neutral={0.5}
                    format={(value) => `${Math.round(value * 100)}%`}
                    onchange={(value) =>
                      editNote(selectedNoteEntry, (note) => (note.y = value * mapHeight(map)))}
                  />
                  <Slider
                    label="Size"
                    value={selectedNoteEntry.size}
                    min={0.8}
                    max={8}
                    step={0.1}
                    neutral={2.2}
                    format={(value) => value.toFixed(1)}
                    onchange={(size) => editNote(selectedNoteEntry, (note) => (note.size = size))}
                  />
                  <Slider
                    label="Turn"
                    value={selectedNoteEntry.rotation}
                    min={-180}
                    max={180}
                    step={1}
                    neutral={0}
                    format={(value) => `${Math.round(value)}°`}
                    onchange={(rotation) =>
                      editNote(selectedNoteEntry, (note) => (note.rotation = rotation))}
                  />
                </div>
                <div class="inspector-actions">
                  <Button
                    size="sm"
                    variant={moveTarget?.kind === 'note' && moveTarget.id === selectedNoteEntry.id
                      ? 'primary'
                      : 'secondary'}
                    onclick={() => toggleMove({ kind: 'note', id: selectedNoteEntry.id })}
                  >
                    <Icon name="move" size={13} />
                    {moveTarget?.kind === 'note' && moveTarget.id === selectedNoteEntry.id
                      ? 'Done moving'
                      : 'Move'}
                  </Button>
                  {#key selectedNoteEntry.id}
                    <ConfirmAction
                      label="Delete placed text"
                      confirmLabel="Delete placed text — activate again to confirm"
                      confirmText="Confirm delete"
                      size="sm"
                      onconfirm={() => removeNote(selectedNoteEntry)}
                    >
                      <Icon name="trash" size={13} />
                      Delete
                    </ConfirmAction>
                  {/key}
                </div>
              {:else if colorSelection.size === 0}
                <!-- The block keeps its place when nothing is selected, so the
                     board does not jump sideways every time one is. -->
                <p class="hint">
                  Choose Spaces, Text, or Environment, then tap an item to edit it.
                  Select Multiple replaces Shift-click on touch screens.
                </p>
              {:else}
                {#if colorSelection.size > 1}
                  <p class="stats">{colorSelection.size} spaces selected</p>
                {:else if selectedSpace}
                  <p class="stats">
                    {neighbours(map, selectedSpace.id).length} connected · at
                    {(selectedSpace.x * 100).toFixed(1)}%, {(selectedSpace.y * 100).toFixed(1)}%
                  </p>
                {/if}

                <!--
                  Click, not drag-to-edit like the Board panel's own
                  swatches — this one paints the selection, so a plain
                  button rather than a colour input is both the simpler
                  control and the one that cannot be misread as "recolour
                  this everywhere" the way that panel's swatches actually
                  do. Reads `paletteColors`, not `usedColors` alone, so the
                  "+" swatch below can offer a colour that is not on the
                  board yet at all.
                -->
                <div class="field">
                  <span class="field-label">
                    {colorSelection.size > 1
                      ? `Colour all ${colorSelection.size} spaces`
                      : selectedSpace && selectedSpace.zones.length > 1
                        ? 'Colour every zone'
                        : 'Colour this space'}
                  </span>
                  <div class="swatches">
                    {#each paletteColors as color, index (index)}
                      <button
                        type="button"
                        class="swatch-apply"
                        style:background={color}
                        title="Set to {color}"
                        onclick={() => applyColorToSpaces(color, colorSelection)}
                      ></button>
                    {/each}
                    <input
                      class="hidden-file"
                      type="color"
                      bind:this={paletteInput}
                      onchange={(event) => addToPalette(event.currentTarget.value)}
                    />
                    <button
                      type="button"
                      class="swatch-add"
                      title="Add a colour to this swatch"
                      aria-label="Add a colour to this swatch"
                      onclick={() => paletteInput?.click()}
                    >
                      <Icon name="plus" size={13} />
                    </button>
                  </div>
                </div>
              {/if}

              {#if colorSelection.size === 1 && selectedSpace}
                <div class="inspector-actions">
                  <Button
                    size="sm"
                    variant={moveTarget?.kind === 'space' && moveTarget.id === selectedSpace.id
                      ? 'primary'
                      : 'secondary'}
                    onclick={() => toggleMove({ kind: 'space', id: selectedSpace.id })}
                  >
                    <Icon name="move" size={13} />
                    {moveTarget?.kind === 'space' && moveTarget.id === selectedSpace.id
                      ? 'Done moving'
                      : 'Move'}
                  </Button>
                  <span class="hint">
                    {moveTarget?.kind === 'space' && moveTarget.id === selectedSpace.id
                      ? 'Drag this space on the board. Escape or an interruption restores its position.'
                      : 'Choose Move before a drag can change its position.'}
                  </span>
                </div>
                <label class="field">
                  <span class="field-label">Label</span>
                  <TextInput
                    value={selectedSpace.label}
                    placeholder="e.g. 1"
                    oninput={(event) =>
                      workshop.editMap(
                        () => (selectedSpace.label = event.currentTarget.value)
                      )}
                  />
                </label>

                <!--
                  The connections, each removable on its own. The Link toggle
                  is quicker once you know it is there; this is how you find
                  out, and it is the only way to unlink without hunting for the
                  space at the other end.
                -->
                <!--
                  Start positions are 1–5 and exclusive: two spaces both
                  claiming player 3 is a map with a bug in it, so choosing a
                  number takes it off whichever space had it.
                -->
                <div class="zones">
                  <span class="field-label">Starts</span>
                  {#each [1, 2, 3, 4, 5] as n (n)}
                    <button
                      type="button"
                      class="mode"
                      class:active={selectedSpace.start === n}
                      title="Player {n} starts here"
                      onclick={() => setStart(n)}
                    >
                      {n}
                    </button>
                  {/each}
                  <button
                    type="button"
                    class="mode"
                    class:active={selectedSpace.start === null}
                    onclick={() => setStart(null)}
                  >
                    None
                  </button>
                </div>

                {#if selectedSpace.start !== null}
                  <div class="zones">
                    <span class="field-label">Marker side</span>
                    {#each START_SIDES as entry (entry.value)}
                      <button
                        type="button"
                        class="mode"
                        class:active={selectedSpace.startSide === entry.value}
                        title="Draw the diamond on the {entry.label.toLowerCase()} of the space"
                        onclick={() => setStartSide(entry.value)}
                      >
                        {entry.label}
                      </button>
                    {/each}
                  </div>

                  <!--
                    One colour for every start marker's numeral, board-wide
                    — same as `map.spaceStroke`/`pathColor` are — but its
                    control lives here, beside the marker an author is
                    already placing, rather than in the general Board panel
                    where it would be the one colour with nothing else in
                    that panel about markers at all.
                  -->
                  <!-- `<div>` rather than `<label>` — see "Behind the artwork". -->
                  <div class="field">
                    <span class="field-label">Marker number colour</span>
                    <div class="color-row">
                      <input
                        type="color"
                        value={map.startInk}
                        aria-label="Marker number colour"
                        oninput={(event) => {
                          const value = event.currentTarget.value;
                          workshop.editMap((m) => (m.startInk = value));
                        }}
                      />
                      <HexInput
                        value={map.startInk}
                        label="Marker number colour, hex"
                        onchange={(startInk) => workshop.editMap((m) => (m.startInk = startInk))}
                      />
                    </div>
                  </div>
                {/if}

                <section class="selected-section portal-controls">
                  <h3 class="selected-section-title">Secret passage</h3>
                  <Switch
                    checked={selectedSpace.secretPassage !== null}
                    label={selectedSpace.secretPassage ? 'Enabled' : 'Disabled'}
                    hint="Independent marker — add the matching portal to its other space"
                    onchange={setSecretPassage}
                  />
                  {#if selectedSpace.secretPassage}
                    <div class="portal-customisation">
                      <div class="field">
                        <span class="field-label">Passage colour</span>
                        <div class="color-row portal-color-row">
                          <input
                            type="color"
                            value={selectedSpace.secretPassage.color}
                            aria-label="Secret passage colour"
                            oninput={(event) =>
                              patchSecretPassage({ color: event.currentTarget.value })}
                          />
                          <HexInput
                            value={selectedSpace.secretPassage.color}
                            label="Secret passage colour, hex"
                            onchange={(color) => patchSecretPassage({ color })}
                          />
                          <button
                            type="button"
                            class="mode portal-default"
                            class:active={selectedSpace.secretPassage.color.toLowerCase() ===
                              DEFAULT_SECRET_PASSAGE_COLOR}
                            title="Restore the measured secret-passage colour"
                            onclick={() =>
                              patchSecretPassage({ color: DEFAULT_SECRET_PASSAGE_COLOR })}
                          >Default</button>
                        </div>
                        {#if secretPassageColors.length > 0}
                          <div class="passage-colours">
                            <span class="field-label">Passage colours in use</span>
                            <div class="swatches">
                              {#each secretPassageColors as color (color.toLowerCase())}
                                <button
                                  type="button"
                                  class="swatch-apply passage-colour"
                                  class:active={selectedSpace.secretPassage.color.toLowerCase() ===
                                    color.toLowerCase()}
                                  style:background={color}
                                  title="Use secret passage colour {color}"
                                  aria-label="Use secret passage colour {color}"
                                  onclick={() => patchSecretPassage({ color })}
                                ></button>
                              {/each}
                            </div>
                          </div>
                        {/if}
                      </div>

                      <div class="field">
                        <span class="field-label">
                          Symbol · {selectedPortalSymbol
                            ? customSymbolLabel(selectedPortalSymbol)
                            : selectedSpace.secretPassage.symbolId
                              ? 'Missing symbol'
                              : 'Default keyhole'}
                        </span>
                        <div class="portal-symbols">
                          <button
                            type="button"
                            class="portal-symbol"
                            class:active={selectedSpace.secretPassage.symbolId === null}
                            onclick={() => patchSecretPassage({ symbolId: null })}
                          >Default keyhole</button>
                          {#each set.customSymbols.filter((symbol) => symbol.source) as symbol (symbol.id)}
                            <button
                              type="button"
                              class="portal-symbol"
                              class:active={selectedSpace.secretPassage.symbolId === symbol.id}
                              title="Use {customSymbolLabel(symbol)}"
                              onclick={() => patchSecretPassage({ symbolId: symbol.id })}
                            >
                              <img src={symbol.source ?? ''} alt="" />
                              <span>{customSymbolLabel(symbol)}</span>
                            </button>
                          {/each}
                        </div>
                        {#if set.customSymbols.every((symbol) => !symbol.source)}
                          <p class="hint">Upload more choices in the Symbols tab.</p>
                        {/if}
                      </div>
                    </div>

                    <div class="portal-sliders">
                      <Slider
                        label="Position around space"
                        value={selectedSpace.secretPassage.angle}
                        min={-180}
                        max={180}
                        step={1}
                        neutral={-90}
                        format={(v) => `${Math.round(v)}°`}
                        onchange={(angle) => patchSecretPassage({ angle })}
                      />
                      <Slider
                        label="Tail curve"
                        value={selectedSpace.secretPassage.curve}
                        min={-1}
                        max={1}
                        step={0.05}
                        neutral={0}
                        format={(v) =>
                          v === 0
                            ? 'Straight'
                            : `${v < 0 ? 'Left' : 'Right'} ${Math.round(Math.abs(v) * 100)}%`}
                        onchange={(curve) => patchSecretPassage({ curve })}
                      />
                      <div class="fade-slider">
                        <Slider
                          label="Fade length"
                          value={selectedSpace.secretPassage.fade}
                          min={0.05}
                          max={2}
                          step={0.05}
                          neutral={DEFAULT_SECRET_PASSAGE_FADE}
                          format={(v) =>
                            `${v > 1 ? 'Extended' : v < 0.34 ? 'Fast' : v > 0.67 ? 'Slow' : 'Medium'} · ${Math.round(v * 100)}%`}
                          onchange={(fade) => patchSecretPassage({ fade })}
                        />
                      </div>
                    </div>
                  {/if}
                </section>

                <section class="selected-section connections-field">
                  <h3 class="selected-section-title">Connections</h3>
                  {#each neighbours(map, selectedSpace.id) as other (other)}
                    {@const path = findPath(map, selectedSpace.id, other)}
                    {@const centreDistance = path ? pathCentreDistanceMm(map, path) : null}
                    {@const automaticLargeFighter = path ? isAutoLargeFighterPath(map, path) : false}
                    <div class="connection">
                      <div class="link-row">
                        <span class="link-name">{spaceName(other)}</span>
                        <button
                          type="button"
                          class="unlink"
                          title="Remove this path"
                          aria-label="Remove path to {spaceName(other)}"
                          onclick={() => unlink(selectedSpace.id, other)}
                        >
                          <Icon name="minus" size={12} />
                        </button>
                      </div>
                      <!--
                        Per connection, not per space: the curve belongs to
                        the path, and a hub space with several connections
                        needs each one bowed its own way to read as separate
                        routes rather than a fan of straight spokes.
                      -->
                      <Slider
                        label="Curve to {spaceName(other)}"
                        value={pathCurve(selectedSpace.id, other)}
                        min={-1}
                        max={1}
                        step={0.05}
                        neutral={0}
                        format={(v) => (v === 0 ? 'Straight' : `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`)}
                        onchange={(v) => setPathCurve(selectedSpace.id, other, v)}
                      />
                      <Switch
                        checked={path?.oneWay ?? false}
                        label="One way"
                        hint="Orange arrow {pathDirection(selectedSpace.id, other)}"
                        onchange={(enabled) =>
                          setPathOption(selectedSpace.id, other, 'oneWay', enabled)}
                      />
                      <Switch
                        checked={path?.modifier ?? false}
                        label="Modifier"
                        hint="{path?.oneWay ? 'Orange' : 'Black'} attack +1 {pathDirection(selectedSpace.id, other)}"
                        onchange={(enabled) =>
                          setPathOption(selectedSpace.id, other, 'modifier', enabled)}
                      />
                      <Switch
                        checked={path ? showsLargeFighterMarker(map, path) : false}
                        disabled={automaticLargeFighter}
                        label="Large fighter"
                        hint={automaticLargeFighter && centreDistance !== null
                          ? `Automatic · ${centreDistance.toFixed(1)} mm centre to centre`
                          : 'Show the restriction pin'}
                        onchange={(enabled) =>
                          setPathOption(selectedSpace.id, other, 'largeFighter', enabled)}
                      />
                    </div>
                  {:else}
                    <p class="hint">Nothing connected yet.</p>
                  {/each}
                </section>

                <section class="selected-section space-details">
                  <h3 class="selected-section-title">Space details</h3>
                <div class="zones">
                  <span class="field-label">Split into</span>
                  {#each [1, 2, 3, 4] as count (count)}
                    <button
                      type="button"
                      class="mode"
                      class:active={selectedSpace.zones.length === count}
                      onclick={() => setZoneCount(count)}
                    >
                      {count}
                    </button>
                  {/each}
                </div>

                {#if selectedSpace.zones.length > 1}
                  <!--
                    A circle with one fill has no seam to turn — hidden
                    until there is a split to rotate, same as "Marker side"
                    only shows once there is a marker.
                  -->
                  <Slider
                    label="Rotation"
                    value={selectedSpace.rotation}
                    min={-180}
                    max={180}
                    step={1}
                    neutral={0}
                    format={(v) => `${Math.round(v)}°`}
                    onchange={(v) => setSpaceRotation(v)}
                  />
                {/if}

                {#if selectedSpace.zones.length > 1}
                  <!--
                    One row per wedge, each with its own quick-apply palette
                    — "Colour every zone" above sets all of them at once,
                    which is not the same request as matching *one* wedge to
                    a colour another already has. Without a per-zone row,
                    that meant opening this zone's own picker and using its
                    eyedropper against another wedge on screen; a click here
                    does the same thing in one step.
                  -->
                  <div class="zone-list">
                    {#each selectedSpace.zones as zone, index (index)}
                      <div class="field">
                        <span class="field-label">Zone {index + 1}</span>
                        <div class="swatches">
                          {#each paletteColors as color, ci (ci)}
                            <button
                              type="button"
                              class="swatch-apply"
                              style:background={color}
                              title="Set zone {index + 1} to {color}"
                              onclick={() => applyColorToZone(color, index)}
                            ></button>
                          {/each}
                          <input
                            type="color"
                            value={zone.color}
                            aria-label="Zone {index + 1} colour"
                            oninput={(event) => {
                              const value = event.currentTarget.value;
                              zonePatternOperation += 1;
                              workshop.editMap(() => (selectedSpace.zones[index] = solid(value)));
                            }}
                          />
                        </div>
                      </div>
                    {/each}
                  </div>
                {:else}
                  <div class="swatches">
                    {#each selectedSpace.zones as zone, index (index)}
                      <input
                        type="color"
                        value={zone.color}
                        aria-label="Zone {index + 1} colour"
                        oninput={(event) => {
                          const value = event.currentTarget.value;
                          zonePatternOperation += 1;
                          workshop.editMap(() => (selectedSpace.zones[index] = solid(value)));
                        }}
                      />
                    {/each}
                  </div>
                {/if}

                {#key selectedSpace.id}
                  <ConfirmAction
                    size="sm"
                    label="Delete space"
                    confirmLabel="Delete space — activate again to confirm"
                    confirmText="Confirm delete"
                    onconfirm={removeSelected}
                  >
                    <Icon name="trash" size={13} />
                    Delete space
                  </ConfirmAction>
                {/key}
                </section>
              {/if}

              {#if colorSelection.size > 1}
                <Button size="sm" variant="ghost" onclick={clearSelection}>
                  Clear selection
                </Button>
              {/if}
              </div>
            </div>

            <div class="side-col">
            {@render environmentPanel()}

            <div class="block placed-block">
              <div class="environment-head">
                <h2 class="panel-title">Placed text</h2>
                <Button
                  size="sm"
                  onclick={() => {
                    changeMode('text');
                    placementArmed = 'text';
                  }}
                >
                  <Icon name="plus" size={13} />
                  Add
                </Button>
              </div>

              {#if map.notes.length === 0}
                <p class="hint">Choose Add, then tap once on the board.</p>
              {:else}
                <ul class="note-items">
                  {#each map.notes as note, index (note.id)}
                    <li>
                      <button
                        type="button"
                        class="note-list-row"
                        class:active={selectedNote === note.id}
                        aria-pressed={selectedNote === note.id}
                        onclick={() => {
                          changeMode('text');
                          selectNote(note.id);
                        }}
                      >
                        <span>{note.text.trim() || `Placed text ${index + 1}`}</span>
                        <small>{Math.round(note.x * 100)}%, {Math.round((note.y / mapHeight(map)) * 100)}%</small>
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
            </div>

          </aside>

          {@render belowMap()}

          {#snippet belowMap()}
            <div class="below-map" class:editing-paused={artworkView} inert={artworkView}>
              {@render boardPanel()}

              <!-- Terrain styling and the path-wide restriction rule share
                   the right column, with the more frequently inspected zone
                   controls first. -->
              <div class="block zone-col">
              <h2 class="panel-title">Zones</h2>

              {#if zones.length === 0}
                <p class="hint">Colour a space to create its first zone.</p>
              {:else}
                <ul class="zone-items">
                  {#each zones as entry (entry.color)}
                    {@const active = selectedZoneColor?.toLowerCase() === entry.color.toLowerCase()}
                    {@const patterned = zoneStyleFor(map, entry.color) !== null}
                    <li>
                      <button
                        type="button"
                        class="zone-row"
                        class:active
                        onclick={() => (selectedZoneColor = active ? null : entry.color)}
                      >
                        <span class="zone-swatch" style:background={entry.color}></span>
                        <span class="zone-info">
                          <span class="zone-color">{entry.color}</span>
                          <span class="zone-count">
                            {entry.count} {entry.count === 1 ? 'space' : 'spaces'}
                          </span>
                        </span>
                        {#if patterned}
                          <Icon name="layers" size={12} />
                        {/if}
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}

              {#if selectedZoneColor}
                {@const color = selectedZoneColor}
                {@const zone = selectedZone}
                {#if zone?.patternName || zone?.customSource}
                  <div class="pattern-controls">
                    <Slider
                      label="Opacity"
                      value={zone.opacity}
                      min={0}
                      max={1}
                      step={0.01}
                      neutral={0.12}
                      format={(v) => `${Math.round(v * 100)}%`}
                      onchange={(opacity) => patchZone(color, { opacity })}
                    />
                    <Slider
                      label="Tile size"
                      value={zone.scale}
                      min={0.25}
                      max={5}
                      step={0.05}
                      neutral={1}
                      format={(v) => `${v.toFixed(2)}×`}
                      onchange={(scale) => patchZone(color, { scale })}
                    />
                    {#if zone.patternName}
                      <!-- `<div>`, not `<label>` — see "Behind the artwork" in the Board panel. -->
                      <div class="field">
                        <span class="field-label">Pattern colour</span>
                        <div class="color-row">
                          <input
                            type="color"
                            value={zone.patternColor}
                            aria-label="Pattern colour"
                            oninput={(event) => patchZone(color, { patternColor: event.currentTarget.value })}
                          />
                          <HexInput
                            value={zone.patternColor}
                            label="Pattern colour, hex"
                            onchange={(patternColor) => patchZone(color, { patternColor })}
                          />
                        </div>
                      </div>
                    {/if}
                  </div>
                {/if}

                <div class="field">
                  <span class="field-label">Pattern</span>
                  <div class="patterns">
                    <button
                      type="button"
                      class="swatch none"
                      class:selected={!zone?.patternName && !zone?.customSource}
                      title="No pattern"
                      onclick={() => clearZonePattern(color)}
                    >
                      <span class="slash"></span>
                    </button>

                    {#each PATTERN_NAMES as name (name)}
                      <button
                        type="button"
                        class="swatch"
                        class:selected={zone?.patternName === name}
                        title={name.replace(/-/g, ' ')}
                        onclick={() => setZonePatternName(color, name)}
                      >
                        <span
                          class="tile"
                          style:--tile="url('{patternUrl(name)}')"
                          style:--tile-aspect={patternAspect(name)}
                        ></span>
                      </button>
                    {/each}
                  </div>
                </div>

                <input
                  bind:this={zonePatternInput}
                  class="hidden-file"
                  type="file"
                  accept="image/*"
                  onchange={pickZonePattern}
                />
                <div class="field">
                  <span class="field-label">Or upload your own</span>
                  <div class="custom-pattern-slot">
                    <button
                      type="button"
                      class="custom-pattern-thumb"
                      class:empty={!zone?.customSource}
                      title={zone?.customSource ? 'Replace image' : 'Choose an image'}
                      onclick={() => zonePatternInput?.click()}
                    >
                      {#if zone?.customSource}
                        <img src={zone.customSource} alt="" />
                      {:else}
                        <Icon name="image" size={16} />
                      {/if}
                    </button>
                    <span class="filename">{zone?.customLabel || 'No image'}</span>
                    <Button size="sm" onclick={() => zonePatternInput?.click()}>
                      <Icon name="upload" size={13} />
                      {zone?.customSource ? 'Replace' : 'Choose'}
                    </Button>
                  </div>
                </div>

                {#if zonePatternError}<p class="error" role="alert">{zonePatternError}</p>{/if}

              {/if}

              {@render topologyPanel()}
              </div>
            </div>
          {/snippet}
        </div>

        {#snippet topologyPanel()}
        <div class="topology-block">
          <div class="topology-heading">
            <div>
              <h2 class="panel-title">Map analysis</h2>
              <p class="hint">
                Centres minimize the most movement needed before attacking a fighter on any
                other space. One-way arrows restrict movement but not adjacency.
              </p>
            </div>
            <span
              class="topology-status"
              class:warn={topology.componentCount > 1 || !topology.mutuallyReachable}
            >
              {topology.spaceCount === 0
                ? 'No spaces'
                : topology.componentCount > 1
                  ? `${topology.componentCount} disconnected groups`
                  : topology.mutuallyReachable
                    ? 'Fully reachable'
                    : 'Directional travel'}
            </span>
          </div>

          <dl class="topology-stats">
            <div>
              <dt>Total spaces</dt>
              <dd class="numeric">{topology.spaceCount}</dd>
            </div>
            <div>
              <dt>Paths</dt>
              <dd class="numeric">{topology.pathCount}</dd>
              <small>
                {topology.oneWayPathCount} one-way · {topology.secretPathCount}
                {topology.secretPathCount === 1 ? 'secret path' : 'secret paths'}
              </small>
            </div>
            <div>
              <dt>Longest travel route</dt>
              <dd class="numeric">
                {topology.travelDiameter === null
                  ? '—'
                  : `${topology.travelDiameter} ${topology.travelDiameter === 1 ? 'path' : 'paths'}`}
              </dd>
            </div>
          </dl>

          <div class="centre-grid">
            <article class="centre-card">
              <header>
                <div>
                  <span>Melee centre</span>
                  <strong>
                    {topology.meleeAttackRadius === null
                      ? 'No map-wide centre'
                      : `Move ${topology.meleeAttackRadius}`}
                  </strong>
                </div>
                <Icon name="move" size={18} />
              </header>
              <p>
                {topology.meleeAttackCentres.length > 0
                  ? topologySpaceList(topology.meleeAttackCentres)
                  : 'No space can reach an adjacent attack position for every other space.'}
              </p>
              <small>Move until the target is adjacent.</small>
            </article>

            <article class="centre-card">
              <header>
                <div>
                  <span>Ranged centre</span>
                  <strong>
                    {topology.rangedAttackRadius === null
                      ? 'No map-wide centre'
                      : `Move ${topology.rangedAttackRadius}`}
                  </strong>
                </div>
                <Icon name="move" size={18} />
              </header>
              <p>
                {topology.rangedAttackCentres.length > 0
                  ? topologySpaceList(topology.rangedAttackCentres)
                  : 'No space can reach a ranged attack position for every other space.'}
              </p>
              <small>Move until the target is adjacent or shares a colour zone.</small>
            </article>
          </div>

          <div class="topology-findings">
            <span title={topology.isolatedSpaces.length > 0 ? topologySpaceList(topology.isolatedSpaces) : undefined}>
              <strong class="numeric">{topology.isolatedSpaces.length}</strong> isolated
            </span>
            <span title={topology.deadEndSpaces.length > 0 ? topologySpaceList(topology.deadEndSpaces) : undefined}>
              <strong class="numeric">{topology.deadEndSpaces.length}</strong> dead ends
            </span>
            <span title={topology.bottleneckSpaces.length > 0 ? topologySpaceList(topology.bottleneckSpaces) : undefined}>
              <strong class="numeric">{topology.bottleneckSpaces.length}</strong> bottlenecks
            </span>
          </div>
        </div>
        {/snippet}
      </section>
    {/if}
  </div>
  {/if}
</div>

<style>
  .page {
    padding: var(--space-6);
  }

  .head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-5);
  }

  .eyebrow {
    font-size: var(--text-xs);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .title {
    margin: 0;
    font-size: var(--text-lg);
  }

  /* Wide enough for the map plus Board and Selected space at desktop sizes;
     the responsive grid below folds Board under the map before the map itself
     becomes too narrow to edit accurately. */
  .panels {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    max-width: 1712px;
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
  }

  .panel-title,
  .field-label {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .modes,
  .zones,
  .swatches {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .mode {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    color: var(--text-muted);
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .mode.active {
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .mode:disabled,
  .art-chip:disabled,
  .unlink:disabled {
    cursor: default;
    opacity: 0.5;
  }

  .mode-hint {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  /*
   * Pushed to the row's own far right rather than given a place in flow —
   * `.modes` already wraps its buttons and hint left-to-right, and this is
   * the one thing on the row that belongs at the *other* end of whatever
   * width they left behind.
   */
  .board-art {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-left: auto;
  }

  .art-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    max-width: 220px;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .art-chip:hover:not(:disabled) {
    border-color: var(--border-strong);
  }

  .art-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The map remains the visual anchor. Board and Zones share the row directly
     beneath it, while visual scene layers stay beside the live preview. */
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 440px 360px;
    column-gap: var(--space-4);
    row-gap: var(--space-4);
    align-items: start;
  }

  .map-switcher {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-5);
    padding: var(--space-2);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
  }

  .map-tabs {
    display: flex;
    flex: 1;
    gap: var(--space-1);
    min-width: 0;
    overflow-x: auto;
  }

  .map-tab {
    display: inline-flex;
    flex: none;
    align-items: baseline;
    gap: var(--space-2);
    min-height: 2.25rem;
    padding: 0 var(--space-3);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    cursor: pointer;
  }

  .map-tab:hover,
  .map-tab.active {
    border-color: var(--border-default);
    background: var(--surface-inset);
    color: var(--text-primary);
  }

  .map-tab.active {
    border-color: var(--accent);
  }

  .map-tab small {
    color: var(--text-muted);
    font-size: var(--text-2xs);
    font-weight: var(--weight-medium);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
  }

  .map-switcher-actions {
    display: flex;
    flex: none;
    gap: var(--space-2);
  }

  .head-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .map-stack {
    grid-column: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .map-col {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .map-viewport {
    position: relative;
    width: 100%;
    overflow: hidden;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    cursor: grab;
    touch-action: none;
    user-select: none;
  }

  .map-viewport:active {
    cursor: grabbing;
  }

  .board {
    position: relative;
    width: 100%;
    transform-origin: 0 0;
    will-change: transform;
  }

  .board.artwork-view :global(.ink) {
    opacity: 0;
  }

  .map-hit-layer,
  .numbers {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .map-hit-target {
    --target-width: calc(44px / var(--view-scale));
    --target-height: calc(44px / var(--view-scale));
    position: absolute;
    z-index: 4;
    left: clamp(
      calc(var(--target-width) / 2),
      var(--target-x),
      calc(100% - var(--target-width) / 2)
    );
    top: clamp(
      calc(var(--target-height) / 2),
      var(--target-y),
      calc(100% - var(--target-height) / 2)
    );
    width: var(--target-width);
    height: var(--target-height);
    transform: translate(-50%, -50%);
    border: max(1px, calc(2px / var(--view-scale))) solid transparent;
    border-radius: var(--radius-full);
    background: transparent;
    color: transparent;
    pointer-events: auto;
    cursor: pointer;
    touch-action: none;
  }

  .map-hit-target:hover,
  .map-hit-target:focus-visible,
  .map-hit-target.selected {
    border-color: var(--accent);
    background: var(--accent-soft);
    outline: none;
  }

  .map-hit-target.move-armed {
    border-style: dashed;
    border-color: var(--warning);
    background: color-mix(in srgb, var(--warning) 18%, transparent);
    cursor: grab;
  }

  .board.moving .map-hit-target.move-armed {
    cursor: grabbing;
  }

  .space-hit-target > span {
    opacity: 0;
  }

  .viewport-controls {
    position: absolute;
    z-index: 8;
    top: var(--space-2);
    right: var(--space-2);
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-overlay);
    box-shadow: var(--shadow-sm);
  }

  .viewport-controls button {
    display: grid;
    min-width: 36px;
    min-height: 36px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--text-primary);
    place-items: center;
    cursor: pointer;
  }

  .viewport-controls button:disabled {
    cursor: default;
    opacity: 0.45;
  }

  .viewport-controls .fit-view {
    min-width: 44px;
  }

  .viewport-controls span {
    min-width: 4ch;
    font-size: var(--text-2xs);
    text-align: center;
  }

  .viewport-hint,
  .selection-count {
    margin: var(--space-2) 0 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .selected-block {
    grid-column: 2;
    max-height: 600px;
    overflow: hidden;
  }

  .below-map {
    grid-column: 1;
    grid-row: 2;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
  }

  .zone-col {
    border-left: 0;
    border-radius: 0 0 var(--radius-sm) 0;
  }

  .below-map .board-block {
    border-radius: 0 0 0 var(--radius-sm);
  }

  .topology-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    align-items: stretch;
    width: 100%;
    margin-top: var(--space-1);
    padding-top: var(--space-4);
    border-top: 1px solid var(--border-default);
  }

  .topology-heading {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    width: 100%;
  }

  .topology-heading .hint {
    max-width: 76ch;
    margin: var(--space-1) 0 0;
  }

  .topology-status {
    flex: none;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    background: var(--surface-raised);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .topology-status.warn {
    border-color: var(--warning);
    color: var(--warning);
  }

  .topology-stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    width: 100%;
    margin: 0;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
  }

  .topology-stats > div {
    min-width: 0;
    padding: var(--space-3);
    border-right: 1px solid var(--border-default);
  }

  .topology-stats > div:last-child {
    border-right: 0;
  }

  .topology-stats dt,
  .centre-card span {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .topology-stats dd {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
  }

  .topology-stats small {
    display: block;
    margin-top: var(--space-1);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .centre-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-3);
    width: 100%;
  }

  .centre-card {
    min-width: 0;
    padding: var(--space-3);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
  }

  .centre-card header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    color: var(--text-accent);
  }

  .centre-card header div {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .centre-card strong {
    font-size: var(--text-sm);
    color: var(--text-primary);
  }

  .centre-card p {
    overflow-wrap: anywhere;
    margin: var(--space-3) 0 var(--space-1);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-secondary);
  }

  .centre-card small {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .topology-findings {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    width: 100%;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .topology-findings span {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-1);
  }

  .topology-findings strong {
    color: var(--text-primary);
  }

  .side-col {
    grid-column: 3;
    display: flex;
    flex-direction: column;
    gap: 0;
    align-self: start;
  }

  /* Preserve a useful map width before falling back from three columns. */
  @media (max-width: 1250px) {
    .layout {
      grid-template-columns: minmax(0, 1fr) 420px;
    }

    .map-stack { grid-column: 1; grid-row: 1; }
    .selected-block { grid-column: 2; grid-row: 1 / span 3; }
    .side-col { grid-column: 1; grid-row: 2; }
    .below-map { grid-column: 1; grid-row: 3; }
  }

  /* Under about a tablet's width the columns stop being columns at all. */
  @media (max-width: 900px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }

    .map-col,
    .selected-block,
    .side-col,
    .below-map {
      grid-column: 1;
    }

    .map-stack { display: contents; }
    .map-col { grid-row: 1; }
    .selected-block {
      grid-row: 2;
      max-height: none;
      overflow: visible;
      margin-top: 0;
    }
    .side-col { grid-row: 3; }
    .below-map { grid-row: 4; }

    .selected-scroll {
      overflow: visible;
      padding-right: 0;
      scrollbar-gutter: auto;
    }

    .below-map {
      grid-template-columns: minmax(0, 1fr);
    }

    .below-map .board-block,
    .zone-col {
      border: 1px solid var(--border-default);
      border-radius: var(--radius-sm);
    }

    .zone-col {
      border-top: 0;
      border-radius: 0 0 var(--radius-sm) var(--radius-sm);
    }

    .below-map .board-block {
      border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    }

  }

  /* Keep the semantic wrapper transparent; `.side-col` is the actual grid
     item so Environment and Placed text can form one flush vertical stack. */
  .side {
    display: contents;
  }

  .side.editing-paused > *,
  .below-map.editing-paused {
    opacity: 0.55;
  }

  .selected-block,
  .below-map {
    width: auto;
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    align-items: flex-start;
    padding: var(--space-3);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
  }

  .block.selected-block {
    align-items: stretch;
  }

  .block.board-block {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: start;
  }

  .side-col .environment-col {
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  }

  .side-col .placed-block {
    border-top: 0;
    border-radius: 0 0 var(--radius-sm) var(--radius-sm);
  }

  .board-block > .panel-title,
  .board-block > .zones,
  .board-block > .hint {
    grid-column: 1 / -1;
  }

  .board-wide {
    grid-column: 1 / -1;
    width: 100%;
  }

  .corner-buttons {
    display: grid;
    grid-template-columns: repeat(4, 28px);
    gap: var(--space-1);
  }

  .corner-button {
    display: grid;
    width: 28px;
    height: 26px;
    padding: 0;
    place-items: center;
    font-size: var(--text-sm);
    line-height: 1;
  }

  .selected-scroll {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    gap: var(--space-3);
    min-height: 0;
    width: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
    padding-right: var(--space-1);
  }

  .selected-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-3);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
  }

  .selected-section-title {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .portal-sliders {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
    width: 100%;
  }

  .fade-slider {
    grid-column: 1 / -1;
  }

  .portal-customisation {
    display: grid;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
    gap: var(--space-3);
    width: 100%;
  }

  .portal-color-row {
    display: grid;
    grid-template-columns: auto minmax(9ch, 1fr) auto;
  }

  .portal-color-row .portal-default {
    min-width: 0;
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-2xs, var(--text-xs));
    white-space: nowrap;
  }

  .passage-colours {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .passage-colour.active {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .portal-symbols {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .portal-symbol {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 32px;
    max-width: 100%;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    color: var(--text-muted);
    font-size: var(--text-2xs, var(--text-xs));
    cursor: pointer;
  }

  .portal-symbol.active {
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .portal-symbol img {
    width: 24px;
    height: 24px;
    object-fit: contain;
  }

  .portal-symbol span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 100%;
  }

  /*
   * A swatch and its typable hex, side by side. No width of its own: as a flex
   * item of `.field` (a column) it stretches to full width already, and inside
   * `.link-row` (a row) it takes the slack so the remove button stays hard
   * right. See `HexInput` for what the custom properties drive.
   */
  .color-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    --hex-size: var(--text-xs);
    --hex-color: var(--text-secondary);
  }

  .note-items {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
    max-height: 240px;
    overflow-y: auto;
    overscroll-behavior: contain;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .note-list-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    width: 100%;
    min-height: 44px;
    padding: var(--space-2) var(--space-3);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
  }

  .note-list-row:hover,
  .note-list-row.active {
    border-color: var(--accent);
    background: var(--surface-selected);
  }

  .note-list-row span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .note-list-row small {
    flex: none;
    color: var(--text-muted);
    font-size: var(--text-2xs);
  }

  .note-position-controls,
  .inspector-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
    width: 100%;
  }

  .inspector-actions {
    align-items: center;
  }

  .inspector-actions .hint {
    grid-column: 1 / -1;
  }

  .link-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1) 0;
  }

  .connection {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--border-default);
  }

  .connection:last-child {
    padding-bottom: 0;
    border-bottom: none;
  }

  .connection .link-row {
    padding: 0;
  }

  .selected-block .connection {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2) var(--space-3);
  }

  .selected-block .connection .link-row {
    grid-column: 1 / -1;
  }

  .link-name {
    font-size: var(--text-xs);
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }

  .unlink {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 20px;
    height: 20px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }

  .unlink:hover:not(:disabled) {
    border-color: var(--danger);
    color: var(--danger);
  }

  .hint {
    margin: 0;
    font-size: var(--text-2xs, var(--text-xs));
    line-height: var(--leading-normal);
    color: var(--text-muted);
  }

  .error {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--danger);
  }

  .zone-items {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    gap: var(--space-1);
    width: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .zone-items li {
    flex: 1 1 150px;
    min-width: 0;
  }

  .zone-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
  }

  .zone-row:hover {
    background: var(--surface-hover);
  }

  .zone-row.active {
    border-color: var(--accent);
    background: var(--surface-selected);
  }

  .zone-swatch {
    flex: none;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-full);
    border: 1px solid var(--border-default);
  }

  .zone-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .zone-color {
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .zone-count {
    font-size: var(--text-2xs, var(--text-xs));
    color: var(--text-muted);
  }

  .environment-head,
  .environment-order,
  .environment-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
  }

  .environment-head {
    justify-content: space-between;
  }

  .environment-items {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
    max-height: 240px;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
  }

  .environment-items li {
    position: relative;
  }

  .environment-items li.reordering {
    opacity: 0.45;
  }

  .environment-items li.drop-before::before,
  .environment-items li.drop-after::after {
    position: absolute;
    z-index: 1;
    right: 0;
    left: 0;
    height: 2px;
    border-radius: var(--radius-full);
    background: var(--accent);
    content: '';
    pointer-events: none;
  }

  .environment-items li.drop-before::before {
    top: -2px;
  }

  .environment-items li.drop-after::after {
    bottom: -2px;
  }

  .environment-row {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    text-align: left;
  }

  .environment-row:hover {
    background: var(--surface-hover);
  }

  .environment-row.active {
    border-color: var(--accent);
    background: var(--surface-selected);
  }

  .environment-thumb {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    overflow: hidden;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-xs);
    background: var(--surface-overlay);
  }

  .environment-thumb img {
    display: block;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  .environment-name {
    display: block;
    overflow: hidden;
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .environment-copy {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .environment-layer {
    color: var(--text-muted);
    font-size: var(--text-2xs, var(--text-xs));
  }

  .environment-grip {
    display: grid;
    place-items: center;
    width: 24px;
    height: 36px;
    color: var(--text-muted);
    font-size: var(--text-sm);
    letter-spacing: -0.18em;
    cursor: grab;
    touch-action: none;
  }

  .environment-items li.reordering .environment-grip {
    cursor: grabbing;
  }

  .environment-controls {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: 100%;
    padding-top: var(--space-3);
    border-top: 1px solid var(--border-subtle);
  }

  .environment-sliders {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
    width: 100%;
  }

  .environment-order,
  .environment-actions {
    flex-wrap: wrap;
  }

  .pattern-controls {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
    width: 100%;
  }

  /*
   * Ported from `components/workspace/StylePanel.svelte`'s own pattern
   * picker — same swatch grid, same recolour-by-substitution idea (see
   * `MapBoard.svelte`'s own doc comment on why this app's map version
   * recolours by string substitution rather than the CSS mask the card
   * editor's swatch preview below still safely uses, since this one only
   * ever paints a UI preview, never anything rasterised for export).
   */
  .patterns {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
    gap: var(--space-2);
    width: 100%;
  }

  .swatch {
    position: relative;
    aspect-ratio: 1;
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    border: 1px solid var(--border-subtle);
    overflow: hidden;
    cursor: pointer;
  }

  .swatch:hover {
    border-color: var(--border-strong);
  }

  .swatch.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }

  .tile {
    position: absolute;
    inset: 0;
    background: var(--grey-300);
    mask-image: var(--tile);
    -webkit-mask-image: var(--tile);
    mask-size: 22px calc(22px * var(--tile-aspect));
    -webkit-mask-size: 22px calc(22px * var(--tile-aspect));
    mask-repeat: repeat;
    -webkit-mask-repeat: repeat;
  }

  .none .slash {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      135deg,
      transparent calc(50% - 1px),
      var(--grey-600) calc(50% - 1px) calc(50% + 1px),
      transparent calc(50% + 1px)
    );
  }

  .custom-pattern-slot {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
  }

  .custom-pattern-thumb {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--surface-inset);
    border: 1px solid var(--border-default);
    color: var(--text-muted);
    cursor: pointer;
  }

  .custom-pattern-thumb.empty {
    border-style: dashed;
  }

  .custom-pattern-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .filename {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .hidden-file {
    display: none;
  }

  .number {
    position: absolute;
    transform: translate(-50%, -50%);
    padding: 1px 4px;
    border-radius: var(--radius-full);
    background: rgb(0 0 0 / 0.72);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    line-height: 1.4;
    white-space: nowrap;
  }

  .stats {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .warn {
    color: var(--warning, #d9a441);
  }

  .swatches input {
    width: 34px;
    height: 26px;
    padding: 0;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: none;
  }

  /* A plain button rather than a colour input — see the note above the
     markup that uses this for why the two must not be the same control. */
  .swatch-apply {
    width: 34px;
    height: 26px;
    padding: 0;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .swatch-apply:hover {
    border-color: var(--border-strong);
  }

  .swatch-add {
    display: grid;
    place-items: center;
    width: 34px;
    height: 26px;
    padding: 0;
    border: 1px dashed var(--border-default);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }

  .swatch-add:hover {
    border-color: var(--border-strong);
    color: var(--text-secondary);
  }

  .zone-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: 100%;
  }

  @media (max-width: 900px), (any-pointer: coarse) {
    .mode,
    .map-tab,
    .unlink,
    .swatch-apply,
    .swatch-add,
    .corner-button,
    .portal-symbol,
    .environment-grip,
    .zone-row,
    .custom-pattern-thumb,
    .swatches input,
    .color-row > input[type='color'],
    .viewport-controls button {
      min-width: 44px;
      min-height: 44px;
    }

    .corner-buttons {
      grid-template-columns: repeat(4, 44px);
    }

    .corner-button,
    .unlink,
    .swatch-apply,
    .swatch-add,
    .swatches input {
      width: 44px;
      height: 44px;
    }

    .environment-grip {
      width: 44px;
      height: 44px;
    }
  }

  @media (max-width: 600px) {
    .page {
      padding: var(--space-4);
    }

    .head,
    .map-switcher {
      align-items: stretch;
      flex-direction: column;
    }

    .head-actions,
    .map-switcher-actions {
      width: 100%;
    }

    .head-actions :global(button),
    .map-switcher-actions :global(button) {
      flex: 1 1 0;
      min-height: 44px;
    }

    .panel {
      padding: var(--space-3);
    }

    .modes {
      align-items: stretch;
    }

    .modes .mode {
      flex: 1 1 calc(33.333% - var(--space-2));
      justify-content: center;
    }

    .mode-hint,
    .selection-count {
      flex: 1 0 100%;
      margin-top: 0;
    }

    .board-art {
      width: 100%;
      margin-left: 0;
    }

    .art-chip {
      flex: 1 1 auto;
      min-height: 44px;
      max-width: none;
    }

    .block.board-block,
    .environment-sliders,
    .portal-sliders,
    .portal-customisation,
    .pattern-controls,
    .note-position-controls,
    .inspector-actions,
    .selected-block .connection {
      grid-template-columns: minmax(0, 1fr);
    }

    .board-block > *,
    .fade-slider,
    .inspector-actions .hint,
    .selected-block .connection .link-row {
      grid-column: 1;
    }

    .topology-stats {
      grid-template-columns: minmax(0, 1fr);
    }

    .topology-stats > div {
      border-right: 0;
      border-bottom: 1px solid var(--border-default);
    }

    .topology-stats > div:last-child {
      border-bottom: 0;
    }

    .environment-items,
    .note-items {
      max-height: none;
    }
  }
</style>
