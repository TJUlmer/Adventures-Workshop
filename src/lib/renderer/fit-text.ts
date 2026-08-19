/**
 * Shrink-to-fit for author-length text inside a fixed box.
 *
 * The rest of this renderer deliberately never measures text at runtime —
 * see "Geometry is measured, not estimated" in CLAUDE.md — but that rule is
 * about not re-deriving *template geometry* by measuring instead of reading
 * it off the art. It has nothing to say about content-driven sizing, and CSS
 * has no primitive for "shrink until my own content stops overflowing me":
 * that is why libraries like FitText.js exist as a runtime technique in the
 * first place. This is the one narrow, deliberate exception, kept as cheap
 * as the problem allows: a synchronous measure step that runs only when the
 * content driving a box actually changes, never on a frame or resize.
 */

export interface FitTextOptions {
  /** Floor scale, as a fraction of the natural size. */
  min?: number;
  /** How much to give up per iteration. */
  step?: number;
}

/**
 * Shrinks `--fit-scale` on `element` until its content (`scrollHeight`) fits
 * its own allocated box (`clientHeight`), or `min` is reached.
 *
 * Written straight to the DOM in a synchronous loop rather than through
 * reactive state: reading `scrollHeight` forces a synchronous reflow, so
 * each iteration sees the previous write's real layout, and the whole thing
 * resolves before the caller returns — well before `card-stage.ts`'s export
 * mount awaits `tick()`, which flushes Svelte's own effect queue but not a
 * `ResizeObserver` callback or anything behind a further microtask. Going
 * through `$state` here would have raced that export.
 *
 * Always resets to 1 first, so content that got shorter recovers its full
 * size rather than staying shrunk from a previous, longer version.
 */
export function fitScale(
  element: HTMLElement,
  { min = 0.7, step = 0.02 }: FitTextOptions = {}
): void {
  let scale = 1;
  element.style.setProperty('--fit-scale', '1');
  while (element.scrollHeight > element.clientHeight + 0.5 && scale > min) {
    scale = Math.max(min, scale - step);
    element.style.setProperty('--fit-scale', String(scale));
  }
}
