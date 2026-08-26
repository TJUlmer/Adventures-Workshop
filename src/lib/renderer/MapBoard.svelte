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

  /**
   * The printed board's paths carry a faint, *feathered* outer glow —
   * recreated in the reference Photoshop file as a 5px stroke, added
   * outside the path's own line, blurred, and set to Soft Light blend.
   * Getting this to actually reach an export took three separate fixes,
   * each one hiding the next — worth keeping all three, because each looks
   * exactly like success until it is photographed.
   *
   * **1. Blurred with CSS `filter: blur()`, never SVG's own
   * `<feGaussianBlur>` element.** `export/card-image.ts`'s `rasterise()`
   * loads the assembled markup as an `<img src="data:image/svg+xml,…">`,
   * and an SVG used *as an image* is a browser security boundary: a
   * `filter="url(#…)"` reference to a `<defs><filter>` element renders fine
   * on screen and then renders as nothing at all once photographed — not
   * unblurred, *gone*, because an unresolvable filter reference drops the
   * whole element rather than falling back to no filter. Confirmed with a
   * minimal repro both ways: identical markup, `<feGaussianBlur>` draws
   * nothing where the line should be, `style="filter:blur(…)"` draws it
   * correctly. The two are indistinguishable inline in a browser tab, which
   * is exactly what let the first version of this ship looking right and
   * export blank.
   *
   * **2. The blur radius is computed from a width the caller already knows,
   * never measured off this component's own mounted DOM.** It has to be an
   * absolute `px` number — confirmed by rasterising the same `blur(8px)`
   * line at two sizes and measuring an identical 7-pixel spread in *output*
   * pixels each time, ten times narrower as a fraction of the board at the
   * larger size — and a relative unit that needs a browser layout step to
   * resolve (`cqw` was the first attempt) is not safe to read back
   * immediately after: the clone is built, sized and frozen in one
   * synchronous burst, and that resolution step is not guaranteed to have
   * run by the time it does. `renderWidth` (below) is `photographMapBoard`
   * handing over a number it already has, before this component ever
   * mounts — a synchronous prop, not something resolved after the fact.
   *
   * **3. The glow's own geometry is drawn in a *locally rescaled* coordinate
   * space, not directly in the board's `0..1` viewBox units everything else
   * here uses.** This is the one that cost the most time, because both (1)
   * and (2) can be individually fixed, individually confirmed correct by
   * inspecting the exact frozen markup, and the glow *still* fails to
   * render — because the actual cause is neither: a `filter` on an element
   * whose own untransformed geometry is tiny (a `0..1`-unit board is
   * `stroke-width="0.0046"`) but whose *rendered* size is enormous (a few
   * thousand print pixels) fails silently the moment it is also nested
   * inside a `foreignObject`, which every element in this file already is.
   * Confirmed by holding every other variable fixed and varying only the
   * viewBox scale: the identical blurred stroke, foreignObject-nested,
   * renders correctly at `viewBox="0 0 400 200"` and renders nothing at
   * `viewBox="0 0 1 0.5"`. `.paths-glow` below is wrapped in
   * `<g transform="scale(1 / boardWidth)">`, with its own path data and
   * stroke width built in pixel-scale numbers by `segmentPath(segment,
   * boardWidth)` rather than the plain `segmentPath(segment, 1)` `.paths`
   * uses — so *within its own local space*, before that transform folds it
   * back down to fit the board, the glow's geometry is close to 1:1 with
   * its final rendered size, the same relationship `viewBox="0 0 400 200"`
   * had to its own 400×200 render. The blur radius itself needs no such
   * rescaling: `filter:blur()`'s length is measured in output pixels
   * regardless of any ancestor `transform`, confirmed by the same repro
   * showing an identical spread with and without the wrapping `scale()`.
   *
   * Neither ratio below is a measured constant — nothing in this codebase's
   * own assets pins down what canvas the reference "5px" was drawn against —
   * so these are a starting point for a visual check against the reference
   * board, not a template measurement the way `DEFAULT_PATH_WIDTH` is.
   */
  const PATH_GLOW_WIDTH_RATIO = 1.1;
  const PATH_GLOW_BLUR_RATIO = 0.6;
  /** White, gently lifting whatever is beneath rather than tinting it — the
      Soft Light blend does the rest; a coloured glow would tint the board. */
  const PATH_GLOW_COLOR = '#ffffff';

  interface Props {
    map: AdventureMap;
    /** Drawn under the spaces, so the editor can highlight without redrawing. */
    highlight?: MapSpaceId[];
    /** Being linked from, in the editor. Drawn as a pending endpoint. */
    linking?: MapSpaceId | null;
    /**
     * The board's rendered pixel width, when the caller already knows it —
     * `photographMapBoard` always does, since it sizes its off-screen host
     * to this exact width *before* mounting `MapBoard` into it. Passed
     * explicitly rather than measured, because measuring costs an
     * `$effect`/`ResizeObserver` round trip that is not guaranteed to have
     * settled by the time an export clones the DOM a single `await tick()`
     * later — see the doc comment above `PATH_GLOW_BLUR_RATIO`. Left
     * `undefined` for on-screen callers (the editor, the overview), which
     * have no such number to hand over and fall back to measuring instead.
     */
    renderWidth?: number;
  }

  let { map, highlight = [], linking = null, renderWidth }: Props = $props();

  /*
   * `.board`'s own rendered width, in real pixels — what turns the glow
   * blur's ratio (a fraction of the board, like every other measurement
   * here) into a plain, resolved `px` value. See the doc comment above
   * `PATH_GLOW_BLUR_RATIO` for why this needs to be an absolute pixel
   * number rather than a CSS length unit the browser resolves on its own.
   *
   * Measuring is the *fallback*, for a caller with no `renderWidth` to give
   * — the editor and the overview, whose layout can genuinely change this
   * element's width after the fact (a narrower window, the side panel
   * resizing), so it is read live via `ResizeObserver` rather than once on
   * mount. `photographMapBoard` skips all of this by passing `renderWidth`
   * straight through: see that prop's own doc comment for why measuring
   * cannot be trusted to have finished in time for an export.
   */
  let boardEl = $state<HTMLDivElement | null>(null);
  let measuredWidth = $state(0);
  $effect(() => {
    if (renderWidth !== undefined) return;
    if (!boardEl) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) measuredWidth = entry.contentRect.width;
    });
    observer.observe(boardEl);
    measuredWidth = boardEl.getBoundingClientRect().width;
    return () => observer.disconnect();
  });
  const boardWidth = $derived(renderWidth ?? measuredWidth);

  const height = $derived(mapHeight(map));
  const radius = $derived(map.spaceDiameter / 2);
  const strokeWidth = $derived(map.spaceDiameter * 0.029);
  const pathWidth = $derived(map.spaceDiameter * 0.055);
  const pathGlowWidth = $derived(pathWidth * PATH_GLOW_WIDTH_RATIO);
  const pathGlowBlurPx = $derived(pathWidth * PATH_GLOW_BLUR_RATIO * boardWidth);

  const highlighted = $derived(new Set(highlight));

  /**
   * Paths as SVG `d` strings — a quadratic bezier always, even a straight one,
   * so a curved and an uncurved path share one drawing code path rather than
   * forking between `<line>` and `<path>`.
   *
   * Trimmed to the circles at each end rather than drawn centre-to-centre and
   * hidden behind the discs, because a space is not always fully opaque —
   * `spaceOpacity` can fade its fill, and even at full opacity a wedge can be
   * a light colour — and a line crossing under either shows through as a
   * chord. Stopping the curve at the edge means there is nothing to show
   * through.
   *
   * The control point for a straight path (`curve: 0`) sits exactly on the
   * segment's own midpoint, which is what makes the trim math below reduce to
   * the old straight-line trim exactly rather than needing its own case: the
   * direction from a space's centre *toward the control point* is the
   * direction a quadratic bezier actually departs in, and for a control point
   * on the straight line that direction is the same one the old code trimmed
   * along by hand.
   */
  interface Segment {
    id: string;
    x1: number;
    y1: number;
    cx: number;
    cy: number;
    x2: number;
    y2: number;
  }

  const segments = $derived.by(() => {
    const out: Segment[] = [];
    for (const path of map.paths) {
      const a = findSpace(map, path.from);
      const b = findSpace(map, path.to);
      if (!a || !b) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      // Two spaces dropped on the same point have no direction to trim along.
      if (length === 0) continue;

      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      // Perpendicular to a→b, so `curve` bows the path off to one side.
      const perpX = -dy / length;
      const perpY = dx / length;
      const bow = path.curve * length;
      const controlX = midX + perpX * bow;
      const controlY = midY + perpY * bow;

      const trim = (fromX: number, fromY: number): { x: number; y: number } => {
        const tdx = controlX - fromX;
        const tdy = controlY - fromY;
        const tlength = Math.hypot(tdx, tdy);
        // The control point can coincide with a centre only when both spaces
        // do too, which the `length === 0` guard above already ruled out.
        if (tlength === 0) return { x: fromX, y: fromY };
        return { x: fromX + (tdx / tlength) * radius, y: fromY + (tdy / tlength) * radius };
      };

      const start = trim(a.x, a.y);
      const end = trim(b.x, b.y);
      out.push({ id: path.id, x1: start.x, y1: start.y, cx: controlX, cy: controlY, x2: end.x, y2: end.y });
    }
    return out;
  });

  /**
   * A segment's `d` string, its numbers optionally multiplied up by `scale`
   * first — what lets `.paths-glow` draw the exact same geometry inside its
   * own pixel-scale local space (see that group's own comment) while `.paths`
   * keeps drawing it directly in the board's tiny `0..1` viewBox units.
   */
  function segmentPath(segment: Segment, scale: number): string {
    return (
      `M ${segment.x1 * scale} ${segment.y1 * scale} ` +
      `Q ${segment.cx * scale} ${segment.cy * scale} ${segment.x2 * scale} ${segment.y2 * scale}`
    );
  }

  /**
   * One wedge of a split space, as a path.
   *
   * A single-zone space short-circuits to a plain circle rather than a 360°
   * arc: an arc that starts and ends at the same point is degenerate and
   * renders as nothing at all, which would make every ordinary space invisible.
   *
   * `space.rotation` offsets both edges by the same amount, so it turns the
   * whole split rather than resizing any one wedge — the point of a
   * rotation control rather than moving the space's own zone boundaries by
   * hand.
   */
  function wedge(space: MapSpace, index: number, count: number): string {
    const offset = (space.rotation * Math.PI) / 180;
    const start = (index / count) * Math.PI * 2 - Math.PI / 2 + offset;
    const end = ((index + 1) / count) * Math.PI * 2 - Math.PI / 2 + offset;
    const x1 = space.x + Math.cos(start) * radius;
    const y1 = space.y + Math.sin(start) * radius;
    const x2 = space.x + Math.cos(end) * radius;
    const y2 = space.y + Math.sin(end) * radius;
    const large = end - start > Math.PI ? 1 : 0;
    return `M ${space.x} ${space.y} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`;
  }
</script>

<div class="board" bind:this={boardEl} style:aspect-ratio="{map.aspect} / 1">
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
    {#if boardWidth > 0}
      <!--
        `transform="scale(1 / boardWidth)"` is what makes this group's own
        geometry pixel-scale rather than the board's usual `0..1` fraction —
        see point 3 of the doc comment above `PATH_GLOW_WIDTH_RATIO` for why
        a blurred element drawn directly at that fractional scale silently
        fails to render once nested in a `foreignObject`, which every export
        this app makes already does. `segmentPath(segment, boardWidth)`
        builds this group's own path data to match: multiplied up by
        `boardWidth` first, then folded back down to the board's own
        coordinate system by this `transform`, landing in exactly the same
        place `.paths` draws its own (unscaled) copy of the same geometry.
      -->
      <g transform="scale({1 / boardWidth})">
        <g
          class="paths-glow"
          fill="none"
          stroke={PATH_GLOW_COLOR}
          stroke-width={pathGlowWidth * boardWidth}
          stroke-linecap="round"
          style:filter="blur({pathGlowBlurPx}px)"
        >
          {#each segments as segment (segment.id)}
            <path d={segmentPath(segment, boardWidth)} />
          {/each}
        </g>
      </g>
    {/if}

    <g
      class="paths"
      fill="none"
      stroke={map.pathColor}
      stroke-width={pathWidth}
      stroke-linecap="round"
    >
      {#each segments as segment (segment.id)}
        <path d={segmentPath(segment, 1)} />
      {/each}
    </g>

    {#each map.spaces as space (space.id)}
      <g class="space" class:lit={highlighted.has(space.id)}>
        <!--
          Opacity on its own group, wrapping only the fill — the outline,
          label and start marker drawn below stay fully opaque regardless of
          `spaceOpacity`, so the board still reads clearly with the artwork
          showing through a faded space.
        -->
        <g opacity={map.spaceOpacity}>
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
        </g>

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
   * `mix-blend-mode` blends against whatever paints behind it in the same
   * stacking context — here, `.art` sitting behind this SVG in the DOM —
   * which is exactly the "Soft Light" Photoshop stroke effect this
   * reproduces. Nothing establishes an isolated stacking context between the
   * two (no `isolation: isolate`, no `opacity`/`transform`/`filter` on
   * `.ink` or an ancestor), which is what a blend needs to reach past its own
   * element and see the artwork underneath rather than only its SVG siblings.
   */
  .paths-glow {
    mix-blend-mode: soft-light;
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
