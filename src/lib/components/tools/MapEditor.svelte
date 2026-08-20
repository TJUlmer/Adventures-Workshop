<script lang="ts">
  /**
   * The map editor.
   *
   * Deliberately one surface with three verbs — place, link, move — rather than
   * a palette of tools, because a map is small enough that a mode picker would
   * be most of the interface. The mode is explicit all the same: a click on the
   * board means something different in each, and a board that guessed would be
   * infuriating exactly when someone is working quickly.
   *
   * The board itself is `MapBoard`, read-only, with the affordances laid over
   * it. Same split as the threat track: what is exported must not be able to
   * draw a handle.
   */
  import MapBoard from '$lib/renderer/MapBoard.svelte';
  import { solid } from '$lib/cards/style';
  import { createArtwork, hasArtwork } from '$lib/core/artwork';
  import { readArtworkFile } from '$lib/core/image-import';
  import { photographMapBoard, saveExport, slugify } from '$lib/export';
  import {
    createMapNote,
    createMapPath,
    createMapSpace,
    findSpace,
    mapHeight,
    mapHeightMm,
    MAP_SIZES,
    MAP_WIDTH_MM,
    neighbours,
    orphanSpaces,
    pathExists
  } from '$lib/map/types';
  import type { MapNote, MapSize, MapSpaceId, MapStartSide } from '$lib/map/types';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Button, EmptyState, Icon, Slider, Switch, TextInput } from '$lib/ui';

  const set = $derived(workshop.adventure);
  const map = $derived(set.map);

  type Mode = 'place' | 'link' | 'move' | 'text';
  let mode = $state<Mode>('place');
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
  let linkFrom = $state<MapSpaceId | null>(null);
  let dragging = $state<MapSpaceId | null>(null);
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
    { value: 'large', label: 'Large' }
  ];

  /** Sets `aspect` to match — see the doc comment on `AdventureMap.size`. */
  function setSize(size: MapSize): void {
    workshop.editMap((m) => {
      m.size = size;
      const preset = MAP_SIZES[size];
      m.aspect = preset.width / preset.height;
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
    });
  }

  const MODES: { value: Mode; label: string; hint: string }[] = [
    { value: 'place', label: 'Place', hint: 'Click the board to add a space' },
    { value: 'link', label: 'Link', hint: 'Click two spaces to connect them, or again to unlink' },
    { value: 'move', label: 'Move', hint: 'Drag a space to reposition it' },
    { value: 'text', label: 'Text', hint: 'Click the board to place a label' }
  ];

  const orphans = $derived(orphanSpaces(map));
  const selectedSpace = $derived(findSpace(map, selected));

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
      if (hit) {
        // Shift-click adds to (or drops from) the running colour selection
        // instead of replacing it — Place is the one mode this makes sense
        // in, since Move and Link both give a click a different meaning.
        selectSpace(hit, event.shiftKey);
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

    if (hit) {
      selectSpace(hit, false);
      dragging = hit;
      (event.target as Element).setPointerCapture?.(event.pointerId);
    }
  }

  function onPointerMove(event: PointerEvent): void {
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
      const blob = await photographMapBoard(map);
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
      workshop.editMap((m) => {
        m.artwork.source = source;
        m.artwork.label = file.name;
      });
    } catch (cause) {
      artError = cause instanceof Error ? cause.message : 'Could not read that file.';
    }
  }

  /** Back to a fresh `Artwork`, so crop and grade go with the picture. */
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

        <!--
          Board on the left, controls on the right, so a colour can be changed
          while the space it belongs to is still in view. Below the map they
          would be off screen exactly when they are being used — the board is
          the tallest thing on the page by a long way.
        -->
        <div class="layout">
          <!--
            `touch-action: none` on the board rather than `preventDefault`: a
            drag on a touch screen is a scroll until the browser is told
            otherwise, and told at paint time, not at the first move event.
          -->
          <div
            class="board"
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
              highlight={Array.from(colorSelection)}
              linking={mode === 'link' ? linkFrom : null}
            />
          </div>

          <!--
            Two columns rather than one long stack: "Selected space" used to
            sit below "Board" and "Placed text" both, which on a map with a
            few placed labels pushed its own colour picker half a screen
            below the fold — exactly the moment it is needed most, right
            after clicking a space.
          -->
          <aside class="side">
            <div class="side-col">
            <div class="block">
              <h2 class="panel-title">Board</h2>

              <div class="zones">
                <span class="field-label">Size</span>
                {#each SIZES as entry (entry.value)}
                  <button
                    type="button"
                    class="mode"
                    class:active={map.size === entry.value}
                    title="{MAP_SIZES[entry.value].width} × {MAP_SIZES[entry.value].height} px exported"
                    onclick={() => setSize(entry.value)}
                  >
                    {entry.label}
                  </button>
                {/each}
              </div>

              <p class="hint">
                {MAP_WIDTH_MM} × {mapHeightMm(map).toFixed(0)} mm printed — the threat
                track's own width, because on the table they are one board — at
                {MAP_SIZES[map.size].width} × {MAP_SIZES[map.size].height} px exported.
              </p>

              <label class="field">
                <span class="field-label">Behind the artwork</span>
                <input
                  type="color"
                  value={map.background.color}
                  oninput={(event) => {
                    const value = event.currentTarget.value;
                    workshop.editMap((m) => (m.background = solid(value)));
                  }}
                />
              </label>

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

            <div class="block">
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
                      <input
                        type="color"
                        value={note.color}
                        aria-label="Text colour"
                        oninput={(event) => {
                          const value = event.currentTarget.value;
                          editNote(note, (n) => (n.color = value));
                        }}
                      />
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
              <h2 class="panel-title">Selected space</h2>

              {#if colorSelection.size === 0}
                <!-- The block keeps its place when nothing is selected, so the
                     board does not jump sideways every time one is. -->
                <p class="hint">
                  Click a space on the board to edit it. Shift-click to select more
                  than one.
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
                  <label class="field">
                    <span class="field-label">Marker number colour</span>
                    <input
                      type="color"
                      value={map.startInk}
                      oninput={(event) => {
                        const value = event.currentTarget.value;
                        workshop.editMap((m) => (m.startInk = value));
                      }}
                    />
                  </label>
                {/if}

                <div class="field">
                  <span class="field-label">Connections</span>
                  {#each neighbours(map, selectedSpace.id) as other (other)}
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
                  {:else}
                    <p class="hint">Nothing connected yet.</p>
                  {/each}
                </div>

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
              {/if}

              {#if colorSelection.size > 1}
                <Button size="sm" variant="ghost" onclick={clearSelection}>
                  Clear selection
                </Button>
              {/if}
            </div>
          </aside>
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

  /*
   * 1380px, not the 1100px this used to be — the side panel became two
   * 260px columns rather than one (see `.side` below), which are 280px
   * wider together than the cap ever accounted for. Left at 1100px, the
   * board itself was the one thing that shrank to make room: its own
   * effective ceiling dropped from about 824px to about 544px, and the map
   * this whole page exists to show read as tiny. Raised by exactly the
   * width the second column added, the board gets its old ceiling back.
   */
  .panels {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    max-width: 1380px;
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

  /*
   * `minmax(0, 1fr)` for the board column, not `1fr`. A grid track's default
   * minimum is `auto`, which is the content's intrinsic size — so the board
   * would refuse to shrink below its natural width and push the side panel off
   * the page instead of sharing the room with it.
   *
   * The side track is two 260px columns' worth (plus the gap between them),
   * not one — see `.side` below.
   */
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 540px;
    gap: var(--space-4);
    align-items: start;
  }

  /* Under about a laptop's width the columns stop being columns at all. */
  @media (max-width: 900px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }

    .side {
      flex-direction: column;
    }
  }

  /*
   * Two columns, not one long stack — "Board" and "Placed text" share the
   * left one (`.side-col`), "Selected space" is the right one on its own,
   * so its own colour swatches sit beside the map rather than below
   * whatever "Placed text" happens to be holding that day.
   */
  .side {
    display: flex;
    align-items: flex-start;
    gap: var(--space-4);
    /* Follows the board down a long page rather than scrolling away from it. */
    position: sticky;
    top: var(--space-4);
  }

  .side-col,
  .selected-block {
    width: 260px;
    flex: none;
  }

  .side-col {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
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

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 100%;
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

  .hidden-file {
    display: none;
  }

  .board {
    touch-action: none;
    cursor: crosshair;
    user-select: none;
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
