<script lang="ts">
  import type { CustomPatternStyle, PatternStyle } from '$lib/cards/style';
  import { customPatternFilter } from '$lib/cards/style';
  import { patternAspect } from './assets';

  interface Props {
    pattern: PatternStyle;
    customPattern: CustomPatternStyle;
    /** Percentage of this surface's width at the neutral image scale. */
    customWidth?: number;
  }

  let { pattern, customPattern, customWidth = 70 }: Props = $props();
</script>

{#if pattern.name}
  <div
    class="pattern"
    style:--pattern-url="url('/assets/patterns/{pattern.name}.svg')"
    style:--pattern-scale={pattern.scale}
    style:--pattern-aspect={patternAspect(pattern.name)}
    style:background={pattern.color}
    style:opacity={pattern.opacity}
  ></div>
{/if}

{#if customPattern.source}
  <!--
    `left`/`top` are percentages of this element's own *containing
    block* (the body or ribbon fill), but `cqw` is a percentage of the nearest
    container-query ancestor, which is the whole plate —
    two different reference widths in what looked like one `calc()`.
    At `.body` narrower than the plate (the usual case) the two only
    happened to roughly agree at a small scale; past it, growing
    `scale` shrank the `100% - 70cqw*scale` slack term against the
    wrong (smaller) width, so the image raced past `.body`'s own
    bounds and the offset math pushed it visibly sideways well before
    the slider neared its own maximum.

    Fixed by never mixing the two: `width` is a percentage of its surface
    alone, `aspect-ratio: 1` derives a matching height without a
    second, height-relative percentage to keep in step with it, and
    `left`/`top` position the `offsetX`/`offsetY` point of the surface
    itself, with `translate()` pulling the image back by that same
    fraction of its *own* rendered box (a percentage in `transform`
    resolves against the element, not the container) — the standard
    anchor-point trick, and unlike the old subtraction it never needs
    to know the image's absolute size to stay centred.
  -->
  <img
    class="custom-pattern"
    src={customPattern.source}
    alt=""
    style:width="calc({customWidth}% * {customPattern.scale})"
    style:aspect-ratio="1"
    style:left="{(customPattern.offsetX * 100).toFixed(3)}%"
    style:top="{(customPattern.offsetY * 100).toFixed(3)}%"
    style:transform="translate({(-customPattern.offsetX * 100).toFixed(3)}%, {(
      -customPattern.offsetY * 100
    ).toFixed(3)}%) rotate({customPattern.rotation}deg)"
    style:opacity={customPattern.opacity}
    style:filter={customPatternFilter(customPattern)}
  />
{/if}

<style>
  /*
   * The tile is sized from the file's own proportions. An SVG asked for a
   * shape that is not its own letterboxes rather than stretching, so a square
   * tile size opens transparent gaps in every pattern that is not square.
   */
  .pattern {
    position: absolute;
    inset: 0;
    --pattern-tile: calc(6cqw * var(--pattern-scale));
    mask-image: var(--pattern-url);
    -webkit-mask-image: var(--pattern-url);
    mask-size: var(--pattern-tile) calc(var(--pattern-tile) * var(--pattern-aspect));
    -webkit-mask-size: var(--pattern-tile) calc(var(--pattern-tile) * var(--pattern-aspect));
    mask-repeat: repeat;
    -webkit-mask-repeat: repeat;
    pointer-events: none;
  }

  /*
   * A real `<img>` rather than a `background-image`, sized and positioned to
   * its own box (not `inset: 0`) — `transform: translate()`'s percentages
   * resolve against the element's own box, which is what lets it recentre
   * without knowing its own size, and rotation's default origin is the same
   * box's centre, so it spins the picture in place rather than swinging it
   * around the whole panel.
   *
   * `aspect-ratio: 1` keeps the box square (`scale` is uniform) without a
   * second, height-relative percentage to keep in step with `width`'s — see
   * the markup's own comment. `object-fit: contain`, not `fill`, is what
   * keeps a non-square picture from being squashed into that square box: it
   * letterboxes inside it, preserving its own proportions, the same job
   * `background-size: <width> auto` did before rotation forced a switch away
   * from `background-image`.
   *
   * `max-width: none` overrides the global `img { max-width: 100% }` reset
   * (`base.css`) — the same fix `CardArt.svelte`'s own `.clip img` already
   * needed. Without it, `scale` past roughly 1.4 kept computing a wider
   * `width`, but the image itself silently stopped growing at exactly 100%
   * of `.body`, capped rather than rendered — indistinguishable, at a
   * glance, from the slider simply not doing anything past that point.
   */
  .custom-pattern {
    position: absolute;
    max-width: none;
    object-fit: contain;
    pointer-events: none;
  }

</style>
