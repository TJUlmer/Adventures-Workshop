<script lang="ts">
  /**
   * Print sheets.
   *
   * This is the one screen that renders *outside* the app shell, and that is
   * not a layout preference — it is what makes printing work. A print view
   * nested inside a title bar, a nav and a sidebar has to hide all three at
   * print time, and every one of them is a chance for a stray pixel to push the
   * sheet and cost a millimetre. Owning the document means the only thing to
   * hide is this screen's own controls.
   *
   * The output is the browser's own print dialogue rather than a file we
   * generate. Two reasons, and the second is the one that decided it: a real
   * PDF writer here would have to embed every card as a JPEG, because the app
   * has no compression beyond what a stored ZIP entry needs — so the text on a
   * printer-friendly card, whose whole point is being crisp black line, would
   * arrive as blocky grey. Printed from the DOM it stays vector, at whatever
   * resolution the printer has. "Save as PDF" in that same dialogue produces
   * the file, and produces a better one than we could.
   */
  import { tick } from 'svelte';
  import type { AdventureSet } from '$lib/sets/types';
  import { navigation } from '$lib/state/navigation.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Button, Icon, Select, Switch } from '$lib/ui';
  import { PAPERS, PAPER_IDS } from './paper';
  import type { PaperId } from './paper';
  import PrintSheet from './PrintSheet.svelte';
  import { countCards, planCollectionPrintPages, planPrintPages } from './sheet';
  import type { PrintMember } from './sheet';

  interface Props {
    /**
     * The set to lay out, and where Back goes. Both default to the workshop —
     * a published set someone else made is never in the store, so the shared
     * view hands in the document it fetched and takes the viewer back to it.
     */
    set?: AdventureSet;
    /**
     * Several creators' decks, laid out together as one collection's sheets.
     *
     * Takes precedence over `set` when present. A second prop rather than a
     * second screen because everything below the plan — paper, zoom, the
     * sheets themselves, the print rules — is already indifferent to where
     * the pages came from, and only `plan` is not.
     */
    members?: readonly PrintMember[];
    onback?: () => void;
  }

  let { set: given, members, onback }: Props = $props();

  const set = $derived(given ?? workshop.adventure);
  const back = (): void => (onback ? onback() : navigation.go('home'));

  /*
   * Not persisted, and deliberately: none of this describes the set, it
   * describes the printer in the room. Putting it in the document would mean a
   * schema version and a `normalize` branch to carry someone else's paper size
   * around inside a set they were handed.
   */
  let paperId = $state<PaperId>('a4');
  let printerFriendly = $state(false);
  let useQuantities = $state(true);
  let backs = $state(false);
  let marks = $state(true);
  let settingsOpen = $state(false);

  const paper = $derived(PAPERS[paperId]);

  /**
   * Preview zoom.
   *
   * The sheets are laid out in millimetres because that is the whole point, and
   * a millimetre on screen is a millimetre — so an A4 page is 1123px tall and
   * does not fit a laptop viewport at any useful width. Scaling is therefore a
   * property of the *preview* only: `@media print` throws all of it away, so
   * nothing here can move a card on paper.
   */
  const ZOOMS = [
    { value: 'fit', label: 'Fit page' },
    { value: '0.5', label: '50%' },
    { value: '0.75', label: '75%' },
    { value: '1', label: '100% (true size)' }
  ] as const;

  let zoom = $state<string>('fit');

  /** The scroll area's own box, so "fit" means fit *this*, not the window. */
  let viewportWidth = $state(0);
  let viewportHeight = $state(0);
  let sheetsRoot = $state<HTMLElement | null>(null);
  let imageReadiness = $state<'empty' | 'preparing' | 'ready' | 'failed'>('empty');
  let failedImageCount = $state(0);
  let preparationGeneration = 0;
  let retryGeneration = $state(0);

  const PX_PER_MM = 96 / 25.4;
  /** Breathing room so a fitted page is not wedged against the edges. */
  const INSET_PX = 48;

  const fitScale = $derived.by(() => {
    if (viewportWidth === 0 || viewportHeight === 0) return 1;
    const byWidth = (viewportWidth - INSET_PX) / (paper.widthMm * PX_PER_MM);
    const byHeight = (viewportHeight - INSET_PX) / (paper.heightMm * PX_PER_MM);
    // Never magnify: 100% is true size, and bigger than true size is a lie.
    return Math.max(0.1, Math.min(1, byWidth, byHeight));
  });

  const scale = $derived(zoom === 'fit' ? fitScale : Number(zoom));

  const plan = $derived(
    members
      ? planCollectionPrintPages(members, { paper, useQuantities, backs })
      : planPrintPages(set, { paper, useQuantities, backs })
  );

  const cardCount = $derived(countCards(plan));

  const paperOptions = PAPER_IDS.map((id) => ({ value: id, label: PAPERS[id].label }));

  const summary = $derived(
    plan.pages.length === 0
      ? 'Nothing to print yet — this set has no cards.'
      : `${cardCount} ${cardCount === 1 ? 'card' : 'cards'} across ${plan.pages.length} ${plan.pages.length === 1 ? 'sheet' : 'sheets'}.`
  );

  /** A broken picture must settle too, so the screen can offer a retry. */
  function imageLoaded(image: HTMLImageElement): Promise<boolean> {
    if (image.complete) return Promise.resolve(image.naturalWidth > 0);
    return new Promise((resolve) => {
      const finish = (loaded: boolean): void => {
        image.removeEventListener('load', loadedImage);
        image.removeEventListener('error', brokenImage);
        resolve(loaded);
      };
      const loadedImage = (): void => finish(true);
      const brokenImage = (): void => finish(false);
      image.addEventListener('load', loadedImage, { once: true });
      image.addEventListener('error', brokenImage, { once: true });
      /* It may have settled between the first `complete` check and the
         listeners being attached. */
      if (image.complete) finish(image.naturalWidth > 0);
    });
  }

  /** Let the load handler's Svelte update and one real paint finish before printing. */
  function afterPaint(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }

  /*
   * A gallery download being complete does not mean the fresh <img> elements
   * on this screen have decoded. Chromium can snapshot the print tree before
   * they do, leaving CardArt's CSS vignette over an empty background in the
   * resulting PDF. PNG/TTS capture already waits for image load; printing has
   * to make the same guarantee before its button becomes available.
   */
  $effect(() => {
    const root = sheetsRoot;
    const pages = plan.pages;
    const monochrome = printerFriendly;
    const retry = retryGeneration;
    const generation = ++preparationGeneration;
    void monochrome;
    void retry;

    if (!root || pages.length === 0) {
      imageReadiness = 'empty';
      failedImageCount = 0;
      return;
    }

    imageReadiness = 'preparing';
    failedImageCount = 0;

    void (async () => {
      /* The plan changes first; the keyed card DOM follows on Svelte's tick. */
      await tick();
      const images = Array.from(root.querySelectorAll('img'));
      const results = await Promise.all(images.map(imageLoaded));
      await tick();
      await afterPaint();
      if (generation !== preparationGeneration) return;

      failedImageCount = results.filter((loaded) => !loaded).length;
      imageReadiness = failedImageCount === 0 ? 'ready' : 'failed';
    })();

    return () => {
      preparationGeneration += 1;
    };
  });
</script>

<svelte:head>
  <!--
    `@page` has to be a real stylesheet rather than a scoped rule: it is not
    attached to an element, so Svelte has nothing to scope it to. The margin is
    zero because the sheet component already holds the margins in its own
    coordinates — letting the browser add its own would inset the sheet inside
    the paper and scale everything on it.
  -->
  {@html `<style>@page { size: ${paper.widthMm}mm ${paper.heightMm}mm; margin: 0; }</style>`}
</svelte:head>

<div class="screen">
  <header class="controls">
    <div class="toolbar">
      <div class="head">
        <Button variant="ghost" onclick={back} aria-label="Back to set">
          <Icon name="chevronRight" size={13} />
          <span class="back-label">Back to set</span>
        </Button>
        <div class="titles">
          <h1 class="title">Print sheets</h1>
          <p class="summary">{summary}</p>
        </div>
      </div>

      <div class="toolbar-actions">
        <span class="settings-toggle">
          <Button
            variant="secondary"
            aria-controls="print-settings"
            aria-expanded={settingsOpen}
            aria-label={plan.warnings.length > 0
              ? `Print options, ${plan.warnings.length} ${plan.warnings.length === 1 ? 'warning' : 'warnings'}`
              : 'Print options'}
            onclick={() => (settingsOpen = !settingsOpen)}
          >
            <Icon name="settings" size={13} />
            <span class="options-label">Options</span>
            {#if plan.warnings.length > 0}
              <span class="warning-count" aria-hidden="true">{plan.warnings.length}</span>
            {/if}
          </Button>
        </span>

        <Button
          variant="primary"
          disabled={imageReadiness !== 'ready'}
          onclick={() => window.print()}
        >
          <Icon name="printer" size={13} />
          {imageReadiness === 'preparing' ? 'Preparing artwork…' : 'Print'}
        </Button>
      </div>
    </div>

    {#if imageReadiness === 'failed'}
      <div class="print-error" role="alert">
        <span>
          {failedImageCount} {failedImageCount === 1 ? 'image' : 'images'} could not load. Check your
          connection and try again before printing.
        </span>
        <Button size="sm" variant="ghost" onclick={() => (retryGeneration += 1)}>Try again</Button>
      </div>
    {/if}

    <p class="mobile-scale-note">Use 100% scale and background graphics in the print dialogue.</p>

    <div id="print-settings" class="settings-panel" class:open={settingsOpen}>
      <div class="options">
        <label class="option">
          <span class="option-label">Paper</span>
          <Select bind:value={paperId} options={paperOptions} />
        </label>

        <label class="option">
          <span class="option-label">Preview size</span>
          <Select bind:value={zoom} options={ZOOMS} />
        </label>

        <div class="switches">
          <Switch
            checked={printerFriendly}
            label="Printer friendly"
            hint="Black on white, no artwork"
            onchange={(value) => (printerFriendly = value)}
          />
          <Switch
            checked={useQuantities}
            label="Print duplicates"
            hint="One card per copy the set says exists"
            onchange={(value) => (useQuantities = value)}
          />
          <Switch
            checked={backs}
            label="Card backs"
            hint="A reverse sheet after each, for duplex"
            onchange={(value) => (backs = value)}
          />
          <Switch
            checked={marks}
            label="Crop marks"
            hint="Cutting guides in the margins"
            onchange={(value) => (marks = value)}
          />
        </div>
      </div>

      {#if plan.warnings.length > 0}
        <ul class="warnings">
          {#each plan.warnings as warning, index (index)}
            <li>{warning}</li>
          {/each}
        </ul>
      {/if}

      <!--
        The one thing worth saying before paper is spent. Every browser's print
        dialogue can scale a sheet to fit, several do it by default, and a sheet
        scaled by 4% produces cards that will not sleeve — which is not
        discovered until after they are cut.
      -->
      <p class="scale-note">
        In the print dialogue set <strong>Scale</strong> to 100% (not “Fit to page”) and turn
        background graphics on. Every sheet carries a 100 mm rule to check against.
      </p>
    </div>
  </header>

  <div
    class="sheets"
    bind:this={sheetsRoot}
    bind:clientWidth={viewportWidth}
    bind:clientHeight={viewportHeight}
  >
    {#each plan.pages as page (page.key)}
      <figure class="sheet-block">
        <figcaption class="caption">{page.label}</figcaption>
        <!--
          The scaler reserves the *scaled* box; the inner element does the
          scaling. A transform alone would not do: it paints smaller while the
          element still occupies its full 297mm in flow, so every page after the
          first would sit a page-height of empty space away.
        -->
        <div
          class="sheet-scaler"
          style:width="{paper.widthMm * scale}mm"
          style:height="{paper.heightMm * scale}mm"
        >
          <div class="sheet-inner" style:transform="scale({scale})">
            <PrintSheet {page} {paper} {printerFriendly} {marks} customSymbols={set.customSymbols} />
          </div>
        </div>
      </figure>
    {/each}
  </div>
</div>

<style>
  /*
   * This screen owns its own scrolling, and has to.
   *
   * `base.css` sets `body { overflow: hidden }` — "the shell owns all
   * scrolling" — and this screen deliberately renders *outside* the set shell.
   * The application frame supplies its available height, but this component
   * still has to own the sheet scroll area or later pages are clipped.
   */
  .screen {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--surface-sunken);
    color: var(--text-default);
  }

  /* A fixed band above the scroll area, rather than sticky inside it. */
  .controls {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
    background: var(--surface-default);
    border-bottom: 1px solid var(--border-default);
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
  }

  .titles {
    min-width: 0;
  }

  .toolbar-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: none;
  }

  .settings-toggle {
    display: none;
  }

  .warning-count {
    min-width: 1.25em;
    padding-inline: var(--space-1);
    border-radius: var(--radius-full);
    background: var(--surface-active);
    font-size: var(--text-xs);
    line-height: 1.25;
  }

  .settings-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .mobile-scale-note {
    display: none;
  }

  .title {
    margin: 0;
    font-size: var(--text-lg);
  }

  .summary {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .options {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-6);
  }

  .option {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .option-label,
  .caption {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .switches {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-6);
  }

  .warnings,
  .scale-note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .warnings {
    padding-left: var(--space-5);
  }

  .print-error {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--danger);
  }

  .sheets {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-6);
    padding: var(--space-6);
  }

  .sheet-scaler {
    position: relative;
    overflow: hidden;
  }

  .sheet-inner {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: top left;
  }

  .sheet-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
  }

  @media screen and (max-width: 700px), screen and (max-height: 500px) {
    .controls {
      gap: 0;
      padding: 0;
    }

    .toolbar {
      min-height: var(--touch-target);
      padding: var(--space-2) var(--space-3);
    }

    .head {
      gap: var(--space-2);
    }

    .settings-toggle {
      display: inline-flex;
    }

    .mobile-scale-note {
      display: block;
      margin: 0;
      padding: 0 var(--space-3) var(--space-2);
      font-size: var(--text-2xs);
      line-height: var(--leading-normal);
      color: var(--text-muted);
    }

    /*
     * Keep the toolbar and a useful slice of the preview on screen even when
     * a phone is sideways. The options own their scroll instead of growing the
     * fixed controls band until the sheet viewport disappears.
     */
    .settings-panel {
      display: none;
      max-height: min(22rem, 45dvh);
      overflow-y: auto;
      overscroll-behavior: contain;
      gap: var(--space-3);
      padding: var(--space-3);
      border-top: 1px solid var(--border-default);
    }

    .settings-panel.open {
      display: flex;
    }

    .options {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-3);
    }

    .option {
      min-width: 0;
    }

    .switches {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-3);
    }

    .sheets {
      padding: var(--space-4);
    }
  }

  @media screen and (max-width: 460px) {
    .back-label,
    .summary {
      display: none;
    }

    .title {
      font-size: var(--text-md);
      white-space: nowrap;
    }

    .options,
    .switches {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media screen and (max-height: 500px) {
    .settings-panel {
      max-height: 35dvh;
    }
  }

  @media screen and (max-width: 350px) {
    .options-label {
      display: none;
    }
  }

  @media print {
    /*
     * The screen is the paper now. Anything that is not a sheet goes, and the
     * sheets stop being a centred, gapped, padded column — every one of those
     * is a millimetre the printer would have to find somewhere.
     */
    .controls,
    .caption {
      display: none;
    }

    .screen {
      display: block;
      height: auto;
      background: #fff;
    }

    /* The scroll container must not exist on paper — a printed page cannot
       scroll, so a fixed-height overflow box would print its first screenful
       and silently drop the rest. */
    .sheets {
      display: block;
      overflow: visible;
      padding: 0;
      gap: 0;
    }

    .sheet-block {
      display: block;
      gap: 0;
    }

    /*
     * Preview zoom is undone completely. The scaler's job was to reserve a
     * shrunken box on screen; on paper the sheet is its own true size and
     * anything left of the transform would scale the cards themselves.
     */
    .sheet-scaler {
      width: auto !important;
      height: auto !important;
      overflow: visible;
    }

    .sheet-inner {
      position: static;
      transform: none !important;
    }
  }
</style>
