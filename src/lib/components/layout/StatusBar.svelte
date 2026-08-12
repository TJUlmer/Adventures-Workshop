<script lang="ts">
  import { workshop } from '$lib/state/workshop.svelte';

  const stats = $derived(workshop.stats);

  const savedLabel = $derived.by(() => {
    if (workshop.savedAt === null) return 'Not saved yet';
    const time = new Date(workshop.savedAt);
    return `Saved locally · ${time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  });
</script>

<div class="status">
  <div class="group">
    <span class="stat"><b class="numeric">{stats.characterCount}</b> characters</span>
    <span class="sep"></span>
    <span class="stat"><b class="numeric">{stats.cardCount}</b> cards</span>
    <span class="sep"></span>
    <span class="stat"><b class="numeric">{stats.printCount}</b> to print</span>
  </div>

  <div class="group">
    {#if workshop.saveError}
      <span class="stat failed">{workshop.saveError}</span>
    {:else}
      <span class="stat saved" class:pending={workshop.savedAt === null}>{savedLabel}</span>
    {/if}
  </div>
</div>

<style>
  .status {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    height: 100%;
    padding-inline: var(--space-4);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .group {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .stat b {
    font-weight: var(--weight-semibold);
    color: var(--text-tertiary);
  }

  .sep {
    width: 1px;
    height: 10px;
    background: var(--border-default);
  }

  .saved::before {
    content: '';
    display: inline-block;
    width: 5px;
    height: 5px;
    margin-right: var(--space-2);
    border-radius: var(--radius-full);
    background: var(--success);
    vertical-align: middle;
  }

  .saved.pending::before {
    background: var(--grey-600);
  }

  .failed {
    color: var(--warning);
  }

  .failed::before {
    content: '';
    display: inline-block;
    width: 5px;
    height: 5px;
    margin-right: var(--space-2);
    border-radius: var(--radius-full);
    background: var(--warning);
    vertical-align: middle;
  }
</style>
