<script lang="ts">
  /**
   * The villain's threat track, as a board.
   *
   * One component for two jobs: the editor on the Threat track page, and the
   * thing the exporter photographs. `editable` is what separates them, and it
   * is a flag rather than a second component because a board that drifted from
   * the one the author approved would be worse than no export at all.
   *
   * Printed values are always text. Editing lives in the surrounding inspector;
   * this component adds only selection targets when `editable` is on. That keeps
   * the photographed tree free of controls and prevents clone-based export from
   * losing form-control values.
   */
  import { fillCss } from '$lib/cards/style';
  import { hasArtwork } from '$lib/core/artwork';
  import type {
    ThreatNote,
    ThreatNoteId,
    ThreatSlotId,
    ThreatStepId,
    ThreatTrack
  } from '$lib/threat/types';
  import { threatWinLabel } from '$lib/threat/types';
  import CardArt from './CardArt.svelte';
  import { THREAT_RAIL, THREAT_SPACE_WIDTH, THREAT_TRACK } from './geometry';

  interface Props {
    track: ThreatTrack;
    /** Printed on the nameplate and in the burst. */
    villainName: string;
    /** Editing affordances. Off leaves only what prints. */
    editable?: boolean;
    selectedStepId?: ThreatStepId | null;
    selectedSlotId?: ThreatSlotId | null;
    selectedNoteId?: ThreatNoteId | null;
    armedNoteId?: ThreatNoteId | null;
    onselectstep?: (id: ThreatStepId) => void;
    onselectslot?: (id: ThreatSlotId) => void;
    onselectnote?: (id: ThreatNoteId) => void;
    onnotedrag?: (event: PointerEvent, note: ThreatNote) => void;
    onnotekey?: (event: KeyboardEvent, note: ThreatNote) => void;
    /** The strip element, which a note's position is measured against. */
    strip?: HTMLDivElement | null;
    draggingNoteId?: string | null;
  }

  let {
    track,
    villainName,
    editable = false,
    selectedStepId = null,
    selectedSlotId = null,
    selectedNoteId = null,
    armedNoteId = null,
    onselectstep,
    onselectslot,
    onselectnote,
    onnotedrag,
    onnotekey,
    strip = $bindable(null),
    draggingNoteId = null
  }: Props = $props();

  /** The printed shape, so the preview and the export are the same board. */
  const STRIP_ASPECT = `${THREAT_TRACK.bleed.width} / ${THREAT_TRACK.bleed.height}`;

  /** The last space's colour, which the arrow and the bridge both take. */
  const triggerFill = $derived.by(() => {
    const last = track.steps.at(-1);
    return last?.fill ? fillCss(last.fill) : null;
  });

  const showingReplacement = $derived(track.useReplacement && hasArtwork(track.replacement));
  const winLabel = $derived(threatWinLabel(track, villainName));
</script>

<!--
  Laid out the way the printed strip is: nameplate, track, somewhere to put the
  pieces, and the burst that ends the game. Sized in `cqw` off the board's own
  width and held to the printed proportions, so what is on screen is the shape
  that comes out of the exporter.
-->
<div
  class="board"
  class:editable
  style:--accent={track.accent}
  style:--space-stroke={track.spaceStroke}
  style:--trigger-fill={triggerFill ?? undefined}
  style:--strip-aspect={STRIP_ASPECT}
  style:--track-w="{THREAT_RAIL.trackWidth}cqw"
  style:--space-h="{THREAT_RAIL.spaceHeight}cqw"
  style:--space-w="{THREAT_SPACE_WIDTH}cqw"
  style:--space-gap="{THREAT_RAIL.spaceGap}cqw"
  style:--hex-stroke="{THREAT_RAIL.strokeInset}%"
>
  {#if showingReplacement}
    <!--
      A board made elsewhere stands in for the whole composition. Everything
      below still exists and comes back the moment the replacement is turned
      off, which is why it is a switch rather than a delete.
    -->
    <img class="replacement" src={track.replacement.source} alt="" />
  {:else}
    <div class="strip" bind:this={strip}>
      {#if hasArtwork(track.background)}
        <!-- Under everything, and never in the way of what is on top of it. -->
        <div class="backdrop">
          <CardArt artwork={track.background} background="transparent" />
        </div>
      {/if}

      <div class="nameplate">
        {#if hasArtwork(track.logo)}
          <!--
            The author's own lockup. `CardArt` rather than a bare `<img>` so a
            logo gets the same crop and grade every other picture here does,
            and `contain` so a wide one is not cropped to the plate's square.
          -->
          <div class="lockup">
            <CardArt artwork={track.logo} background="transparent" fit="contain" />
          </div>
        {:else}
          <!-- Empty until a licensed lockup can go back in. See `assets.ts`. -->
          <div class="lockup">
            <div class="lockup-box"></div>
            <div class="lockup-ink"></div>
          </div>
        {/if}
        <span class="plate-villain">{villainName || 'Villain'}</span>
        {#if track.subtitle.trim()}
          <span class="plate-subtitle">{track.subtitle}</span>
        {/if}
      </div>

      <!--
        The track and the slots share one red bed, as the printed board does —
        the background is on `.arena` rather than the rail, and the arena takes
        the strip's spare width so the burst is always pinned to the right.
      -->
      <div class="arena">
      <div class="track">
        <span class="track-mark">Threat track</span>

        <div class="rail">
          {#each track.steps as step, index (step.id)}
            {@const last = index === track.steps.length - 1}
            <!--
              The last space is where the track pays off, so it is drawn as
              part of the arrow rather than as another space before it — the
              printed boards fuse the two for the same reason.
            -->
            <div
              class="space"
              class:selected={editable && step.id === selectedStepId}
              class:trigger={last}
            >
              <!--
                Two layers, because the outline is a shape rather than a
                border: `clip-path` cuts a border away along with the shadow
                and the outline, so the stroke is the hex itself and the fill
                is a second hex inset inside it.
              -->
              <div
                class="hex"
                class:painted={step.fill !== null}
                style:background={step.stroke ? fillCss(step.stroke) : undefined}
              >
                <span
                  class="hex-face"
                  style:background={step.fill ? fillCss(step.fill) : undefined}
                ></span>
                {#if editable && step.effect.trim()}
                  <span class="marker" title="Has an effect"></span>
                {/if}
              </div>

              <!--
                Flush under the hex and exactly its width, so the two read as
                one piece. The value stays text here; the full-size inspector
                owns editing without changing the printed shape.
              -->
              <div
                class="pennant"
                style:background={step.bannerFill ? fillCss(step.bannerFill) : undefined}
                style:color={step.numberColor ?? undefined}
              >
                <span class="pennant-value numeric">{step.value}</span>
              </div>

              {#if editable}
                <button
                  type="button"
                  class="entity-target space-target"
                  aria-label={`Select space ${index + 1}, threat ${step.value}${step.effect.trim() ? ', has effect' : ''}`}
                  aria-pressed={step.id === selectedStepId}
                  title={last
                    ? `Space ${index + 1} — reaching this triggers “${track.finalLabel || 'the end of the track'}”`
                    : `Space ${index + 1}`}
                  onclick={() => onselectstep?.(step.id)}
                ></button>
              {/if}
            </div>
          {/each}

          <!--
            The arrow takes the last space's colour, because the two are one
            move: colouring the space that sets the end of the track off and
            leaving the thing it sets off a different colour would undo the
            join they are drawn with.
          -->
          <div class="final">
            <div class="arrow" style:background={triggerFill ?? undefined}>
              <span class="final-label">{track.finalLabel}</span>
            </div>
          </div>

        </div>
      </div>

      <!--
        Where the pieces go. Each is a real space on the printed board, so it
        is drawn as one rather than listed — the author is laying out a table,
        not filling in a form.
      -->
      <div class="slots">
        {#each track.slots as slot, index (slot.id)}
          <div class="slot" class:selected={editable && slot.id === selectedSlotId}>
            <!--
              The label sits *in* the well, which is where the printed boards
              name a space — under it, it read as a caption for a box rather
              than as the box's own name. It wraps inside the well.
            -->
            <div class="slot-well">
              <span class="slot-label">{slot.label}</span>
            </div>

            {#if slot.note.trim()}<span class="slot-note">{slot.note}</span>{/if}

            {#if editable}
              <button
                type="button"
                class="entity-target slot-target"
                aria-label={`Select slot ${index + 1}${slot.label.trim() ? `, ${slot.label.trim()}` : ''}`}
                aria-pressed={slot.id === selectedSlotId}
                title={`Slot ${index + 1}${slot.label.trim() ? ` — ${slot.label.trim()}` : ''}`}
                onclick={() => onselectslot?.(slot.id)}
              ></button>
            {/if}
          </div>
        {/each}
      </div>
      </div>

      <div class="win">
        <span class="burst">{winLabel}</span>
      </div>

      <!--
        Free copy, over everything. The editor adds a transparent selection
        target; that target captures movement only after the inspector's Move
        action arms this note.
      -->
      {#each track.notes as note (note.id)}
        <div
          class="note"
          class:selected={editable && selectedNoteId === note.id}
          class:move-armed={editable && armedNoteId === note.id}
          class:moving={draggingNoteId === note.id}
          style:left="{note.x * 100}%"
          style:top="{note.y * 100}%"
          style:font-size="{note.size}cqw"
          style:color={note.color}
          style:rotate="{note.rotation}deg"
        >
          <span class="note-text">{note.text}</span>
          {#if editable}
            <!--
              Pointer-only overlay for the visible text footprint. The separate
              clamped target below remains the one keyboard and assistive-tech
              users reach, including when the printable note clips at an edge.
            -->
            <!--
              svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions
              This pointer-only duplicate is hidden from accessibility APIs;
              the clamped real button immediately below owns keyboard input.
            -->
            <span
              class="note-visual-target"
              class:move-armed={armedNoteId === note.id}
              class:moving={draggingNoteId === note.id}
              aria-hidden="true"
              onpointerdown={(event) => {
                if (armedNoteId === note.id) onnotedrag?.(event, note);
              }}
              onclick={() => {
                if (armedNoteId !== note.id) onselectnote?.(note.id);
              }}
            ></span>
          {/if}
        </div>

        {#if editable}
          <!--
            Independent of the printable note so its 44px box can stay inside
            the clipped strip even when the note's anchor is exactly on an edge.
          -->
          <button
            id={`threat-note-${note.id}`}
            type="button"
            class="entity-target note-target"
            class:move-armed={armedNoteId === note.id}
            class:moving={draggingNoteId === note.id}
            style:left="clamp(calc(var(--touch-target) / 2), {note.x * 100}%, calc(100% - var(--touch-target) / 2))"
            style:top="clamp(calc(var(--touch-target) / 2), {note.y * 100}%, calc(100% - var(--touch-target) / 2))"
            aria-label={armedNoteId === note.id
              ? `Move placed text, ${note.text.trim() || 'empty text'}. Drag to place it or use the arrow keys.`
              : `Select placed text, ${note.text.trim() || 'empty text'}`}
            aria-pressed={selectedNoteId === note.id}
            title={armedNoteId === note.id ? 'Drag to place this text' : 'Select this text'}
            onpointerdown={(event) => {
              if (armedNoteId === note.id) onnotedrag?.(event, note);
            }}
            onclick={() => {
              if (armedNoteId !== note.id) onselectnote?.(note.id);
            }}
            onkeydown={(event) => {
              if (armedNoteId === note.id) onnotekey?.(event, note);
            }}
          ></button>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .board {
    /*
     * The board prints, so it sets in the card face rather than the editor's
     * UI stack. Declared once here and specialised per role below, so anything
     * that gains type later lands on the right face by default.
     */
    font-family: var(--card-font-text);
    font-weight: var(--card-font-text-weight);

    /*
     * The printed size of a space, and the weight of its outline. One knob
     * each, because both are printed dimensions rather than styling: see
     * `.space` for why the width is fixed and `.hex-face` for why the outline
     * is a percentage.
     */
    --space-w: 4.2cqw;
    --hex-stroke: 11.5%;

    /* `.strip` establishes the container used by everything inside it, but
       its own `cqw` gap and padding cannot query itself. Without this parent
       container those two lengths fall back to the small viewport width, so
       the same printed board shifted between a phone and a desktop export. */
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    flex: none;
    border-radius: var(--radius-lg);
    background: var(--grey-1000);
    overflow: hidden;
  }

  /*
   * The strip is its own container, and everything on it is sized off that
   * width — so the board never grows to fit its contents and is never the
   * thing that needs scrolling. It is held to the printed proportions so what
   * is on screen is the shape the exporter writes. Spaces are the exception
   * that proves it: they hold a fixed size instead of dividing the rail, and
   * give way only when there is genuinely no room. See `.space`.
   */
  .strip {
    container-type: inline-size;
    position: relative;
    display: flex;
    align-items: stretch;
    aspect-ratio: var(--strip-aspect);
    gap: 1cqw;
    padding: 1.4cqw;
    min-width: 0;
    overflow: hidden;
  }

  /*
   * Behind everything, and out of the way of it: the board's own pieces sit
   * in normal flow above this, and nothing here can be clicked.
   */
  .backdrop {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .replacement {
    display: block;
    width: 100%;
    height: auto;
  }

  /* -- nameplate -------------------------------------------------------- */
  .nameplate {
    flex: 0 0 13cqw;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.6cqw;
    padding: 0.8cqw;
    border-radius: var(--radius-sm);
    background: var(--grey-900);
    min-width: 0;
  }

  /* The same lockup the event card's reverse carries, masked the same way. */
  .lockup {
    position: relative;
    width: 8cqw;
    aspect-ratio: 97 / 85;
    flex: none;
  }

  .lockup-box,
  .lockup-ink {
    position: absolute;
    inset: 0;
    mask-size: 100% 100%;
    -webkit-mask-size: 100% 100%;
    mask-repeat: no-repeat;
    -webkit-mask-repeat: no-repeat;
  }

  .lockup-box {
    background: var(--accent);
    mask-image: url('/assets/templates/event_logo.png');
    -webkit-mask-image: url('/assets/templates/event_logo.png');
  }

  .lockup-ink {
    background: var(--grey-900);
    mask-image: url('/assets/templates/event_logo_ink.png');
    -webkit-mask-image: url('/assets/templates/event_logo_ink.png');
  }

  .plate-villain {
    font-family: var(--card-font-title);
    font-weight: var(--card-font-title-weight);
    font-size: 1.9cqw;
    line-height: 1.1;
    text-transform: uppercase;
    text-align: center;
    color: var(--text-primary);
    overflow-wrap: break-word;
  }

  .plate-subtitle {
    font-size: 1.2cqw;
    line-height: 1.1;
    text-align: center;
    color: var(--text-muted);
    overflow-wrap: break-word;
  }

  /* -- the red bed: track and slots ------------------------------------- */
  /*
   * One rectangle behind the track and the slots, as the printed board draws
   * it. It takes the strip's spare width (`flex: 1 1 auto`), which is what keeps
   * the burst hard against the right edge whatever the slots come to.
   */
  .arena {
    flex: 1 1 auto;
    display: flex;
    align-items: stretch;
    gap: 0.8cqw;
    min-width: 0;
    padding: 0.7cqw 0.8cqw;
    border-radius: var(--radius-md);
    background: color-mix(in oklab, var(--accent) 22%, transparent);
  }

  /* -- the track -------------------------------------------------------- */
  /*
   * A fixed share of the strip rather than whatever the slots leave over.
   *
   * Slot copy can wrap, so the track once lost 10cqw to a long caption and the
   * number of spaces that fitted changed. The number of spaces the rail holds
   * is a printed fact and cannot depend on what an author typed underneath, so
   * the track claims its share first and the slots divide the remainder.
   */
  .track {
    flex: 0 1 auto;
    /* Its printed share is a ceiling, not a claim: the spaces are capped
       against it, so the track can never need more — and taking only what it
       needs is what hands the gap after the arrow to the slots. */
    max-width: var(--track-w);
    display: flex;
    align-items: stretch;
    gap: 0.6cqw;
    min-width: 0;
  }

  /*
   * Set bottom-up beside the rail, as the printed board does. `vertical-rl`
   * lays the caps down the box; the half turn brings them back to reading up.
   */
  .track-mark {
    font-family: var(--card-font-title);
    font-weight: var(--card-font-title-weight);
    flex: none;
    writing-mode: vertical-rl;
    rotate: 180deg;
    align-self: center;
    font-size: 1.1cqw;
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    white-space: nowrap;
    color: var(--accent);
  }

  /*
   * The bottom padding is where the ribbons hang. They are out of the flow, so
   * every item in this row is hex-height and one `center` lines the arrow up
   * with the hexes — which is what makes the last space and the arrow read as
   * one shape rather than two at different heights.
   *
   * The rail's own gap is 0; the space between hexes is a margin between spaces
   * (`.space + .space`) so it falls only there and not before the arrow, which
   * still butts the last space as the printed boards fuse the two.
   */
  .rail {
    flex: 0 1 auto;
    display: flex;
    align-items: center;
    gap: 0;
    padding: 0 0 4.6cqw;
    min-width: 0;
  }

  /*
   * A space is a fixed printed size, whatever the count.
   *
   * `flex-grow: 0` is the point: sharing the rail evenly meant three spaces
   * inflated to fill it and eight shrank to divide it, so adding or removing
   * one space resized every other.
   *
   * What keeps that honest now is the *count*, not the size — the rail holds
   * `THREAT_MAX_SPACES` and `canAddThreatStep()` refuses the rest, so the
   * spaces never have to give way. `flex-shrink: 1` stays only for documents
   * written before the cap existed, which can hold more spaces than the rail
   * has room for: better that such a board comes back a little tight than that
   * its last spaces vanish into the strip's `overflow: hidden`.
   */
  .space {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 0 1 auto;
    width: var(--space-w);
    min-width: 0;
  }

  /* A few pixels between hexes so they read as separate spaces, not a strip. */
  .space + .space {
    margin-left: var(--space-gap);
  }

  /*
   * Hexagonal space, vertex up. This layer is the *outline*: a border would be
   * cut away by the `clip-path` along with the shadow and the CSS outline, so
   * the stroke has to be a shape of its own with the fill inset inside it.
   *
   * Sized from both custom properties rather than one plus an `aspect-ratio`,
   * so the hexagon's √3/2 proportion lives in `geometry.ts` with the rest of
   * the measured print geometry instead of being a number in a stylesheet.
   *
   * `z-index` lifts it over the ribbon, which tucks under its lower point.
   */
  .hex {
    position: relative;
    z-index: 1;
    width: 100%;
    height: var(--space-h);
    clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
    background: var(--space-stroke);
    border: none;
    display: grid;
    place-items: center;
    transition: background-color var(--duration-fast) var(--ease-out);
  }

  /*
   * The fill, inset inside the outline.
   *
   * One percentage on all four sides gives a *uniform* outline, which equal
   * lengths would not: `top`/`bottom` resolve against the hex's height and
   * `left`/`right` against its width, and a regular hexagon's box carries
   * exactly the ratio an evenly offset one needs, since every edge sits half
   * the short axis from the centre. Inset by equal lengths instead and the four
   * diagonals come out thinner than the two straight sides.
   *
   * That held when the hexagon was vertex-left and it still holds vertex-up —
   * measured after the rotation, 6.86px on a straight side against 6.86px on a
   * diagonal. Only the axis it is a percentage *of* changed, from the height to
   * the width.
   *
   * A percentage also keeps the weight proportional on a pre-cap board that the
   * rail has to squeeze, where a `cqw` length would swallow the fill.
   */
  .hex-face {
    position: absolute;
    inset: var(--hex-stroke);
    clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
    background: var(--grey-700);
    transition: background-color var(--duration-fast) var(--ease-out);
  }

  .editable .space:hover .hex-face {
    background: var(--grey-600);
  }

  .space.selected .hex .hex-face {
    background: var(--grey-300);
  }

  /* No glow: `clip-path` cuts a shadow away. The fill is the signal. */
  .space.trigger .hex:not(.painted) .hex-face {
    background: var(--accent);
  }

  .editable .space.trigger:hover .hex:not(.painted) .hex-face {
    background: color-mix(in oklab, var(--accent) 80%, #fff);
  }

  .space.trigger.selected .hex:not(.painted) .hex-face {
    background: color-mix(in oklab, var(--accent) 65%, #fff);
  }

  /*
   * A space the author has coloured keeps that colour through hover and
   * selection — an inline background wins over these rules, and a fill the
   * author chose should not be second-guessed by a hover state. The brightness
   * is on the face alone so hovering does not wash out the outline too.
   */
  .editable .space:hover .hex.painted .hex-face {
    filter: brightness(1.12);
  }

  /*
   * `position` only so it paints over the face: the face is positioned, and a
   * positioned box covers in-flow siblings whatever the source order.
   */
  .marker {
    position: relative;
    width: 0.7cqw;
    height: 0.7cqw;
    border-radius: 50%;
    background: var(--accent);
  }

  /*
   * Editing happens in a full-size inspector. These transparent buttons only
   * select what the printed board already draws, so they can be generous on
   * screen without changing a single measured print dimension.
   */
  .entity-target {
    position: absolute;
    z-index: 4;
    min-width: var(--touch-target);
    min-height: var(--touch-target);
    padding: 0;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    touch-action: auto;
  }

  .entity-target:hover {
    box-shadow: 0 0 0 1px var(--border-strong);
  }

  .entity-target[aria-pressed='true'] {
    box-shadow: 0 0 0 2px var(--accent);
  }

  .entity-target:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }

  .space-target {
    top: calc(var(--space-h) / 2);
    left: 50%;
    width: max(100%, var(--touch-target));
    height: max(var(--space-h), var(--touch-target));
    translate: -50% -50%;
    border-radius: 50%;
  }

  /*
   * Hangs below its hex, out of the flow — see the rail.
   *
   * Narrower than the space and rising to the space's *middle*: the ribbon
   * starts halfway up the hex and the hex paints over it (`.hex` carries the
   * `z-index`), so the two read as one piece with the number tucked under the
   * space rather than as a tag hung beneath it. `top` is half the hex's height
   * and the padding above the number is what clears the part that is covered.
   */
  .pennant {
    position: absolute;
    top: calc(var(--space-h) / 2);
    left: 50%;
    translate: -50% 0;
    width: 75%;
    padding-block: calc(var(--space-h) / 2 + 0.2cqw) 1cqw;
    background: var(--accent);
    clip-path: polygon(0% 0%, 100% 0%, 100% 82%, 50% 100%, 0% 82%);
    text-align: center;
    color: #fff;
  }

  .pennant-value {
    display: block;
    width: 100%;
    background: transparent;
    border: none;
    text-align: center;
    font-family: var(--card-font-numeral);
    font-weight: var(--card-font-numeral-weight);
    font-size: 2cqw;
    line-height: 1.2;
    /* The author's ink, off the ribbon. */
    color: inherit;
  }

  /*
   * Butts straight against the last space. No negative margin any more: the
   * rail has no gap and the hex's right edge is vertical, so the two meet flush
   * on their own — measured at 0.0px. That is what removed the bridge element
   * this used to need to cover the notch between two clip-paths.
   */
  .final {
    display: flex;
    align-items: center;
    flex: none;
  }

  /*
   * Exactly the hex's height, outline included, so the arrow reads as the last
   * space carrying on rather than as a separate banner pinned beside it.
   */
  /*
   * The label used to be clipped: a fixed 9ch box and 2cqw of right padding
   * left "Do Something" nowhere to go. The right padding is now small and the
   * point starts further along, so the text runs closer to the tip; the label
   * wraps and stays centred rather than being cut. Height is fixed at the hex's,
   * and two short lines clear it.
   */
  .arrow {
    display: grid;
    place-items: center;
    height: var(--space-h);
    padding-inline: 0.9cqw 1.1cqw;
    background: var(--accent);
    clip-path: polygon(0% 0%, 86% 0%, 100% 50%, 86% 100%, 0% 100%);
  }

  .final-label {
    display: block;
    width: 7.5cqw;
    background: transparent;
    border: none;
    text-align: center;
    white-space: normal;
    overflow-wrap: break-word;
    text-wrap: balance;
    font-family: inherit;
    font-size: 1.1cqw;
    line-height: 1.05;
    font-weight: var(--card-font-title-weight);
    color: #fff;
  }

  /* -- tile and marker slots -------------------------------------------- */
  /*
   * Fills the rest of the red bed so the rectangle runs the arena's full width,
   * and takes whatever the track does not need.
   *
   * `flex-start` is what stops a slot's note shifting its well: every well
   * hangs from the same top edge and the copy below grows downward, rather than
   * each column centring itself and lifting its box by half the extra line.
   */
  .slots {
    flex: 1 1 auto;
    display: flex;
    align-items: flex-start;
    gap: 0.8cqw;
    min-width: 0;
  }

  .slot {
    position: relative;
    flex: 1 1 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3cqw;
    min-width: 0;
    max-width: 10cqw;
  }

  .slot-target {
    top: 50%;
    left: 50%;
    width: max(100%, var(--touch-target));
    height: max(100%, var(--touch-target));
    translate: -50% -50%;
  }

  /* Drawn as the space it is, so the board reads as somewhere to put a piece. */
  .slot-well {
    display: grid;
    place-items: center;
    width: 100%;
    aspect-ratio: 5 / 4;
    padding: 0.4cqw;
    border-radius: var(--radius-sm);
    border: 1px dashed color-mix(in oklab, var(--accent) 30%, var(--grey-600));
    background: color-mix(in oklab, var(--accent) 6%, transparent);
    /* The name is inside now; a long one wraps rather than widening the well. */
    overflow: hidden;
  }

  .slot-label {
    display: block;
    width: 100%;
    background: transparent;
    border: none;
    font-family: inherit;
    text-align: center;
    overflow-wrap: break-word;
    font-size: 1.2cqw;
    line-height: 1.2;
    color: var(--text-secondary);
  }

  .slot-note {
    display: block;
    width: 100%;
    background: transparent;
    border: none;
    text-align: center;
    font-family: inherit;
    font-size: 1cqw;
    line-height: 1.25;
    color: var(--text-muted);
  }

  /* -- the burst -------------------------------------------------------- */
  .win {
    flex: 0 0 11cqw;
    display: grid;
    place-items: center;
    min-width: 0;
  }

  /*
   * A starburst, which is what every printed board ends on. Twelve points is
   * enough to read as one at this size without turning the polygon into a
   * wall of numbers.
   */
  .burst {
    display: grid;
    place-items: center;
    width: 100%;
    aspect-ratio: 1;
    /*
     * Padding is the inscribed circle, not a guess. The polygon's inner
     * vertices sit about 0.68 of the way out from the centre — (61,18) is 33.8
     * units from (50,50) against the 50 of a point — so the copy has roughly
     * 7.4cqw of an 11cqw burst to live in. 1.8cqw leaves a line of eight or so
     * capitals fitting across that, which is what the printed burst does.
     */
    padding: 1.8cqw;
    background: var(--accent);
    clip-path: polygon(
      50% 0%, 61% 18%, 79% 10%, 79% 30%, 98% 32%, 86% 47%,
      100% 61%, 81% 66%, 86% 85%, 67% 80%, 61% 99%, 50% 83%,
      39% 99%, 33% 80%, 14% 85%, 19% 66%, 0% 61%, 14% 47%,
      2% 32%, 21% 30%, 21% 10%, 39% 18%
    );
    font-family: var(--card-font-title);
    font-weight: var(--card-font-title-weight);
    font-size: 1.8cqw;
    line-height: 1.05;
    text-align: center;
    text-transform: uppercase;
    color: #fff;
    /* Breaks between words, and only inside one if it cannot be helped. */
    overflow-wrap: break-word;
    text-wrap: balance;
  }

  /* -- placed notes ----------------------------------------------------- */
  .note {
    position: absolute;
    z-index: 1;
    /* Turn about the anchor the note is positioned by, so rotating it does not
       also move it — the drag handle would otherwise walk away from the text. */
    transform-origin: top left;
    display: flex;
    align-items: flex-start;
    gap: 0.2cqw;
    max-width: 30cqw;
    padding: 0.2cqw;
    border-radius: var(--radius-xs);
    /* Invisible until wanted: on the board it is copy, not a control. */
    border: 1px solid transparent;
    transition: border-color var(--duration-fast) var(--ease-out);
  }

  .editable .note {
    /* Placed text stays selectable even when it overlaps a space or slot. */
    z-index: 6;
  }

  .editable .note:hover,
  .editable .note:focus-within,
  .editable .note.selected,
  .note.moving {
    border-color: var(--border-strong);
    background: color-mix(in oklab, var(--grey-1000) 70%, transparent);
  }

  .note-visual-target {
    position: absolute;
    z-index: 1;
    inset: 0 auto auto 0;
    width: max(100%, var(--touch-target));
    height: max(100%, var(--touch-target));
    padding: 0;
    border: 0;
    border-radius: var(--radius-xs);
    background: transparent;
    touch-action: auto;
  }

  .note-visual-target.move-armed {
    cursor: grab;
    touch-action: none;
    user-select: none;
  }

  .note-visual-target.moving {
    cursor: grabbing;
  }

  .note-target {
    z-index: 7;
    width: var(--touch-target);
    height: var(--touch-target);
    translate: -50% -50%;
  }

  .note-target.move-armed {
    cursor: grab;
    touch-action: none;
    user-select: none;
  }

  .note-target.moving {
    cursor: grabbing;
  }

  .note-text {
    display: block;
    min-width: 6cqw;
    background: transparent;
    border: none;
    font-family: var(--card-font-title);
    font-weight: var(--card-font-title-weight);
    font-size: inherit;
    line-height: 1.25;
    /* The author's colour, off `.note`. */
    color: inherit;
    white-space: pre-wrap;
    overflow: hidden;
    padding-block-end: 0.08em;
  }
</style>
