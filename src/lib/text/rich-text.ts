/**
 * Rich text for rules and event cards.
 *
 * Stored as HTML, which means it must be sanitised on the way in *and* on the
 * way out: the way in covers paste, the way out covers a hand-edited or
 * imported set file. The allowlist is deliberately tiny — this is card copy,
 * not a document editor — and attributes are allowlisted by *value*, not just
 * by name, so `class` and `src` cannot smuggle anything in.
 */

import type { CustomSymbol } from '$lib/symbols/types';

/**
 * Text size, as a percentage of the card's own body size.
 *
 * Relative to the card rather than to the surrounding copy, and relative to the
 * card rather than absolute. The first is what stops sizes compounding when one
 * sized run ends up inside another — 150% inside 150% is 150%, not 225% — and
 * the second is what keeps a size meaning the same thing at a 120px thumbnail
 * and at print.
 *
 * Carried as a multiplier in a custom property, which the faces resolve against
 * `--copy-size`. That indirection is the whole trick: `em` would read the
 * parent, this reads the card.
 */
export const TEXT_SIZE = { min: 25, max: 400, step: 5, normal: 100 } as const;

/** Marks an element as carrying a size, so the face's rule can find it. */
export const TEXT_SIZE_CLASS = 'sized';

export function clampTextSize(percent: number): number {
  return Math.min(TEXT_SIZE.max, Math.max(TEXT_SIZE.min, Math.round(percent)));
}

/**
 * Every declaration a `style` attribute may carry, each rebuilt from a parsed,
 * validated value rather than passed through — `style` is the obvious place
 * to smuggle something in, so nothing an author wrote ever reaches the
 * document verbatim. Read independently of one another, so an element can
 * carry any combination (a coloured run inside a resized one, say) without
 * either declaration clobbering the other on the way through the sanitiser.
 */
function declarations(style: string | null | undefined): string[] {
  if (!style) return [];
  return style
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

const SIZE_DECLARATION = /^--size:\s*(\d+(?:\.\d{1,3})?)$/;

export function textSizeStyle(percent: number): string {
  return `--size: ${clampTextSize(percent) / 100}`;
}

/** The size a `style` attribute sets, or `null` if it sets none we allow. */
export function readTextSize(style: string | null | undefined): number | null {
  for (const declaration of declarations(style)) {
    const match = SIZE_DECLARATION.exec(declaration);
    if (!match) continue;
    const percent = Number(match[1]) * 100;
    if (percent >= TEXT_SIZE.min && percent <= TEXT_SIZE.max) return percent;
  }
  return null;
}

/** Marks an element as carrying an explicit colour, so a re-colour can find it. */
export const TEXT_COLOR_CLASS = 'colored';

const COLOR_DECLARATION = /^color:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})$/;

export function textColorStyle(hex: string): string {
  return `color: ${hex}`;
}

/** The colour a `style` attribute sets, or `null` if it sets none we allow. */
export function readTextColor(style: string | null | undefined): string | null {
  for (const declaration of declarations(style)) {
    const match = COLOR_DECLARATION.exec(declaration);
    if (match) return match[1] ?? null;
  }
  return null;
}

export type TextAlign = 'left' | 'center' | 'right';

const ALIGN_DECLARATION = /^text-align:\s*(left|center|right)$/;

export function textAlignStyle(align: TextAlign): string {
  return `text-align: ${align}`;
}

/** The alignment a `style` attribute sets, or `null` if it sets none we allow. */
export function readTextAlign(style: string | null | undefined): TextAlign | null {
  for (const declaration of declarations(style)) {
    const match = ALIGN_DECLARATION.exec(declaration);
    if (match) return match[1] as TextAlign;
  }
  return null;
}

/**
 * The fixed sizes the editor used to offer. Kept renderable so cards written
 * before free sizing still print, but nothing writes them any more.
 */
const LEGACY_SIZE_CLASSES = ['size-sm', 'size-lg', 'size-xl'];

/** The only class values any element may carry. */
const ALLOWED_CLASSES = new Set<string>([
  ...LEGACY_SIZE_CLASSES,
  TEXT_SIZE_CLASS,
  TEXT_COLOR_CLASS,
  'symbol'
]);

/** Inline symbols may only point inside the bundled symbol folder. */
const SYMBOL_SRC_PREFIX = '/assets/symbols/';

/**
 * A custom symbol is addressed by id (`data-symbol-id`) rather than by its
 * data-URL `src`: the src stored in the document is whatever it was at
 * insert time, and can go stale the moment the author replaces or renames
 * the symbol on the Symbols page. `resolveCustomSymbolImages` rewrites it
 * from the live registry at render time, the same way the built-in symbols
 * are looked up fresh by name rather than baked in. This only bounds the
 * *shape* of the attribute the sanitiser will keep — not whether it still
 * resolves to anything, which `resolveCustomSymbolImages` alone decides.
 */
const CUSTOM_SYMBOL_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

const ALLOWED_TAGS = new Set([
  'B',
  'STRONG',
  'I',
  'EM',
  'U',
  'S',
  'BR',
  'P',
  'DIV',
  'SPAN',
  'UL',
  'OL',
  'LI',
  'H3',
  'H4',
  'IMG'
]);

/** Tags that collapse to their contents rather than being dropped whole. */
const UNWRAP_TAGS = new Set(['SPAN', 'DIV', 'FONT', 'A']);

/** Keep only allowlisted classes; drop the attribute if none survive. */
function scrubClasses(element: Element): void {
  const kept = [...element.classList].filter((name) => ALLOWED_CLASSES.has(name));
  if (kept.length > 0) element.setAttribute('class', kept.join(' '));
  else element.removeAttribute('class');
}

function scrub(node: Node): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) continue;

    if (child.nodeType !== Node.ELEMENT_NODE) {
      child.remove();
      continue;
    }

    const element = child as Element;

    if (!ALLOWED_TAGS.has(element.tagName)) {
      if (UNWRAP_TAGS.has(element.tagName)) {
        scrub(element);
        element.replaceWith(...Array.from(element.childNodes));
      } else {
        element.remove();
      }
      continue;
    }

    // Images survive only as a bundled symbol or a custom one, and only with
    // a local src or, for a custom symbol, an id the registry can resolve.
    if (element.tagName === 'IMG') {
      const src = element.getAttribute('src') ?? '';
      const symbolId = element.getAttribute('data-symbol-id');
      const isBundled = src.startsWith(SYMBOL_SRC_PREFIX);
      const isCustom =
        symbolId !== null &&
        CUSTOM_SYMBOL_ID_PATTERN.test(symbolId) &&
        src.startsWith('data:image/');
      if (!isBundled && !isCustom) {
        element.remove();
        continue;
      }
      const alt = element.getAttribute('alt') ?? '';
      for (const attribute of Array.from(element.attributes)) {
        element.removeAttribute(attribute.name);
      }
      element.setAttribute('src', src);
      element.setAttribute('alt', alt);
      element.setAttribute('class', 'symbol');
      if (isCustom) element.setAttribute('data-symbol-id', symbolId);
      continue;
    }

    const classes = element.getAttribute('class');
    const style = element.getAttribute('style');
    const size = readTextSize(style);
    const color = readTextColor(style);
    const align = readTextAlign(style);
    for (const attribute of Array.from(element.attributes)) {
      element.removeAttribute(attribute.name);
    }
    if (classes !== null) {
      element.setAttribute('class', classes);
      scrubClasses(element);
    }

    // Rebuilt from the parsed, validated values, never copied across.
    const rebuilt: string[] = [];
    if (size !== null) {
      rebuilt.push(textSizeStyle(size));
      element.classList.add(TEXT_SIZE_CLASS);
    } else {
      element.classList.remove(TEXT_SIZE_CLASS);
    }
    if (color !== null) {
      rebuilt.push(textColorStyle(color));
      element.classList.add(TEXT_COLOR_CLASS);
    } else {
      element.classList.remove(TEXT_COLOR_CLASS);
    }
    if (align !== null) rebuilt.push(textAlignStyle(align));

    if (rebuilt.length > 0) element.setAttribute('style', rebuilt.join('; '));
    if (element.classList.length === 0) element.removeAttribute('class');

    // A span that carries no class and no style at all is pure noise: unwrap it.
    if (
      element.tagName === 'SPAN' &&
      !element.hasAttribute('class') &&
      !element.hasAttribute('style')
    ) {
      scrub(element);
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }

    scrub(element);
  }
}

/** Reduce arbitrary HTML to the allowlist. Safe to call on untrusted input. */
export function sanitizeRichText(html: string): string {
  if (html.trim().length === 0) return '';

  const template = document.createElement('template');
  template.innerHTML = html;
  scrub(template.content);
  return template.innerHTML;
}

/**
 * Rewrite every custom symbol's `src`/`alt` from the live registry.
 *
 * Called at render time, after `sanitizeRichText`: the sanitiser only checks
 * *shape*, so a stored `src` can be an old image or an old name for a symbol
 * the author has since replaced or renamed. Resolving here, on every render,
 * is what makes an edit on the Symbols page propagate to every card using it
 * instantly rather than only to future insertions. A symbol that no longer
 * exists is dropped rather than left showing a stale picture.
 */
export function resolveCustomSymbolImages(html: string, symbols: readonly CustomSymbol[]): string {
  if (!html.includes('data-symbol-id')) return html;

  const template = document.createElement('template');
  template.innerHTML = html;

  for (const img of Array.from(template.content.querySelectorAll('img[data-symbol-id]'))) {
    const id = img.getAttribute('data-symbol-id');
    const symbol = symbols.find((candidate) => candidate.id === id);
    if (symbol?.source) {
      img.setAttribute('src', symbol.source);
      img.setAttribute('alt', symbol.name);
    } else {
      img.remove();
    }
  }

  return template.innerHTML;
}

/** Plain-text projection, for search, counts and empty checks. */
export function richTextToPlain(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  return (template.content.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function richTextIsEmpty(html: string): boolean {
  const template = document.createElement('template');
  template.innerHTML = html;
  // A symbol on its own is content, even with no text around it.
  if (template.content.querySelector('img')) return false;
  return richTextToPlain(html).length === 0;
}

/** Escape a plain string for safe interpolation into card markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
