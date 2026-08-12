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
  import type { AdventureSet } from '$lib/sets/types';
  import { navigation } from '$lib/state/navigation.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Button, Icon, Select, Switch } from '$lib/ui';
  import { PAPERS, PAPER_IDS } from './paper';
  import type { PaperId } from './paper';
  import PrintSheet from './PrintSheet.svelte';
  import { countCards, planPrintPages } from './sheet';

  interface Props {
    /**
     * The set to lay out, and where Back goes. Both default to the workshop —
     * a published set someone else made is never in the store, so the shared
     * view hands in the document it fetched and takes the viewer back to it.
     */
    set?: AdventureSet;
    onback?: () => void;
  }

  let { set: given, onback }: Props = $props();

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
    planPrintPages(set, { paper, useQuantities, backs })
  );

  const cardCount = $derived(countCards(plan));

  const paperOptions = PAPER_IDS.map((id) => ({ value: id, label: PAPERS[id].label }));

  const summary = $derived(
    plan.pages.length === 0
      ? 'Nothing to print yet — this set has no cards.'
      : `${cardCount} ${cardCount === 1 ? 'card' : 'cards'} across ${plan.pages.length} ${plan.pages.length === 1 ? 'sheet' : 'sheets'}.`
  );
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
    <div class="head">
      <Button variant="ghost" onclick={back}>
        <Icon name="chevronRight" size={13} />
        Back to set
      </Button>
      <div class="titles">
        <h1 class="title">Print sheets</h1>
        <p class="summary">{summary}</p>
      </div>
    </div>

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

    <Button variant="primary" disabled={plan.pages.length === 0} onclick={() => window.print()}>
      <Icon name="printer" size={13} />
      Print
    </Button>
  </header>

  <div class="sheets" bind:clientWidth={viewportWidth} bind:clientHeight={viewportHeight}>
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
            <PrintSheet {page} {paper} {printerFriendly} {marks} />
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
   * scrolling" — and this screen deliberately renders *outside* the shell, so
   * there is no shell to own it. Without a scroll container here the sheets
   * are simply clipped at the fold: the first page cut off, and no way to
   * reach the second.
   */
  .screen {
    display: flex;
    flex-direction: column;
    height: 100vh;
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

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .title {
    margin: 0;
    font-size: var(--text-lg);
  }

  .summary {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
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
