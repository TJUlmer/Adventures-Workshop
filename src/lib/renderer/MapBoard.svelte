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
  import type {
    AdventureMap,
    MapSpace,
    MapSpaceId,
    MapStartSide
  } from '$lib/map/types';
  import { findSpace, mapHeight } from '$lib/map/types';
  import type { CustomSymbol } from '$lib/symbols/types';
  import type { PatternSource } from './assets';
  import {
    getCachedPatternSource,
    getCachedRasterSource,
    getCachedRecolouredRasterSource,
    getCachedSvgSource,
    loadPatternSource,
    loadRasterSource,
    loadRecolouredRasterSource,
    loadSvgSource,
    MAP_ASSETS,
    patternAspect
  } from './assets';

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
  const START_MARKER_HALF = 0.15;

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

  /**
   * The black attack +1 tag in `assets/resources/map-reference` measures
   * approximately 0.4 space-diameters wide by 0.2 high against the supplied
   * Marmoreal source. Ratios to `spaceDiameter`, rather than pixels, keep the
   * mark at the same table-readable scale when an author changes space size.
   * The crop itself is reference only and never shipped: this native geometry
   * stays sharp and follows a curved path's midpoint and tangent at any export
   * resolution.
   */
  const BLACK_MODIFIER_WIDTH_RATIO = 0.42;
  const BLACK_MODIFIER_HEIGHT_RATIO = 0.2;
  const BLACK_MODIFIER_STROKE_RATIO = 0.009;

  /**
   * Measured against the same roughly 243px Marmoreal spaces as the black
   * modifier: the arrow's outlined shaft is about 9% of a space diameter,
   * its orange core 4.5%, and its head about 18% wide. The generated extension
   * uses `map.oneWayColor`; the clean destination assembly retains the supplied
   * source pixels so its antialiasing and uninterrupted outline stay exact.
   */
  /** Manual thickness controls: outer is the complete black-edged shaft;
      inner is the orange core painted over it. Keep inner below outer. */
  const ONE_WAY_OUTER_WIDTH_RATIO = 0.09;
  const ONE_WAY_INNER_WIDTH_RATIO = 0.045;
  const ONE_WAY_HEAD_WIDTH_RATIO = 0.18;
  const ONE_WAY_HEAD_LENGTH_RATIO = 0.22;
  /** All three supplied pieces share a 10px orange shaft. Scaling from the
      generated core width makes their joins agree even if path thickness is
      tuned later. */
  const ONE_WAY_ASSET_SHAFT_ORANGE_WIDTH = 10;
  const ONE_WAY_ARROWHEAD_SPRITE = {
    width: 48,
    height: 48,
    pointY: 0
  } as const;
  const ONE_WAY_MODIFIER_SPRITE = {
    width: 48,
    height: 67
  } as const;
  const ONE_WAY_MODIFIER_TEXT_SPRITE = {
    width: 31,
    height: 48
  } as const;
  /** The blank body's orange area is centred 2.7 source pixels tailward of
      its canvas centre. Three pixels aligns the insert visually, and applying
      the sign before rotation keeps that correction tailward in either direction. */
  const ONE_WAY_MODIFIER_TEXT_OFFSET = 3;
  const CURVE_LENGTH_SAMPLES = 64;

  /** The orange combat lozenge is narrower than the black pointed tag because
      the arrow path itself already carries the direction cue. */
  const ORANGE_MODIFIER_WIDTH_RATIO = 0.23;
  const ORANGE_MODIFIER_HEIGHT_RATIO = 0.16;
  const ORANGE_MODIFIER_STROKE_RATIO = 0.01;

  /** The supplied exact pin is 48px square and measures just under half a
      printed space diameter in the official map crop. */
  const LARGE_FIGHTER_SIZE_RATIO = 0.46;

  /**
   * The official Naglfar and cropped Marmoreal references put a portal
   * medallion at roughly one quarter of a space's diameter, centred exactly
   * on the space edge. Each space owns its own outward tail because matching
   * endpoints can sit anywhere on the board and need not point at each other.
   * The tail is sampled rather than painted through an SVG gradient reference:
   * opacity then follows its own curve and introduces no unproven image-context
   * URL in the export pipeline.
   */
  const SECRET_PASSAGE_RADIUS_RATIO = 0.13;
  const SECRET_PASSAGE_STROKE_RATIO = 0.058;
  const SECRET_PASSAGE_TAIL_LENGTH_RATIO = 0.9;
  const SECRET_PASSAGE_SAMPLES = 24;
  /** Measured from the supplied ring's outer contour rather than inferred from
      its canvas: the circle is centred at (37.5, 31.5) with a 32px radius, and
      the asymmetric remaining width is the tail join. Centre and radius must
      stay separate or correcting registration also changes the rendered size. */
  const SECRET_PASSAGE_SPRITE = {
    width: 75,
    height: 64,
    centreX: 37.5,
    centreY: 31.5,
    radius: 32,
    /** Alpha-weighted centres of the two protruding point clusters form this
        axis in the source PNG; compensating it aligns the visible points,
        rather than the rectangular canvas, to the owning space. */
    pointAxisDegrees: 29.51
  } as const;

  /**
   * A zone's pattern (`MapZoneStyle`) is drawn as a second shape, the same
   * geometry as the wedge it decorates, filled with an SVG `<pattern>` and
   * laid over the plain colour underneath — same layering `.paths-glow`
   * already uses over `.paths`, just for a fill instead of a stroke.
   *
   * **Recoloured by string substitution on the pattern's own source, not by
   * masking.** The obvious technique — draw the pattern shape once, mask a
   * coloured rect through it with CSS `mask-image` — was tried first and
   * does not survive being applied to *SVG* content: `getComputedStyle`
   * resolves an unstyled SVG element's `mask-type` to `luminance`, and a
   * pattern file drawn as "a solid black shape on a transparent background"
   * is *invisible* under luminance masking — black has zero luminance and
   * transparent has zero alpha, so every pixel evaluates to fully masked,
   * regardless of `mask-mode: alpha` set to try to override it. Confirmed
   * against the real export pipeline, not just on screen. Fetching the
   * pattern's own markup once and replacing its `fill="#…"` with whatever
   * colour the zone wants sidesteps masking (and the whole luminance
   * question) entirely — the recoloured shape *is* the colour, the same way
   * `recolor()` in `MapEditor.svelte` rewrites a colour by editing the
   * document rather than layering a tint over it.
   *
   * SVG's native `<pattern>` element — unlike its `<filter>` element, see
   * `PATH_GLOW_WIDTH_RATIO`'s own doc comment above — does survive this
   * app's `<img>`-context export pipeline; confirmed with a minimal repro
   * before building any of this on top of it.
   *
   * The fetch-and-parse step (`renderer/assets.ts`'s `loadPatternSource`) is
   * async and shared/cached module-wide, same as every asset load here —
   * but reading its result to actually draw a `<pattern>` def is *not* done
   * by awaiting a promise in an effect. `photographMapBoard` renders through
   * a single `await tick()` after mounting this component, which is not
   * long enough to guarantee a network fetch has resolved — confirmed the
   * same way `renderWidth` was: a real export photographed with the zone's
   * pattern silently missing, despite the exact same map rendering it
   * correctly on screen a moment later once the fetch had caught up.
   * `photographMapBoard` now pre-warms every pattern name a map's zones use
   * *before* mounting `MapBoard` at all, so `getCachedPatternSource` below
   * already has a synchronous answer on this component's very first render
   * whenever the caller can arrange that — the same "hand over what you
   * already know, don't make the component wait to find out" fix as
   * `renderWidth`. The on-screen editor cannot pre-warm anything (it does
   * not know in advance which pattern an author is about to pick), so
   * `patternLoadTick` below exists purely to give it a reactive nudge once a
   * fetch it *did* have to wait for finishes.
   */
  let patternLoadTick = $state(0);
  let largeFighterLoadTick = $state(0);
  let oneWayArrowLoadTick = $state(0);
  let secretPassageLoadTick = $state(0);

  /** Every `fill="#…"` in the source recoloured to one colour — the pattern
      files are single-colour shapes on transparency, drawn to take exactly
      this kind of substitution (see `cards/style.ts`'s `PatternStyle`). */
  function recolorPattern(source: PatternSource, color: string): string {
    return source.inner.replace(/fill="#[0-9a-fA-F]{3,8}"/g, `fill="${color}"`);
  }

  /** A stable, attribute-safe id for one zone's `<pattern>` def. */
  function zonePatternId(uid: string, color: string): string {
    return `zone-pattern-${uid}-${color.replace(/[^0-9a-zA-Z]/g, '')}`;
  }

  /** A fraction of the board's own width — the pattern tile's "natural"
      size before a zone's own `scale` multiplies it, chosen to read at a
      similar scale to a card's own pattern tiles rather than measured off
      anything (the map has no printed pattern to measure against). */
  const ZONE_PATTERN_BASE_TILE = 0.05;

  interface Props {
    map: AdventureMap;
    /** Set-wide uploaded glyphs available to per-space portal markers. */
    customSymbols?: CustomSymbol[];
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

  let { map, customSymbols = [], highlight = [], linking = null, renderWidth }: Props = $props();

  /* Unique per mounted instance, so this component's own `<pattern>` defs
     never collide with another `MapBoard`'s — the editor, a hover preview
     and an off-screen export copy can all be mounted at once. Same reason
     the glow's own `<filter>` needed one before that became a `<g
     transform>` instead; patterns still need real `<defs>` ids. */
  const uid = $props.id();

  /** Starts (or joins) a fetch for every pattern name a zone currently asks
      for that isn't cached yet, and nudges `patternLoadTick` once each one
      settles — the reactive dependency that makes `zonePatternDefs` below
      re-read `getCachedPatternSource` once a fetch this instance actually
      had to wait for finishes. A caller that pre-warmed the cache (see
      `patternLoadTick`'s own doc comment) never needs this to fire at all:
      `loadPatternSource` resolves such a name synchronously-fast, but still
      only ever calls back on a microtask, so the very first render always
      reads `getCachedPatternSource` directly rather than waiting on this. */
  $effect(() => {
    for (const zone of map.zoneStyles) {
      const name = zone.patternName;
      if (!name || getCachedPatternSource(name) !== undefined) continue;
      void loadPatternSource(name).then(() => {
        patternLoadTick += 1;
      });
    }
  });

  $effect(() => {
    if (!map.paths.some((path) => path.largeFighter)) return;
    if (getCachedSvgSource(MAP_ASSETS.largeFighterPin) !== undefined) return;
    void loadSvgSource(MAP_ASSETS.largeFighterPin).then(() => {
      largeFighterLoadTick += 1;
    });
  });

  $effect(() => {
    if (!map.paths.some((path) => path.oneWay)) return;
    const urls: string[] = [MAP_ASSETS.oneWayArrowhead];
    if (map.paths.some((path) => path.oneWay && path.modifier)) {
      urls.push(MAP_ASSETS.oneWayArrowModifier, MAP_ASSETS.oneWayArrowModifierText);
    }
    for (const url of urls) {
      if (getCachedRasterSource(url) !== undefined) continue;
      void loadRasterSource(url).then(() => {
        oneWayArrowLoadTick += 1;
      });
    }
  });

  $effect(() => {
    for (const space of map.spaces) {
      const passage = space.secretPassage;
      if (!passage) continue;
      const hasCustomSymbol = customSymbols.some((symbol) => symbol.id === passage.symbolId);
      const requests: Array<Promise<string | null>> = [];
      if (
        getCachedRecolouredRasterSource(
          MAP_ASSETS.secretPassageRing,
          passage.color
        ) === undefined
      ) {
        requests.push(loadRecolouredRasterSource(MAP_ASSETS.secretPassageRing, passage.color));
      }
      if (
        !hasCustomSymbol &&
        getCachedRecolouredRasterSource(
          MAP_ASSETS.secretPassageKeyhole,
          map.pathColor,
          map.pathColor,
          'dark-only'
        ) === undefined
      ) {
        requests.push(
          loadRecolouredRasterSource(
            MAP_ASSETS.secretPassageKeyhole,
            map.pathColor,
            map.pathColor,
            'dark-only'
          )
        );
      }
      for (const request of requests) {
        void request.then(() => {
          secretPassageLoadTick += 1;
        });
      }
    }
  });

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
  const blackModifierWidth = $derived(map.spaceDiameter * BLACK_MODIFIER_WIDTH_RATIO);
  const blackModifierHeight = $derived(map.spaceDiameter * BLACK_MODIFIER_HEIGHT_RATIO);
  const blackModifierStroke = $derived(map.spaceDiameter * BLACK_MODIFIER_STROKE_RATIO);
  const oneWayOuterWidth = $derived(map.spaceDiameter * ONE_WAY_OUTER_WIDTH_RATIO);
  const oneWayInnerWidth = $derived(map.spaceDiameter * ONE_WAY_INNER_WIDTH_RATIO);
  const oneWayAssetScale = $derived(oneWayInnerWidth / ONE_WAY_ASSET_SHAFT_ORANGE_WIDTH);
  const oneWayHeadWidth = $derived(map.spaceDiameter * ONE_WAY_HEAD_WIDTH_RATIO);
  const oneWayHeadLength = $derived(map.spaceDiameter * ONE_WAY_HEAD_LENGTH_RATIO);
  /* Match the shaft's black border rather than giving the triangle its own,
     visibly thinner outline. This is the per-side difference between the two
     concentric shaft strokes. */
  const oneWayHeadInset = $derived((oneWayOuterWidth - oneWayInnerWidth) / 2);
  const orangeModifierWidth = $derived(map.spaceDiameter * ORANGE_MODIFIER_WIDTH_RATIO);
  const orangeModifierHeight = $derived(map.spaceDiameter * ORANGE_MODIFIER_HEIGHT_RATIO);
  const orangeModifierStroke = $derived(map.spaceDiameter * ORANGE_MODIFIER_STROKE_RATIO);
  const largeFighterSize = $derived(map.spaceDiameter * LARGE_FIGHTER_SIZE_RATIO);
  const secretPassageRadius = $derived(map.spaceDiameter * SECRET_PASSAGE_RADIUS_RATIO);
  const secretPassageStroke = $derived(map.spaceDiameter * SECRET_PASSAGE_STROKE_RATIO);
  const secretPassageAssetScale = $derived(
    secretPassageRadius / SECRET_PASSAGE_SPRITE.radius
  );
  const secretPassageTailLength = $derived(
    map.spaceDiameter * SECRET_PASSAGE_TAIL_LENGTH_RATIO
  );

  const highlighted = $derived(new Set(highlight));
  const largeFighterSource = $derived.by(() => {
    void largeFighterLoadTick;
    return getCachedSvgSource(MAP_ASSETS.largeFighterPin) ?? null;
  });
  const oneWayArrowSources = $derived.by(() => {
    void oneWayArrowLoadTick;
    return {
      arrowhead: getCachedRasterSource(MAP_ASSETS.oneWayArrowhead) ?? null,
      modifier: getCachedRasterSource(MAP_ASSETS.oneWayArrowModifier) ?? null,
      modifierText: getCachedRasterSource(MAP_ASSETS.oneWayArrowModifierText) ?? null
    };
  });

  interface ZonePatternDef {
    id: string;
    opacity: number;
    viewBox: string;
    tileWidth: number;
    tileHeight: number;
    /** Raw SVG markup for the tile's contents — see `loadPatternSource`'s own
        doc comment for why this is a string substitution rather than a mask. */
    content: string;
  }

  /**
   * One `<pattern>` def per zone that currently has something to draw —
   * skipped entirely for a zone with neither `patternName` nor
   * `customSource` set (the ordinary, patternless case), and for a
   * `patternName` whose source hasn't resolved in `getCachedPatternSource`
   * yet — the wedge just shows its plain colour alone until it does, never
   * a broken reference. Keyed by lower-cased colour, matching every other
   * colour lookup in this file, so a wedge's own fill finds its zone's
   * pattern (if it has one) with one `Map.get`.
   */
  const zonePatternDefs = $derived.by(() => {
    // A reactive dependency, not a value this needs — see its own doc
    // comment for why `getCachedPatternSource` below, a plain module-level
    // read, needs something to make this block re-run once a pattern this
    // instance had to wait for finally resolves.
    void patternLoadTick;

    const defs = new Map<string, ZonePatternDef>();
    for (const zone of map.zoneStyles) {
      const tile = ZONE_PATTERN_BASE_TILE * zone.scale;
      if (zone.customSource) {
        defs.set(zone.color.toLowerCase(), {
          id: zonePatternId(uid, zone.color),
          opacity: zone.opacity,
          viewBox: '0 0 1 1',
          tileWidth: tile,
          tileHeight: tile,
          content: `<image href="${zone.customSource}" width="1" height="1" preserveAspectRatio="xMidYMid slice" />`
        });
      } else if (zone.patternName) {
        const source = getCachedPatternSource(zone.patternName);
        if (!source) continue;
        defs.set(zone.color.toLowerCase(), {
          id: zonePatternId(uid, zone.color),
          opacity: zone.opacity,
          viewBox: source.viewBox,
          tileWidth: tile,
          tileHeight: tile * patternAspect(zone.patternName),
          content: recolorPattern(source, zone.patternColor)
        });
      }
    }
    return defs;
  });

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
    oneWay: boolean;
    modifier: boolean;
    largeFighter: boolean;
    modifierX: number;
    modifierY: number;
    /** Kept within -90°..90° so the printed value never turns upside down. */
    modifierAngle: number;
    /** Which local end points towards `to`; -1 mirrors the tag, not its text. */
    modifierDirection: 1 | -1;
    largeFighterX: number;
    largeFighterY: number;
    /** The orange shaft is a properly trimmed subcurve. Both ends are flat:
        the first meets its space rim and the second meets the arrowhead base. */
    oneWayShaftX1: number;
    oneWayShaftY1: number;
    oneWayShaftCx: number;
    oneWayShaftCy: number;
    oneWayShaftX: number;
    oneWayShaftY: number;
    /** Raw arrival tangent: the arrowhead turns freely and carries no text. */
    endAngle: number;
  }

  interface CurvePoint {
    x: number;
    y: number;
  }

  interface CurveArcTable {
    distances: number[];
    total: number;
  }

  function quadraticPoint(
    start: CurvePoint,
    control: CurvePoint,
    end: CurvePoint,
    t: number
  ): CurvePoint {
    const inverse = 1 - t;
    return {
      x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
      y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y
    };
  }

  function quadraticTangent(
    start: CurvePoint,
    control: CurvePoint,
    end: CurvePoint,
    t: number
  ): CurvePoint {
    return {
      x: (1 - t) * (control.x - start.x) + t * (end.x - control.x),
      y: (1 - t) * (control.y - start.y) + t * (end.y - control.y)
    };
  }

  /** A small fixed table makes placements follow distance along a bowed route,
      rather than treating its bezier parameter as though it were a ruler. */
  function curveArcTable(start: CurvePoint, control: CurvePoint, end: CurvePoint): CurveArcTable {
    const distances = [0];
    let previous = start;
    let total = 0;
    for (let index = 1; index <= CURVE_LENGTH_SAMPLES; index += 1) {
      const point = quadraticPoint(start, control, end, index / CURVE_LENGTH_SAMPLES);
      total += Math.hypot(point.x - previous.x, point.y - previous.y);
      distances.push(total);
      previous = point;
    }
    return { distances, total };
  }

  function curveTAtDistance(table: CurveArcTable, distance: number): number {
    const target = Math.min(table.total, Math.max(0, distance));
    for (let index = 1; index < table.distances.length; index += 1) {
      const current = table.distances[index];
      const previous = table.distances[index - 1];
      if (current === undefined || previous === undefined || current < target) continue;
      const span = current - previous;
      const fraction = span > 0 ? (target - previous) / span : 0;
      return (index - 1 + fraction) / CURVE_LENGTH_SAMPLES;
    }
    return 1;
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
      const control = { x: controlX, y: controlY };
      const arcTable = curveArcTable(start, control, end);

      const arrowheadLength = oneWayArrowSources.arrowhead
        ? (ONE_WAY_ARROWHEAD_SPRITE.height - ONE_WAY_ARROWHEAD_SPRITE.pointY) *
          oneWayAssetScale
        : oneWayHeadLength;

      /* The modifier centre is halfway through the visible shaft, measured by
         real curve length from its origin rim to the arrowhead shoulder. */
      const headBaseDistance = Math.max(0, arcTable.total - arrowheadLength);
      const modifierT = path.oneWay
        ? curveTAtDistance(arcTable, headBaseDistance / 2)
        : 0.5;
      const modifierPoint = quadraticPoint(start, control, end, modifierT);
      const modifierTangent = quadraticTangent(start, control, end, modifierT);
      /* When both decorations are active, keep their centres apart along the
         real curve instead of stacking one unreadably over the other. */
      const largeFighterT = path.modifier ? 0.68 : 0.5;
      const largeFighterInverse = 1 - largeFighterT;
      const largeFighterX =
        largeFighterInverse * largeFighterInverse * start.x +
        2 * largeFighterInverse * largeFighterT * controlX +
        largeFighterT * largeFighterT * end.x;
      const largeFighterY =
        largeFighterInverse * largeFighterInverse * start.y +
        2 * largeFighterInverse * largeFighterT * controlY +
        largeFighterT * largeFighterT * end.y;
      const tangentX = modifierTangent.x;
      const tangentY = modifierTangent.y;
      const endAngle = (Math.atan2(end.y - controlY, end.x - controlX) * 180) / Math.PI;
      /* Butt caps end on their centreline, so the subcurve begins at the first
         rim. At the far end it overlaps half its outline beneath the reference
           sprite's own shaft; the raster assembly hides that join while De
           Casteljau preserves the route's actual bow up to it. */
      const shaftStartT = 0;
      const shaftEndT = Math.max(
        shaftStartT,
        curveTAtDistance(
          arcTable,
          Math.max(0, arcTable.total - arrowheadLength + oneWayOuterWidth / 2)
        )
      );
      const shaftStart = quadraticPoint(start, control, end, shaftStartT);
      const shaftEnd = quadraticPoint(start, control, end, shaftEndT);
      const shaftStartTangent = quadraticTangent(start, control, end, shaftStartT);
      const shaftSpan = shaftEndT - shaftStartT;
      const shaftControl = {
        x: shaftStart.x + shaftSpan * shaftStartTangent.x,
        y: shaftStart.y + shaftSpan * shaftStartTangent.y
      };
      let modifierAngle = (Math.atan2(tangentY, tangentX) * 180) / Math.PI;
      let modifierDirection: 1 | -1 = 1;
      if (modifierAngle > 90) {
        modifierAngle -= 180;
        modifierDirection = -1;
      } else if (modifierAngle < -90) {
        modifierAngle += 180;
        modifierDirection = -1;
      }

      out.push({
        id: path.id,
        x1: start.x,
        y1: start.y,
        cx: controlX,
        cy: controlY,
        x2: end.x,
        y2: end.y,
        oneWay: path.oneWay,
        modifier: path.modifier,
        largeFighter: path.largeFighter,
        modifierX: modifierPoint.x,
        modifierY: modifierPoint.y,
        modifierAngle,
        modifierDirection,
        largeFighterX,
        largeFighterY,
        oneWayShaftX1: shaftStart.x,
        oneWayShaftY1: shaftStart.y,
        oneWayShaftCx: shaftControl.x,
        oneWayShaftCy: shaftControl.y,
        oneWayShaftX: shaftEnd.x,
        oneWayShaftY: shaftEnd.y,
        endAngle
      });
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

  /** One-way shaft only: its endpoint sits beneath the arrowhead's back edge. */
  function oneWayShaftPath(segment: Segment): string {
    return (
      `M ${segment.oneWayShaftX1} ${segment.oneWayShaftY1} ` +
      `Q ${segment.oneWayShaftCx} ${segment.oneWayShaftCy} ` +
      `${segment.oneWayShaftX} ${segment.oneWayShaftY}`
    );
  }

  /** Rounded at the tail and pointed in the direction the +1 applies. */
  function blackModifierTagPath(direction: 1 | -1, width: number, height: number): string {
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const tip = height * 0.42;
    const corner = height * 0.14;
    const x = (value: number): number => value * direction;
    return (
      `M ${x(-halfWidth + corner)} ${-halfHeight} ` +
      `L ${x(halfWidth - tip)} ${-halfHeight} ` +
      `L ${x(halfWidth)} 0 ` +
      `L ${x(halfWidth - tip)} ${halfHeight} ` +
      `L ${x(-halfWidth + corner)} ${halfHeight} ` +
      `Q ${x(-halfWidth)} ${halfHeight} ${x(-halfWidth)} ${halfHeight - corner} ` +
      `L ${x(-halfWidth)} ${-halfHeight + corner} ` +
      `Q ${x(-halfWidth)} ${-halfHeight} ${x(-halfWidth + corner)} ${-halfHeight} Z`
    );
  }

  /** The printed attack burst, authored as geometry so no raster reference ships. */
  function attackBurstPoints(cx: number, outer: number, inner: number): string {
    const points: string[] = [];
    for (let index = 0; index < 24; index += 1) {
      const angle = (index * Math.PI) / 12;
      const radius = index % 2 === 0 ? outer : inner;
      points.push(`${cx + Math.cos(angle) * radius},${Math.sin(angle) * radius}`);
    }
    return points.join(' ');
  }

  /** A small chevron inside the pointed end, matching the reference's direction cue. */
  function modifierChevronPath(direction: 1 | -1, width: number, height: number): string {
    const x = direction * width * 0.29;
    const dx = width * 0.045;
    const dy = height * 0.23;
    return (
      `M ${x - direction * dx} ${-dy} ` +
      `L ${x + direction * dx} 0 ` +
      `L ${x - direction * dx} ${dy}`
    );
  }

  /**
   * The outer copy supplies the black perimeter and the inner copy supplies
   * orange up to the head's open back. Both share the same base x-coordinate:
   * retreating the orange base draws a black bar across the shaft/head join,
   * while the official arrow is one continuous orange shape outlined only on
   * its outside silhouette.
   */
  function oneWayArrowHeadPath(length: number, width: number, inset: number): string {
    const outerHalf = width / 2;
    if (inset <= 0 || outerHalf <= 0 || length <= 0) {
      return `M 0 0 L ${-length} ${-outerHalf} L ${-length} ${outerHalf} Z`;
    }

    /* Inset all three triangle edges by the same physical amount. Merely
       subtracting `inset` from its x/y coordinates leaves almost no black at
       the point and does not read as the same outline as the shaft. */
    const slopeLength = Math.hypot(length, outerHalf);
    const tip = -Math.min(length, (inset * slopeLength) / outerHalf);
    const base = -length;
    const half = Math.max(0, outerHalf - (inset * slopeLength) / length);
    return `M ${tip} 0 L ${base} ${-half} L ${base} ${half} Z`;
  }

  /**
   * Only the arrowhead's two exposed rear shoulders are outlined. Closing the
   * line across the shaft would recreate the tiny black crossbar at the join;
   * omitting the shoulders entirely makes the head look pasted over the shaft.
   */
  function oneWayArrowHeadShoulders(length: number, width: number, shaftWidth: number): string {
    const halfHead = width / 2;
    const halfShaft = shaftWidth / 2;
    return (
      `M ${-length} ${-halfHead} L ${-length} ${-halfShaft} ` +
      `M ${-length} ${halfShaft} L ${-length} ${halfHead}`
    );
  }

  /** Symmetric, chamfered body from the orange modifier reference crops. */
  function orangeModifierTagPath(width: number, height: number): string {
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const chamfer = height * 0.16;
    return (
      `M ${-halfWidth + chamfer} ${-halfHeight} ` +
      `L ${halfWidth - chamfer} ${-halfHeight} ` +
      `L ${halfWidth} ${-halfHeight + chamfer} ` +
      `L ${halfWidth} ${halfHeight - chamfer} ` +
      `L ${halfWidth - chamfer} ${halfHeight} ` +
      `L ${-halfWidth + chamfer} ${halfHeight} ` +
      `L ${-halfWidth} ${halfHeight - chamfer} ` +
      `L ${-halfWidth} ${-halfHeight + chamfer} Z`
    );
  }

  interface SecretPassagePortal {
    id: MapSpaceId;
    ringAngle: number;
    x: number;
    y: number;
    cx: number;
    cy: number;
    tailX: number;
    tailY: number;
    fade: number;
    color: string;
    ringSource: string | null;
    keyholeSource: string | null;
    symbolSource: string | null;
  }

  /**
   * One independently aimed portal per marked space. The medallion centre is
   * exactly one radius from the space centre; its tail continues outwards from
   * that point and bows perpendicular to the chosen angle, so neither endpoint
   * has to know where its visual partner sits.
   */
  const secretPassages = $derived.by(() => {
    void secretPassageLoadTick;
    const portals: SecretPassagePortal[] = [];
    for (const space of map.spaces) {
      const passage = space.secretPassage;
      if (!passage) continue;
      const angle = (passage.angle * Math.PI) / 180;
      const directionX = Math.cos(angle);
      const directionY = Math.sin(angle);
      const x = space.x + directionX * radius;
      const y = space.y + directionY * radius;
      /* Values through the former maximum retain their exact geometry and
         fade. Above 1 the tail itself grows, so 200% really is twice the old
         maximum length and still reaches transparency at its endpoint. */
      const tailScale = Math.max(1, passage.fade);
      const tailLength = secretPassageTailLength * tailScale;
      const tailX = x + directionX * tailLength;
      const tailY = y + directionY * tailLength;
      const sideways = passage.curve * tailLength * 0.55;
      const controlX = (x + tailX) / 2 - directionY * sideways;
      const controlY = (y + tailY) / 2 + directionX * sideways;
      /* The ring describes which space owns the passage, so its pointed axis
         remains radial to that space. Tail curve bends only the fading route
         beyond it and must not rotate the medallion artwork. */
      const ringAngle = passage.angle - SECRET_PASSAGE_SPRITE.pointAxisDegrees;
      const symbolSource =
        customSymbols.find((symbol) => symbol.id === passage.symbolId)?.source ?? null;
      portals.push({
        id: space.id,
        ringAngle,
        x,
        y,
        cx: controlX,
        cy: controlY,
        tailX,
        tailY,
        fade: Math.min(1, passage.fade),
        color: passage.color,
        ringSource:
          getCachedRecolouredRasterSource(MAP_ASSETS.secretPassageRing, passage.color) ?? null,
        keyholeSource: symbolSource
          ? null
          : (getCachedRecolouredRasterSource(
              MAP_ASSETS.secretPassageKeyhole,
              map.pathColor,
              map.pathColor,
              'dark-only'
            ) ?? null),
        symbolSource
      });
    }
    return portals;
  });

  function pointOnSecretPassage(
    portal: SecretPassagePortal,
    t: number
  ): { x: number; y: number } {
    const inverse = 1 - t;
    return {
      x: inverse * inverse * portal.x + 2 * inverse * t * portal.cx + t * t * portal.tailX,
      y: inverse * inverse * portal.y + 2 * inverse * t * portal.cy + t * t * portal.tailY
    };
  }

  interface SecretPassagePiece {
    d: string;
    opacity: number;
  }

  /**
   * One outward fade expressed as short curve-following strokes. Dividing its
   * progress by the author's fade length makes a smaller value disappear
   * sooner; fully-transparent pieces are omitted rather than drawn.
   */
  function secretPassagePieces(portal: SecretPassagePortal): SecretPassagePiece[] {
    const pieces: SecretPassagePiece[] = [];
    for (let index = 0; index < SECRET_PASSAGE_SAMPLES; index += 1) {
      const t1 = index / SECRET_PASSAGE_SAMPLES;
      const t2 = (index + 1) / SECRET_PASSAGE_SAMPLES;
      const middle = (t1 + t2) / 2;
      const opacity = Math.max(0, 1 - middle / portal.fade);
      if (opacity <= 0) continue;
      const from = pointOnSecretPassage(portal, t1);
      const to = pointOnSecretPassage(portal, t2);
      pieces.push({ d: `M ${from.x} ${from.y} L ${to.x} ${to.y}`, opacity });
    }
    return pieces;
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
    {#if zonePatternDefs.size > 0}
      <defs>
        {#each [...zonePatternDefs.values()] as def (def.id)}
          <pattern
            id={def.id}
            patternUnits="userSpaceOnUse"
            width={def.tileWidth}
            height={def.tileHeight}
            viewBox={def.viewBox}
          >
            {@html def.content}
          </pattern>
        {/each}
      </defs>
    {/if}

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
          stroke-linecap="round"
          style:filter="blur({pathGlowBlurPx}px)"
        >
          {#each segments as segment (segment.id)}
            {#if !segment.oneWay}
              <path
                d={segmentPath(segment, boardWidth)}
                stroke-width={pathGlowWidth * boardWidth}
              />
            {/if}
          {/each}
        </g>
      </g>
    {/if}

    <g
      class="paths"
      fill="none"
      stroke-linecap="round"
    >
      {#each segments as segment (segment.id)}
        {#if segment.oneWay}
          <path
            class="one-way-outline"
            d={oneWayShaftPath(segment)}
            stroke={map.pathColor}
            stroke-width={oneWayOuterWidth}
            stroke-linecap="butt"
          />
          <path
            class="one-way-fill"
            d={oneWayShaftPath(segment)}
            stroke={map.oneWayColor}
            stroke-width={oneWayInnerWidth}
            stroke-linecap="butt"
          />
        {:else}
          <path
            class="ordinary-path"
            d={segmentPath(segment, 1)}
            stroke={map.pathColor}
            stroke-width={pathWidth}
          />
        {/if}
      {/each}
    </g>

    <!--
      Explicit geometry rather than `marker-end="url(#…)"`: an SVG marker
      reference would introduce another image-context reference whose export
      behaviour has not been proven (filters already fail there; see above).
      The endpoint tangent is known, so a plain transformed path is both safer
      and exactly aligned to a curved route.
    -->
    <g class="one-way-heads">
      {#each segments as segment (segment.id)}
        {#if segment.oneWay}
          <g transform="translate({segment.x2} {segment.y2}) rotate({segment.endAngle})">
            {#if oneWayArrowSources.arrowhead}
              <!-- The tight source points upward. Its first opaque row lands
                   on the destination rim and its cropped shaft continues back
                   over the generated route, hiding their antialiased join. -->
              <image
                class="one-way-reference-tip"
                href={oneWayArrowSources.arrowhead}
                x="0"
                y="0"
                width={ONE_WAY_ARROWHEAD_SPRITE.width}
                height={ONE_WAY_ARROWHEAD_SPRITE.height}
                preserveAspectRatio="none"
                transform="scale({oneWayAssetScale}) rotate(90) translate({-ONE_WAY_ARROWHEAD_SPRITE.width / 2} {-ONE_WAY_ARROWHEAD_SPRITE.pointY})"
              />
            {:else}
              <!-- Static assets resolve immediately in production; this keeps
                   the editor legible during the first local fetch or if that
                   file is ever missing. -->
              <path
                class="one-way-head-outline"
                d={oneWayArrowHeadPath(oneWayHeadLength, oneWayHeadWidth, 0)}
                fill={map.pathColor}
              />
              <path
                class="one-way-head-fill"
                d={oneWayArrowHeadPath(oneWayHeadLength, oneWayHeadWidth, oneWayHeadInset)}
                fill={map.oneWayColor}
              />
              <rect
                class="one-way-head-join"
                x={-oneWayHeadLength - oneWayHeadInset}
                y={-oneWayInnerWidth / 2}
                width={oneWayHeadInset * 2}
                height={oneWayInnerWidth}
                fill={map.oneWayColor}
              />
              <path
                class="one-way-head-shoulders"
                d={oneWayArrowHeadShoulders(oneWayHeadLength, oneWayHeadWidth, oneWayOuterWidth)}
                fill="none"
                stroke={map.pathColor}
                stroke-width={oneWayHeadInset * 2}
                stroke-linecap="butt"
              />
            {/if}
          </g>
        {/if}
      {/each}
    </g>

    <!--
      Above the line it modifies, below the endpoint spaces. A curve can be
      any length or bow: each tag uses a distance measured along its actual
      bezier and the tangent at that point, calculated alongside the path.
    -->
    <g class="path-modifiers">
      {#each segments as segment (segment.id)}
        {#if segment.modifier}
          {@const direction = segment.modifierDirection}
          <g
            class="path-modifier"
            transform="translate({segment.modifierX} {segment.modifierY}) rotate({segment.modifierAngle})"
          >
            {#if segment.oneWay}
              {#if oneWayArrowSources.modifier && oneWayArrowSources.modifierText}
                <!-- The body mirrors with path direction; the text does not.
                     Keeping the outer group within ±90° and always giving the
                     insert its supplied 90° turn keeps +1 readable when the
                     arrow reverses. -->
                <image
                  class="one-way-modifier-segment"
                  href={oneWayArrowSources.modifier}
                  x="0"
                  y="0"
                  width={ONE_WAY_MODIFIER_SPRITE.width}
                  height={ONE_WAY_MODIFIER_SPRITE.height}
                  preserveAspectRatio="none"
                  transform="scale({oneWayAssetScale}) scale({direction} 1) rotate(90) translate({-ONE_WAY_MODIFIER_SPRITE.width / 2} {-ONE_WAY_MODIFIER_SPRITE.height / 2})"
                />
                <image
                  class="one-way-modifier-text"
                  href={oneWayArrowSources.modifierText}
                  x="0"
                  y="0"
                  width={ONE_WAY_MODIFIER_TEXT_SPRITE.width}
                  height={ONE_WAY_MODIFIER_TEXT_SPRITE.height}
                  preserveAspectRatio="none"
                  transform="scale({oneWayAssetScale}) rotate(90) translate({-ONE_WAY_MODIFIER_TEXT_SPRITE.width / 2} {-ONE_WAY_MODIFIER_TEXT_SPRITE.height / 2 + direction * ONE_WAY_MODIFIER_TEXT_OFFSET})"
                />
              {:else}
                <path
                  class="orange-modifier-body"
                  d={orangeModifierTagPath(orangeModifierWidth, orangeModifierHeight)}
                  fill={map.oneWayColor}
                  stroke={map.pathColor}
                  stroke-width={orangeModifierStroke}
                  stroke-linejoin="round"
                />
                <line
                  x1="0"
                  y1={-orangeModifierHeight * 0.3}
                  x2="0"
                  y2={orangeModifierHeight * 0.3}
                  stroke={map.pathColor}
                  stroke-width={orangeModifierStroke * 0.75}
                  stroke-linecap="round"
                />
                <text
                  class="path-modifier-value"
                  x={-direction * orangeModifierWidth * 0.23}
                  y="0"
                  font-size={orangeModifierHeight * 0.52}
                  text-anchor="middle"
                  dominant-baseline="central"
                  style:fill={map.pathColor}
                >+1</text>
                <polygon
                  points={attackBurstPoints(
                    direction * orangeModifierWidth * 0.23,
                    orangeModifierHeight * 0.27,
                    orangeModifierHeight * 0.13
                  )}
                  fill={map.pathColor}
                />
              {/if}
            {:else}
              <path
                class="black-modifier-body"
                d={blackModifierTagPath(direction, blackModifierWidth, blackModifierHeight)}
                fill={map.pathColor}
                stroke={map.startInk}
                stroke-width={blackModifierStroke}
                stroke-linejoin="round"
              />
              <polygon
                points={attackBurstPoints(
                  -direction * blackModifierWidth * 0.22,
                  blackModifierHeight * 0.27,
                  blackModifierHeight * 0.13
                )}
                fill={map.startInk}
              />
              <text
                class="path-modifier-value"
                x={direction * blackModifierWidth * 0.035}
                y="0"
                font-size={blackModifierHeight * 0.58}
                text-anchor="middle"
                dominant-baseline="central"
                style:fill={map.startInk}
              >+1</text>
              <path
                d={modifierChevronPath(direction, blackModifierWidth, blackModifierHeight)}
                fill="none"
                stroke={map.startInk}
                stroke-width={blackModifierStroke * 1.25}
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            {/if}
          </g>
        {/if}
      {/each}
    </g>

    {#if largeFighterSource}
      <!-- Kept upright like the printed pin rather than following the path's
           tangent. The exact supplied paths are inlined so export has no
           external SVG reference to resolve. -->
      <g class="large-fighter-markers">
        {#each segments as segment (segment.id)}
          {#if segment.largeFighter}
            <svg
              class="large-fighter-marker"
              x={segment.largeFighterX - largeFighterSize / 2}
              y={segment.largeFighterY - largeFighterSize / 2}
              width={largeFighterSize}
              height={largeFighterSize}
              viewBox={largeFighterSource.viewBox}
              overflow="visible"
            >
              {@html largeFighterSource.inner}
            </svg>
          {/if}
        {/each}
      </g>
    {/if}

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
            {@const fill = space.zones[0] ?? { kind: 'solid', color: '#cfd3d6', color2: '#cfd3d6', angle: 180 }}
            {@const pattern = zonePatternDefs.get(fill.color.toLowerCase())}
            <circle cx={space.x} cy={space.y} r={radius} fill={fillCss(fill)} />
            {#if pattern}
              <circle cx={space.x} cy={space.y} r={radius} fill="url(#{pattern.id})" opacity={pattern.opacity} />
            {/if}
          {:else}
            {#each space.zones as zone, index (index)}
              {@const d = wedge(space, index, space.zones.length)}
              {@const pattern = zonePatternDefs.get(zone.color.toLowerCase())}
              <path {d} fill={fillCss(zone)} />
              {#if pattern}
                <path {d} fill="url(#{pattern.id})" opacity={pattern.opacity} />
              {/if}
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

    <!-- Back-to-front array order is the author-controlled z-order. These are
         deliberately after every space and before rule markers/text. -->
    <g class="environment-pieces">
      {#each map.environment as piece (piece.id)}
        {@const pieceHeight = piece.width / piece.aspect}
        <image
          class="environment-piece"
          data-environment-piece={piece.id}
          href={piece.source}
          x={piece.x - piece.width / 2}
          y={piece.y - pieceHeight / 2}
          width={piece.width}
          height={pieceHeight}
          opacity={piece.opacity}
          preserveAspectRatio="xMidYMid meet"
          transform="rotate({piece.rotation} {piece.x} {piece.y})"
        />
      {/each}
    </g>

    <!--
      Deliberately after `.space`: the official medallion straddles and covers
      the space outline at its own centrepoint. Each tail is independent, so a
      matching portal elsewhere can face or curve in an unrelated direction.
    -->
    <g class="secret-passages">
      {#each secretPassages as portal (portal.id)}
        <g
          class="secret-passage-fade"
          fill="none"
          stroke={portal.color}
          stroke-width={secretPassageStroke}
          stroke-linecap="butt"
        >
          {#each secretPassagePieces(portal) as piece, index (`${portal.id}-${index}`)}
            <path class="secret-passage-piece" d={piece.d} opacity={piece.opacity} />
          {/each}
        </g>

        <g
          class="secret-passage-medallion"
          transform="translate({portal.x} {portal.y})"
        >
          <circle
            class="secret-passage-medallion-fill"
            cx={secretPassageRadius * 0.03}
            cy={secretPassageRadius * 0.00}
            r={secretPassageRadius * 0.78}
            fill={portal.color}
          />
          {#if portal.ringSource}
            <image
              class="secret-passage-medallion-art"
              href={portal.ringSource}
              x={-SECRET_PASSAGE_SPRITE.centreX * secretPassageAssetScale}
              y={-SECRET_PASSAGE_SPRITE.centreY * secretPassageAssetScale}
              width={SECRET_PASSAGE_SPRITE.width * secretPassageAssetScale}
              height={SECRET_PASSAGE_SPRITE.height * secretPassageAssetScale}
              preserveAspectRatio="xMidYMid meet"
              transform="rotate({portal.ringAngle})"
            />
          {/if}
          {#if portal.keyholeSource}
            <image
              class="secret-passage-keyhole-symbol"
              href={portal.keyholeSource}
              x={-SECRET_PASSAGE_SPRITE.centreX * secretPassageAssetScale}
              y={-SECRET_PASSAGE_SPRITE.centreY * secretPassageAssetScale}
              width={SECRET_PASSAGE_SPRITE.width * secretPassageAssetScale}
              height={SECRET_PASSAGE_SPRITE.height * secretPassageAssetScale}
              preserveAspectRatio="xMidYMid meet"
            />
          {/if}
          {#if portal.symbolSource}
            <image
              class="secret-passage-custom-symbol"
              href={portal.symbolSource}
              x={-secretPassageRadius * 0.5}
              y={-secretPassageRadius * 0.5}
              width={secretPassageRadius}
              height={secretPassageRadius}
              preserveAspectRatio="xMidYMid meet"
            />
          {/if}
        </g>
      {/each}
    </g>

    {#each map.notes as note (note.id)}
      <!--
        `rotate` about the note's own anchor rather than the board's origin, so
        turning a note does not also fling it across the map.
      -->
      <text
        class="note"
        data-map-note={note.id}
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

  .path-modifier-value {
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
