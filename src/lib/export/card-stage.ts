/**
 * Somewhere to photograph cards that are not on screen.
 *
 * The renderer needs a live element to rasterise, and an export runs from Home,
 * where no cards are mounted. So each one is mounted off-screen, photographed
 * and thrown away. That is slower than reading the document alone, and it is
 * the point: it is the *same* renderer the preview uses, so an export cannot
 * drift from what the author approved.
 *
 * Off-screen rather than hidden — `display: none` does not lay out, and a card
 * that has not laid out has nothing to measure.
 */
import { mount, tick, unmount } from 'svelte';
import type { CardTheme } from '$lib/cards/style';
import type { Card } from '$lib/cards/types';
import { characterLabel } from '$lib/characters/factory';
import type { Character } from '$lib/characters/types';
import type { AdventureMap } from '$lib/map/types';
import { mapPrintWidth } from '$lib/map/types';
import CardRenderer from '$lib/renderer/CardRenderer.svelte';
import type { CustomSymbol } from '$lib/symbols/types';
import MapBoard from '$lib/renderer/MapBoard.svelte';
import ThreatBoard from '$lib/renderer/ThreatBoard.svelte';
import type { CardFormat } from '$lib/renderer/geometry';
import { THREAT_TRACK } from '$lib/renderer/geometry';
import type { AdventureSet } from '$lib/sets/types';
import { renderMapImage, renderPlateImage, renderThreatTrackImage } from './card-image';
import type { CardImageOptions } from './card-image';

export interface StageJob {
  card: Card | null;
  /** Owning character, for the name ribbon. */
  character?: Character | null;
  /** Draw this character's deck back instead of a card. */
  cardback?: Character | null;
  theme?: CardTheme;
  /** Which face of a two-sided card. Only event cards have both. */
  side?: 'front' | 'back';
  customSymbols?: CustomSymbol[];
}

/** Returns `null` when the renderer drew nothing to photograph. */
export type Photograph = (
  job: StageJob,
  format: CardFormat,
  options: CardImageOptions
) => Promise<Blob | null>;

export async function withCardStage<T>(run: (photograph: Photograph) => Promise<T>): Promise<T> {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;width:420px;pointer-events:none';
  document.body.append(host);

  // Text is placed from the loaded faces; a fallback would misplace every line.
  await document.fonts.ready;

  const photograph: Photograph = async (job, format, options) => {
    const slot = document.createElement('div');
    host.append(slot);

    const view = mount(CardRenderer, {
      target: slot,
      props: {
        card: job.card,
        character: job.character ?? null,
        cardback: job.cardback ?? null,
        theme: job.theme,
        side: job.side ?? 'front',
        customSymbols: job.customSymbols ?? [],
        options: { showBleed: true, showGuides: false }
      }
    });

    try {
      await tick();
      const plate = slot.querySelector<HTMLElement>('.plate');
      return plate ? await renderPlateImage(plate, format, options) : null;
    } finally {
      unmount(view);
      slot.remove();
    }
  };

  try {
    return await run(photograph);
  } finally {
    host.remove();
  }
}

/**
 * The map, photographed off-screen like the threat board.
 *
 * `MapBoard` is already read-only — the editor lays its handles *over* it
 * rather than inside it — so unlike the threat board there is no `editable`
 * flag to turn off. It is still mounted fresh here rather than photographed
 * from the page, because an export must not depend on the map page being the
 * one currently open.
 */
export async function photographMapBoard(
  map: AdventureMap,
  options: { width?: number } = {}
): Promise<Blob | null> {
  if (!map.enabled) return null;

  const width = mapPrintWidth(map);
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${width}px;pointer-events:none`;
  document.body.append(host);

  const view = mount(MapBoard, { target: host, props: { map } });

  try {
    await tick();
    const board = host.firstElementChild as HTMLElement | null;
    return board ? await renderMapImage(board, map.aspect, width, options) : null;
  } finally {
    unmount(view);
    host.remove();
  }
}

/**
 * The threat board, photographed off-screen like the cards.
 *
 * Mounted read-only. The editor's fields and buttons are affordances rather
 * than part of the board, and a form control's text is a property that does not
 * survive `cloneNode` — a board rasterised from the editing view would come out
 * wearing its placeholders.
 */
export async function photographThreatBoard(
  set: AdventureSet,
  options: { width?: number } = {}
): Promise<Blob | null> {
  const villain = set.characters.find((character) => character.id === set.threat.villainId);

  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${THREAT_TRACK.bleed.width}px;pointer-events:none`;
  document.body.append(host);

  const view = mount(ThreatBoard, {
    target: host,
    props: {
      track: set.threat,
      villainName: villain ? characterLabel(villain) : '',
      editable: false
    }
  });

  try {
    await tick();
    const board = host.firstElementChild as HTMLElement | null;
    return board ? await renderThreatTrackImage(board, options) : null;
  } finally {
    unmount(view);
    host.remove();
  }
}
