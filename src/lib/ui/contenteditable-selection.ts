interface EditableSelectionPoint {
  linearOffset: number;
  path: number[];
  nodeOffset: number;
}

/** A DOM-path bookmark with a linear fallback for sanitizer structure changes. */
export interface EditableSelectionOffsets {
  start: EditableSelectionPoint;
  end: EditableSelectionPoint;
}

/** Whether both endpoints still belong to this editor. */
export function rangeInside(root: Node, range: Range): boolean {
  return (
    range.startContainer.isConnected &&
    range.endContainer.isConnected &&
    root.contains(range.startContainer) &&
    root.contains(range.endContainer)
  );
}

/** Clone the live browser range only when it belongs wholly to this editor. */
export function selectionRangeInside(root: Node): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  return rangeInside(root, range) ? range.cloneRange() : null;
}

/** Install a valid range without deciding which control should retain focus. */
export function installSelectionRange(root: Node, range: Range): Range | null {
  if (!rangeInside(root, range)) return null;
  const selection = window.getSelection();
  if (!selection) return null;
  const kept = range.cloneRange();
  selection.removeAllRanges();
  selection.addRange(kept);
  return selection.getRangeAt(0).cloneRange();
}

/** Put a caret after the editor's final child when no prior caret exists. */
export function rangeAtEnd(root: Node): Range {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  return range;
}

function isAtomic(node: Node): boolean {
  return node instanceof Element && (node.tagName === 'IMG' || node.tagName === 'BR');
}

function contentLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node as Text).data.length;
  if (isAtomic(node)) return 1;
  let length = 0;
  for (const child of Array.from(node.childNodes)) length += contentLength(child);
  return length;
}

/**
 * Count text code units plus one position for each inline image or line break.
 * `Range.toString()` cannot distinguish the caret immediately before a symbol
 * from the caret immediately after it, which made a second symbol jump sides
 * whenever sanitising rebuilt the editor DOM.
 */
function offsetWithin(root: Node, container: Node, offset: number): number {
  let total = 0;
  let found = false;

  const visit = (node: Node): void => {
    if (found) return;
    if (node === container) {
      if (node.nodeType === Node.TEXT_NODE) {
        total += Math.min(offset, (node as Text).data.length);
      } else {
        for (const child of Array.from(node.childNodes).slice(0, offset)) {
          total += contentLength(child);
        }
      }
      found = true;
      return;
    }
    if (isAtomic(node)) {
      total += 1;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      total += (node as Text).data.length;
      return;
    }
    for (const child of Array.from(node.childNodes)) visit(child);
  };

  visit(root);
  return total;
}

function pointAtOffset(root: Node, target: number): { node: Node; offset: number } {
  const descend = (node: Node, remaining: number): { node: Node; offset: number } => {
    if (node.nodeType === Node.TEXT_NODE) {
      return { node, offset: Math.min(remaining, (node as Text).data.length) };
    }

    let rest = remaining;
    const children = Array.from(node.childNodes);
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (!child) continue;
      const length = contentLength(child);
      if (rest < length && !isAtomic(child)) return descend(child, rest);
      if (rest < length) return { node, offset: index };
      if (rest === length) return { node, offset: index + 1 };
      rest -= length;
    }
    return { node, offset: children.length };
  };

  return descend(root, Math.max(0, Math.min(target, contentLength(root))));
}

function pathWithin(root: Node, node: Node): number[] {
  const path: number[] = [];
  let current: Node | null = node;
  while (current && current !== root) {
    const parent: Node | null = current.parentNode;
    if (!parent) return [];
    path.unshift(Array.from(parent.childNodes).findIndex((child) => child === current));
    current = parent;
  }
  return current === root ? path : [];
}

function pointBookmark(root: Node, node: Node, offset: number): EditableSelectionPoint {
  return {
    linearOffset: offsetWithin(root, node, offset),
    path: pathWithin(root, node),
    nodeOffset: offset
  };
}

function pointFromBookmark(
  root: Node,
  bookmark: EditableSelectionPoint
): { node: Node; offset: number } {
  let candidate: Node = root;
  let pathIsValid = true;
  for (const index of bookmark.path) {
    const child = candidate.childNodes[index];
    if (!child) {
      pathIsValid = false;
      break;
    }
    candidate = child;
  }

  const maximum =
    candidate.nodeType === Node.TEXT_NODE
      ? (candidate as Text).data.length
      : candidate.childNodes.length;
  if (
    pathIsValid &&
    bookmark.nodeOffset <= maximum &&
    offsetWithin(root, candidate, bookmark.nodeOffset) === bookmark.linearOffset
  ) {
    return { node: candidate, offset: bookmark.nodeOffset };
  }

  return pointAtOffset(root, bookmark.linearOffset);
}

/** Capture a range by content position before sanitising replaces its DOM. */
export function selectionOffsets(root: Node, range: Range): EditableSelectionOffsets | null {
  if (!rangeInside(root, range)) return null;
  return {
    start: pointBookmark(root, range.startContainer, range.startOffset),
    end: pointBookmark(root, range.endContainer, range.endOffset)
  };
}

/** Rebuild a range from a bookmark after sanitising has replaced the DOM. */
export function rangeFromOffsets(root: Node, offsets: EditableSelectionOffsets): Range {
  const start = pointFromBookmark(root, offsets.start);
  const end = pointFromBookmark(root, offsets.end);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}
