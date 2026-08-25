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
  import { untrack } from 'svelte';
  import { characterLabel } from '$lib/characters/factory';
  import {
    EXPORTERS,
    exportCardPngs,
    exportTabletopSimulator,
    getExporter,
    saveExport,
    tabletopDeckSummary
  } from '$lib/export';
  import { charactersByRole } from '$lib/sets/queries';
  import { computeScopedSet, parseScopeKey, scopeKeyOf } from '$lib/sets/scope';
  import type { PublishScope } from '$lib/sets/scope';
  import type { AdventureSet } from '$lib/sets/types';
  import { readTtsSavedObjectsPath, writeTtsSavedObjectsPath } from '$lib/storage/settings';
  import { Icon, Select, TextInput } from '$lib/ui';

  interface Props {
    set: AdventureSet;
    /**
     * Where the print sheets are. Omitted where there is nowhere to go — print
     * sheets are a screen rather than a file, so only a caller that can show
     * one may offer it.
     */
    onprint?: () => void;
    /**
     * The scope to default the picker to below — a visitor who arrived here by
     * clicking one specific hero inside a box with no listing of its own
     * (`SharedSetScreen`'s `characterHint`) gets that hero pre-selected rather
     * than the whole set, without a separate screen. Defaults to the whole set
     * everywhere else, `SetHome` included.
     */
    initialScope?: PublishScope;
    /**
     * Fired whenever the picker below changes, including once for the
     * starting value. `SharedSetScreen` uses this to make its own read-only
     * overview follow the same pick — "what will this export" and "what am I
     * looking at" are one question there, so they share one control rather
     * than the page growing a second, redundant selector.
     */
    onscopechange?: (scope: PublishScope) => void;
  }

  let { set, onprint, initialScope, onscopechange }: Props = $props();

  /**
   * Every export below reads from this, never from `set` directly — the one
   * change that makes "export just this hero" apply everywhere at once
   * instead of needing a scoped branch in each exporter. Reuses
   * `sets/scope.ts`'s `computeScopedSet`, the same slice a scoped *publish*
   * takes — the only difference is this one is computed on the visitor's own
   * machine, from a set they already have the whole of, and thrown away
   * rather than sent anywhere.
   */
  let scope = $state<PublishScope>(untrack(() => initialScope ?? { kind: 'full' }));
  const scopedSet = $derived(computeScopedSet(set, scope));

  $effect(() => {
    onscopechange?.(scope);
  });

  const heroes = $derived(charactersByRole(set, 'hero'));
  /* Villain-side content is one bundle and never split further — same
     reasoning as `SharePanel`'s own `hasVillainSide`. */
  const hasVillainSide = $derived(
    charactersByRole(set, 'villain').length > 0 || charactersByRole(set, 'minion').length > 0
  );
  /* Only worth offering once there is something to slice — a set with one
     hero and no villain has nothing a picker would do. */
  const scopeOptions = $derived([
    { value: 'full', label: 'Whole set' },
    ...heroes.map((hero) => ({ value: `hero:${hero.id}`, label: characterLabel(hero) })),
    ...(hasVillainSide ? [{ value: 'villain', label: 'Villain side' }] : [])
  ]);

  let message = $state<string | null>(null);

  function flash(text: string): void {
    message = text;
    setTimeout(() => (message = null), 3000);
  }

  async function runExport(id: string): Promise<void> {
    const exporter = getExporter(id);
    if (!exporter) return;
    try {
      saveExport(await exporter.run(scopedSet));
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
      const result = await exportCardPngs(scopedSet, {
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
  const ttsPiles = $derived(tabletopDeckSummary(scopedSet));

  let ttsProgress = $state<string | null>(null);
  let ttsResult = $state<{
    directory: string | null;
    removedCount: number;
    warnings: string[];
  } | null>(null);

  /**
   * This machine's Tabletop Simulator Saved Objects folder — typed in once,
   * remembered in `storage/settings.ts`, and read back here on mount the same
   * way `HomeScreen` reads its storage estimate: fired off rather than
   * awaited, since there is nothing useful to show before it resolves.
   *
   * Read from a browser page rather than asked of the operating system,
   * because there is no way to ask the operating system — see
   * `tts-bundle.ts`'s `TtsBundleOptions.savedObjectsPath` for what this
   * actually buys: every export's JSON arrives with real `file://` image
   * addresses already in it, in any browser, with no dev server involved.
   */
  let savedObjectsPath = $state('');
  void readTtsSavedObjectsPath().then((value) => (savedObjectsPath = value));

  function saveSavedObjectsPath(): void {
    void writeTtsSavedObjectsPath(savedObjectsPath);
  }

  async function exportTts(): Promise<void> {
    if (ttsProgress !== null) return;
    ttsProgress = 'Rendering…';
    ttsResult = null;
    try {
      const result = await exportTabletopSimulator(scopedSet, {
        savedObjectsPath,
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
    Only worth showing once there is an actual choice to make — a set with one
    hero and no villain has nothing a picker would do, same reasoning as
    `SharePanel`'s own scope picker. Every export below reads `scopedSet`, so
    changing this changes what all four buttons produce at once.
  -->
  {#if scopeOptions.length > 1}
    <label class="scope">
      <span class="scope-label">Export</span>
      <Select
        value={scopeKeyOf(scope)}
        options={scopeOptions}
        onchange={(key) => (scope = parseScopeKey(key))}
      />
      {#if scope.kind !== 'full'}
        <span class="scope-hint">
          Just {scopeOptions.find((option) => option.value === scopeKeyOf(scope))?.label} —
          not the rest of {set.name || 'this set'}.
        </span>
      {/if}
    </label>
  {/if}

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

    <!--
      The one sentence someone needs before TTS will actually show this: not
      "unzip and read the JSON", not "unzip and copy the .json somewhere" —
      the whole folder, wherever it lands. Said plainly, right under the
      button, rather than left for `HOW_TO_IMPORT.txt` to be the only place
      it appears — that file only gets opened by someone already stuck.
    -->
    <p class="tts-note">
      After exporting: unzip the folder, then copy the <strong>entire unzipped
      folder</strong> into your Tabletop Simulator Saved Objects folder.
    </p>

    <!--
      Typed once, remembered from then on. This is what lets an export's JSON
      arrive with real image addresses already in it on a plain deployed page
      with no dev server behind it — the same outcome `HOW_TO_IMPORT.txt`
      describes for that dev-server case, reached a different way. Left blank,
      nothing about the export changes from how it already behaved.
    -->
    <label class="saved-objects">
      <span class="saved-objects-label">Tabletop Simulator Saved Objects folder</span>
      <TextInput
        bind:value={savedObjectsPath}
        onchange={saveSavedObjectsPath}
        placeholder="C:\Users\you\Documents\My Games\Tabletop Simulator\Saves\Saved Objects"
      />
      <span class="saved-objects-hint">
        Set this once and every export's images already point here — no editing
        the JSON by hand. Find it by opening that folder in File Explorer or
        Finder and copying the path from its address bar.
      </span>
    </label>

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

  .scope {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    padding-bottom: var(--space-3);
    margin-bottom: var(--space-1);
    border-bottom: 1px solid var(--border-subtle);
  }

  .scope-label {
    font-size: var(--text-2xs);
    color: var(--text-tertiary);
  }

  .scope-hint {
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
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
    accent-color: var(--accent-press);
  }

  .bleed:has(input:disabled) {
    opacity: 0.5;
    cursor: default;
  }

  .tts-note {
    margin: 0;
    padding: var(--space-2);
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
  }

  .tts-note strong {
    color: var(--text-default);
    font-weight: var(--weight-semibold);
  }

  .saved-objects {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-2) 0;
  }

  .saved-objects-label {
    font-size: var(--text-2xs);
    color: var(--text-tertiary);
  }

  .saved-objects-hint {
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
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
