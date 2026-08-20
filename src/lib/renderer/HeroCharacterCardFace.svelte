<script lang="ts">
  /**
   * A hero's character card: attack type, health, move and special ability
   * the character already carries elsewhere in the document, laid out as the
   * stat-reference sheet a hero's box prints alongside its deck — plus a
   * sidekick's own stats, or a flavour quote when there is no sidekick.
   *
   * The chrome is the supplied frame art laid over the top, and that is the
   * one decision everything else follows from. Nothing in it is redrawn — but
   * it comes in four pieces rather than one, split by
   * `tools/hero-card-assets.py`:
   *
   *   border       the pink outline and the bars between the bands, as a **mask**
   *   badge        the shield behind the START HEALTH number — the hero's
   *                own, never the sidekick's — as a **mask**
   *   badgeAccent  a small triangle notched into the shield, low in its
   *                body, printed as its own decorative colour — a separate
   *                **mask**
   *   ink          every tab label, the two START HEALTH captions, the move
   *                arrow and the word MOVE — as a picture, already in the
   *                colours they print, none of which is a choice
   *
   * The first three are colours an author would want to choose, independently
   * of one another; the fourth is not.
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
  import { fitScale } from './fit-text';
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
   * by health state: `multi` has no badge of its own (a token stack stands
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
          : 'multi'
  );
  const border = $derived(TEMPLATE_ASSETS.heroCharacterBorder[layout]);
  const badge = $derived(TEMPLATE_ASSETS.heroCharacterBadge[layout]);
  const badgeAccent = $derived(TEMPLATE_ASSETS.heroCharacterBadgeAccent[layout]);
  const ink = $derived(TEMPLATE_ASSETS.heroCharacterInk[layout]);

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
  const QUOTE_CENTER =
    QUOTE_ONE_LINE_TOP + (CHARACTER_QUOTE.textSize * CHARACTER_QUOTE.textLineHeight) / 2;
  const QUOTE_ATTRIBUTION_TOP = capTopToBoxTop(
    CHARACTER_QUOTE.attributionCapTop,
    CHARACTER_QUOTE.attributionSize
  );
  const QUOTE_ABOVE_MARGIN = QUOTE_CENTER - (CHARACTER_QUOTE.markY + 24);
  const hasAttribution = $derived(identity.quote.attribution.trim().length > 0);
  const QUOTE_HALF_HEIGHT = $derived(
    Math.min(
      QUOTE_ABOVE_MARGIN,
      (hasAttribution ? QUOTE_ATTRIBUTION_TOP - 24 : CHARACTER_BANDS.bottom - 60) - QUOTE_CENTER
    )
  );

  let abilityBox: HTMLDivElement | null = $state(null);
  let quoteBox: HTMLDivElement | null = $state(null);

  /** Re-fit whenever the printed ability text (name or copy) changes. */
  $effect(() => {
    const signature = identity.abilities.map((a) => `${a.name}|${a.text}`).join('\n');
    void signature;
    if (abilityBox) fitScale(abilityBox);
  });

  /** Re-fit whenever the printed quote, or the zone it has to fit in, changes. */
  $effect(() => {
    void identity.quote.text;
    void QUOTE_HALF_HEIGHT;
    if (quoteBox) fitScale(quoteBox);
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
>
  {#each identity.abilities.length ? identity.abilities : [null] as ability, index (index)}
    <div class="ability-entry">
      <div
        class="ability-name"
        style:font-size="calc({pu(CHARACTER_ABILITY.nameSize)} * var(--fit-scale, 1))"
        style:line-height="1"
      >
        {ability?.name.trim() || 'Ability Name'}
      </div>

      <!--
        The rule's own margins/size scale with `--fit-scale` too — not just
        the text either side of it. Leaving them fixed while the type shrank
        left a full-size rule and a fixed gap dominating a block that was
        supposed to be getting smaller, which barely moved `scrollHeight` no
        matter how far the font shrank.
      -->
      <div
        class="ability-rule"
        style:margin-top="calc({pu(RULE_GAP)} * var(--fit-scale, 1))"
        style:margin-left="calc({pu(CHARACTER_ABILITY.ruleX - CHARACTER_ABILITY.nameX)} * var(--fit-scale, 1))"
        style:width="calc({pu(CHARACTER_ABILITY.ruleWidth)} * var(--fit-scale, 1))"
        style:height="calc({pu(CHARACTER_ABILITY.ruleHeight)} * var(--fit-scale, 1))"
      ></div>

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
          {#each parseAbilityText(ability.text) as segment, index (index)}
            {#if segment.kind === 'symbol'}
              <img class="ability-symbol" src={symbolUrl(segment.name)} alt={segment.name} />
            {:else if segment.kind === 'customSymbol'}
              {@const custom = customSymbols.find((s) => s.id === segment.id)}
              {#if custom?.source}
                <img class="ability-symbol" src={custom.source} alt={custom.name} />
              {/if}
            {:else if segment.kind === 'text'}{segment.value}{/if}
          {/each}
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
  <span
    class="quote-mark"
    style:left={px(CHARACTER_QUOTE.markLeftX)}
    style:top={py(CHARACTER_QUOTE.markY)}
    style:font-size={pu(CHARACTER_QUOTE.markHeight * 2)}
    style:color={fillCss(design.quoteInk)}
  >
    &ldquo;
  </span>
  <span
    class="quote-mark close"
    style:right={px(1632 - CHARACTER_QUOTE.markRightX)}
    style:top={py(CHARACTER_QUOTE.markY)}
    style:font-size={pu(CHARACTER_QUOTE.markHeight * 2)}
    style:color={fillCss(design.quoteInk)}
  >
    &rdquo;
  </span>

  <div
    bind:this={quoteBox}
    class="quote-zone"
    style:left={px(CHARACTER_QUOTE.textX)}
    style:top={py(QUOTE_CENTER - QUOTE_HALF_HEIGHT)}
    style:width={px(CHARACTER_QUOTE.textWidth)}
    style:height={py(QUOTE_HALF_HEIGHT * 2)}
  >
    <p
      class="quote-text"
      style:font-size="calc({pu(CHARACTER_QUOTE.textSize)} * var(--fit-scale, 1))"
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
      style:top={py(
        capTopToBoxTop(CHARACTER_QUOTE.attributionCapTop, CHARACTER_QUOTE.attributionSize)
      )}
      style:font-size={pu(CHARACTER_QUOTE.attributionSize)}
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
<div class="mask border" style:--border-art="url('{border}')" style:background={fillCss(design.border)}></div>
<div class="mask badge" style:--badge-art="url('{badge}')" style:background={fillCss(design.healthBadge)}></div>
<div
  class="mask badge-accent"
  style:--badge-accent-art="url('{badgeAccent}')"
  style:background={fillCss(design.healthBadgeAccent)}
></div>
<img class="template" src={ink} alt="" />

{@render attackRow(CHARACTER_BANDS.heroAttack, identity.attackType)}
{@render healthValue(CHARACTER_HEALTH.heroCenterY, identity.health ?? 0)}

<span
  class="move"
  style:left={px(CHARACTER_MOVE.centerX)}
  style:top={py(digitTopToBoxTop(CHARACTER_MOVE.digitTop, CHARACTER_MOVE.size))}
  style:font-size={pu(CHARACTER_MOVE.size)}
  style:scale="{CHARACTER_MOVE.condense} 1"
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
      {@render healthBadgeAt(
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
    {@render healthBadgeAt(
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
    {@render healthBadgeAt(
      CHARACTER_HEALTH.sidekickCenterX,
      CHARACTER_HEALTH.sidekickCenterY,
      1,
      sidekick.health ?? 0
    )}
  {/if}
{/if}
{/if}

{#snippet heading(band: { top: number; height: number }, word: string)}
  <span
    class="heading"
    style:left={px(CHARACTER_HEADING.x)}
    style:top={py(
      capTopToBoxTop(
        band.top + CHARACTER_HEADING.capTop,
        CHARACTER_HEADING.size,
        1,
        NAME_METRICS
      )
    )}
    style:font-size={pu(CHARACTER_HEADING.size)}
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
{#snippet healthBadgeAt(centerX: number, centerY: number, scale: number, value: number)}
  {@const origin = `${px(CHARACTER_HEALTH.centerX)} ${py(CHARACTER_HEALTH.heroCenterY)}`}
  {@const move = `translate(${pu(centerX - CHARACTER_HEALTH.centerX)}, ${pu(
    centerY - CHARACTER_HEALTH.heroCenterY
  )}) scale(${scale})`}
  <div
    class="mask badge"
    style:--badge-art="url('{badge}')"
    style:background={fillCss(design.healthBadge)}
    style:transform-origin={origin}
    style:transform={move}
  ></div>
  <div
    class="mask badge-accent"
    style:--badge-accent-art="url('{badgeAccent}')"
    style:background={fillCss(design.healthBadgeAccent)}
    style:transform-origin={origin}
    style:transform={move}
  ></div>
  <span
    class="health"
    style:left={px(centerX)}
    style:top={py(digitMiddleToBoxTop(centerY, CHARACTER_HEALTH.size * scale))}
    style:font-size={pu(CHARACTER_HEALTH.size * scale)}
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

  .template,
  .mask {
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

  /* -- band headings and the attack rows ---------------------------------- */
  .heading {
    position: absolute;
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
  .ability {
    position: absolute;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: #000000;
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
  .move,
  .token-count {
    position: absolute;
    translate: -50% 0;
    font-family: var(--card-font-numeral);
    font-weight: var(--card-font-numeral-weight);
    line-height: 1;
    white-space: nowrap;
  }

  .health,
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

  .move {
    color: #000000;
  }

  /* -- quote --------------------------------------------------------------- */
  /*
   * The printed marks are set in the artwork's own face, which is not one of
   * the three here, so their box is positioned and their ink is left to
   * whichever serif the browser has. Colour comes from `design.quoteInk`,
   * inline below — the same one this text and its attribution take, so all
   * three move together.
   */
  .quote-mark {
    position: absolute;
    font-family: Georgia, 'Times New Roman', serif;
    line-height: 1;
  }

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
