<script lang="ts">
  import { EXPORTERS, getExporter, saveExport } from '$lib/export';
  import { setLabel } from '$lib/sets/factory';
  import { workshop } from '$lib/state/workshop.svelte';
  import { persistenceCoordinator } from '$lib/persistence/coordinator.svelte';
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
  async function saveNow(): Promise<void> {
    if (!(await workshop.saveNow())) {
      flash('Could not save — export the set to keep your work.');
      return;
    }
    const kind = persistenceCoordinator.status.kind;
    if (kind === 'synced') flash('Saved locally and to cloud.');
    else if (kind === 'conflict') flash('Saved locally. Cloud conflict needs attention.');
    else if (kind === 'offline' || kind === 'pending' || kind === 'retrying') {
      flash('Saved locally. Cloud save is pending.');
    } else flash('Saved locally.');
  }

  function undo(): void {
    if (workshop.undo()) flash('Undid the last edit.');
  }

  function redo(): void {
    if (workshop.redo()) flash('Redid the last edit.');
  }

  function onHistoryKey(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key !== 'z' && key !== 'y') return;
    const target = event.target;
    // Native text undo preserves the caret and the browser's own typing groups.
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement ||
        target instanceof HTMLElement && target.isContentEditable ||
        target instanceof HTMLInputElement && !['number', 'range', 'checkbox', 'radio', 'button'].includes(target.type)) return;
    event.preventDefault();
    if (key === 'y' || event.shiftKey) redo();
    else undo();
  }

  const historyPointers = new Set<number>();

  function beginPointerHistory(event: PointerEvent): void {
    historyPointers.add(event.pointerId);
    workshop.beginHistoryGesture();
  }

  function finishPointerHistory(event: PointerEvent): void {
    historyPointers.delete(event.pointerId);
    // Let every drag handler commit or roll back before taking the checkpoint.
    queueMicrotask(() => {
      if (historyPointers.size === 0) workshop.endHistoryGesture();
    });
  }

  function finishInterruptedHistory(): void {
    historyPointers.clear();
    queueMicrotask(() => workshop.endHistoryGesture());
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

<svelte:window
  onkeydown={onHistoryKey}
  onpointerdowncapture={beginPointerHistory}
  onpointerup={finishPointerHistory}
  onpointercancel={finishPointerHistory}
  onblur={finishInterruptedHistory}
/>

<div class="bar">
  <button class="doc" type="button" onclick={() => workshop.selectSet()} title="Set details">
    <Icon name="book" size={14} />
    <span class="doc-name">{setName}</span>
  </button>

  <div class="actions">
    {#if message}
      <span class="message" role="status" aria-live="polite">{message}</span>
    {/if}

    <div class="history-actions" role="group" aria-label="Edit history">
      <Button size="sm" iconOnly variant="ghost" aria-label="Undo" title="Undo (Ctrl/⌘+Z)"
        aria-keyshortcuts="Control+Z Meta+Z" disabled={!workshop.canUndo} onclick={undo}>
        <Icon name="undo" size={17} />
      </Button>
      <Button size="sm" iconOnly variant="ghost" aria-label="Redo" title="Redo (Ctrl/⌘+Shift+Z or Ctrl+Y)"
        aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y" disabled={!workshop.canRedo} onclick={redo}>
        <Icon name="redo" size={17} />
      </Button>
    </div>

    <Button size="sm" variant="ghost" title="Save now" aria-label="Save" onclick={saveNow}>
      <Icon name="save" size={14} />
      <span class="action-label">Save</span>
    </Button>

    <div class="export" bind:this={exportHost}>
      <Button
        size="sm"
        variant="secondary"
        aria-label="Export"
        aria-haspopup="menu"
        aria-expanded={exportOpen}
        onclick={() => (exportOpen = !exportOpen)}
      >
        <Icon name="download" size={14} />
        <span class="action-label">Export</span>
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
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    min-width: 0;
    height: 100%;
    padding-inline: var(--space-4);
  }

  .doc {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1 1 auto;
    min-width: 0;
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
    flex: none;
    gap: var(--space-2);
  }

  .history-actions {
    display: flex;
    gap: var(--space-1);
  }

  .history-actions :global(.btn) {
    width: 32px;
    height: 32px;
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
    min-width: 0;
    max-width: 34ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 760px), (max-height: 500px) {
    .bar {
      gap: var(--space-2);
      padding-inline: var(--space-3);
    }

    .doc {
      padding-inline: var(--space-2);
    }

    .actions {
      gap: var(--space-1);
    }

    /* Save feedback is useful, but the title and both permanent actions must
       win the row when space is tight. The full message remains announced by
       its live DOM text while the visual copy gives way. */
    .message {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }

  @media (max-width: 480px) {
    .action-label { display: none; }
  }

  @media (max-width: 760px), (any-pointer: coarse) {
    .actions :global(.btn) {
      min-width: var(--touch-target);
      min-height: var(--touch-target);
    }
  }

  @media (any-pointer: coarse) {
    .doc,
    .export-item {
      min-height: var(--touch-target);
    }
  }
</style>
