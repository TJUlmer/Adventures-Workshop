<script lang="ts">
  import { EXPORTERS, getExporter, saveExport } from '$lib/export';
  import { setLabel } from '$lib/sets/factory';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Button, Icon } from '$lib/ui';

  let message = $state<string | null>(null);

  const setName = $derived(setLabel(workshop.adventure));

  function flash(text: string): void {
    message = text;
    setTimeout(() => (message = null), 2600);
  }

  /**
   * Autosave already runs, so this is the manual retry: it reports what
   * happened either way, which the debounced save cannot do at the moment the
   * author is wondering whether their work is safe.
   */
  function saveNow(): void {
    flash(workshop.saveNow() ? 'Saved.' : 'Could not save — export the set to keep your work.');
  }

  let exportOpen = $state(false);
  let exportHost = $state<HTMLDivElement | null>(null);

  async function exportSet(id: string): Promise<void> {
    exportOpen = false;
    const exporter = getExporter(id);
    if (!exporter) return;
    try {
      saveExport(await exporter.run(workshop.adventure));
      flash(`Exported ${exporter.label}.`);
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Export failed.');
    }
  }

  /** Close on an outside click or Escape, the way a menu should. */
  $effect(() => {
    if (!exportOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (exportHost && !exportHost.contains(event.target as Node)) exportOpen = false;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') exportOpen = false;
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  });

</script>

<div class="bar">
  <div class="brand">
    <span class="mark" aria-hidden="true"></span>
    <span class="wordmark">Adventures Workshop</span>
  </div>

  <button class="doc" type="button" onclick={() => workshop.selectSet()} title="Set details">
    <Icon name="book" size={14} />
    <span class="doc-name">{setName}</span>
  </button>

  <div class="actions">
    {#if message}
      <span class="message">{message}</span>
    {/if}

    <!-- Importing lives on the Library, where opening a set already happens. -->
    <Button size="sm" variant="ghost" title="Save to this browser" onclick={saveNow}>
      <Icon name="save" size={14} />
      Save
    </Button>

    <div class="export" bind:this={exportHost}>
      <Button
        size="sm"
        variant="secondary"
        aria-haspopup="menu"
        aria-expanded={exportOpen}
        onclick={() => (exportOpen = !exportOpen)}
      >
        <Icon name="download" size={14} />
        Export
      </Button>

      {#if exportOpen}
        <div class="export-menu" role="menu">
          {#each EXPORTERS as exporter (exporter.id)}
            <button
              type="button"
              class="export-item"
              role="menuitem"
              disabled={!exporter.available}
              onclick={() => exportSet(exporter.id)}
            >
              <span class="export-label">{exporter.label}</span>
              <span class="export-hint">
                {exporter.available ? exporter.description : 'Not built yet'}
              </span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .bar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: var(--space-4);
    height: 100%;
    padding-inline: var(--space-4);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .mark {
    width: 12px;
    height: 12px;
    flex: none;
    rotate: 45deg;
    border-radius: 2px;
    background: linear-gradient(140deg, var(--gold-400), var(--gold-600));
    box-shadow: 0 0 12px color-mix(in oklab, var(--brand-gold) 45%, transparent);
  }

  .wordmark {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-tight);
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .doc {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    max-width: 42ch;
    height: 26px;
    padding-inline: var(--space-3);
    border-radius: var(--radius-full);
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
    color: var(--text-tertiary);
    transition:
      color var(--duration-fast) var(--ease-out),
      border-color var(--duration-fast) var(--ease-out);
  }

  .doc:hover {
    color: var(--text-primary);
    border-color: var(--border-strong);
  }

  .doc-name {
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .export {
    position: relative;
  }

  .export-menu {
    position: absolute;
    top: calc(100% + var(--space-2));
    right: 0;
    z-index: var(--z-dropdown);
    min-width: 280px;
    padding: var(--space-1);
    border-radius: var(--radius-md);
    background: var(--surface-overlay);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-lg);
  }

  .export-item {
    display: flex;
    flex-direction: column;
    gap: 1px;
    width: 100%;
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    text-align: left;
    color: var(--text-secondary);
    transition: background-color var(--duration-fast) var(--ease-out);
  }

  .export-item:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .export-item:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .export-label {
    font-size: var(--text-sm);
  }

  .export-hint {
    font-size: var(--text-2xs);
    color: var(--text-muted);
    text-wrap: pretty;
  }

  .message {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    max-width: 34ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
