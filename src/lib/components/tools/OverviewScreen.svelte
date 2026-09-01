<script lang="ts">
  /**
   * The author's final-review workspace around `AssetsOverview`.
   *
   * The inventory remains a pure renderer because shared sets use it too. This
   * screen owns the author-only parts: one scope shared by what is visible and
   * what is exported, durable-save feedback, and the full export panel.
   */
  import ExportPanel from '$lib/components/export/ExportPanel.svelte';
  import { setStats } from '$lib/sets/queries';
  import { computeScopedSet, parseScopeKey, scopeKeyOf, scopeOptionsFor } from '$lib/sets/scope';
  import type { PublishScope } from '$lib/sets/scope';
  import { navigation } from '$lib/state/navigation.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Button, Icon, Select } from '$lib/ui';
  import AssetsOverview from './AssetsOverview.svelte';

  const set = $derived(workshop.adventure);
  let scope = $state<PublishScope>({ kind: 'full' });
  const shown = $derived(computeScopedSet(set, scope));
  const options = $derived(scopeOptionsFor(set));
  const stats = $derived(setStats(shown));
  /* 260px was the old maximum. It is now the comfortable starting point in
     the middle of the widened range, so cards can grow as well as shrink. */
  let cardSize = $state(260);
  let saving = $state(false);

  const savedLabel = $derived.by(() => {
    if (workshop.saveError) return workshop.saveError;
    if (workshop.savedAt === null) return 'Not saved yet';
    const time = new Date(workshop.savedAt);
    return `Saved locally at ${time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  });

  async function saveNow(): Promise<void> {
    saving = true;
    try {
      await workshop.saveNow();
    } finally {
      saving = false;
    }
  }
</script>

<div class="screen">
  <main class="main">
    <header class="overview-head">
      <div class="heading">
        <span class="eyebrow">Set tool</span>
        <h1>Overview</h1>
        <p>Every card, board, and physical component in the set.</p>
      </div>

      <div class="summary" aria-label="Visible set totals">
        <span><b class="numeric">{stats.characterCount}</b> characters</span>
        <span><b class="numeric">{stats.cardCount}</b> designs</span>
        <span><b class="numeric">{stats.printCount}</b> to print</span>
        <span><b class="numeric">{shown.figures.length}</b> components</span>
      </div>

      <div class="review-controls">
        {#if options.length > 1}
          <label class="showing">
            <span>Showing</span>
            <Select
              value={scopeKeyOf(scope)}
              options={options}
              onchange={(key) => (scope = parseScopeKey(key))}
            />
          </label>
        {/if}

        <label class="zoom">
          <Icon name="search" size={12} />
          <span>Card size</span>
          <input
            type="range"
            min="110"
            max="410"
            step="10"
            value={cardSize}
            oninput={(event) => (cardSize = event.currentTarget.valueAsNumber)}
          />
        </label>
      </div>
    </header>

    <AssetsOverview
      set={shown}
      heading={false}
      showZoom={false}
      {cardSize}
      onCardSizeChange={(value) => (cardSize = value)}
    />
  </main>

  <aside class="rail scroll-y">
    <section class="rail-panel save-panel">
      <span class="rail-kicker">Save</span>
      <div class="save-state" class:failed={Boolean(workshop.saveError)}>
        <span class="save-dot"></span>
        <span>{savedLabel}</span>
      </div>
      <Button variant="secondary" block disabled={saving} onclick={saveNow}>
        <Icon name="save" size={14} />
        {saving ? 'Saving…' : 'Save now'}
      </Button>
    </section>

    <section class="rail-panel export-panel">
      <div>
        <span class="rail-kicker">Export</span>
        <h2>Take the set to the table</h2>
        <p>Exports follow the same “Showing” selection as the review.</p>
      </div>
      <ExportPanel {set} onprint={() => navigation.go('print')} bind:scope />
    </section>
  </aside>
</div>

<style>
  .screen {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 330px;
    height: 100%;
    min-height: 0;
    background: var(--surface-canvas);
  }

  .main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .overview-head {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
    padding: var(--space-4) var(--space-8);
    border-bottom: 1px solid var(--border-subtle);
    background: var(--surface-base);
  }

  .heading {
    flex: none;
  }

  .heading h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-tight);
    color: var(--text-primary);
  }

  .heading p {
    margin: 1px 0 0;
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .eyebrow,
  .rail-kicker {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .review-controls {
    display: flex;
    align-items: flex-end;
    justify-content: flex-end;
    gap: var(--space-4);
    flex: none;
  }

  .showing,
  .zoom {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .showing {
    align-items: flex-end;
  }

  .showing > span {
    padding-bottom: 7px;
  }

  .zoom input {
    width: 112px;
  }

  .summary {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    justify-content: center;
    min-width: 0;
  }

  .summary span {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    background: var(--surface-base);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .summary b {
    font-size: var(--text-xs);
    color: var(--text-primary);
  }

  .rail {
    min-height: 0;
    padding: var(--space-5);
    border-left: 1px solid var(--border-default);
    background: var(--surface-sunken);
  }

  .rail-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    background: var(--surface-base);
    box-shadow: var(--shadow-sm);
  }

  .rail-panel + .rail-panel {
    margin-top: var(--space-4);
  }

  .rail-panel h2 {
    margin: var(--space-1) 0 0;
    font-size: var(--text-md);
    color: var(--text-primary);
  }

  .rail-panel p {
    margin: var(--space-1) 0 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
  }

  .save-state {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-tertiary);
  }

  .save-dot {
    width: 7px;
    height: 7px;
    margin-top: 4px;
    flex: none;
    border-radius: var(--radius-full);
    background: var(--success);
  }

  .save-state.failed {
    color: var(--warning);
  }

  .save-state.failed .save-dot {
    background: var(--warning);
  }

  @media (max-width: 980px) {
    .screen {
      grid-template-columns: minmax(0, 1fr) 286px;
    }

    .overview-head {
      align-items: flex-start;
      flex-direction: column;
    }

    .summary {
      justify-content: flex-start;
    }

    .review-controls {
      justify-content: flex-start;
    }
  }
</style>
