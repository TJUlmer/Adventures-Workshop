<script lang="ts">
  /**
   * An angle, set by pointing at it.
   *
   * A gradient direction is a direction — typing "225" to mean "down and to
   * the left" is a translation the author should not have to do. The dial is
   * the control; the readout stays because a printed set sometimes needs an
   * exact figure, and arrow keys are there because a dial is no good to
   * anyone driving by keyboard.
   */
  interface Props {
    value: number;
    label: string;
    /** Degrees per arrow key press, and what a drag snaps to. */
    step?: number;
    onchange: (value: number) => void;
  }

  let { value, label, step = 15, onchange }: Props = $props();

  let dial = $state<HTMLDivElement | null>(null);
  let dragging = $state(false);

  const wrap = (degrees: number) => ((degrees % 360) + 360) % 360;

  /**
   * Pointer position to CSS gradient angle: 0° is up and it runs clockwise,
   * which is neither the maths convention nor the screen's y axis.
   */
  function angleAt(event: PointerEvent): number {
    if (!dial) return value;
    const box = dial.getBoundingClientRect();
    const dx = event.clientX - (box.left + box.width / 2);
    const dy = event.clientY - (box.top + box.height / 2);
    const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;
    // Free rotation while a modifier is held, for angles the step would skip.
    const snap = event.shiftKey ? 1 : step;
    return wrap(Math.round(degrees / snap) * snap);
  }

  function track(event: PointerEvent): void {
    event.preventDefault();
    dragging = true;
    dial?.setPointerCapture(event.pointerId);
    onchange(angleAt(event));
  }

  function onKey(event: KeyboardEvent): void {
    const delta =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? step
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -step
          : 0;
    if (delta === 0) return;
    event.preventDefault();
    onchange(wrap(value + delta));
  }
</script>

<div class="angle">
  <div
    bind:this={dial}
    class="dial"
    class:dragging
    style:--angle="{value}deg"
    role="slider"
    tabindex="0"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={360}
    aria-valuenow={value}
    aria-valuetext="{value} degrees"
    onpointerdown={track}
    onpointermove={(event) => dragging && onchange(angleAt(event))}
    onpointerup={(event) => {
      dragging = false;
      dial?.releasePointerCapture(event.pointerId);
    }}
    onpointercancel={() => (dragging = false)}
    onkeydown={onKey}
  >
    <span class="pointer"></span>
  </div>

  <input
    class="readout numeric"
    type="number"
    min="0"
    max="360"
    {step}
    {value}
    aria-label="{label}, in degrees"
    oninput={(event) => {
      const next = event.currentTarget.valueAsNumber;
      if (!Number.isNaN(next)) onchange(wrap(next));
    }}
  />
  <span class="deg">°</span>
</div>

<style>
  .angle {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  /*
   * The face carries the direction twice over: the gradient behind it shows
   * where the colour is going, and the pointer shows the angle itself.
   */
  .dial {
    position: relative;
    width: 26px;
    height: 26px;
    flex: none;
    border-radius: 50%;
    background: linear-gradient(
      var(--angle),
      var(--grey-750),
      color-mix(in oklab, var(--accent) 45%, var(--grey-750))
    );
    box-shadow: inset 0 0 0 1px var(--border-default);
    cursor: grab;
    touch-action: none;
    transition: box-shadow var(--duration-fast) var(--ease-out);
  }

  .dial:hover {
    box-shadow: inset 0 0 0 1px var(--border-strong);
  }

  .dial:focus-visible {
    outline: none;
    box-shadow:
      inset 0 0 0 1px var(--accent),
      0 0 0 3px var(--accent-soft);
  }

  .dial.dragging {
    cursor: grabbing;
  }

  /*
   * Rotated from the dial's centre so the arm sweeps rather than slides, with
   * `0deg` pointing up — the same zero the CSS gradient uses.
   */
  .pointer {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 2px;
    height: 10px;
    margin-left: -1px;
    border-radius: var(--radius-full);
    background: var(--grey-100);
    transform-origin: 50% 100%;
    rotate: var(--angle);
    translate: 0 -100%;
    pointer-events: none;
  }

  .readout {
    width: 4ch;
    height: 22px;
    padding: 0;
    background: transparent;
    border: none;
    font-size: var(--text-2xs);
    color: var(--text-tertiary);
    text-align: right;
    appearance: textfield;
    -moz-appearance: textfield;
  }

  .readout::-webkit-outer-spin-button,
  .readout::-webkit-inner-spin-button {
    appearance: none;
    margin: 0;
  }

  .readout:focus {
    outline: none;
    color: var(--text-primary);
  }

  .deg {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
</style>
