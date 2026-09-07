/**
 * The deliberately small rich-text dialect used by action-card titles and
 * ability copy. The full prose editor supports headings, lists, colour and
 * sizing; action cards only need bold, italic, line breaks and inline symbols.
 */
import { CARD_SYMBOLS } from '$lib/renderer/assets';
import type { CustomSymbol } from '$lib/symbols/types';
import { parseAbilityText } from './tokens';
import {
  resolveCustomSymbolImages,
  richTextIsEmpty,
  richTextToPlain,
  sanitizeRichText
} from './rich-text';

const INLINE_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'BR', 'IMG']);
const BLOCK_TAGS = new Set(['P', 'DIV', 'UL', 'OL', 'LI', 'H3', 'H4']);

function flattenToInline(root: Node, singleLine: boolean): void {
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const element = child as Element;
    flattenToInline(element, singleLine);

    if (INLINE_TAGS.has(element.tagName)) {
      if (singleLine && element.tagName === 'BR') element.replaceWith(document.createTextNode(' '));
      continue;
    }

    const replacement = Array.from(element.childNodes);
    if (!singleLine && BLOCK_TAGS.has(element.tagName) && element.nextSibling) {
      replacement.push(document.createElement('br'));
    }
    element.replaceWith(...replacement);
  }
}

/** Reduce arbitrary input to the markup an action-card field can express. */
export function sanitizeActionText(html: string, singleLine = false): string {
  if (html.trim().length === 0) return '';

  const template = document.createElement('template');
  template.innerHTML = sanitizeRichText(html);
  flattenToInline(template.content, singleLine);
  const clean = template.innerHTML;
  return richTextIsEmpty(clean) ? '' : clean;
}

/** Plain projection for labels and non-HTML exports. */
export function actionTextToPlain(html: string): string {
  return richTextToPlain(sanitizeActionText(html));
}

export function actionTextIsEmpty(html: string): boolean {
  return richTextIsEmpty(sanitizeActionText(html));
}

/**
 * Resolve legacy `{{token}}` text inside each formatted run. Walking text
 * nodes, instead of tokenising the complete HTML string, keeps a bold or
 * italic ancestor wrapped around the symbol and never mistakes markup for
 * card copy.
 */
export function renderActionText(
  html: string,
  subject: string,
  customSymbols: readonly CustomSymbol[],
  symbolClass = 'symbol'
): string {
  const template = document.createElement('template');
  template.innerHTML = resolveCustomSymbolImages(sanitizeActionText(html), customSymbols);

  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) textNodes.push(node as Text);

  for (const textNode of textNodes) {
    const fragment = document.createDocumentFragment();
    for (const segment of parseAbilityText(textNode.data)) {
      if (segment.kind === 'text') {
        fragment.append(document.createTextNode(segment.value));
      } else if (segment.kind === 'subject') {
        fragment.append(document.createTextNode(subject));
      } else {
        const source =
          segment.kind === 'symbol'
            ? CARD_SYMBOLS[segment.name]
            : customSymbols.find((symbol) => symbol.id === segment.id)?.source;
        if (!source) continue;

        const image = document.createElement('img');
        image.className = symbolClass;
        image.src = source;
        image.alt =
          segment.kind === 'symbol'
            ? segment.name
            : (customSymbols.find((symbol) => symbol.id === segment.id)?.name ?? '');
        fragment.append(image);
      }
    }
    textNode.replaceWith(fragment);
  }

  for (const image of Array.from(template.content.querySelectorAll('img'))) {
    image.className = symbolClass;
  }
  return template.innerHTML;
}
