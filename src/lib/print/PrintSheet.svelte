<script lang="ts">
  /**
   * One sheet of paper.
   *
   * Everything on it is sized in millimetres and nothing is sized in pixels,
   * which is the whole trick: the browser knows how big a millimetre is on
   * paper, and a card that says it is 63mm wide comes out 63mm wide. That is
   * why this is a print *view* rather than a rendered image — a photograph of a
   * card is only ever as true as the DPI it was taken at, and the DOM the
   * renderer already draws is resolution-independent by construction.
   *
   * The cards themselves are `CardRenderer` with the bleed cropped away. No
   * second drawing path here either: a print sheet that redrew cards its own
   * way would drift from what the author approved, exactly as an export would.
   */
  import CardRenderer from '$lib/renderer/CardRenderer.svelte';
  import { CALIBRATION_MM, CROP_MARK_MM, HAIRLINE_MM, PAGE_MARGIN_MM } from './paper';
  import type { Paper } from './paper';
  import type { PrintPage } from './sheet';

  interface Props {
    page: PrintPage;
    paper: Paper;
    printerFriendly: boolean;
    /** Crop marks in the margins, for cutting against. */
    marks: boolean;
  }

  let { page, paper, printerFriendly, marks }: Props = $props();

  const gridWidth = $derived(page.grid.columns * page.sizeMm.width);
  const gridHeight = $derived(page.grid.rows * page.sizeMm.height);

  /** Centred across the sheet; pinned to the top margin down it. */
  const left = $derived((paper.widthMm - gridWidth) / 2);
  const top = PAGE_MARGIN_MM;

  /**
   * Grid lines, as offsets from the sheet's edges. There is one more line than
   * there are cards in each direction — the outside edges are cuts too.
   */
  const columnLines = $derived(
    Array.from({ length: page.grid.columns + 1 }, (_, index) => left + index * page.sizeMm.width)
  );
  const rowLines = $derived(
    Array.from({ length: page.grid.rows + 1 }, (_, index) => top + index * page.sizeMm.height)
  );

  /**
   * Room under the grid for the calibration rule.
   *
   * It is printed inside the printable area rather than out in the margin: the
   * margin is the part of the sheet the hardware may refuse, and a ruler that
   * might not print is worse than no ruler, because it would be trusted.
   */
  const footroom = $derived(paper.heightMm - PAGE_MARGIN_MM - (top + gridHeight));
  const showRule = $derived(footroom >= 6);
</script>

<div
  class="sheet"
  style:width="{paper.widthMm}mm"
  style:height="{paper.heightMm}mm"
  style:--crop-mark="{CROP_MARK_MM}mm"
  style:--hairline="{HAIRLINE_MM}mm"
>
  {#if marks}
    <!--
      Crop marks sit in the margins and stop short of the grid, so the knife has
      two points to line up on and no card ever carries ink from us. Each grid
      line gets four: two above and below, two either side.
    -->
    {#each columnLines as x, index (index)}
      <div class="mark v" style:left="{x}mm" style:top="{top - CROP_MARK_MM - 1}mm"></div>
      <div class="mark v" style:left="{x}mm" style:top="{top + gridHeight + 1}mm"></div>
    {/each}
    {#each rowLines as y, index (index)}
      <div class="mark h" style:top="{y}mm" style:left="{left - CROP_MARK_MM - 1}mm"></div>
      <div class="mark h" style:top="{y}mm" style:left="{left + gridWidth + 1}mm"></div>
    {/each}
  {/if}

  <div
    class="grid"
    style:left="{left}mm"
    style:top="{top}mm"
    style:width="{gridWidth}mm"
    style:height="{gridHeight}mm"
    style:grid-template-columns="repeat({page.grid.columns}, {page.sizeMm.width}mm)"
    style:grid-auto-rows="{page.sizeMm.height}mm"
  >
    {#each page.cells as cell, index (cell?.key ?? `empty-${index}`)}
      <div class="cell">
        {#if cell}
          <CardRenderer
            card={cell.card}
            character={cell.character}
            cardback={cell.cardback}
            theme={cell.theme}
            side={cell.side}
            options={{ surface: 'print', showBleed: false, showGuides: false, printerFriendly }}
          />
        {/if}
      </div>
    {/each}
  </div>

  {#if showRule}
    <!--
      The scale check. If this does not measure 100mm on the paper, the print
      dialogue is scaling the sheet — almost always "Fit to page", which several
      browsers default to — and every card on it is the wrong size. Nothing this
      module can do prevents that; printing the evidence is the next best thing.
    -->
    <div
      class="calibration"
      style:left="{left}mm"
      style:top="{top + gridHeight + footroom / 2 - 2}mm"
      style:width="{CALIBRATION_MM}mm"
    >
      <div class="rule"></div>
      <span class="caption">{CALIBRATION_MM} mm — if this measures short, turn off “Fit to page”</span>
    </div>
  {/if}
</div>

<style>
  .sheet {
    position: relative;
    flex: none;
    background: #fff;
    overflow: hidden;
    /* Screen only: the shadow is how a sheet reads as paper in the preview. */
    box-shadow: var(--shadow-card);
  }

  .grid {
    position: absolute;
    display: grid;
    /*
     * No gutter. Cards butt against each other so one cut serves the two either
     * side of it — half as many cuts, and every cut not made is a cut that
     * cannot wander.
     */
    gap: 0;
  }

  .cell {
    position: relative;
    overflow: hidden;
  }

  .mark {
    position: absolute;
    background: #000;
  }

  .mark.v {
    width: 0;
    height: var(--crop-mark);
    border-left: var(--hairline) solid #000;
  }

  .mark.h {
    height: 0;
    width: var(--crop-mark);
    border-top: var(--hairline) solid #000;
  }

  .calibration {
    position: absolute;
    display: flex;
    flex-direction: column;
    gap: 0.6mm;
  }

  .rule {
    height: 1.6mm;
    border: var(--hairline) solid #000;
    /* Ticks at every 10mm, so a tape can be laid against more than the ends. */
    background: repeating-linear-gradient(90deg, #000 0 var(--hairline), transparent var(--hairline) 10mm);
  }

  .caption {
    font-family: var(--font-sans);
    font-size: 2.4mm;
    color: #000;
  }

  @media print {
    .sheet {
      box-shadow: none;
      /* One sheet, one page. The last must not push a blank one after it. */
      break-after: page;
    }

    .sheet:last-child {
      break-after: auto;
    }
  }
</style>
