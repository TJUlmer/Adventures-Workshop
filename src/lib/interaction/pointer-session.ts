/**
 * The lifecycle shared by deliberate, single-pointer editing gestures.
 *
 * Geometry stays with the editor that owns it. This module only decides when
 * a pointer becomes a drag, guarantees one terminal callback, and cleans up
 * every way a browser can interrupt the gesture. Navigate/Preview surfaces do
 * not call this helper, so ordinary scrolling and browser zoom remain native.
 */

export type PointerSessionCancelReason =
  | 'pointercancel'
  | 'lost-capture'
  | 'escape'
  | 'hidden'
  | 'pagehide'
  | 'blur'
  | 'viewport-change'
  | 'second-pointer'
  | 'mode-change'
  | 'superseded'
  | 'unmount'
  | 'callback-error'
  | 'manual';

export interface PointerSessionMovement {
  readonly startX: number;
  readonly startY: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly distance: number;
  readonly activated: boolean;
}

export interface PointerSessionOptions<TSnapshot> {
  /** An immutable value the owner can restore from every cancellation path. */
  snapshot: Readonly<TSnapshot>;
  /** Defaults to 6px for a mouse and 10px for touch or pen. */
  threshold?: number | ((pointerType: string) => number);
  onMove: (
    movement: PointerSessionMovement,
    event: PointerEvent,
    snapshot: Readonly<TSnapshot>
  ) => void;
  onCommit: (
    movement: PointerSessionMovement,
    event: PointerEvent,
    snapshot: Readonly<TSnapshot>
  ) => void;
  onCancel: (
    reason: PointerSessionCancelReason,
    movement: PointerSessionMovement,
    snapshot: Readonly<TSnapshot>
  ) => void;
  onTap?: (event: PointerEvent, snapshot: Readonly<TSnapshot>) => void;
}

export interface PointerSession {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly activated: boolean;
  cancel(reason: PointerSessionCancelReason): void;
  /** Alias for cancellation when a component is being destroyed. */
  dispose(): void;
}

function defaultThreshold(pointerType: string): number {
  return pointerType === 'mouse' ? 6 : 10;
}

function movementFrom(
  startX: number,
  startY: number,
  clientX: number,
  clientY: number,
  activated: boolean
): PointerSessionMovement {
  const deltaX = clientX - startX;
  const deltaY = clientY - startY;
  return {
    startX,
    startY,
    clientX,
    clientY,
    deltaX,
    deltaY,
    distance: Math.hypot(deltaX, deltaY),
    activated
  };
}

/**
 * Start one editing gesture from a synchronous `pointerdown` handler.
 *
 * A right click, secondary contact, or non-element target is refused. The
 * caller should cancel its existing session with `superseded` before starting
 * another; a second contact during this session cancels it instead of silently
 * turning a future pinch gesture into a document mutation.
 */
export function startPointerSession<TSnapshot>(
  event: PointerEvent,
  options: PointerSessionOptions<TSnapshot>
): PointerSession | null {
  if (!event.isPrimary || event.button !== 0 || !(event.currentTarget instanceof Element)) {
    return null;
  }

  const target = event.currentTarget;
  const pointerId = event.pointerId;
  const pointerType = event.pointerType;
  const startX = event.clientX;
  const startY = event.clientY;
  const requestedThreshold =
    typeof options.threshold === 'function'
      ? options.threshold(pointerType)
      : (options.threshold ?? defaultThreshold(pointerType));
  const threshold = Number.isFinite(requestedThreshold)
    ? Math.max(0, requestedThreshold)
    : defaultThreshold(pointerType);
  const controller = new AbortController();

  let active = true;
  let activated = false;
  let latest = movementFrom(startX, startY, startX, startY, false);

  const release = (): void => {
    controller.abort();
    try {
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    } catch {
      // Capture may already have been released by the browser interruption.
    }
  };

  const cancel = (reason: PointerSessionCancelReason): void => {
    if (!active) return;
    active = false;
    release();
    options.onCancel(reason, latest, options.snapshot);
  };

  const onPointerMove = (moveEvent: Event): void => {
    if (!(moveEvent instanceof PointerEvent) || moveEvent.pointerId !== pointerId || !active) {
      return;
    }

    const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
    if (!activated && distance >= threshold) activated = true;
    latest = movementFrom(startX, startY, moveEvent.clientX, moveEvent.clientY, activated);
    if (!activated) return;

    // This session exists only inside an explicit editing mode. Preventing the
    // owned drag here cannot turn a Navigate/Preview surface into a scroll trap.
    moveEvent.preventDefault();
    try {
      options.onMove(latest, moveEvent, options.snapshot);
    } catch (error) {
      cancel('callback-error');
      throw error;
    }
  };

  const onPointerUp = (upEvent: Event): void => {
    if (!(upEvent instanceof PointerEvent) || upEvent.pointerId !== pointerId || !active) return;
    if (Math.hypot(upEvent.clientX - startX, upEvent.clientY - startY) >= threshold) {
      activated = true;
    }
    latest = movementFrom(startX, startY, upEvent.clientX, upEvent.clientY, activated);
    if (activated) {
      upEvent.preventDefault();
      try {
        options.onMove(latest, upEvent, options.snapshot);
      } catch (error) {
        cancel('callback-error');
        throw error;
      }
      // A final transient update may synchronously leave the editing mode or
      // unmount its owner. That cancellation is terminal and must win over a
      // commit from the pointer-up handler that happened to trigger it.
      if (!active) return;
      active = false;
      release();
      options.onCommit(latest, upEvent, options.snapshot);
    } else {
      active = false;
      release();
      // Deliberately do not prevent the pointer-up default: a tap callback
      // supplements the target's native click rather than suppressing it.
      options.onTap?.(upEvent, options.snapshot);
    }
  };

  const onOtherPointerDown = (downEvent: Event): void => {
    if (downEvent instanceof PointerEvent && downEvent.pointerId !== pointerId) {
      cancel('second-pointer');
    }
  };

  const onPointerCancel = (cancelEvent: Event): void => {
    if (cancelEvent instanceof PointerEvent && cancelEvent.pointerId === pointerId) {
      cancel('pointercancel');
    }
  };

  const onLostPointerCapture = (captureEvent: Event): void => {
    if (captureEvent instanceof PointerEvent && captureEvent.pointerId === pointerId) {
      cancel('lost-capture');
    }
  };

  const onKeyDown = (keyEvent: Event): void => {
    if (keyEvent instanceof KeyboardEvent && keyEvent.key === 'Escape') cancel('escape');
  };

  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') cancel('hidden');
  };

  target.addEventListener('pointermove', onPointerMove, { signal: controller.signal });
  target.addEventListener('pointerup', onPointerUp, { signal: controller.signal });
  target.addEventListener('pointercancel', onPointerCancel, { signal: controller.signal });
  target.addEventListener('lostpointercapture', onLostPointerCapture, {
    signal: controller.signal
  });
  /* Capture phase makes cancellation unconditional even inside an editor that
     stops bubbling for its own shortcut or multi-pointer implementation. */
  window.addEventListener('pointerdown', onOtherPointerDown, {
    capture: true,
    signal: controller.signal
  });
  window.addEventListener('keydown', onKeyDown, {
    capture: true,
    signal: controller.signal
  });
  document.addEventListener('visibilitychange', onVisibilityChange, { signal: controller.signal });
  window.addEventListener('pagehide', () => cancel('pagehide'), { signal: controller.signal });
  window.addEventListener('blur', () => cancel('blur'), { signal: controller.signal });
  window.addEventListener('resize', () => cancel('viewport-change'), {
    signal: controller.signal
  });
  window.addEventListener('orientationchange', () => cancel('viewport-change'), {
    signal: controller.signal
  });

  try {
    target.setPointerCapture(pointerId);
  } catch {
    active = false;
    release();
    return null;
  }

  return {
    pointerId,
    pointerType,
    get activated() {
      return activated;
    },
    cancel,
    dispose: () => cancel('unmount')
  };
}
