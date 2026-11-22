<script lang="ts">
  import type { CardbackSubject } from '$lib/decks/types';
  /**
   * The back of a hero's deck.
   *
   * The supplied hero template already uses the action card's bleed canvas;
   * the villain/minion source is trim-sized and must be inset inside that
   * same canvas by `CardbackFace`. Both backs draw artwork edge to edge.
   * The hero's distinct two-tone lockup is read directly from
   * `UMLabs_Cardback_Template.png`: its complete alpha supplies the frame
   * layer, while a generated alpha mask supplies the contrasting mark in
   * `back.ink` along with the hero name. Raster luminance masks fall back to
   * alpha in some browsers, painting the whole badge and hiding its logo.
   * Generate the logo from the same source canvas without resampling it.
   */
  import { fillCss } from '$lib/cards/style';
  import { cardbackLabel } from '$lib/decks/factory';
  import { hasArtwork } from '$lib/core/artwork';
  import CardArt from './CardArt.svelte';
  import { BLEED, capTopToBoxTop, HERO_CARDBACK, px, pu, py } from './geometry';

  interface Props {
    character: CardbackSubject;
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

  <!-- Both layers use alpha so the text/logo colour works on mobile browsers too. -->
  <div class="mask template-frame" style:background={fillCss(back.frame)}></div>
  <div class="mask template-ink" style:background={back.ink}></div>

  <div
    class="name"
    style:right={px(BLEED.width - HERO_CARDBACK.name.right)}
    style:top={py(capTopToBoxTop(HERO_CARDBACK.name.capTop, HERO_CARDBACK.name.size))}
    style:font-size={pu(HERO_CARDBACK.name.size)}
    style:color={back.ink}
  >
    {cardbackLabel(character)}
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

  .template-frame {
    mask-image: url('/assets/templates/UMLabs_Cardback_Template.png');
    -webkit-mask-image: url('/assets/templates/UMLabs_Cardback_Template.png');
  }

  .template-ink {
    mask-image: url('/assets/templates/umlabs_cardback_logo_alpha.png');
    -webkit-mask-image: url('/assets/templates/umlabs_cardback_logo_alpha.png');
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
