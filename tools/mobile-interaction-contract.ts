import '../src/styles/index.css';
import './mobile-interaction-contract.css';
import {
  startPointerSession,
  type PointerSession,
  type PointerSessionCancelReason
} from '../src/lib/interaction/pointer-session';

type Mode = 'navigate' | 'adjust';
interface Position {
  x: number;
  y: number;
}

const surface = required<HTMLElement>('surface');
const artwork = required<HTMLButtonElement>('artwork');
const navigateButton = required<HTMLButtonElement>('navigate-mode');
const adjustButton = required<HTMLButtonElement>('adjust-mode');
const cancelButton = required<HTMLButtonElement>('cancel-session');
const explanation = required<HTMLElement>('mode-explanation');
const sessionState = required<HTMLElement>('session-state');
const eventLog = required<HTMLOListElement>('event-log');
const lifecycleButton = required<HTMLButtonElement>('run-lifecycle-checks');
const lifecycleSummary = required<HTMLElement>('lifecycle-summary');
const lifecycleResults = required<HTMLOListElement>('lifecycle-results');

let mode: Mode = 'navigate';
let position: Position = { x: 0, y: 0 };
let session: PointerSession | null = null;

function required<TElement extends HTMLElement>(id: string): TElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) throw new Error(`#${id} is missing.`);
  return element as TElement;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clampPosition(candidate: Position): Position {
  const limitX = Math.max(0, (surface.clientWidth - artwork.offsetWidth) / 2);
  const limitY = Math.max(0, (surface.clientHeight - artwork.offsetHeight) / 2);
  return {
    x: clamp(candidate.x, -limitX, limitX),
    y: clamp(candidate.y, -limitY, limitY)
  };
}

function renderPosition(): void {
  artwork.style.translate = `${position.x}px ${position.y}px`;
}

function log(message: string): void {
  const item = document.createElement('li');
  item.textContent = message;
  eventLog.prepend(item);
  while (eventLog.children.length > 6) eventLog.lastElementChild?.remove();
}

function setSessionState(message: string, active: boolean): void {
  sessionState.textContent = message;
  cancelButton.disabled = !active;
}

interface ProbeOutcome {
  cancellations: PointerSessionCancelReason[];
  commits: number;
  moves: number;
  taps: number;
  restored: boolean;
}

interface PointerProbe {
  readonly target: HTMLButtonElement;
  readonly outcome: ProbeOutcome;
  readonly captured: Set<number>;
  readonly session: PointerSession | null;
  pointer(type: string, pointerId: number, x?: number, y?: number, button?: number): void;
  dispose(): void;
}

function createPointerProbe(
  pointerType = 'mouse',
  options: { cancelOnFinalMove?: boolean; threshold?: number } = {}
): PointerProbe {
  const target = document.createElement('button');
  target.hidden = true;
  document.body.append(target);

  const captured = new Set<number>();
  Object.defineProperties(target, {
    setPointerCapture: {
      value: (pointerId: number) => captured.add(pointerId)
    },
    hasPointerCapture: {
      value: (pointerId: number) => captured.has(pointerId)
    },
    releasePointerCapture: {
      value: (pointerId: number) => captured.delete(pointerId)
    }
  });

  const outcome: ProbeOutcome = {
    cancellations: [],
    commits: 0,
    moves: 0,
    taps: 0,
    restored: true
  };
  const snapshot = { value: 0 };
  let value = snapshot.value;
  let activeSession: PointerSession | null = null;

  target.addEventListener('pointerdown', (event) => {
    activeSession = startPointerSession(event, {
      snapshot,
      ...(options.threshold === undefined ? {} : { threshold: options.threshold }),
      onMove: (movement, moveEvent) => {
        value = snapshot.value + movement.deltaX;
        outcome.moves += 1;
        if (options.cancelOnFinalMove && moveEvent.type === 'pointerup') {
          activeSession?.cancel('mode-change');
        }
      },
      onCommit: () => {
        outcome.commits += 1;
      },
      onCancel: (reason, _movement, start) => {
        value = start.value;
        outcome.restored = value === snapshot.value;
        outcome.cancellations.push(reason);
      },
      onTap: () => {
        outcome.taps += 1;
      }
    });
  });

  return {
    target,
    outcome,
    captured,
    get session() {
      return activeSession;
    },
    pointer(type, pointerId, x = 0, y = 0, button = 0) {
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button,
          clientX: x,
          clientY: y,
          isPrimary: true,
          pointerId,
          pointerType
        })
      );
    },
    dispose() {
      activeSession?.dispose();
      target.remove();
    }
  };
}

function verify(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function runLifecycleChecks(): void {
  const checks: { name: string; run: () => void }[] = [
    {
      name: 'Tap stays below threshold and does not mutate',
      run: () => {
        const probe = createPointerProbe();
        probe.pointer('pointerdown', 1);
        probe.pointer('pointerup', 1, 3, 2);
        verify(probe.outcome.taps === 1, 'tap callback did not run once');
        verify(probe.outcome.moves === 0 && probe.outcome.commits === 0, 'tap mutated state');
        verify(probe.captured.size === 0, 'tap retained pointer capture');
        probe.dispose();
      }
    },
    {
      name: 'Touch jitter remains a tap',
      run: () => {
        const probe = createPointerProbe('touch');
        probe.pointer('pointerdown', 2);
        probe.pointer('pointermove', 2, 5, 4);
        probe.pointer('pointerup', 2, 5, 4);
        verify(probe.outcome.taps === 1 && probe.outcome.moves === 0, 'sub-threshold jitter dragged');
        probe.dispose();
      }
    },
    {
      name: 'Invalid threshold falls back instead of activating every tap',
      run: () => {
        const probe = createPointerProbe('mouse', { threshold: Number.NaN });
        probe.pointer('pointerdown', 14);
        probe.pointer('pointerup', 14);
        verify(probe.outcome.taps === 1 && probe.outcome.commits === 0, 'invalid threshold became zero');
        probe.dispose();
      }
    },
    {
      name: 'Drag commits exactly once and releases capture',
      run: () => {
        const probe = createPointerProbe();
        probe.pointer('pointerdown', 3);
        probe.pointer('pointermove', 3, 8, 0);
        probe.pointer('pointerup', 3, 18, 0);
        probe.pointer('pointerup', 3, 24, 0);
        verify(probe.outcome.commits === 1, 'drag did not commit exactly once');
        verify(probe.outcome.moves === 2, 'final pointer position was not applied once');
        verify(probe.captured.size === 0, 'drag retained pointer capture');
        probe.dispose();
      }
    },
    {
      name: 'Pointer cancellation restores the snapshot',
      run: () => {
        const probe = createPointerProbe('touch');
        probe.pointer('pointerdown', 4);
        probe.pointer('pointermove', 4, 14, 0);
        probe.pointer('pointercancel', 4, 14, 0);
        verify(probe.outcome.cancellations[0] === 'pointercancel', 'wrong cancellation reason');
        verify(probe.outcome.restored && probe.outcome.commits === 0, 'cancel did not restore');
        probe.dispose();
      }
    },
    {
      name: 'Lost capture cancels once',
      run: () => {
        const probe = createPointerProbe();
        probe.pointer('pointerdown', 5);
        probe.pointer('pointermove', 5, 10, 0);
        probe.pointer('lostpointercapture', 5, 10, 0);
        probe.pointer('pointercancel', 5, 10, 0);
        verify(probe.outcome.cancellations.join() === 'lost-capture', 'lost capture was not terminal');
        probe.dispose();
      }
    },
    {
      name: 'Escape cancels and restores',
      run: () => {
        const probe = createPointerProbe();
        probe.pointer('pointerdown', 6);
        probe.pointer('pointermove', 6, 12, 0);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        verify(probe.outcome.cancellations[0] === 'escape' && probe.outcome.restored, 'Escape failed');
        probe.dispose();
      }
    },
    {
      name: 'Viewport change cancels and restores',
      run: () => {
        const probe = createPointerProbe();
        probe.pointer('pointerdown', 7);
        probe.pointer('pointermove', 7, 12, 0);
        window.dispatchEvent(new Event('resize'));
        verify(
          probe.outcome.cancellations[0] === 'viewport-change' && probe.outcome.restored,
          'viewport change failed'
        );
        probe.dispose();
      }
    },
    {
      name: 'A second pointer cancels the first',
      run: () => {
        const probe = createPointerProbe('touch');
        probe.pointer('pointerdown', 8);
        window.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            isPrimary: false,
            pointerId: 9,
            pointerType: 'touch'
          })
        );
        verify(probe.outcome.cancellations[0] === 'second-pointer', 'second pointer was ignored');
        probe.dispose();
      }
    },
    {
      name: 'Stopped pointer bubbling cannot hide a second contact',
      run: () => {
        const probe = createPointerProbe('touch');
        const blocker = document.createElement('button');
        blocker.hidden = true;
        blocker.addEventListener('pointerdown', (event) => event.stopPropagation());
        document.body.append(blocker);
        probe.pointer('pointerdown', 15);
        blocker.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            isPrimary: false,
            pointerId: 16,
            pointerType: 'touch'
          })
        );
        verify(probe.outcome.cancellations[0] === 'second-pointer', 'stopped event hid contact');
        blocker.remove();
        probe.dispose();
      }
    },
    {
      name: 'Stopped key bubbling cannot hide Escape',
      run: () => {
        const probe = createPointerProbe();
        const blocker = document.createElement('input');
        blocker.hidden = true;
        blocker.addEventListener('keydown', (event) => event.stopPropagation());
        document.body.append(blocker);
        probe.pointer('pointerdown', 17);
        blocker.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
        verify(probe.outcome.cancellations[0] === 'escape', 'stopped event hid Escape');
        blocker.remove();
        probe.dispose();
      }
    },
    {
      name: 'Final-move cancellation wins over commit',
      run: () => {
        const probe = createPointerProbe('mouse', { cancelOnFinalMove: true });
        probe.pointer('pointerdown', 18);
        probe.pointer('pointerup', 18, 12, 0);
        verify(
          probe.outcome.cancellations[0] === 'mode-change' && probe.outcome.commits === 0,
          're-entrant cancellation still committed'
        );
        probe.dispose();
      }
    },
    {
      name: 'Page hide cancels before navigation caching',
      run: () => {
        const probe = createPointerProbe();
        probe.pointer('pointerdown', 20);
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
        verify(probe.outcome.cancellations[0] === 'pagehide', 'page hide left the session active');
        probe.dispose();
      }
    },
    {
      name: 'Teardown is idempotent',
      run: () => {
        const probe = createPointerProbe();
        probe.pointer('pointerdown', 10);
        probe.session?.dispose();
        probe.session?.dispose();
        verify(probe.outcome.cancellations.join() === 'unmount', 'teardown cancelled more than once');
        probe.dispose();
      }
    },
    {
      name: 'A fresh session starts after cancellation',
      run: () => {
        const probe = createPointerProbe();
        probe.pointer('pointerdown', 11);
        probe.session?.cancel('manual');
        probe.pointer('pointerdown', 12);
        probe.pointer('pointerup', 12);
        verify(
          probe.outcome.cancellations.join() === 'manual' && probe.outcome.taps === 1,
          'fresh session could not start'
        );
        probe.dispose();
      }
    },
    {
      name: 'Secondary mouse button is refused',
      run: () => {
        const probe = createPointerProbe();
        probe.pointer('pointerdown', 13, 0, 0, 2);
        verify(probe.session === null && probe.captured.size === 0, 'secondary button started a session');
        probe.dispose();
      }
    }
  ];

  lifecycleResults.replaceChildren();
  let passed = 0;
  for (const check of checks) {
    const item = document.createElement('li');
    try {
      check.run();
      passed += 1;
      item.className = 'passed';
      item.textContent = `Pass — ${check.name}`;
    } catch (error) {
      item.className = 'failed';
      item.textContent = `Fail — ${check.name}: ${error instanceof Error ? error.message : 'unknown error'}`;
    }
    lifecycleResults.append(item);
  }

  const allPassed = passed === checks.length;
  lifecycleSummary.className = allPassed ? 'passed' : 'failed';
  lifecycleSummary.textContent = `${passed}/${checks.length} checks passed`;
}

function setMode(next: Mode): void {
  if (mode === next) return;
  session?.cancel('mode-change');
  mode = next;
  surface.dataset['mode'] = mode;
  navigateButton.setAttribute('aria-pressed', String(mode === 'navigate'));
  adjustButton.setAttribute('aria-pressed', String(mode === 'adjust'));
  explanation.textContent =
    mode === 'navigate'
      ? 'Swipe across the artwork: the page should scroll.'
      : 'The artwork owns one pointer. Done by returning to Navigate.';
  setSessionState(
    mode === 'navigate' ? 'Navigate — browser owns gestures' : 'Adjust — waiting for artwork',
    false
  );
  log(`Mode changed to ${mode}.`);
}

navigateButton.addEventListener('click', () => setMode('navigate'));
adjustButton.addEventListener('click', () => setMode('adjust'));
cancelButton.addEventListener('click', () => session?.cancel('manual'));
lifecycleButton.addEventListener('click', runLifecycleChecks);

artwork.addEventListener('pointerdown', (event) => {
  if (mode !== 'adjust') return;
  session?.cancel('superseded');

  const snapshot = { ...position };
  session = startPointerSession(event, {
    snapshot,
    onMove: (movement) => {
      position = clampPosition({
        x: snapshot.x + movement.deltaX,
        y: snapshot.y + movement.deltaY
      });
      renderPosition();
      setSessionState(
        `Adjusting — ${Math.round(movement.deltaX)}, ${Math.round(movement.deltaY)} px`,
        true
      );
    },
    onCommit: (movement) => {
      session = null;
      setSessionState('Adjust — committed', false);
      log(`Committed a ${Math.round(movement.distance)}px drag.`);
    },
    onCancel: (reason: PointerSessionCancelReason, _movement, start) => {
      // A rotation can make the old bounds narrower while it cancels the
      // gesture. Restore the snapshot, but constrain it to the new surface so
      // cancellation cannot strand the artwork outside the usable area.
      position = clampPosition(start);
      renderPosition();
      session = null;
      setSessionState(`Adjust — cancelled (${reason})`, false);
      log(`Cancelled: ${reason}; restored the start position.`);
    },
    onTap: () => {
      session = null;
      setSessionState('Adjust — tap, no mutation', false);
      log('Tap stayed below the drag threshold; nothing changed.');
    }
  });

  if (session) setSessionState('Adjust — pointer captured, waiting for drag', true);
});

window.addEventListener('resize', () => {
  if (session) return;
  position = clampPosition(position);
  renderPosition();
});
surface.dataset['mode'] = mode;
renderPosition();
