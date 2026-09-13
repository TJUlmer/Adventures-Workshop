<script lang="ts">
  /**
   * Every way a set leaves the app, organised by what the author wants next.
   *
   * Lifted out of Set Home because it is no longer only Set Home that offers
   * them: a published set someone else made is looked at and exported, never
   * edited, so the same export paths have to work against a set that is *not*
   * the one open in the workshop. Everything here therefore takes the set as a
   * prop and reads nothing from the store — which is why the paths can be
   * grouped here at all, the exporters having always taken a set rather than
   * reaching for one.
   *
   * The outer panel chrome is the caller's; the decision flow inside is ours.
   */
  import {
    EXPORTERS,
    exportCardPngs,
    exportTabletopSimulator,
    getExporter,
    saveExport,
    tabletopDeckSummary
  } from '$lib/export';
  import { auth } from '$lib/cloud/auth.svelte';
  import { cloudEnabled } from '$lib/cloud/config';
  import { createTtsAssetHost } from '$lib/cloud/tts-assets';
  import {
    applyExportSelection,
    defaultExportSelection,
    isExportSelectionActive
  } from '$lib/sets/export-selection';
  import type { ExportSelection } from '$lib/sets/export-selection';
  import { computeScopedSet, parseScopeKey, scopeKeyOf, scopeOptionsFor } from '$lib/sets/scope';
  import type { PublishScope } from '$lib/sets/scope';
  import { makeIndependentSetCopy } from '$lib/sets/copy';
  import type { AdventureSet } from '$lib/sets/types';
  import { readTtsSavedObjectsPath, writeTtsSavedObjectsPath } from '$lib/storage/settings';
  import { Icon, Select, TextInput } from '$lib/ui';
  import ExportSelector from './ExportSelector.svelte';

  interface Props {
    set: AdventureSet;
    /**
     * Where the print sheets are. Omitted where there is nowhere to go — print
     * sheets are a screen rather than a file, so only a caller that can show
     * one may offer it.
     */
    onprint?: (set: AdventureSet) => void;
    /**
     * The scope the picker below shows and edits — bindable so a caller can
     * both seed it (`SharedSetScreen`'s `characterHint`, one hero pre-selected
     * rather than the whole set) and read every change back out. Uncontrolled
     * where nothing binds it (`SetHome`), which is why the default still lives
     * here rather than requiring every caller to pass one.
     */
    scope?: PublishScope;
    /**
     * Authors download an identity-preserving full backup. A public viewer
     * downloads a freshly identified copy so importing it cannot replace the
     * publisher's working document if both happen to be in one browser.
     */
    projectFileMode?: 'backup' | 'copy';
  }

  let {
    set,
    onprint,
    scope = $bindable({ kind: 'full' }),
    projectFileMode = 'backup'
  }: Props = $props();

  /**
   * Every rendered export below reads from this rather than `set` directly —
   * the one change that makes "export just this hero" apply everywhere at
   * once instead of needing a scoped branch in each renderer. The complete
   * project backup is the deliberate exception: temporary export choices must
   * never turn a backup into a partial document carrying the source set's id.
   */
  const scopedSet = $derived(computeScopedSet(set, scope));

  /* Shared with `SharedSetScreen`'s own picker, so "which scopes exist" can
     only ever be answered one way — see `scopeOptionsFor`. */
  const scopeOptions = $derived(scopeOptionsFor(set));

  /**
   * A finer, ad-hoc prune on top of `scopedSet` — "leave the special deck
   * out of this one export" rather than anything saved or shared. Never
   * persisted, and reset below whenever `scope` changes: an excluded deck id
   * from one scope means nothing once a different hero (or the villain side,
   * or the whole set) is what is being exported, so carrying it forward would
   * either silently exclude nothing or, worse, exclude a same-named deck it
   * was never meant to.
   */
  let selection = $state<ExportSelection>(defaultExportSelection());
  let selectorOpen = $state(false);

  $effect(() => {
    void scope;
    selection = defaultExportSelection();
  });

  /** Every selection-aware export reads this, one level further pruned than `scopedSet`. */
  const finalSet = $derived(applyExportSelection(scopedSet, selection));

  const hasCustomizableContent = $derived(
    scopedSet.decks.length > 0 ||
      scopedSet.figures.length > 0 ||
      scopedSet.threat.enabled ||
      scopedSet.map.enabled
  );
  const selectionActive = $derived(isExportSelectionActive(selection));

  let message = $state<string | null>(null);
  let messageKind = $state<'success' | 'error'>('success');

  function flash(text: string, kind: 'success' | 'error' = 'success'): void {
    message = text;
    messageKind = kind;
    setTimeout(() => (message = null), 3000);
  }

  async function runExport(id: string): Promise<void> {
    const exporter = getExporter(id);
    if (!exporter) return;
    try {
      const source =
        exporter.input === 'selected-content'
          ? finalSet
          : projectFileMode === 'copy'
            ? makeIndependentSetCopy(finalSet)
            : set;
      saveExport(await exporter.run(source));
      flash(`Exported ${exportLabel(exporter)}.`);
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Export failed.', 'error');
    }
  }

  function exportLabel(exporter: (typeof EXPORTERS)[number]): string {
    return exporter.input === 'complete-project' && projectFileMode === 'copy'
      ? 'Editable project copy (.json)'
      : exporter.label;
  }

  function exportDescription(exporter: (typeof EXPORTERS)[number]): string {
    return exporter.input === 'complete-project' && projectFileMode === 'copy'
      ? 'A separate, re-importable copy of the selected content with its own project identity.'
      : exporter.description;
  }

  function printSheets(): void {
    onprint?.(finalSet);
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
      const result = await exportCardPngs(finalSet, {
        bleed: pngBleed,
        onProgress: (done, total) => (pngProgress = `Rendering ${done} of ${total}…`)
      });
      saveExport(result);
      flash(`Exported ${result.filename}.`);
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Export failed.', 'error');
    } finally {
      pngProgress = null;
    }
  }

  /**
   * The Tabletop Simulator saved object. Its own button rather than an entry
   * in `EXPORTERS` because it renders several kinds of asset before deciding
   * whether to host them or put them beside the JSON locally.
   */
  const ttsPiles = $derived(tabletopDeckSummary(finalSet));
  const ttsOnlineAvailable = cloudEnabled();

  let ttsProgress = $state<string | null>(null);
  /** A fresh panel always recommends the multiplayer-ready route. */
  let hostTtsAssets = $state(true);
  let ttsResult = $state<{
    hosting: 'online' | 'local';
    directory: string | null;
    removedCount: number;
    uploadedCount: number;
    reusedCount: number;
    warnings: string[];
  } | null>(null);

  /**
   * This machine's Tabletop Simulator Saved Objects folder — typed in once,
   * remembered in `storage/settings.ts`, and read back here on mount the same
   * way `HomeScreen` reads its storage estimate: fired off rather than
   * awaited, since there is nothing useful to show before it resolves.
   *
   * Read from a browser page rather than asked of the operating system,
   * because there is no way to ask the operating system. It is only needed
   * when the author deliberately turns online hosting off.
   */
  let savedObjectsPath = $state('');
  void readTtsSavedObjectsPath().then((value) => (savedObjectsPath = value));

  function saveSavedObjectsPath(): void {
    void writeTtsSavedObjectsPath(savedObjectsPath);
  }

  /** Refuse an incomplete local export before spending time rendering it. */
  function missingSavedObjectsPath(): boolean {
    return !savedObjectsPath.trim();
  }

  async function exportTts(): Promise<void> {
    if (ttsProgress !== null) return;
    if (!hostTtsAssets && missingSavedObjectsPath()) {
      flash(
        'Enter your Tabletop Simulator Saved Objects folder below, then export again.',
        'error'
      );
      return;
    }
    if (hostTtsAssets && !ttsOnlineAvailable) {
      flash(
        'Online hosting is not configured for this copy of Unmatched Labs. Turn off “Host assets online” to make a local export.',
        'error'
      );
      return;
    }
    ttsProgress = 'Rendering…';
    ttsResult = null;
    try {
      const hosting = hostTtsAssets
        ? { kind: 'online' as const, host: await createTtsAssetHost(finalSet.id) }
        : { kind: 'local' as const, savedObjectsPath };
      const result = await exportTabletopSimulator(finalSet, {
        hosting,
        onProgress: (done, total, label) => (ttsProgress = `${label} — ${done} of ${total}…`)
      });

      if (result.download) saveExport(result.download);
      ttsResult = {
        hosting: result.hosting,
        directory: result.directory,
        removedCount: result.removedCount,
        uploadedCount: result.uploadedCount,
        reusedCount: result.reusedCount,
        warnings: result.warnings
      };
      flash(
        result.hosting === 'online'
          ? `Exported ${result.download?.filename ?? 'the saved object'} for multiplayer.`
          : result.directory
          ? `Wrote ${result.fileCount} files to ${result.directory}.`
          : `Exported ${result.download?.filename ?? 'the bundle'}.`
      );
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Export failed.', 'error');
    } finally {
      ttsProgress = null;
    }
  }
</script>

<div class="exports">
  <section class="selection-step" aria-labelledby="export-content-title">
    <div class="step-heading">
      <span class="step-number">1</span>
      <div>
        <h3 id="export-content-title">Choose content</h3>
        <p>
          This choice applies to print files, card images and Tabletop Simulator.
          {projectFileMode === 'backup'
            ? ' The full project backup always keeps everything.'
            : ' The editable project copy uses this choice too.'}
        </p>
      </div>
    </div>

    <div class="selection-controls">
      <!-- A single-scope set still gets a useful summary, without a picker that
           offers one option and asks a question the author cannot answer differently. -->
      {#if scopeOptions.length > 1}
        <label class="scope">
          <span class="scope-label">Set or character</span>
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
      {:else}
        <div class="scope-summary">
          <span class="scope-label">Set or character</span>
          <strong>{scopeOptions[0]?.label ?? 'Whole set'}</strong>
        </div>
      {/if}

      <!-- A finer prune on top of the scope: temporary for this export and
           offered whenever the chosen content contains something to uncheck. -->
      {#if hasCustomizableContent}
        <button type="button" class="customize" onclick={() => (selectorOpen = true)}>
          <Icon name="list" size={14} />
          <span>
            <strong>{selectionActive ? 'Included items customised' : 'Use all included items'}</strong>
            <small>{selectionActive ? 'Review or reset your selections' : 'Choose individual decks and components'}</small>
          </span>
          <Icon name="chevronRight" size={14} />
        </button>
      {/if}
    </div>
  </section>

  <div class="step-heading output-heading">
    <span class="step-number">2</span>
    <div>
      <h3>Choose an output</h3>
      <p>Pick the destination that matches what you want to do next.</p>
    </div>
  </div>

  <div class="export-groups">
    <section class="export-group" aria-labelledby="print-export-title">
      <header class="group-heading">
        <span class="group-icon"><Icon name="printer" size={17} /></span>
        <div>
          <h4 id="print-export-title">Print &amp; image files</h4>
          <p>Make ready-to-print sheets or individual high-resolution card artwork.</p>
        </div>
      </header>

      <div class="group-actions">
        <!-- Print sheets are a browser screen rather than a file exporter. -->
        {#if onprint}
          <button type="button" class="export" onclick={printSheets}>
            <Icon name="printer" size={14} />
            <span class="export-text">
              <span class="export-label">Open print sheets</span>
              <span class="export-hint">
                True-size A4 or Letter layouts, including a printer-friendly mode.
              </span>
            </span>
          </button>
        {/if}

        <div class="bundle">
          <button type="button" class="export" disabled={pngProgress !== null} onclick={exportPngs}>
            <Icon name="download" size={14} />
            <span class="export-text">
              <span class="export-label">Download individual card PNGs</span>
              <span class="export-hint">
                {pngProgress ?? 'One full-resolution image per card, organised by kind in a .zip.'}
              </span>
            </span>
          </button>

          <label class="bleed">
            <input type="checkbox" bind:checked={pngBleed} disabled={pngProgress !== null} />
            <span>
              <strong>Include bleed</strong>
              <small>Extra artwork beyond the cut line for professional printing.</small>
            </span>
          </label>
        </div>
      </div>
    </section>

    <section class="export-group" aria-labelledby="tts-export-title">
      <header class="group-heading">
        <span class="group-icon"><Icon name="grid" size={17} /></span>
        <div>
          <h4 id="tts-export-title">Tabletop Simulator</h4>
          <p>Build one saved object containing the selected cards, boards and components.</p>
        </div>
      </header>

      <div class="group-actions">
        <div class="bundle tts-bundle">
          <button type="button" class="export" disabled={ttsProgress !== null} onclick={exportTts}>
            <Icon name="download" size={14} />
            <span class="export-text">
              <span class="export-label">Export Tabletop Simulator object</span>
              <span class="export-hint">
                {ttsProgress ??
                  (hostTtsAssets
                    ? `${ttsPiles.length} ${ttsPiles.length === 1 ? 'pile' : 'piles'}, face sheets and components — hosted for multiplayer.`
                    : `${ttsPiles.length} ${ttsPiles.length === 1 ? 'pile' : 'piles'}, face sheets and components — stored locally.`)}
              </span>
            </span>
          </button>

          <label class="tts-hosting">
            <input type="checkbox" bind:checked={hostTtsAssets} disabled={ttsProgress !== null} />
            <span>
              <strong>Host assets online</strong>
              <small>Recommended — other players can see the artwork in multiplayer.</small>
            </span>
          </label>

          {#if hostTtsAssets}
            <p class="tts-note">
              Downloads one saved-object JSON whose generated assets use public links. Put the JSON
              in Tabletop Simulator’s Saved Objects folder; no image folder is needed.
            </p>
            <p class="tts-note account-note">
              {#if auth.isAnonymous}
                These hosted assets belong to this browser’s temporary identity. Sign in from Account
                if you want to keep control of them after clearing browser data or changing devices.
              {:else if auth.signedIn}
                Hosted assets are managed under your signed-in account.
              {:else}
                Your first online export creates a temporary identity for this browser. You can connect
                it to an account later without moving the assets.
              {/if}
            </p>
            {#if !ttsOnlineAvailable}
              <p class="warning">
                Online hosting is not configured for this copy of Unmatched Labs. Turn this option off
                to make a local export.
              </p>
            {/if}
          {:else}
            <p class="tts-note">
              Unzip and copy the <strong>entire folder</strong> into Tabletop Simulator’s Saved Objects
              folder. Other players cannot see local artwork until you upload it through TTS Cloud Manager.
            </p>

            <label class="saved-objects">
              <span class="saved-objects-label">Your Tabletop Simulator Saved Objects folder</span>
              <TextInput
                bind:value={savedObjectsPath}
                onchange={saveSavedObjectsPath}
                placeholder="C:\Users\you\Documents\My Games\Tabletop Simulator\Saves\Saved Objects"
              />
              <span class="saved-objects-hint">
                Saved on this device so future local exports can use it automatically.
              </span>
            </label>
          {/if}

          {#if ttsResult}
            {#if ttsResult.hosting === 'online'}
              <p class="landed hosted-result">
                Hosted {ttsResult.uploadedCount} new
                {ttsResult.uploadedCount === 1 ? 'asset' : 'assets'}; reused {ttsResult.reusedCount}
                unchanged {ttsResult.reusedCount === 1 ? 'asset' : 'assets'}.
              </p>
            {:else if ttsResult.directory}
              <p class="landed">{ttsResult.directory}</p>
              {#if ttsResult.removedCount > 0}
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
      </div>
    </section>

    <section class="export-group" aria-labelledby="project-export-title">
      <header class="group-heading">
        <span class="group-icon"><Icon name="save" size={17} /></span>
        <div>
          <h4 id="project-export-title">Editable project file</h4>
          <p>Keep a portable Unmatched Labs file for backup, transfer or further editing.</p>
        </div>
      </header>

      <div class="group-actions">
        {#each EXPORTERS as exporter (exporter.id)}
          <button
            type="button"
            class="export"
            disabled={!exporter.available}
            onclick={() => runExport(exporter.id)}
          >
            <Icon name="download" size={14} />
            <span class="export-text">
              <span class="export-label">{exportLabel(exporter)}</span>
              <span class="export-hint">
                {exporter.available ? exportDescription(exporter) : 'Not built yet'}
              </span>
            </span>
          </button>
        {/each}
      </div>
    </section>
  </div>

  {#if message}<p class="message" class:error={messageKind === 'error'}>{message}</p>{/if}
</div>

{#if hasCustomizableContent}
  <ExportSelector
    open={selectorOpen}
    set={scopedSet}
    {selection}
    projectFileUsesSelection={projectFileMode === 'copy'}
    onchange={(next) => (selection = next)}
    onclose={() => (selectorOpen = false)}
  />
{/if}

<style>
  .exports {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .selection-step,
  .export-group {
    overflow: hidden;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
  }

  .selection-step {
    padding: var(--space-3);
    background: var(--surface-sunken);
  }

  .step-heading,
  .group-heading {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
  }

  .step-heading h3,
  .step-heading p,
  .group-heading h4,
  .group-heading p {
    margin: 0;
  }

  .step-heading h3 {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
  }

  .step-heading p,
  .group-heading p {
    margin-top: 2px;
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
    text-wrap: pretty;
  }

  .step-number {
    display: grid;
    width: 24px;
    height: 24px;
    flex: none;
    place-items: center;
    border-radius: var(--radius-full);
    background: var(--accent-soft);
    color: var(--text-accent);
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
  }

  .selection-controls {
    display: grid;
    gap: var(--space-2);
    padding-top: var(--space-3);
    margin-top: var(--space-3);
    border-top: 1px solid var(--border-default);
  }

  .output-heading {
    padding: 0 var(--space-1);
  }

  .export-groups {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .group-heading {
    padding: var(--space-3);
    border-bottom: 1px solid var(--border-subtle);
    background: var(--surface-sunken);
  }

  .group-heading h4 {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
  }

  .group-icon {
    display: grid;
    width: 28px;
    height: 28px;
    flex: none;
    place-items: center;
    border: 1px solid var(--border-accent);
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
    color: var(--text-accent);
  }

  .group-actions {
    display: flex;
    flex-direction: column;
    padding: var(--space-1);
  }

  .group-actions > :not(:first-child) {
    border-top: 1px solid var(--border-subtle);
  }

  .scope {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
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

  .scope-summary {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .scope-summary strong {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
  }

  .customize {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--text-secondary);
    text-align: left;
    transition:
      border-color var(--duration-fast) var(--ease-out),
      background-color var(--duration-fast) var(--ease-out);
  }

  .customize > span {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 1px;
  }

  .customize strong {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
  }

  .customize small {
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
  }

  .customize:hover {
    border-color: var(--border-accent);
    background: var(--surface-hover);
  }

  .bundle {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .bleed {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin: 0 var(--space-2) var(--space-2);
    padding: var(--space-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    cursor: pointer;
  }

  .bleed input {
    margin-top: 2px;
    accent-color: var(--accent-press);
  }

  .bleed > span {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .bleed strong {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
  }

  .bleed small {
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
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

  .tts-hosting {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin: var(--space-1) var(--space-2) 0;
    padding: var(--space-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    color: var(--text-default);
    cursor: pointer;
  }

  .tts-hosting input {
    margin-top: 2px;
    accent-color: var(--accent-press);
  }

  .tts-hosting > span {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .tts-hosting strong {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
  }

  .tts-hosting small {
    color: var(--text-muted);
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
  }

  .tts-hosting:has(input:disabled) {
    opacity: 0.6;
    cursor: default;
  }

  .account-note {
    padding-top: 0;
    color: var(--text-tertiary);
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

  .hosted-result {
    font-family: inherit;
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
    font-weight: var(--weight-semibold);
    color: var(--text-accent);
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

  .message.error {
    color: var(--danger);
  }
</style>
