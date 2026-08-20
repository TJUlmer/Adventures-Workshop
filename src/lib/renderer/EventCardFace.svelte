<script lang="ts">
  /**
   * Event card. Landscape, and the one card in the set that prints two faces
   * an author designs: a heading panel over a copy band on the front, and a
   * bordered field carrying the same heading on the reverse.
   *
   * The supplied templates are flat shapes at trim size and at a fraction of
   * print resolution, so everything except the corner badge is
   * redrawn here from `geometry.ts` — which keeps every edge sharp at print
   * size and lets each surface take any colour. Only the badge is masked
   * artwork, so it recolours with the rest — and it currently stands empty,
   * waiting on a licensed lockup.
   */
  import type { CardTheme } from '$lib/cards/style';
  import { customPatternFilter, fillCss } from '$lib/cards/style';
  import type { EventCard } from '$lib/cards/types';
  import type { CustomSymbol } from '$lib/symbols/types';
  import { resolveCustomSymbolImages, richTextIsEmpty, sanitizeRichText } from '$lib/text/rich-text';
  import { patternAspect } from './assets';
  import { displayFontStack, displayFontWeight, fitDisplaySize } from './fonts';
  import {
    capTopToBoxTop,
    EVENT,
    EVENT_BLEED as FRAME,
    px,
    pu,
    py
  } from './geometry';

  interface Props {
    card: EventCard;
    theme: CardTheme;
    /** Which face to draw. Both are printed, so both are previewed. */
    side?: 'front' | 'back';
    customSymbols?: CustomSymbol[];
  }

  let { card, theme, side = 'front', customSymbols = [] }: Props = $props();

  const heading = $derived(card.heading.trim() || 'Event Card!');

  /**
   * The reverse's heading placement, as CSS.
   *
   * The offsets are percentages of the card, so they are applied as a
   * `translate` in percentages *of the block* — converted through the block's
   * own share of the face, which keeps a placement meaning the same thing at
   * any render size. The turn is about the block's centre.
   */
  const backHeadingTransform = $derived.by(() => {
    const place = card.backHeading;
    const x = (place.offsetX / 100) * (FRAME.width / EVENT.back.heading.width) * 100;
    const y = (place.offsetY / 100) * (FRAME.height / EVENT.back.heading.height) * 100;
    return `translate(${x.toFixed(3)}%, ${y.toFixed(3)}%) rotate(${place.rotation}deg)`;
  });
  const body = $derived(resolveCustomSymbolImages(sanitizeRichText(card.body), customSymbols));
  const empty = $derived(richTextIsEmpty(card.body));
  const display = $derived(displayFontStack(theme.displayFont));
  const displayWeight = $derived(displayFontWeight(theme.displayFont));

  /** Set to fill its block, so any length of name reads as the printed one. */
  const headingSize = $derived(
    fitDisplaySize(
      heading,
      side === 'front' ? EVENT.heading : EVENT.back.heading,
      theme.displayFont,
      EVENT.heading.size,
      EVENT.heading.lineHeight
    )
  );

  const wedge = EVENT.back.wedge;
  const border = EVENT.back.border;

  /**
   * The corner wedge, as a polygon rather than a rotated box: its top edge is
   * a straight line between two points on the card's side edges, which is
   * exactly what a polygon says and what a rotation would only approximate.
   */
  const wedgeClip = `polygon(0 ${py(wedge.leftY, FRAME)}, 100% ${py(wedge.rightY, FRAME)}, 100% 100%, 0 100%)`;
</script>

{#if side === 'front'}
  <!--
    Two full-bleed bands. The heading panel runs to the card's edges rather
    than stopping at the trim line, so there is nothing to line up and nothing
    to round apart.
  -->
  <div
    class="band"
    style:top="0"
    style:height={py(EVENT.panelBottom, FRAME)}
    style:background={fillCss(theme.header)}
  >
    {#if theme.pattern.name}
      <div
        class="pattern"
        style:--pattern-url="url('/assets/patterns/{theme.pattern.name}.svg')"
        style:--pattern-scale={theme.pattern.scale}
        style:--pattern-aspect={patternAspect(theme.pattern.name)}
        style:background={theme.pattern.color}
        style:opacity={theme.pattern.opacity}
      ></div>
    {/if}

    {#if theme.customPattern.source}
      <!-- Percentage/cqw mismatch — see ActionCardFace's own custom-pattern for why. -->
      <img
        class="custom-pattern"
        src={theme.customPattern.source}
        alt=""
        style:width="calc(70% * {theme.customPattern.scale})"
        style:aspect-ratio="1"
        style:left="{(theme.customPattern.offsetX * 100).toFixed(3)}%"
        style:top="{(theme.customPattern.offsetY * 100).toFixed(3)}%"
        style:transform="translate({(-theme.customPattern.offsetX * 100).toFixed(3)}%, {(
          -theme.customPattern.offsetY * 100
        ).toFixed(3)}%) rotate({theme.customPattern.rotation}deg)"
        style:opacity={theme.customPattern.opacity}
        style:filter={customPatternFilter(theme.customPattern)}
      />
    {/if}
  </div>

  <div
    class="band"
    style:top={py(EVENT.panelBottom, FRAME)}
    style:bottom="0"
    style:background={fillCss(theme.body)}
  ></div>

  <div
    class="heading centred"
    style:left={px(EVENT.heading.x, FRAME)}
    style:top={py(EVENT.heading.y, FRAME)}
    style:width={px(EVENT.heading.width, FRAME)}
    style:height={py(EVENT.heading.height, FRAME)}
    style:font-size={pu(headingSize, FRAME)}
    style:line-height={EVENT.heading.lineHeight}
    style:font-family={display}
    style:font-weight={displayWeight}
    style:color={theme.headerInk}
  >
    <span>{heading}</span>
  </div>

  <div
    class="copy"
    style:left={px(EVENT.copy.x, FRAME)}
    style:top={py(
      capTopToBoxTop(EVENT.copy.capTop, EVENT.copy.size, EVENT.copy.lineHeight),
      FRAME
    )}
    style:width={px(EVENT.copy.width, FRAME)}
    style:--copy-size={pu(EVENT.copy.size, FRAME)}
    style:line-height={EVENT.copy.lineHeight}
    style:color={theme.bodyInk}
  >
    {#if empty}
      <p class="placeholder">Something terrible!</p>
    {:else}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised above -->
      {@html body}
    {/if}
  </div>
{:else}
  <div class="band" style:inset="0" style:background={fillCss(theme.back)}></div>

  <!-- Outline, drawn as a border so the corners round without a mask. -->
  <div
    class="border"
    style:left={px(border.x, FRAME)}
    style:top={py(border.y, FRAME)}
    style:width={px(border.width, FRAME)}
    style:height={py(border.height, FRAME)}
    style:border-width={pu(border.weight, FRAME)}
    style:border-radius={pu(border.radius, FRAME)}
    style:border-color={theme.frame.color}
  ></div>

  <!-- Over the outline, which it cuts off — as it does on the printed card. -->
  <div
    class="wedge"
    style:clip-path={wedgeClip}
    style:background={fillCss(theme.frame)}
  ></div>

  <div
    class="heading centred back-heading"
    style:left={px(EVENT.back.heading.x, FRAME)}
    style:top={py(EVENT.back.heading.y, FRAME)}
    style:width={px(EVENT.back.heading.width, FRAME)}
    style:height={py(EVENT.back.heading.height, FRAME)}
    style:font-size={pu(headingSize, FRAME)}
    style:line-height={EVENT.back.heading.lineHeight}
    style:font-family={display}
    style:font-weight={displayWeight}
    style:color={theme.backInk}
    style:transform={backHeadingTransform}
  >
    <span>{heading}</span>
  </div>

  <!--
    The badge, last so it sits over the heading as the lockup does on the
    template.
    Two masked layers: the box, and the lettering knocked out of it — which is
    painted in the field's own colour, because that is what a knockout is.
  -->
  <div
    class="logo"
    style:left={px(EVENT.back.logo.x, FRAME)}
    style:top={py(EVENT.back.logo.y, FRAME)}
    style:width={px(EVENT.back.logo.width, FRAME)}
    style:height={py(EVENT.back.logo.height, FRAME)}
  >
    <div class="logo-layer logo-box" style:background={fillCss(theme.frame)}></div>
    <div class="logo-layer logo-ink" style:background={fillCss(theme.back)}></div>
  </div>
{/if}

<style>
  .band {
    position: absolute;
    left: 0;
    right: 0;
    overflow: hidden;
  }

  /* Sized from the file's own proportions — see ActionCardFace. */
  .pattern {
    position: absolute;
    inset: 0;
    --pattern-tile: calc(6cqw * var(--pattern-scale));
    mask-image: var(--pattern-url);
    -webkit-mask-image: var(--pattern-url);
    mask-size: var(--pattern-tile) calc(var(--pattern-tile) * var(--pattern-aspect));
    -webkit-mask-size: var(--pattern-tile) calc(var(--pattern-tile) * var(--pattern-aspect));
    mask-repeat: repeat;
    -webkit-mask-repeat: repeat;
    pointer-events: none;
  }

  /*
   * A real `<img>`, positioned to its own box — see ActionCardFace.
   * `max-width: none` overrides the global `img { max-width: 100% }` reset
   * (`base.css`), which otherwise silently caps this at 100% of its own
   * container regardless of `scale`.
   */
  .custom-pattern {
    position: absolute;
    max-width: none;
    object-fit: contain;
    pointer-events: none;
  }

  /*
   * The display heading, allowed to wrap so a long event name sets on two
   * lines the way the printed one does rather than being clipped to one — and
   * centred in its block, so a one-line name sits where the printed two-line
   * lockup is balanced instead of hanging from its first line.
   */
  .heading {
    position: absolute;
    text-transform: uppercase;
    text-wrap: balance;
    overflow: hidden;
  }

  .centred {
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
  }

  /*
   * The reverse sets its title from the left, under the lockup.
   *
   * `overflow: visible` because this block can be moved and turned: clipping to
   * it would cut a slanted title off at a box the author cannot see. The card's
   * own frame still crops anything that leaves the face.
   */
  .back-heading {
    justify-content: flex-start;
    text-align: left;
    overflow: visible;
    transform-origin: center;
  }

  /*
   * `--copy-size` is the size an author-sized run is a percentage of, declared
   * here rather than inherited so nested runs resolve against the card. See
   * RulesCardFace.
   */
  .copy {
    position: absolute;
    font-family: var(--card-font-event);
    font-weight: var(--card-font-event-weight);
    font-size: var(--copy-size);
    overflow: hidden;
  }

  .copy :global(.sized) {
    font-size: calc(var(--copy-size) * var(--size, 1));
  }

  .copy :global(p) {
    margin: 0 0 0.3em;
  }

  .copy :global(ul),
  .copy :global(ol) {
    margin: 0 0 0.3em;
    padding-left: 1.2em;
  }

  .copy :global(ul) {
    list-style: disc;
  }

  .copy :global(ol) {
    list-style: decimal;
  }

  /* Sizes the editor used to write. Still rendered so old cards look right. */
  .copy :global(.size-sm) {
    font-size: 0.82em;
  }

  .copy :global(.size-lg) {
    font-size: 1.25em;
  }

  .copy :global(.size-xl) {
    font-size: 1.6em;
  }

  .copy :global(img.symbol) {
    display: inline-block;
    height: 0.9em;
    width: auto;
    vertical-align: -0.1em;
    margin-inline: 0.06em;
  }

  .placeholder {
    margin: 0;
    opacity: 0.4;
  }

  .border {
    position: absolute;
    border-style: solid;
    pointer-events: none;
  }

  .wedge {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .logo {
    position: absolute;
  }

  .logo-layer {
    position: absolute;
    inset: 0;
    mask-size: 100% 100%;
    -webkit-mask-size: 100% 100%;
    mask-repeat: no-repeat;
    -webkit-mask-repeat: no-repeat;
    pointer-events: none;
  }

  .logo-box {
    mask-image: url('/assets/templates/event_logo.png');
    -webkit-mask-image: url('/assets/templates/event_logo.png');
  }

  .logo-ink {
    mask-image: url('/assets/templates/event_logo_ink.png');
    -webkit-mask-image: url('/assets/templates/event_logo_ink.png');
  }
</style>
