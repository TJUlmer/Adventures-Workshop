<script lang="ts">
  /**
   * A deliberately modest stand-in for authored box art.
   *
   * Equal slices make the roster legible as a collection without pretending
   * to infer portrait crops or manufacture a professional illustration. The
   * title lockup is central and the colours come from the set's own card
   * theme, so the result still belongs to what its author designed.
   */
  import { fillCss } from '$lib/cards/style';
  import { resolveCardTheme } from '$lib/cards/theme';
  import { characterLabel } from '$lib/characters/factory';
  import type { Character } from '$lib/characters/types';
  import { displayFontStack, displayFontWeight, fitDisplaySize } from '$lib/renderer/fonts';
  import {
    automaticBoxArtCharacters,
    characterCoverArtwork
  } from '$lib/sets/box-art';
  import { charactersByRole } from '$lib/sets/queries';
  import type { AdventureSet } from '$lib/sets/types';

  interface Props {
    set: AdventureSet;
  }

  let { set }: Props = $props();

  const characters = $derived(automaticBoxArtCharacters(set));
  const heroes = $derived(charactersByRole(set, 'hero'));
  const lead = $derived(
    set.kind === 'adventure'
      ? (charactersByRole(set, 'villain')[0] ??
          charactersByRole(set, 'minion')[0] ??
          heroes[0] ??
          set.characters[0] ??
          null)
      : (heroes[0] ?? set.characters[0] ?? null)
  );
  const theme = $derived(
    resolveCardTheme(set.style, lead?.style ?? null, null, 'action', lead?.role)
  );
  const title = $derived((set.name.trim() || 'Untitled Adventure').toUpperCase());
  const titleSize = $derived(
    (fitDisplaySize(title, { width: 408, height: 112 }, theme.displayFont, 68, 0.86) /
      512) *
      100
  );
  const kicker = $derived(
    set.kind === 'adventure'
      ? 'ADVENTURE SET'
      : `${heroes.length} ${heroes.length === 1 ? 'HERO' : 'HEROES'}`
  );

  function initials(character: Character): string {
    const words = characterLabel(character).trim().split(/\s+/).filter(Boolean);
    return words
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join('');
  }
</script>

<div
  class="generated-box-art"
  data-generated-box-art
  aria-hidden="true"
  style:--box-body={fillCss(theme.body)}
  style:--box-frame={fillCss(theme.frame)}
  style:--box-frame-colour={theme.frame.color}
  style:--box-banner={fillCss(theme.banner)}
  style:--box-ink={theme.bannerInk}
  style:--box-divider={theme.divider}
  style:--box-title-font={displayFontStack(theme.displayFont)}
  style:--box-title-weight={displayFontWeight(theme.displayFont)}
  style:--box-title-size={`${titleSize.toFixed(3)}cqw`}
>
  <div class="panels">
    {#each characters as character (character.id)}
      {@const artwork = characterCoverArtwork(set, character)}
      <div
        class="panel"
        style:--panel-background={fillCss(character.cardback.background)}
        style:--panel-frame={character.cardback.background.color}
        style:--panel-ink={character.cardback.ink}
      >
        {#if artwork?.source}
          <img src={artwork.source} alt="" draggable="false" />
        {:else}
          <span class="initial">{initials(character)}</span>
        {/if}
        <span class="panel-wash"></span>
        <span class="character-name">{characterLabel(character)}</span>
      </div>
    {:else}
      <div class="panel empty-panel">
        <span class="initial">{title.charAt(0)}</span>
      </div>
    {/each}
  </div>

  <span class="edge edge-top"></span>
  <span class="edge edge-bottom"></span>

  <div class="title-edge">
    <div class="title-lockup">
      <span class="kicker">{kicker}</span>
      <span class="box-title">{title}</span>
    </div>
  </div>
</div>

<style>
  .generated-box-art {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    container-type: inline-size;
    isolation: isolate;
    background: var(--box-body);
    color: var(--box-ink);
  }

  .panels {
    position: absolute;
    inset: 0;
    display: flex;
  }

  .panel {
    position: relative;
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    background: var(--panel-background, var(--box-body));
  }

  .panel + .panel::before {
    content: '';
    position: absolute;
    z-index: 3;
    inset-block: 0;
    left: 0;
    width: 0.75cqw;
    translate: -50% 0;
    background: var(--box-divider);
  }

  .panel img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    max-width: none;
    object-fit: cover;
    object-position: center;
    -webkit-user-drag: none;
  }

  .initial {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-family: var(--box-title-font);
    font-size: 23cqw;
    font-weight: var(--box-title-weight);
    color: var(--panel-ink, var(--box-ink));
    opacity: 0.24;
  }

  .panel-wash {
    position: absolute;
    z-index: 1;
    inset: 0;
    background: var(--panel-frame, var(--box-frame-colour));
    opacity: 0.14;
  }

  .character-name {
    position: absolute;
    z-index: 2;
    right: 0;
    bottom: 3.25cqw;
    left: 0;
    padding: 2.7cqw 1.5cqw 1.35cqw;
    overflow: hidden;
    background: linear-gradient(
      transparent,
      color-mix(in srgb, var(--panel-frame, var(--box-frame-colour)) 88%, transparent)
    );
    font-family: var(--box-title-font);
    font-size: clamp(5px, 3.15cqw, 18px);
    font-weight: var(--box-title-weight);
    line-height: 1;
    color: var(--panel-ink, var(--box-ink));
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .edge {
    position: absolute;
    z-index: 4;
    left: -4%;
    width: 108%;
    height: 3.2cqw;
    background: var(--box-frame);
    border-block: 0.55cqw solid var(--box-divider);
    rotate: -2.5deg;
  }

  .edge-top {
    top: 3.8%;
  }

  .edge-bottom {
    bottom: 3.8%;
  }

  .title-edge {
    position: absolute;
    z-index: 5;
    top: 50%;
    left: 50%;
    width: 90%;
    padding: 0.85cqw;
    translate: -50% -50%;
    rotate: -1.2deg;
    background: var(--box-divider);
    clip-path: polygon(3.5% 0, 100% 0, 96.5% 100%, 0 100%);
  }

  .title-lockup {
    display: flex;
    min-height: 29cqw;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.6cqw;
    padding: 3.2cqw 7cqw 3.8cqw;
    background: var(--box-banner);
    clip-path: polygon(3.2% 0, 100% 0, 96.8% 100%, 0 100%);
    text-align: center;
  }

  .kicker {
    font-family: var(--box-title-font);
    font-size: 3.45cqw;
    font-weight: var(--box-title-weight);
    line-height: 1;
    letter-spacing: 0.18em;
    opacity: 0.76;
  }

  .box-title {
    display: block;
    width: 100%;
    max-height: 22cqw;
    overflow: hidden;
    font-family: var(--box-title-font);
    font-size: var(--box-title-size);
    font-weight: var(--box-title-weight);
    line-height: 0.86;
    letter-spacing: -0.015em;
    overflow-wrap: anywhere;
    text-wrap: balance;
  }
</style>
