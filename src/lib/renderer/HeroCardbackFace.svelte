<script lang="ts">
  /**
   * The back of a hero's deck.
   *
   * The supplied hero template already uses the action card's bleed canvas;
   * the villain/minion source is trim-sized and must be inset inside that
   * same canvas by `CardbackFace`. Both backs draw artwork edge to edge.
   * The hero's distinct two-tone lockup is read directly from
   * `UMLabs_Cardback_Template.png`: its complete alpha supplies the frame
   * layer, while its white/luminance pixels supply the contrasting mark in
   * `back.ink` along with the hero name. That keeps both existing colour
   * controls meaningful without letting derived masks drift behind the source.
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

  <!-- Two readings of the one source template preserve its two colour roles. -->
  <div class="mask template-frame" style:background={fillCss(back.frame)}></div>
  <div class="mask template-ink" style:background={back.ink}></div>

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
    mask-image: url('/assets/templates/UMLabs_Cardback_Template.png');
    -webkit-mask-image: url('/assets/templates/UMLabs_Cardback_Template.png');
    mask-size: 100% 100%;
    -webkit-mask-size: 100% 100%;
    mask-repeat: no-repeat;
    -webkit-mask-repeat: no-repeat;
  }

  .template-frame {
    mask-mode: alpha;
  }

  .template-ink {
    mask-mode: luminance;
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
