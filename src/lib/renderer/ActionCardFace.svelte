<script lang="ts">
  /**
   * Villain / minion / hero action card.
   *
   * The printed chrome is the real template art used as alpha masks, so the
   * frame, ribbon, divider and boost disc keep their exact drawn shapes while
   * still taking any colour or gradient. Everything else is positioned from
   * `geometry.ts`, in bleed pixels, converted to percentages.
   *
   * A hero's card shares this component rather than getting its own, because
   * almost everything about it is unchanged: the frame, the artwork, the
   * divider, the boost disc, the title and its rule, and — the moment a card
   * has no attack/defense values to separate it from, which a hero card never
   * does — the ability text's own left-aligned layout. What differs is
   * confined to two places, both branched on `isHero`: the ribbon, and the
   * line above the copies count.
   */
  import type { CardTheme } from '$lib/cards/style';
  import { customPatternFilter, fillCss } from '$lib/cards/style';
  import type { ActionCard } from '$lib/cards/types';
  import { abilityIsEmpty } from '$lib/cards/types';
  import { primaryCardName, resolvedHeroName } from '$lib/characters/factory';
  import type { Character } from '$lib/characters/types';
  import type { CustomSymbol } from '$lib/symbols/types';
  import { parseAbilityText } from '$lib/text/tokens';
  import AbilityText from './AbilityText.svelte';
  import { CARD_SYMBOL_COLORS, CARD_SYMBOL_SIZES, CARD_SYMBOLS, patternAspect } from './assets';
  import type { CardSymbolName } from './assets';
  import CardArt from './CardArt.svelte';
  import {
    ABILITY,
    ABILITY_RULE,
    ART_WINDOW,
    BANNER,
    BANNER_HEAD,
    BANNER_HEAD_BELOW,
    belowTitleRule,
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
    HERO_ART_WINDOW_HEIGHT,
    HERO_BODY_PANEL_FOOT_CLEARANCE,
    HERO_BODY_PANEL_HEIGHT,
    HERO_POINT_BELOW,
    HERO_RIBBON,
    HERO_RIBBON_OWNER,
    HERO_RIBBON_OWNER_LEFT,
    HERO_RIBBON_SYMBOL,
    HERO_RIBBON_VALUE,
    inFace,
    inPanel,
    INTERIOR,
    INTERIOR_RADIUS,
    NAME,
    NAME_METRICS,
    NAME_TOP,
    OWNER_LINE,
    px,
    pu,
    py,
    QUANTITY,
    RIBBON_FOOT,
    seamBed,
    SPLIT,
    SPLIT_DEFAULT_HEIGHT,
    SPLIT_SEPARATOR,
    SPLIT_SEPARATOR_BAR,
    SPLIT_SEPARATOR_OVERHANG,
    SPLIT_TOP,
    TITLE,
    TITLE_BOX_TOP,
    TITLE_RULE,
    TITLE_RULE_GAP,
    VALUE_STACK
  } from './geometry';

  interface Props {
    card: ActionCard;
    character: Character | null;
    theme: CardTheme;
    customSymbols?: CustomSymbol[];
  }

  let { card, character, theme, customSymbols = [] }: Props = $props();

  /**
   * How many lines a card title may wrap to before it is clipped.
   *
   * A policy rather than a measurement, which is why it lives here and not in
   * `geometry.ts`: no printed card has a title this long, so there is nothing
   * to measure — two lines is as far as one can run before it starts pushing
   * the ability copy somewhere the card cannot hold it.
   */
  const TITLE_MAX_LINES = 2;

  interface ValueRow {
    key: CardSymbolName;
    value: number;
    /** Row top edge, in bleed pixels. */
    top: number;
  }

  const isHero = $derived(character?.role === 'hero');

  /**
   * Ability text size, overriding `ABILITY.size` — see `CardTheme.abilityFontSize`
   * for why this is a live override rather than the constant itself.
   */
  const abilitySize = $derived(inFace(theme.abilityFontSize));

  /**
   * The character's name as the *ribbon* prints it.
   *
   * `subtitle` is a shortened form — "Geralt" against "Geralt of Rivia" — and
   * the ribbon is where the difference matters, because it is the one place a
   * name is set at display size in a column two centimetres wide. Blank is the
   * ordinary case, and then there is only the one name.
   *
   * For a hero, that "one name" is the *primary identity's* own name
   * (`primaryCardName`), not the whole hero's — a duo's ribbon must still say
   * "Cloak," never "Cloak & Dagger," on a card only she plays.
   */
  const shortName = $derived(
    character?.subtitle.trim() || (character ? primaryCardName(character) : '').trim() || ''
  );

  const ribbonName = $derived(card.name.trim() || shortName || 'Villain Name');
  const title = $derived(card.title.trim() || 'Card Title');

  /**
   * Who may play this card: the primary identity's own name, an additional
   * character card's own name, the sidekick's, or the literal word "ANY".
   * Follows the same empty-name fallback as `ribbonName`, because it is the
   * same situation — a card newly dropped into the deck, before anyone has
   * named it. An `owner` that doesn't resolve to anything (a deleted
   * additional card, most likely) falls through to the primary identity,
   * same as `'hero'` itself.
   *
   * Twice, because the two places it prints want different lengths: the
   * ribbon takes the short name, and the line above the copies count — which
   * has a whole card's width to run in — takes the full one.
   */
  const ownerLabel = $derived.by(() => {
    if (card.owner === 'sidekick') return character?.sidekick.name.trim() || 'Sidekick';
    if (card.owner === 'any') return 'ANY';
    const extra = character?.additionalCards.find((entry) => entry.id === card.owner);
    const extraShortName = extra ? extra.subtitle.trim() || extra.name.trim() : '';
    return card.name.trim() || extraShortName || shortName || 'Hero Name';
  });

  /**
   * The line above the copies count is always the *whole hero's* resolved
   * identity, whoever may play the card. It says which figure's deck this
   * card belongs to — which is the same deck either way, sidekick and every
   * additional card's cards included — where the ribbon says who
   * specifically plays it. Falls back to every card's own name joined, the
   * same as the sidebar and the deck back, so a duo with no group name typed
   * in yet still prints something sensible instead of "Hero Name."
   */
  const ownerFullLabel = $derived(
    (character ? resolvedHeroName(character) : '').trim() || 'Hero Name'
  );

  /**
   * Attack then defense, skipping whichever the card does not print.
   *
   * Always empty for a hero card. Not because `card.attack`/`card.defense`
   * are cleared — a card keeps whatever it last held if its owner's role
   * changes, the way every other field here survives a re-assignment — but
   * because a hero's combat value lives in the ribbon instead, in `symbol` and
   * `symbolValue`, and showing both would print the same value twice.
   */
  const values = $derived.by((): ValueRow[] => {
    if (isHero) return [];
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

  const heroSymbol = $derived(card.symbol ?? 'attack');

  /**
   * A scheme card prints no number.
   *
   * Attack, defense and versatile all name a value the card is played *for*;
   * scheme names a card played for none, which is exactly why the symbol is
   * drawn tall enough to fill the head on its own. Gated on the symbol rather
   * than on the field being empty, so switching a card to scheme and back
   * returns the value it had.
   */
  const showSymbolValue = $derived(heroSymbol !== 'scheme' && card.symbolValue !== null);

  /*
   * The ribbon's foot follows whichever ribbon this card carries — a hero's
   * (252 wide, its own axis at 262) or a villain's (230, centred on its run).
   * Offsets are relative to `.interior`, which is what the strip lives in.
   *
   * A villain's ribbon starts left of the interior, so `footLeft` is negative
   * there. That is correct and not a clamp waiting to happen: the strip is
   * exactly as wide as the ribbon above it, and `.interior` crops the overhang
   * the printed frame covers anyway.
   */
  const footLeft = $derived((isHero ? HERO_RIBBON.x : BANNER.x) - INTERIOR.x);
  const footWidth = $derived(isHero ? HERO_RIBBON.width : BANNER.width);
  const footAxis = $derived(
    (isHero ? HERO_RIBBON.centerX : BANNER.x + BANNER.width / 2) - INTERIOR.x
  );
  /* The ribbon's own stroke weight, so the bar below it is the same line. */
  const footEdgeWidth = $derived(isHero ? HERO_RIBBON.edgeWidth : BANNER.edge.width);

  /* Resolved exactly as `AbilityText` resolves `bonusIcon` — same token, same
     lookup — so a built-in and an author's own glyph behave identically. */
  const ribbonSymbolSrc = $derived.by(() => {
    if (!card.showRibbonSymbol || !card.ribbonSymbol) return null;
    const [segment] = parseAbilityText(card.ribbonSymbol);
    if (segment?.kind === 'symbol') return CARD_SYMBOLS[segment.name];
    if (segment?.kind === 'customSymbol') {
      return customSymbols.find((entry) => entry.id === segment.id)?.source ?? null;
    }
    return null;
  });
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
  <div class="art" style:height={pu(isHero ? HERO_ART_WINDOW_HEIGHT : ART_WINDOW.height)}>
    <CardArt artwork={card.artwork} background={fillCss(theme.artBackground)} />
  </div>

  <!--
    Bottom-anchored, so the panel grows upward. Its own height is its copy's,
    which is what carries the divider — and the boost riding on it — up the
    card.
  -->
  <div class="stack" style:max-height={pu(INTERIOR.height - ART_WINDOW.minHeight)}>
  <!--
    The ribbon's foot: the strip between the ribbon's point and the divider.

    Drawn as one tall column standing *on* the divider and running up behind
    the ribbon, rather than as a box measured to fit the gap — because the gap
    has no measurable size. The ribbon's length is its contents (see `.banner`)
    and the divider rides up with the body panel, so both ends of that strip
    move independently and nothing in this file is allowed to measure text at
    runtime. Over-running upward costs nothing: the ribbon paints over it, and
    `.interior`'s own `overflow: hidden` crops whatever reaches the top.

    Two layers, not one: the strip is filled in `ribbonFoot` — black on the
    printed card — and only the bar down its right edge is `divider`. That bar
    is the continuous line, picking up where the ribbon's own stroke ends and
    running into the divider, and it has to be able to differ from the field it
    crosses or there is no line to see. It is right-aligned rather than placed,
    because a ribbon's stroke sits flush with its outer edge on both layouts:
    380..399 of the hero's 147..399, and 345..362 of the villain's 132..362.
  -->
  {#if card.showRibbonSymbol}
    <div
      class="ribbon-foot"
      style:left={pu(footLeft)}
      style:width={pu(footWidth)}
      style:height={pu(INTERIOR.height)}
      style:background={fillCss(theme.ribbonFoot)}
    >
      <div
        class="ribbon-foot-edge"
        style:width={pu(footEdgeWidth)}
        style:background={theme.divider}
      ></div>
      {#if ribbonSymbolSrc}
        <img
          class="ribbon-foot-symbol"
          src={ribbonSymbolSrc}
          alt=""
          style:left={pu(footAxis - footLeft)}
          style:bottom={pu(RIBBON_FOOT.gap)}
          style:height={pu(theme.ribbonSymbolSize)}
        />
      {/if}
    </div>
  {/if}

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
        style:border-width={pu(BOOST.outerRadius - BOOST.innerRadius)}
        style:border-color={theme.divider}
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
    style:min-height={pu(isHero ? HERO_BODY_PANEL_HEIGHT : BODY_PANEL.height)}
    style:max-height={pu(BODY_PANEL_MAX_HEIGHT)}
    style:padding-bottom={isHero ? pu(HERO_BODY_PANEL_FOOT_CLEARANCE) : undefined}
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
      <!--
        `left`/`top` are percentages of this element's own *containing
        block* (`.body`), but `cqw` is a percentage of the nearest
        container-query ancestor, which is the whole plate, not `.body` —
        two different reference widths in what looked like one `calc()`.
        At `.body` narrower than the plate (the usual case) the two only
        happened to roughly agree at a small scale; past it, growing
        `scale` shrank the `100% - 70cqw*scale` slack term against the
        wrong (smaller) width, so the image raced past `.body`'s own
        bounds and the offset math pushed it visibly sideways well before
        the slider neared its own maximum.

        Fixed by never mixing the two: `width` is a percentage of `.body`
        alone, `aspect-ratio: 1` derives a matching height without a
        second, height-relative percentage to keep in step with it, and
        `left`/`top` position the `offsetX`/`offsetY` point of `.body`
        itself, with `translate()` pulling the image back by that same
        fraction of its *own* rendered box (a percentage in `transform`
        resolves against the element, not the container) — the standard
        anchor-point trick, and unlike the old subtraction it never needs
        to know the image's absolute size to stay centred.
      -->
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
      Body panel content. The title is the one thing here still placed off the
      panel's top; everything else is placed off the rule beneath it instead,
      so a title that wraps to a second line carries the rule — and the values
      and ability text below it — down with it. See `TITLE_RULE_GAP` and
      `belowTitleRule`.
    -->
    <div class="panel-lead" style:height={pu(inPanel(TITLE_BOX_TOP))}></div>

    <!--
      Set in flow rather than pinned, so a long title wraps to a second line
      instead of running off the panel or ellipsising into something
      unreadable — the printed cards have no such limit on a title's length.
    -->
    <div
      class="title"
      style:margin-left={pu(TITLE.x - BODY_PANEL.x)}
      style:width={pu(TITLE.width)}
      style:font-size={pu(TITLE.size)}
      style:line-height={TITLE.lineHeight}
      style:letter-spacing="{TITLE.tracking}em"
      style:scale="{TITLE.condense} 1"
      style:max-height={pu(TITLE.size * TITLE.lineHeight * TITLE_MAX_LINES)}
      style:color={theme.bodyInk}
    >
      <!--
        Tokens, same as ability copy — the editor offers the palette here, so
        this has to understand what it inserts or the braces print. `subject`
        resolves to `ribbonName`, matching the ability text below, so `{{name}}`
        means the same thing wherever it is written on the card.

        Inline content of an ordinary block, which is the whole of why this
        works — see `.title`'s own note on why it is no longer a `-webkit-box`.
        Sized inline in `pu()` like every other symbol on this face rather than
        through an `em` and a custom property, so there is one mechanism to be
        wrong about instead of three.
      -->
      <!--
        Written without a break between the tags on purpose. This is inline
        content now, so any newline Svelte keeps between a symbol and the text
        beside it collapses to a real space — `Hit{{attack}}` would print as
        "HIT ⚔". Legibility is bought back by the comment above rather than by
        indentation.
      -->
      {#each parseAbilityText(title) as segment, index (index)}{#if segment.kind === 'symbol'}<img
            class="title-symbol"
            src={CARD_SYMBOLS[segment.name]}
            alt={segment.name}
            style:height={pu(TITLE.size * NAME_METRICS.cap)}
            style:scale="{1 / TITLE.condense} 1"
          />{:else if segment.kind === 'customSymbol'}{@const custom = customSymbols.find(
          (s) => s.id === segment.id
        )}{#if custom?.source}<img
              class="title-symbol"
              src={custom.source}
              alt={custom.name}
              style:height={pu(TITLE.size * NAME_METRICS.cap)}
              style:scale="{1 / TITLE.condense} 1"
            />{/if}{:else if segment.kind === 'subject'}{ribbonName}{:else}{segment.value}{/if}{/each}
    </div>

    <div class="panel-lead" style:height={pu(TITLE_RULE_GAP)}></div>

    <div
      class="rule"
      style:margin-left={pu(TITLE_RULE.x - BODY_PANEL.x)}
      style:width={pu(TITLE_RULE.width)}
      style:height={pu(TITLE_RULE.height)}
      style:background={theme.bodyInk}
    ></div>

    <!--
      Everything from here down is positioned against this wrapper's own top
      edge rather than the panel's — which is wherever the rule above ended up
      once the title had its say, in flow, rather than a number fixed in
      advance. `belowTitleRule` is the conversion.
    -->
    <div class="below-title">
      {#if card.split}
        <div class="panel-lead" style:height={pu(belowTitleRule(SPLIT_TOP))}></div>
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
              style:top={pu(belowTitleRule(row.top))}
              style:width={pu(size.width)}
            />
            <span
              class="value-number"
              style:left={pu(VALUE_STACK.numberX - BODY_PANEL.x)}
              style:top={pu(
                belowTitleRule(
                  digitTopToBoxTop(row.top + VALUE_STACK.numberOffset, VALUE_STACK.numberSize)
                )
              )}
              style:font-size={pu(VALUE_STACK.numberSize)}
              style:color={theme.bodyInk}
            >
              {row.value}
            </span>
          {/each}
        {/if}

        <div
          class="panel-lead"
          style:height={pu(belowTitleRule(hasValues ? ABILITY_RULE.y : abilityTop))}
        ></div>

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
              style:font-size={pu(abilitySize)}
              style:line-height={ABILITY.lineHeight}
              style:letter-spacing="{ABILITY.tracking}em"
              style:color={theme.bodyInk}
            >
              <AbilityText
                ability={card.ability}
                subject={ribbonName}
                bonusInk={theme.bonusAbilityInk}
                bonusIconSize={theme.bonusIconSize}
                {customSymbols}
              />
            </div>
          </div>
        {:else}
          <!-- No values to separate: the copy runs the panel's full measure. -->
          <div
            class="block-ability"
            style:margin-left={pu(TITLE.x - BODY_PANEL.x)}
            style:width={pu(ABILITY.x + ABILITY.width - TITLE.x)}
            style:font-size={pu(abilitySize)}
            style:line-height={ABILITY.lineHeight}
            style:letter-spacing="{ABILITY.tracking}em"
            style:color={theme.bodyInk}
          >
            <AbilityText
              ability={card.ability}
              subject={ribbonName}
              bonusInk={theme.bonusAbilityInk}
              bonusIconSize={theme.bonusIconSize}
              {customSymbols}
            />
          </div>
        {/if}

        <div class="panel-foot" style:height={pu(ABILITY.bottomInset)}></div>
      {/if}
    </div>
  </div>
  </div>
</div>

{#if isHero}
  <!--
    A hero's combat ribbon.

    Same column as the name ribbon below, and for the same reason: the ribbon's
    length *is* its contents, so the name sets it without anything being
    measured. What is stacked in it is a fixed lead for the head, the name, the
    clearance above the shoulder, and the pennant point.

    The three painted layers are not in that column — each spans the whole
    ribbon and is cut to shape by a mask, so none of them has to know how long
    it is. Their order is the whole of the ribbon's construction:

      fill     the run and its point, in the banner colour
      head     the combat block over the top of it, in the symbol's colour —
               which is what keeps it still while the name grows underneath,
               and what makes the seam between the two colours the head's own
               printed chevron rather than a line ruled across a box
      outline  over both, because the head is the ribbon's full width and an
               outline under it is one the head paints out
  -->
  <div
    class="banner"
    style:left={px(HERO_RIBBON.x)}
    style:width={px(HERO_RIBBON.width)}
    style:top={py(HERO_RIBBON.top)}
  >
    <div
      class="banner-ink hero-face"
      style:left="0"
      style:width="100%"
      style:--run-size="calc(100% - {pu(HERO_RIBBON.edgeWidth)}) calc(100% - {pu(HERO_RIBBON.pointHeight)})"
      style:--run-position="left 0 top 0"
      style:--head-size="{pu(BLEED.width)} {pu(BLEED.height)}"
      style:--head-position="left {pu(-HERO_RIBBON.x)} bottom {pu(-HERO_POINT_BELOW)}"
      style:background={fillCss(theme.banner)}
    ></div>
    <div
      class="hero-head"
      style:--head-size="{pu(BLEED.width)} {pu(BLEED.height)}"
      style:--head-position="left {pu(-HERO_RIBBON.x)} top {pu(-HERO_RIBBON.top)}"
      style:background={CARD_SYMBOL_COLORS[heroSymbol]}
    ></div>
    <!--
      The stroke: down the right edge, and round the foot. Nowhere else — the
      printed ribbon has none on its left, where it meets the frame, and none
      across its top.

      It does not lie *over* the fill; the two are cut from one silhouette and
      tile. That is why the fill's own run stops `edgeWidth` short of the right
      edge above: laying a stroke over a full-width fill can only eat back into
      it, which is what made the point come out solid stroke-colour and the
      corners look bitten.
    -->
    <div
      class="hero-outline"
      style:left="0"
      style:width="100%"
      style:--edge-run="calc(100% - {pu(HERO_RIBBON.pointHeight)})"
      style:--edge-width={pu(HERO_RIBBON.edgeWidth)}
      style:--point-size="{pu(BLEED.width)} {pu(BLEED.height)}"
      style:--point-position="left {pu(-HERO_RIBBON.x)} bottom {pu(-HERO_POINT_BELOW)}"
      style:background={theme.divider}
    ></div>

    <div class="banner-lead" style:height={pu(HERO_RIBBON_OWNER.top - HERO_RIBBON.top)}></div>

    <!--
      Who may play the card. Vertical for the same reason the name it replaces
      is, and positioned across the ribbon rather than centred in it — see
      `HERO_RIBBON_OWNER_LEFT`, and note that `align-items: center` on the
      column would centre this on the run at 268.5 rather than on the point
      at 262.
    -->
    <div
      class="hero-owner-text"
      style:align-self="flex-start"
      style:margin-left={pu(HERO_RIBBON_OWNER_LEFT - HERO_RIBBON.x)}
      style:font-size={pu(HERO_RIBBON_OWNER.size)}
      style:line-height={HERO_RIBBON_OWNER.lineHeight}
      style:max-height={pu(HERO_RIBBON_OWNER.maxLength)}
      style:color={theme.bannerInk}
    >
      {ownerLabel}
    </div>

    <div class="banner-tail" style:height={pu(HERO_RIBBON_OWNER.pointGap)}></div>

    <!-- The point is painted by the ink layers; here it only reserves its run. -->
    <div class="banner-head" style:height={pu(HERO_RIBBON.pointHeight)}></div>
  </div>

  <!--
    Icon and value, in the coloured head. The icon is forced white by filter
    rather than swapped for a white asset: `CARD_SYMBOLS` already exists in the
    villain/minion colours this same file draws elsewhere, and
    `brightness(0) invert(1)` turns any opaque pixel white while leaving
    transparency alone — the identical trick printer-friendly mode already uses
    on these same four files, for the same reason.
  -->
  {@const size = CARD_SYMBOL_SIZES[heroSymbol]}
  <img
    class="hero-symbol"
    src={CARD_SYMBOLS[heroSymbol]}
    alt={heroSymbol}
    style:left={pu(HERO_RIBBON_SYMBOL.centerX - size.width / 2)}
    style:top={pu(HERO_RIBBON_SYMBOL.top)}
    style:width={pu(size.width)}
  />

  {#if showSymbolValue}
    <span
      class="hero-symbol-value"
      style:left={pu(HERO_RIBBON.centerX)}
      style:top={pu(digitTopToBoxTop(HERO_RIBBON_VALUE.top, HERO_RIBBON_VALUE.size))}
      style:font-size={pu(HERO_RIBBON_VALUE.size)}
      style:color={theme.bannerInk}
    >
      {card.symbolValue}
    </span>
  {/if}
{:else}
  <!--
    Name ribbon. A column: the clearance below the frame, the name, the
    clearance above the shoulder, then the pennant head — so the ribbon's
    length *is* its contents, and the name sets it without anything being
    measured.

    Fill and outline are each one element spanning the whole ribbon, so a
    gradient is painted once down its full length rather than restarting at the
    point. Each is cut to shape by two mask layers: a plain rectangle for the
    straight run — which can therefore be any length without distorting — and
    the art itself for the pennant head, sampled at its natural size.
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
{/if}

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
            style:font-size={pu(abilitySize)}
            style:line-height={ABILITY.lineHeight}
            style:letter-spacing="{ABILITY.tracking}em"
          >
            <AbilityText
              {ability}
              placeholder=""
              subject={ribbonName}
              bonusInk={theme.bonusAbilityInk}
              bonusIconSize={theme.bonusIconSize}
              {customSymbols}
            />
          </div>
        </div>
      </div>
    {/each}
  </div>
{/snippet}

<!--
  Outer frame: it covers everything outside the card window.

  A hero's is its own file, not a reuse of the villain's. The supplied art
  differs in one visible way — its bottom right corner takes the same radius as
  the other three, where the villain frame sweeps out to clear the copies count
  — and in one invisible one: its window sits four pixels further in, which is
  why the interior behind it is drawn to `INTERIOR` either way and simply
  covered a little more.
-->
<div
  class="mask outer-border"
  class:hero-border={isHero}
  style:background={fillCss(theme.frame)}
></div>

<!-- The copies count prints over the border, so it is drawn after it. -->
<div
  class="quantity"
  style:right={px(BLEED.width - (isHero ? OWNER_LINE.right : QUANTITY.right))}
  style:top={py(capTopToBoxTop(isHero ? OWNER_LINE.capTop : QUANTITY.capTop, QUANTITY.size))}
  style:font-size={pu(QUANTITY.size)}
  style:color={theme.bodyInk}
>
  <!--
    Who owns the card, ahead of the count — the one thing here that is new for
    a hero card. `right` alone anchors this element, with no `left` or `width`
    set, so prepending copy grows the box leftward and the count stays put
    exactly where it already was.
  -->
  {#if isHero}
    <span class="quantity-owner">{ownerFullLabel}</span>
    <span class="quantity-rule" style:width={pu(OWNER_LINE.ruleWidth)}></span>
  {/if}
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

  /*
   * `isolation: isolate` is load bearing, and the reason is worth keeping.
   *
   * `.divider`, `.title`, `.rule` and `.below-title` all carry `z-index: 1`
   * so they paint above `.pattern`/`.custom-pattern` — see `.title`'s own
   * note on why that had to be pinned explicitly for the `foreignObject`
   * rasteriser. But `position: absolute` with `z-index: auto` does **not**
   * establish a stacking context, so those z-indexes were not scoped to the
   * interior at all: they resolved against the *plate*, and a positioned
   * element with `z-index: 1` paints above one with `z-index: auto`
   * regardless of DOM order — which is what `.outer-border` is. The frame
   * was therefore painted *under* the divider rather than over it.
   *
   * Invisible on a villain or minion, whose frame window is exactly
   * `INTERIOR` (143..1488 in `outer_border.png`), so the divider has nothing
   * to stick out past. A hero's window sits four pixels further in
   * (148..1484 in `hero_action_frame.png` — the difference the frame comment
   * above calls out), so the divider printed 5px into the frame on the left
   * and 4px on the right. `overflow: hidden` still clipped it to `INTERIOR`,
   * which is why it looked like a neat couple-pixel overhang rather than
   * anything wilder.
   *
   * Isolating here keeps the ordering those z-indexes were added for — every
   * one of them is a descendant of this box, as are the pattern layers they
   * sit above — while putting the interior as a whole back underneath the
   * frame where DOM order already had it.
   */
  .interior {
    position: absolute;
    overflow: hidden;
    isolation: isolate;
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
  /*
   * Stands on the divider (`bottom: 100%` against `.stack`, whose first flow
   * child is the bar) and runs up behind the ribbon. No `z-index`: it must
   * stay *under* `.divider`, which has one, and under the ribbon, which is
   * outside `.interior` and painted after it.
   */
  .ribbon-foot {
    position: absolute;
    bottom: 100%;
    pointer-events: none;
  }

  /*
   * Bottom-aligned, and centred on the ribbon's own axis rather than on the
   * strip's — a hero's ribbon comes to its point at 262, not at the middle of
   * its run, and the symbol has to stand over the point like the name above it
   * does. `translateX(-50%)` is what lets `left` be that axis directly.
   */
  /* Flush with the strip's right edge and running its whole height, so it
     meets the ribbon's stroke above and the divider bar below with nothing
     between. Under the symbol, which is a later sibling. */
  .ribbon-foot-edge {
    position: absolute;
    top: 0;
    bottom: 0;
    right: 0;
  }

  .ribbon-foot-symbol {
    position: absolute;
    display: block;
    width: auto;
    transform: translateX(-50%);
    object-fit: contain;
  }

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

  /*
   * A real `<img>` rather than a `background-image`, sized and positioned to
   * its own box (not `inset: 0`) — `transform: translate()`'s percentages
   * resolve against the element's own box, which is what lets it recentre
   * without knowing its own size, and rotation's default origin is the same
   * box's centre, so it spins the picture in place rather than swinging it
   * around the whole panel.
   *
   * `aspect-ratio: 1` keeps the box square (`scale` is uniform) without a
   * second, height-relative percentage to keep in step with `width`'s — see
   * the markup's own comment. `object-fit: contain`, not `fill`, is what
   * keeps a non-square picture from being squashed into that square box: it
   * letterboxes inside it, preserving its own proportions, the same job
   * `background-size: <width> auto` did before rotation forced a switch away
   * from `background-image`.
   *
   * `max-width: none` overrides the global `img { max-width: 100% }` reset
   * (`base.css`) — the same fix `CardArt.svelte`'s own `.clip img` already
   * needed. Without it, `scale` past roughly 1.4 kept computing a wider
   * `width`, but the image itself silently stopped growing at exactly 100%
   * of `.body`, capped rather than rendered — indistinguishable, at a
   * glance, from the slider simply not doing anything past that point.
   */
  .custom-pattern {
    position: absolute;
    max-width: none;
    object-fit: contain;
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

  .outer-border.hero-border {
    mask-image: url('/assets/templates/hero_action_frame.png');
    -webkit-mask-image: url('/assets/templates/hero_action_frame.png');
  }

  /* -- hero combat ribbon ----------------------------------------------- */
  /*
   * The combat head. It spans the whole ribbon and is cut to shape by the art
   * at its natural size, anchored to the ribbon's *top* — which is fixed —
   * rather than to its bottom, which is wherever the name has pushed it. That
   * is what leaves the head still while the ribbon lengthens under it.
   */
  .hero-head {
    position: absolute;
    inset: 0;
    pointer-events: none;
    mask-image: url('/assets/templates/hero_combat_banner.png');
    -webkit-mask-image: url('/assets/templates/hero_combat_banner.png');
    mask-size: var(--head-size);
    -webkit-mask-size: var(--head-size);
    mask-position: var(--head-position);
    -webkit-mask-position: var(--head-position);
    mask-repeat: no-repeat;
    -webkit-mask-repeat: no-repeat;
  }

  /*
   * The ribbon's fill and its outline, cut the same way `.banner-face` and
   * `.banner-outline` are: a plain rectangle for the run, so it stretches
   * without distorting, plus the pennant point's own art at natural size,
   * anchored to whatever bottom the name has pushed it to.
   */
  .hero-face {
    mask-image: linear-gradient(#000, #000), url('/assets/templates/hero_ribbon_point.png');
    -webkit-mask-image: linear-gradient(#000, #000),
      url('/assets/templates/hero_ribbon_point.png');
  }

  /*
   * One bar down the run's right edge, plus the foot's own art. Nothing on the
   * left or the top, because the printed ribbon has nothing there.
   *
   * Deliberately *not* a `.banner-ink`: that class describes a fill, in two
   * mask layers sized from `--run-size`/`--head-size`, and wearing both meant
   * its `mask-size` won the cascade and then computed to `auto` because those
   * two custom properties are not set here — which painted the whole ribbon
   * box in the stroke's colour.
   */
  .hero-outline {
    position: absolute;
    top: 0;
    bottom: 0;
    pointer-events: none;
    mask-repeat: no-repeat;
    -webkit-mask-repeat: no-repeat;
    mask-composite: add;
    mask-image: linear-gradient(#000, #000),
      url('/assets/templates/hero_ribbon_point_edge.png');
    -webkit-mask-image: linear-gradient(#000, #000),
      url('/assets/templates/hero_ribbon_point_edge.png');
    mask-size: var(--edge-width) var(--edge-run), var(--point-size);
    -webkit-mask-size: var(--edge-width) var(--edge-run), var(--point-size);
    mask-position: right 0 top 0, var(--point-position);
    -webkit-mask-position: right 0 top 0, var(--point-position);
  }

  /*
   * Drawn, not masked. It used to be lifted out of `inner_border.png` at
   * natural size, which kept its drawn shape — but a mask can only ever be as
   * smooth as its own alpha, and that art's ring was thresholded flat: its
   * inner edge ran 255,255,239,16,0, a transition crammed into a single pixel.
   * That is the stepped inner circle on an exported card, and no amount of
   * resampling recovers a curve the art no longer has.
   *
   * `BOOST_RING` is exactly the annulus's bounding box (`cx/cy ± outerRadius`),
   * so the ring *is* a circle with a 16px stroke — `outerRadius - innerRadius`
   * — and a `border-radius: 50%` border draws precisely that, antialiased by
   * the browser at whatever size the card is rasterised to. Nothing about the
   * geometry moves: both radii still come from `BOOST`, which was measured off
   * that same art. It leaves `inner_border.png` unused, which is why nothing
   * in `card-masks.py` touches it.
   *
   * `box-sizing: border-box` comes from `base.css`, so the border grows inward
   * from `BOOST_RING.width` rather than adding to it.
   */
  .boost-ring {
    position: absolute;
    pointer-events: none;
    border-radius: 50%;
    border-style: solid;
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

  /* -- hero ribbon content ----------------------------------------------- */
  .hero-symbol {
    position: absolute;
    height: auto;
    /* Recoloured white regardless of the file's own ink — see the markup. */
    filter: brightness(0) invert(1);
  }

  .hero-symbol-value {
    position: absolute;
    translate: -50% 0;
    font-family: var(--card-font-numeral);
    font-weight: var(--card-font-numeral-weight);
    line-height: 1;
  }

  .hero-owner-text {
    position: relative;
    flex: none;
    writing-mode: vertical-rl;
    rotate: 180deg;
    font-family: var(--card-font-name);
    font-weight: var(--card-font-name-weight);
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /*
   * `line-height` and the horizontal squeeze both come from `TITLE` — see there
   * for why. The squeeze is anchored left because that is the edge the title is
   * positioned by; scaling about the centre would walk it off its measured `x`.
   *
   * In flow rather than pinned, so it can wrap, and bounded to two lines so a
   * long title cannot push the ability copy an unbounded distance down the
   * card.
   *
   * **An ordinary block, deliberately not a `-webkit-box`.** The bound used to
   * be `-webkit-line-clamp`, which buys an ellipsis on the clipped line and
   * costs the ability to put anything but text in here: legacy box layout
   * blockifies every child of the box, so a symbol inserted into a title took a
   * line of its own wherever it sat. Wrapping the run in a single inline child
   * was tried and did not fix it. `max-height` at exactly `TITLE_MAX_LINES`
   * line boxes bounds the same thing through the ordinary inline layout every
   * other piece of copy on this card already uses.
   *
   * What that gives up is the ellipsis, which this face can afford: `.split`,
   * `.half` and `.ability-block` all clip rather than ellipsise, so a clipped
   * title reads as the same "this does not fit" signal they do. Nothing legible
   * is lost to the clip either — at this face's metrics the second line's
   * capitals sit about 0.15em clear of the cut, because `line-height` is 0.9
   * against a cap height of 0.703.
   */
  .title {
    /*
     * A flex item with no explicit `position` still paints above an absolute
     * sibling with `z-index: auto` in an ordinary document — flexbox gives
     * `z-index: auto` items the same stacking as `position: relative` for
     * exactly this reason — but that rule did not carry over into the
     * `foreignObject` this face gets cloned into for rasterising (see
     * `card-image.ts`), where `.pattern`/`.custom-pattern` painted over this,
     * the rule and the ability copy below it instead. Pinning the stacking
     * explicitly, the same three lines on all three, is what makes the
     * screen preview and the export agree.
     */
    position: relative;
    z-index: 1;
    display: block;
    font-family: var(--card-font-name);
    font-weight: var(--card-font-name-weight);
    transform-origin: left center;
    text-transform: uppercase;
    /* `max-height` is inline, in `pu()` — two of this face's own line boxes. */
    overflow: hidden;
  }

  /*
   * A symbol inserted into the title, sized to the title's own cap height so
   * it stands exactly as tall as the capitals either side of it. No printed
   * card sets a symbol in its title, so there is no template to measure this
   * against — matching the caps is the only choice with a reason behind it.
   *
   * Height alone is enough to place it: an image sits its bottom edge on the
   * baseline by default, which is where a capital's foot is too.
   *
   * Both the height and the counter-scale are set **inline**, in `pu()`, like
   * every other measured thing on this face — not through an inherited custom
   * property and a `calc()` in `em`, which is what they were while this was
   * still being debugged and which added two more things that could be wrong
   * about a symbol's size.
   *
   * The counter-scale undoes `.title`'s own 4% horizontal squeeze. That
   * squeeze is a type correction — the stand-in face sets wider than Knockout
   * — and applying it to a round symbol would just make it an oval. A
   * transform does not affect layout, so the glyph's advance stays squeezed
   * with the type around it while its ink comes out circular.
   */
  .title-symbol {
    /*
     * `inline-block`, and it is not optional: `base.css` resets every `img`
     * to `display: block`, so a symbol in the title came out block-level and
     * broke the line either side of itself — `Card Title{{defense}}` printed
     * the words on one line and the shield alone on the next, with nothing
     * near the box's width to blame it on (105px of text plus an 18px glyph
     * in a 289px box). Every *other* symbol on this face is absolutely
     * positioned, where `block` is right and no override is wanted, which is
     * exactly why this one was easy to miss — it is the only one that is
     * inline content. `AbilityText`'s `.symbol` and `HeroCharacterCardFace`'s
     * `.ability-symbol` already carry the same override for the same reason.
     */
    display: inline-block;
    width: auto;
    object-fit: contain;
  }

  /* Now a flow sibling of `.title`, so it rides down when the title wraps. */
  .rule {
    /* See `.title`'s own comment — same reason, same fix. */
    position: relative;
    z-index: 1;
    flex: none;
  }

  /*
   * Everything from the rule down, repositioned against wherever the title's
   * flow put it rather than against the panel's own top — see
   * `belowTitleRule`. `overflow: hidden` resets this flex item's automatic
   * minimum size to zero, the same trick `.ability-block` and `.split` already
   * rely on, so it can still shrink if the panel runs out of room.
   */
  .below-title {
    /* See `.title`'s own comment — same reason, same fix. */
    position: relative;
    z-index: 1;
    flex: 0 1 auto;
    display: flex;
    flex-direction: column;
    overflow: hidden;
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
    display: flex;
    align-items: center;
    gap: 0.3em;
    font-family: var(--card-font-text);
    font-weight: var(--card-font-text-weight);
    line-height: 1;
    opacity: 0.9;
  }

  .quantity-owner {
    text-transform: uppercase;
    white-space: nowrap;
  }

  .quantity-rule {
    align-self: stretch;
    background: currentColor;
    opacity: 0.6;
  }
</style>
