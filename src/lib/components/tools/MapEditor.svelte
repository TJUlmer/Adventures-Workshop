<script lang="ts">
  /**
   * The map editor.
   *
   * "Place" used to be its own mode, exclusive of "Move" — placing a space
   * meant switching away from moving one, and back again to place the next.
   * The two never needed to be separate: a click on empty board can only ever
   * mean "place", a click that lands on a space can only ever mean "select
   * it", and a *held* click on a space can only ever mean "move it". None of
   * those three overlap, so one mode reads all of them off a single pointer
   * gesture instead of asking an author to keep switching between two modes
   * that were only ever disambiguated by where the click landed anyway.
   * "Link" and "Text" stay modes in their own right, because a click on a
   * space genuinely is ambiguous between them and "select" — only the mode
   * picker can say which one is meant.
   *
   * The board itself is `MapBoard`, read-only, with the affordances laid over
   * it. Same split as the threat track: what is exported must not be able to
   * draw a handle.
   */
  import { tick } from 'svelte';
  import MapBoard from '$lib/renderer/MapBoard.svelte';
  import { solid } from '$lib/cards/style';
  import { createArtwork, hasArtwork } from '$lib/core/artwork';
  import { readArtworkFile } from '$lib/core/image-import';
  import { photographMapBoard, saveExport, slugify } from '$lib/export';
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
    mapHeight,
    mapHeightMm,
    mapPrintSize,
    MAP_SIZES,
    MAP_WIDTH_MM,
    neighbours,
    orphanSpaces,
    pathExists,
    spaceZoneColors,
    zoneStyleFor
  } from '$lib/map/types';
  import type {
    MapEnvironmentPiece,
    MapEnvironmentPieceId,
    MapNote,
    MapSecretPassage,
    MapSize,
    MapSpaceId,
    MapStartSide,
    MapZoneStyle
  } from '$lib/map/types';
  import { PATTERN_NAMES, patternAspect, patternUrl } from '$lib/renderer/assets';
  import { customSymbolLabel } from '$lib/symbols/types';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Button, EmptyState, HexInput, Icon, Slider, Switch, TextInput } from '$lib/ui';

  const set = $derived(workshop.adventure);
  const map = $derived(set.map);
  /** What the export will actually produce — a preset's own row, or solved
      from `aspect` on `custom`. See `mapPrintSize`. */
  const printSize = $derived(mapPrintSize(map));

  type Mode = 'place' | 'link' | 'text';
  let mode = $state<Mode>('place');
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
  let dragging = $state<MapSpaceId | null>(null);
  let draggingEnvironment = $state<{
    id: MapEnvironmentPieceId;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  let board = $state<HTMLDivElement | null>(null);
  let artInput = $state<HTMLInputElement | null>(null);
  let artError = $state<string | null>(null);
  let paletteInput = $state<HTMLInputElement | null>(null);
  let exporting = $state(false);
  let exportError = $state<string | null>(null);
  let selectedNote = $state<string | null>(null);

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
    if (size !== 'custom') {
      workshop.editMap((m) => {
        m.size = size;
        const preset = MAP_SIZES[size];
        m.aspect = preset.width / preset.height;
      });
      return;
    }

    const source = map.artwork.source;
    const aspect = source ? await imageAspect(source) : null;
    workshop.editMap((m) => {
      m.size = 'custom';
      if (aspect !== null) m.aspect = aspect;
    });
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
      value: 'place',
      label: 'Spaces',
      hint: 'Click empty board to add a space, click a space to select it, drag a space to move it — hold shift to select more than one'
    },
    { value: 'link', label: 'Link', hint: 'Click two spaces to connect them, or again to unlink' },
    { value: 'text', label: 'Text', hint: 'Click the board to place a label' }
  ];

  const orphans = $derived(orphanSpaces(map));
  const selectedSpace = $derived(findSpace(map, selected));
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
    selectedEnvironment = null;
    if (!additive) {
      selected = id;
      colorSelection = new Set([id]);
      return;
    }
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
    selected = null;
    colorSelection = new Set();
  }

  /**
   * Colour every zone of every space in `ids` the same picked colour — "the
   * space's colour" as a whole, whatever it is currently split into, not
   * just its first wedge.
   */
  function applyColorToSpaces(color: string, ids: Iterable<MapSpaceId>): void {
    const idSet = new Set(ids);
    if (idSet.size === 0) return;
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
    patchZone(color, { patternName: name, customSource: null, customLabel: '' });
  }

  /**
   * Back to "no pattern" — removes the `zoneStyles` entry outright rather
   * than leaving one behind with both `patternName` and `customSource`
   * `null`, keeping the sparse-by-default discipline the rest of this
   * document already follows.
   */
  function clearZonePattern(color: string): void {
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
    selectedEnvironment = id;
    if (id) clearSelection();
  }

  async function pickZonePattern(event: Event & { currentTarget: HTMLInputElement }): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || !selectedZoneColor) return;

    zonePatternError = null;
    try {
      const source = await readArtworkFile(file);
      patchZone(selectedZoneColor, { patternName: null, customSource: source, customLabel: file.name });
    } catch (cause) {
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

  /** The space under the pointer, or `null`. Nearest centre within its radius. */
  function spaceAt(point: { x: number; y: number }): MapSpaceId | null {
    const radius = map.spaceDiameter / 2;
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

  function onPointerDown(event: PointerEvent): void {
    const point = toModel(event);
    if (!point) return;
    const hit = spaceAt(point);

    if (mode === 'place') {
      const target = event.target instanceof Element ? event.target : null;
      const environmentId = target
        ?.closest('[data-environment-piece]')
        ?.getAttribute('data-environment-piece') as MapEnvironmentPieceId | null;
      const environmentPiece = environmentId
        ? map.environment.find((piece) => piece.id === environmentId)
        : null;
      if (environmentPiece) {
        /* Keep the grabbed pixel beneath the pointer. Snapping the image's
           centre to the cursor makes a large scene piece jump on first move. */
        selectEnvironment(environmentPiece.id);
        draggingEnvironment = {
          id: environmentPiece.id,
          offsetX: point.x - environmentPiece.x,
          offsetY: point.y - environmentPiece.y
        };
        (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
        return;
      }

      if (hit) {
        // Shift-click adds to (or drops from) the running colour selection
        // instead of replacing it, and never arms a drag — moving one space
        // out of a multi-selection would leave it unclear which one just
        // moved. A plain click both selects *and* arms a drag: nothing below
        // moves until `onPointerMove` actually sees motion, so a click that
        // never moves is indistinguishable from a plain select.
        selectSpace(hit, event.shiftKey);
        if (!event.shiftKey) {
          dragging = hit;
          (event.target as Element).setPointerCapture?.(event.pointerId);
        }
        return;
      }
      const space = createMapSpace(point.x, point.y);
      workshop.editMap((m) => m.spaces.push(space));
      selectSpace(space.id, false);
      return;
    }

    if (mode === 'text') {
      const note = createMapNote();
      note.x = point.x;
      note.y = point.y;
      workshop.editMap((m) => m.notes.push(note));
      selectedNote = note.id;
      return;
    }

    if (mode === 'link') {
      if (!hit) {
        linkFrom = null;
        return;
      }
      if (linkFrom === null) {
        linkFrom = hit;
        return;
      }
      /*
       * Link is a toggle. Picking a pair that is already joined *unlinks* them,
       * which is the only reading that makes sense: the alternative is a second
       * mode whose one difference is what it does to a pair that is already
       * connected, and drawing a link twice was never a thing anyone wanted.
       */
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
      }
      linkFrom = null;
      return;
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (draggingEnvironment !== null) {
      const point = toModel(event);
      const piece = map.environment.find((entry) => entry.id === draggingEnvironment?.id);
      if (!point || !piece) return;
      piece.x = Math.min(1, Math.max(0, point.x - draggingEnvironment.offsetX));
      piece.y = Math.min(
        mapHeight(map),
        Math.max(0, point.y - draggingEnvironment.offsetY)
      );
      return;
    }

    if (dragging === null) return;
    const point = toModel(event);
    const space = findSpace(map, dragging);
    if (!point || !space) return;
    // Clamped to the board: a space dragged off the edge is unreachable, and
    // the only way back would be to edit the file by hand.
    space.x = Math.min(1, Math.max(0, point.x));
    space.y = Math.min(mapHeight(map), Math.max(0, point.y));
  }

  function onPointerUp(): void {
    if (draggingEnvironment !== null) {
      draggingEnvironment = null;
      // Like a space drag, one pointer gesture is one persisted edit.
      workshop.editMap(() => {});
    }
    if (dragging !== null) {
      dragging = null;
      // Marked dirty once on release, not on every move: a drag is one edit.
      workshop.editMap(() => {});
    }
  }

  function removeSelected(): void {
    if (selected === null) return;
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
  }

  /**
   * The map as one PNG, at whichever `MAP_SIZES` preset `map.size` picked —
   * see `mapPrintWidth`.
   */
  async function exportMap(): Promise<void> {
    exporting = true;
    exportError = null;
    try {
      // The faces have to be loaded before anything is measured, or every
      // space label is placed against a fallback.
      await document.fonts.ready;
      const blob = await photographMapBoard(map, { customSymbols: set.customSymbols });
      if (!blob) throw new Error('The map did not render.');
      saveExport({
        filename: `${slugify(set.name, 'adventure-set')}-map.png`,
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

    artError = null;
    try {
      const source = await readArtworkFile(file);
      /* On `custom` the board's shape *is* the picture's, so a new picture is a
         new shape — measured here, once, rather than at render time. Read before
         the edit so the whole change lands in one mutation. A preset keeps its
         own aspect and lets the picture letterbox, which is what choosing a
         preset means. */
      const aspect = map.size === 'custom' ? await imageAspect(source) : null;
      workshop.editMap((m) => {
        m.artwork.source = source;
        m.artwork.label = file.name;
        if (aspect !== null) m.aspect = aspect;
      });
    } catch (cause) {
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
    replacingEnvironment = replace;
    /* `multiple` depends on this state. Let Svelte update the real input before
       opening it, or Replace inherits Add's multi-file chooser for one frame. */
    await tick();
    environmentInput?.click();
  }

  /** PNGs stay embedded in the document and keep their measured aspect so the
      renderer never has to decode them merely to lay the board out. */
  async function pickEnvironmentPieces(
    event: Event & { currentTarget: HTMLInputElement }
  ): Promise<void> {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (files.length === 0) return;

    environmentError = null;
    try {
      const chosen = replacingEnvironment ? files.slice(0, 1) : files;
      if (chosen.some((file) => file.type !== 'image/png' && !file.name.toLowerCase().endsWith('.png'))) {
        throw new Error('Environment pieces must be PNG images.');
      }
      const imported = await Promise.all(
        chosen.map(async (file) => {
          const source = await readArtworkFile(file);
          return { source, label: file.name, aspect: (await imageAspect(source)) ?? 1 };
        })
      );

      if (replacingEnvironment) {
        const id = replacingEnvironment;
        workshop.editMap((m) => {
          const piece = m.environment.find((entry) => entry.id === id);
          const replacement = imported[0];
          if (!piece || !replacement) return;
          piece.source = replacement.source;
          piece.label = replacement.label;
          piece.aspect = replacement.aspect;
        });
        selectEnvironment(id);
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
        selectEnvironment(last);
      }
    } catch (cause) {
      environmentError = cause instanceof Error ? cause.message : 'Could not read those PNGs.';
    } finally {
      replacingEnvironment = null;
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
  }

  function startEnvironmentPointerReorder(
    event: PointerEvent,
    id: MapEnvironmentPieceId
  ): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    reorderingEnvironment = id;
    environmentDrop = null;
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }

  function targetEnvironmentPointerReorder(event: PointerEvent): void {
    if (!reorderingEnvironment) return;
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

  function finishEnvironmentPointerReorder(): void {
    if (reorderingEnvironment && environmentDrop) {
      reorderEnvironment(reorderingEnvironment, environmentDrop.id, environmentDrop.position);
    }
    finishEnvironmentReorder();
  }

  function removeEnvironment(): void {
    if (!selectedEnvironment) return;
    const id = selectedEnvironment;
    workshop.editMap((m) => {
      m.environment = m.environment.filter((piece) => piece.id !== id);
    });
    selectedEnvironment = null;
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
    workshop.editMap((m) => (m.notes = m.notes.filter((n) => n.id !== note.id)));
    if (selectedNote === note.id) selectedNote = null;
  }

  function setZoneCount(count: number): void {
    if (!selectedSpace) return;
    const zones = selectedSpace.zones;
    workshop.editMap(() => {
      while (zones.length > count) zones.pop();
      while (zones.length < count) zones.push(solid('#cfd3d6'));
    });
  }
</script>

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
    <Button size="sm" disabled={!map.enabled || exporting} onclick={exportMap}>
      <Icon name="download" size={13} />
      {exporting ? 'Rendering…' : 'Export PNG'}
    </Button>
  </header>

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
        label="This adventure has a map"
        hint="Off by default — not every set needs one"
        onchange={(value) => {
          workshop.editMap((m) => (m.enabled = value));
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
              class:active={mode === entry.value}
              title={entry.hint}
              onclick={() => {
                mode = entry.value;
                linkFrom = null;
              }}
            >
              {entry.label}
            </button>
          {/each}
          <span class="mode-hint">{MODES.find((m) => m.value === mode)?.hint}</span>

          <!--
            A construction aid, not a fourth mode: it changes nothing a click
            does, only what the board shows while working — so a toggle
            rather than another entry in `MODES`, which is only ever about
            what a click means. Never touches the document and never
            exported; see the overlay itself, drawn beside `MapBoard` rather
            than inside it, for why.
          -->
          <button
            type="button"
            class="mode"
            class:active={showNumbers}
            title="Show each space's construction number — a label for finding it in this editor, not for the printed board"
            onclick={() => (showNumbers = !showNumbers)}
          >
            <Icon name="eye" size={13} />
            Numbers
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
              bind:this={artInput}
              onchange={pickArtwork}
            />
            <button
              type="button"
              class="art-chip"
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
              <Button size="sm" onclick={() => openEnvironmentPicker(piece.id)}>
                <Icon name="upload" size={13} />
                Replace
              </Button>
              <Button size="sm" variant="danger" onclick={removeEnvironment}>
                <Icon name="trash" size={13} />
                Remove
              </Button>
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
              <Button size="sm" onclick={() => openEnvironmentPicker()}>
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
                      onclick={() =>
                        selectEnvironment(selectedEnvironment === piece.id ? null : piece.id)}
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
                        onpointercancel={finishEnvironmentReorder}
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
          <div class="map-col">
          <!--
            `touch-action: none` on the board rather than `preventDefault`: a
            drag on a touch screen is a scroll until the browser is told
            otherwise, and told at paint time, not at the first move event.
          -->
          <div
            class="board"
            class:dragging-environment={draggingEnvironment !== null}
            bind:this={board}
            role="application"
            aria-label="Adventure map"
            onpointerdown={onPointerDown}
            onpointermove={onPointerMove}
            onpointerup={onPointerUp}
            onpointercancel={onPointerUp}
          >
            <MapBoard
              {map}
              customSymbols={set.customSymbols}
              highlight={Array.from(colorSelection)}
              linking={mode === 'link' ? linkFrom : null}
            />

            {#if showNumbers}
              <!--
                Drawn here, over `MapBoard` rather than inside it — `MapBoard`
                is also what the export photographs (see its own doc comment:
                "what is exported must not be able to draw a handle"), and
                these numbers are a construction aid an author reaches for
                specifically to find "Space 29" while unlinking it, never
                something that should show up on a printed board.
                `pointer-events: none` so the overlay never steals the click
                that is meant for the board underneath it.
              -->
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
          </div>
          {@render belowMap()}
          </div>

          <!-- Source order stays interaction-first: map, visual layers,
               selected-item controls, then board-wide settings. CSS keeps
               Environment beside the map and Board beside Zones beneath it. -->
          <aside class="side">
            <div class="side-col">
            {@render environmentPanel()}

            <div class="block placed-block">
              <h2 class="panel-title">Placed text</h2>

              {#if map.notes.length === 0}
                <p class="hint">Switch to Text and click the board to add a label.</p>
              {:else}
                {#each map.notes as note (note.id)}
                  <div class="note-row">
                    <TextInput
                      value={note.text}
                      placeholder="Type here…"
                      oninput={(event) => {
                        const next = event.currentTarget.value;
                        editNote(note, (n) => (n.text = next));
                      }}
                    />
                    <div class="link-row">
                      <div class="color-row">
                        <input
                          type="color"
                          value={note.color}
                          aria-label="Text colour"
                          oninput={(event) => {
                            const value = event.currentTarget.value;
                            editNote(note, (n) => (n.color = value));
                          }}
                        />
                        <HexInput
                          value={note.color}
                          label="Text colour, hex"
                          onchange={(color) => editNote(note, (n) => (n.color = color))}
                        />
                      </div>
                      <button
                        type="button"
                        class="unlink"
                        title="Remove this text"
                        aria-label="Remove text"
                        onclick={() => removeNote(note)}
                      >
                        <Icon name="minus" size={12} />
                      </button>
                    </div>
                    <Slider
                      label="Size"
                      value={note.size}
                      min={0.8}
                      max={8}
                      step={0.1}
                      neutral={2.2}
                      format={(v) => v.toFixed(1)}
                      onchange={(v) => editNote(note, (n) => (n.size = v))}
                    />
                    <!--
                      A full turn either way rather than 0–360: a label is far
                      more often nudged a few degrees than swung most of the way
                      round, and −15 is easier to reach from the middle than 345
                      is from an end.
                    -->
                    <Slider
                      label="Turn"
                      value={note.rotation}
                      min={-180}
                      max={180}
                      step={1}
                      neutral={0}
                      format={(v) => `${Math.round(v)}°`}
                      onchange={(v) => editNote(note, (n) => (n.rotation = v))}
                    />
                  </div>
                {/each}
              {/if}
            </div>
            </div>

            <div class="block selected-block">
              <h2 class="panel-title">
                {selectedEnvironmentPiece ? 'Selected environment' : 'Selected space'}
              </h2>
              <div class="selected-scroll">

              {#if selectedEnvironmentPiece}
                {@const environmentIndex = map.environment.findIndex(
                  (entry) => entry.id === selectedEnvironmentPiece.id
                )}
                {@render environmentInspector(selectedEnvironmentPiece, environmentIndex)}
              {:else if colorSelection.size === 0}
                <!-- The block keeps its place when nothing is selected, so the
                     board does not jump sideways every time one is. -->
                <p class="hint">
                  Click a space or environment layer to edit it. Shift-click to
                  select more than one space.
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
                        checked={path?.largeFighter ?? false}
                        label="Large fighter"
                        hint="Show the restriction pin"
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
                          workshop.editMap(() => (selectedSpace.zones[index] = solid(value)));
                        }}
                      />
                    {/each}
                  </div>
                {/if}

                <Button variant="danger" size="sm" onclick={removeSelected}>
                  <Icon name="trash" size={13} />
                  Delete space
                </Button>
                </section>
              {/if}

              {#if colorSelection.size > 1}
                <Button size="sm" variant="ghost" onclick={clearSelection}>
                  Clear selection
                </Button>
              {/if}
              </div>
            </div>

          </aside>

          {#snippet belowMap()}
            <div class="below-map">
              <!-- Geometry and colour-wide zone settings belong together as
                   board-wide controls, directly below the thing they change. -->
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
              </div>

              {@render boardPanel()}
            </div>
          {/snippet}
        </div>

        <p class="stats">
          {map.spaces.length}
          {map.spaces.length === 1 ? 'space' : 'spaces'} · {map.paths.length}
          {map.paths.length === 1 ? 'path' : 'paths'}
          {#if orphans.length > 0}
            · <span class="warn">{orphans.length} unconnected</span>
          {/if}
        </p>
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

  .art-chip:hover {
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
    grid-template-columns: minmax(0, 1fr) 360px 440px;
    column-gap: var(--space-4);
    row-gap: var(--space-4);
    align-items: start;
  }

  .map-col {
    grid-column: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .board {
    /* The construction-number overlay is absolute and must resolve against
       the map, not whichever page ancestor happens to be positioned. */
    position: relative;
  }

  .selected-block {
    grid-column: 3;
    max-height: 600px;
    overflow: hidden;
  }

  .below-map {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
  }

  .zone-col {
    border-radius: 0 0 0 var(--radius-sm);
  }

  .below-map .board-block {
    border-left: 0;
    border-radius: 0 0 var(--radius-sm) 0;
  }

  .side-col {
    grid-column: 2;
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

    .map-col { grid-column: 1; grid-row: 1; }
    .side-col { grid-column: 1; grid-row: 2; }
    .selected-block { grid-column: 2; grid-row: 1 / span 2; }
  }

  /* Under about a tablet's width the columns stop being columns at all. */
  @media (max-width: 900px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }

    .map-col,
    .selected-block,
    .side-col {
      grid-column: 1;
    }

    .map-col { grid-row: 1; }
    .side-col { grid-row: 2; }
    .selected-block { grid-row: 3; margin-top: 0; }
  }

  /* Keep the semantic wrapper transparent; `.side-col` is the actual grid
     item so Environment and Placed text can form one flush vertical stack. */
  .side {
    display: contents;
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

  .link-row .color-row {
    flex: 1 1 auto;
  }

  .note-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 100%;
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--border-default);
  }

  .note-row:last-child {
    padding-bottom: 0;
    border-bottom: none;
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

  .unlink:hover {
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

  .board {
    touch-action: none;
    cursor: crosshair;
    user-select: none;
  }

  .board :global(.environment-piece) {
    cursor: grab;
  }

  .board.dragging-environment,
  .board.dragging-environment :global(.environment-piece) {
    cursor: grabbing;
  }

  .numbers {
    position: absolute;
    inset: 0;
    pointer-events: none;
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
</style>
