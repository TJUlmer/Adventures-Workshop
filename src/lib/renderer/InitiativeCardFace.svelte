<script lang="ts">
  /**
   * Initiative card: three bands — who acts, what happens Right Now, and what
   * happens at the End of Round.
   *
   * Each band label is set bottom-up to the left of a vertical separator. Bands
   * take their own fill and can each carry artwork, so any mix of image and
   * colour is possible.
   *
   * The bars between the bands and the label separators are drawn here rather
   * than masked out of the template: the template bakes them in at the villain
   * card's band positions, which a minion's shorter subject band does not
   * share. `initiative_frame.png` is the same file with both erased.
   */
  import type { CardTheme } from '$lib/cards/style';
  import { fillCss, solid } from '$lib/cards/style';
  import type { InitiativeBands } from '$lib/cards/types';
  import { createArtwork } from '$lib/core/artwork';
  import type { InitiativeCard } from '$lib/cards/types';
  import { initiativeBandLabel } from '$lib/cards/types';
  import AbilityText from './AbilityText.svelte';
  import CardArt from './CardArt.svelte';
  import type { InitiativeBandBox } from './geometry';
  import {
    capTopToBoxTop,
    clipRect,
    digitTopToBoxTop,
    INITIATIVE,
    INITIATIVE_BAND_DEFAULTS,
    INITIATIVE_BLEED as FRAME,
    initiativeBands,
    px,
    pu,
    py,
    seamBed
  } from './geometry';

  function fallbackBands(): InitiativeBands {
    const band = (key: keyof typeof INITIATIVE_BAND_DEFAULTS) => ({
      fill: solid(INITIATIVE_BAND_DEFAULTS[key].fill),
      ink: INITIATIVE_BAND_DEFAULTS[key].ink,
      artwork: createArtwork(),
      showArtwork: false
    });
    return {
      subject: band('subject'),
      rightNow: band('rightNow'),
      endOfRound: band('endOfRound')
    };
  }

  interface Props {
    card: InitiativeCard;
    theme: CardTheme;
  }

  let { card, theme }: Props = $props();

  const badge = INITIATIVE.moveBadge;

  /**
   * A minion's card gets the shorter subject band; a villain's and an effect's
   * both keep the tall one the print template draws.
   */
  const bandBoxes = $derived(
    initiativeBands(card.subject === 'minion' && card.variant === 'card' ? 'minion' : 'villain')
  );
  const subjectBand = $derived(bandBoxes[0]);
  const rightNowBand = $derived(bandBoxes[1]);
  const endOfRoundBand = $derived(bandBoxes[2]);

  /**
   * Documents are repaired on load, so `bands` should always be present. This
   * fallback is here because a render that throws does not just blank the
   * card — it leaves the effect graph broken, so later edits stop painting too.
   * A preview that is merely wrong is far cheaper than one that is dead.
   */
  const bands = $derived(card.bands ?? fallbackBands());

  /** The Right Now copy gives way to the badge rather than running under it. */
  const rightNowWidth = $derived(
    card.showMove
      ? badge.right - badge.width - 40 - INITIATIVE.textX
      : INITIATIVE.textWidth
  );

  const actor = $derived(card.subjectText.trim() || 'Villain');

  /**
   * A character card almost always just says the figure takes a turn, so that
   * is what it prints until the author writes something else. Derived rather
   * than seeded into the document, so it follows the figure's name instead of
   * going stale the moment they rename it.
   */
  const rightNowText = $derived(
    card.rightNow.trim() || (card.variant === 'card' ? `${actor} takes a turn.` : '')
  );

  /**
   * The interior, bled out under the border on every side. It shows in the two
   * gaps between the bands — which is what draws the bars separating them — and
   * closes the hairline the border and the bands would otherwise round apart at
   * some zooms.
   */
  const bed = seamBed(INITIATIVE.interior, FRAME, INITIATIVE.radius);

  /** A band's label separator, from its top edge down. */
  function ruleClip(box: InitiativeBandBox): string {
    return clipRect(
      {
        x: INITIATIVE.ruleX,
        y: box.rule.y,
        width: INITIATIVE.ruleWidth,
        height: box.rule.height
      },
      FRAME
    );
  }
</script>

{#snippet band(key: 'subject' | 'rightNow' | 'endOfRound', box: InitiativeBandBox)}
  {@const style = bands[key]}
  <div
    class="band-bg"
    style:left={px(INITIATIVE.interior.x, FRAME)}
    style:top={py(box.y, FRAME)}
    style:width={px(INITIATIVE.interior.width, FRAME)}
    style:height={py(box.height, FRAME)}
    style:background={fillCss(style.fill)}
  >
    {#if style.showArtwork}
      <CardArt artwork={style.artwork} background="transparent" />
    {/if}
  </div>

  <!-- Label separator: from the band's top edge, stopping short of its foot. -->
  <div
    class="chrome"
    style:clip-path={ruleClip(box)}
    style:background={fillCss(theme.frame)}
  ></div>

  <!--
    Set vertically rather than rotated, so the label's run is its box's height
    and it can be aligned within the band. `text-align: end` puts it at the top
    of the section, level with the copy beside it, which is how the template
    sets all three.
  -->
  <div
    class="label"
    style:left={px(INITIATIVE.labelCenterX - INITIATIVE.labelSize / 2, FRAME)}
    style:top={py(box.y + INITIATIVE.textTop, FRAME)}
    style:width={pu(INITIATIVE.labelSize, FRAME)}
    style:height={py(box.height - INITIATIVE.textTop * 2, FRAME)}
    style:font-size={pu(INITIATIVE.labelSize, FRAME)}
    style:color={style.ink}
  >
    {initiativeBandLabel(card, key)}
  </div>
{/snippet}

<!-- Under the bands, so it shows in the gaps between them as the band bars. -->
<div class="chrome" style:clip-path={bed} style:background={fillCss(theme.frame)}></div>

{#if subjectBand}{@render band('subject', subjectBand)}{/if}
{#if rightNowBand}{@render band('rightNow', rightNowBand)}{/if}
{#if endOfRoundBand}{@render band('endOfRound', endOfRoundBand)}{/if}

<!-- Band 1 body: the card type line. -->
{#if subjectBand}
  <div
    class="subject"
    style:left={px(INITIATIVE.textX, FRAME)}
    style:top={py(subjectBand.y + subjectBand.height / 2, FRAME)}
    style:width={px(INITIATIVE.textWidth, FRAME)}
    style:font-size={pu(INITIATIVE.subjectSize, FRAME)}
    style:color={card.bands.subject.ink}
  >
    {actor}
  </div>
{/if}

<!-- Band 2 body: Right Now, with the MOVE badge aligned right. -->
{#if rightNowBand}
  <div
    class="body"
    style:left={px(INITIATIVE.textX, FRAME)}
    style:top={py(rightNowBand.y + INITIATIVE.textTop, FRAME)}
    style:width={px(rightNowWidth, FRAME)}
    style:height={py(rightNowBand.height - INITIATIVE.textTop * 2, FRAME)}
    style:font-size={pu(INITIATIVE.bodySize, FRAME)}
    style:line-height={INITIATIVE.bodyLineHeight}
    style:color={card.bands.rightNow.ink}
  >
    <AbilityText
      ability={{ plain: rightNowText, immediately: '', duringCombat: '', afterCombat: '' }}
      placeholder="What happens right now."
      subject={actor}
    />
  </div>

  {#if card.showMove}
    {@const badgeTop = rightNowBand.y + (rightNowBand.height - badge.height) / 2}
    <div
      class="move"
      style:left={px(badge.right - badge.width, FRAME)}
      style:top={py(badgeTop, FRAME)}
      style:width={pu(badge.width, FRAME)}
      style:height={pu(badge.height, FRAME)}
      style:background={card.bands.rightNow.ink}
      role="img"
      aria-label="Move {card.moveValue}"
    ></div>
    <!--
      Condensed horizontally to the printed proportions, from its left edge so
      the squeeze does not walk the digit off its measured position.
    -->
    <div
      class="move-value"
      style:left={px(badge.right - badge.width + badge.numberOffsetX, FRAME)}
      style:top={py(
        digitTopToBoxTop(badgeTop + badge.numberOffsetY, badge.numberSize),
        FRAME
      )}
      style:font-size={pu(badge.numberSize, FRAME)}
      style:scale="{badge.numberCondense} 1"
      style:color={card.bands.rightNow.ink}
    >
      {card.moveValue}
    </div>
  {/if}
{/if}

<!-- Band 3 body: End of Round. -->
{#if endOfRoundBand}
  <div
    class="body"
    style:left={px(INITIATIVE.textX, FRAME)}
    style:top={py(
      capTopToBoxTop(
        endOfRoundBand.y + INITIATIVE.textTop,
        INITIATIVE.bodySize,
        INITIATIVE.bodyLineHeight
      ),
      FRAME
    )}
    style:width={px(INITIATIVE.textWidth, FRAME)}
    style:height={py(endOfRoundBand.height - INITIATIVE.textTop * 2, FRAME)}
    style:font-size={pu(INITIATIVE.bodySize, FRAME)}
    style:line-height={INITIATIVE.bodyLineHeight}
    style:color={card.bands.endOfRound.ink}
  >
    <AbilityText
      ability={{ plain: card.endOfRound, immediately: '', duringCombat: '', afterCombat: '' }}
      placeholder="What happens at the end of the round."
      subject={actor}
    />
  </div>
{/if}

<!-- Frame, band rules and separators last. -->
<div class="mask frame" style:background={fillCss(theme.frame)}></div>

<style>
  .band-bg {
    position: absolute;
    overflow: hidden;
  }

  /* Border-coloured chrome, cut to shape. See `rect` above. */
  .chrome {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  /* Band labels read bottom-up, left of the template's vertical separator. */
  /*
   * `vertical-rl` sets the caps sideways clockwise; the half turn brings them
   * back to reading bottom-up. The box then runs down the band, so `end` is
   * its top — where the template puts every one of these.
   */
  .label {
    position: absolute;
    writing-mode: vertical-rl;
    rotate: 180deg;
    text-align: end;
    font-family: var(--card-font-title);
    font-weight: var(--card-font-title-weight);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    line-height: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .subject {
    position: absolute;
    translate: 0 -50%;
    font-family: var(--card-font-title);
    font-weight: var(--card-font-title-weight);
    text-transform: uppercase;
    line-height: 0.9;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Leading comes from `INITIATIVE.bodyLineHeight`, set inline on each band. */
  .body {
    position: absolute;
    font-family: var(--card-font-title);
    font-weight: var(--card-font-title-weight);
    overflow: hidden;
  }

  /* Badge art is a black shape with alpha, so it is masked, not drawn. */
  .move {
    position: absolute;
    mask-image: url('/assets/templates/UMA_initiative_no_move_value.png');
    -webkit-mask-image: url('/assets/templates/UMA_initiative_no_move_value.png');
    mask-size: 100% 100%;
    -webkit-mask-size: 100% 100%;
    mask-repeat: no-repeat;
    -webkit-mask-repeat: no-repeat;
  }

  .move-value {
    position: absolute;
    /* Squeeze from the left edge; the measured offset is to the digit's start. */
    transform-origin: left center;
    font-family: var(--card-font-numeral);
    font-weight: var(--card-font-numeral-weight);
    line-height: 1;
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

  /*
   * `Initiative Card_border.png` with the band bars and label separators
   * erased — they are drawn per band instead, because the template's are at the
   * villain card's positions and a minion's bands are not there.
   */
  .frame {
    mask-image: url('/assets/templates/initiative_frame.png');
    -webkit-mask-image: url('/assets/templates/initiative_frame.png');
  }
</style>
