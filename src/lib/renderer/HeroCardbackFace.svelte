<script lang="ts">
  /**
   * The back of a hero's deck.
   *
   * Not the plain villain/minion `CardbackFace`, for two reasons. First, the
   * canvases disagree: that back is measured at trim size (`CARDBACK_BLEED`,
   * 373×520, no bleed), and the hero back was supplied at the same bleed
   * canvas every other hero face uses (the action card's `BLEED`). Second,
   * the templates themselves disagree in kind — the villain/minion art sits
   * *inside* a ring the template draws, where `hero_cardback_border.png` is
   * only a thin line near the edge, so this back's own artwork runs the full
   * bleed canvas behind it rather than being boxed into a smaller window.
   * The line is drawn as a themed mask (`HERO_CARDBACK.frame`,
   * `back.frame`) rather than a flat overlay, same technique as every other
   * recolourable template border in this app, so an author can choose its
   * colour the way they already can for everything else on a hero's cards.
   */
  import { fillCss } from '$lib/cards/style';
  import type { Character } from '$lib/characters/types';
  import { characterLabel } from '$lib/characters/factory';
  import { hasArtwork } from '$lib/core/artwork';
  import CardArt from './CardArt.svelte';
  import { BLEED, capTopToBoxTop, HERO_CARDBACK, px, pu, py } from './geometry';

  interface Props {
    character: Character;
  }

  let { character }: Props = $props();

  const back = $derived(character.cardback);
  const replaced = $derived(back.useReplacement && hasArtwork(back.replacement));
</script>

{#if replaced}
  <div class="full">
    <CardArt artwork={back.replacement} background={fillCss(back.background)} />
  </div>
{:else}
  <div class="full" style:background={fillCss(back.background)}>
    <CardArt artwork={back.artwork} background="transparent" />
  </div>

  <!-- The template's own thin line, recoloured — see the file note above. -->
  <div class="mask frame" style:background={fillCss(back.frame)}></div>

  <div
    class="name"
    style:right={px(BLEED.width - HERO_CARDBACK.name.right)}
    style:top={py(capTopToBoxTop(HERO_CARDBACK.name.capTop, HERO_CARDBACK.name.size))}
    style:font-size={pu(HERO_CARDBACK.name.size)}
    style:color={back.ink}
  >
    {characterLabel(character)}
  </div>
{/if}

<style>
  .full {
    position: absolute;
    inset: 0;
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
    mask-image: url('/assets/templates/hero_cardback_border.png');
    -webkit-mask-image: url('/assets/templates/hero_cardback_border.png');
  }

  .name {
    position: absolute;
    font-family: var(--card-font-name);
    font-weight: var(--card-font-name-weight);
    text-transform: uppercase;
    line-height: 1;
    white-space: nowrap;
    text-align: right;
  }
</style>
