<script lang="ts">
  /**
   * The back of a villain's or minion's deck.
   *
   * `adventures_minion_cardback_nologo.png` is single-colour line art — a
   * border and the rule above the name — so it is drawn as a themed mask
   * over full-bleed artwork, the same technique `HeroCardbackFace` uses for
   * its own line, rather than the flat overlay boxing art inside a window
   * this used to be. Turning on `useReplacement` swaps the whole composition
   * for a finished image — template, name and all — for authors who would
   * rather supply a back than build one.
   */
  import { fillCss } from '$lib/cards/style';
  import type { Character } from '$lib/characters/types';
  import { characterLabel } from '$lib/characters/factory';
  import { hasArtwork } from '$lib/core/artwork';
  import CardArt from './CardArt.svelte';
  import { CARDBACK, CARDBACK_BLEED as FRAME, capTopToBoxTop, NAME_METRICS, px, pu, py } from './geometry';

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

  <!-- The template's own line, recoloured — see the file note above. -->
  <div class="mask frame" style:background={fillCss(back.frame)}></div>

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
    mask-image: url('/assets/templates/adventures_minion_cardback_nologo.png');
    -webkit-mask-image: url('/assets/templates/adventures_minion_cardback_nologo.png');
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
