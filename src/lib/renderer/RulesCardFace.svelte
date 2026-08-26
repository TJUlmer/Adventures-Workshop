<script lang="ts">
  /**
   * Rules / reference card: a heading, a rule, and rich body copy.
   * The body is sanitised again at render time, because a set file can be
   * hand-edited or imported from elsewhere.
   */
  import type { CardTheme } from '$lib/cards/style';
  import { customPatternFilter, fillCss } from '$lib/cards/style';
  import type { EventCard, RulesCard } from '$lib/cards/types';
  import type { CustomSymbol } from '$lib/symbols/types';
  import { resolveCustomSymbolImages, richTextIsEmpty, sanitizeRichText } from '$lib/text/rich-text';
  import { patternAspect } from './assets';
  import { fitScale } from './fit-text';
  import {
    capTopToBoxTop,
    px,
    pu,
    py,
    RULES,
    RULES_BLEED,
    RULES_LANDSCAPE,
    RULES_LANDSCAPE_BLEED,
    seamBed
  } from './geometry';

  interface Props {
    /** Rules and event cards share this prose layout. */
    card: RulesCard | EventCard;
    theme: CardTheme;
    customSymbols?: CustomSymbol[];
  }

  let { card, theme, customSymbols = [] }: Props = $props();

  /* Only a rules card can be landscape — see `RulesCard.landscape`. */
  const landscape = $derived(card.type === 'rules' && card.landscape);
  const geom = $derived(landscape ? RULES_LANDSCAPE : RULES);
  const FRAME = $derived(landscape ? RULES_LANDSCAPE_BLEED : RULES_BLEED);

  const heading = $derived(card.heading.trim() || (card.type === 'event' ? 'Event' : 'Rules'));
  /** Only a rules card carries this — an event's heading is always left. */
  const headingAlign = $derived(card.type === 'rules' ? card.headingAlign : 'left');
  const body = $derived(resolveCustomSymbolImages(sanitizeRichText(card.body), customSymbols));
  const empty = $derived(richTextIsEmpty(card.body));

  let bodyBox: HTMLDivElement | null = $state(null);

  /** Re-fit whenever the printed body (post-sanitise, post-symbol-resolve) changes. */
  $effect(() => {
    void body;
    if (bodyBox) fitScale(bodyBox);
  });
</script>

{#if landscape}
  <!--
    No template art for this orientation — see `RULES_LANDSCAPE`. The interior
    sits on top of a plain full-bleed fill in the same colour rather than a
    masked border image, so there is no separate layer to seam against.
  -->
  <div class="landscape-frame" style:background={fillCss(theme.frame)}></div>
{:else}
  <!--
    The interior bled out under the border, in the border's own fill: the two are
    drawn to meet exactly, so at some zooms they round a fraction of a pixel apart
    and the plate behind shows as a hairline. This is what it shows instead.
  -->
  <div
    class="bed"
    style:clip-path={seamBed(RULES.interior, RULES_BLEED, RULES.radius)}
    style:background={fillCss(theme.frame)}
  ></div>
{/if}

<div
  class="interior"
  style:left={px(geom.interior.x, FRAME)}
  style:top={py(geom.interior.y, FRAME)}
  style:width={px(geom.interior.width, FRAME)}
  style:height={py(geom.interior.height, FRAME)}
  style:border-radius={pu(geom.radius, FRAME)}
  style:background={fillCss(theme.body)}
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

  <!--
    The heading band, over the pattern rather than under it: the pattern
    belongs to the body, and running it across a header of a different colour
    would read as one surface rather than two.
  -->
  <div
    class="header"
    style:height={py(geom.headerHeight, geom.interior)}
    style:background={fillCss(theme.header)}
  ></div>

  {#if landscape}
    <!--
      Portrait's rule is baked into `rules_border.png`; landscape has no such
      art (see `RULES_LANDSCAPE`), so it is drawn here instead, centred on the
      header/body boundary so it reads as the transition rather than a line
      added to either side of it.
    -->
    <div
      class="rule"
      style:top={py(RULES_LANDSCAPE.headerHeight, geom.interior)}
      style:height={py(RULES_LANDSCAPE.dividerHeight, geom.interior)}
      style:background={theme.divider}
    ></div>
  {/if}
</div>

<div
  class="heading"
  style:left={px(geom.heading.x, FRAME)}
  style:top={py(capTopToBoxTop(geom.heading.capTop, geom.heading.size), FRAME)}
  style:width={px(geom.heading.width, FRAME)}
  style:font-size={pu(geom.heading.size, FRAME)}
  style:color={theme.headerInk}
  style:text-align={headingAlign}
>
  {heading}
</div>

<div
  bind:this={bodyBox}
  class="body"
  style:left={px(geom.body.x, FRAME)}
  style:top={py(
    capTopToBoxTop(geom.body.capTop, geom.body.size, geom.body.lineHeight),
    FRAME
  )}
  style:width={px(geom.body.width, FRAME)}
  style:height={py(geom.body.height, FRAME)}
  style:--copy-size={pu(geom.body.size, FRAME)}
  style:line-height={geom.body.lineHeight}
  style:color={theme.bodyInk}
>
  {#if empty}
    <p class="placeholder">Body text appears here.</p>
  {:else}
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised above -->
    {@html body}
  {/if}
</div>

{#if !landscape}
  <div class="mask frame" style:background={fillCss(theme.frame)}></div>
{/if}

<style>
  .bed,
  .landscape-frame {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .interior {
    position: absolute;
    overflow: hidden;
  }

  .header {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
  }

  .rule {
    position: absolute;
    left: 0;
    width: 100%;
    transform: translateY(-50%);
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
  }

  .heading {
    position: absolute;
    font-family: var(--card-font-title);
    font-weight: var(--card-font-title-weight);
    text-transform: uppercase;
    line-height: 0.9;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /*
   * `--copy-size` is the size an author-sized run is a percentage of. Declared
   * here rather than read from the parent, so a sized run inside another sized
   * run resolves against the card instead of multiplying with it.
   */
  .body {
    position: absolute;
    font-family: var(--card-font-text);
    font-weight: var(--card-font-text-weight);
    /* `--fit-scale` shrinks long copy to fit; `overflow: hidden` is only the
       backstop past its floor — see `fit-text.ts`. */
    font-size: calc(var(--copy-size) * var(--fit-scale, 1));
    overflow: hidden;
  }

  .body :global(.sized) {
    font-size: calc(var(--copy-size) * var(--size, 1) * var(--fit-scale, 1));
  }

  .body :global(p) {
    margin: 0 0 0.5em;
  }

  .body :global(ul),
  .body :global(ol) {
    margin: 0 0 0.5em;
    padding-left: 1.2em;
  }

  .body :global(ul) {
    list-style: disc;
  }

  .body :global(ol) {
    list-style: decimal;
  }

  .body :global(li) {
    margin-bottom: 0.2em;
  }

  .body :global(h3) {
    margin: 0.2em 0 0.25em;
    font-family: var(--card-font-title);
    font-weight: var(--card-font-title-weight);
    font-size: 1.35em;
    text-transform: uppercase;
    line-height: 0.95;
  }

  .body :global(h4) {
    margin: 0.2em 0 0.2em;
    font-family: var(--card-font-title);
    font-weight: var(--card-font-title-weight);
    font-size: 1.1em;
    line-height: 1;
  }

  /* Sizes the editor used to write. Still rendered so old cards look right. */
  .body :global(.size-sm) {
    font-size: 0.82em;
  }

  .body :global(.size-lg) {
    font-size: 1.25em;
  }

  .body :global(.size-xl) {
    font-size: 1.6em;
  }

  .body :global(img.symbol) {
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

  .mask {
    position: absolute;
    inset: 0;
    pointer-events: none;
    mask-size: 100% 100%;
    -webkit-mask-size: 100% 100%;
    mask-repeat: no-repeat;
    -webkit-mask-repeat: no-repeat;
  }

  .frame {
    mask-image: url('/assets/templates/rules_border.png');
    -webkit-mask-image: url('/assets/templates/rules_border.png');
  }
</style>
