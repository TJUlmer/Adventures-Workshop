<script lang="ts">
  /**
   * Light Slate / Twilight Blue, in one click. Shows the icon for the theme
   * a click would *switch to*, not the one currently active — the same
   * convention as a play/pause button, and the one that needs no label to
   * read correctly at a glance.
   */
  import { theme } from '$lib/state/theme.svelte';
  import Icon from './Icon.svelte';

  const nextLabel = $derived(theme.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
</script>

<button type="button" class="toggle" title={nextLabel} aria-label={nextLabel} onclick={() => theme.toggle()}>
  <Icon name={theme.theme === 'dark' ? 'sun' : 'moon'} size={15} />
</button>

<style>
  .toggle {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    flex: none;
    border-radius: var(--radius-sm);
    color: var(--text-tertiary);
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .toggle:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
</style>
