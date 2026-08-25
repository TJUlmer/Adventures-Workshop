/**
 * Guides: short, step-by-step walkthroughs of one thing the app does.
 *
 * Content, not code. A guide is a plain data object — a title, an icon, and
 * three to six steps, each one short explanation beside one screenshot — so
 * writing a new guide is editing `content.ts` and dropping images into
 * `public/assets/guides/`, never touching a component.
 *
 * The two decisions that shape everything here:
 *
 * **The screenshots are clean, and every annotation is data.** A step's
 * `hotspots` are fractions of the image, drawn as boxes and callouts by
 * `GuideShot`. The alternative — arrows painted into the picture — needs an
 * image editor for every wording change, cannot follow the app's own theme,
 * and turns illegible on a narrow window, because text baked into a bitmap
 * scales with the bitmap. Fractions rather than pixels for the same reason:
 * the shot is displayed at whatever width the modal has, and a hotspot
 * measured in source pixels would drift the moment it is not shown 1:1.
 *
 * **A step's action is a *name*, not a function.** `GuideAction.run` is one
 * of a small closed set that `GuideModal` resolves to a real handler. Content
 * that reached into the store directly would make this file depend on half
 * the app, and would make a typo in a guide a runtime crash inside a modal.
 */
import type { SetPage } from '$lib/state/navigation.svelte';
import type { IconName } from '$lib/ui/Icon.svelte';

/** Stable id. Used in URLs of nothing, but it keys "which guide is open". */
export type GuideId = string;

/**
 * A region of a screenshot worth pointing at.
 *
 * All four numbers are fractions of the *image*, 0..1 — `x`/`w` of its width,
 * `y`/`h` of its height. Unlike the card renderer's own geometry (where `y`
 * is measured against the width so a circle stays a circle), a hotspot is a
 * rectangle over a rectangle and both axes are independent.
 */
export interface GuideHotspot {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /**
   * Optional caption beside the box. Left off when the step's own text
   * already says what the box is, which is most of the time — two sentences
   * saying the same thing in different places is worse than one.
   */
  readonly label?: string;
  /**
   * Which side of the box the label sits on. Defaults to whichever side has
   * more room, which is right for nearly every shot; set it when the
   * automatic choice collides with something.
   */
  readonly labelSide?: 'top' | 'right' | 'bottom' | 'left';
}

/**
 * What a guide's last step can offer to *do*, beyond closing.
 *
 * Deliberately a closed union rather than a callback. Every entry is a
 * navigation the app already has, because that is what a guide can honestly
 * promise from inside a modal: it cannot know whether a set is open, which
 * one, or whether the visitor is signed in.
 */
export type GuideActionKind =
  | { readonly to: 'gallery' }
  | { readonly to: 'home' }
  /** A page inside the open set. Ignored, with the button hidden, if none is. */
  | { readonly to: 'setPage'; readonly page: SetPage };

export interface GuideAction {
  readonly label: string;
  readonly run: GuideActionKind;
}

export interface GuideStep {
  /**
   * One short explanation. One — a step that needs two paragraphs is two
   * steps, and a guide that needs seven steps is two guides.
   */
  readonly text: string;
  /**
   * Screenshot, relative to `public/assets/guides/`. Absent is allowed and
   * means a text-only step, which a first or last step sometimes wants.
   */
  readonly shot?: string;
  /** Alt text. Required whenever `shot` is set — see `GuideShot`. */
  readonly alt?: string;
  readonly hotspots?: readonly GuideHotspot[];
}

export interface Guide {
  readonly id: GuideId;
  readonly title: string;
  /** One line, shown on the Home card beside the title. */
  readonly summary: string;
  readonly icon: IconName;
  readonly steps: readonly GuideStep[];
  /** Offered on the last step, beside "Got it". */
  readonly action?: GuideAction;
}

/** Where a guide's screenshots are served from. See `renderer/assets.ts`. */
export const GUIDE_SHOTS = '/assets/guides';

export function shotUrl(shot: string): string {
  return `${GUIDE_SHOTS}/${shot}`;
}
