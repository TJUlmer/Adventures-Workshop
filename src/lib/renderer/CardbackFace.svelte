<script lang="ts">
  /**
   * The back of a character's deck.
   *
   * The template is transparent except its line art, so it sits *over* the
   * artwork rather than masking it. Turning on `useReplacement` swaps the whole
   * composition for a finished image — template, name and all — for authors who
   * would rather supply a back than build one.
   */
  import { fillCss } from '$lib/cards/style';
  import type { Character } from '$lib/characters/types';
  import { characterLabel } from '$lib/characters/factory';
  import { hasArtwork } from '$lib/core/artwork';
  import { TEMPLATE_ASSETS } from './assets';
  import CardArt from './CardArt.svelte';
  import {
    CARDBACK,
    CARDBACK_BLEED as FRAME,
    capTopToBoxTop,
    NAME_METRICS,
    px,
    pu,
    py
  } from './geometry';

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
  <div class="bed" style:background={fillCss(back.background)}></div>

  <div
    class="window"
    style:left={px(CARDBACK.window.x, FRAME)}
    style:top={py(CARDBACK.window.y, FRAME)}
    style:width={px(CARDBACK.window.width, FRAME)}
    style:height={py(CARDBACK.window.height, FRAME)}
    style:border-radius={pu(CARDBACK.radius, FRAME)}
  >
    <CardArt artwork={back.artwork} background="transparent" />
  </div>

  <!-- Line art over the top: logo, border and the name rules. -->
  <img class="template" src={TEMPLATE_ASSETS.minionCardback} alt="" />

  <div
    class="label"
    style:right={px(FRAME.width - CARDBACK.label.right, FRAME)}
    style:top={py(capTopToBoxTop(CARDBACK.label.capTop, CARDBACK.label.size, 1, NAME_METRICS), FRAME)}
    style:font-size={pu(CARDBACK.label.size, FRAME)}
    style:color={back.ink}
  >
    {back.label}
  </div>

  <div
    class="name"
    style:right={px(FRAME.width - CARDBACK.name.right, FRAME)}
    style:top={py(capTopToBoxTop(CARDBACK.name.capTop, CARDBACK.name.size, 1, NAME_METRICS), FRAME)}
    style:font-size={pu(CARDBACK.name.size, FRAME)}
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

  /* The same two roles as the action card's ribbon, so the same face. */
  .label,
  .name {
    position: absolute;
    font-family: var(--card-font-name);
    font-weight: var(--card-font-name-weight);
    text-transform: uppercase;
    line-height: 1;
    white-space: nowrap;
    text-align: right;
  }

  .label {
    letter-spacing: 0.08em;
    opacity: 0.85;
  }
</style>
