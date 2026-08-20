/**
 * Card geometry, in bleed pixels.
 *
 * Every number here was measured off the alpha channel of the print templates,
 * so the live preview and a 300 DPI export share one coordinate system. The
 * renderer converts these to percentages of the card frame, which means the
 * same markup is correct at a 120px thumbnail and at full print size.
 */

/**
 * Physical card formats.
 *
 * Most print templates carry the same 3.28mm bleed on every edge, so the cut
 * line can be derived from the finished size rather than measured again per
 * template. A template drawn at trim size declares `bleedMm: 0` instead — see
 * `trimBox`.
 */
export const BLEED_MM = 3.28;

export interface CardFormat {
  /** Finished size, in millimetres. */
  readonly mm: { readonly width: number; readonly height: number };
  /** Template size in pixels, bleed included where the template has one. */
  readonly bleed: { readonly width: number; readonly height: number };
  /**
   * Bleed on each edge, in millimetres. Omitted means the standard `BLEED_MM`;
   * `0` means the template is drawn at trim size and has nothing to crop away.
   */
  readonly bleedMm?: number;
  readonly label: string;
}

export const CARD_FORMATS = {
  /** Standard poker. */
  action: { mm: { width: 63, height: 88 }, bleed: { width: 1632, height: 2222 }, label: '63 × 88 mm' },
  rules: { mm: { width: 63, height: 88 }, bleed: { width: 1632, height: 2218 }, label: '63 × 88 mm' },
  /** Mini European. */
  initiative: {
    mm: { width: 44, height: 67 },
    bleed: { width: 1524, height: 2232 },
    label: '44 × 67 mm'
  },
  /** Mini European, turned on its side. */
  event: {
    mm: { width: 67, height: 44 },
    bleed: { width: 2232, height: 1524 },
    label: '67 × 44 mm'
  },
  /** Deck back. The template is drawn at trim size, so it carries no bleed. */
  cardback: {
    mm: { width: 63, height: 88 },
    bleed: { width: 373, height: 520 },
    bleedMm: 0,
    label: '63 × 88 mm'
  }
} as const satisfies Record<string, CardFormat>;

/**
 * The villain's threat track. A single printed strip rather than a card, at
 * 300 DPI like everything else, and drawn at trim size.
 */
export const THREAT_TRACK = {
  mm: { width: 495, height: 70 },
  bleed: { width: 5846, height: 827 },
  bleedMm: 0,
  label: '495 × 70 mm'
} as const satisfies CardFormat;

/**
 * The rail the threat spaces sit in, in `cqw` of the strip.
 *
 * Measured off the rendered board rather than derived: the strip is laid out in
 * flex, so what the rail actually gets is the residue of the nameplate, the
 * burst, the slots and four gaps. The numbers here are what that residue came
 * to, and they are the reason a space can be a fixed size at all.
 *
 * `trackWidth` is the one figure that is a *decision* rather than an
 * observation. The track used to take whatever was left after the slots, and
 * the slots' own width follows their text — a `field-sizing: content` textarea
 * with a long note pulled 10cqw out of the rail, which moved how many spaces
 * fit. A printed region cannot reflow because an author typed a longer caption,
 * and a cap on spaces cannot be a constant unless the room for them is one, so
 * the track claims its share first and the slots divide what is left.
 */
export const THREAT_RAIL = {
  /** The track's fixed share of the strip, nameplate and burst aside. */
  trackWidth: 48,
  /** What is left for spaces once the arrow and the rail's padding come out. */
  spacesWidth: 36,
  /** A space's printed height. Its width follows from the hexagon. */
  spaceHeight: 4.5,
  /**
   * Pointy-top regular hexagon: vertex at top and bottom, and a vertical edge
   * either side. The spaces once sat flush; a small gap between them now reads
   * as separate pieces, and the arrow still butts the last space (the gap is
   * between spaces, not before the arrow — see `.space + .space`).
   */
  hexRatio: 0.8660254,
  /**
   * The gap between two hexes, in `cqw`.
   *
   * Halved from 0.55. The spaces keep their printed size and simply sit closer,
   * which shortens the run from 35.0cqw to 33.1cqw and shifts everything after
   * the first space left. The cap is unaffected — eight still fit, with more
   * room to spare than before.
   */
  spaceGap: 0.275,
  /**
   * Outline weight, as a percentage inset on the fill. A percentage rather than
   * a length because that is what makes the outline uniform on all six edges —
   * see `ThreatBoard.svelte`. Thinned from 11.5: the heavy stroke swallowed too
   * much of a small space's fill.
   */
  strokeInset: 7.5
} as const;

/** One space's printed width, in `cqw` of the strip. */
export const THREAT_SPACE_WIDTH = THREAT_RAIL.spaceHeight * THREAT_RAIL.hexRatio;

/**
 * How many spaces the rail holds before they would have to shrink.
 *
 * The count is capped rather than the spaces resized: a space is a printed
 * dimension, and a track whose spaces changed size when a neighbour was added
 * was the complaint that produced all of this. The gap between spaces counts
 * against the room — `n` spaces need `n·width + (n−1)·gap` — so the cap solves
 * for the largest `n` that still fits `spacesWidth`.
 */
export const THREAT_MAX_SPACES = Math.floor(
  (THREAT_RAIL.spacesWidth + THREAT_RAIL.spaceGap) /
    (THREAT_SPACE_WIDTH + THREAT_RAIL.spaceGap)
);

export type CardFormatName = keyof typeof CARD_FORMATS;

export interface TrimBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The cut line for a format, derived from its finished size. */
export function trimBox(format: CardFormat): TrimBox {
  const bleedMm = format.bleedMm ?? BLEED_MM;

  // A template drawn at trim size *is* the cut line — cropping it would zoom in.
  if (bleedMm === 0) {
    return { x: 0, y: 0, width: format.bleed.width, height: format.bleed.height };
  }

  const scale = format.bleed.width / (format.mm.width + bleedMm * 2);
  const width = format.mm.width * scale;
  const height = format.mm.height * scale;
  return {
    x: (format.bleed.width - width) / 2,
    y: (format.bleed.height - height) / 2,
    width,
    height
  };
}

/** Full print size of an action card, including bleed. */
export const BLEED = CARD_FORMATS.action.bleed;

/** Cut line for an action card. */
export const TRIM = trimBox(CARD_FORMATS.action);

/** Inside the printed border — where art and body live. Measured. */
export const INTERIOR = { x: 143, y: 143, width: 1346, height: 1937 } as const;
export const INTERIOR_RADIUS = 46;

/**
 * How far a card's interior fill runs *under* the printed border.
 *
 * The border mask and the interior are drawn to meet exactly, so at some zooms
 * the two boxes round to positions a fraction of a pixel apart and the plate
 * behind them shows through as a hairline. Bleeding the fill outwards costs
 * nothing — the border is painted over it — and there is no width at which the
 * seam can open.
 */
export const CHROME_SEAM = 6;

/**
 * Divider between the art window and the body panel. Measured.
 *
 * `y` is where the print template puts it, which is where it sits on a card
 * whose copy fits. A card that needs more room moves it *up*: the body panel is
 * anchored to the bottom of the interior and grows into the art window.
 */
export const DIVIDER = { y: 1204, height: 19 } as const;

export const ART_WINDOW = {
  x: INTERIOR.x,
  y: INTERIOR.y,
  width: INTERIOR.width,
  height: DIVIDER.y - INTERIOR.y,
  /**
   * The floor the art window keeps whatever the copy asks for. This is the one
   * number that decides how far the panel may climb — raise it to hold the
   * printed proportions harder, lower it to let long cards set more type.
   */
  minHeight: 700
} as const;

/**
 * The body panel. Bottom-anchored: `y` and `height` are the printed default,
 * and the panel only leaves them when its copy will not fit.
 */
export const BODY_PANEL = {
  x: INTERIOR.x,
  y: DIVIDER.y + DIVIDER.height,
  width: INTERIOR.width,
  height: INTERIOR.y + INTERIOR.height - (DIVIDER.y + DIVIDER.height)
} as const;

/** How tall the panel may grow before the copy truncates instead. */
export const BODY_PANEL_MAX_HEIGHT =
  INTERIOR.height - DIVIDER.height - ART_WINDOW.minHeight;

/**
 * A position measured on the print template, as an offset inside the body
 * panel. Everything the panel carries is placed this way, so it all rides up
 * with the panel instead of being pinned to the card.
 */
export function inPanel(y: number): number {
  return y - BODY_PANEL.y;
}

/**
 * Name ribbon. Hangs from the top of the card and tapers to a point.
 *
 * Its length follows the name, so the art is used in two pieces. Everything
 * above `headTop` is a plain rectangle — the fill's full width, with the
 * border drawing only its right edge — which means the run can be any length
 * without stretching anything. Everything below is the pennant head, which has
 * shape and is placed at its natural size so the point keeps its proportions.
 *
 * Measured off the alpha of `banner_fill.png` and `banner_border.png`.
 */
export const BANNER = {
  x: 132,
  width: 230,
  /** The border's right edge, the only outline the straight run carries. */
  edge: { x: 345, width: 17 },
  /** First row of the pennant head, where the fill flares past the run. */
  headTop: 863
} as const;

/**
 * The pennant head: shoulder lip and taper, down to the point at y 948. Drawn
 * 1:1 from the art, so it translates with the ribbon rather than scaling.
 */
export const BANNER_HEAD = { x: 120, width: 242, height: 948 - BANNER.headTop + 1 } as const;

/**
 * How much card art sits below the head's last row.
 *
 * The head is masked with the whole card image anchored to the ribbon's bottom
 * edge rather than its top — the top is a fixed distance from the card, but the
 * bottom is wherever the name has pushed it. This is the offset that lands the
 * art's y 863 on the head's first row however long the ribbon has grown.
 */
export const BANNER_HEAD_BELOW = BLEED.height - (BANNER.headTop + BANNER_HEAD.height);

/**
 * Boost ring, on the divider near the right edge.
 *
 * The ring is drawn by the divider art, so these are the ring's own numbers,
 * read off the alpha channel of `inner_border.png`: a 16px stroke running from
 * `innerRadius` to `outerRadius`. It sits slightly high of the divider bar,
 * which is how the template is drawn.
 *
 * Trimmed 3px thinner than the divider's own natural weight (19px) — the ring
 * printed heavier than the rest of the line work around it, and the outer
 * edge is what the divider bar butts up against, so the trim comes off the
 * inner edge alone (`innerRadius` 70 → 73) rather than off both.
 */
export const BOOST = { cx: 1372, cy: 1200, innerRadius: 73, outerRadius: 89 } as const;

/**
 * Radius of the filled disc behind the boost value.
 *
 * Mid-stroke rather than flush with the ring's inner edge: the ring paints over
 * the disc, so tucking the disc under it means no hairline of body panel can
 * show through at the join, at any zoom.
 */
export const BOOST_DISC_RADIUS = (BOOST.innerRadius + BOOST.outerRadius) / 2;

/**
 * The ring's own box within the divider art.
 *
 * The divider is a plain bar everywhere else, so only this region is masked out
 * of `inner_border.png`; the bar itself is drawn. The art breaks the bar where
 * the ring's interior crosses it, so lifting out this box gives the ring plus
 * the two bar stubs meeting it — which is exactly what the bar draws anyway.
 */
export const BOOST_RING = {
  x: BOOST.cx - BOOST.outerRadius,
  y: BOOST.cy - BOOST.outerRadius,
  width: BOOST.outerRadius * 2,
  height: BOOST.outerRadius * 2
} as const;

/*
 * The measurements below were read off the ink in
 * `UMA_Action_Card_Template_bleed_Knockout.png` — the printed artwork, set in
 * the real face — not estimated from the picture, and never read off
 * `..._Oswald.png`, which is this renderer's own output and would only tell us
 * what we already did.
 */

/**
 * Card-face metrics, as fractions of the em. Measured from the loaded face
 * with canvas `TextMetrics`, which is what lets a cap-height position in the
 * print template be converted into a CSS box position exactly.
 */
export const FONT_METRICS = {
  cap: 0.672,
  digit: 0.688,
  ascent: 1.19,
  descent: 0.29
} as const;

/**
 * The same, for the face the name ribbon and the card title set in.
 *
 * A second set because those two moved to Bebas Neue and it does not share
 * Oswald's shape at all: its caps stand taller (0.703 against 0.672) and its
 * line box is a different animal entirely — 0.95 of ascent where Oswald has
 * 1.19. That last one is why this could not be waved through as "close enough".
 * `capTopToBoxTop` solves for the baseline inside the line box, so an ascent
 * out by a fifth puts the title tens of pixels off its measured position.
 *
 * Measured the same way as the set above: canvas `TextMetrics` on the loaded
 * face, which is what the browser will actually lay out.
 */
export const NAME_METRICS = {
  cap: 0.703,
  digit: 0.719,
  ascent: 0.95,
  descent: 0.35
} as const;

/**
 * Cap height of the face the *artwork* was set in.
 *
 * Every type size below was read off a print template set in Knockout HTF,
 * whose caps stand at 0.666em. Both stand-ins are now drawn to that same
 * figure — the browser measures 0.672 for each, which is 0.666 to within the
 * 1/64px its text metrics are quantised to — so the conversion below has all
 * but nothing left to do.
 *
 * That is a change worth understanding rather than deleting. Every earlier
 * stand-in kept Oswald's 0.81em caps, so a size read off the template had to be
 * shrunk by a fifth to print at the right height, and the leading and the
 * widths had to be reconstructed around that. All three now follow from the
 * face. The machinery stays because it is what makes the artwork's own numbers
 * readable at each call site, and because the next face swap will need it.
 */
const ARTWORK_CAP = 0.666;

/**
 * An artwork type size, converted to the size that prints the same cap height
 * in the face actually being used.
 *
 * The measured numbers stay visible at every call site — they are what someone
 * checking against the template will look for — and the substitution lives in
 * exactly one place. Swap the card face and this constant is the only thing
 * that moves.
 */
export const inFace = (artworkSize: number): number => (artworkSize * ARTWORK_CAP) / FONT_METRICS.cap;

/** As `inFace`, for the two roles set in the name face. See `NAME_METRICS`. */
export const inName = (artworkSize: number): number => (artworkSize * ARTWORK_CAP) / NAME_METRICS.cap;

/**
 * An artwork line height, converted for a size that has been through `inFace`.
 *
 * This is the other half of the substitution, and leaving it out was a mistake
 * worth keeping the name of: a CSS `line-height` is a multiple of the *font
 * size*, so when `inFace` shrank that size every line advance shrank with it —
 * measured, 69px of leading where the template sets 86, which is what made the
 * copy look cramped on every card.
 *
 * With a face cut to the artwork's own cap height there is nothing left to
 * restore, and the two cards whose leading had to be left uncorrected because
 * the correction clipped them (see `EVENT.copy`) no longer need the exception.
 */
const inFaceLeading = (artworkLineHeight: number): number =>
  (artworkLineHeight * FONT_METRICS.cap) / ARTWORK_CAP;

/**
 * CSS `top` for a text box whose cap height should start at `capTop`.
 * CSS positions the *line box*; the template measures ink.
 */
export function capTopToBoxTop(
  capTop: number,
  size: number,
  lineHeight = 1,
  metrics: typeof FONT_METRICS | typeof NAME_METRICS = FONT_METRICS
): number {
  const halfLeading = (lineHeight - (metrics.ascent + metrics.descent)) / 2;
  const baseline = halfLeading + metrics.ascent;
  return capTop - (baseline - metrics.cap) * size;
}

/** As above, for lining figures, which sit slightly taller than caps. */
export function digitTopToBoxTop(digitTop: number, size: number, lineHeight = 1): number {
  const halfLeading = (lineHeight - (FONT_METRICS.ascent + FONT_METRICS.descent)) / 2;
  const baseline = halfLeading + FONT_METRICS.ascent;
  return digitTop - (baseline - FONT_METRICS.digit) * size;
}

/**
 * CSS `top` for a box whose lining figures should sit *centred* on `y`.
 *
 * Not the same as centring the box, which is what `translate: -50%` does and
 * what the boost value used to do. Half-leading distributes evenly above and
 * below the line, but a digit does not sit in the middle of its own em — it
 * stands on the baseline, which is well below centre. Centring the box put the
 * boost value 12px low inside an 89px disc, and no line-height could fix it:
 * the box grows symmetrically, so the offset survives whatever you set.
 */
export function digitMiddleToBoxTop(y: number, size: number, lineHeight = 1): number {
  return digitTopToBoxTop(y - (FONT_METRICS.digit * size) / 2, size, lineHeight);
}

/*
 * Type sizes are the sizes used in the source artwork, in template pixels.
 * They are authoritative — the measured ink positions above tell the renderer
 * where to put the box, these tell it how big the type is.
 */

/*
 * `tracking` is the letter-spacing the printed artwork was set with, in em.
 *
 * It is here because it turned out to be most of what had looked, for three
 * face swaps running, like the face being wrong. Set at the template's own cap
 * heights, Knockout alone comes up 4% short of the printed ink on both the
 * title and the ability copy — and a stand-in drawn to Knockout's metrics comes
 * up the same 4% short, because it is *not* the face. The designer set the type
 * loose.
 *
 * It is spacing here too, rather than a horizontal stretch, because stretching
 * would fatten every stroke by 4% to imitate something that happened between
 * the letters rather than inside them.
 *
 * Per role and not shared: the title wants 0.012em and the ability copy 0.028em,
 * which is an ordinary thing for a designer to do — copy at a sixth of the
 * title's size is tracked out further to stay legible. Each value is solved from
 * its own template measurement, so give a new role its own rather than
 * borrowing one of these.
 */

/**
 * Card title. `capTop` is the top of the printed cap height.
 *
 * `size` is the artwork's, back-solved from ink: the template's title stands
 * 84px to the cap and Knockout's caps are 0.666em, so it was set at 126. It
 * read 120.5 here for a long time, which set the title 4% small.
 *
 * `condense` is what is left once the size and the tracking are right. Bebas
 * Neue sets "CARD TITLE" a little wide, so the face is squeezed — from its left
 * edge, which is where the title is anchored. Measured on the rendered face at
 * `size` with `tracking` applied: 411.2px against the template's 395.
 *
 * That 411.2 is **ink**, not advance, and the difference is not pedantry: the
 * same string measures 418.0 as a span, because a box carries the sidebearings
 * and the trailing letter-space and the template's 395 does not. Reading the
 * box would set `condense` to 0.945 and the title 1.7% narrow. Measure with
 * canvas `letterSpacing` and `actualBoundingBox*`, not `getBoundingClientRect`.
 *
 * Re-confirmed at 411.22px after the name face moved to `BebasNeue-Custom`,
 * which is unchanged here because none of the six glyphs it redraws appear in
 * "CARD TITLE". A title carrying a J *would* have moved — see `card-fonts.css`.
 *
 * Re-measure all three whenever the title's face changes, and note the history
 * before believing any of them: this read 395/408 against one stand-in and
 * 395/432 against another, each silently carrying a 4% size error and the
 * artwork's tracking as well as the face's own width.
 *
 * `lineHeight` is declared here rather than left in the stylesheet because
 * `capTopToBoxTop` needs the same number to place the box; the two drifting
 * apart is what set the title five pixels high.
 */
export const TITLE = {
  x: 219,
  capTop: 1284,
  width: 1150,
  size: inName(126),
  lineHeight: 0.9,
  tracking: 0.0122,
  condense: 395 / 411.2
} as const;

export const TITLE_RULE = { x: 220, y: 1406, width: 1193, height: 10 } as const;

/**
 * Where the title's own text box starts — the top of its *first* line box,
 * whether the title sets on one line or wraps to two. CSS stacks line boxes
 * of equal height under this point, so it never moves; only how far the text
 * runs below it does. Reused by `TITLE_RULE_GAP` and by `ActionCardFace`,
 * which used to compute this inline before the title could wrap.
 */
export const TITLE_BOX_TOP = capTopToBoxTop(TITLE.capTop, TITLE.size, TITLE.lineHeight, NAME_METRICS);

/**
 * Gap from the bottom of the title's first line to the rule beneath it —
 * measured once, at the single-line position the template was drawn to, and
 * from there on treated as a flow spacer rather than a fixed offset from the
 * panel's top.
 *
 * That distinction is the whole of how a title can wrap to a second line
 * without anything measuring the rendered text: `ActionCardFace` puts the
 * title in normal flow instead of pinning it at `TITLE_RULE.y`'s remove, so a
 * second line adds its own line-box height to the title and this gap — the
 * rule, the values, the ability text, everything from here down — simply
 * rides along after it. CSS already knows how many line boxes a wrapped
 * paragraph sets; nothing here needs to ask it.
 */
export const TITLE_RULE_GAP = TITLE_RULE.y - (TITLE_BOX_TOP + TITLE.size * TITLE.lineHeight);

/**
 * A position measured on the print template, as an offset below the title
 * rule rather than from the panel's top.
 *
 * The origin every element from the rule down is placed against, once the
 * title can wrap: their fixed offsets from the panel's top only ever
 * described where they sit *when the title is one line*, and using them
 * directly again would leave the rule pinned in place while the title grew
 * past it. See `TITLE_RULE_GAP`.
 */
export function belowTitleRule(y: number): number {
  return y - TITLE_RULE.y - TITLE_RULE.height;
}

/**
 * Attack / defense stack. Symbols are centred on one axis at their natural
 * size; numbers are left-aligned on a second axis, their digits sitting a few
 * pixels below the symbol's top edge.
 */
export const VALUE_STACK = {
  symbolCenterX: 262,
  numberX: 362,
  /** Top edge of the first row's symbol. */
  firstRowTop: 1444,
  rowPitch: 202,
  /** Digit top, relative to the row's top edge. */
  numberOffset: 7,
  numberSize: inFace(186)
} as const;

/**
 * Rule between the value stack and the ability text.
 *
 * `height` is the run on the print template, where a full card of copy is what
 * sets the length. The renderer treats it as a *maximum*: the rule stretches to
 * whichever column is taller, the values or the ability text, so it never
 * overshoots a short card. See `ActionCardFace`.
 */
export const ABILITY_RULE = { x: 484, y: 1451, width: 7, height: 414 } as const;

export const ABILITY = {
  x: 520,
  /** Cap height top of the first line. */
  capTop: 1466,
  /**
   * Runs out to the frame, inset by the interior's corner radius — far enough
   * that the copy keeps an optical margin off the border and clears the
   * rounded corner rather than being clipped by it.
   */
  width: INTERIOR.x + INTERIOR.width - INTERIOR_RADIUS - 520,
  /**
   * Clear space below the copy. Matched to the same radius, which also lands
   * the last line just above the copies count — the one thing sharing the
   * panel's bottom corner — so the two can never collide.
   */
  bottomInset: INTERIOR_RADIUS,
  /*
   * The template's leading I stands 57px, and Knockout's caps are 0.666em —
   * that measurement is 85.5, still the number `lineHeight` below is fitted
   * against. This is a deliberate step up from it rather than a re-measurement:
   * a side-by-side against the same card set in real Knockout HTF at print
   * size read a shade small here, and 90 is "a little bigger," not a new
   * measurement of the template's own ink.
   */
  size: inFace(90),
  /* Cap top to cap top on the template's three lines: 1466, 1550, 1634. */
  lineHeight: inFaceLeading(84 / 85.5),
  /*
   * Fitted to the template's own first line, "IMMEDIATELY: Deal 1 damage",
   * whose ink runs x 513..1326 — 814px. Measured in the browser with canvas
   * `letterSpacing` and `actualBoundingBox*`, because ink is what the template
   * is: 774.9px bare, +39.2 of tracking → 814.1.
   *
   * It read 0.0283 for a while, fitted when the face bare-measured 754.1. The
   * Junior file has been redrawn since and now sets 774.9 for the same line —
   * 2.8% wider — so the old tracking was being added to a face that no longer
   * needed as much of it, and the copy ran 2.6% long. Re-fit rather than
   * nudged: a tracking value is only ever right for the file it was measured
   * against, so it has to be re-derived whenever that file changes.
   *
   * Still no `condense`. Against Knockout HTF29 the face is 1.02% wide, which
   * is spacing rather than drawing — the two have identical cap stems (0.1429
   * of cap height each) — and squeezing the glyphs to fix a gap problem would
   * thin those stems away from the thing being matched. Expressed the other
   * way: Knockout would want 0.0222 here where this face wants 0.0185, and
   * that 3.7/1000em gap is the whole of the difference between them.
   */
  tracking: 0.0185
} as const;

/** Copies indicator, bottom right of the body panel. */
export const QUANTITY = { right: 1488, capTop: 2045, size: inFace(55) } as const;

/** Boost value, centred in the disc. */
/**
 * The boost value, centred in its disc.
 *
 * The template's "2" is 80px of ink and Knockout's flat lining figures stand
 * 0.681em, so the artwork set it at 117.5. It read 113.5.
 *
 * Rendered, that "2" comes out 77px rather than 80, and the three pixels are
 * worth understanding rather than dialling out: `inFace` matches *cap* heights,
 * and the two faces' digits do not agree quite as closely as their caps —
 * Oswald Custom Junior draws a flat digit at 0.661em against Knockout's 0.681.
 * Inflating the size to cover it would put a number here that the artwork never
 * used, and the next person to check it against the template would find it and
 * be right to.
 *
 * `FONT_METRICS.digit` is 0.688, which is a *round* digit — nought and three
 * overshoot the flat ones, and the MOVE badge's "3" lands on the template's
 * 310px because of it. So a flat digit sits about 1.5px high here and a round
 * one lands. That is the residue of one constant standing for a set of glyphs
 * that genuinely differ, and at 89px of disc radius it is not worth a second.
 *
 * `lineHeight` is declared here because `digitMiddleToBoxTop` needs the same
 * number the box is laid out with — the reason `TITLE.lineHeight` lives here
 * too. It was 0.72 in the stylesheet alone, an attempt to drag the digit up by
 * shrinking the box around it. That cannot work: the box grows and shrinks
 * symmetrically, so the digit does not move. It went 12px low regardless.
 */
export const BOOST_VALUE = { size: inFace(117.5), lineHeight: 1 } as const;

/**
 * Card name, set bottom-up inside the ribbon.
 *
 * The name is anchored at its *end* — the last character, nearest the frame —
 * and grows downward, which is what lets the ribbon be as long as the name and
 * no longer. `centerX` is the ribbon's own centre line, so the type stays on
 * the ribbon's axis however long it runs.
 */
export const NAME = {
  centerX: BANNER.x + BANNER.width / 2,
  /** Clear space between the border's inner edge and the end of the name. */
  borderGap: 79,
  /** Clear space between the start of the name and the pennant's shoulder. */
  headGap: 7,
  size: inName(140.5),
  /** Longest run of type the ribbon will set before it ellipsises. */
  maxLength: 700
} as const;

/** Where the name's last character sits, measured from the card's top edge. */
export const NAME_TOP = INTERIOR.y + NAME.borderGap;

/**
 * A hero card's own name line before the copies count — "Hero Name | x2"
 * rather than a bare "x2" — because the vertical ribbon that would otherwise
 * carry the name is busy with the combat symbol. Reuses `QUANTITY`'s size;
 * only the rule and the corner it sets in are new.
 *
 * It sits further in than the villain card's bare count, and that is the
 * frame's doing rather than the line's: the villain frame sweeps its bottom
 * right corner out to clear the count, and the hero frame takes the same
 * radius there as the other three. Measured off the ink in
 * `Hero_Action_Card_Template.png`, which ends at 1434 and stands 1991 rather
 * than the 1488 and 2045 the villain card's own template gives.
 */
export const OWNER_LINE = {
  ruleGap: 16,
  ruleWidth: 3,
  textGap: 16,
  right: 1440,
  /**
   * Twenty-one below the template's own 1991, which puts the line's descenders
   * about a dozen pixels clear of the frame's inner edge at 2076. The printed
   * line is set in Knockout, whose descenders sit higher than the stand-in's,
   * so matching the measured cap line left the copy floating in the panel
   * rather than sitting against its foot.
   */
  capTop: 2012
} as const;

/**
 * A hero's combat ribbon: one symbol and one value in a coloured head, who may
 * play the card in a navy tail, replacing the villain/minion ribbon's vertical
 * name.
 *
 * It is built the same way — a straight run the renderer draws as a plain
 * rectangle, so it can be any length, plus a pennant point placed at its
 * natural size and anchored to the run's foot — but from its own art:
 * `hero_combat_banner.png`, `hero_ribbon_point.png` and
 * `hero_ribbon_point_edge.png`, all lifted out of the supplied
 * `hero_action_card_border.png` by `tools/hero-card-assets.py`. The villain's
 * own files could not stand in: that ribbon is 230 wide against this one's
 * 243, and its head flares 12px left of the run where this one tapers
 * straight from the run's edges.
 *
 * What is genuinely different is the **head**. It is a fixed block at the top
 * of the ribbon carrying the combat symbol and its value, drawn over the run
 * in the symbol's own colour, and it does not move when the name below it
 * grows — so the seam between the two colours is the head's printed
 * **chevron** rather than a straight line, and the ribbon still lengthens with
 * its name exactly as every other action card's does.
 *
 * Every number below is read back off those derived masks, which are resampled
 * onto the action card's own 1632 × 2222 bleed — the supplied art is four rows
 * short of it — so they are bleed pixels like everything else here.
 */
export const HERO_RIBBON = {
  x: 147,
  /**
   * Body *and* stroke: 147..379 of colour, then the stroke's own 380..398.
   * Read off `hero_frame_plus_ribbon_stroke.png`, the supplied drawing of the
   * frame and the stroke together, which agrees with the printed template's
   * 148..380 of tail against cream at 381..401.
   */
  width: 252,
  /**
   * The ribbon's axis, and what the type sets on.
   *
   * *Not* the run's centre, which is 268.5. The pennant is drawn a little
   * asymmetrical and comes to its point at 262 — exactly where the supplied
   * `ribbon_guides.png` puts the guide the symbol, the value and the name are
   * all aligned to. Centring on the run instead walks all three 6px off the
   * point they sit above.
   */
  centerX: 262,
  /**
   * Flush with the frame's inner edge, so the ribbon reaches the border. It
   * used to hang from `NAME_TOP` — the clearance the villain ribbon's *name*
   * needs below the frame — which left it floating short of it.
   */
  top: 147,
  /** Where the head's chevron begins, and the run first shows either side. */
  headTaper: 477,
  /** The head's own point. Below here the ribbon is the name's to set. */
  headPoint: 549,
  /** The foot's own run, drawn 1:1 so its ∨ keeps its angle. */
  pointHeight: 87,
  /**
   * The stroke's weight, down the right edge and round the foot — never the
   * left or the top. It sits *outside* the colour rather than eaten out of it,
   * which is why the fill's own run mask stops this far short of the ribbon's
   * right edge.
   */
  edgeWidth: 19
} as const;

/**
 * How much card sits below the pennant point's last row.
 *
 * The point is masked with the whole card image anchored to the ribbon's
 * bottom rather than its top — the top is fixed, the bottom is wherever the
 * name has pushed it — so this is the offset that lands the art's own point on
 * the ribbon's however long it has grown. Exactly `BANNER_HEAD_BELOW`'s job.
 */
export const HERO_POINT_BELOW = BLEED.height - 935;

/**
 * The combat symbol, drawn white in the coloured head.
 *
 * `top` is the ink's, and each symbol file is already its own printed size —
 * see `CARD_SYMBOL_SIZES` — so a tall `scheme` simply reaches further down the
 * head, which is where the value it prints instead of would have gone.
 */
export const HERO_RIBBON_SYMBOL = { top: 187, centerX: HERO_RIBBON.centerX } as const;

/**
 * The combat value, under the symbol.
 *
 * The template's "3" stands 125px, and Knockout's lining figures are a shade
 * taller than its caps, so the artwork set it at 183.
 */
export const HERO_RIBBON_VALUE = { top: 370, size: inFace(183.3) } as const;

/**
 * Who-may-play text in the ribbon below the head: "ANY", or a short name. Set
 * vertically like the ribbon's own name is on every other action card, so the
 * same face and the same bottom-up reading direction carry over — see `.name`
 * in `ActionCardFace`.
 *
 * `top` is the guide the supplied `ribbon_guides.png` gives, and the ribbon
 * grows downward from it: the name is anchored at the head, which does not
 * move, and the point follows the name.
 */
export const HERO_RIBBON_OWNER = {
  top: 598,
  /** The template's letters stand 91px, which the name face sets at 136.5. */
  size: inName(136.5),
  lineHeight: 0.88,
  /** Clear space between the start of the name and the pennant's shoulder. */
  pointGap: 33,
  /**
   * Longest run of type the ribbon will set before it ellipsises. Chosen to
   * bring the point down no further than the hero card's own divider.
   */
  maxLength: 560
} as const;

/**
 * Where the name's box starts, measured across the ribbon.
 *
 * The type is set on its side, so this is the axis its *cap height* runs
 * along — and a line box is not centred on its caps. At `lineHeight` 0.88
 * against a face whose ascent and descent come to 1.30 the two sit 6.7px
 * apart, which is exactly the gap between what centring the box gives and the
 * template's 217. `capTopToBoxTop` solves that on the other axis and does not
 * care which axis it is asked about.
 */
export const HERO_RIBBON_OWNER_LEFT = capTopToBoxTop(
  HERO_RIBBON.centerX - (NAME_METRICS.cap * HERO_RIBBON_OWNER.size) / 2,
  HERO_RIBBON_OWNER.size,
  HERO_RIBBON_OWNER.lineHeight,
  NAME_METRICS
);

/**
 * A hero card's divider sits lower than a villain's — 1380 against 1204 — so
 * its body panel starts shallower and its art window keeps more of the card.
 * The panel is bottom-anchored either way, so this is only where it *starts*:
 * a card with more copy than fits still carries the divider up.
 */
export const HERO_DIVIDER_Y = 1380;

export const HERO_BODY_PANEL_HEIGHT =
  INTERIOR.y + INTERIOR.height - (HERO_DIVIDER_Y + DIVIDER.height);

/**
 * How much of the hero body panel's own foot its content has to leave clear
 * of OWNER_LINE.
 *
 * `.stack` is `bottom: 0` against the interior, always — `HERO_BODY_PANEL_HEIGHT`
 * only floors how far the panel may *shrink*, so a card with enough copy to
 * fill it regardless reaches the interior's own bottom (2080) no matter what
 * that floor is set to. Nothing about the hero frame keeps content off that
 * corner the way a villain's does: that frame sweeps its own bottom right
 * corner out to clear the printed count; the hero frame's corner takes the
 * same radius as its other three (see `HERO_RIBBON`'s own doc comment). This
 * is `padding-bottom` on `.body` instead — measured live, with the panel
 * grown to its maximum by a long enough ability: reaching all the way to
 * 2080 printed the body copy 83 bleed px into OWNER_LINE's own text, so 95
 * clears that with a further margin past it, not just past zero.
 */
export const HERO_BODY_PANEL_FOOT_CLEARANCE = 95;

/**
 * And the art window reaches down to meet it.
 *
 * Not optional: the window is a fixed height rather than "whatever is left",
 * so a panel that starts lower without this leaves a band of the bed's own
 * fill between the two — 176px of it, which reads as a printing fault rather
 * than as a design.
 */
export const HERO_ART_WINDOW_HEIGHT = HERO_DIVIDER_Y - INTERIOR.y;

/**
 * Split cards divide the body panel into an attack half and a defense half,
 * each with its own ability stack.
 *
 * The separator floats. Rather than computing its position, the halves are laid
 * out as a flex column: the lower half is sized by its content and the upper
 * half takes what is left, so the rule rises as the defense side fills up.
 * These are the constraints that layout works within.
 */
export const SPLIT = {
  /** Gap below the title rule, where the halves begin. */
  titleGap: 34,
  /** Inset above the panel's bottom edge, clear of the copies count. */
  bottom: 60,
  /**
   * Floor heights. They must leave room for the rule inside the space between
   * the title rule and the panel's bottom — about 569px — so a card with no
   * text still reads like the printed example without overflowing.
   */
  minUpper: 260,
  minLower: 156,
  /** Breathing room inside each half. */
  padding: 26
} as const;

/**
 * Where the halves begin. The title behaves the same split or not, so they
 * always start below the title rule and toggling split never moves it.
 */
export const SPLIT_TOP = TITLE_RULE.y + TITLE_RULE.height + SPLIT.titleGap;

/** The run the halves get on a card sitting at the printed divider position. */
export const SPLIT_DEFAULT_HEIGHT =
  BODY_PANEL.y + BODY_PANEL.height - SPLIT.bottom - SPLIT_TOP;

/**
 * The separator between the halves, drawn from `split_effect_separator.png`:
 * a flat bar whose ends curve upward into the printed frame, so the join reads
 * as moulded rather than butted.
 *
 * Only the bar takes part in layout. The shoulders rise above it, over the
 * upper half's outer corners, where nothing else is drawn.
 *
 * Measured off the file's alpha: the ink sits 6px in from the left edge and
 * runs 1356px — 5px past the interior window at each end. That overhang is
 * deliberate and matches the divider, which runs off the card entirely: the
 * outer border paints last and covers it, so no hairline can open where the
 * separator meets the frame.
 */
export const SPLIT_SEPARATOR = {
  /** Natural size of the file. */
  file: { width: 1375, height: 46 },
  /** Ink inset from the file's left edge. */
  inkX: 6,
  /** Ink width, wider than the interior window by design. */
  inkWidth: 1356,
  /** Top of the flat bar, from the file's top edge. */
  barTop: 28
} as const;

/** Height of the flat bar — all the separator occupies in the flex column. */
export const SPLIT_SEPARATOR_BAR = SPLIT_SEPARATOR.file.height - SPLIT_SEPARATOR.barTop;

/** How far the separator's ink runs past the interior window, each side. */
export const SPLIT_SEPARATOR_OVERHANG = (SPLIT_SEPARATOR.inkWidth - INTERIOR.width) / 2;

// -- Character card -------------------------------------------------------

/**
 * A hero's stat-reference card: attack type, health, move and special
 * ability the character already carries, plus a sidekick or a flavour quote.
 * Measured off the three `Hero_Character_Card_Template_*.png` files, which
 * agree on every band but the last.
 *
 * The chrome is the supplied `…_frame.png` art laid over the top, not masks
 * and not a redrawing of it. That art is *already* in the colours it prints —
 * pink border and band separators, the tab labels white on the navy bands and
 * black on the gold one, the health badge, the move arrow and the word MOVE —
 * and the character card is the one face here that does not go through the
 * style cascade, so there is nothing for a mask's recolourability to buy. What
 * the renderer supplies is the band fills beneath it and the copy in its
 * holes.
 *
 * It shares the action card's `BLEED` coordinate system: the same 63×88mm
 * card, at the same bleed pixel size. The templates are the four rows shorter
 * that all the supplied hero art is, and are laid over the plate at 100%, so
 * everything below is out by up to 0.2% against them — a fifth of a
 * millimetre at the card's foot, and nothing at all where the copy sits.
 */
export const CHARACTER_CARD = {
  /** The printed rectangle's bounds, cut from the surrounding bleed. */
  x: 144,
  y: 140,
  width: 1487 - 144,
  radius: INTERIOR_RADIUS,
  /** The narrow strip on the left of every band, carrying its vertical label. */
  tabWidth: 85,
  tabGap: 5,
  /**
   * How far a band fill runs past its own edges.
   *
   * The frame is a 2218-row picture laid over a 2222-row plate, so every hole
   * in it sits up to four rows below the y this file measured — which showed
   * as a hairline of the wrong colour along the foot of the gold band. The
   * fills overshoot into the separators instead, and the art's own pink paints
   * over the overshoot, so there is no width at which the seam can open.
   */
  fillBleed: 8
} as const;

/**
 * The three bands an author dresses, as one run each.
 *
 * The hero's name band and its attack row are one block here even though the
 * frame rules a line between them — see `CHARACTER_BAND_NAMES`. Each runs from
 * its first band's top to its last band's foot, and `fillBleed` carries the
 * fill past both.
 */
export const CHARACTER_BAND_RUNS = {
  hero: { top: 140, bottom: 606 },
  ability: { top: 630, bottom: 1588 },
  sidekick: { top: 1612, bottom: 2078 }
} as const;

/** Vertical run of each band, top to bottom. Gaps are the pink between them. */
export const CHARACTER_BANDS = {
  hero: { top: 140, height: 271 },
  heroAttack: { top: 422, height: 184 },
  ability: { top: 630, height: 958 },
  sidekick: { top: 1612, height: 272 },
  sidekickAttack: { top: 1895, height: 183 },
  /** Where the printed rectangle ends — also the quote panel's foot. */
  bottom: 2078
} as const;

/**
 * An attack-type row's inner columns: the type word and its icon, then the
 * health badge (or, on the sidekick's row, a token count instead).
 *
 * `contentX` and `healthLabelX` are the frame art's own holes, read off its
 * alpha at rows 300 and 1900.
 */
export const CHARACTER_ATTACK_ROW = {
  contentX: 234,
  contentRight: 1045,
  healthLabelX: 1056,
  healthLabelRight: 1200,
  badgeX: 1209,
  badgeRight: 1478
} as const;

/** The special-ability panel's ability column and its move column. */
export const CHARACTER_ABILITY_PANEL = {
  contentX: 234,
  contentRight: 1250,
  moveX: 1266,
  moveRight: 1478
} as const;

/**
 * The two band headings, HERO and SIDEKICK. Both sit the same distance below
 * their band's top — 66 and 67 — so one offset carries both.
 */
export const CHARACTER_HEADING = {
  x: 282,
  capTop: 66,
  /** Caps stand 165 in both templates. */
  size: inName(247.5)
} as const;

/**
 * Where an attack-type lockup starts. Its own size is in `ATTACK_TYPE_SIZES`
 * — the whole thing is one supplied picture, so there is nothing else here to
 * place.
 */
export const CHARACTER_ATTACK = { x: 282 } as const;

/**
 * Health, inside the badge the frame art draws. Both badges are at the same
 * x, and the digits are centred in each — measured, not assumed: the badge is
 * a shield with a point, so its ink centre and its box centre are not the same
 * thing, and it is the box the printed figure sits in.
 */
export const CHARACTER_HEALTH = {
  centerX: 1342,
  /**
   * The badge's ink centroid, not its box centre.
   *
   * It is a shield: full width for its top two thirds, then a taper to a
   * point. Centring the figure in the bounding box puts it eleven pixels low
   * of where it reads as centred, which is the whole of the difference between
   * 524 and this.
   */
  heroCenterY: 513,
  sidekickCenterY: 1983,
  /**
   * The single-tracked sidekick's own badge — a reused copy of the hero's
   * own (see `healthBadgeAt`) — defaults to the same X as its source. Its
   * own field rather than reading `centerX` directly, so it can move
   * without taking the hero's own badge with it.
   */
  sidekickCenterX: 1342,
  /**
   * Set at 105 rather than the 146 that would fill the badge to the template's
   * own ink. The badge is the frame's shape and the number sits *inside* it;
   * matching the template's figure crowded its edges at every width past one
   * digit.
   */
  size: inFace(106)
} as const;

/** The special ability: a name, a rule under it, and the copy. */
export const CHARACTER_ABILITY = {
  nameX: 272,
  nameCapTop: 658,
  /** Caps stand 84. */
  nameSize: inName(126),
  ruleX: 276,
  ruleY: 788,
  ruleWidth: 1173 - 276 + 1,
  ruleHeight: 7,
  textX: 276,
  textCapTop: 840,
  /** Caps stand 68. */
  textSize: inFace(102),
  /**
   * No artwork behind this one — the template sets a single line, so there is
   * no second baseline on *this* card to measure leading against. Reuses
   * `ABILITY.lineHeight` instead of guessing: the action card's ability text
   * is the same face (`--card-font-text`) and its leading *is* measured off a
   * printed three-line sample, and a leading ratio is a multiple of nominal
   * size — good at any size the same face is set, not just the one it was
   * read off. (Previously a bare `1.3`, about 30% looser than this — visibly
   * more empty space between rows than the face actually needs.)
   */
  textLineHeight: ABILITY.lineHeight,
  /** Gap between one ability block and the next. */
  gap: 60
} as const;

/**
 * A swarm sidekick's token stack, where a single one has a health badge.
 *
 * Five discs at most, however many figures there are: the printed stack is a
 * picture of "several", and the number on the last one is what says how
 * many — matching the official card's own convention (a Squirrel Girl
 * reference print shows a five-deep stack for a supply of 8), which this
 * app under-capped at three for a while. `pitch` is tighter than the paired
 * state's own 86 for the same reason: five discs read as a stack rather
 * than a strip only with more overlap than two need.
 */
export const CHARACTER_TOKENS = {
  centerX: 1343,
  centerY: 1990,
  diameter: 115,
  /** Centre to centre. They overlap by more than half a radius. */
  pitch: 42,
  ring: 5,
  max: 5,
  /** The count, on the last disc. Caps stand 49. */
  size: inFace(72)
} as const;

/**
 * A swarm sidekick at exactly 2 health: precisely two tokens, each carrying
 * its own small health badge, rather than the plain stack every other health
 * shows. Always two discs regardless of how many copies there actually are —
 * the count still prints as `×N` beside them.
 *
 * Measured off `Hero_Character_Card_Template_multisidekick_2health.png`.
 * `pitch` is wider than the plain stack's (86 against 42): two discs read
 * better with less overlap than five do. `badgeScale`/`badgeOffsetY` place
 * a *reused* copy of the hero's own badge mask (`CHARACTER_HEALTH.centerX`,
 * `.heroCenterY`) on each token via `transform`, not new art — see
 * `HeroCharacterCardFace.svelte`'s `healthBadgeAt` snippet.
 */
export const CHARACTER_TOKENS_PAIRED = {
  /** The pair's own midpoint — each disc sits `pitch / 2` either side. */
  centerX: 1319,
  pitch: 86,
  /** Against the hero's own badge, 125×133. */
  badgeScale: 0.3,
  /**
   * The mini badge's centre, relative to its token's own centre — flush
   * with the top of the token's own grey fill, just inside its 5px ring
   * (not the ring's own outer edge), at this scale.
   */
  badgeOffsetY: -36,
  /** A little short of `CHARACTER_ATTACK_ROW.badgeRight` rather than flush
   *  with it — flush read as crowding the border. */
  countX: 1450
} as const;

/**
 * A swarm sidekick at 3+ health: the token stack goes entirely, replaced by
 * the single-tracked sidekick's own badge — shifted left — plus a `×N`.
 *
 * Measured off `Hero_Character_Card_Template_multisidekick_multihealth.png`.
 * The badge is a reused, unscaled copy of the hero's own mask (see
 * `healthBadgeAt`), moved from its native `CHARACTER_HEALTH.centerX` (1342)
 * to `centerX` here — `CHARACTER_HEALTH.sidekickCenterY` is unchanged, only X
 * moves. No `dividerX` here any more: the `multiHealth` layout's own `ink`
 * (see `TEMPLATE_ASSETS.heroCharacterInk`) now carries both dividers this
 * state needs, baked in rather than drawn.
 */
export const CHARACTER_HEALTH_SHIFTED = {
  centerX: 1265,
  countX: 1448,
  /**
   * Left edge of the new divider ahead of the shifted "START HEALTH" —
   * ranged, lunge and reach's own lockups are wide enough to reach past
   * this at their natural size (see `ATTACK_TYPE_SIZES`), which is what
   * `HeroCharacterCardFace.svelte`'s `sidekickAttackScale` scales them
   * down to clear, only in this one row and only when they need to.
   */
  dividerLeftX: 963
} as const;

/**
 * The move figure, above the word MOVE the frame art draws.
 *
 * Set enormous — 373px of digit, more than twice the card title's — and
 * *heavily* condensed with it: the printed "2" is 106px across at that
 * height, where the numeral face draws a figure 188 wide. That squeeze is the
 * artwork's own distortion rather than anything the substitution introduced,
 * the same case as the initiative card's MOVE badge — the template is drawn
 * to fill the tall narrow slot the frame leaves beside the word MOVE — so it
 * is carried here as a factor instead of being dialled out of the size, which
 * would take the height with it.
 */
export const CHARACTER_MOVE = {
  centerX: (1322 + 1427) / 2,
  digitTop: 673,
  size: inFace(547),
  condense: 0.56
} as const;

/**
 * The quote panel, which stands in for the sidekick bands when there is no
 * sidekick. Measured off `Hero_Character_Card_Template_quote.png`.
 */
export const CHARACTER_QUOTE = {
  markY: 1661,
  markLeftX: 167,
  markRightX: 1464,
  /** Ascender to descender, the only thing a display quote mark offers. */
  markHeight: 94,
  textCapTop: 1790,
  textSize: inFace(92),
  /** Same reasoning as `CHARACTER_ABILITY.textLineHeight` — see there. */
  textLineHeight: ABILITY.lineHeight,
  /** Measure the copy is centred in, inset from the card either side. */
  textX: 330,
  textWidth: 1487 - 330 - 186,
  attributionCapTop: 1949,
  attributionRight: 1399,
  attributionSize: inFace(56)
} as const;

// -- Initiative card ----------------------------------------------------

/** The initiative template is its own size. */
export const INITIATIVE_BLEED = { width: 1524, height: 2232 } as const;

/**
 * Three bands, measured off `Initiative Card_border.png`: subject, Right Now,
 * End of Round. Each band has a vertical rule inset from the left.
 */
/**
 * Measured off `UMA Initiative Card Template.png`: three bands separated by
 * navy rules, each with a rotated label to the left of a vertical separator.
 */
export const INITIATIVE = {
  interior: { x: 169, y: 167, width: 1186, height: 1898 },
  radius: 46,
  /** Space between bands, measured either side of the Right Now band. */
  bandGap: 16,
  /**
   * The subject band is shorter on a minion's card.
   *
   * `villain` is the height in `UMA Initiative Card Template.png`, and is what
   * villain and effect cards both use. `minion` is read off
   * `skunk ape_initiative.webp` — an official minion card — where the band ends
   * far higher. Right Now keeps its height either way; End of Round takes up
   * whatever is left, so it simply starts higher.
   */
  subjectHeight: { villain: 439, minion: 267 },
  rightNowHeight: 380,
  /**
   * Vertical separator between a band's label and its copy, at x 293–296.
   *
   * The template bakes it in, and bakes in the two band bars with it — both at
   * the villain card's band positions, which is wrong on a minion. Both are
   * erased in `initiative_frame.png` and drawn here instead, so they follow
   * whichever bands the card actually has.
   */
  ruleX: 293,
  ruleWidth: 4,
  /**
   * How far each rule stops short of its band's bottom edge, measured off the
   * template. End of Round's is the longest because its band ends at the card's
   * rounded bottom corner rather than at a bar.
   */
  ruleBottomInset: { subject: 48, rightNow: 52, endOfRound: 73 },
  /** Rotated band labels sit centred between the interior edge and the rule. */
  labelCenterX: 240,
  labelSize: inFace(60),
  /** Body copy starts right of the separator. */
  textX: 336,
  textWidth: 1000,
  textTop: 44,
  /** Card type line, e.g. a villain's name or the effect text. */
  subjectSize: inFace(150),
  bodySize: inFace(117.5),
  /**
   * Body leading. A chosen number rather than a measured one, and the only
   * ratio on any card that is: the supplied initiative art carries no sample
   * copy to read leading off, so there is no artwork ratio here to convert and
   * `inFaceLeading` would have nothing to work on.
   *
   * It is chosen against the bands, which are fixed heights. That makes it the
   * one leading on any card that has to be *re-derived* when the face changes
   * rather than following from it — a ratio is a multiple of the nominal size,
   * and this face's is a fifth larger for the same cap height. 0.851 is the
   * 1.02 that shipped before, carried across so the absolute advance is the
   * 99.1px it has always been.
   *
   * The band is 262px and holds 2.6 lines of that. "Move up to 3 spaces toward
   * the nearest hero." wants three and loses the last one — in this face and in
   * every face before it, because at 78px to the cap the sentence is 1641px of
   * advance against the 713 Right Now leaves beside the MOVE badge. Nothing
   * here fixes that; it wants a measurement of what the printed card actually
   * sets its copy at, which the supplied art does not carry.
   */
  bodyLineHeight: 0.851,
  /**
   * MOVE badge. The art has an empty right-hand region where the move value
   * is set, which is why the number is drawn rather than baked in.
   */
  moveBadge: {
    width: 250,
    height: 311,
    right: 1339,
    /** Left edge of the number, relative to the badge. */
    numberOffsetX: 150,
    /** Digit top, relative to the badge. */
    numberOffsetY: 9,
    numberSize: inFace(444.5),
    /**
     * The printed numeral is condensed well past anything the face offers, and
     * past Knockout too — at this size Knockout HTF49 Liteweight sets a "3"
     * 176px wide against the template's 97, so this one is the artwork's own
     * distortion rather than anything the substitution introduced.
     *
     * At `numberSize` Oswald Custom Junior sets a "3" 151.4px wide and 309.7
     * tall; the template's is 97 × 310. The height lands on its own — that is
     * `inFace` doing its job, and it landing within half a pixel is the best
     * evidence there is that the face's metrics are right — so only the width
     * is squeezed.
     *
     * A scale rather than a fixed width, because "condensed" is a property of
     * the face: pinning every digit to 97px would stretch a "1", which is
     * naturally the narrowest glyph in the set.
     */
    numberCondense: 97 / 151.4
  }
} as const;

/**
 * Where the three bands sit, which depends on whose card it is.
 *
 * A minion's subject band is shorter than a villain's or an effect's. Right Now
 * keeps its height regardless — it holds the same one line of copy — so the
 * difference is taken entirely out of the top, and End of Round simply starts
 * higher and runs longer.
 */
export interface InitiativeBandBox {
  key: keyof typeof INITIATIVE.ruleBottomInset;
  y: number;
  height: number;
  /** The band's own vertical label separator, from its top edge down. */
  rule: { y: number; height: number };
}

export function initiativeBands(
  subject: keyof typeof INITIATIVE.subjectHeight
): readonly InitiativeBandBox[] {
  const top = INITIATIVE.interior.y;
  const bottom = top + INITIATIVE.interior.height;
  const subjectHeight = INITIATIVE.subjectHeight[subject];

  const rightNowY = top + subjectHeight + INITIATIVE.bandGap;
  const endOfRoundY = rightNowY + INITIATIVE.rightNowHeight + INITIATIVE.bandGap;

  const band = (
    key: InitiativeBandBox['key'],
    y: number,
    height: number
  ): InitiativeBandBox => ({
    key,
    y,
    height,
    rule: { y, height: height - INITIATIVE.ruleBottomInset[key] }
  });

  return [
    band('subject', top, subjectHeight),
    band('rightNow', rightNowY, INITIATIVE.rightNowHeight),
    band('endOfRound', endOfRoundY, bottom - endOfRoundY)
  ];
}

/**
 * Band fill and ink defaults, sampled from the print template.
 *
 * Ink travels with fill because the two are one decision: Right Now is the one
 * pale band, so it is the one band whose copy is dark. Keeping them together is
 * what lets a band be reset to a *readable* default rather than to white.
 */
export const INITIATIVE_BAND_DEFAULTS = {
  subject: { fill: '#3E454B', ink: '#FFFFFF' },
  rightNow: { fill: '#F7EBDB', ink: '#1A1A1A' },
  endOfRound: { fill: '#3E454B', ink: '#FFFFFF' }
} as const;

// -- Event card ---------------------------------------------------------

/** Mini European on its side. Same print file as an initiative card, turned. */
export const EVENT_BLEED = CARD_FORMATS.event.bleed;

/**
 * Two faces, measured off `event_front_template.png` and
 * `event_back_template.png`.
 *
 * Those files are drawn at *trim* size and at a fraction of print resolution,
 * so every number here is their measurement carried up into bleed pixels — see
 * `eventPoint` below. Only the logo lockup is used as artwork; the rest is flat
 * shapes, redrawn here so they stay sharp at print size and take any colour.
 */
export const EVENT = {
  /** The front's heading panel runs from the top edge down to here. */
  panelBottom: 972,
  /**
   * Heading block on the front, centred in the panel on both axes so a
   * one-line name sits where the printed two-line one is balanced.
   *
   * `size` is a ceiling, not a size: the heading is set to fill this box, the
   * way the printed lockup was hand-set to fill its panel. The ceiling is the
   * larger of the printed lockup's two lines — it sets "EVENT" bigger than
   * "ADJECTIVE", which no single size reproduces.
   */
  heading: { x: 300, y: 190, width: 1632, height: 690, size: 460, lineHeight: 0.9 },
  /**
   * Copy band under it, set from the left like the printed card.
   *
   * Both numbers come off the template's own two lines of sample copy —
   * "Something terrible! / What will the players do?!" — which nothing had read
   * before, on the grounds that a 373px trim-size file multiplies every pixel
   * by 5.49 on the way to bleed. It does, and that is worth about 7% here;
   * against a size that was out by 25%, reading it was still the right call.
   *
   * The 'S' stands 15px and the two cap tops are 27px apart, so at Knockout's
   * 0.666em the artwork set this at 15 × 5.49 / 0.666 = 123.7, leading 1.20.
   * It read 154.5 and 0.95 before, which is the same *absolute* leading arrived
   * at through a size a quarter too large and a ratio a fifth too tight — the
   * two errors had been cancelling, and correcting only the leading (which the
   * face swap did) ran four lines of ordinary copy off the bottom of the card.
   */
  copy: { x: 263, width: 1706, capTop: 1059, size: inFace(123.7), lineHeight: inFaceLeading(1.2) },

  back: {
    /** Rounded outline inset from the trim edge. */
    border: { x: 187, y: 171, width: 1853, height: 1183, weight: 22, radius: 44 },
    /**
     * The corner wedge, as the two ends of its top edge. It runs off both side
     * edges, so it is given at the bleed edges rather than at the trim line.
     */
    wedge: { leftY: 1312, rightY: 904 },
    /**
     * Logo lockup, sitting on the trim line. The supplied art is already cut
     * off there, so the field bleeds above it rather than the lockup doing so.
     */
    logo: { x: 258, y: 94, width: 529, height: 463 },
    /**
     * Heading block, below the lockup and clear of the wedge.
     *
     * The printed title starts higher and runs *behind* the lockup, but it is
     * set on a steep slant that carries it clear; upright type at that height
     * would simply collide with it.
     */
    heading: { x: 209, y: 570, width: 1787, height: 590, size: 460, lineHeight: 0.9 }
  }
} as const;

// -- Cardback -----------------------------------------------------------

/**
 * `adventures_minion_cardback_nologo.png` is drawn at trim size, and is
 * transparent everywhere except its line art — so it overlays artwork rather
 * than masking it, and the whole thing can be swapped for a replacement image.
 */
export const CARDBACK_BLEED = { width: 373, height: 520 } as const;

export const CARDBACK = {
  /** The window the template's border encloses. */
  window: { x: 26, y: 20, width: 330, height: 478 },
  radius: 10,
  /** Role line above the name, bottom right. */
  label: { right: 354, capTop: 456, size: inName(13) },
  name: { right: 354, capTop: 474, size: inName(28) }
} as const;

// -- Rules card ---------------------------------------------------------

export const RULES_BLEED = { width: 1632, height: 2218 } as const;

/**
 * The rules template draws its own rule under the heading, at y 403–426, so
 * the face positions type around it rather than drawing another.
 */
export const RULES = {
  interior: { x: 143, y: 141, width: 1346, height: 1937 },
  radius: 46,
  /**
   * The heading band: the interior down to the template's rule, which is where
   * the card visibly changes from title to prose. It takes its own fill so the
   * two can differ.
   */
  headerHeight: 403 - 141,
  heading: { x: 232, capTop: 246, width: 1170, size: inFace(118) },
  /* 93px of advance on a 68px face, read off the template's three lines. */
  body: {
    x: 232,
    capTop: 500,
    width: 1170,
    height: 1520,
    size: inFace(68),
    lineHeight: inFaceLeading(93 / 68)
  }
} as const;

// -- Helpers ------------------------------------------------------------

export interface Frame {
  readonly width: number;
  readonly height: number;
}

/** Horizontal position as a percentage of the card width. */
export function px(value: number, frame: Frame = BLEED): string {
  return `${((value / frame.width) * 100).toFixed(4)}%`;
}

/** Vertical position as a percentage of the card height. */
export function py(value: number, frame: Frame = BLEED): string {
  return `${((value / frame.height) * 100).toFixed(4)}%`;
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A rectangle of the card, as a `clip-path`.
 *
 * Border chrome is painted as a full-card layer clipped to shape rather than as
 * a box of its own size, so a gradient fill is sampled across the whole card. A
 * 4px rule cut out of it then matches the border beside it, instead of running
 * the entire colour ramp inside its own width.
 */
export function clipRect(box: Box, frame: Frame, radius = 0): string {
  const edges = [
    py(box.y, frame),
    px(frame.width - (box.x + box.width), frame),
    py(frame.height - (box.y + box.height), frame),
    px(box.x, frame)
  ].join(' ');
  return radius > 0 ? `inset(${edges} round ${pu(radius, frame)})` : `inset(${edges})`;
}

/**
 * A card's interior, bled out under the printed border on every side, as a
 * `clip-path`. Painted in the border's own fill and laid under everything the
 * interior holds, it is what closes the seam `CHROME_SEAM` describes.
 */
export function seamBed(box: Box, frame: Frame, radius = 0): string {
  return clipRect(
    {
      x: box.x - CHROME_SEAM,
      y: box.y - CHROME_SEAM,
      width: box.width + CHROME_SEAM * 2,
      height: box.height + CHROME_SEAM * 2
    },
    frame,
    radius > 0 ? radius + CHROME_SEAM : 0
  );
}

/**
 * A length that scales with the card, in `cqw` — a percentage of the card
 * frame's inline size.
 *
 * Because the frame holds the template's aspect ratio, one bleed pixel is the
 * same physical length on both axes, so this is correct for heights and gaps
 * too. Use it for any size inside an auto-sized box, where a percentage would
 * have nothing to resolve against.
 */
export function pu(value: number, frame: Frame = BLEED): string {
  return `${((value / frame.width) * 100).toFixed(4)}cqw`;
}
