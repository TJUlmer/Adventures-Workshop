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
import type { Character, HeroCharacterCard } from '$lib/characters/types';
import type { AdventureMap } from '$lib/map/types';
import { mapPrintWidth } from '$lib/map/types';
import {
  loadPatternSource,
  loadRasterSource,
  loadRecolouredRasterSource,
  loadSvgSource,
  MAP_ASSETS
} from '$lib/renderer/assets';
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
  /**
   * Draw this hero's character card instead of a card.
   *
   * Photographs the composed sheet *and* a finished replacement image without
   * branching, because `HeroCharacterCardFace` resolves its own
   * `useReplacement` internally — unlike an ordinary card, whose replacement
   * `CardRenderer` short-circuits before reaching any face.
   */
  statCard?: Character | null;
  /** Which of `statCard`'s identities to draw. Its own fields when absent. */
  statCardEntry?: HeroCharacterCard | null;
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
        statCard: job.statCard ?? null,
        statCardEntry: job.statCardEntry ?? null,
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
  options: { width?: number; customSymbols?: CustomSymbol[] } = {}
): Promise<Blob | null> {
  if (!map.enabled) return null;

  /*
   * Every zone pattern this map's spaces could actually show, fetched
   * *before* `MapBoard` ever mounts — the same reasoning as `renderWidth`
   * just below, and caught the same way: a real export photographed with a
   * zone's pattern missing, because `MapBoard`'s own fetch (kicked off from
   * an `$effect`, necessarily after mount) had not resolved by the time
   * `rasterise()` cloned the DOM a single `await tick()` later, despite the
   * identical map showing the pattern correctly on screen moments after.
   * `loadPatternSource` is a shared, cached fetch, so a name already warm —
   * every previous export, and the live editor once an author has opened
   * it — resolves this `Promise.all` on the spot.
   */
  await Promise.all(
    map.zoneStyles
      .map((zone) => zone.patternName)
      .filter((name): name is string => name !== null)
      .map((name) => loadPatternSource(name))
  );
  if (map.paths.some((path) => path.largeFighter)) {
    await loadSvgSource(MAP_ASSETS.largeFighterPin);
  }
  if (map.paths.some((path) => path.oneWay)) {
    const oneWayAssets = new Set<string>();
    for (const path of map.paths) {
      if (!path.oneWay) continue;
      oneWayAssets.add(MAP_ASSETS.oneWayArrowhead);
      if (path.modifier) {
        oneWayAssets.add(MAP_ASSETS.oneWayArrowModifier);
        oneWayAssets.add(MAP_ASSETS.oneWayArrowModifierText);
      }
    }
    await Promise.all([...oneWayAssets].map((url) => loadRasterSource(url)));
  }
  const symbols = options.customSymbols ?? [];
  await Promise.all(
    map.spaces.flatMap((space) => {
      const passage = space.secretPassage;
      if (!passage) return [];
      const hasCustomSymbol = symbols.some((symbol) => symbol.id === passage.symbolId);
      const requests = [
        loadRecolouredRasterSource(MAP_ASSETS.secretPassageRing, passage.color)
      ];
      if (!hasCustomSymbol) {
        requests.push(
          loadRecolouredRasterSource(
            MAP_ASSETS.secretPassageKeyhole,
            map.pathColor,
            map.pathColor,
            'dark-only'
          )
        );
      }
      return requests;
    })
  );

  const width = mapPrintWidth(map);
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${width}px;pointer-events:none`;
  document.body.append(host);

  /*
   * `renderWidth` passed explicitly rather than left for `MapBoard` to
   * measure off its own mounted DOM — it already sizes `host` to this exact
   * width above, so it already knows the answer. `MapBoard`'s own
   * `ResizeObserver`-based measurement (for the on-screen editor, which has
   * no such prop to hand it) needs an extra effect cycle to settle, and a
   * single `await tick()` is not guaranteed to cover it — confirmed by
   * capturing the actual markup this function fed to the rasteriser and
   * finding the path glow's blur frozen at `0px`, despite the same
   * measurement reading correctly moments later once something else (a
   * `setTimeout`, an intercepted property access) happened to buy it a
   * little more time. Passing the width in sidesteps the race instead of
   * papering over it.
   */
  const view = mount(MapBoard, {
    target: host,
    props: { map, customSymbols: options.customSymbols ?? [], renderWidth: width }
  });

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
