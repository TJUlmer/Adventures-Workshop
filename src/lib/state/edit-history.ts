/** Session history shares unchanged branches, including embedded artwork strings. */
export interface EditSnapshot<T, C> {
  value: T;
  context: C;
}

function shareUnchanged<T>(previous: T, next: T): T {
  if (previous === next) return previous;
  if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object') return next;
  if (Array.isArray(previous) !== Array.isArray(next)) return next;
  const before = previous as Record<string, unknown>;
  const after = next as Record<string, unknown>;
  const keys = Object.keys(after);
  let unchanged = keys.length === Object.keys(before).length;
  const shared: Record<string, unknown> = Array.isArray(next) ? [] as unknown as Record<string, unknown> : {};
  for (const key of keys) {
    // Dirty timestamps alone must not turn a no-op control event into an edit.
    const value = key === 'updatedAt' && key in before ? before[key] : shareUnchanged(before[key], after[key]);
    shared[key] = value;
    if (!(key in before) || value !== before[key]) unchanged = false;
  }
  return unchanged ? previous : shared as T;
}

function changedPaths(previous: unknown, next: unknown, path = '', result: string[] = []): string[] {
  if (previous === next) return result;
  if (previous && next && typeof previous === 'object' && typeof next === 'object' &&
      Array.isArray(previous) === Array.isArray(next)) {
    const before = previous as Record<string, unknown>;
    const after = next as Record<string, unknown>;
    const keys = Object.keys(after);
    if (keys.length === Object.keys(before).length && keys.every((key) => key in before)) {
      for (const key of keys) changedPaths(before[key], after[key], path + '/' + key, result);
      return result;
    }
  }
  result.push(path);
  return result;
}

/** Copy containers without duplicating the potentially large asset strings. */
export function copyEditSnapshot<T>(value: T): T {
  if (Array.isArray(value)) return value.map(copyEditSnapshot) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copyEditSnapshot(child)])) as T;
  }
  return value;
}

export class EditHistory<T, C> {
  #current: EditSnapshot<T, C> | null = null;
  #past: EditSnapshot<T, C>[] = [];
  #future: EditSnapshot<T, C>[] = [];
  #group: object | null = null;
  #groupPaths = "";
  #lastEdit = 0;

  constructor(private readonly limit = 50, private readonly groupDelayMs = 750) {}

  get undoCount(): number { return this.#past.length; }
  get redoCount(): number { return this.#future.length; }

  reset(value: T, context: C): void {
    this.#current = { value: copyEditSnapshot(value), context };
    this.#past = [];
    this.#future = [];
    this.breakGroup();
  }

  updateContext(value: T, context: C): void {
    if (this.#current && shareUnchanged(this.#current.value, value) === this.#current.value) {
      this.#current.context = context;
    }
  }

  record(value: T, context: C, group: object | null = null): boolean {
    const current = this.#current;
    if (!current) { this.reset(value, context); return false; }
    const shared = shareUnchanged(current.value, value);
    if (shared === current.value) { current.context = context; return false; }
    const time = Date.now();
    const paths = changedPaths(current.value, shared).join(";");
    const continueGroup = group !== null && group === this.#group && paths === this.#groupPaths &&
      time - this.#lastEdit < this.groupDelayMs && this.#past.length > 0 && this.#future.length === 0;
    if (continueGroup) {
      const start = this.#past.at(-1);
      if (start && shareUnchanged(start.value, shared) === start.value) {
        this.#past.pop();
        this.#current = { value: start.value, context };
        this.breakGroup();
        return true;
      }
    }
    if (!continueGroup) {
      this.#past.push(current);
      if (this.#past.length > this.limit) this.#past.shift();
    }
    this.#current = { value: shared, context };
    this.#future = [];
    this.#group = group;
    this.#groupPaths = paths;
    this.#lastEdit = time;
    return true;
  }

  breakGroup(): void { this.#group = null; this.#groupPaths = ""; this.#lastEdit = 0; }

  undo(): EditSnapshot<T, C> | null {
    const previous = this.#past.pop();
    if (!previous || !this.#current) return null;
    this.#future.push(this.#current);
    this.#current = previous;
    this.breakGroup();
    return previous;
  }

  redo(): EditSnapshot<T, C> | null {
    const next = this.#future.pop();
    if (!next || !this.#current) return null;
    this.#past.push(this.#current);
    this.#current = next;
    this.breakGroup();
    return next;
  }
}

/** Text and slider streams form one edit until focus changes or typing pauses. */
export function focusedEditGroup(): HTMLElement | null {
  const target = document.activeElement;
  if (!(target instanceof HTMLElement)) return null;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return target;
  if (target instanceof HTMLInputElement && !['button', 'submit', 'checkbox', 'radio', 'file'].includes(target.type)) return target;
  return null;
}
