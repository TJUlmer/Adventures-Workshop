<script lang="ts">
  /**
   * Villain / minion action card.
   *
   * The printed chrome is the real template art used as alpha masks, so the
   * frame, ribbon, divider and boost disc keep their exact drawn shapes while
   * still taking any colour or gradient. Everything else is positioned from
   * `geometry.ts`, in bleed pixels, converted to percentages.
   */
  import type { CardTheme } from '$lib/cards/style';
  import { fillCss } from '$lib/cards/style';
  import type { ActionCard } from '$lib/cards/types';
  import { abilityIsEmpty } from '$lib/cards/types';
  import type { Character } from '$lib/characters/types';
  import AbilityText from './AbilityText.svelte';
  import { CARD_SYMBOL_SIZES, CARD_SYMBOLS, patternAspect } from './assets';
  import type { CardSymbolName } from './assets';
  import CardArt from './CardArt.svelte';
  import {
    ABILITY,
    ABILITY_RULE,
    ART_WINDOW,
    BANNER,
    BANNER_HEAD,
    BANNER_HEAD_BELOW,
    BLEED,
    BODY_PANEL,
    BODY_PANEL_MAX_HEIGHT,
    BOOST,
    BOOST_DISC_RADIUS,
    BOOST_RING,
    BOOST_VALUE,
    capTopToBoxTop,
    digitMiddleToBoxTop,
    digitTopToBoxTop,
    DIVIDER,
    inPanel,
    INTERIOR,
    INTERIOR_RADIUS,
    NAME,
    NAME_METRICS,
    NAME_TOP,
    px,
    pu,
    py,
    QUANTITY,
    seamBed,
    SPLIT,
    SPLIT_DEFAULT_HEIGHT,
    SPLIT_SEPARATOR,
    SPLIT_SEPARATOR_BAR,
    SPLIT_SEPARATOR_OVERHANG,
    SPLIT_TOP,
    TITLE,
    TITLE_RULE,
    VALUE_STACK
  } from './geometry';

  interface Props {
    card: ActionCard;
    character: Character | null;
    theme: CardTheme;
  }

  let { card, character, theme }: Props = $props();

  interface ValueRow {
    key: CardSymbolName;
    value: number;
    /** Row top edge, in bleed pixels. */
    top: number;
  }

  const ribbonName = $derived(card.name.trim() || character?.name.trim() || 'Villain Name');
  const title = $derived(card.title.trim() || 'Card Title');

  /** Attack then defense, skipping whichever the card does not print. */
  const values = $derived.by((): ValueRow[] => {
    const present: { key: CardSymbolName; value: number }[] = [];
    if (card.attack !== null) present.push({ key: 'attack', value: card.attack });
    if (card.defense !== null) present.push({ key: 'defense', value: card.defense });

    return present.map((row, index) => ({
      ...row,
      top: VALUE_STACK.firstRowTop + index * VALUE_STACK.rowPitch
    }));
  });

  const hasValues = $derived(values.length > 0);

  /**
   * How far the value stack runs below the rule's top edge.
   *
   * The rule is as long as the taller of the two columns it separates. The
   * values column can be measured here — it is symbols at known sizes — and
   * the ability column measures itself, by being the thing that sizes the
   * block the rule stretches inside. Neither needs JS.
   */
  const valuesRun = $derived.by(() => {
    const last = values.at(-1);
    if (!last) return 0;
    return last.top + CARD_SYMBOL_SIZES[last.key].height - ABILITY_RULE.y;
  });

  /** Where the ability text's line box starts, relative to the rule's top. */
  const abilityOffset = $derived(
    capTopToBoxTop(ABILITY.capTop, ABILITY.size, ABILITY.lineHeight) - ABILITY_RULE.y
  );

  /**
   * Gap from the rule to the copy. The text follows the rule in flow, so this
   * is measured from the rule's *right* edge, not from its position — which is
   * what keeps the copy on the template's x 520 whatever the rule weighs.
   */
  const abilityGap = ABILITY.x - (ABILITY_RULE.x + ABILITY_RULE.width);

  /** With no values there is no rule, so the copy starts at its own cap line. */
  const abilityTop = capTopToBoxTop(ABILITY.capTop, ABILITY.size, ABILITY.lineHeight);

  /** Attack half first, then defense — the printed order. */
  const SPLIT_SIDES = [{ key: 'attack' as const }, { key: 'defense' as const }];
</script>

<!--
  The interior bled out under the border, in the border's own fill. The two
  boxes are drawn to meet exactly, so at some zooms they round to positions a
  fraction of a pixel apart and the plate behind shows as a hairline; this is
  what it shows instead.
-->
<div
  class="bed"
  style:clip-path={seamBed(INTERIOR, BLEED, INTERIOR_RADIUS)}
  style:background={fillCss(theme.frame)}
></div>

<!--
  Interior: artwork, then the divider and body panel stacked against the
  bottom, clipped to the frame window.

  The artwork keeps its full window whatever the copy does — the panel rises
  *over* it rather than squeezing it, so the image is never rescaled and what
  it shows only ever changes from the Design tab. How far the panel may rise is
  the art window's floor.
-->
<div
  class="interior"
  style:left={px(INTERIOR.x)}
  style:top={py(INTERIOR.y)}
  style:width={px(INTERIOR.width)}
  style:height={py(INTERIOR.height)}
  style:border-radius={pu(INTERIOR_RADIUS)}
>
  <div class="art" style:height={pu(ART_WINDOW.height)}>
    <CardArt artwork={card.artwork} background={fillCss(theme.artBackground)} />
  </div>

  <!--
    Bottom-anchored, so the panel grows upward. Its own height is its copy's,
    which is what carries the divider — and the boost riding on it — up the
    card.
  -->
  <div class="stack" style:max-height={pu(INTERIOR.height - ART_WINDOW.minHeight)}>
  <!--
    The divider, drawn rather than masked: it is a plain bar in the art. Only
    the boost ring has shape, so only the ring is masked — and it hangs off the
    bar on both sides, which is why the divider lifts above the panel.
  -->
  <div class="divider" style:height={pu(DIVIDER.height)} style:background={theme.divider}>
    {#if card.boost !== null}
      <div
        class="boost-disc"
        style:left={pu(BOOST.cx - BOOST_DISC_RADIUS - INTERIOR.x)}
        style:top={pu(BOOST.cy - BOOST_DISC_RADIUS - DIVIDER.y)}
        style:width={pu(BOOST_DISC_RADIUS * 2)}
        style:height={pu(BOOST_DISC_RADIUS * 2)}
        style:background={fillCss(theme.boost)}
      ></div>

      <div
        class="boost-ring"
        style:left={pu(BOOST_RING.x - INTERIOR.x)}
        style:top={pu(BOOST_RING.y - DIVIDER.y)}
        style:width={pu(BOOST_RING.width)}
        style:height={pu(BOOST_RING.height)}
        style:--ring-size="{pu(BLEED.width)} {pu(BLEED.height)}"
        style:--ring-position="{pu(-BOOST_RING.x)} {pu(-BOOST_RING.y)}"
        style:background={theme.divider}
      ></div>

      <div
        class="boost-value"
        style:left={pu(BOOST.cx - INTERIOR.x)}
        style:top={pu(
          digitMiddleToBoxTop(BOOST.cy, BOOST_VALUE.size, BOOST_VALUE.lineHeight) - DIVIDER.y
        )}
        style:font-size={pu(BOOST_VALUE.size)}
        style:line-height={BOOST_VALUE.lineHeight}
        style:color={theme.boostInk}
      >
        {card.boost}
      </div>
    {/if}
  </div>

  <div
    class="body"
    style:min-height={pu(BODY_PANEL.height)}
    style:max-height={pu(BODY_PANEL_MAX_HEIGHT)}
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

    <!-- Body panel content. Everything here is placed off the panel's top. -->
    <div
      class="title"
      style:left={pu(TITLE.x - BODY_PANEL.x)}
      style:top={pu(inPanel(capTopToBoxTop(TITLE.capTop, TITLE.size, TITLE.lineHeight, NAME_METRICS)))}
      style:width={pu(TITLE.width)}
      style:font-size={pu(TITLE.size)}
      style:line-height={TITLE.lineHeight}
      style:letter-spacing="{TITLE.tracking}em"
      style:scale="{TITLE.condense} 1"
      style:color={theme.bodyInk}
    >
      {title}
    </div>

    <div
      class="rule"
      style:left={pu(TITLE_RULE.x - BODY_PANEL.x)}
      style:top={pu(inPanel(TITLE_RULE.y))}
      style:width={pu(TITLE_RULE.width)}
      style:height={pu(TITLE_RULE.height)}
      style:background={theme.bodyInk}
    ></div>

    {#if card.split}
      <div class="panel-lead" style:height={pu(inPanel(SPLIT_TOP))}></div>
      {@render splitBody()}
      <div class="panel-foot" style:height={pu(SPLIT.bottom)}></div>
    {:else}
      {#if hasValues}
        {#each values as row (row.key)}
          {@const size = CARD_SYMBOL_SIZES[row.key]}
          <img
            class="value-symbol"
            src={CARD_SYMBOLS[row.key]}
            alt={row.key}
            style:left={pu(VALUE_STACK.symbolCenterX - size.width / 2 - BODY_PANEL.x)}
            style:top={pu(inPanel(row.top))}
            style:width={pu(size.width)}
          />
          <span
            class="value-number"
            style:left={pu(VALUE_STACK.numberX - BODY_PANEL.x)}
            style:top={pu(
              inPanel(digitTopToBoxTop(row.top + VALUE_STACK.numberOffset, VALUE_STACK.numberSize))
            )}
            style:font-size={pu(VALUE_STACK.numberSize)}
            style:color={theme.bodyInk}
          >
            {row.value}
          </span>
        {/each}
      {/if}

      <div class="panel-lead" style:height={pu(inPanel(hasValues ? ABILITY_RULE.y : abilityTop))}></div>

      {#if hasValues}
        <!--
          Rule and ability text as one block, so the rule can be as long as the
          taller of the two columns without anything measuring anything: the
          block is sized by the text and floored by the value stack, and the
          rule stretches. The panel is sized by the block in turn.
        -->
        <div
          class="ability-block"
          style:margin-left={pu(ABILITY_RULE.x - BODY_PANEL.x)}
          style:min-height={pu(valuesRun)}
        >
          <div
            class="rule-v"
            style:width={pu(ABILITY_RULE.width)}
            style:background={theme.bodyInk}
          ></div>

          <div
            class="block-ability"
            style:margin-left={pu(abilityGap)}
            style:padding-top={pu(abilityOffset)}
            style:width={pu(ABILITY.width)}
            style:font-size={pu(ABILITY.size)}
            style:line-height={ABILITY.lineHeight}
            style:letter-spacing="{ABILITY.tracking}em"
            style:color={theme.bodyInk}
          >
            <AbilityText ability={card.ability} subject={ribbonName} />
          </div>
        </div>
      {:else}
        <!-- No values to separate: the copy runs the panel's full measure. -->
        <div
          class="block-ability"
          style:margin-left={pu(TITLE.x - BODY_PANEL.x)}
          style:width={pu(ABILITY.x + ABILITY.width - TITLE.x)}
          style:font-size={pu(ABILITY.size)}
          style:line-height={ABILITY.lineHeight}
          style:letter-spacing="{ABILITY.tracking}em"
          style:color={theme.bodyInk}
        >
          <AbilityText ability={card.ability} subject={ribbonName} />
        </div>
      {/if}

      <div class="panel-foot" style:height={pu(ABILITY.bottomInset)}></div>
    {/if}
  </div>
  </div>
</div>

<!--
  Name ribbon. A column: the clearance below the frame, the name, the clearance
  above the shoulder, then the pennant head — so the ribbon's length *is* its
  contents, and the name sets it without anything being measured.

  Fill and outline are each one element spanning the whole ribbon, so a
  gradient is painted once down its full length rather than restarting at the
  point. Each is cut to shape by two mask layers: a plain rectangle for the
  straight run — which can therefore be any length without distorting — and the
  art itself for the pennant head, sampled at its natural size.
-->
<div class="banner" style:left={px(BANNER.x)} style:width={px(BANNER.width)}>
  <div
    class="banner-ink banner-face"
    style:left={pu(BANNER_HEAD.x - BANNER.x)}
    style:width={pu(BANNER_HEAD.width)}
    style:--run-size="{pu(BANNER.width)} calc(100% - {pu(BANNER_HEAD.height)})"
    style:--run-position="left {pu(BANNER.x - BANNER_HEAD.x)} top 0"
    style:--head-size="{pu(BLEED.width)} {pu(BLEED.height)}"
    style:--head-position="left {pu(-BANNER_HEAD.x)} bottom {pu(-BANNER_HEAD_BELOW)}"
    style:background={fillCss(theme.banner)}
  ></div>
  <div
    class="banner-ink banner-outline"
    style:left={pu(BANNER_HEAD.x - BANNER.x)}
    style:width={pu(BANNER_HEAD.width)}
    style:--run-size="{pu(BANNER.edge.width)} calc(100% - {pu(BANNER_HEAD.height)})"
    style:--run-position="left {pu(BANNER.edge.x - BANNER_HEAD.x)} top 0"
    style:--head-size="{pu(BLEED.width)} {pu(BLEED.height)}"
    style:--head-position="left {pu(-BANNER_HEAD.x)} bottom {pu(-BANNER_HEAD_BELOW)}"
    style:background={theme.divider}
  ></div>

  <div class="banner-lead" style:height={pu(NAME_TOP)}></div>

  <!--
    Set vertically rather than rotated, so the name's length is its box's
    height and the column above can lay itself out around it. The half turn
    puts the reading direction bottom-up, which also puts the last character —
    and the ellipsis, when the name is too long — at the top, against the
    clearance the frame is measured from.
  -->
  <div
    class="name"
    style:font-size={pu(NAME.size)}
    style:max-height={pu(NAME.maxLength)}
    style:color={theme.bannerInk}
  >
    {ribbonName}
  </div>

  <div class="banner-tail" style:height={pu(NAME.headGap)}></div>

  <!-- The head is painted by the ink layers; here it only reserves its run. -->
  <div class="banner-head" style:height={pu(BANNER_HEAD.height)}></div>
</div>

<!--
  Split card: two stacked halves with a floating separator. The lower half is
  sized by its own content and the upper half absorbs the remainder, so the
  separator rises as the defense side fills up — no measuring, no JS.

  `min-height` is the printed run. Past that the column grows, which is what
  lets a busy split card push the whole panel up rather than truncate.
-->
{#snippet splitBody()}
  <div
    class="split"
    style:margin-inline={pu(-SPLIT_SEPARATOR_OVERHANG)}
    style:min-height={pu(SPLIT_DEFAULT_HEIGHT)}
    style:color={theme.bodyInk}
  >
    {#each SPLIT_SIDES as side (side.key)}
      {#if side.key === 'defense'}
        <!--
          Only the bar is in the flow; the art hangs below the box's bottom
          edge so its shoulders rise into the upper half, and it takes the
          frame's fill so the join with the border is seamless.

          A solid frame matches exactly. A *gradient* frame does not: the
          border samples it across the whole card and the separator can only
          sample it across its own 46px, because where the separator lands is
          decided by flex — by how far the defense side has filled — and CSS
          cannot read that back to offset the gradient. Fixing it would mean
          measuring the run position at every keystroke.
        -->
        <div class="split-separator" style:height={pu(SPLIT_SEPARATOR_BAR)}>
          <div
            class="separator-art"
            style:height={pu(SPLIT_SEPARATOR.file.height)}
            style:left={pu(-SPLIT_SEPARATOR.inkX)}
            style:width={pu(SPLIT_SEPARATOR.file.width)}
            style:background={fillCss(theme.frame)}
          ></div>
        </div>
      {/if}

      {@const value = side.key === 'attack' ? card.attack : card.defense}
      {@const ability = side.key === 'attack' ? card.ability : card.defenseAbility}
      {@const symbol = CARD_SYMBOL_SIZES[side.key]}
      <div
        class="half"
        class:upper={side.key === 'attack'}
        style:margin-inline={pu(SPLIT_SEPARATOR_OVERHANG)}
        style:min-height={pu(side.key === 'attack' ? SPLIT.minUpper : SPLIT.minLower)}
        style:padding-block={pu(SPLIT.padding)}
      >
        {#if value !== null}
          <img
            class="split-symbol"
            src={CARD_SYMBOLS[side.key]}
            alt={side.key}
            style:left={px(VALUE_STACK.symbolCenterX - symbol.width / 2 - BODY_PANEL.x, BODY_PANEL)}
            style:top={pu(SPLIT.padding)}
            style:width={pu(symbol.width)}
          />
          <span
            class="split-number"
            style:left={px(VALUE_STACK.numberX - BODY_PANEL.x, BODY_PANEL)}
            style:top={pu(SPLIT.padding + VALUE_STACK.numberOffset - 25)}
            style:font-size={pu(VALUE_STACK.numberSize)}
          >
            {value}
          </span>
        {/if}

        <!--
          Same block as the unsplit card: the rule stretches to whichever is
          taller, this half's symbol or its ability text.

          `min-height` holds even with no rule to stretch — it is what keeps
          the half tall enough for its symbol, which is positioned over the
          block rather than inside it.
        -->
        <div
          class="ability-block"
          style:margin-left={px(ABILITY_RULE.x - BODY_PANEL.x, BODY_PANEL)}
          style:min-height={pu(value === null ? 0 : symbol.height)}
        >
          <!--
            A split half prints no placeholder, so with no copy there is
            nothing for the rule to separate the value from — and a rule
            against blank space reads as an error. It only appears once the
            half has both.
          -->
          {#if value !== null && !abilityIsEmpty(ability)}
            <div
              class="rule-v"
              style:width={pu(ABILITY_RULE.width)}
              style:background={theme.bodyInk}
            ></div>
          {/if}

          <div
            class="block-ability"
            style:margin-left={pu(abilityGap)}
            style:width={pu(ABILITY.width)}
            style:font-size={pu(ABILITY.size)}
            style:line-height={ABILITY.lineHeight}
            style:letter-spacing="{ABILITY.tracking}em"
          >
            <AbilityText {ability} placeholder="" subject={ribbonName} />
          </div>
        </div>
      </div>
    {/each}
  </div>
{/snippet}

<!-- Outer frame: it covers everything outside the card window. -->
<div class="mask outer-border" style:background={fillCss(theme.frame)}></div>

<!-- The copies count prints over the border, so it is drawn after it. -->
<div
  class="quantity"
  style:right={px(BLEED.width - QUANTITY.right)}
  style:top={py(capTopToBoxTop(QUANTITY.capTop, QUANTITY.size))}
  style:font-size={pu(QUANTITY.size)}
  style:color={theme.bodyInk}
>
  <!--
    A lowercase letter x, not the multiplication sign: the printed mark is a
    full x-height "x" sitting on the baseline beside the figure, where "×" sets
    small and centres itself on the digit's middle.
  -->
  x{card.quantity}
</div>

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

  /*
   * Always its printed size. The panel rises over the artwork rather than
   * resizing it, so the image is never rescaled to fit a moving window —
   * what it shows is the Design tab's business and nothing else's.
   */
  .art {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    overflow: hidden;
  }

  /*
   * Divider and panel, anchored to the bottom of the interior and sized by
   * their contents, so the panel grows upward and carries the divider — and
   * the boost riding on it — up the card.
   */
  .stack {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    display: flex;
    flex-direction: column;
  }

  /*
   * Lifted above the panel because the boost ring hangs well below the bar,
   * and the panel's background would otherwise paint over its lower half.
   */
  .divider {
    position: relative;
    flex: none;
    z-index: 1;
  }

  /* Sized by its contents, floored at the printed height, capped past that. */
  .body {
    position: relative;
    flex: none;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .panel-lead,
  .panel-foot {
    flex: none;
    width: 100%;
  }

  /*
   * The tile is sized from the file's own proportions. An SVG asked for a
   * shape that is not its own letterboxes rather than stretching, so a square
   * tile size opens transparent gaps in every pattern that is not square.
   */
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

  /* -- masked template chrome ------------------------------------------ */
  .mask {
    position: absolute;
    inset: 0;
    pointer-events: none;
    mask-size: 100% 100%;
    -webkit-mask-size: 100% 100%;
    mask-repeat: no-repeat;
    -webkit-mask-repeat: no-repeat;
  }

  .outer-border {
    mask-image: url('/assets/templates/outer_border.png');
    -webkit-mask-image: url('/assets/templates/outer_border.png');
  }

  /*
   * The ring, lifted out of the divider art at its natural size so it keeps
   * its drawn shape wherever the divider has ended up.
   */
  .boost-ring {
    position: absolute;
    pointer-events: none;
    mask-image: url('/assets/templates/inner_border.png');
    -webkit-mask-image: url('/assets/templates/inner_border.png');
    mask-size: var(--ring-size);
    -webkit-mask-size: var(--ring-size);
    mask-position: var(--ring-position);
    -webkit-mask-position: var(--ring-position);
    mask-repeat: no-repeat;
    -webkit-mask-repeat: no-repeat;
  }

  /* -- name ribbon ----------------------------------------------------- */
  /*
   * Hangs from the card's top edge; its height is whatever its contents come
   * to, which is how the name sets the ribbon's length.
   */
  .banner {
    position: absolute;
    top: 0;
    display: flex;
    flex-direction: column;
    /* The ribbon's centre line is the name's, so this is what keeps type on axis. */
    align-items: center;
  }

  /*
   * One painted box for the whole ribbon — which is what keeps a gradient
   * running unbroken from the top of the run into the point — cut to shape by
   * two mask layers. The first is a plain rectangle covering everything above
   * the head, so the run stretches without distorting. The second is the art,
   * placed at its natural size and anchored to the ribbon's bottom, so the
   * point translates rather than scales and keeps its proportions.
   *
   * The box is as wide as the head, which overhangs the run on the left; the
   * run layer is inset to match.
   */
  .banner-ink {
    position: absolute;
    top: 0;
    bottom: 0;
    mask-size: var(--run-size), var(--head-size);
    -webkit-mask-size: var(--run-size), var(--head-size);
    mask-position: var(--run-position), var(--head-position);
    -webkit-mask-position: var(--run-position), var(--head-position);
    mask-repeat: no-repeat;
    -webkit-mask-repeat: no-repeat;
    mask-composite: add;
    pointer-events: none;
  }

  .banner-face {
    mask-image: linear-gradient(#000, #000), url('/assets/templates/banner_fill.png');
    -webkit-mask-image: linear-gradient(#000, #000), url('/assets/templates/banner_fill.png');
  }

  .banner-outline {
    mask-image: linear-gradient(#000, #000), url('/assets/templates/banner_border.png');
    -webkit-mask-image: linear-gradient(#000, #000), url('/assets/templates/banner_border.png');
  }

  .banner-lead,
  .banner-tail,
  .banner-head {
    flex: none;
    width: 100%;
  }

  /*
   * A plain circle rather than a masked full-card layer, so a gradient fill
   * spans the disc instead of the whole 1632px frame.
   */
  .boost-disc {
    position: absolute;
    border-radius: 50%;
    pointer-events: none;
  }

  /* -- type ------------------------------------------------------------ */
  /*
   * Set in a vertical writing mode rather than rotated: the type really is
   * laid out down the ribbon, so the box's height is the name's length and the
   * column can size itself from it. A rotation would have left a horizontal
   * box that the column could not read.
   *
   * `vertical-rl` sets Latin sideways clockwise; the half turn brings it back
   * to reading bottom-up — the same face the rotation used to give — and puts
   * the name's end at the top of the box.
   */
  .name {
    position: relative;
    flex: none;
    writing-mode: vertical-rl;
    rotate: 180deg;
    font-family: var(--card-font-name);
    font-weight: var(--card-font-name-weight);
    line-height: 0.88;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /*
   * `line-height` and the horizontal squeeze both come from `TITLE` — see there
   * for why. The squeeze is anchored left because that is the edge the title is
   * positioned by; scaling about the centre would walk it off its measured `x`.
   */
  .title {
    position: absolute;
    font-family: var(--card-font-name);
    font-weight: var(--card-font-name-weight);
    transform-origin: left center;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .rule {
    position: absolute;
  }

  .value-symbol {
    position: absolute;
    height: auto;
  }

  /* -- split layout ---------------------------------------------------- */
  /*
   * Grows the panel while there is room to give and shrinks once the panel is
   * at its cap, so an over-full split card truncates with its separator still
   * on the card rather than pushing it off the bottom.
   */
  .split {
    position: relative;
    flex: 0 1 auto;
    display: flex;
    flex-direction: column;
    /*
     * Once both halves are at their floors there is no more room to give, so an
     * over-full card truncates at the panel edge rather than printing over the
     * border. Visible truncation is the signal that the text is too long.
     */
    overflow: hidden;
  }

  /*
   * The lower half is sized by its content; the upper half grows into what is
   * left. That is what makes the rule float without measuring anything.
   */
  .half {
    position: relative;
    /* Sized by content while there is slack; gives way once there is none. */
    flex: 0 1 auto;
    /*
     * A half that has run out of room truncates at its own edge. Without this
     * the copy — and now the rule, which is as long as the copy — would carry
     * on across the separator and into the other half.
     */
    overflow: hidden;
  }

  .half.upper {
    flex: 1 1 auto;
  }

  /*
   * The separator occupies only its flat bar. The art is taller and hangs from
   * the bar's bottom edge, so its curved shoulders rise into the upper half's
   * outer corners — where the value symbol and the ability column never reach.
   */
  .split-separator {
    position: relative;
    flex: none;
    width: 100%;
  }

  .separator-art {
    position: absolute;
    bottom: 0;
    mask-image: url('/assets/templates/split_effect_separator.png');
    -webkit-mask-image: url('/assets/templates/split_effect_separator.png');
    mask-size: 100% 100%;
    -webkit-mask-size: 100% 100%;
    mask-repeat: no-repeat;
    -webkit-mask-repeat: no-repeat;
    pointer-events: none;
  }

  .split-symbol {
    position: absolute;
    height: auto;
  }

  .split-number {
    position: absolute;
    font-family: var(--card-font-numeral);
    font-weight: var(--card-font-numeral-weight);
    line-height: 1;
  }

  .value-number {
    position: absolute;
    font-family: var(--card-font-numeral);
    font-weight: var(--card-font-numeral-weight);
    line-height: 1;
  }

  /* -- rule and ability text ------------------------------------------- */
  /*
   * The rule and the copy it separates are one row, and the rule is a flex
   * item that stretches. Its length is therefore the row's height: the ability
   * text's own height, floored at the value stack's run and capped at the
   * bottom the copy was already held to. That is how the rule matches the
   * taller of the two columns without measuring either.
   */
  .ability-block {
    position: relative;
    display: flex;
    align-items: stretch;
    overflow: hidden;
  }

  /*
   * Split: the half is the bound. The block stops at the half's content edge,
   * so an over-long ability truncates there and the rule stops with it rather
   * than being laid out across the separator.
   */
  .half .ability-block {
    max-height: 100%;
  }

  .rule-v {
    flex: none;
  }

  .block-ability {
    position: relative;
    font-family: var(--card-font-text);
    font-weight: var(--card-font-text-weight);
  }

  /*
   * Centred across by the box — a digit's ink is near enough symmetrical
   * horizontally — and down by its *digits*, which is not the same thing. See
   * `digitMiddleToBoxTop`. Leading comes from `BOOST_VALUE.lineHeight`, set
   * inline, because the placement is solved against that same number.
   */
  .boost-value {
    position: absolute;
    translate: -50% 0;
    font-family: var(--card-font-numeral);
    font-weight: var(--card-font-numeral-weight);
  }

  .quantity {
    position: absolute;
    font-family: var(--card-font-text);
    font-weight: var(--card-font-text-weight);
    line-height: 1;
    opacity: 0.9;
  }
</style>
