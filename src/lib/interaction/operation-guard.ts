/**
 * The document location an asynchronous operation started against.
 *
 * Entity ids alone are not enough: a fork deliberately preserves them, so
 * the set id is part of every context even when the eventual command can
 * address its original target directly.
 */
export interface OperationContext {
  readonly setId: string;
  readonly targetKey: string;
  /** The concrete document instance, so reopening the same set is still a new scope. */
  readonly scope: object;
}

export interface OperationToken<TContext extends OperationContext = OperationContext> {
  readonly context: TContext;
  readonly generation: number;
}

export interface OperationGuard {
  begin<TContext extends OperationContext>(context: TContext): OperationToken<TContext>;
  supersede(context: OperationContext): void;
  isCurrent(token: OperationToken, currentSetId: string, currentScope: object): boolean;
  invalidate(): void;
}

/**
 * Guards delayed work without coupling the interaction layer to the store.
 * Generations are per target key, so the newest request for one document slot
 * wins while work for a different explicitly-addressable slot may still land.
 */
export function createOperationGuard(): OperationGuard {
  const generations = new WeakMap<object, Map<string, number>>();
  let active = true;

  function advance(context: OperationContext): number {
    let scopeGenerations = generations.get(context.scope);
    if (!scopeGenerations) {
      scopeGenerations = new Map<string, number>();
      generations.set(context.scope, scopeGenerations);
    }

    const generation = (scopeGenerations.get(context.targetKey) ?? 0) + 1;
    scopeGenerations.set(context.targetKey, generation);
    return generation;
  }

  function begin<TContext extends OperationContext>(context: TContext): OperationToken<TContext> {
    return { context, generation: advance(context) };
  }

  function supersede(context: OperationContext): void {
    advance(context);
  }

  function isCurrent(token: OperationToken, currentSetId: string, currentScope: object): boolean {
    if (
      !active ||
      token.context.setId !== currentSetId ||
      token.context.scope !== currentScope
    ) {
      return false;
    }
    return generations.get(token.context.scope)?.get(token.context.targetKey) === token.generation;
  }

  function invalidate(): void {
    active = false;
  }

  return { begin, supersede, isCurrent, invalidate };
}
