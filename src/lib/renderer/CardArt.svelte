<script lang="ts">
  /**
   * The artwork layer: crop, transform, colour grade and edge mask.
   * Shared by every card template so all of them treat art identically.
   */
  import type { Artwork } from '$lib/core/artwork';
  import { artLayout, artMaskCss, hasArtwork } from '$lib/core/artwork';

  interface Props {
    artwork: Artwork;
    /** Background shown where the art does not reach. */
    background: string;
    /**
     * How the picture meets its window.
     *
     * `fill` by default and for every card: the crop rectangle is expected to
     * carry the window's aspect ratio, so stretching it is a no-op and the
     * transform layer handles any deliberate distortion. `contain` is for the
     * places where the picture's own shape has to survive — a logo dropped on
     * a square plate should letterbox rather than be squashed into it.
     */
    fit?: 'fill' | 'contain';
  }

  let { artwork, background, fit = 'fill' }: Props = $props();

  const layout = $derived(artLayout(artwork));
  const mask = $derived(artMaskCss(artwork.effects));
  const present = $derived(hasArtwork(artwork));
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
        style:object-fit={fit}
        style:width={layout.width}
        style:height={layout.height}
        style:left={layout.left}
        style:top={layout.top}
        style:transform={layout.transform}
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
    mask-size: 100% 100%;
    -webkit-mask-size: 100% 100%;
  }

  /*
   * The crop rectangle is scaled up so the visible slice fills the window;
   * `fill` is correct here because the crop is expected to carry the window's
   * aspect ratio, and the transform layer handles any deliberate distortion.
   */
  .clip img {
    position: absolute;
    object-fit: fill;
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
