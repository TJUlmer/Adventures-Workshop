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
  import type { AdventureSet } from '$lib/sets/types';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Button, Icon, Select } from '$lib/ui';
  import AssetsOverview from './AssetsOverview.svelte';

  interface Props {
    onprint: (set: AdventureSet) => void;
  }

  let { onprint }: Props = $props();

  const set = $derived(workshop.adventure);
  let scope = $state<PublishScope>({ kind: 'full' });
  const shown = $derived(computeScopedSet(set, scope));
  const options = $derived(scopeOptionsFor(set));
  const stats = $derived(setStats(shown));
  /* 260px was the old maximum. It is now the comfortable starting point in
     the middle of the widened range, so cards can grow as well as shrink. */
  let cardSize = $state(260);
  let saving = $state(false);
  let mobilePane = $state<'review' | 'actions'>('review');
  let fullScreen = $state(false);
  let screen = $state<HTMLDivElement | null>(null);

  const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  const savedLabel = $derived.by(() => {
    if (workshop.saveError) return workshop.saveError;
    if (workshop.savedAt === null) return 'Not saved yet';
    const time = new Date(workshop.savedAt);
    return `Saved locally at ${time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  });

  $effect(() => {
    if (!fullScreen || !screen) return;

    const isolated: HTMLElement[] = [];
    let branch: HTMLElement = screen;
    let parent = branch.parentElement;
    while (parent && parent !== document.body) {
      for (const sibling of parent.children) {
        if (sibling === branch || !(sibling instanceof HTMLElement) || sibling.inert) continue;
        sibling.inert = true;
        isolated.push(sibling);
      }
      branch = parent;
      parent = parent.parentElement;
    }

    return () => {
      for (const sibling of isolated) sibling.inert = false;
    };
  });

  async function saveNow(): Promise<void> {
    saving = true;
    try {
      await workshop.saveNow();
    } finally {
      saving = false;
    }
  }

  function toggleFullScreen(): void {
    if (!fullScreen) mobilePane = 'review';
    fullScreen = !fullScreen;
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (!fullScreen || event.defaultPrevented) return;
    const descendantDialogOpen = Boolean(screen?.querySelector('dialog[open]'));
    if (event.key === 'Escape') {
      // Let the native modal consume Escape before the enclosing overview.
      if (descendantDialogOpen) return;
      fullScreen = false;
      return;
    }
    if (event.key !== 'Tab' || !screen || descendantDialogOpen) return;

    const focusable = Array.from(screen.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (element) =>
        element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility !== 'hidden' &&
        !element.closest('[inert]')
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;

    const active = document.activeElement;
    if (event.shiftKey ? active === first || !screen.contains(active) : active === last || !screen.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div
  bind:this={screen}
  class="screen"
  class:fullscreen={fullScreen}
  role={fullScreen ? 'dialog' : undefined}
  aria-modal={fullScreen ? 'true' : undefined}
  aria-label={fullScreen ? 'Full screen set overview' : undefined}
>
  <main class="main" class:inactive={mobilePane !== 'review'}>
    <header class="overview-head">
      <div class="heading">
        <span class="eyebrow">Set tool</span>
        <h1>Overview</h1>
        <p>Every card, board, component, and rulebook in the set.</p>
      </div>

      <div class="summary" aria-label="Visible set totals">
        <span><b class="numeric">{stats.characterCount}</b> characters</span>
        <span><b class="numeric">{stats.cardCount}</b> designs</span>
        <span><b class="numeric">{stats.printCount}</b> to print</span>
        <span><b class="numeric">{shown.figures.length + Number(shown.box.enabled)}</b> components</span>
        <span><b class="numeric">{shown.rulebooks.length}</b> rulebooks</span>
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

        <button
          type="button"
          class="fullscreen-toggle"
          class:active={fullScreen}
          aria-pressed={fullScreen}
          aria-label={fullScreen ? 'Exit full screen overview' : 'Open full screen overview'}
          title={fullScreen ? 'Exit full screen' : 'Full screen'}
          onclick={toggleFullScreen}
        >
          {fullScreen ? 'Exit full screen' : 'Full screen'}
        </button>
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

  <aside class="rail scroll-y" class:inactive={mobilePane !== 'actions'}>
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
        <p>Print, images and Tabletop Simulator follow “Showing”; the project backup stays complete.</p>
      </div>
      <ExportPanel {set} {onprint} bind:scope />
    </section>
  </aside>

  <nav class="mobile-switch" aria-label="Overview views">
    <button
      type="button"
      aria-pressed={mobilePane === 'review'}
      onclick={() => (mobilePane = 'review')}
    >Review</button>
    <button
      type="button"
      aria-pressed={mobilePane === 'actions'}
      onclick={() => (mobilePane = 'actions')}
    >Save &amp; export</button>
  </nav>
</div>

<style>
  .screen {
    display: grid;
    grid-template-columns: minmax(0, 1fr) clamp(480px, 48vw, 640px);
    height: 100%;
    min-height: 0;
    background: var(--surface-canvas);
  }

  /* Match the public shared-set viewer: this is an in-app viewing mode, not
     the browser Fullscreen API, so it keeps the same Overview scroll root and
     never introduces a permission prompt. */
  .screen.fullscreen {
    position: fixed;
    z-index: var(--z-overlay);
    inset: 0;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    background: var(--surface-sunken);
  }

  .screen.fullscreen .rail,
  .screen.fullscreen .mobile-switch {
    display: none;
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

  .fullscreen-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 32px;
    padding-inline: var(--space-3);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-base);
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    white-space: nowrap;
  }

  .fullscreen-toggle:hover,
  .fullscreen-toggle:focus-visible,
  .fullscreen-toggle.active {
    border-color: var(--border-strong);
    background: var(--surface-selected);
    color: var(--text-primary);
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
    min-width: 0;
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

  .mobile-switch {
    display: none;
  }

  @media (max-width: 1500px) {
    .overview-head {
      align-items: flex-start;
      flex-direction: column;
      gap: var(--space-3);
    }

    .summary {
      justify-content: flex-start;
    }

    .review-controls {
      flex-wrap: wrap;
      justify-content: flex-start;
      max-width: 100%;
    }
  }

  @media (max-width: 1100px) {
    .overview-head {
      padding-inline: var(--space-4);
    }
  }

  @media (max-width: 900px) {
    .screen {
      grid-template-columns: minmax(0, 1fr) min(640px, 50vw);
    }
  }

  @media (max-width: 700px) {
    .screen {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) auto;
    }

    .main,
    .rail {
      grid-column: 1;
      grid-row: 1;
    }

    .main.inactive,
    .rail.inactive {
      /* Keep both panes mounted at their usable size. Overview's deferred
         galleries observe its own `.page` scroller and must not be rebuilt at
         zero width whenever the author visits Save & export. */
      visibility: hidden;
      pointer-events: none;
    }

    .overview-head {
      gap: var(--space-2);
      padding: var(--space-3) var(--space-4);
    }

    .heading {
      display: flex;
      align-items: baseline;
      gap: var(--space-2);
    }

    .heading p {
      display: none;
    }

    .summary {
      width: 100%;
      flex-wrap: nowrap;
      justify-content: flex-start;
      overflow-x: auto;
      overscroll-behavior-inline: contain;
    }

    .summary span {
      flex: none;
    }

    .review-controls {
      width: 100%;
      gap: var(--space-3);
      flex-wrap: nowrap;
      align-items: center;
    }

    .showing {
      flex: 1 1 0;
      min-width: 0;
      align-items: center;
    }

    .showing > span,
    .zoom > span {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .zoom {
      flex: none;
      min-width: 0;
    }

    .zoom input {
      min-width: 0;
      width: clamp(72px, 25vw, 112px);
    }

    .fullscreen-toggle {
      flex: none;
      min-height: var(--touch-target);
    }

    .rail {
      padding: var(--space-3);
      border-left: 0;
    }

    .mobile-switch {
      display: flex;
      grid-column: 1;
      grid-row: 2;
      gap: var(--space-1);
      min-width: 0;
      padding: var(--space-1) var(--space-2);
      border-top: 1px solid var(--border-subtle);
      background: var(--surface-sunken);
    }

    .mobile-switch button {
      flex: 1 1 0;
      min-width: 0;
      min-height: 44px;
      padding-inline: var(--space-2);
      border-radius: var(--radius-sm);
      font-size: var(--text-sm);
      font-weight: var(--weight-medium);
      color: var(--text-tertiary);
      transition:
        background-color var(--duration-fast) var(--ease-out),
        color var(--duration-fast) var(--ease-out);
    }

    .mobile-switch button:hover {
      background: var(--surface-hover);
      color: var(--text-secondary);
    }

    .mobile-switch button[aria-pressed='true'] {
      background: var(--surface-raised);
      color: var(--text-primary);
      box-shadow: inset 0 0 0 1px var(--border-default), var(--shadow-xs);
    }
  }

  @media (max-height: 500px) {
    .overview-head {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-2) var(--space-3);
    }

    .heading .eyebrow,
    .heading p,
    .summary {
      display: none;
    }

    .heading h1 {
      font-size: var(--text-lg);
    }

    .review-controls {
      width: auto;
      justify-self: stretch;
      justify-content: flex-end;
    }

    .showing {
      max-width: 210px;
    }
  }
</style>
