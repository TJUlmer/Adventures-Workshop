<script lang="ts">
  /**
   * One screenshot with its annotations drawn over it.
   *
   * The picture is clean and every box and caption here is data — see
   * `guides/types.ts` for why. What that buys, concretely: a hotspot is
   * positioned in percentages of this element, so it stays on its target at
   * any width the modal happens to have, and its caption is real text, so it
   * takes the app's own type, colour and theme rather than being a bitmap of
   * a font at one fixed size.
   *
   * **The frame takes the picture's own aspect ratio, and that is load-bearing
   * rather than tidy.** A hotspot is a fraction of *this element*, so the
   * element has to be exactly where the picture is: leave it at some default
   * shape and `object-fit: contain` letterboxes the image inside it, at which
   * point every box is measured against the frame and lands somewhere the
   * picture is not. A portrait screenshot in a landscape frame put a hotspot
   * meant for a 245px-wide sidebar row across the full width of the dialog.
   *
   * Which is why the aspect is read on mount as well as on `load`. An image
   * that is already in the cache — the second time a guide is opened, and
   * every step you go *back* to — is `complete` before this component exists,
   * so its `load` event has already been and gone and the handler never runs.
   * That failure is invisible on a first read and appears on the second.
   */
  import type { GuideHotspot } from '$lib/guides/types';
  import { shotUrl } from '$lib/guides/types';

  interface Props {
    shot: string;
    alt: string;
    hotspots?: readonly GuideHotspot[];
  }

  let { shot, alt, hotspots = [] }: Props = $props();

  /** Roughly a wide app window, which is what most shots will be. */
  const DEFAULT_ASPECT = 16 / 10;

  /**
   * How tall a shot may get. A portrait screenshot — a sidebar, most often —
   * would otherwise be `width: 100%` times its own aspect and run well past
   * the dialog; capped by height, its width follows instead and it sits
   * centred with the copy above it still in view.
   */
  const MAX_HEIGHT = '46vh';

  let image = $state<HTMLImageElement | null>(null);
  let aspect = $state(DEFAULT_ASPECT);

  function measure(): void {
    if (!image || image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
    aspect = image.naturalWidth / image.naturalHeight;
  }

  /*
   * Re-run whenever the file changes — and read `complete` rather than
   * waiting on `load`, which a cached image has already fired. Falls back to
   * `DEFAULT_ASPECT` while a shot really is still arriving, so the frame does
   * not collapse in the meantime.
   */
  $effect(() => {
    void shot;
    if (image?.complete) measure();
    else aspect = DEFAULT_ASPECT;
  });

  const pct = (value: number): string => `${(value * 100).toFixed(3)}%`;

  /**
   * Which side a caption sits on when the step does not say.
   *
   * Whichever side of the box has the most room — below if the box is high on
   * the shot, above if it is low, and to the side for a box that is tall and
   * narrow. Crude on purpose: a step that cares says so.
   */
  function side(spot: GuideHotspot): 'top' | 'right' | 'bottom' | 'left' {
    if (spot.labelSide) return spot.labelSide;
    if (spot.h > spot.w * 1.5) return spot.x > 0.5 ? 'left' : 'right';
    return spot.y + spot.h < 0.6 ? 'bottom' : 'top';
  }
</script>

<figure
  class="shot"
  style:aspect-ratio={aspect}
  style:width="min(100%, calc({MAX_HEIGHT} * {aspect}))"
>
  <img bind:this={image} src={shotUrl(shot)} {alt} onload={measure} />

  {#each hotspots as spot, index (index)}
    <span
      class="hotspot"
      style:left={pct(spot.x)}
      style:top={pct(spot.y)}
      style:width={pct(spot.w)}
      style:height={pct(spot.h)}
      aria-hidden="true"
    >
      {#if spot.label}
        <span class="label {side(spot)}">{spot.label}</span>
      {/if}
    </span>
  {/each}
</figure>

<style>
  .shot {
    position: relative;
    /* `width` is inline — it depends on the measured aspect. Centred, because
       a portrait shot capped by height is narrower than the dialog. */
    margin-inline: auto;
    overflow: hidden;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--surface-canvas);
  }

  .shot img {
    display: block;
    width: 100%;
    height: 100%;
    /*
     * `contain`, not `cover`: the frame takes the picture's own aspect once it
     * has loaded, so the two agree — but a shot that has not loaded yet, or
     * one whose proportions could not be read, must letterbox rather than
     * crop. A cropped screenshot silently loses the very thing a hotspot is
     * pointing at.
     */
    object-fit: contain;
  }

  .hotspot {
    position: absolute;
    border: 2px solid var(--accent);
    border-radius: var(--radius-sm);
    /* Dimming everything else rather than tinting the box: the point of a
       hotspot is what is *inside* it, and a wash over that is the one place a
       highlight must not go. A huge spread on a transparent-backed box is the
       cheapest way to paint the whole rest of the shot at once. */
    box-shadow:
      0 0 0 3px color-mix(in oklab, var(--accent) 30%, transparent),
      0 0 0 9999px color-mix(in oklab, var(--surface-canvas) 55%, transparent);
    pointer-events: none;
  }

  .label {
    position: absolute;
    width: max-content;
    max-width: 220px;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--text-on-accent);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    line-height: 1.35;
    text-wrap: balance;
  }

  /*
   * Centred on the box's own axis and pushed clear of it. `max-content` with
   * a `max-width` means a short caption is a chip and a long one wraps,
   * without either needing a width in the content file.
   */
  .label.bottom {
    top: calc(100% + var(--space-2));
    left: 50%;
    translate: -50% 0;
  }

  .label.top {
    bottom: calc(100% + var(--space-2));
    left: 50%;
    translate: -50% 0;
  }

  .label.right {
    left: calc(100% + var(--space-2));
    top: 50%;
    translate: 0 -50%;
  }

  .label.left {
    right: calc(100% + var(--space-2));
    top: 50%;
    translate: 0 -50%;
  }
</style>
