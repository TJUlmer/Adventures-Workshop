/**
 * The 1200 × 630 picture attached to a shared set's link preview.
 *
 * Every scope uses one poster shape. Authored card colours, artwork and type
 * make it belong to the set; the composition changes to introduce one hero,
 * present a hero roster, or stage an adventure's opposing sides.
 */
import type { CardTheme, Fill } from '$lib/cards/style';
import { resolveCardTheme } from '$lib/cards/theme';
import { characterLabel } from '$lib/characters/factory';
import type { Character } from '$lib/characters/types';
import type { Artwork } from '$lib/core/artwork';
import type { Photograph } from '$lib/export/card-stage';
import { withCardStage } from '$lib/export/card-stage';
import type { Figure } from '$lib/figures/types';
import { loadFigurePreview, releaseFigurePreview } from '$lib/components/tools/figure-preview';
import { renderMeshSnapshot } from '$lib/models/snapshot';
import { displayFontStack, displayFontWeight, fitDisplaySize } from '$lib/renderer/fonts';
import { CARD_FORMATS } from '$lib/renderer/geometry';
import { charactersByRole, setStats } from '$lib/sets/queries';
import type { AdventureSet } from '$lib/sets/types';
import { coverArtwork, renderThumbnail } from './thumbnail';

const POSTER_WIDTH = 1200;
const POSTER_HEIGHT = 630;
const SOURCE_CARD_WIDTH = 420;
const QUALITY = 0.85;
const MAX_HEROES = 4;
const CARD_RATIO = CARD_FORMATS.action.mm.height / CARD_FORMATS.action.mm.width;
const COPY_FONT = `'Oswald Custom Junior', 'Haettenschweiler', 'Arial Narrow', sans-serif`;
const JUNIOR_MEAN_ADVANCE = 0.4322;
const SINGLE_HERO_ABILITY_FONT_SIZE = 25;
const SINGLE_HERO_ABILITY_LINE_HEIGHT = 24;
const SINGLE_HERO_DETAILS_BOTTOM = 532;

type PosterKind = 'single-hero' | 'hero-set' | 'adventure';

interface CardPlacement {
  x: number;
  y: number;
  width: number;
  angle: number;
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', QUALITY));
}

function canvasFill(
  context: CanvasRenderingContext2D,
  fill: Fill,
  x: number,
  y: number,
  width: number,
  height: number
): string | CanvasGradient {
  if (fill.kind === 'solid') return fill.color;
  const radians = (fill.angle * Math.PI) / 180;
  const directionX = Math.sin(radians);
  const directionY = -Math.cos(radians);
  const reach = (Math.abs(directionX) * width + Math.abs(directionY) * height) / 2;
  const centreX = x + width / 2;
  const centreY = y + height / 2;
  const gradient = context.createLinearGradient(
    centreX - directionX * reach,
    centreY - directionY * reach,
    centreX + directionX * reach,
    centreY + directionY * reach
  );
  gradient.addColorStop(0, fill.color);
  gradient.addColorStop(1, fill.color2);
  return gradient;
}

function paintFill(
  context: CanvasRenderingContext2D,
  fill: Fill,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  context.fillStyle = canvasFill(context, fill, x, y, width, height);
  context.fillRect(x, y, width, height);
}

/** Settles either way: a broken remote picture must not hang a publish. */
function settled(image: HTMLImageElement): Promise<boolean> {
  if (image.complete) return Promise.resolve(image.naturalWidth > 0);
  return new Promise((resolve) => {
    image.addEventListener('load', () => resolve(true), { once: true });
    image.addEventListener('error', () => resolve(false), { once: true });
  });
}

async function loadArtwork(artwork: Artwork | null): Promise<HTMLImageElement | null> {
  if (!artwork?.source) return null;
  return loadImageSource(artwork.source);
}

async function loadImageSource(source: string): Promise<HTMLImageElement | null> {
  const image = new Image();
  if (/^https?:/i.test(source)) image.crossOrigin = 'anonymous';
  image.src = source;
  return (await settled(image)) ? image : null;
}

/** Draw an image edge-to-edge without distorting it. */
function drawCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const sourceRatio = image.naturalWidth / image.naturalHeight;
  const targetRatio = width / height;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = image.naturalWidth;
  let sourceHeight = image.naturalHeight;
  if (sourceRatio > targetRatio) {
    sourceWidth = image.naturalHeight * targetRatio;
    sourceX = (image.naturalWidth - sourceWidth) / 2;
  } else {
    sourceHeight = image.naturalWidth / targetRatio;
    sourceY = (image.naturalHeight - sourceHeight) / 2;
  }
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height
  );
}

function primaryFamily(stack: string): string | null {
  return stack.match(/['\"]([^'\"]+)['\"]/)?.[1] ?? null;
}

async function loadPosterFonts(theme: CardTheme): Promise<void> {
  const families = [primaryFamily(displayFontStack(theme.displayFont)), 'Oswald Custom Junior'];
  await Promise.all(
    families.map((family) =>
      family ? document.fonts.load(`100px '${family}'`).catch(() => []) : Promise.resolve([])
    )
  );
  await document.fonts.ready;
}

/** Split a display heading without runtime text measurement. */
function balancedTitleLines(text: string): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2 || text.length <= 15) return [text.trim()];
  let best = 1;
  let bestWidth = Number.POSITIVE_INFINITY;
  for (let split = 1; split < words.length; split += 1) {
    const width = Math.max(
      words.slice(0, split).join(' ').length,
      words.slice(split).join(' ').length
    );
    if (width < bestWidth) {
      best = split;
      bestWidth = width;
    }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

function clipped(text: string, length: number): string {
  const value = text.trim();
  return value.length <= length ? value : `${value.slice(0, length - 1).trimEnd()}…`;
}

function plural(count: number, singular: string, pluralForm = `${singular}S`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Copy-font wrapping from the bundled face's recorded mean advance, not a
    runtime canvas measurement. Authored newlines remain paragraph breaks. */
function wrappedCopy(text: string, width: number, fontSize: number, maxLines: number): string[] {
  const maxCharacters = Math.max(8, Math.floor(width / (fontSize * 0.44)));
  const lines: string[] = [];

  for (const paragraph of text.trim().split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && next.length > maxCharacters) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
  }

  if (lines.length <= maxLines) return lines;
  const visible = lines.slice(0, maxLines);
  const last = visible.length - 1;
  visible[last] = `${(visible[last] ?? '').slice(0, maxCharacters - 1).trimEnd()}…`;
  return visible;
}

/** Inline card symbols have no canvas equivalent here, so name them in plain
    language; `{{name}}` still follows the hero when the roster is renamed. */
function readableAbilityText(text: string, hero: Character): string {
  return text.replace(/\{\{([a-zA-Z][a-zA-Z0-9:_-]*)\}\}/g, (_token, raw: string) => {
    const name = raw.toLowerCase();
    if (name === 'name') return characterLabel(hero);
    if (name.startsWith('custom:')) return 'symbol';
    return name.replace(/[_-]+/g, ' ');
  });
}

/** Pull a long ability upward into the space left by a short hero name. The
    title remains the hard upper boundary, so a two-line name still wins. */
function singleHeroDetailsTop(hero: Character, defaultTop: number, minimumTop: number): number {
  const ability = hero.abilities.find((entry) => entry.name.trim() || entry.text.trim());
  if (!ability) return defaultTop;
  const bodyLines = wrappedCopy(
    readableAbilityText(ability.text, hero),
    390,
    SINGLE_HERO_ABILITY_FONT_SIZE,
    Number.MAX_SAFE_INTEGER
  ).length;
  const requiredHeight =
    27 +
    (ability.name.trim() ? 38 : 0) +
    bodyLines * SINGLE_HERO_ABILITY_LINE_HEIGHT;
  return Math.max(minimumTop, Math.min(defaultTop, SINGLE_HERO_DETAILS_BOTTOM - requiredHeight));
}

function drawSectionLabel(
  context: CanvasRenderingContext2D,
  label: string,
  y: number,
  theme: CardTheme
): void {
  context.globalAlpha = 0.72;
  context.fillStyle = theme.bannerInk;
  context.font = `400 17px ${COPY_FONT}`;
  context.fillText(label, 70, y, 390);
  context.globalAlpha = 1;
}

/** A compact adaptive roster: ordinary sets stay in one generous column;
    unusually long rosters gain a second rather than dropping names. */
function drawNameGrid(
  context: CanvasRenderingContext2D,
  names: readonly string[],
  y: number,
  height: number,
  theme: CardTheme,
  columnsAfter: number,
  maxSize: number
): void {
  const entries = names.length > 0 ? names : ['NONE'];
  const columns = entries.length > columnsAfter ? 2 : 1;
  const rows = Math.ceil(entries.length / columns);
  const columnGap = 18;
  const columnWidth = (390 - columnGap * (columns - 1)) / columns;
  const rowHeight = height / rows;

  context.globalAlpha = 1;
  context.fillStyle = theme.bannerInk;
  for (const [index, entry] of entries.entries()) {
    const name = entry.toUpperCase();
    const column = index % columns;
    const row = Math.floor(index / columns);
    const size = fitDisplaySize(
      name,
      { width: columnWidth, height: rowHeight * 0.86 },
      theme.displayFont,
      Math.min(maxSize, rowHeight * 0.86),
      1
    );
    context.font = `${displayFontWeight(theme.displayFont)} ${size}px ${displayFontStack(theme.displayFont)}`;
    context.fillText(name, 70 + column * (columnWidth + columnGap), y + row * rowHeight, columnWidth);
  }
}

function drawSingleHeroDetails(
  context: CanvasRenderingContext2D,
  hero: Character,
  theme: CardTheme,
  top: number
): void {
  const ability = hero.abilities.find((entry) => entry.name.trim() || entry.text.trim());
  if (!ability) return;

  drawSectionLabel(context, 'SPECIAL ABILITY', top, theme);
  let bodyY = top + 27;
  if (ability.name.trim()) {
    const name = ability.name.trim().toUpperCase();
    const size = Math.min(30, 390 / Math.max(1, name.length * JUNIOR_MEAN_ADVANCE));
    context.fillStyle = theme.bannerInk;
    context.font = `400 ${size}px ${COPY_FONT}`;
    context.fillText(name, 70, bodyY, 390);
    bodyY += 38;
  }

  const text = readableAbilityText(ability.text, hero);
  const fontSize = SINGLE_HERO_ABILITY_FONT_SIZE;
  const lineHeight = SINGLE_HERO_ABILITY_LINE_HEIGHT;
  const maxLines = Math.max(2, Math.floor((SINGLE_HERO_DETAILS_BOTTOM - bodyY) / lineHeight));
  context.globalAlpha = 0.9;
  context.font = `400 ${fontSize}px ${COPY_FONT}`;
  for (const [index, line] of wrappedCopy(text, 390, fontSize, maxLines).entries()) {
    context.fillText(line, 70, bodyY + index * lineHeight, 390);
  }
  context.globalAlpha = 1;
}

function drawHeroSetDetails(
  context: CanvasRenderingContext2D,
  heroes: readonly Character[],
  theme: CardTheme,
  top: number
): void {
  drawSectionLabel(context, 'HEROES', top, theme);
  drawNameGrid(context, heroes.map(characterLabel), top + 30, 530 - (top + 30), theme, 4, 42);
}

function drawAdventureDetails(
  context: CanvasRenderingContext2D,
  villains: readonly Character[],
  minions: readonly Character[],
  theme: CardTheme
): void {
  drawSectionLabel(context, 'VILLAIN', 350, theme);
  drawNameGrid(context, villains.map(characterLabel), 377, 36, theme, 1, 31);
  drawSectionLabel(context, 'MINION', 423, theme);
  drawNameGrid(context, minions.map(characterLabel), 450, 80, theme, 3, 27);
}

async function paintBackdrop(
  context: CanvasRenderingContext2D,
  set: AdventureSet,
  theme: CardTheme
): Promise<void> {
  paintFill(context, theme.body, 0, 0, POSTER_WIDTH, POSTER_HEIGHT);
  const artwork = await loadArtwork(coverArtwork(set));
  if (artwork) {
    context.save();
    context.globalAlpha = 0.42;
    drawCover(context, artwork, 0, 0, POSTER_WIDTH, POSTER_HEIGHT);
    context.restore();
  }

  context.save();
  context.globalAlpha = artwork ? 0.3 : 0.16;
  paintFill(context, theme.frame, 0, 0, POSTER_WIDTH, POSTER_HEIGHT);
  context.restore();

  context.save();
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(585, 0);
  context.lineTo(520, POSTER_HEIGHT);
  context.lineTo(0, POSTER_HEIGHT);
  context.closePath();
  context.clip();
  context.globalAlpha = 0.94;
  paintFill(context, theme.banner, 0, 0, 620, POSTER_HEIGHT);
  context.restore();

  context.save();
  context.globalAlpha = 0.12;
  context.strokeStyle = theme.bannerInk;
  context.lineWidth = 2;
  for (let offset = 500; offset < 1300; offset += 64) {
    context.beginPath();
    context.moveTo(offset, 0);
    context.lineTo(offset - 240, POSTER_HEIGHT);
    context.stroke();
  }
  context.restore();

  context.fillStyle = theme.divider;
  context.beginPath();
  context.moveTo(566, 0);
  context.lineTo(585, 0);
  context.lineTo(520, POSTER_HEIGHT);
  context.lineTo(501, POSTER_HEIGHT);
  context.closePath();
  context.fill();
}

function titleFor(set: AdventureSet, kind: PosterKind, heroes: readonly Character[]): string {
  if (kind === 'single-hero' && heroes[0]) return characterLabel(heroes[0]);
  return set.name;
}

function drawIdentity(
  context: CanvasRenderingContext2D,
  set: AdventureSet,
  theme: CardTheme,
  kind: PosterKind,
  heroes: readonly Character[],
  villains: readonly Character[],
  minions: readonly Character[]
): void {
  const kicker =
    kind === 'single-hero'
      ? 'MEET THE HERO'
      : kind === 'hero-set'
        ? 'DISCOVER THE SET'
        : heroes.length === 0
          ? 'FACE THE VILLAIN'
          : 'ENTER THE ADVENTURE';
  const fallbackTitle = kind === 'single-hero' ? 'A NEW HERO' : 'AN UNMATCHED SET';
  const title = (titleFor(set, kind, heroes) || fallbackTitle).toUpperCase();
  const lines = balancedTitleLines(title);
  const titleSize = fitDisplaySize(
    title,
    { width: 400, height: 136 },
    theme.displayFont,
    72,
    0.88
  );
  const stats = setStats(set);
  const summary =
    kind === 'single-hero'
      ? `${plural(heroes.length, 'HERO', 'HEROES')} · ${plural(stats.printCount, 'CARD')}`
      : kind === 'hero-set'
        ? `${plural(heroes.length, 'HERO', 'HEROES')} · ${plural(stats.printCount, 'CARD')}`
        : `${plural(villains.length, 'VILLAIN')} · ${plural(heroes.length, 'HERO', 'HEROES')} · ${plural(minions.length, 'MINION')} · ${plural(stats.printCount, 'CARD')}`;
  const subtitle = kind === 'adventure' ? set.subtitle || 'AN UNMATCHED ADVENTURES SET' : '';
  const defaultDetailsTop = kind === 'adventure' ? 350 : 313;
  const titleBottom = 129 + (lines.length - 1) * titleSize * 0.88 + titleSize;
  const detailsTop =
    kind === 'single-hero' && heroes[0]
      ? singleHeroDetailsTop(heroes[0], defaultDetailsTop, Math.ceil(titleBottom + 35))
      : defaultDetailsTop;
  const dividerTop = detailsTop - 17;

  context.save();
  context.fillStyle = theme.bannerInk;
  context.textBaseline = 'top';
  context.font = `400 22px ${COPY_FONT}`;
  context.fillText(kicker, 70, 50, 390);
  context.fillStyle = theme.divider;
  context.fillRect(70, 89, 142, 8);

  context.fillStyle = theme.bannerInk;
  context.font = `${displayFontWeight(theme.displayFont)} ${titleSize}px ${displayFontStack(theme.displayFont)}`;
  const lineHeight = titleSize * 0.88;
  lines.forEach((line, index) => context.fillText(line, 70, 129 + index * lineHeight, 400));

  if (subtitle) {
    context.globalAlpha = 0.78;
    context.font = `400 21px ${COPY_FONT}`;
    context.fillText(clipped(subtitle.toUpperCase(), 62), 70, 306, 390);
  }

  context.globalAlpha = 1;
  context.fillStyle = theme.divider;
  context.fillRect(70, dividerTop, 42, 5);

  if (kind === 'single-hero' && heroes[0]) {
    drawSingleHeroDetails(context, heroes[0], theme, detailsTop);
  } else if (kind === 'hero-set') {
    drawHeroSetDetails(context, heroes, theme, detailsTop);
  } else {
    drawAdventureDetails(context, villains, minions, theme);
  }

  context.fillStyle = theme.bannerInk;
  context.font = `400 22px ${COPY_FONT}`;
  context.fillText(summary, 70, 552, 390);

  context.globalAlpha = 0.68;
  context.font = `400 18px ${COPY_FONT}`;
  context.fillText('UNMATCHED LABS', 70, 596, 390);
  context.restore();
}

async function drawBlobCard(
  context: CanvasRenderingContext2D,
  blob: Blob,
  placement: CardPlacement,
  theme: CardTheme
): Promise<void> {
  const bitmap = await createImageBitmap(blob);
  const height = placement.width * CARD_RATIO;
  try {
    context.save();
    context.translate(placement.x + placement.width / 2, placement.y + height / 2);
    context.rotate((placement.angle * Math.PI) / 180);
    context.shadowColor = theme.frame.color;
    context.shadowBlur = 22;
    context.shadowOffsetX = 8;
    context.shadowOffsetY = 12;
    context.drawImage(bitmap, -placement.width / 2, -height / 2, placement.width, height);
    context.restore();
  } finally {
    bitmap.close();
  }
}

function characterBack(photograph: Photograph, character: Character): Promise<Blob | null> {
  return photograph({ card: null, cardback: character }, CARD_FORMATS.action, {
    bleed: false,
    width: SOURCE_CARD_WIDTH
  });
}

function heroCard(photograph: Photograph, hero: Character): Promise<Blob | null> {
  return photograph({ card: null, statCard: hero }, CARD_FORMATS.action, {
    bleed: false,
    width: SOURCE_CARD_WIDTH
  });
}

async function renderBackSafely(
  photograph: Photograph,
  character: Character
): Promise<Blob | null> {
  try {
    return await characterBack(photograph, character);
  } catch (cause) {
    console.warn(`Could not render ${characterLabel(character)} in the social image.`, cause);
    return null;
  }
}

async function renderHeroCardSafely(
  photograph: Photograph,
  hero: Character
): Promise<Blob | null> {
  try {
    return await heroCard(photograph, hero);
  } catch (cause) {
    console.warn(`Could not render ${characterLabel(hero)}'s character card.`, cause);
    return null;
  }
}

async function drawSingleHero(
  context: CanvasRenderingContext2D,
  photograph: Photograph,
  hero: Character,
  theme: CardTheme
): Promise<void> {
  /* Concurrent photographs share the hidden stage and have produced empty
     social images during a real publish, so every call remains sequential. */
  const back = await renderBackSafely(photograph, hero);
  const card = await renderHeroCardSafely(photograph, hero);
  if (back && card) {
    await drawBlobCard(context, back, { x: 635, y: 108, width: 300, angle: -7 }, theme);
    await drawBlobCard(context, card, { x: 855, y: 104, width: 300, angle: 6 }, theme);
  } else {
    const picture = back ?? card;
    if (picture) await drawBlobCard(context, picture, { x: 775, y: 91, width: 320, angle: 2 }, theme);
  }
}

async function figureAccentSource(figure: Figure): Promise<HTMLImageElement | null> {
  let preview = null;
  try {
    preview = await loadFigurePreview(figure);
    if (preview) {
      const snapshot = await renderMeshSnapshot(preview.mesh, preview.texture, 320);
      if (snapshot) return loadImageSource(snapshot);
    }
  } catch {
    // Reference art is still a useful quiet accent when a supplied mesh fails.
  } finally {
    releaseFigurePreview(preview);
  }
  return loadArtwork(figure.reference);
}

function drawFigureAccent(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  left: number,
  top: number,
  size: number,
  theme: CardTheme
): void {
  const ratio = image.naturalWidth / image.naturalHeight;
  const width = ratio >= 1 ? size : size * ratio;
  const height = ratio >= 1 ? size / ratio : size;
  const x = left + (size - width) / 2;
  const y = top + (size - height) / 2;

  context.save();
  context.globalAlpha = 0.22;
  context.fillStyle = canvasFill(
    context,
    theme.frame,
    left + 18,
    top + size - 28,
    size - 36,
    20
  );
  context.beginPath();
  context.ellipse(
    left + size / 2,
    top + size - size * 0.107,
    size * 0.343,
    size * 0.071,
    0,
    0,
    Math.PI * 2
  );
  context.fill();
  context.globalAlpha = 0.96;
  context.shadowColor = theme.frame.color;
  context.shadowBlur = 14;
  context.shadowOffsetY = 7;
  context.drawImage(image, x, y, width, height);
  context.restore();
}

/** Miniatures are supporting evidence, not another headline. One keeps the
    corner placement; several overlap into a compact foreground lineup. */
async function drawFigureLineup(
  context: CanvasRenderingContext2D,
  set: AdventureSet,
  characters: readonly Character[],
  theme: CardTheme,
  limit: number
): Promise<void> {
  const figures: Figure[] = [];
  for (const character of characters) {
    for (const figure of set.figures) {
      if (
        figures.length < limit &&
        figure.kind === 'figure' &&
        figure.characterId === character.id &&
        !figures.includes(figure)
      ) {
        figures.push(figure);
      }
    }
  }

  const images: HTMLImageElement[] = [];
  for (const figure of figures) {
    const image = await figureAccentSource(figure);
    if (image) images.push(image);
  }
  if (images.length === 0) return;

  const size = images.length === 1 ? 140 : images.length === 2 ? 128 : images.length === 3 ? 118 : 110;
  const step = size * 0.82;
  const totalWidth = size + step * (images.length - 1);
  const left = 1188 - totalWidth;
  const top = 612 - size;
  for (const [index, image] of images.entries()) {
    drawFigureAccent(context, image, left + index * step, top, size, theme);
  }
}

async function drawHeroSet(
  context: CanvasRenderingContext2D,
  photograph: Photograph,
  heroes: readonly Character[],
  theme: CardTheme
): Promise<void> {
  const backs: Blob[] = [];
  for (const hero of heroes.slice(0, MAX_HEROES)) {
    const back = await renderBackSafely(photograph, hero);
    if (back) backs.push(back);
  }
  if (backs.length === 0) return;

  const width = backs.length === 1 ? 310 : backs.length === 2 ? 270 : 245;
  const start = backs.length === 1 ? 785 : 570;
  const available = 590 - width;
  const step = backs.length === 1 ? 0 : available / (backs.length - 1);
  for (const [index, back] of backs.entries()) {
    const angle = backs.length === 1 ? 2 : -10 + (20 * index) / (backs.length - 1);
    const y = 96 + Math.abs(angle) * 4.5;
    await drawBlobCard(context, back, { x: start + index * step, y, width, angle }, theme);
  }
}

async function drawAdventure(
  context: CanvasRenderingContext2D,
  photograph: Photograph,
  heroes: readonly Character[],
  villains: readonly Character[],
  minions: readonly Character[],
  theme: CardTheme
): Promise<void> {
  const focus = villains[0] ?? minions[0] ?? heroes[0];
  if (!focus) return;
  const support = (heroes.length > 0 ? heroes : minions)
    .filter((character) => character.id !== focus.id)
    .slice(0, 2);

  const supportBacks: Blob[] = [];
  for (const character of support) {
    const back = await renderBackSafely(photograph, character);
    if (back) supportBacks.push(back);
  }
  const focusBack = await renderBackSafely(photograph, focus);

  if (supportBacks.length === 1) {
    await drawBlobCard(context, supportBacks[0]!, { x: 650, y: 129, width: 245, angle: -9 }, theme);
  } else if (supportBacks.length === 2) {
    await drawBlobCard(context, supportBacks[0]!, { x: 580, y: 151, width: 230, angle: -11 }, theme);
    await drawBlobCard(context, supportBacks[1]!, { x: 720, y: 105, width: 230, angle: -4 }, theme);
  }

  if (focusBack) {
    await drawBlobCard(
      context,
      focusBack,
      { x: supportBacks.length === 0 ? 780 : 855, y: 101, width: 300, angle: 6 },
      theme
    );
  }
}

/** Compose a fixed landscape poster for a set or published scope. */
export async function renderSocialImage(set: AdventureSet): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = POSTER_WIDTH;
  canvas.height = POSTER_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) return renderThumbnail(set);

  const heroes = charactersByRole(set, 'hero');
  const villains = charactersByRole(set, 'villain');
  const minions = charactersByRole(set, 'minion');
  const kind: PosterKind =
    set.kind === 'adventure' ? 'adventure' : heroes.length === 1 ? 'single-hero' : 'hero-set';
  const themeCharacter =
    kind === 'adventure'
      ? (villains[0] ?? minions[0] ?? heroes[0] ?? null)
      : (heroes[0] ?? set.characters[0] ?? null);
  const theme = resolveCardTheme(
    set.style,
    themeCharacter?.style ?? null,
    null,
    'action',
    themeCharacter?.role
  );

  await loadPosterFonts(theme);
  await paintBackdrop(context, set, theme);
  drawIdentity(context, set, theme, kind, heroes, villains, minions);

  if (themeCharacter) {
    try {
      await withCardStage(async (photograph) => {
        if (kind === 'single-hero' && heroes[0]) {
          await drawSingleHero(context, photograph, heroes[0], theme);
        } else if (kind === 'hero-set') {
          await drawHeroSet(context, photograph, heroes, theme);
        } else {
          await drawAdventure(context, photograph, heroes, villains, minions, theme);
        }
      });
    } catch (cause) {
      console.warn('Could not add rendered components to the social image.', cause);
    }
  }

  try {
    const accentCharacters =
      kind === 'single-hero'
        ? heroes.slice(0, 1)
        : kind === 'hero-set'
          ? heroes
          : villains.length > 0 || minions.length > 0
            ? [...minions, ...villains]
            : heroes;
    await drawFigureLineup(context, set, accentCharacters, theme, kind === 'single-hero' ? 1 : 4);
  } catch (cause) {
    console.warn('Could not add figure accents to the social image.', cause);
  }

  try {
    return (await toBlob(canvas)) ?? renderThumbnail(set);
  } catch (cause) {
    console.warn('Could not encode the social image.', cause);
    return renderThumbnail(set);
  }
}
