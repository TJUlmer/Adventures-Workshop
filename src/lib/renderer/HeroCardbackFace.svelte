<script lang="ts">
  /**
   * The back of a hero's deck.
   *
   * Almost the plain villain/minion `CardbackFace` — an art window inside a
   * ring, the character's name printed on it, `useReplacement` swapping the
   * whole thing for a finished image the same way — but not that component,
   * because it and its supplied template disagree on canvas: the villain/
   * minion back is measured at trim size (`CARDBACK_BLEED`, 373×520, no
   * bleed), and the hero back was supplied at the same bleed canvas every
   * other hero face uses. Rather than force one coordinate system onto the
   * other's numbers, this reuses the *action card's* `INTERIOR`/`BLEED` —
   * which is what the hero back actually measures out to — and stays its own
   * small file.
   */
  import { fillCss } from '$lib/cards/style';
  import type { Character } from '$lib/characters/types';
  import { characterLabel } from '$lib/characters/factory';
  import { hasArtwork } from '$lib/core/artwork';
  import { TEMPLATE_ASSETS } from './assets';
  import CardArt from './CardArt.svelte';
  import { BLEED, capTopToBoxTop, inName, INTERIOR, INTERIOR_RADIUS, px, pu, py } from './geometry';

  interface Props {
    character: Character;
  }

  let { character }: Props = $props();

  const back = $derived(character.cardback);
  const replaced = $derived(back.useReplacement && hasArtwork(back.replacement));

  /** Inside the ring, bottom right — the same corner the villain/minion back uses. */
  const NAME = { right: INTERIOR.x + INTERIOR.width - 60, capTop: INTERIOR.y + INTERIOR.height - 120, size: inName(46) };
</script>

{#if replaced}
  <div class="full">
    <CardArt artwork={back.replacement} background={fillCss(back.background)} />
  </div>
{:else}
  <div class="bed" style:background={fillCss(back.background)}></div>

  <div
    class="window"
    style:left={px(INTERIOR.x)}
    style:top={py(INTERIOR.y)}
    style:width={px(INTERIOR.width)}
    style:height={py(INTERIOR.height)}
    style:border-radius={pu(INTERIOR_RADIUS)}
  >
    <CardArt artwork={back.artwork} background="transparent" />
  </div>

  <!-- Line art over the top: the ring, and nothing else — the supplied
       template carries no lockup or rule to stand in for. -->
  <img class="template" src={TEMPLATE_ASSETS.heroCardback} alt="" />

  <div
    class="name"
    style:right={px(BLEED.width - NAME.right)}
    style:top={py(capTopToBoxTop(NAME.capTop, NAME.size))}
    style:font-size={pu(NAME.size)}
    style:color={back.ink}
  >
    {characterLabel(character)}
  </div>
{/if}

<style>
  .full,
  .bed {
    position: absolute;
    inset: 0;
  }

  .window {
    position: absolute;
    overflow: hidden;
  }

  .template {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
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
