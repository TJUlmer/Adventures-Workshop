<script lang="ts">
  /**
   * A hero's character card: attack type, health, move and special ability
   * the character already carries elsewhere in the document, laid out as the
   * stat-reference sheet a hero's box prints alongside its deck — plus a
   * sidekick's own stats, or a flavour quote when there is no sidekick.
   *
   * The chrome is the supplied frame art laid over the top, and that is the
   * one decision everything else follows from. Nothing in it is redrawn — but
   * it comes in two pieces rather than one, split by
   * `tools/hero-card-assets.py`:
   *
   *   border  the pink outline and the bars between the bands, as a **mask**,
   *           because that colour is the one piece of this card's chrome an
   *           author would want to choose
   *   ink     every tab label, the two START HEALTH captions, the health
   *           badge, the move arrow and the word MOVE — as a picture, already
   *           in the colours they print, none of which is a choice
   *
   * Under both go the three band fills and whatever artwork each carries; into
   * the holes goes the copy.
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
  import CardArt from './CardArt.svelte';
  import { ATTACK_TYPE_SIZES, ATTACK_TYPE_SYMBOLS, TEMPLATE_ASSETS } from './assets';
  import {
    CHARACTER_ABILITY,
    CHARACTER_ABILITY_PANEL,
    CHARACTER_ATTACK,
    CHARACTER_BAND_RUNS,
    CHARACTER_BANDS,
    CHARACTER_CARD,
    CHARACTER_HEADING,
    CHARACTER_HEALTH,
    CHARACTER_MOVE,
    CHARACTER_QUOTE,
    CHARACTER_TOKENS,
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
  }

  let { character, card = null }: Props = $props();

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
   * Which of the three layouts to lay over the card.
   *
   * They differ only below the ability panel — a sidekick's two bands or a
   * quote panel filling the same space — and a swarm sidekick differs again in
   * one badge. Three sets of art rather than one with pieces switched off,
   * because each is a single flat picture and there is nothing in it to
   * switch.
   */
  const layout = $derived(
    !showSidekick ? 'quote' : sidekick.multiple ? 'multi' : 'sidekick'
  );
  const border = $derived(TEMPLATE_ASSETS.heroCharacterBorder[layout]);
  const ink = $derived(TEMPLATE_ASSETS.heroCharacterInk[layout]);

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
    <div
      class="band-art"
      style:left={px(CHARACTER_CARD.x)}
      style:top={py(run.top)}
      style:width={px(CHARACTER_CARD.width)}
      style:height={py(run.bottom - run.top)}
    >
      <CardArt artwork={design[band].artwork} background="transparent" />
    </div>
  {/if}
{/each}

<!-- HERO ----------------------------------------------------------------- -->
{@render heading(CHARACTER_BANDS.hero, heroName)}

<!-- SPECIAL ABILITY -------------------------------------------------------- -->
<div
  class="ability"
  style:left={px(CHARACTER_ABILITY.nameX)}
  style:top={py(NAME_TOP)}
  style:width={px(CHARACTER_ABILITY_PANEL.contentRight - CHARACTER_ABILITY.nameX)}
  style:max-height={py(
    CHARACTER_BANDS.ability.top + CHARACTER_BANDS.ability.height - NAME_TOP
  )}
  style:gap={pu(CHARACTER_ABILITY.gap)}
>
  {#each identity.abilities.length ? identity.abilities : [null] as ability, index (index)}
    <div class="ability-entry">
      <div
        class="ability-name"
        style:font-size={pu(CHARACTER_ABILITY.nameSize)}
        style:line-height="1"
      >
        {ability?.name.trim() || 'Ability Name'}
      </div>

      <div
        class="ability-rule"
        style:margin-top={pu(RULE_GAP)}
        style:margin-left={pu(CHARACTER_ABILITY.ruleX - CHARACTER_ABILITY.nameX)}
        style:width={pu(CHARACTER_ABILITY.ruleWidth)}
        style:height={pu(CHARACTER_ABILITY.ruleHeight)}
      ></div>

      <p
        class="ability-text"
        class:placeholder={ability === null}
        style:margin-top={pu(TEXT_GAP)}
        style:margin-left={pu(CHARACTER_ABILITY.textX - CHARACTER_ABILITY.nameX)}
        style:font-size={pu(CHARACTER_ABILITY.textSize)}
        style:line-height={CHARACTER_ABILITY.textLineHeight}
      >
        {ability?.text.trim() || 'Ability text goes here.'}
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
  >
    &ldquo;
  </span>
  <span
    class="quote-mark close"
    style:right={px(1632 - CHARACTER_QUOTE.markRightX)}
    style:top={py(CHARACTER_QUOTE.markY)}
    style:font-size={pu(CHARACTER_QUOTE.markHeight * 2)}
  >
    &rdquo;
  </span>

  <p
    class="quote-text"
    style:left={px(CHARACTER_QUOTE.textX)}
    style:top={py(
      capTopToBoxTop(
        CHARACTER_QUOTE.textCapTop,
        CHARACTER_QUOTE.textSize,
        CHARACTER_QUOTE.textLineHeight
      )
    )}
    style:width={px(CHARACTER_QUOTE.textWidth)}
    style:font-size={pu(CHARACTER_QUOTE.textSize)}
    style:line-height={CHARACTER_QUOTE.textLineHeight}
  >
    {identity.quote.text.trim() || 'A memorable line goes here.'}
  </p>

  {#if identity.quote.attribution.trim()}
    <p
      class="quote-attribution"
      style:right={px(1632 - CHARACTER_QUOTE.attributionRight)}
      style:top={py(
        capTopToBoxTop(CHARACTER_QUOTE.attributionCapTop, CHARACTER_QUOTE.attributionSize)
      )}
      style:font-size={pu(CHARACTER_QUOTE.attributionSize)}
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
  {@render attackRow(CHARACTER_BANDS.sidekickAttack, sidekick.attackType)}

  {#if sidekick.multiple}
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
  {:else}
    {@render healthValue(CHARACTER_HEALTH.sidekickCenterY, sidekick.health ?? 0)}
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
{#snippet attackRow(band: { top: number; height: number }, kind: AttackType)}
  {@const size = ATTACK_TYPE_SIZES[kind]}
  <div
    class="attack"
    style:left={px(CHARACTER_ATTACK.x - size.inset)}
    style:top={py(band.top)}
    style:height={py(band.height)}
  >
    <img src={ATTACK_TYPE_SYMBOLS[kind]} alt={kind} style:width={pu(size.width)} />
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
    mask-image: var(--border-art);
    -webkit-mask-image: var(--border-art);
    mask-size: 100% 100%;
    -webkit-mask-size: 100% 100%;
    mask-repeat: no-repeat;
    -webkit-mask-repeat: no-repeat;
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
   * Bottom of the panel is the bound: an over-long ability truncates at the
   * band's edge rather than printing across the sidekick's. Visible truncation
   * is the signal that the text is too long.
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

  .ability-name {
    font-family: var(--card-font-name);
    font-weight: var(--card-font-name-weight);
    text-transform: uppercase;
    white-space: nowrap;
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
   * whichever serif the browser has. Nothing else on the card depends on them.
   */
  .quote-mark {
    position: absolute;
    font-family: Georgia, 'Times New Roman', serif;
    line-height: 1;
    color: #f6eada;
  }

  .quote-text,
  .quote-attribution {
    position: absolute;
    margin: 0;
    font-family: var(--card-font-text);
    font-weight: var(--card-font-text-weight);
    font-style: italic;
    color: #ffffff;
  }

  .quote-text {
    text-align: center;
  }

  .quote-attribution {
    white-space: nowrap;
    line-height: 1;
  }
</style>
