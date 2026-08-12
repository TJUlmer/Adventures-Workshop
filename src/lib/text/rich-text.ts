/**
 * Rich text for rules and event cards.
 *
 * Stored as HTML, which means it must be sanitised on the way in *and* on the
 * way out: the way in covers paste, the way out covers a hand-edited or
 * imported set file. The allowlist is deliberately tiny — this is card copy,
 * not a document editor — and attributes are allowlisted by *value*, not just
 * by name, so `class` and `src` cannot smuggle anything in.
 */

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
 * The one inline style anything may carry, rebuilt from a parsed number rather
 * than passed through — `style` is the obvious place to smuggle something in,
 * so nothing an author wrote ever reaches the document verbatim.
 */
const SIZE_DECLARATION = /^\s*--size:\s*(\d+(?:\.\d{1,3})?)\s*;?\s*$/;

export function textSizeStyle(percent: number): string {
  return `--size: ${clampTextSize(percent) / 100}`;
}

/** The size a `style` attribute sets, or `null` if it sets none we allow. */
export function readTextSize(style: string | null | undefined): number | null {
  const match = style ? SIZE_DECLARATION.exec(style) : null;
  if (!match) return null;
  const percent = Number(match[1]) * 100;
  return percent >= TEXT_SIZE.min && percent <= TEXT_SIZE.max ? percent : null;
}

/**
 * The fixed sizes the editor used to offer. Kept renderable so cards written
 * before free sizing still print, but nothing writes them any more.
 */
const LEGACY_SIZE_CLASSES = ['size-sm', 'size-lg', 'size-xl'];

/** The only class values any element may carry. */
const ALLOWED_CLASSES = new Set<string>([...LEGACY_SIZE_CLASSES, TEXT_SIZE_CLASS, 'symbol']);

/** Inline symbols may only point inside the bundled symbol folder. */
const SYMBOL_SRC_PREFIX = '/assets/symbols/';

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

    // Images survive only as bundled symbols, and only with a local src.
    if (element.tagName === 'IMG') {
      const src = element.getAttribute('src') ?? '';
      if (!src.startsWith(SYMBOL_SRC_PREFIX)) {
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
      continue;
    }

    const classes = element.getAttribute('class');
    const size = readTextSize(element.getAttribute('style'));
    for (const attribute of Array.from(element.attributes)) {
      element.removeAttribute(attribute.name);
    }
    if (classes !== null) {
      element.setAttribute('class', classes);
      scrubClasses(element);
    }
    // Rebuilt from the parsed number, never copied across.
    if (size !== null) {
      element.setAttribute('style', textSizeStyle(size));
      element.classList.add(TEXT_SIZE_CLASS);
    } else {
      element.classList.remove(TEXT_SIZE_CLASS);
      if (element.classList.length === 0) element.removeAttribute('class');
    }

    // A span that carries neither a size nor a class is pure noise: unwrap it.
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
