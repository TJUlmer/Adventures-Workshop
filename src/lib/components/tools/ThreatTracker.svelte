<script lang="ts">
  /**
   * The villain's threat track: a visual builder over the printed layout.
   *
   * The board is the selection surface; a full-size inspector edits whichever
   * space, slot, or placed note the author chooses. The printed strip therefore
   * stays legible without asking a finger to operate print-scale controls.
   */
  import { mount, onDestroy, tick, unmount } from 'svelte';
  import type { Fill } from '$lib/cards/style';
  import { solid } from '$lib/cards/style';
  import { characterLabel } from '$lib/characters/factory';
  import { createArtwork, hasArtwork } from '$lib/core/artwork';
  import { readArtworkFile } from '$lib/core/image-import';
  import { renderThreatTrackImage, saveExport, slugify } from '$lib/export';
  import { createOperationGuard } from '$lib/interaction/operation-guard';
  import { startPointerSession } from '$lib/interaction/pointer-session';
  import type { PointerSession } from '$lib/interaction/pointer-session';
  import { ThreatBoard } from '$lib/renderer';
  import { THREAT_MAX_SPACES, THREAT_TRACK } from '$lib/renderer/geometry';
  import {
    canAddThreatSlot,
    canAddThreatStep,
    clampNotePosition,
    THREAT_ACCENT,
    THREAT_MAX_SLOTS,
    THREAT_NOTE_COLOR,
    THREAT_NUMBER_COLOR,
    THREAT_SPACE_STROKE,
    threatTotal
  } from '$lib/threat/types';
  import type {
    ThreatNote,
    ThreatNoteId,
    ThreatSlot,
    ThreatSlotId,
    ThreatStep,
    ThreatStepId
  } from '$lib/threat/types';
  import { navigation } from '$lib/state/navigation.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import {
    Button,
    ColorInput,
    ConfirmAction,
    EmptyState,
    FillEditor,
    Icon,
    NumberInput,
    Select,
    Slider,
    Switch,
    TextArea,
    TextInput
  } from '$lib/ui';
  import ArtworkPanel from '../workspace/ArtworkPanel.svelte';
  import EditorSection from '../workspace/EditorSection.svelte';
  import ReplacementPanel from '../workspace/ReplacementPanel.svelte';

  type ThreatSelection =
    | { kind: 'step'; id: ThreatStepId }
    | { kind: 'slot'; id: ThreatSlotId }
    | { kind: 'note'; id: ThreatNoteId };

  interface NoteMoveSnapshot {
    id: ThreatNoteId;
    x: number;
    y: number;
    grabX: number;
    grabY: number;
  }

  const set = $derived(workshop.adventure);
  const track = $derived(set.threat);

  let selection = $state<ThreatSelection | null>(null);
  const selectedStep = $derived(
    selection?.kind === 'step'
      ? (track.steps.find((step) => step.id === selection?.id) ?? null)
      : null
  );
  const selectedSlot = $derived(
    selection?.kind === 'slot'
      ? (track.slots.find((slot) => slot.id === selection?.id) ?? null)
      : null
  );
  const selectedNote = $derived(
    selection?.kind === 'note'
      ? (track.notes.find((note) => note.id === selection?.id) ?? null)
      : null
  );
  const selectedStepId = $derived(selectedStep?.id ?? null);
  const selectedSlotId = $derived(selectedSlot?.id ?? null);
  const selectedNoteId = $derived(selectedNote?.id ?? null);
  const selectedItemValue = $derived(
    selection ? `${selection.kind}:${selection.id as string}` : ''
  );
  const boardItemOptions = $derived([
    { value: '', label: 'Select a board item' },
    ...track.steps.map((step, index) => ({
      value: `step:${step.id as string}`,
      label: `Space ${index + 1} — threat ${step.value}`
    })),
    ...track.slots.map((slot, index) => ({
      value: `slot:${slot.id as string}`,
      label: `Slot ${index + 1}${slot.label.trim() ? ` — ${slot.label.trim()}` : ''}`
    })),
    ...track.notes.map((note, index) => ({
      value: `note:${note.id as string}`,
      label: `Placed text ${index + 1}${note.text.trim() ? ` — ${note.text.trim()}` : ''}`
    }))
  ]);
  const inspectorTitle = $derived.by(() => {
    if (selectedStep) return `Space ${track.steps.indexOf(selectedStep) + 1}`;
    if (selectedSlot) return `Slot ${track.slots.indexOf(selectedSlot) + 1}`;
    if (selectedNote) return `Placed text ${track.notes.indexOf(selectedNote) + 1}`;
    return 'Selected board item';
  });
  const inspectorHint = $derived.by(() => {
    if (selectedStep) return 'Threat value, effect, and the colours printed for this space.';
    if (selectedSlot) return 'The label and instruction printed with this tile or marker slot.';
    if (selectedNote) return 'Text, appearance, position, and deliberate movement for this note.';
    return 'Tap a space, slot, or placed note above to edit it here.';
  });
  const canAdd = $derived(canAddThreatStep(track));
  const canAddSlot = $derived(canAddThreatSlot(track));

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

  // -- exporting ----------------------------------------------------------

  let exporting = $state(false);
  let exportError = $state<string | null>(null);

  /**
   * Mount a read-only board off-screen and photograph that.
   *
   * Not the board on screen: it carries editor-only selection targets and state
   * that are not part of the printed track. A read-only mount is an explicit
   * export boundary even if the screen editor grows more affordances later.
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

  // -- the nameplate logo -------------------------------------------------

  let logoInput = $state<HTMLInputElement | null>(null);
  let logoError = $state<string | null>(null);
  const logoOperations = createOperationGuard();

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

    const scope = set;
    const operation = logoOperations.begin({
      setId: scope.id,
      targetKey: 'threat:logo',
      scope,
      label: file.name
    });
    logoError = null;
    try {
      const source = await readArtworkFile(file);
      if (!logoOperations.isCurrent(operation, set.id, set)) return;
      workshop.editThreat((t) => {
        t.logo.source = source;
        t.logo.label = operation.context.label;
      });
    } catch (cause) {
      if (!logoOperations.isCurrent(operation, set.id, set)) return;
      logoError = cause instanceof Error ? cause.message : 'Could not read that file.';
    }
  }

  function removeLogo(): void {
    const scope = set;
    logoOperations.supersede({ setId: scope.id, targetKey: 'threat:logo', scope });
    logoError = null;
    workshop.editThreat((threat) => (threat.logo = createArtwork()));
  }

  // -- placing notes ------------------------------------------------------

  let strip = $state<HTMLDivElement | null>(null);
  let armedNoteId = $state<ThreatNoteId | null>(null);
  let draggingNoteId = $state<ThreatNoteId | null>(null);
  let notePointerSession: PointerSession | null = null;

  function sameSelection(a: ThreatSelection | null, b: ThreatSelection): boolean {
    return a?.kind === b.kind && a.id === b.id;
  }

  function stopNoteMove(): void {
    const active = notePointerSession;
    notePointerSession = null;
    active?.cancel('mode-change');
    draggingNoteId = null;
    armedNoteId = null;
  }

  function selectEntity(next: ThreatSelection): void {
    const deselecting = sameSelection(selection, next);
    if (armedNoteId !== null) stopNoteMove();
    selection = deselecting ? null : next;
  }

  function selectBoardItem(value: string): void {
    if (!value) {
      if (armedNoteId !== null) stopNoteMove();
      selection = null;
      return;
    }

    const separator = value.indexOf(':');
    if (separator < 0) return;
    const kind = value.slice(0, separator);
    const id = value.slice(separator + 1);
    if (kind === 'step') selectEntity({ kind, id: id as ThreatStepId });
    if (kind === 'slot') selectEntity({ kind, id: id as ThreatSlotId });
    if (kind === 'note') selectEntity({ kind, id: id as ThreatNoteId });
  }

  async function toggleNoteMove(note: ThreatNote): Promise<void> {
    if (armedNoteId === note.id) {
      stopNoteMove();
      return;
    }
    stopNoteMove();
    selection = { kind: 'note', id: note.id };
    armedNoteId = note.id;
    await tick();
    const target = document.getElementById(`threat-note-${note.id}`);
    target?.scrollIntoView({ block: 'nearest', inline: 'center' });
    target?.focus({ preventScroll: true });
  }

  /**
   * Where a pointer is on the board, as a fraction of it.
   *
   * Fractions rather than pixels because the board resizes with the window and
   * a note has to stay where it was put — and because the grab offset is kept,
   * so the note follows the cursor instead of jumping its corner to it.
   */
  function fractionAt(
    event: PointerEvent,
    grab: { x: number; y: number }
  ): { x: number; y: number } | null {
    const box = strip?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return null;
    return {
      x: (event.clientX - box.left - grab.x) / box.width,
      y: (event.clientY - box.top - grab.y) / box.height
    };
  }

  function startNoteDrag(event: PointerEvent, note: ThreatNote): void {
    if (armedNoteId !== note.id || selectedNoteId !== note.id) return;

    notePointerSession?.cancel('superseded');
    notePointerSession = null;

    const box = strip?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return;
    event.preventDefault();

    const snapshot: NoteMoveSnapshot = {
      id: note.id,
      x: note.x,
      y: note.y,
      grabX: event.clientX - (box.left + note.x * box.width),
      grabY: event.clientY - (box.top + note.y * box.height)
    };

    notePointerSession = startPointerSession(event, {
      snapshot,
      onMove: (_movement, moved, start) => {
        const at = fractionAt(moved, { x: start.grabX, y: start.grabY });
        if (!at) {
          notePointerSession?.cancel('manual');
          return;
        }
        draggingNoteId = start.id;
        workshop.moveThreatNote(start.id, at.x, at.y);
      },
      onCommit: (_movement, _ended, start) => {
        notePointerSession = null;
        draggingNoteId = null;
        const moved = track.notes.find((entry) => entry.id === start.id);
        if (moved && (moved.x !== start.x || moved.y !== start.y)) {
          // One save for the whole drag, rather than one per pointer event.
          workshop.editThreat(() => {});
        }
      },
      onCancel: (_reason, _movement, start) => {
        notePointerSession = null;
        draggingNoteId = null;
        workshop.moveThreatNote(start.id, start.x, start.y);
      },
      onTap: () => {
        notePointerSession = null;
        draggingNoteId = null;
      }
    });
  }

  /** Arrow keys move a note too, for placement a drag cannot be precise about. */
  function nudgeNote(event: KeyboardEvent, note: ThreatNote): void {
    if (armedNoteId !== note.id || selectedNoteId !== note.id) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      stopNoteMove();
      return;
    }
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

  onDestroy(() => {
    notePointerSession?.dispose();
    logoOperations.invalidate();
  });

  function addStep(): void {
    if (!workshop.addThreatStep(track.steps.at(-1)?.value ?? 1)) return;
    const added = track.steps.at(-1);
    if (added) selection = { kind: 'step', id: added.id };
  }

  function addSlot(): void {
    if (!workshop.addThreatSlot()) return;
    const added = track.slots.at(-1);
    if (added) selection = { kind: 'slot', id: added.id };
  }

  function addNote(): void {
    const added = workshop.addThreatNote();
    selection = { kind: 'note', id: added.id };
  }

  function removeStep(step: ThreatStep): void {
    const index = track.steps.indexOf(step);
    workshop.removeThreatStep(step.id);
    const next = track.steps[index] ?? track.steps[index - 1] ?? null;
    selection = next ? { kind: 'step', id: next.id } : null;
  }

  function removeSlot(slot: ThreatSlot): void {
    const index = track.slots.indexOf(slot);
    workshop.removeThreatSlot(slot.id);
    const next = track.slots[index] ?? track.slots[index - 1] ?? null;
    selection = next ? { kind: 'slot', id: next.id } : null;
  }

  function removeNote(note: ThreatNote): void {
    const index = track.notes.indexOf(note);
    stopNoteMove();
    workshop.removeThreatNote(note.id);
    const next = track.notes[index] ?? track.notes[index - 1] ?? null;
    selection = next ? { kind: 'note', id: next.id } : null;
  }

  $effect(() => {
    if (!selection) return;

    const hidden = !track.enabled || (track.useReplacement && hasArtwork(track.replacement));
    const exists =
      selection.kind === 'step'
        ? track.steps.some((step) => step.id === selection?.id)
        : selection.kind === 'slot'
          ? track.slots.some((slot) => slot.id === selection?.id)
          : track.notes.some((note) => note.id === selection?.id);

    if (!hidden && exists) return;
    stopNoteMove();
    selection = null;
  });
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
        screen: selection hit regions and editor state are affordances, not
        printed content.
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

  <!--
    Off reads as a feature waiting to be started, not as a page that failed to
    load. It was a faded board behind a corner switch, which looks like "this
    villain has no track yet" rather than "there is a whole board builder one
    click away" — the same mistake the Components page already avoids, so this
    borrows its `EmptyState` wholesale. The header switch stays: it is how the
    track goes back *off*, which a call to action cannot express.
  -->
  {#if !track.enabled}
    <EmptyState
      icon="skull"
      title="No threat track"
      description="A printed strip the villain advances along as the adventure escalates. Nothing is lost while it is off, and it stays out of exports."
    >
      {#snippet actions()}
        <Button
          variant="primary"
          onclick={() => workshop.editThreat((t) => (t.enabled = true))}
        >
          <Icon name="plus" size={13} />
          Build a threat track
        </Button>
      {/snippet}
    </EmptyState>
  {:else}
  <!-- The board ---------------------------------------------------------- -->
  <section class="board-frame">
    <div class="board-viewport" aria-label="Threat board. Swipe sideways to see the whole strip.">
      <div class="board-stage">
        <ThreatBoard
          {track}
          villainName={villain ? characterLabel(villain) : ''}
          editable
          bind:strip
          {selectedStepId}
          {selectedSlotId}
          {selectedNoteId}
          {armedNoteId}
          {draggingNoteId}
          onselectstep={(id: ThreatStepId) => selectEntity({ kind: 'step', id })}
          onselectslot={(id: ThreatSlotId) => selectEntity({ kind: 'slot', id })}
          onselectnote={(id: ThreatNoteId) => selectEntity({ kind: 'note', id })}
          onnotedrag={startNoteDrag}
          onnotekey={nudgeNote}
        />
      </div>
    </div>

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
        onclick={addStep}
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
        disabled={!track.enabled || !canAddSlot}
        title={canAddSlot
          ? 'Add a tile or marker slot'
          : `The board holds up to ${THREAT_MAX_SLOTS} tile or marker slots.`}
        onclick={addSlot}
      >
        <Icon name="plus" size={13} />
        Add a slot
      </Button>

      <Button size="sm" variant="ghost" onclick={addNote}>
        <Icon name="plus" size={13} />
        Add text
      </Button>

      <label class="item-picker">
        <span class="field-label">Board item</span>
        <Select
          value={selectedItemValue}
          options={boardItemOptions}
          onchange={selectBoardItem}
        />
      </label>

      <span>
        <b class="numeric">{track.steps.length}</b> of
        <b class="numeric">{THREAT_MAX_SPACES}</b> spaces
      </span>
      <span>
        <b class="numeric">{track.slots.length}</b> of
        <b class="numeric">{THREAT_MAX_SLOTS}</b> slots
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
      <span class="pan-hint">Swipe the board sideways to inspect the whole strip.</span>
    </div>
  </section>

  <!-- Editors ------------------------------------------------------------ -->
  <div class="panels">
    <!--
      The board is now a selection surface. Keeping every real control here
      gives a finger-sized editor without changing the measured print strip.
    -->
    <div class="selection-inspector">
      <EditorSection title={inspectorTitle} hint={inspectorHint}>
        {#if selectedStep}
          {@const stepNumber = track.steps.indexOf(selectedStep) + 1}
          <div class="stack compact-field">
            <span class="field-label">Threat value</span>
            <NumberInput
              value={selectedStep.value}
              min={0}
              max={99}
              ariaLabel={`Threat value for space ${stepNumber}`}
              onchange={(value) => workshop.editThreat(() => (selectedStep.value = value))}
            />
          </div>

          <label class="stack">
            <span class="field-label">Effect</span>
            <TextArea
              value={selectedStep.effect}
              rows={3}
              placeholder="Optional — most spaces just advance the threat."
              oninput={(event) =>
                workshop.editThreat(() => (selectedStep.effect = event.currentTarget.value))}
            />
          </label>

          <div class="inspector-grid">
            <FillEditor
              label="Space colour"
              value={selectedStep.fill ?? defaultSpaceFill(selectedStep)}
              origin="the board"
              overridden={selectedStep.fill !== null}
              onchange={(fill) => workshop.editThreat(() => (selectedStep.fill = fill))}
              onreset={() => workshop.editThreat(() => (selectedStep.fill = null))}
            />

            <FillEditor
              label="Stroke colour"
              value={selectedStep.stroke ?? defaultSpaceStroke()}
              origin="the board"
              overridden={selectedStep.stroke !== null}
              onchange={(stroke) => workshop.editThreat(() => (selectedStep.stroke = stroke))}
              onreset={() => workshop.editThreat(() => (selectedStep.stroke = null))}
            />

            <FillEditor
              label="Number banner"
              value={selectedStep.bannerFill ?? defaultBannerFill()}
              origin="the track colour"
              overridden={selectedStep.bannerFill !== null}
              onchange={(banner) => workshop.editThreat(() => (selectedStep.bannerFill = banner))}
              onreset={() => workshop.editThreat(() => (selectedStep.bannerFill = null))}
            />

            <label class="stack">
              <span class="field-label">Number colour</span>
              <ColorInput
                value={selectedStep.numberColor ?? undefined}
                inherited={THREAT_NUMBER_COLOR}
                origin="the printed white"
                onchange={(ink) =>
                  workshop.editThreat(() => (selectedStep.numberColor = ink ?? null))}
              />
            </label>
          </div>

          <div class="inspector-actions">
            <ConfirmAction
              variant="ghost"
              armedVariant="danger"
              label={`Delete space ${stepNumber}`}
              confirmLabel={`Delete space ${stepNumber} — activate again to confirm`}
              confirmText="Confirm delete"
              onconfirm={() => removeStep(selectedStep)}
            >
              <Icon name="trash" size={13} />
              Delete space
            </ConfirmAction>
          </div>
        {:else if selectedSlot}
          {@const slotNumber = track.slots.indexOf(selectedSlot) + 1}
          <label class="stack">
            <span class="field-label">Label</span>
            <TextInput
              value={selectedSlot.label}
              placeholder={`Slot ${slotNumber}`}
              oninput={(event) =>
                workshop.editThreat(() => (selectedSlot.label = event.currentTarget.value))}
            />
          </label>

          <label class="stack">
            <span class="field-label">Instruction</span>
            <TextArea
              value={selectedSlot.note}
              rows={3}
              placeholder="What goes here, or what it means…"
              oninput={(event) =>
                workshop.editThreat(() => (selectedSlot.note = event.currentTarget.value))}
            />
          </label>

          <div class="inspector-actions">
            <ConfirmAction
              variant="ghost"
              armedVariant="danger"
              label={`Delete slot ${slotNumber}`}
              confirmLabel={`Delete slot ${slotNumber} — activate again to confirm`}
              confirmText="Confirm delete"
              onconfirm={() => removeSlot(selectedSlot)}
            >
              <Icon name="trash" size={13} />
              Delete slot
            </ConfirmAction>
          </div>
        {:else if selectedNote}
          {@const noteNumber = track.notes.indexOf(selectedNote) + 1}
          <label class="stack">
            <span class="field-label">Text</span>
            <TextArea
              value={selectedNote.text}
              rows={2}
              placeholder="Text on the board"
              oninput={(event) =>
                workshop.editThreat(() => (selectedNote.text = event.currentTarget.value))}
            />
          </label>

          <label class="stack">
            <span class="field-label">Colour</span>
            <ColorInput
              value={selectedNote.color === THREAT_NOTE_COLOR ? undefined : selectedNote.color}
              inherited={THREAT_NOTE_COLOR}
              origin="the stock ink"
              onchange={(color) =>
                workshop.editThreat(() => (selectedNote.color = color ?? THREAT_NOTE_COLOR))}
            />
          </label>

          <div class="note-controls">
            <Slider
              label="Size"
              value={selectedNote.size}
              min={0.8}
              max={4}
              step={0.1}
              neutral={1.4}
              format={(size) => size.toFixed(1)}
              onchange={(size) => workshop.editThreat(() => (selectedNote.size = size))}
            />

            <Slider
              label="Turn"
              value={selectedNote.rotation}
              min={-180}
              max={180}
              step={1}
              neutral={0}
              format={(deg) => `${Math.round(deg)}°`}
              onchange={(rotation) =>
                workshop.editThreat(() => (selectedNote.rotation = rotation))}
            />

            <Slider
              label="Horizontal position"
              value={selectedNote.x}
              min={0}
              max={1}
              step={0.005}
              neutral={0.5}
              format={(position) => `${Math.round(position * 100)}%`}
              onchange={(x) =>
                workshop.editThreat(() => {
                  const at = clampNotePosition(x, selectedNote.y);
                  selectedNote.x = at.x;
                  selectedNote.y = at.y;
                })}
            />

            <Slider
              label="Vertical position"
              value={selectedNote.y}
              min={0}
              max={1}
              step={0.005}
              neutral={0.5}
              format={(position) => `${Math.round(position * 100)}%`}
              onchange={(y) =>
                workshop.editThreat(() => {
                  const at = clampNotePosition(selectedNote.x, y);
                  selectedNote.x = at.x;
                  selectedNote.y = at.y;
                })}
            />
          </div>

          <div class="move-note">
            <Button
              size="sm"
              variant={armedNoteId === selectedNote.id ? 'primary' : 'secondary'}
              aria-pressed={armedNoteId === selectedNote.id}
              aria-controls={`threat-note-${selectedNote.id}`}
              onclick={() => toggleNoteMove(selectedNote)}
            >
              <Icon name="move" size={13} />
              {armedNoteId === selectedNote.id ? 'Done moving' : 'Move'}
            </Button>
            <p class="hint" role="status">
              {armedNoteId === selectedNote.id
                ? 'Drag the selected text on the board, or use the arrow keys. Choose Done moving when it is placed.'
                : 'Choose Move before the note can capture a drag. Ordinary swipes pan the board.'}
            </p>
          </div>

          <div class="inspector-actions">
            <ConfirmAction
              variant="ghost"
              armedVariant="danger"
              label={`Delete placed text ${noteNumber}`}
              confirmLabel={`Delete placed text ${noteNumber} — activate again to confirm`}
              confirmText="Confirm delete"
              onconfirm={() => removeNote(selectedNote)}
            >
              <Icon name="trash" size={13} />
              Delete placed text
            </ConfirmAction>
          </div>
        {:else}
          <p class="hint">Nothing selected.</p>
        {/if}
      </EditorSection>
    </div>

    <!--
      First, and the shared `ReplacementPanel` rather than the hand-built copy
      that used to sit at the bottom of the right-hand column. It is the same
      decision as on every other design surface — a finished image made
      elsewhere, in place of composing one — so it is the same control in the
      same position, learned once. The board above still shows the composition
      while this is off.
    -->
    <ReplacementPanel
      artwork={track.replacement}
      enabled={track.useReplacement}
      operationKey="set:threat:replacement"
      hint="A finished board made elsewhere, used instead of the one above. {THREAT_TRACK.label} — {THREAT_TRACK.bleed.width} × {THREAT_TRACK.bleed.height} px at 300 DPI."
      replaces="Replaces the whole board, elements included."
      landscape
      onpick={(source, label) =>
        workshop.editThreat((t) => {
          t.replacement.source = source;
          t.replacement.label = label;
          t.useReplacement = true;
        })}
      ontoggle={(use) => workshop.editThreat((t) => (t.useReplacement = use))}
      onclear={() =>
        workshop.editThreat((t) => {
          t.replacement.source = null;
          t.replacement.label = '';
          t.useReplacement = false;
        })}
    />

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
            value={track.accent === THREAT_ACCENT ? undefined : track.accent}
            inherited={THREAT_ACCENT}
            origin="the printed board"
            onchange={(accent) => workshop.editThreat((t) => (t.accent = accent ?? THREAT_ACCENT))}
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
            value={track.spaceStroke === THREAT_SPACE_STROKE ? undefined : track.spaceStroke}
            inherited={THREAT_SPACE_STROKE}
            origin="the printed board"
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
                onclick={removeLogo}
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
  {/if}
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
    min-width: 0;
  }

  /*
   * The print strip stays large enough to read and tap. This wrapper, not the
   * page, owns its extra width, so a sideways swipe never widens the document.
   */
  .board-viewport {
    width: 100%;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    overscroll-behavior-y: auto;
    border-radius: var(--radius-lg);
    scrollbar-width: thin;
  }

  .board-stage {
    min-width: 0;
  }

  .board-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--space-5);
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

  .item-picker {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: min(100%, 280px);
  }

  .pan-hint {
    display: none;
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

  .selection-inspector {
    width: min(100%, 920px);
  }

  .inspector-grid,
  .note-controls {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-5) var(--space-6);
  }

  .compact-field {
    align-items: flex-start;
  }

  .move-note {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .move-note .hint {
    flex: 1 1 260px;
    margin: 0;
  }

  .inspector-actions {
    display: flex;
    justify-content: flex-end;
    padding-top: var(--space-3);
    border-top: 1px solid var(--border-subtle);
  }

  .row {
    display: grid;
    gap: var(--space-6) var(--space-7);
    /* These are different heights; none should stretch to match a neighbour. */
    align-items: start;
  }

  .row.primary {
    grid-template-columns: minmax(0, 760px);
  }

  .row.secondary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
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

  .link {
    color: var(--text-accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  @media (max-width: 760px), (any-pointer: coarse) {
    .board-stage {
      /* At this width the printed hex itself reaches roughly 45px. */
      min-width: 72rem;
    }

    .pan-hint {
      display: block;
      flex-basis: 100%;
    }
  }

  @media (max-width: 760px) {
    .page {
      gap: var(--space-5);
      padding: var(--space-5) var(--space-4) var(--space-8);
    }

    .head {
      align-items: flex-start;
      flex-wrap: wrap;
    }

    .head-actions {
      flex-wrap: wrap;
    }

    .board-foot {
      gap: var(--space-2) var(--space-3);
    }

    .board-foot .size {
      margin-left: 0;
    }

    .item-picker {
      flex-basis: 100%;
      align-items: stretch;
      flex-direction: column;
    }

    .inspector-grid,
    .note-controls {
      grid-template-columns: minmax(0, 1fr);
    }

    .inspector-actions {
      justify-content: stretch;
    }
  }
</style>
