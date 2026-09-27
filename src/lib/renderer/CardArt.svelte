<script lang="ts">
  /**
   * The artwork layer: crop, transform, colour grade and edge mask.
   * Shared by every card template so all of them treat art identically.
   */
  import type { Artwork } from '$lib/core/artwork';
  import { artLayout, artMaskCss, FULL_CROP, hasArtwork } from '$lib/core/artwork';

  interface Props {
    artwork: Artwork;
    /** Background shown where the art does not reach. */
    background: string;
    /**
     * How the picture meets its window.
     *
     * `cover` by default: imported pictures fill their window without ever
     * changing their native aspect ratio. `contain` is for places where the
     * whole picture must stay visible — a logo dropped on a square plate
     * should letterbox rather than be cropped.
     */
    fit?: 'cover' | 'contain';
    /** Apply an explicit source crop instead of exposing the complete picture box. */
    useCrop?: boolean;
  }

  let { artwork, background, fit = 'cover', useCrop = true }: Props = $props();

  let sourceAspect = $state(1);

  const layout = $derived(
    artLayout(useCrop ? artwork : { ...artwork, crop: FULL_CROP })
  );
  const mask = $derived(artMaskCss(artwork.effects));
  const present = $derived(hasArtwork(artwork));

  function readSourceAspect(event: Event): void {
    const image = event.currentTarget as HTMLImageElement;
    sourceAspect = image.naturalWidth > 0 && image.naturalHeight > 0
      ? image.naturalWidth / image.naturalHeight
      : 1;
  }
</script>

<div class="art" style:background>
  {#if present && artwork.source}
    <div
      class="clip"
      style:mask-image={mask ?? undefined}
      style:-webkit-mask-image={mask ?? undefined}
    >
      <img
        src={artwork.source}
        alt=""
        draggable="false"
        class:full-source={!useCrop}
        class:cover={!useCrop && fit === 'cover'}
        class:contain={!useCrop && fit === 'contain'}
        onload={readSourceAspect}
        style:--source-aspect={sourceAspect}
        style:object-fit={useCrop ? fit : undefined}
        style:width={useCrop ? layout.width : undefined}
        style:height={useCrop ? layout.height : undefined}
        style:left={useCrop ? layout.left : undefined}
        style:top={useCrop ? layout.top : undefined}
        style:transform={useCrop ? layout.transform : undefined}
        style:--art-transform={layout.transform}
        style:filter={layout.filter}
        style:opacity={layout.opacity}
      />
    </div>

    {#if artwork.effects.vignette > 0}
      <div class="vignette" style:--vignette={artwork.effects.vignette}></div>
    {/if}
  {/if}
</div>

<style>
  .art {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }

  .clip {
    position: absolute;
    inset: 0;
    container-type: size;
    mask-size: 100% 100%;
    -webkit-mask-size: 100% 100%;
  }

  /* The crop rectangle is scaled up so the visible slice fills the window.
     `cover` keeps the source ratio intact even when an older document still
     carries the full, window-shaped crop rectangle. */
  .clip img {
    position: absolute;
    object-fit: cover;
    max-width: none;
    transform-origin: center;
    /*
     * An <img> is draggable by default in every browser -- the browser's own
     * "drag this picture out" gesture fires on the same mousedown-then-move
     * ArtworkPanel's pointer-based reposition drag listens for, and wins:
     * the image nudges a pixel or two, then the cursor shows the browser's
     * own "nothing here accepts a drop" icon and the rest of the gesture is
     * swallowed by native drag-and-drop instead of reaching `pointermove`.
     * `draggable="false"` on the element is the primary fix; Safari also
     * wants the CSS property.
     */
    -webkit-user-drag: none;
  }

  /* A full-source image owns a real, native-ratio box. The card opening only
     clips that box; it never crops inside or reshapes the source itself. */
  .clip img.full-source {
    top: 50%;
    left: 50%;
    height: auto;
    object-fit: fill;
    transform: translate(-50%, -50%) var(--art-transform);
  }

  .clip img.full-source.cover {
    width: max(100cqw, calc(100cqh * var(--source-aspect)));
  }

  .clip img.full-source.contain {
    width: min(100cqw, calc(100cqh * var(--source-aspect)));
  }

  .vignette {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(
      ellipse 78% 78% at center,
      transparent 40%,
      rgb(0 0 0 / calc(var(--vignette) * 0.9)) 100%
    );
  }
</style>
