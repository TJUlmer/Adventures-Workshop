/**
 * Which guide is open, and how far through it the reader is.
 *
 * Its own store rather than a `View` in `navigation.svelte.ts`, because a
 * guide is not a place — it is an overlay *on* wherever you already are, and
 * closing it has to put you back exactly there. Folding it into `View` would
 * mean every guide had to remember and restore the view underneath it, which
 * is `openAuthor`'s `#returnTo` problem for no benefit.
 *
 * App-level rather than local to `HomeScreen`, and that is the point: half
 * the topics worth writing a guide about ("adding multiple decks", "custom
 * symbols") are things an author is in the middle of doing *inside* a set,
 * where Home is nowhere to be seen. Home is the first place a guide opens
 * from, not the only one — `GuideModal` is mounted once in `App.svelte`, so
 * anything anywhere can call `guides.open(id)` and get the same overlay.
 */
import { GUIDES } from '$lib/guides/content';
import type { Guide, GuideId } from '$lib/guides/types';

class Guides {
  /** The open guide, or null. */
  #id = $state<GuideId | null>(null);
  /** Zero-based, so `index + 1` is what the reader is shown. */
  #index = $state(0);
  /**
   * Bumped by every `open`, and read by `GuideModal`'s effect purely so that
   * opening is never a no-op.
   *
   * Without it, `open(id)` on the guide that is *already* the open one
   * changes no state, so the effect does not re-run and `showModal()` is
   * never called — and if the element has been closed in the meantime by
   * anything that did not route through `close()`, the guide can never be
   * opened again. The element and the store are supposed to be unable to
   * disagree; this is what makes that true in the one direction the state
   * alone cannot express, since "is the dialog showing" is a DOM property
   * and nothing reactive can read it.
   */
  #opened = $state(0);

  readonly guide = $derived<Guide | null>(
    this.#id === null ? null : (GUIDES.find((entry) => entry.id === this.#id) ?? null)
  );

  readonly index = $derived(this.#index);
  /** See `#opened`. Meaningless on its own — read it to depend on it. */
  readonly opened = $derived(this.#opened);
  readonly step = $derived(this.guide?.steps[this.#index] ?? null);
  readonly total = $derived(this.guide?.steps.length ?? 0);
  readonly isFirst = $derived(this.#index === 0);
  readonly isLast = $derived(this.guide !== null && this.#index >= this.guide.steps.length - 1);

  /**
   * Always from the top. A guide is short enough that resuming halfway would
   * be more confusing than helpful — and the Home card's whole promise is
   * "this opens at step 1".
   */
  open(id: GuideId): void {
    this.#id = id;
    this.#index = 0;
    this.#opened += 1;
  }

  close(): void {
    this.#id = null;
    this.#index = 0;
  }

  next(): void {
    if (this.guide === null) return;
    this.#index = Math.min(this.#index + 1, this.guide.steps.length - 1);
  }

  back(): void {
    this.#index = Math.max(this.#index - 1, 0);
  }

  /** Jump straight to a step. What the progress dots call. */
  goto(index: number): void {
    if (this.guide === null) return;
    this.#index = Math.max(0, Math.min(index, this.guide.steps.length - 1));
  }
}

export const guides = new Guides();
