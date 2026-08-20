<script lang="ts">
  /**
   * The adventure map, drawn.
   *
   * SVG rather than positioned DOM, which is the opposite of every card face in
   * this project — and for a reason the cards do not have. A card is a stack of
   * rectangles and masked artwork; a map is a *graph*. Paths have to stop at the
   * edge of a circle rather than at its centre, and a space split three ways is
   * three arcs meeting at a point. Both are one line of geometry in SVG and a
   * pile of clip-paths in DOM.
   *
   * The viewBox is the model's own coordinate system: one unit wide, `1/aspect`
   * tall, with `y` measured in fractions of the *width* like `x` is. So nothing
   * here converts anything — a space at `x: 0.5` is drawn at 0.5 — and the
   * board scales to whatever box it is given without a single pixel value.
   *
   * Read-only. The editor lays its own affordances over this rather than
   * teaching it to be interactive, for the same reason `ThreatBoard` takes an
   * `editable` prop: what gets exported must not be able to draw a handle.
   */
  import { fillCss } from '$lib/cards/style';
  import CardArt from './CardArt.svelte';
  import type { AdventureMap, MapSpace, MapSpaceId, MapStartSide } from '$lib/map/types';
  import { findSpace, mapHeight } from '$lib/map/types';

  /** Where each side points, in degrees clockwise from twelve o'clock's opposite (SVG's 0° is three o'clock). */
  const START_ANGLE: Record<MapStartSide, number> = {
    top: -90,
    right: 0,
    bottom: 90,
    left: 180
  };

  /**
   * Half the marker's un-rotated side length, as a fraction of the space's own
   * radius. The diamond's tip-to-tip span works out to `half * sqrt(2) * 2`,
   * so this reads as roughly 28% of the space's *diameter* — small enough to
   * read as a corner mark rather than a second disc sitting on the rim, which
   * is what the previous 0.30 (42% of the diameter) drew.
   */
  const START_MARKER_HALF = 0.20;

  interface Props {
    map: AdventureMap;
    /** Drawn under the spaces, so the editor can highlight without redrawing. */
    highlight?: MapSpaceId[];
    /** Being linked from, in the editor. Drawn as a pending endpoint. */
    linking?: MapSpaceId | null;
  }

  let { map, highlight = [], linking = null }: Props = $props();

  const height = $derived(mapHeight(map));
  const radius = $derived(map.spaceDiameter / 2);
  const strokeWidth = $derived(map.spaceDiameter * 0.029);
  const pathWidth = $derived(map.spaceDiameter * 0.055);

  const highlighted = $derived(new Set(highlight));

  /**
   * Paths as line segments, trimmed to the circles at each end.
   *
   * Trimmed rather than drawn centre-to-centre and hidden behind the discs,
   * because a space is not always opaque: a wedge can be a light colour, and a
   * line crossing under it shows through as a chord. Stopping the line at the
   * edge means there is nothing to show through.
   */
  const segments = $derived.by(() => {
    const out: { id: string; x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const path of map.paths) {
      const a = findSpace(map, path.from);
      const b = findSpace(map, path.to);
      if (!a || !b) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      // Two spaces dropped on the same point have no direction to trim along.
      if (length === 0) continue;

      const ux = dx / length;
      const uy = dy / length;
      out.push({
        id: path.id,
        x1: a.x + ux * radius,
        y1: a.y + uy * radius,
        x2: b.x - ux * radius,
        y2: b.y - uy * radius
      });
    }
    return out;
  });

  /**
   * One wedge of a split space, as a path.
   *
   * A single-zone space short-circuits to a plain circle rather than a 360°
   * arc: an arc that starts and ends at the same point is degenerate and
   * renders as nothing at all, which would make every ordinary space invisible.
   */
  function wedge(space: MapSpace, index: number, count: number): string {
    const start = (index / count) * Math.PI * 2 - Math.PI / 2;
    const end = ((index + 1) / count) * Math.PI * 2 - Math.PI / 2;
    const x1 = space.x + Math.cos(start) * radius;
    const y1 = space.y + Math.sin(start) * radius;
    const x2 = space.x + Math.cos(end) * radius;
    const y2 = space.y + Math.sin(end) * radius;
    const large = end - start > Math.PI ? 1 : 0;
    return `M ${space.x} ${space.y} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`;
  }
</script>

<div class="board" style:aspect-ratio="{map.aspect} / 1">
  <!--
    Artwork sits outside the SVG, as an ordinary element.

    It is the one part of a map that is a picture rather than geometry, and
    `CardArt` already knows how to crop, transform and grade one. Putting it in
    an SVG `<image>` would mean reimplementing all of that against a different
    coordinate system.
  -->
  <div class="art" style:background={fillCss(map.background)}>
    <CardArt artwork={map.artwork} background="transparent" />
  </div>

  <svg
    class="ink"
    viewBox="0 0 1 {height}"
    preserveAspectRatio="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-label={map.name || 'Adventure map'}
  >
    <g class="paths" stroke={map.pathColor} stroke-width={pathWidth} stroke-linecap="round">
      {#each segments as segment (segment.id)}
        <line x1={segment.x1} y1={segment.y1} x2={segment.x2} y2={segment.y2} />
      {/each}
    </g>

    {#each map.spaces as space (space.id)}
      <g class="space" class:lit={highlighted.has(space.id)}>
        {#if space.zones.length <= 1}
          <circle
            cx={space.x}
            cy={space.y}
            r={radius}
            fill={fillCss(space.zones[0] ?? { kind: 'solid', color: '#cfd3d6', color2: '#cfd3d6', angle: 180 })}
          />
        {:else}
          {#each space.zones as zone, index (index)}
            <path d={wedge(space, index, space.zones.length)} fill={fillCss(zone)} />
          {/each}
        {/if}

        <circle
          cx={space.x}
          cy={space.y}
          r={radius}
          fill="none"
          stroke={space.stroke ?? map.spaceStroke}
          stroke-width={strokeWidth}
        />

        {#if space.start !== null}
          <!--
            A diamond straddling the rim on the space's chosen side. A square
            turned 45° about its own centre — the centre sits *on* the
            circle's edge, so half the marker overlaps the space and half
            hangs outside it, exactly as printed.
          -->
          {@const angle = (START_ANGLE[space.startSide] * Math.PI) / 180}
          {@const mx = space.x + Math.cos(angle) * radius}
          {@const my = space.y + Math.sin(angle) * radius}
          {@const half = radius * START_MARKER_HALF}
          <g class="start" transform="rotate(45 {mx} {my})">
            <rect
              x={mx - half}
              y={my - half}
              width={half * 2}
              height={half * 2}
              fill={space.stroke ?? map.spaceStroke}
            />
          </g>
          <!--
            The numeral is drawn upright, outside the rotated group — rotating
            the diamond would take its digit with it and stand the number on
            its corner.

            Coloured with `style:fill` rather than a class, because an SVG
            presentation attribute loses to *any* matching stylesheet rule —
            `.space text` (an element selector tacked onto the group's own
            class) outranks a single class on the element itself regardless of
            source order, which is what painted every numeral the same
            near-black as `.space text`'s own fill and made it vanish against
            a diamond drawn in the same ink. An inline style beats stylesheet
            specificity outright, and it is also what lets `map.startInk` be
            a real per-map setting instead of an unwired CSS variable.
          -->
          <text
            class="start-number"
            x={mx}
            y={my}
            font-size={half * 1.5}
            text-anchor="middle"
            dominant-baseline="central"
            style:fill={map.startInk}
          >
            {space.start}
          </text>
        {/if}

        {#if space.label}
          <text
            x={space.x}
            y={space.y}
            font-size={radius}
            text-anchor="middle"
            dominant-baseline="central"
          >
            {space.label}
          </text>
        {/if}

        {#if linking === space.id}
          <circle
            class="pending"
            cx={space.x}
            cy={space.y}
            r={radius + strokeWidth * 2}
            fill="none"
            stroke-width={strokeWidth * 2}
          />
        {/if}
      </g>
    {/each}
    {#each map.notes as note (note.id)}
      <!--
        `rotate` about the note's own anchor rather than the board's origin, so
        turning a note does not also fling it across the map.
      -->
      <text
        class="note"
        x={note.x}
        y={note.y}
        font-size={note.size / 100}
        fill={note.color}
        transform="rotate({note.rotation} {note.x} {note.y})"
      >
        {note.text}
      </text>
    {/each}
  </svg>
</div>

<style>
  .board {
    position: relative;
    width: 100%;
    overflow: hidden;
    background: var(--grey-1000);
  }

  .art {
    position: absolute;
    inset: 0;
  }

  /*
   * `preserveAspectRatio="none"` on the SVG plus a box that already carries the
   * map's aspect ratio: the box is the single source of the shape, so the
   * drawing cannot letterbox itself inside it and leave the artwork showing
   * through a band down one side.
   */
  .ink {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  /*
   * Fill is set inline via `style:fill` on the element, not here — see the
   * comment above the `<text class="start-number">` markup for why a class
   * rule can't be trusted to win against `.space text` below.
   */
  .start-number {
    font-family: var(--card-font-name, sans-serif);
    font-weight: 700;
  }

  .note {
    font-family: var(--card-font-title, sans-serif);
    white-space: pre;
    paint-order: stroke;
  }

  .space text {
    fill: var(--map-label-ink, #10100f);
    font-family: var(--card-font-name, sans-serif);
    /* The label is set in the model's units, so it cannot be given a px size. */
    paint-order: stroke;
  }

  .lit circle {
    filter: drop-shadow(0 0 0.004px var(--accent));
  }

  .pending {
    stroke: var(--accent, #c0392b);
    stroke-dasharray: 0.012 0.012;
  }
</style>
