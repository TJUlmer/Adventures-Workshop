<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
  export type ButtonSize = 'sm' | 'md';

  interface Props extends HTMLButtonAttributes {
    variant?: ButtonVariant;
    size?: ButtonSize;
    /** Square, content-free button sized for a single icon. */
    iconOnly?: boolean;
    /** Stretch to the width of the container. */
    block?: boolean;
    children: Snippet;
  }

  let {
    variant = 'secondary',
    size = 'md',
    iconOnly = false,
    block = false,
    children,
    ...rest
  }: Props = $props();
</script>

<button
  type="button"
  class="btn {variant} {size}"
  class:icon-only={iconOnly}
  class:block
  {...rest}
>
  {@render children()}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    letter-spacing: var(--tracking-tight);
    white-space: nowrap;
    border: 1px solid transparent;
    transition:
      background-color var(--duration-fast) var(--ease-out),
      border-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out),
      transform var(--duration-instant) var(--ease-out);
  }

  .btn:active:not(:disabled) {
    transform: translateY(0.5px);
  }

  .btn:disabled {
    opacity: 0.42;
  }

  /* -- sizes -- */
  .md {
    height: 30px;
    padding-inline: var(--space-3);
  }

  .sm {
    height: 24px;
    padding-inline: var(--space-2);
    font-size: var(--text-xs);
  }

  .icon-only.md {
    width: 30px;
    padding-inline: 0;
  }

  .icon-only.sm {
    width: 24px;
    padding-inline: 0;
  }

  /* -- variants -- */
  .primary {
    background: var(--accent);
    color: var(--text-on-accent);
    box-shadow: var(--shadow-xs);
  }

  .primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .secondary {
    background: var(--surface-overlay);
    border-color: var(--border-default);
    color: var(--text-secondary);
  }

  .secondary:hover:not(:disabled) {
    background: var(--grey-750);
    border-color: var(--border-strong);
    color: var(--text-primary);
  }

  .ghost {
    background: transparent;
    color: var(--text-tertiary);
  }

  .ghost:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .danger {
    background: transparent;
    border-color: color-mix(in oklab, var(--danger) 35%, transparent);
    color: var(--danger);
  }

  .danger:hover:not(:disabled) {
    background: color-mix(in oklab, var(--danger) 14%, transparent);
  }

  .block {
    width: 100%;
  }
</style>
