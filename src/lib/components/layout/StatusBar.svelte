<script lang="ts">
  import { workshop } from '$lib/state/workshop.svelte';
  import { persistenceCoordinator } from '$lib/persistence/coordinator.svelte';

  const stats = $derived(workshop.stats);

  const savedLabels = $derived.by(() => {
    if (workshop.savedAt === null) {
      return { full: 'Not saved yet', compact: 'Not saved yet' };
    }
    const time = new Date(workshop.savedAt);
    const localTime = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    switch (persistenceCoordinator.status.kind) {
      case 'synced':
        return {
          full: `Saved locally and to cloud · ${localTime}`,
          compact: `Saved · synced · ${localTime}`
        };
      case 'pending':
        return { full: 'Saved locally · Cloud save pending', compact: 'Saved · cloud pending' };
      case 'saving':
        return { full: 'Saved locally · Saving to cloud…', compact: 'Saved · syncing…' };
      case 'offline':
        return { full: 'Saved locally · Offline — cloud save pending', compact: 'Saved · offline' };
      case 'retrying':
        return { full: 'Saved locally · Cloud retry queued', compact: 'Saved · retry queued' };
      case 'conflict':
        return { full: 'Saved locally · Cloud conflict — autosave paused', compact: 'Saved · cloud conflict' };
      case 'error':
        return { full: 'Saved locally · Cloud save paused', compact: 'Saved · cloud paused' };
      default:
        return { full: `Saved locally · ${localTime}`, compact: `Saved · ${localTime}` };
    }
  });
</script>

<div class="status">
  <div class="group counts">
    <span class="stat"><b class="numeric">{stats.characterCount}</b> characters</span>
    <span class="sep"></span>
    <span class="stat"><b class="numeric">{stats.cardCount}</b> cards</span>
    <span class="sep"></span>
    <span class="stat"><b class="numeric">{stats.printCount}</b> to print</span>
  </div>

  <div class="group persistence">
    {#if workshop.saveError}
      <span class="stat failed">{workshop.saveError}</span>
    {:else}
      <span
        class="stat saved"
        class:pending={workshop.savedAt === null || persistenceCoordinator.status.kind !== 'synced'}
        class:attention={persistenceCoordinator.status.kind === 'conflict' || persistenceCoordinator.status.kind === 'error'}
        title={persistenceCoordinator.status.message ?? savedLabels.full}
      ><span class="full-label">{savedLabels.full}</span><span class="compact-label">{savedLabels.compact}</span></span>
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

  .compact-label {
    display: none;
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

  .saved.attention {
    color: var(--warning);
  }

  .saved.attention::before {
    background: var(--warning);
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

  @media (max-width: 760px), (max-height: 500px) {
    .status {
      justify-content: flex-end;
      padding-inline: var(--space-3);
      white-space: nowrap;
    }

    .counts,
    .full-label {
      display: none;
    }

    .persistence,
    .stat {
      min-width: 0;
      max-width: 100%;
    }

    .stat {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .compact-label {
      display: inline;
    }
  }
</style>
