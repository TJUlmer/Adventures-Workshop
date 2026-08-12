<script lang="ts">
  /**
   * Every way a set leaves the app, as one list.
   *
   * Lifted out of Set Home because it is no longer only Set Home that offers
   * them: a published set someone else made is looked at and exported, never
   * edited, so the same four buttons have to work against a set that is *not*
   * the one open in the workshop. Everything here therefore takes the set as a
   * prop and reads nothing from the store — which is why they could move at
   * all, the exporters having always taken a set rather than reaching for one.
   *
   * The panel chrome is the caller's: this is the list, not the box round it.
   */
  import {
    EXPORTERS,
    exportCardPngs,
    exportTabletopSimulator,
    getExporter,
    saveExport,
    tabletopDeckSummary
  } from '$lib/export';
  import type { AdventureSet } from '$lib/sets/types';
  import { Icon } from '$lib/ui';

  interface Props {
    set: AdventureSet;
    /**
     * Where the print sheets are. Omitted where there is nowhere to go — print
     * sheets are a screen rather than a file, so only a caller that can show
     * one may offer it.
     */
    onprint?: () => void;
  }

  let { set, onprint }: Props = $props();

  let message = $state<string | null>(null);

  function flash(text: string): void {
    message = text;
    setTimeout(() => (message = null), 3000);
  }

  async function runExport(id: string): Promise<void> {
    const exporter = getExporter(id);
    if (!exporter) return;
    try {
      saveExport(await exporter.run(set));
      flash(`Exported ${exporter.label}.`);
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Export failed.');
    }
  }

  /**
   * Every card as its own PNG, in one archive. Rendering is per-card and not
   * quick, so the button reports where it has got to rather than appearing to
   * hang — and refuses to start twice.
   */
  let pngBleed = $state(false);
  let pngProgress = $state<string | null>(null);

  async function exportPngs(): Promise<void> {
    if (pngProgress !== null) return;
    pngProgress = 'Rendering…';
    try {
      const result = await exportCardPngs(set, {
        bleed: pngBleed,
        onProgress: (done, total) => (pngProgress = `Rendering ${done} of ${total}…`)
      });
      saveExport(result);
      flash(`Exported ${result.filename}.`);
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      pngProgress = null;
    }
  }

  /**
   * The Tabletop Simulator bundle. Its own button rather than an entry in
   * `EXPORTERS` because it does not produce a file — it produces a folder, and
   * where that folder went is the thing the author most needs told.
   */
  const ttsPiles = $derived(tabletopDeckSummary(set));

  let ttsProgress = $state<string | null>(null);
  let ttsResult = $state<{
    directory: string | null;
    removedCount: number;
    warnings: string[];
  } | null>(null);

  async function exportTts(): Promise<void> {
    if (ttsProgress !== null) return;
    ttsProgress = 'Rendering…';
    ttsResult = null;
    try {
      const result = await exportTabletopSimulator(set, {
        onProgress: (done, total, label) => (ttsProgress = `${label} — ${done} of ${total}…`)
      });

      if (result.download) saveExport(result.download);
      ttsResult = {
        directory: result.directory,
        removedCount: result.removedCount,
        warnings: result.warnings
      };
      flash(
        result.directory
          ? `Wrote ${result.fileCount} files to ${result.directory}.`
          : `Exported ${result.download?.filename ?? 'the bundle'}.`
      );
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      ttsProgress = null;
    }
  }
</script>

<div class="exports">
  <!--
    One PNG per card, foldered by what it is. Bleed is the printer's question,
    not the card's, so it sits with the button rather than being two
    near-identical entries.
  -->
  <div class="bundle">
    <button type="button" class="export" disabled={pngProgress !== null} onclick={exportPngs}>
      <Icon name="download" size={13} />
      <span class="export-text">
        <span class="export-label">All cards as PNGs (.zip)</span>
        <span class="export-hint">
          {pngProgress ?? 'One image per card, in folders by kind, under the set’s name.'}
        </span>
      </span>
    </button>

    <label class="bleed">
      <input type="checkbox" bind:checked={pngBleed} disabled={pngProgress !== null} />
      Include bleed
    </label>
  </div>

  <!--
    The whole set as one Tabletop Simulator saved object: a pile per figure, the
    initiative and event decks at their own scale, the threat track as a card,
    and every component behind them.
  -->
  <div class="bundle">
    <button type="button" class="export" disabled={ttsProgress !== null} onclick={exportTts}>
      <Icon name="download" size={13} />
      <span class="export-text">
        <span class="export-label">Tabletop Simulator (one saved object)</span>
        <span class="export-hint">
          {ttsProgress ??
            `${ttsPiles.length} ${ttsPiles.length === 1 ? 'pile' : 'piles'}, face sheets and components — as a folder here, or a .zip to your downloads.`}
        </span>
      </span>
    </button>

    {#if ttsResult}
      {#if ttsResult.directory}
        <p class="landed">{ttsResult.directory}</p>
        {#if ttsResult.removedCount > 0}
          <!-- Images are named after their contents so TTS cannot cache a stale
               one, which leaves the previous file behind. Said out loud so the
               tidying is visibly happening. -->
          <p class="landed">
            Cleared {ttsResult.removedCount} superseded
            {ttsResult.removedCount === 1 ? 'file' : 'files'}.
          </p>
        {/if}
      {/if}
      {#each ttsResult.warnings as warning, index (index)}
        <p class="warning">{warning}</p>
      {/each}
    {/if}
  </div>

  <!--
    The print sheets are a screen rather than a file, so they sit with the
    exports but do not go through `EXPORTERS`: what they produce is paper, and
    the browser's own dialogue is what produces it.
  -->
  {#if onprint}
    <button type="button" class="export" onclick={onprint}>
      <Icon name="printer" size={13} />
      <span class="export-text">
        <span class="export-label">Print sheets</span>
        <span class="export-hint">
          Cards laid out at true size on A4 or Letter, with a printer-friendly
          black-and-white mode.
        </span>
      </span>
    </button>
  {/if}

  {#each EXPORTERS as exporter (exporter.id)}
    <button
      type="button"
      class="export"
      disabled={!exporter.available}
      onclick={() => runExport(exporter.id)}
    >
      <Icon name="download" size={13} />
      <span class="export-text">
        <span class="export-label">{exporter.label}</span>
        <span class="export-hint">
          {exporter.available ? exporter.description : 'Not built yet'}
        </span>
      </span>
    </button>
  {/each}

  {#if message}<p class="message">{message}</p>{/if}
</div>

<style>
  .exports {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  /* The bleed choice belongs to the button above it, so they share a box. */
  .bundle {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding-bottom: var(--space-2);
    margin-bottom: var(--space-1);
    border-bottom: 1px solid var(--border-subtle);
  }

  .bleed {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-left: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
    cursor: pointer;
  }

  .bleed input {
    accent-color: var(--brand-gold);
  }

  .bleed:has(input:disabled) {
    opacity: 0.5;
    cursor: default;
  }

  /* Where the export landed, and anything it could not take with it. */
  .landed,
  .warning {
    padding-left: var(--space-2);
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
    overflow-wrap: anywhere;
  }

  .landed {
    color: var(--text-tertiary);
    font-family: var(--font-mono, monospace);
  }

  .warning {
    color: var(--warning);
  }

  .export {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    gap: var(--space-3);
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    text-align: left;
    color: var(--text-secondary);
    transition: background-color var(--duration-fast) var(--ease-out);
  }

  .export:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .export:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .export-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
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
    padding-left: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }
</style>
