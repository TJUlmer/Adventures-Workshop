<script lang="ts">
  import type { Fill } from '$lib/cards/style';
  import { fillCss } from '$lib/cards/style';

  interface Props {
    label: string;
    value: Fill;
    onchange: (positions: Pick<Fill, 'start' | 'end'>) => void;
  }

  let { label, value, onchange }: Props = $props();
  let track = $state<HTMLDivElement | null>(null);
  let dragPointerId = $state<number | null>(null);
  let activeStop = $state<'start' | 'end'>('start');
  let grabOffset = 0;
  const start = $derived(value.start ?? 0);
  const end = $derived(value.end ?? 100);
  const stops = ['start', 'end'] as const;

  function setPosition(stop: 'start' | 'end', position: number): void {
    if (!Number.isFinite(position)) return;
    const next = Math.round(position);
    onchange(stop === 'start'
      ? { start: Math.max(0, Math.min(end, next)), end }
      : { start, end: Math.max(start, Math.min(100, next)) });
  }

  function positionAt(event: PointerEvent): number {
    if (!track) return activeStop === 'start' ? start : end;
    const box = track.getBoundingClientRect();
    return box.width > 0 ? ((event.clientX - box.left - grabOffset) / box.width) * 100 : 0;
  }

  function begin(event: PointerEvent, stop: 'start' | 'end'): void {
    if (dragPointerId !== null || !event.isPrimary || event.button !== 0) return;
    const handle = event.currentTarget;
    if (!(handle instanceof HTMLElement)) return;
    handle.setPointerCapture(event.pointerId);
    handle.focus();
    event.preventDefault();
    activeStop = stop;
    dragPointerId = event.pointerId;
    const box = track?.getBoundingClientRect();
    grabOffset = box ? event.clientX - box.left - ((stop === 'start' ? start : end) / 100) * box.width : 0;
  }

  function move(event: PointerEvent): void {
    if (dragPointerId === event.pointerId) setPosition(activeStop, positionAt(event));
  }

  function finish(event: PointerEvent): void {
    if (dragPointerId !== event.pointerId) return;
    dragPointerId = null;
    const handle = event.currentTarget;
    if (handle instanceof HTMLElement && handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
  }

  function key(event: KeyboardEvent, stop: 'start' | 'end'): void {
    const position = stop === 'start' ? start : end;
    let next: number;
    switch (event.key) {
      case 'Home': next = 0; break;
      case 'End': next = 100; break;
      case 'ArrowRight':
      case 'ArrowUp': next = position + (event.shiftKey ? 10 : 1); break;
      case 'ArrowLeft':
      case 'ArrowDown': next = position - (event.shiftKey ? 10 : 1); break;
      case 'PageUp': next = position + 10; break;
      case 'PageDown': next = position - 10; break;
      default: return;
    }
    event.preventDefault();
    setPosition(stop, next);
  }
</script>

<div class="gradient-range">
  <div class="head">
    <span>Transition</span>
    <button
      type="button"
      class="reset"
      aria-label="Reset {label} transition to full length"
      disabled={start === 0 && end === 100}
      onclick={() => onchange({ start: 0, end: 100 })}
    >Full length</button>
  </div>

  <!-- Positions run along the gradient direction; the colour swatch above
       retains the actual angle. Opposite edges keep coincident stops draggable. -->
  <div class="range">
    <div
      bind:this={track}
      class="track"
      style:background={fillCss({ ...value, angle: 90 })}
    >
      {#each stops as stop}
        <div
          class="handle"
          class:start={stop === 'start'}
          class:end={stop === 'end'}
          class:dragging={dragPointerId !== null && activeStop === stop}
          style:left="{stop === 'start' ? start : end}%"
          style:--stop-colour={stop === 'start' ? value.color : value.color2}
          role="slider"
          tabindex="0"
          aria-label="{label} transition {stop}"
          aria-orientation="horizontal"
          aria-valuemin={stop === 'start' ? 0 : start}
          aria-valuemax={stop === 'start' ? end : 100}
          aria-valuenow={stop === 'start' ? start : end}
          aria-valuetext="{stop === 'start' ? start : end}%"
          onpointerdown={(event) => begin(event, stop)}
          onpointermove={move}
          onpointerup={finish}
          onpointercancel={finish}
          onlostpointercapture={finish}
          onkeydown={(event) => key(event, stop)}
        ><span aria-hidden="true"></span></div>
      {/each}
    </div>
  </div>

  <div class="positions">
    {#each stops as stop}
      <label class="position">
        <span>Transition {stop}</span>
        <span class="entry">
          <input
            type="number"
            class="numeric"
            min={stop === 'start' ? 0 : start}
            max={stop === 'start' ? end : 100}
            step="1"
            value={stop === 'start' ? start : end}
            aria-label="{label} transition {stop} percentage"
            oninput={(event) => setPosition(stop, event.currentTarget.valueAsNumber)}
            onblur={(event) => { event.currentTarget.value = String(stop === 'start' ? start : end); }}
          />
          <span>%</span>
        </span>
      </label>
    {/each}
  </div>
</div>

<style>
  .gradient-range {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .reset {
    padding: var(--space-1);
    border-radius: var(--radius-xs);
    color: var(--text-accent);
  }

  .reset:hover:not(:disabled) { background: var(--surface-hover); }
  .reset:disabled { color: var(--text-muted); opacity: 0.5; cursor: default; }

  .range { padding: 24px 14px; }

  .track {
    position: relative;
    height: 20px;
    border-radius: var(--radius-xs);
    box-shadow: 0 0 0 1px var(--border-default);
  }

  .handle {
    position: absolute;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    translate: -50% 0;
    border-radius: var(--radius-xs);
    cursor: ew-resize;
    touch-action: none;
    user-select: none;
  }

  .handle.start { bottom: calc(100% - 5px); }
  .handle.end { top: calc(100% - 5px); }

  .handle span {
    width: 12px;
    height: 12px;
    rotate: 45deg;
    background: var(--stop-colour);
    border: 2px solid var(--text-primary);
    box-shadow: 0 0 0 1px var(--border-default);
  }

  .handle:hover,
  .handle.dragging { background: var(--surface-hover); }

  .handle:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

  .positions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
  }

  .position {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
    font-size: var(--text-2xs);
    color: var(--text-tertiary);
  }

  .entry {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
  }

  input {
    width: 100%;
    min-width: 0;
    font-size: var(--text-xs);
    color: var(--text-primary);
  }
  .entry:focus-within { border-color: var(--accent); }

  @media (any-pointer: coarse) {
    .range { padding: 40px 22px; }
    .handle { width: var(--touch-target); height: var(--touch-target); }
    .entry, .reset { min-height: var(--touch-target); }
  }

  @media (max-width: 760px) {
    input { font-size: var(--text-md); }
  }
</style>
