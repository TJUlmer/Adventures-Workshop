<script lang="ts">
  /**
   * The villain's threat track: a visual builder over the printed layout.
   *
   * The preview is the editor. Each hex is a space, each pennant its value —
   * clicking a space selects it, and its effect text edits below, so the thing
   * being changed and the thing being looked at are never separated.
   */
  import { mount, tick, unmount } from 'svelte';
  import type { Fill } from '$lib/cards/style';
  import { solid } from '$lib/cards/style';
  import { characterLabel } from '$lib/characters/factory';
  import { createArtwork, hasArtwork } from '$lib/core/artwork';
  import { readArtworkFile } from '$lib/core/image-import';
  import { renderThreatTrackImage, saveExport, slugify } from '$lib/export';
  import { ThreatBoard } from '$lib/renderer';
  import { THREAT_MAX_SPACES, THREAT_TRACK } from '$lib/renderer/geometry';
  import {
    canAddThreatStep,
    clampNotePosition,
    THREAT_NOTE_COLOR,
    THREAT_NUMBER_COLOR,
    THREAT_SPACE_STROKE,
    threatTotal
  } from '$lib/threat/types';
  import type {
    ThreatNote,
    ThreatNoteId,
    ThreatSlotId,
    ThreatStep,
    ThreatStepId
  } from '$lib/threat/types';
  import { navigation } from '$lib/state/navigation.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import {
    Button,
    ColorInput,
    FillEditor,
    Icon,
    Select,
    Slider,
    Switch,
    TextArea,
    TextInput
  } from '$lib/ui';
  import ArtworkPanel from '../workspace/ArtworkPanel.svelte';
  import EditorSection from '../workspace/EditorSection.svelte';

  const set = $derived(workshop.adventure);
  const track = $derived(set.threat);

  let selectedId = $state<ThreatStepId | null>(null);
  const selected = $derived(track.steps.find((step) => step.id === selectedId) ?? null);
  const canAdd = $derived(canAddThreatStep(track));

  const villainOptions = $derived([
    { value: '', label: 'Not assigned' },
    ...set.characters
      .filter((character) => character.role === 'villain')
      .map((character) => ({ value: character.id as string, label: characterLabel(character) }))
  ]);

  const villain = $derived(
    set.characters.find((character) => character.id === track.villainId) ?? null
  );

  /**
   * What a space is already showing, so opening the colour control starts from
   * that rather than from black. The last space follows the accent; every
   * other one the board's stock grey.
   */
  function defaultSpaceFill(step: ThreatStep): Fill {
    return solid(track.steps.at(-1)?.id === step.id ? track.accent : SPACE_GREY);
  }

  /**
   * What a space's outline is already showing. Every space follows the board's
   * unless it has been given one, so there is no trigger-space exception here.
   */
  function defaultSpaceStroke(): Fill {
    return solid(track.spaceStroke);
  }

  /** A ribbon follows the track's accent until it is given something else. */
  function defaultBannerFill(): Fill {
    return solid(track.accent);
  }

  /** The stock hex colour, matching `--grey-700` the board draws them in. */
  const SPACE_GREY = '#3d4450';

  let replacementInput = $state<HTMLInputElement | null>(null);
  let artError = $state<string | null>(null);

  // -- exporting ----------------------------------------------------------

  let exporting = $state(false);
  let exportError = $state<string | null>(null);

  /**
   * Mount a read-only board off-screen and photograph that.
   *
   * Not the board on screen: it carries add and remove buttons that are not
   * part of the printed track, and its typed values live in form controls,
   * whose text a clone does not inherit.
   */
  async function exportBoard(): Promise<void> {
    exporting = true;
    exportError = null;

    const host = document.createElement('div');
    host.style.cssText = `position:fixed;left:-99999px;top:0;width:${THREAT_TRACK.bleed.width}px;pointer-events:none`;
    document.body.append(host);

    const view = mount(ThreatBoard, {
      target: host,
      props: {
        track,
        villainName: villain ? characterLabel(villain) : '',
        editable: false
      }
    });

    try {
      await document.fonts.ready;
      await tick();
      const board = host.firstElementChild as HTMLElement | null;
      if (!board) throw new Error('The board did not render.');
      saveExport({
        filename: `${slugify(set.name, 'adventure-set')}-threat-track.png`,
        mimeType: 'image/png',
        blob: await renderThreatTrackImage(board)
      });
    } catch (cause) {
      exportError = cause instanceof Error ? cause.message : 'Export failed.';
    } finally {
      unmount(view);
      host.remove();
      exporting = false;
    }
  }

  async function pickReplacement(
    event: Event & { currentTarget: HTMLInputElement }
  ): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    artError = null;
    try {
      const source = await readArtworkFile(file);
      workshop.editThreat((t) => {
        t.replacement.source = source;
        t.replacement.label = file.name;
        // Choosing one is asking to see it.
        t.useReplacement = true;
      });
    } catch (cause) {
      artError = cause instanceof Error ? cause.message : 'Could not read that file.';
    }
  }

  // -- the nameplate logo -------------------------------------------------

  let logoInput = $state<HTMLInputElement | null>(null);
  let logoError = $state<string | null>(null);

  /**
   * Read the logo into the document as a data URL.
   *
   * A data URL rather than a path, like every other asset here: a set has to
   * survive being handed to someone else as one file.
   */
  async function pickLogo(event: Event & { currentTarget: HTMLInputElement }): Promise<void> {
    const file = event.currentTarget.files?.[0];
    // Cleared at once, or picking the same file twice fires no event.
    event.currentTarget.value = '';
    if (!file) return;

    logoError = null;
    try {
      const source = await readArtworkFile(file);
      workshop.editThreat((t) => {
        t.logo.source = source;
        t.logo.label = file.name;
      });
    } catch (cause) {
      logoError = cause instanceof Error ? cause.message : 'Could not read that file.';
    }
  }

  // -- placing notes ------------------------------------------------------

  let strip = $state<HTMLDivElement | null>(null);
  let draggingNoteId = $state<ThreatNoteId | null>(null);

  /**
   * Where a pointer is on the board, as a fraction of it.
   *
   * Fractions rather than pixels because the board resizes with the window and
   * a note has to stay where it was put — and because the grab offset is kept,
   * so the note follows the cursor instead of jumping its corner to it.
   */
  function fractionAt(event: PointerEvent, grab: { x: number; y: number }): { x: number; y: number } {
    const box = strip?.getBoundingClientRect();
    if (!box) return grab;
    return {
      x: (event.clientX - box.left - grab.x) / box.width,
      y: (event.clientY - box.top - grab.y) / box.height
    };
  }

  function startNoteDrag(event: PointerEvent, note: ThreatNote): void {
    const box = strip?.getBoundingClientRect();
    if (!box) return;
    event.preventDefault();

    const grab = {
      x: event.clientX - (box.left + note.x * box.width),
      y: event.clientY - (box.top + note.y * box.height)
    };

    draggingNoteId = note.id;
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);

    const move = (moved: PointerEvent) => {
      const at = fractionAt(moved, grab);
      workshop.moveThreatNote(note.id, at.x, at.y);
    };
    const done = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', done);
      handle.removeEventListener('pointercancel', done);
      draggingNoteId = null;
      // One save for the whole drag, rather than one per pointer event.
      workshop.editThreat(() => {});
    };

    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', done);
    handle.addEventListener('pointercancel', done);
  }

  /** Arrow keys move a note too, for placement a drag cannot be precise about. */
  function nudgeNote(event: KeyboardEvent, note: ThreatNote): void {
    const step = event.shiftKey ? 0.05 : 0.005;
    const by: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step]
    };
    const delta = by[event.key];
    if (!delta) return;
    event.preventDefault();
    workshop.editThreat(() => {
      const at = clampNotePosition(note.x + delta[0], note.y + delta[1]);
      note.x = at.x;
      note.y = at.y;
    });
  }
</script>

<div class="page scroll-y">
  <header class="head">
    <div>
      <span class="eyebrow">Set tool</span>
      <h1 class="title">Threat track</h1>
    </div>

    <div class="head-actions">
      <!--
        Photographed from a read-only copy rather than from the board on
        screen: the editor's buttons and fields are affordances, and a form
        control's text does not survive being cloned for rasterisation.
      -->
      <Button size="sm" disabled={!track.enabled || exporting} onclick={exportBoard}>
        <Icon name="download" size={13} />
        {exporting ? 'Rendering…' : 'Export PNG'}
      </Button>

      <Switch
        label="Use a threat track"
        checked={track.enabled}
        onchange={(enabled) => workshop.editThreat((t) => (t.enabled = enabled))}
      />
    </div>
  </header>

  {#if exportError}<p class="export-error">{exportError}</p>{/if}

  {#if !track.enabled}
    <p class="disabled-note">
      This adventure has no threat track. Turn it on to build one — nothing is lost while it is
      off, and it stays out of exports.
    </p>
  {/if}

  <!-- The board ---------------------------------------------------------- -->
  <section class="board-frame" class:off={!track.enabled}>
    <ThreatBoard
      {track}
      villainName={villain ? characterLabel(villain) : ''}
      editable
      bind:strip
      {selectedId}
      {draggingNoteId}
      onselectstep={(id: ThreatStepId) => (selectedId = id === selectedId ? null : id)}
      onstepvalue={(step: ThreatStep, value: number) =>
        workshop.editThreat(() => (step.value = value))}
      onedit={(mutate: () => void) => workshop.editThreat(mutate)}
      onremovestep={(id: ThreatStepId) => workshop.removeThreatStep(id)}
      onremoveslot={(id: ThreatSlotId) => workshop.removeThreatSlot(id)}
      onremovenote={(note: ThreatNote) => workshop.removeThreatNote(note.id)}
      onnotedrag={startNoteDrag}
      onnotekey={nudgeNote}
    />

    <div class="board-foot">
      <!--
        The add control lives here rather than at the end of the rail, where it
        took a space's worth of printed width off the track for something that
        never prints. Beside the count is where the cap can explain itself.
      -->
      <Button
        size="sm"
        variant="ghost"
        disabled={!track.enabled || !canAdd}
        title={canAdd
          ? 'Add a space to the track'
          : `The rail holds ${THREAT_MAX_SPACES} spaces at their printed size.`}
        onclick={() => workshop.addThreatStep(track.steps.at(-1)?.value ?? 1)}
      >
        <Icon name="plus" size={13} />
        Add a space
      </Button>

      <!--
        Beside the other add, and off the board for the same reason: on the
        strip it took room the slots themselves want.
      -->
      <Button
        size="sm"
        variant="ghost"
        disabled={!track.enabled}
        title="Add a tile or marker slot"
        onclick={() => workshop.addThreatSlot()}
      >
        <Icon name="plus" size={13} />
        Add a slot
      </Button>

      <span>
        <b class="numeric">{track.steps.length}</b> of
        <b class="numeric">{THREAT_MAX_SPACES}</b> spaces
      </span>
      <span><b class="numeric">{threatTotal(track)}</b> total threat</span>
      <!--
        The board above is the editor, not a print proof. This is the size the
        track actually prints at, so the author knows what they are filling.
      -->
      <span class="size">
        {THREAT_TRACK.label}
        <span class="numeric">
          {THREAT_TRACK.bleed.width} × {THREAT_TRACK.bleed.height} px
        </span>
      </span>
    </div>
  </section>

  <!-- Editors ------------------------------------------------------------ -->
  <div class="panels">
    <!--
      The three you work in while looking at the board, across rather than
      down: the board is a wide, short thing, so a single column under it left
      most of the page empty and pushed the space you had just clicked below
      the fold.
    -->
    <div class="row primary">
      <EditorSection title="Track" columns={2}>
        <label class="stack">
          <span class="field-label">Villain</span>
          <Select
            value={track.villainId ?? ''}
            options={villainOptions}
            onchange={(next) =>
              workshop.editThreat((t) => (t.villainId = next === '' ? null : (next as never)))}
          />
        </label>

        <label class="stack">
          <span class="field-label">Track colour</span>
          <ColorInput
            value={track.accent}
            inherited={track.accent}
            onchange={(accent) => workshop.editThreat((t) => (t.accent = accent ?? '#e01b24'))}
          />
        </label>

        <!--
          The outline every space takes. Separate from the track colour because
          the outline is what makes a space read as a space, and an author who
          recolours the track rarely wants the drawing to change with it.
        -->
        <label class="stack">
          <span class="field-label">Space stroke</span>
          <ColorInput
            value={track.spaceStroke}
            inherited={track.spaceStroke}
            onchange={(stroke) =>
              workshop.editThreat((t) => (t.spaceStroke = stroke ?? THREAT_SPACE_STROKE))}
          />
        </label>

        <label class="stack">
          <span class="field-label">Nameplate line</span>
          <TextInput
            value={track.subtitle}
            placeholder="e.g. Point Pleasant"
            oninput={(event) =>
              workshop.editThreat((t) => (t.subtitle = event.currentTarget.value))}
          />
        </label>

        <!--
          The nameplate's lockup. The printed board carries the publisher's,
          which cannot be redistributed — so the plate has stood behind a drawn
          placeholder. This is the way back in: make one anywhere, attach it
          here, and the placeholder steps aside.
        -->
        <div class="stack">
          <span class="field-label">Nameplate logo</span>
          <input
            class="hidden-file"
            type="file"
            accept="image/*"
            bind:this={logoInput}
            onchange={pickLogo}
          />
          {#if hasArtwork(track.logo)}
            <p class="logo-name">{track.logo.label || 'Logo'}</p>
            <div class="logo-actions">
              <Button size="sm" onclick={() => logoInput?.click()}>Replace</Button>
              <Button
                size="sm"
                variant="ghost"
                onclick={() => workshop.editThreat((t) => (t.logo = createArtwork()))}
              >
                Remove
              </Button>
            </div>
          {:else}
            <Button size="sm" onclick={() => logoInput?.click()}>
              <Icon name="image" size={13} />
              Choose an image
            </Button>
          {/if}
          {#if logoError}<p class="logo-error" role="alert">{logoError}</p>{/if}
        </div>

        <label class="stack">
          <span class="field-label">Win burst</span>
          <TextInput
            value={track.winLabel}
            placeholder={villain ? `${characterLabel(villain)} wins!` : 'Villain wins!'}
            oninput={(event) =>
              workshop.editThreat((t) => (t.winLabel = event.currentTarget.value))}
          />
        </label>
      </EditorSection>

      <EditorSection
        title={selected ? `Space ${track.steps.indexOf(selected) + 1}` : 'Space effect'}
        hint={selected
          ? 'What happens when the marker reaches this space.'
          : 'Select a space on the track above.'}
      >
        {#if selected}
          <FillEditor
            label="Space colour"
            value={selected.fill ?? defaultSpaceFill(selected)}
            origin="the board"
            overridden={selected.fill !== null}
            onchange={(fill) => workshop.editThreat(() => (selected.fill = fill))}
            onreset={() => workshop.editThreat(() => (selected.fill = null))}
          />

          <FillEditor
            label="Stroke colour"
            value={selected.stroke ?? defaultSpaceStroke()}
            origin="the board"
            overridden={selected.stroke !== null}
            onchange={(stroke) => workshop.editThreat(() => (selected.stroke = stroke))}
            onreset={() => workshop.editThreat(() => (selected.stroke = null))}
          />

          <!--
            The ribbon and its number, apart from the hex above them: the number
            has to stay legible whatever the space it hangs off does.
          -->
          <FillEditor
            label="Number banner"
            value={selected.bannerFill ?? defaultBannerFill()}
            origin="the track colour"
            overridden={selected.bannerFill !== null}
            onchange={(banner) => workshop.editThreat(() => (selected.bannerFill = banner))}
            onreset={() => workshop.editThreat(() => (selected.bannerFill = null))}
          />

          <!--
            `ColorInput` already models override-or-inherit, so `null` maps onto
            its `undefined` and the reset affordance comes for free.
          -->
          <label class="stack">
            <span class="field-label">Number colour</span>
            <ColorInput
              value={selected.numberColor ?? undefined}
              inherited={THREAT_NUMBER_COLOR}
              origin="the printed white"
              onchange={(ink) => workshop.editThreat(() => (selected.numberColor = ink ?? null))}
            />
          </label>

          <TextArea
            value={selected.effect}
            rows={3}
            placeholder="Optional — most spaces just advance the threat."
            oninput={(event) =>
              workshop.editThreat(() => (selected.effect = event.currentTarget.value))}
          />
        {:else}
          <p class="hint">Nothing selected.</p>
        {/if}
      </EditorSection>

      <EditorSection
        title="Placed text"
        hint="Anything else the board needs to say. Drag each one by its grip to place it."
      >
        {#snippet actions()}
          <Button size="sm" onclick={() => workshop.addThreatNote()}>
            <Icon name="plus" size={13} />
            Add text
          </Button>
        {/snippet}

        {#if track.notes.length === 0}
          <p class="hint">
            No placed text. Add one and it lands on the board, ready to be dragged where you
            want it.
          </p>
        {:else}
          {#each track.notes as note (note.id)}
            <div class="note-row">
              <TextInput
                value={note.text}
                placeholder="Text on the board"
                oninput={(event) =>
                  workshop.editThreat(() => (note.text = event.currentTarget.value))}
              />
              <!--
                A note lands on the author's own artwork, so its ink has to be
                answerable — light copy on a light picture is unreadable and no
                board-wide default can fix it.
              -->
              <ColorInput
                value={note.color}
                inherited={note.color}
                onchange={(color) =>
                  workshop.editThreat(() => (note.color = color ?? THREAT_NOTE_COLOR))}
              />
              <div class="note-size">
                <Slider
                  label="Size"
                  value={note.size}
                  min={0.8}
                  max={4}
                  step={0.1}
                  neutral={1.4}
                  format={(size) => `${size.toFixed(1)}`}
                  onchange={(size) => workshop.editThreat(() => (note.size = size))}
                />
              </div>
              <div class="note-size">
                <!--
                  Full turn either way rather than 0–360: a label is far more
                  often nudged a few degrees anticlockwise than swung most of
                  the way round, and −15 is easier to reach from the middle
                  than 345 is from either end.
                -->
                <Slider
                  label="Turn"
                  value={note.rotation}
                  min={-180}
                  max={180}
                  step={1}
                  neutral={0}
                  format={(deg) => `${Math.round(deg)}°`}
                  onchange={(rotation) => workshop.editThreat(() => (note.rotation = rotation))}
                />
              </div>
            </div>
          {/each}
        {/if}
      </EditorSection>
    </div>

    <!-- Set once, then left alone: two abreast is enough for these. -->
    <div class="row secondary">
      <EditorSection title="End of the track" hint="What the final arrow does.">
        <label class="stack">
          <span class="field-label">Label</span>
          <TextInput
            value={track.finalLabel}
            placeholder="Do Something"
            oninput={(event) =>
              workshop.editThreat((t) => (t.finalLabel = event.currentTarget.value))}
          />
        </label>

        <TextArea
          value={track.finalEffect}
          rows={3}
          placeholder="What happens when the marker runs off the end…"
          oninput={(event) =>
            workshop.editThreat((t) => (t.finalEffect = event.currentTarget.value))}
        />
      </EditorSection>

      <EditorSection
        title="Tile and marker slots"
        hint="Spaces on the board for the pieces the villain’s progress puts on the table."
      >
        {#if track.slots.length === 0}
          <p class="hint">No slots. “Add a slot” is under the board.</p>
        {:else}
          {#each track.slots as slot, index (slot.id)}
            <div class="slot-row">
              <TextInput
                value={slot.label}
                placeholder="Slot {index + 1}"
                oninput={(event) =>
                  workshop.editThreat(() => (slot.label = event.currentTarget.value))}
              />
              <TextInput
                value={slot.note}
                placeholder="What goes here, or what it means…"
                oninput={(event) =>
                  workshop.editThreat(() => (slot.note = event.currentTarget.value))}
              />
            </div>
          {/each}
        {/if}
      </EditorSection>

      <!--
        Two ways to picture the board: put art behind what the app draws, or
        drop in a finished board and let it stand for the whole thing.
      -->
      <EditorSection
        title="Board artwork"
        hint="Drawn under the track, with everything else over it."
      >
        <ArtworkPanel
          target={{ entity: 'threat' }}
          aspect={THREAT_TRACK.bleed.width / THREAT_TRACK.bleed.height}
        />
      </EditorSection>

      <EditorSection
        title="Replacement board"
        hint="A finished board made elsewhere, used instead of the one above. {THREAT_TRACK.label} — {THREAT_TRACK.bleed.width} × {THREAT_TRACK.bleed.height} px at 300 DPI."
      >
        {#snippet actions()}
          {#if hasArtwork(track.replacement)}
            <Button
              size="sm"
              variant="ghost"
              onclick={() =>
                workshop.editThreat((t) => {
                  t.replacement.source = null;
                  t.replacement.label = '';
                  t.useReplacement = false;
                })}
            >
              Remove
            </Button>
          {/if}
        {/snippet}

        <input
          bind:this={replacementInput}
          class="sr-only"
          type="file"
          accept="image/*"
          onchange={pickReplacement}
        />

        <div class="import">
          <button
            type="button"
            class="thumb"
            class:empty={!hasArtwork(track.replacement)}
            title={hasArtwork(track.replacement) ? 'Replace image' : 'Choose image'}
            onclick={() => replacementInput?.click()}
          >
            {#if hasArtwork(track.replacement) && track.replacement.source}
              <img src={track.replacement.source} alt="" />
            {:else}
              <Icon name="image" size={18} />
            {/if}
          </button>

          <div class="import-text">
            <span class="filename">{track.replacement.label || 'No replacement board'}</span>
            {#if artError}
              <span class="error">{artError}</span>
            {:else}
              <span class="sub">Replaces the whole board, elements included.</span>
            {/if}
          </div>

          <Button size="sm" onclick={() => replacementInput?.click()}>
            <Icon name="upload" size={13} />
            {hasArtwork(track.replacement) ? 'Replace' : 'Choose'}
          </Button>
        </div>

        {#if hasArtwork(track.replacement)}
          <Switch
            label="Use the replacement"
            hint="Off keeps the image but shows the board built here."
            checked={track.useReplacement}
            onchange={(use) => workshop.editThreat((t) => (t.useReplacement = use))}
          />
        {/if}
      </EditorSection>

      <EditorSection title="Rules" hint="How the track advances, in your own words.">
        <TextArea
          value={track.rules}
          rows={4}
          placeholder="e.g. Advance the marker one space each time the villain takes damage…"
          oninput={(event) => workshop.editThreat((t) => (t.rules = event.currentTarget.value))}
        />
      </EditorSection>
    </div>

    {#if villainOptions.length === 1}
      <p class="hint">
        No villain to assign yet.
        <button type="button" class="link" onclick={() => navigation.go('home')}>
          Add one from the set home
        </button>.
      </p>
    {/if}
  </div>
</div>

<style>
  .page {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-7) var(--space-8) var(--space-10);
  }

  .head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-5);
  }

  .eyebrow {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .title {
    font-family: var(--font-display);
    font-size: var(--text-2xl);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-tight);
    color: var(--text-primary);
  }

  .head-actions {
    display: flex;
    align-items: center;
    gap: var(--space-5);
  }

  .export-error {
    font-size: var(--text-xs);
    color: var(--danger);
  }

  .disabled-note,
  .hint {
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
  }

  /* -- the board -------------------------------------------------------- */
  /*
   * `flex: none` because a flex item shrinks by default, and this one was being
   * squeezed to a sliver of the page. The board itself owns its layout; this is
   * only the frame around it and the tally underneath.
   */
  .board-frame {
    display: flex;
    flex-direction: column;
    flex: none;
    gap: var(--space-3);
  }

  .board-frame.off {
    opacity: 0.45;
  }

  .board-foot {
    display: flex;
    gap: var(--space-5);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .board-foot b {
    color: var(--text-secondary);
  }

  .board-foot .size {
    display: flex;
    gap: var(--space-2);
    margin-left: auto;
    opacity: 0.75;
  }

  /* -- panels ----------------------------------------------------------- */
  /*
   * Sections run across the page, not down it. The board is a 7:1 strip, so a
   * single 720px column beneath it left most of the width empty and put the
   * controls for the space you had just clicked below the fold.
   */
  .panels {
    display: flex;
    flex-direction: column;
    gap: var(--space-7);
    /* Uses the page, but not so far that a line of prose stops being readable. */
    max-width: 1600px;
  }

  .row {
    display: grid;
    gap: var(--space-6) var(--space-7);
    /* These are different heights; none should stretch to match a neighbour. */
    align-items: start;
  }

  /*
   * Track takes the widest share because it alone carries five controls in two
   * columns — `EditorSection`'s own fold to one column queries a `workspace`
   * container, which nothing on this page declares, so it will not rescue a
   * column that is too narrow for it.
   */
  .row.primary {
    grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1fr);
  }

  .row.secondary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  /* `home` is the page container, from AppShell. */
  @container home (max-width: 1180px) {
    .row.primary {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @container home (max-width: 820px) {
    .row.primary,
    .row.secondary {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .field-label {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  /* Name and note side by side: the note is the longer of the two. */
  .slot-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
    gap: var(--space-3);
  }

  /*
   * The text and its ink on one line, the size under them. Three controls
   * abreast fitted when this section had the page to itself; in a third of it
   * the slider came out too short to aim with.
   */
  .note-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2) var(--space-3);
  }

  .hidden-file {
    display: none;
  }

  .logo-name {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }

  .logo-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .logo-error {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--danger);
  }

  .note-size {
    grid-column: 1 / -1;
  }

  /* -- picking a replacement board -------------------------------------- */
  .import {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
  }

  .thumb {
    display: grid;
    place-items: center;
    width: 72px;
    height: 40px;
    flex: none;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--surface-inset);
    border: 1px solid var(--border-default);
    color: var(--text-muted);
  }

  .thumb.empty {
    border-style: dashed;
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .import-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .filename {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sub {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .error {
    font-size: var(--text-xs);
    color: var(--danger);
  }

  .link {
    color: var(--text-accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
