<script lang="ts">
  /**
   * A hero's character card: attack type, health, move and special ability
   * the character already carries elsewhere in the document, laid out as the
   * stat-reference sheet a hero's box prints alongside its deck — plus a
   * sidekick's own stats, or a flavour quote when there is no sidekick.
   *
   * The chrome is the supplied frame art laid over the top, and that is the
   * one decision everything else follows from. Nothing in it is redrawn — but
   * it comes in five pieces rather than one, split by
   * `tools/hero-card-assets.py`:
   *
   *   border       the pink outline and the bars between the bands, as a **mask**
   *   badge        the shield behind the START HEALTH number — the hero's
   *                own, never the sidekick's — as a **mask**
   *   badgeAccent  a small triangle notched into the shield, low in its
   *                body, printed as its own decorative colour — a separate
   *                **mask**
   *   moveInk      the double-headed arrow beside the move digit *and* the
   *                word MOVE — one **mask**, coloured the same as the digit
   *   labelInk     each band's own tab label, plus the START HEALTH caption
   *                on the two bands that carry an attack row — one **mask**
   *                per band, coloured with that band's `labelInk`
   *   ink          what is left, and none of it a word: the decorative arcs
   *                that frame a badge, and the sidekick's own health badge.
   *                A picture, in the colours it prints
   *
   * Everything but the last is a colour an author would want to choose,
   * independently of the others. The labels were in `ink` too until an author
   * repainted a band and found the white tab standing on it illegible — the
   * template's own pairing is a default, not a rule, so it moved out band by
   * band rather than word by word: a band is what its labels have to be read
   * against, and matching three colours across one flat field is not a thing
   * to ask of anybody.
   *
   * Under all four go the three band fills and whatever artwork each
   * carries; into the holes goes the copy.
   *
   * Read from the character directly rather than from a `Card`: attack type,
   * health, move and ability text already exist on `Character` for other
   * reasons (the health dial's range, a figure's stat block), and this is the
   * first thing in the app that prints them.
   */
  import { primaryCardName } from '$lib/characters/factory';
  import type { AttackType, Character, HeroCharacterCard } from '$lib/characters/types';
  import { CHARACTER_BAND_NAMES } from '$lib/characters/types';
  import { fillCss } from '$lib/cards/style';
  import { hasArtwork } from '$lib/core/artwork';
  import type { CustomSymbol } from '$lib/symbols/types';
  import { parseAbilityText } from '$lib/text/tokens';
  import CardArt from './CardArt.svelte';
  import { fitScale, fitWidth } from './fit-text';
  import { ATTACK_TYPE_SIZES, ATTACK_TYPE_SYMBOLS, symbolUrl, TEMPLATE_ASSETS } from './assets';
  import {
    CHARACTER_ABILITY,
    CHARACTER_ABILITY_PANEL,
    CHARACTER_ATTACK,
    CHARACTER_BAND_RUNS,
    CHARACTER_BANDS,
    CHARACTER_CARD,
    CHARACTER_HEADING,
    CHARACTER_HEALTH,
    CHARACTER_HEALTH_SHIFTED,
    CHARACTER_MOVE,
    CHARACTER_QUOTE,
    CHARACTER_TOKENS,
    CHARACTER_TOKENS_PAIRED,
    capTopToBoxTop,
    digitMiddleToBoxTop,
    digitTopToBoxTop,
    NAME_METRICS,
    pu,
    px,
    py
  } from './geometry';

  interface Props {
    character: Character;
    /**
     * Which identity this sheet prints — the hero's own fields when absent,
     * or one of its `additionalCards` when a duo's second (or further) card
     * is being drawn. `design`/`border`/`ink` stay on `character` regardless:
     * chrome is shared across every sheet a hero prints, never per-identity.
     */
    card?: HeroCharacterCard | null;
    customSymbols?: CustomSymbol[];
  }

  let { character, card = null, customSymbols = [] }: Props = $props();

  const identity = $derived(
    card ?? {
      name: primaryCardName(character),
      subtitle: character.subtitle,
      attackType: character.attackType,
      health: character.health,
      move: character.move,
      abilities: character.abilities,
      quote: character.quote
    }
  );

  const sidekick = $derived(character.sidekick);
  /** An additional card's own sheet never shows the swarm-sidekick band — only the primary sheet does. */
  const showSidekick = $derived(card ? false : sidekick.enabled);

  /**
   * A swarm sidekick prints one of three things below its attack row, keyed
   * off its own `health` — a stat that used to go unread the moment
   * `multiple` was on. `null`/absent reads as 1, the plain stack, so an
   * older document with no opinion here renders exactly as it always did.
   */
  const sidekickHealthState = $derived.by(() => {
    if (!sidekick.multiple) return 'single';
    const health = sidekick.health ?? 1;
    return health <= 1 ? 'plain' : health === 2 ? 'paired' : 'shifted';
  });

  /**
   * Which of the four layouts to lay over the card.
   *
   * They differ only below the ability panel — a sidekick's two bands or a
   * quote panel filling the same space — and a swarm sidekick differs again
   * by health state: `multiLowHealth` has no badge of its own (a token stack stands
   * in), and `multiHealth` is the same frame with its "START HEALTH" caption,
   * arc and dividers shifted to make room for the reused, shifted badge (see
   * `healthBadgeAt`) — see `TEMPLATE_ASSETS.heroCharacterInk`'s own doc
   * comment for how that fourth `ink` was derived. Four sets of art rather
   * than one with pieces switched off, because each is a single flat picture
   * and there is nothing in it to switch.
   */
  const layout = $derived(
    !showSidekick
      ? 'quote'
      : !sidekick.multiple
        ? 'sidekick'
        : sidekickHealthState === 'shifted'
          ? 'multiHealth'
          : 'multiLowHealth'
  );
  const border = $derived(TEMPLATE_ASSETS.heroCharacterBorder[layout]);
  const badge = $derived(TEMPLATE_ASSETS.heroCharacterBadge[layout]);
  const badgeAccent = $derived(TEMPLATE_ASSETS.heroCharacterBadgeAccent[layout]);
  const ink = $derived(TEMPLATE_ASSETS.heroCharacterInk[layout]);
  /**
   * Each band's label mask. The hero's and the ability panel's do not vary by
   * layout; the sidekick's does, and is `null` on the quote layout, which
   * prints no sidekick band to label.
   */
  const labelInk = $derived({
    hero: TEMPLATE_ASSETS.heroCharacterLabelInk.hero,
    ability: TEMPLATE_ASSETS.heroCharacterLabelInk.ability,
    sidekick: TEMPLATE_ASSETS.heroCharacterLabelInk.sidekick[layout]
  });
  /** Same mask at every layout — the move row does not vary between them. */
  const moveInk = TEMPLATE_ASSETS.heroCharacterMoveInk;

  /**
   * At 3+ health, the sidekick's attack-type lockup shares its row with the
   * new divider ahead of the shifted "START HEALTH" — ranged, lunge and
   * reach are wide enough at their natural size to run into it (melee and
   * large already clear it, so they're untouched). Scaled down only enough
   * to clear `CHARACTER_HEALTH_SHIFTED.dividerLeftX` with a small margin,
   * from the left edge it's already drawn from, so it never shrinks further
   * than it has to.
   */
  const sidekickAttackScale = $derived.by(() => {
    if (sidekickHealthState !== 'shifted') return 1;
    const size = ATTACK_TYPE_SIZES[sidekick.attackType];
    const left = CHARACTER_ATTACK.x - size.inset;
    const safeRight = CHARACTER_HEALTH_SHIFTED.dividerLeftX - 8;
    return left + size.width > safeRight ? (safeRight - left) / size.width : 1;
  });

  /**
   * `design` is per-identity, not per-character: two names sharing one deck
   * do not have to share one look, so an additional card's own `characterCard`
   * wins over the primary's the moment `card` is set.
   */
  const design = $derived(card?.characterCard ?? character.characterCard);
  const replaced = $derived(design.useReplacement && hasArtwork(design.replacement));

  const bleed = CHARACTER_CARD.fillBleed;

  /**
   * The two band headings. The printed template sets the words HERO and
   * SIDEKICK, which is what an unnamed figure still gets — but a named one
   * prints its own name, and the *full* one: this is the sheet the figure is
   * introduced on, where the action cards' ribbon takes the short form.
   */
  const heroName = $derived(identity.name.trim() || 'Hero');
  const sidekickName = $derived(sidekick.name.trim() || 'Sidekick');

  /**
   * How far the heading's box-top has to move *down*, per point of shrink,
   * to hold its baseline fixed instead of its cap-top — see the `heading`
   * snippet below for why.
   *
   * `capTopToBoxTop(capTop, size)` returns `capTop - (baselineRatio -
   * cap) * size`, which puts the baseline itself at `capTop + cap * size`
   * (cap-top plus one cap-height, the definition of a baseline). Holding
   * that fixed while `size` scales by `--fit-scale` needs the box's *top*
   * to move by `baselineRatio * size` for every point of shrink — not
   * `capTopToBoxTop`'s own `(baselineRatio - cap)`, which is a different
   * quantity and was tried here first, silently wrong by exactly `cap *
   * size` (still visibly top-heavy, just less so). `baselineRatio` —
   * half-leading plus ascent, at this heading's fixed `lineHeight: 1` — is
   * inlined rather than read back out of `capTopToBoxTop`, since getting it
   * from there is exactly the subtraction that produced the wrong constant.
   */
  const HEADING_BASELINE_RATIO =
    (1 - (NAME_METRICS.ascent + NAME_METRICS.descent)) / 2 + NAME_METRICS.ascent;
  const HEADING_SHRINK_DELTA = HEADING_BASELINE_RATIO * CHARACTER_HEADING.size;

  /** Where the ability block's three pieces sit, solved from the measured ink. */
  const NAME_TOP = capTopToBoxTop(
    CHARACTER_ABILITY.nameCapTop,
    CHARACTER_ABILITY.nameSize,
    1,
    NAME_METRICS
  );
  const RULE_GAP = CHARACTER_ABILITY.ruleY - (NAME_TOP + CHARACTER_ABILITY.nameSize);
  const TEXT_TOP = capTopToBoxTop(
    CHARACTER_ABILITY.textCapTop,
    CHARACTER_ABILITY.textSize,
    CHARACTER_ABILITY.textLineHeight
  );
  const TEXT_GAP = TEXT_TOP - (CHARACTER_ABILITY.ruleY + CHARACTER_ABILITY.ruleHeight);

  /**
   * The smallest a quote may shrink to, as a fraction of its *unscaled*
   * calibrated size — see the effect that uses it below for why dividing by
   * `design.quoteScale` there, not this constant on its own, is what keeps
   * that true at every setting of the "Quote text size" slider.
   */
  const QUOTE_MIN_SCALE = 0.5;

  /**
   * The vertical band the quote text may occupy, so it can be centred there
   * and grow symmetrically as it wraps rather than only pushing down from a
   * fixed top.
   *
   * Centred on where a single line sits today (`textCapTop`, read as the
   * block's centre rather than its top) and bounded, symmetrically around
   * that centre, by whichever gap is tighter: up to the quote marks, or down
   * to the attribution line when there is one, or the band's own foot when
   * there is not. Provisional margins — there is no printed multi-line
   * sample on this panel to measure the ideal proportions off, so these were
   * checked against the rendered card rather than the template.
   */
  const QUOTE_ONE_LINE_TOP = capTopToBoxTop(
    CHARACTER_QUOTE.textCapTop,
    CHARACTER_QUOTE.textSize,
    CHARACTER_QUOTE.textLineHeight
  );
  /**
   * The band's centre stays where the template's own single line sits, whatever
   * `quoteScale` does — the anchor is a measured position, not a consequence of
   * the type size. Larger copy grows either side of it instead of pushing down
   * from a fixed top.
   */
  const QUOTE_CENTER =
    QUOTE_ONE_LINE_TOP + (CHARACTER_QUOTE.textSize * CHARACTER_QUOTE.textLineHeight) / 2;

  /** Both scaled by the author's own multiplier — see `CharacterCardDesign.quoteScale`. */
  const quoteTextSize = $derived(CHARACTER_QUOTE.textSize * design.quoteScale);
  const quoteAttributionSize = $derived(CHARACTER_QUOTE.attributionSize * design.quoteScale);

  /*
   * Derived rather than fixed, because the attribution is scalable now: its
   * cap line is measured and stays put, so a larger size reaches *up* from it
   * and takes room off the quote's own band. Leaving this constant would let
   * an enlarged attribution and an enlarged quote overlap.
   */
  const QUOTE_ATTRIBUTION_TOP = $derived(
    capTopToBoxTop(CHARACTER_QUOTE.attributionCapTop, quoteAttributionSize)
  );
  const hasAttribution = $derived(identity.quote.attribution.trim().length > 0);

  /**
   * The true room on each side of `QUOTE_CENTER`, not forced to match one
   * another — up to the quote marks above, down to the attribution line (or
   * the band's own foot) below. Always used in full, not only once a quote
   * is long enough to need it: an earlier version kept the box symmetric
   * (bounded by whichever side is tighter) by default and only widened it
   * once `fitScale` hit its floor and the text still overflowed — which
   * meant a merely-longish quote shrank text it didn't have to, because the
   * box it was shrinking to fit was smaller than the band actually is. Using
   * the full room unconditionally means shrinking only ever has to make up
   * the gap between the band's real size and the text's, not between the
   * text and an artificially tight symmetric box.
   *
   * The trade a short quote makes for this: its visual centre sits a few
   * pixels off `QUOTE_CENTER` — the calibrated single-line position — rather
   * than exactly on it, by half the difference between these two margins
   * (about 13px on Red's own card). Worth it: that shift is not something
   * anyone is likely to notice, where a shrunk-more-than-necessary or
   * visibly clipped quote both are.
   */
  const QUOTE_ABOVE_HALF = QUOTE_CENTER - (CHARACTER_QUOTE.markY + 24);
  const QUOTE_BELOW_HALF = $derived(
    (hasAttribution ? QUOTE_ATTRIBUTION_TOP - 24 : CHARACTER_BANDS.bottom - 60) - QUOTE_CENTER
  );

  const quoteZoneTop = $derived(QUOTE_CENTER - QUOTE_ABOVE_HALF);
  const quoteZoneHeight = $derived(QUOTE_ABOVE_HALF + QUOTE_BELOW_HALF);

  let abilityBox: HTMLDivElement | null = $state(null);
  let quoteBox: HTMLDivElement | null = $state(null);

  /** Re-fit whenever the printed ability text (name or copy) changes. */
  $effect(() => {
    const signature = identity.abilities.map((a) => `${a.name}|${a.text}`).join('\n');
    void signature;
    if (abilityBox) fitScale(abilityBox);
  });

  /**
   * Re-fit whenever the printed quote, the size it is set at, or the zone it
   * has to fit in changes. `quoteTextSize` is read here as well as in the
   * markup: without it, dragging the slider up past what the band can hold
   * would leave the previous, larger `--fit-scale` in place and the copy
   * would overflow rather than be shrunk back.
   *
   * A lower floor than `fitScale`'s own default: an author's own real quote
   * ("the box now tries the calibrated symmetric size first…", 241
   * characters) still overflowed at 0.7 even in the full-width band — the
   * default floor, right for gameplay text that must stay legible, is not
   * automatically right for decorative flavour text a few words longer than
   * most. `QUOTE_MIN_SCALE` (0.5) was enough for that quote with room to
   * spare; genuinely book-length flavour text can still outrun it, and
   * `overflow: hidden` is still what happens then.
   *
   * The floor passed to `fitScale` is `QUOTE_MIN_SCALE` divided by
   * `design.quoteScale`, not `QUOTE_MIN_SCALE` itself — `--fit-scale`
   * multiplies `quoteTextSize`, which is *already* `quoteScale` times the
   * calibrated base size, so a bare `0.5` floor only ever bottoms out at
   * `quoteScale × 0.5` of that base. At the slider's own 160% ceiling that
   * floor is 80% of the calibrated size — nowhere near small enough for a
   * long quote to shrink into the same band a 100%-scale one fits in, so an
   * author who both lengthened a quote and turned it up hit the *effective*
   * floor without ever reaching the number `0.5` promised. Dividing keeps
   * the floor an absolute size relative to the base, whatever the slider is
   * doing on top of it.
   */
  $effect(() => {
    void identity.quote.text;
    void quoteTextSize;
    void quoteZoneHeight;
    if (quoteBox) fitScale(quoteBox, { min: QUOTE_MIN_SCALE / design.quoteScale });
  });
</script>

{#if replaced}
  <div class="full">
    <CardArt artwork={design.replacement} background={fillCss(design.border)} />
  </div>
{:else}
<!--
  Each band's fill, then its artwork over it. Three rectangles, not five: the
  frame's own separators cover every join, and its border covers all four
  corners, so nothing here needs a radius and nothing needs to stop short. Each
  runs `fillBleed` past its own edges rather than up to them; see there.

  Clipped per band rather than laid across the card, because a picture crossing
  a separator would be cut in half by a bar drawn over it.
-->
{#each CHARACTER_BAND_NAMES as band (band)}
  {@const run = CHARACTER_BAND_RUNS[band]}
  <div
    class="fill"
    style:left={px(CHARACTER_CARD.x - bleed)}
    style:top={py(run.top - bleed)}
    style:width={px(CHARACTER_CARD.width + bleed * 2)}
    style:height={py(run.bottom - run.top + bleed * 2)}
    style:background={fillCss(design[band].fill)}
  ></div>

  {#if hasArtwork(design[band].artwork)}
    <!--
      Same `bleed` as the fill behind it, for the same reason: the border
      drawn over both covers every join and corner, so nothing here needs to
      stop short at the band's nominal edge. Without it, the artwork sat
      exactly at that nominal boundary while the fill ran past it, leaving a
      hairline of fill colour showing along whichever edge the border's own
      window didn't land on precisely.
    -->
    <div
      class="band-art"
      style:left={px(CHARACTER_CARD.x - bleed)}
      style:top={py(run.top - bleed)}
      style:width={px(CHARACTER_CARD.width + bleed * 2)}
      style:height={py(run.bottom - run.top + bleed * 2)}
    >
      <CardArt artwork={design[band].artwork} background="transparent" />
    </div>
  {/if}
{/each}

<!-- HERO ----------------------------------------------------------------- -->
{@render heading(CHARACTER_BANDS.hero, heroName)}

<!-- SPECIAL ABILITY -------------------------------------------------------- -->
<div
  bind:this={abilityBox}
  class="ability"
  style:left={px(CHARACTER_ABILITY.nameX)}
  style:top={py(NAME_TOP)}
  style:width={px(CHARACTER_ABILITY_PANEL.contentRight - CHARACTER_ABILITY.nameX)}
  style:height={py(
    CHARACTER_BANDS.ability.top + CHARACTER_BANDS.ability.height - NAME_TOP
  )}
  style:gap="calc({pu(CHARACTER_ABILITY.gap)} * var(--fit-scale, 1))"
  style:color={fillCss(design.abilityInk)}
>
  {#each identity.abilities.length ? identity.abilities : [null] as ability, index (index)}
    <div class="ability-entry">
      <!--
        A real ability with no name prints blank rather than falling back to
        this placeholder — the name is optional, and a fallback would print
        as though it were the author's own words. "Ability Name" is only
        the *no abilities at all* hint, `ability === null`, same as the
        placeholder text below it.
      -->
      <div
        class="ability-name"
        style:font-size="calc({pu(CHARACTER_ABILITY.nameSize)} * var(--fit-scale, 1))"
        style:line-height="1"
      >
        {ability ? ability.name.trim() : 'Ability Name'}
      </div>

      <!--
        The rule's own margins/size scale with `--fit-scale` too — not just
        the text either side of it. Leaving them fixed while the type shrank
        left a full-size rule and a fixed gap dominating a block that was
        supposed to be getting smaller, which barely moved `scrollHeight` no
        matter how far the font shrank.

        Skipped entirely for a real, blank-named ability — a rule under a
        name that prints nothing reads as underlining empty space, and its
        own margin-top would leave a stray gap where the name isn't. Kept
        for the *no abilities at all* placeholder, same as the name above it.
      -->
      {#if ability === null || ability.name.trim()}
        <div
          class="ability-rule"
          style:margin-top="calc({pu(RULE_GAP)} * var(--fit-scale, 1))"
          style:margin-left="calc({pu(CHARACTER_ABILITY.ruleX - CHARACTER_ABILITY.nameX)} * var(--fit-scale, 1))"
          style:width="calc({pu(CHARACTER_ABILITY.ruleWidth)} * var(--fit-scale, 1))"
          style:height="calc({pu(CHARACTER_ABILITY.ruleHeight)} * var(--fit-scale, 1))"
        ></div>
      {/if}

      <p
        class="ability-text"
        class:placeholder={ability === null}
        style:margin-top="calc({pu(TEXT_GAP)} * var(--fit-scale, 1))"
        style:margin-left="calc({pu(CHARACTER_ABILITY.textX - CHARACTER_ABILITY.nameX)} * var(--fit-scale, 1))"
        style:font-size="calc({pu(CHARACTER_ABILITY.textSize)} * var(--fit-scale, 1))"
        style:line-height={CHARACTER_ABILITY.textLineHeight}
      >
        {#if ability?.text.trim()}
          <!--
            The same token parsing as an action card's ability text, minus
            `{{name}}` — there is no owning card here for it to stand in for,
            so a stray one falls through as literal text like any other
            unrecognised token.
          -->
          <!-- No line break inside the loop: `.ability-text` sets
               `white-space: pre-wrap` so authored newlines print, which means
               this file's own indentation prints too. See `AbilityText`. -->
          {#each parseAbilityText(ability.text) as segment, index (index)}{#if segment.kind === 'symbol'}<img
                class="ability-symbol"
                src={symbolUrl(segment.name)}
                alt={segment.name}
              />{:else if segment.kind === 'customSymbol'}{@const custom = customSymbols.find(
                (s) => s.id === segment.id
              )}{#if custom?.source}<img
                  class="ability-symbol"
                  src={custom.source}
                  alt={custom.name}
                />{/if}{:else if segment.kind === 'text'}{segment.value}{/if}{/each}
        {:else}
          Ability text goes here.
        {/if}
      </p>
    </div>
  {/each}
</div>

<!-- SIDEKICK, or the quote that stands in for it --------------------------- -->
{#if showSidekick}
  {@render heading(CHARACTER_BANDS.sidekick, sidekickName)}
{:else}
  <!--
    Both marks, opening and closing, in one supplied picture spanning the
    full row — the printed template's marks were never in any face this
    project stands in for, so this used to be set as type in a browser
    default serif instead. A mask like every other piece of coloured chrome
    here, not a picture, so it still takes `design.quoteInk` the way the
    text and the attribution beside it do.
  -->
  <div
    class="mask quote-marks"
    style:--quote-marks-art="url('{TEMPLATE_ASSETS.characterCardQuotations}')"
    style:background={fillCss(design.quoteInk)}
    style:left={px(CHARACTER_QUOTE.markLeftX)}
    style:top={py(CHARACTER_QUOTE.markY)}
    style:width={px(CHARACTER_QUOTE.markRightX - CHARACTER_QUOTE.markLeftX)}
    style:height={py(CHARACTER_QUOTE.markHeight)}
  ></div>

  <div
    bind:this={quoteBox}
    class="quote-zone"
    style:left={px(CHARACTER_QUOTE.textX)}
    style:top={py(quoteZoneTop)}
    style:width={px(CHARACTER_QUOTE.textWidth)}
    style:height={py(quoteZoneHeight)}
  >
    <!--
      `quoteScale` multiplies the measured size; `--fit-scale` still divides it
      back down if the result outgrows the band. The two are separate on
      purpose — one is the author's choice, the other is the panel's own
      ceiling, and folding them together would let a long quote's shrink
      silently reset the slider.
    -->
    <p
      class="quote-text"
      style:font-size="calc({pu(quoteTextSize)} * var(--fit-scale, 1))"
      style:line-height={CHARACTER_QUOTE.textLineHeight}
      style:color={fillCss(design.quoteInk)}
    >
      {identity.quote.text.trim() || 'A memorable line goes here.'}
    </p>
  </div>

  {#if hasAttribution}
    <p
      class="quote-attribution"
      style:right={px(1632 - CHARACTER_QUOTE.attributionRight)}
      style:top={py(capTopToBoxTop(CHARACTER_QUOTE.attributionCapTop, quoteAttributionSize))}
      style:font-size={pu(quoteAttributionSize)}
      style:color={fillCss(design.quoteInk)}
    >
      — {identity.quote.attribution}
    </p>
  {/if}
{/if}

<!--
   The frame art, over the copy and under the figures.

  Over the copy because it is opaque everywhere the card is not content: it
  covers the fills' square corners, every band join and the bleed, and it is
  what an over-long heading or ability runs out of sight behind rather than
  across the tab strip.

  Under the figures and the attack lockups, because all of them sit *on* it or
  overrun its holes. The health badge is the art's own shape and its number
  goes inside it; the move figure fills the hole left for it so exactly that a
  wider digit would be trimmed by its edges; and the attack row's hole is cut
  to whichever lockup the template happened to show, so a longer one loses its
   tail to that edge.
-->
<!--
  A sidekick's reusable badge has to enter the stack here rather than beside
  its value below: a frame divider must be able to cover the badge's edge,
  just as it does the hero's built-in badge. The number still comes later,
  above the frame, where it remains legible.
-->
{#if showSidekick}
  {#if sidekickHealthState === 'paired'}
    {#each [-1, 1] as sign, index (index)}
      {@const cx = CHARACTER_TOKENS_PAIRED.centerX + (sign * CHARACTER_TOKENS_PAIRED.pitch) / 2}
      {@render healthBadgeShapeAt(
        cx,
        CHARACTER_TOKENS.centerY + CHARACTER_TOKENS_PAIRED.badgeOffsetY,
        CHARACTER_TOKENS_PAIRED.badgeScale
      )}
    {/each}
  {:else if sidekickHealthState === 'shifted'}
    {@render healthBadgeShapeAt(
      CHARACTER_HEALTH_SHIFTED.centerX,
      CHARACTER_HEALTH.sidekickCenterY,
      1
    )}
  {:else if sidekickHealthState === 'single'}
    {@render healthBadgeShapeAt(
      CHARACTER_HEALTH.sidekickCenterX,
      CHARACTER_HEALTH.sidekickCenterY,
      1
    )}
  {/if}
{/if}
<!--
   The three `--card-*` values are for printer-friendly mode alone, and are set
  here because this is where the geometry is: `CardRenderer`'s own stylesheet
  owns that mode (see there) but knows nothing about this card's measurements.
  What it does with them is clip this mask back to a keyline, because the
  border is a 144px band of colour around the whole card — pale pink on the
  printed sheet, and a 2.9mm solid black picture frame if it is simply inked.
-->
<div class="mask full badge" style:--badge-art="url('{badge}')" style:background={fillCss(design.healthBadge)}></div>
<div
  class="mask full badge-accent"
  style:--badge-accent-art="url('{badgeAccent}')"
  style:background={fillCss(design.healthBadgeAccent)}
></div>
<div
  class="mask full border"
  style:--border-art="url('{border}')"
  style:--card-inset-x={px(CHARACTER_CARD.x)}
  style:--card-inset-y={py(CHARACTER_CARD.y)}
  style:--card-radius={pu(CHARACTER_CARD.radius)}
  style:background={fillCss(design.border)}
></div>
<div
  class="mask full move-ink"
  style:--move-ink-art="url('{moveInk}')"
  style:background={fillCss(design.moveInk)}
></div>
<!--
  Each band's own labels, over that band's fill and artwork and under the copy
  — the same place in the stack the picture below them holds, because that is
  where they were cut from. One element per band rather than one shared mask,
  so each takes its own band's colour.

  `--label-ink-art` is one property name across all three: a custom property
  set on one element is not visible on a sibling (see `.mask.border`'s note),
  so each instance resolves its own value and they cannot collide.
-->
{#each CHARACTER_BAND_NAMES as band (band)}{#if labelInk[band]}<div
    class="mask full label-ink"
    style:--label-ink-art="url('{labelInk[band]}')"
    style:background={fillCss(design[band].labelInk)}
  ></div>{/if}{/each}
<img class="template" src={ink} alt="" />

{@render attackRow(CHARACTER_BANDS.heroAttack, identity.attackType)}
{@render healthValue(CHARACTER_HEALTH.heroCenterY, identity.health ?? 0)}

<!--
  `move-figure`, not `move`: the initiative card's MOVE *badge* is a `.move`
  too, and `CardRenderer`'s printer-friendly rules reach both through
  `:global()` — a component's styles are scoped to the component, but a
  `:global` selector written in another one is not. Sharing the name painted
  `background: #000` (right for a badge that is a mask) across this card's
  move numeral, which is a `<span>` of text, as a black slab.
-->
<span
  class="move-figure"
  style:left={px(CHARACTER_MOVE.centerX)}
  style:top={py(digitTopToBoxTop(CHARACTER_MOVE.digitTop, CHARACTER_MOVE.size))}
  style:font-size={pu(CHARACTER_MOVE.size)}
  style:scale="{CHARACTER_MOVE.condense} 1"
  style:color={fillCss(design.moveInk)}
>
  {identity.move}
</span>

{#if showSidekick}
  {@render attackRow(CHARACTER_BANDS.sidekickAttack, sidekick.attackType, sidekickAttackScale)}

  {#if sidekickHealthState === 'plain'}
    <!--
      A swarm has no health of its own, so the multi frame has no badge there
      and a stack of tokens stands in its place. This is the one piece of
      chrome on the card the art could not carry, because how many discs it
      draws is the only thing here that depends on a number.
    -->
    {@const discs = Math.min(sidekick.count, CHARACTER_TOKENS.max)}
    {#each Array.from({ length: discs }) as _, index (index)}
      {@const cx =
        CHARACTER_TOKENS.centerX + (index - (discs - 1) / 2) * CHARACTER_TOKENS.pitch}
      <span
        class="token"
        style:left={px(cx - CHARACTER_TOKENS.diameter / 2)}
        style:top={py(CHARACTER_TOKENS.centerY - CHARACTER_TOKENS.diameter / 2)}
        style:width={px(CHARACTER_TOKENS.diameter)}
        style:height={py(CHARACTER_TOKENS.diameter)}
        style:border-width={pu(CHARACTER_TOKENS.ring)}
      ></span>
    {/each}

    <span
      class="token-count"
      style:left={px(
        CHARACTER_TOKENS.centerX + ((discs - 1) / 2) * CHARACTER_TOKENS.pitch
      )}
      style:top={py(digitMiddleToBoxTop(CHARACTER_TOKENS.centerY, CHARACTER_TOKENS.size))}
      style:font-size={pu(CHARACTER_TOKENS.size)}
    >
      ×{sidekick.count}
    </span>
  {:else if sidekickHealthState === 'paired'}
    <!--
      Exactly two health, exactly two discs — always, whatever `count`
      actually is. `×N` still carries the real count.
    -->
    {#each [-1, 1] as sign, index (index)}
      {@const cx = CHARACTER_TOKENS_PAIRED.centerX + (sign * CHARACTER_TOKENS_PAIRED.pitch) / 2}
      <span
        class="token"
        style:left={px(cx - CHARACTER_TOKENS.diameter / 2)}
        style:top={py(CHARACTER_TOKENS.centerY - CHARACTER_TOKENS.diameter / 2)}
        style:width={px(CHARACTER_TOKENS.diameter)}
        style:height={py(CHARACTER_TOKENS.diameter)}
        style:border-width={pu(CHARACTER_TOKENS.ring)}
      ></span>
    {/each}

    {#each [-1, 1] as sign, index (index)}
      {@const cx = CHARACTER_TOKENS_PAIRED.centerX + (sign * CHARACTER_TOKENS_PAIRED.pitch) / 2}
      {@render sidekickHealthValueAt(
        cx,
        CHARACTER_TOKENS.centerY + CHARACTER_TOKENS_PAIRED.badgeOffsetY,
        CHARACTER_TOKENS_PAIRED.badgeScale,
        sidekick.health ?? 2
      )}
    {/each}

    <span
      class="token-count"
      style:left={px(CHARACTER_TOKENS_PAIRED.countX)}
      style:top={py(digitMiddleToBoxTop(CHARACTER_TOKENS.centerY, CHARACTER_TOKENS.size))}
      style:font-size={pu(CHARACTER_TOKENS.size)}
    >
      ×{sidekick.count}
    </span>
  {:else if sidekickHealthState === 'shifted'}
    <!--
      3+ health: the stack goes entirely, replaced by the single-tracked
      sidekick's own badge — a reused, unscaled copy of the hero's own,
      shifted left — plus the real count. The `multiHealth` layout's own
      `ink` (not drawn here) already carries the caption, arc and both
      dividers this state needs, shifted to match.
    -->
    {@render sidekickHealthValueAt(
      CHARACTER_HEALTH_SHIFTED.centerX,
      CHARACTER_HEALTH.sidekickCenterY,
      1,
      sidekick.health ?? 0
    )}

    <span
      class="token-count"
      style:left={px(CHARACTER_HEALTH_SHIFTED.countX)}
      style:top={py(digitMiddleToBoxTop(CHARACTER_HEALTH.sidekickCenterY, CHARACTER_TOKENS.size))}
      style:font-size={pu(CHARACTER_TOKENS.size)}
    >
      ×{sidekick.count}
    </span>
  {:else}
    <!--
      A single tracked sidekick's own badge was never a mask on this layout
      — `hero_character_badge_sidekick.png` carries only the hero's own,
      and the sidekick's was fixed ink instead (now erased from
      `hero_character_ink_sidekick.png`). A reused, unscaled copy of the
      hero's own badge, same as the shifted state uses, so it takes
      `design.healthBadge` like every other badge on this card.
    -->
    {@render sidekickHealthValueAt(
      CHARACTER_HEALTH.sidekickCenterX,
      CHARACTER_HEALTH.sidekickCenterY,
      1,
      sidekick.health ?? 0
    )}
  {/if}
{/if}
{/if}

{#snippet heading(band: { top: number; height: number }, word: string)}
  <!--
    `fitWidth` (see `fit-text.ts`) shrinks `--fit-scale` until the word's own
    `scrollWidth` clears its fixed box — this snippet used to print only the
    stock words HERO/SIDEKICK, which never came close to `CHARACTER_HEADING`'s
    box, but it prints the character's actual name now, and an author's name
    is not bounded the way a template word is. `overflow: hidden` is only the
    backstop past the shrink's own floor, same as `.ability`/`.quote-zone`.
  -->
  <!--
    `top` is `calc()`, not a plain px, so it can move as `--fit-scale`
    shrinks: shrinking the font while holding `top` at its full-size value
    (as this used to) holds the *cap-top* fixed and lets the baseline rise
    with it, which reads as the word sinking into the top of its own row the
    smaller it gets. Adding `HEADING_SHRINK_DELTA * (1 - fit-scale)` holds
    the *baseline* fixed instead — at `--fit-scale: 1` the extra term is
    zero, so a name that already fits is unaffected.
  -->
  <span
    class="heading"
    use:fitWidth={word}
    style:left={px(CHARACTER_HEADING.x)}
    style:top="calc({py(
      capTopToBoxTop(
        band.top + CHARACTER_HEADING.capTop,
        CHARACTER_HEADING.size,
        1,
        NAME_METRICS
      )
    )} + {pu(HEADING_SHRINK_DELTA)} * (1 - var(--fit-scale, 1)))"
    style:width={px(CHARACTER_HEADING.right - CHARACTER_HEADING.x)}
    style:font-size="calc({pu(CHARACTER_HEADING.size)} * var(--fit-scale, 1))"
  >
    {word}
  </span>
{/snippet}

<!--
  The attack type: one supplied picture, word and icon together, centred down
  the row and started on the row's own left margin. Nothing here is set as
  type — see `ATTACK_TYPE_SYMBOLS` — and `inset` is what keeps the two files
  that carry padding on that same margin as the three that do not.

  Drawn *over* the frame like the figures rather than under it. The art's hole
  for this row is cut to the lockup the template happened to show, and a wider
  one — LUNGE and REACH are both wider than MELEE — loses its tail to the
  edge of that hole.
-->
{#snippet attackRow(band: { top: number; height: number }, kind: AttackType, scale: number = 1)}
  {@const size = ATTACK_TYPE_SIZES[kind]}
  <div
    class="attack"
    style:left={px(CHARACTER_ATTACK.x - size.inset)}
    style:top={py(band.top)}
    style:height={py(band.height)}
  >
    <img src={ATTACK_TYPE_SYMBOLS[kind]} alt={kind} style:width={pu(size.width * scale)} />
  </div>
{/snippet}

{#snippet healthValue(centerY: number, value: number)}
  <span
    class="health"
    style:left={px(CHARACTER_HEALTH.centerX)}
    style:top={py(digitMiddleToBoxTop(centerY, CHARACTER_HEALTH.size))}
    style:font-size={pu(CHARACTER_HEALTH.size)}
    style:color={fillCss(design.healthInk)}
  >
    {value}
  </span>
{/snippet}

<!--
  A second (or third) copy of the hero's own badge, moved wherever a swarm
  sidekick's health states need one — full size and shifted left at 3+
  health, shrunk onto a token at exactly 2. Not new art: `badge`/`badgeAccent`
  are already resolved for the active `layout`, and `transform-origin` at the
  mask's own native centre (`CHARACTER_HEALTH.centerX`/`.heroCenterY`) is
  what lets a plain `translate` + `scale` move a copy of it anywhere without
  the shape itself distorting off-centre.
-->
{#snippet healthBadgeShapeAt(centerX: number, centerY: number, scale: number)}
  {@const origin = `${px(CHARACTER_HEALTH.centerX)} ${py(CHARACTER_HEALTH.heroCenterY)}`}
  {@const move = `translate(${pu(centerX - CHARACTER_HEALTH.centerX)}, ${pu(
    centerY - CHARACTER_HEALTH.heroCenterY
  )}) scale(${scale})`}
  <div
    class="mask full badge"
    style:--badge-art="url('{badge}')"
    style:background={fillCss(design.healthBadge)}
    style:transform-origin={origin}
    style:transform={move}
  ></div>
  <div
    class="mask full badge-accent"
    style:--badge-accent-art="url('{badgeAccent}')"
    style:background={fillCss(design.healthBadgeAccent)}
    style:transform-origin={origin}
    style:transform={move}
  ></div>
{/snippet}

{#snippet sidekickHealthValueAt(centerX: number, centerY: number, scale: number, value: number)}
  <span
    class="health"
    style:left={px(centerX)}
    style:top={py(digitMiddleToBoxTop(centerY, CHARACTER_HEALTH.size * scale))}
    style:font-size={pu(CHARACTER_HEALTH.size * scale)}
    style:color={fillCss(design.healthInk)}
  >
    {value}
  </span>
{/snippet}

<style>
  .full {
    position: absolute;
    inset: 0;
  }

  .fill,
  .band-art,
  .template {
    position: absolute;
    pointer-events: none;
  }

  .band-art {
    overflow: hidden;
  }

  .template {
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .mask {
    position: absolute;
    pointer-events: none;
    mask-size: 100% 100%;
    -webkit-mask-size: 100% 100%;
    mask-repeat: no-repeat;
    -webkit-mask-repeat: no-repeat;
  }

  /*
   * Sized to the whole card — border, badge, badge-accent, move-ink and each
   * band's label-ink are all cut from a full-card picture. `quote-marks` is not: it is its own
   * supplied file, sized and positioned to just the row it fills, so it
   * carries its own `left`/`top`/`width`/`height` inline instead.
   */
  .mask.full {
    inset: 0;
    width: 100%;
    height: 100%;
  }

  /* Each mask carries its own art — a shared `mask-image` rule cannot, since
     a custom property set on one instance is not visible on a sibling. */
  .mask.border {
    mask-image: var(--border-art);
    -webkit-mask-image: var(--border-art);
  }

  .mask.badge {
    mask-image: var(--badge-art);
    -webkit-mask-image: var(--badge-art);
  }

  .mask.badge-accent {
    mask-image: var(--badge-accent-art);
    -webkit-mask-image: var(--badge-accent-art);
  }

  .mask.move-ink {
    mask-image: var(--move-ink-art);
    -webkit-mask-image: var(--move-ink-art);
  }

  .mask.label-ink {
    mask-image: var(--label-ink-art);
    -webkit-mask-image: var(--label-ink-art);
  }

  .mask.quote-marks {
    mask-image: var(--quote-marks-art);
    -webkit-mask-image: var(--quote-marks-art);
  }

  /* -- band headings and the attack rows ---------------------------------- */
  .heading {
    position: absolute;
    overflow: hidden;
    font-family: var(--card-font-name);
    font-weight: var(--card-font-name-weight);
    line-height: 1;
    text-transform: uppercase;
    white-space: nowrap;
    color: #ffffff;
  }

  /*
   * As tall as the row, so the lockup centres on it without its own height
   * being stored: only the printed *width* is, and the picture keeps its
   * proportions from there.
   */
  .attack {
    position: absolute;
    display: flex;
    align-items: center;
  }

  .attack img {
    flex: none;
    height: auto;
  }

  /* -- special ability ----------------------------------------------------- */
  /*
   * Bottom of the panel is the bound. `fitScale` (see `fit-text.ts`) shrinks
   * the whole block first, down to its floor; `overflow: hidden` is only the
   * backstop past that floor, same as it always was — visible clipping is
   * still the honest signal that even the shrunk text does not fit.
   */
  /* Colour comes from `design.abilityInk`, inline — the rule below takes it too, via `currentColor`. */
  .ability {
    position: absolute;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .ability-entry {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }

  /*
   * In flow, clamped to two lines rather than the single `nowrap` line this
   * used to be pinned to — same treatment as the action card's own `.title`,
   * for the same reason: a name long enough to want a third line reads the
   * two-line ellipsis as the honest "this does not fit" signal, and `fitScale`
   * (see `abilityBox`, above) already shrinks the whole block first if a
   * wrapped name makes it taller than the panel has room for.
   */
  .ability-name {
    display: -webkit-box;
    font-family: var(--card-font-name);
    font-weight: var(--card-font-name-weight);
    text-transform: uppercase;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .ability-rule {
    background: currentColor;
  }

  .ability-text {
    margin: 0;
    font-family: var(--card-font-text);
    font-weight: var(--card-font-text-weight);
    /* Preserve author line breaks, same as the action card's AbilityText —
       without this, a literal newline in the text collapses to a single
       space like any other run of whitespace in HTML, which is what made
       Enter look broken: the underlying text was always correct, only the
       render of it wasn't. */
    white-space: pre-wrap;
  }

  .ability-symbol {
    display: inline-block;
    height: 0.82em;
    width: auto;
    vertical-align: -0.08em;
    margin-inline: 0.06em;
  }

  .placeholder {
    opacity: 0.55;
  }

  /* -- figures ------------------------------------------------------------- */
  .health,
  .move-figure,
  .token-count {
    position: absolute;
    translate: -50% 0;
    font-family: var(--card-font-numeral);
    font-weight: var(--card-font-numeral-weight);
    line-height: 1;
    white-space: nowrap;
  }

  /* `.health`'s own colour comes from `design.healthInk`, inline — `token-count` is a different value (a swarm's own count) and stays fixed. */
  .token-count {
    color: #ffffff;
  }

  /*
   * The stack is drawn back to front in flow order, so each disc overlaps the
   * one before it — which is the way the printed stack reads, and why the
   * count sits on the last one.
   */
  .token {
    position: absolute;
    border-radius: 50%;
    border-style: solid;
    border-color: #000000;
    background: #858585;
  }

  /* Colour comes from `design.moveInk`, inline — the same one the arrow mask beside it takes. */

  /* -- quote --------------------------------------------------------------- */
  /*
   * The text's own box, centred vertically and grown symmetrically as it
   * wraps — see `QUOTE_CENTER`/`QUOTE_HALF_HEIGHT` above — rather than
   * top-anchored. `fitScale` (see `fit-text.ts`) shrinks the text first;
   * `overflow: hidden` is only the backstop past its floor.
   */
  .quote-zone {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .quote-text,
  .quote-attribution {
    margin: 0;
    font-family: var(--card-font-text);
    font-weight: var(--card-font-text-weight);
    font-style: italic;
  }

  .quote-text {
    text-align: center;
  }

  .quote-attribution {
    position: absolute;
    white-space: nowrap;
    line-height: 1;
  }
</style>
