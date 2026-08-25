<script lang="ts">
  import { cloudEnabled } from '$lib/cloud/config';
  import AccountMenu from '$lib/components/cloud/AccountMenu.svelte';
  import { EXPORTERS, getExporter, saveExport } from '$lib/export';
  import { navigation } from '$lib/state/navigation.svelte';
  import { setLabel } from '$lib/sets/factory';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Button, Icon, ThemeToggle } from '$lib/ui';

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
    flash((await workshop.saveNow()) ? 'Saved.' : 'Could not save — export the set to keep your work.');
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
  <!--
    The one piece of chrome here that looked clickable and was not — a brand
    mark in the top-left corner reads as "go home" everywhere on the web, and
    this one sat right beside a button that actually does that ("Home", added
    when Home replaced the library page) without itself doing anything.
    `workshop.closeSet`, not a bare `navigation.openHome`, for the same reason
    that button uses it: leaving a set is what refreshes the library index
    and clears "last open".
  -->
  <button class="brand" type="button" onclick={() => void workshop.closeSet()} title="Home">
    <span class="mark" aria-hidden="true"></span>
    <span class="wordmark">Adventures Workshop</span>
  </button>

  <button class="doc" type="button" onclick={() => workshop.selectSet()} title="Set details">
    <Icon name="book" size={14} />
    <span class="doc-name">{setName}</span>
  </button>

  <div class="actions">
    {#if message}
      <span class="message">{message}</span>
    {/if}

    <!--
      Both Home and the gallery live here now, as a pair — the same "where
      else could I be" pairing Home itself offers. This replaces `SetNav`'s
      old back-chevron rather than sitting beside it: two controls that both
      mean "leave this set" is redundant chrome, not a convenience, and this
      one is where an author is already looking. `workshop.closeSet`, not a
      bare `navigation.openHome`, for the reason `SetNav`'s own back button
      used it — leaving a set is what refreshes the library index and clears
      "last open", not just a view change.
    -->
    <Button size="sm" variant="ghost" title="Your sets" onclick={() => void workshop.closeSet()}>
      <Icon name="grid" size={14} />
      Home
    </Button>

    <!--
      The way into the gallery, from wherever the author happens to be. It used
      to live only on the Library, which meant browsing what other people had
      made was a thing you could only think of before opening a set.

      Importing still lives on the Library, where opening a set already happens.
    -->
    {#if cloudEnabled()}
      <Button
        size="sm"
        variant="ghost"
        title="Sets other people have published"
        onclick={() => navigation.openGallery()}
      >
        <Icon name="layers" size={14} />
        Gallery
      </Button>
    {/if}

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

    <ThemeToggle />

    <AccountMenu />
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
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    border-radius: var(--radius-sm);
  }

  .brand:hover .wordmark {
    color: var(--text-primary);
  }

  .mark {
    width: 12px;
    height: 12px;
    flex: none;
    rotate: 45deg;
    border-radius: 2px;
    background: linear-gradient(140deg, var(--accent-hover), var(--accent-press));
    box-shadow: 0 0 12px color-mix(in oklab, var(--accent-press) 45%, transparent);
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
