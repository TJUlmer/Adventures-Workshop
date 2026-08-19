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
    RULES_BLEED as FRAME,
    seamBed
  } from './geometry';

  interface Props {
    /** Rules and event cards share this prose layout. */
    card: RulesCard | EventCard;
    theme: CardTheme;
    customSymbols?: CustomSymbol[];
  }

  let { card, theme, customSymbols = [] }: Props = $props();

  const heading = $derived(card.heading.trim() || (card.type === 'event' ? 'Event' : 'Rules'));
  const body = $derived(resolveCustomSymbolImages(sanitizeRichText(card.body), customSymbols));
  const empty = $derived(richTextIsEmpty(card.body));

  let bodyBox: HTMLDivElement | null = $state(null);

  /** Re-fit whenever the printed body (post-sanitise, post-symbol-resolve) changes. */
  $effect(() => {
    void body;
    if (bodyBox) fitScale(bodyBox);
  });
</script>

<!--
  The interior bled out under the border, in the border's own fill: the two are
  drawn to meet exactly, so at some zooms they round a fraction of a pixel apart
  and the plate behind shows as a hairline. This is what it shows instead.
-->
<div
  class="bed"
  style:clip-path={seamBed(RULES.interior, FRAME, RULES.radius)}
  style:background={fillCss(theme.frame)}
></div>

<div
  class="interior"
  style:left={px(RULES.interior.x, FRAME)}
  style:top={py(RULES.interior.y, FRAME)}
  style:width={px(RULES.interior.width, FRAME)}
  style:height={py(RULES.interior.height, FRAME)}
  style:border-radius={pu(RULES.radius, FRAME)}
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
    <img
      class="custom-pattern"
      src={theme.customPattern.source}
      alt=""
      style:width="calc(70cqw * {theme.customPattern.scale})"
      style:height="calc(70cqw * {theme.customPattern.scale})"
      style:left="calc((100% - 70cqw * {theme.customPattern.scale}) * {theme.customPattern.offsetX})"
      style:top="calc((100% - 70cqw * {theme.customPattern.scale}) * {theme.customPattern.offsetY})"
      style:transform="rotate({theme.customPattern.rotation}deg)"
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
    style:height={py(RULES.headerHeight, RULES.interior)}
    style:background={fillCss(theme.header)}
  ></div>
</div>

<div
  class="heading"
  style:left={px(RULES.heading.x, FRAME)}
  style:top={py(capTopToBoxTop(RULES.heading.capTop, RULES.heading.size), FRAME)}
  style:width={px(RULES.heading.width, FRAME)}
  style:font-size={pu(RULES.heading.size, FRAME)}
  style:color={theme.headerInk}
>
  {heading}
</div>

<div
  bind:this={bodyBox}
  class="body"
  style:left={px(RULES.body.x, FRAME)}
  style:top={py(
    capTopToBoxTop(RULES.body.capTop, RULES.body.size, RULES.body.lineHeight),
    FRAME
  )}
  style:width={px(RULES.body.width, FRAME)}
  style:height={py(RULES.body.height, FRAME)}
  style:--copy-size={pu(RULES.body.size, FRAME)}
  style:line-height={RULES.body.lineHeight}
  style:color={theme.bodyInk}
>
  {#if empty}
    <p class="placeholder">Body text appears here.</p>
  {:else}
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised above -->
    {@html body}
  {/if}
</div>

<div class="mask frame" style:background={fillCss(theme.frame)}></div>

<style>
  .bed {
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

  /* A real `<img>`, positioned to its own box — see ActionCardFace. */
  .custom-pattern {
    position: absolute;
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
