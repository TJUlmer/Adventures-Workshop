<script lang="ts">
  /**
   * A destructive action that must be deliberately activated twice.
   *
   * The first activation arms the same control in place; the second performs
   * the action. Keeping that lifecycle here avoids every caller inventing a
   * slightly different timeout, Escape path, accessible name, or teardown.
   */
  import { onDestroy, type Snippet } from 'svelte';
  import Button from './Button.svelte';

  type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
  type Size = 'sm' | 'md';

  interface Props {
    label: string;
    confirmLabel?: string;
    confirmText?: string;
    timeoutMs?: number;
    variant?: Variant;
    armedVariant?: Variant;
    size?: Size;
    iconOnly?: boolean;
    block?: boolean;
    disabled?: boolean;
    class?: string;
    onconfirm: () => void;
    children: Snippet;
  }

  let {
    label,
    confirmLabel = `${label} — activate again to confirm`,
    confirmText,
    timeoutMs = 3000,
    variant = 'danger',
    armedVariant = 'danger',
    size = 'md',
    iconOnly = false,
    block = false,
    disabled = false,
    class: className,
    onconfirm,
    children
  }: Props = $props();

  let armed = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function disarm(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    armed = false;
  }

  function request(): void {
    if (disabled) return;
    if (armed) {
      disarm();
      onconfirm();
      return;
    }
    armed = true;
    timer = setTimeout(disarm, timeoutMs);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !armed) return;
    event.preventDefault();
    event.stopPropagation();
    disarm();
  }

  $effect(() => {
    if (disabled) disarm();
  });

  onDestroy(disarm);
</script>

<Button
  class={className}
  variant={armed ? armedVariant : variant}
  {size}
  {iconOnly}
  {block}
  {disabled}
  aria-label={armed ? confirmLabel : label}
  title={armed ? confirmLabel : label}
  data-confirm-armed={armed ? 'true' : undefined}
  onclick={request}
  onblur={disarm}
  onkeydown={onKeydown}
>
  {#if armed && confirmText}
    {confirmText}
  {:else}
    {@render children()}
  {/if}
  <span class="sr-only" aria-live="polite">{armed ? confirmLabel : ''}</span>
</Button>
