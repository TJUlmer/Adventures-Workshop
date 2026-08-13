<script lang="ts">
  /**
   * The global level: every set you have, and the way into a new one.
   *
   * This is the only screen that exists outside a set, which is what makes the
   * rest of the app able to assume a set is always open.
   */
  import { parseSetFile } from '$lib/export/json';
  import { cloudEnabled } from '$lib/cloud/config';
  import { navigation } from '$lib/state/navigation.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import { saveSet } from '$lib/storage/library';
  import { Button, EmptyState, Icon } from '$lib/ui';

  let fileInput = $state<HTMLInputElement | null>(null);
  let message = $state<string | null>(null);
  let confirmingDelete = $state<string | null>(null);

  const entries = $derived(workshop.library);

  function flash(text: string): void {
    message = text;
    setTimeout(() => (message = null), 3000);
  }

  function formatDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Never';
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  async function importSet(event: Event & { currentTarget: HTMLInputElement }): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    const result = parseSetFile(await file.text());
    if (!result.ok) {
      flash(result.error);
      return;
    }
    await saveSet(result.set);
    await workshop.refreshLibrary();
    flash(`Imported “${result.set.name}”.`);
  }
</script>

<div class="library">
  <header class="head">
    <div class="brand">
      <span class="mark" aria-hidden="true"></span>
      <div class="titles">
        <h1 class="title">Adventures Workshop</h1>
        <p class="subtitle">Everything lives inside a set.</p>
      </div>
    </div>

    <div class="actions">
      <input
        bind:this={fileInput}
        class="sr-only"
        type="file"
        accept=".json,application/json"
        onchange={importSet}
      />
      <!--
        The way into the gallery. Beside Import rather than promoted above New
        set: someone opening the app usually came to work on their own set, and
        browsing is the occasional errand.
      -->
      {#if cloudEnabled()}
        <Button variant="ghost" onclick={() => navigation.openGallery()}>
          <Icon name="layers" size={14} />
          Browse gallery
        </Button>
      {/if}
      <Button variant="ghost" onclick={() => fileInput?.click()}>
        <Icon name="upload" size={14} />
        Import
      </Button>
      <Button variant="primary" onclick={() => void workshop.createSet()}>
        <Icon name="plus" size={14} />
        New set
      </Button>
    </div>
  </header>

  {#if message}
    <p class="message">{message}</p>
  {/if}

  <div class="body scroll-y">
    {#if entries.length === 0}
      <EmptyState
        icon="book"
        title="No sets yet"
        description="A set holds a villain, its minions, and every card that goes with them."
      >
        {#snippet actions()}
          <Button variant="primary" onclick={() => void workshop.createSet()}>
            <Icon name="plus" size={14} />
            Create your first set
          </Button>
        {/snippet}
      </EmptyState>
    {:else}
      <ul class="grid">
        {#each entries as entry (entry.id)}
          <li class="card">
            <button type="button" class="open" onclick={() => void workshop.openSet(entry.id)}>
              <span class="card-title">{entry.name || 'Untitled Adventure'}</span>
              {#if entry.subtitle}<span class="card-subtitle">{entry.subtitle}</span>{/if}

              <!--
                A copy says so before it is opened. `originAuthor` is absent
                rather than empty on a set authored here, and empty on one
                copied from a published set whose author had no display name —
                so the badge distinguishes the two. The revision rides beside
                it for the same reason `SetHome`'s own lineage line carries
                one: it is what tells two forks of the same set apart on a
                shelf that otherwise shows the same name twice.
              -->
              {#if entry.originAuthor !== undefined}
                <span class="lineage">
                  {entry.originAuthor ? `Based on ${entry.originAuthor}’s set` : 'Based on a published set'}
                  {#if entry.originRevision !== undefined}
                    <span class="numeric">· revision {entry.originRevision}</span>
                  {/if}
                </span>
              {/if}

              <span class="stats">
                <span class="stat"><b class="numeric">{entry.characterCount}</b> characters</span>
                <span class="stat"><b class="numeric">{entry.cardCount}</b> cards</span>
              </span>

              <span class="meta">
                <span>{formatDate(entry.updatedAt)}</span>
                <span class="numeric">{formatSize(entry.bytes)}</span>
              </span>
            </button>

            <div class="card-actions">
              <button
                type="button"
                class="ghost"
                title="Duplicate"
                aria-label="Duplicate set"
                onclick={() => void workshop.duplicateSet(entry.id)}
              >
                <Icon name="copy" size={13} />
              </button>

              {#if confirmingDelete === entry.id}
                <button type="button" class="ghost danger" onclick={() => void workshop.removeSet(entry.id)}>
                  Delete
                </button>
                <button type="button" class="ghost" onclick={() => (confirmingDelete = null)}>
                  Cancel
                </button>
              {:else}
                <button
                  type="button"
                  class="ghost"
                  title="Delete"
                  aria-label="Delete set"
                  onclick={() => (confirmingDelete = entry.id)}
                >
                  <Icon name="trash" size={13} />
                </button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .library {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--surface-canvas);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-5);
    padding: var(--space-7) var(--space-9) var(--space-6);
    border-bottom: 1px solid var(--border-subtle);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .mark {
    width: 22px;
    height: 22px;
    rotate: 45deg;
    border-radius: 4px;
    background: linear-gradient(140deg, var(--gold-400), var(--gold-600));
    box-shadow: 0 0 20px color-mix(in oklab, var(--brand-gold) 45%, transparent);
  }

  .titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .title {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-tight);
    color: var(--text-primary);
  }

  .subtitle {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .actions {
    display: flex;
    gap: var(--space-2);
  }

  .message {
    padding: var(--space-2) var(--space-9);
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    background: var(--surface-sunken);
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    padding: var(--space-7) var(--space-9) var(--space-10);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: var(--space-4);
  }

  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-lg);
    background: var(--surface-base);
    border: 1px solid var(--border-subtle);
    box-shadow: inset 0 1px 0 var(--edge-highlight);
    transition:
      border-color var(--duration-fast) var(--ease-out),
      translate var(--duration-fast) var(--ease-out);
  }

  .card:hover {
    border-color: var(--border-strong);
    translate: 0 -2px;
  }

  .open {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-5) var(--space-5) var(--space-3);
    text-align: left;
  }

  .card-title {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    color: var(--text-primary);
    letter-spacing: var(--tracking-tight);
  }

  .card-subtitle {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  /* A credit, not a warning — quiet enough to skip and present enough to find. */
  .lineage {
    align-self: flex-start;
    margin-top: var(--space-2);
    padding: 1px var(--space-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    font-size: var(--text-2xs);
    color: var(--text-tertiary);
  }

  .stats {
    display: flex;
    gap: var(--space-4);
    margin-top: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .stat b {
    color: var(--text-secondary);
    font-weight: var(--weight-semibold);
  }

  .meta {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    font-size: var(--text-2xs);
    color: var(--text-muted);
    opacity: 0.75;
  }

  .card-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-1);
    padding: 0 var(--space-3) var(--space-3);
  }

  .ghost {
    display: inline-grid;
    grid-auto-flow: column;
    place-items: center;
    gap: var(--space-1);
    height: 24px;
    padding-inline: var(--space-2);
    border-radius: var(--radius-xs);
    font-size: var(--text-2xs);
    color: var(--text-muted);
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .ghost:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .ghost.danger:hover {
    color: var(--danger);
  }
</style>
