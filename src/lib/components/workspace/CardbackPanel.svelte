<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Fill } from '$lib/cards/style';
  import { sameFill } from '$lib/cards/style';
  import type { CardbackDesign } from '$lib/characters/types';
  import { createCardback, characterLabel } from '$lib/characters/factory';
  import { hasArtwork } from '$lib/core/artwork';
  import { readArtworkFile } from '$lib/core/image-import';
  import ImageLinkButton from './ImageLinkButton.svelte';
  import { createOperationGuard } from '$lib/interaction/operation-guard';
  import { deckOwner, findDeck } from '$lib/sets/queries';
  import type { CardbackTarget } from '$lib/state/workshop.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Button, ColorInput, FillEditor, Icon, Slider, Switch, TextInput } from '$lib/ui';
  import EditorSection from './EditorSection.svelte';
  import ReplacementPanel from './ReplacementPanel.svelte';

  let { target }: { target: CardbackTarget } = $props();
  const character = $derived(workshop.cardbackSubjectFor(target));
  const back = $derived(character?.cardback ?? createCardback('minion'));
  const defaults = $derived(workshop.cardbackParentFor(target));
  const deck = $derived(target.entity === 'deck' ? findDeck(workshop.adventure, target.id) : null);
  const owner = $derived(deck ? deckOwner(workshop.adventure, deck) : null);
  const origin = $derived(target.entity === 'character' ? 'the template' : owner ? characterLabel(owner) : 'the set default');
  const layer = $derived(target.entity === 'deck' ? deck?.cardback ?? {} : back);
  const RESET_TITLE = 'Follow the inherited colour again';
  const isDefault = (key: 'background' | 'frame') => target.entity === 'deck'
    ? layer[key] === undefined : sameFill(back[key], defaults[key]);
  const reset = (key: 'background' | 'frame') => () => clearField(key);

  function editBack<TKey extends keyof CardbackDesign>(key: TKey, mutate: (design: CardbackDesign) => void, subject: CardbackTarget = target): void {
    if (subject.entity === 'character') {
      workshop.editCardback(subject.id, mutate);
      return;
    }
    const current = workshop.cardbackSubjectFor(subject)?.cardback;
    if (!current) return;
    // Only the edited field is copied; inherited image bytes need not be cloned on every colour change.
    const draft = { ...current, [key]: structuredClone($state.snapshot(current[key])) };
    mutate(draft);
    workshop.setDeckCardbackField(subject.id, key, draft[key]);
  }

  function clearField<TKey extends keyof CardbackDesign>(key: TKey): void {
    if (target.entity === 'deck') workshop.setDeckCardbackField(target.id, key, undefined);
    else editBack(key, (design) => { Object.assign(design, { [key]: structuredClone($state.snapshot(defaults[key])) }); });
  }

  let insetInput = $state<HTMLInputElement | null>(null);
  let error = $state<string | null>(null);
  const artworkPickGuard = createOperationGuard();
  let errorScope: object | null = null;
  let errorSubject = '';
  const hasInset = $derived(hasArtwork(back.artwork));
  const hasReplacement = $derived(hasArtwork(back.replacement));

  $effect(() => {
    const scope = workshop.adventure;
    const key = `${target.entity}:${target.id}`;
    if (errorScope && (scope !== errorScope || key !== errorSubject)) error = null;
    errorScope = scope;
    errorSubject = key;
  });

  async function pick(slot: 'artwork', event: Event & { currentTarget: HTMLInputElement }): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) await importFile(slot, file);
  }

  async function importFile(slot: 'artwork', file: File): Promise<void> {
    const subject = target;
    const scope = workshop.adventure;
    const operation = artworkPickGuard.begin({setId: scope.id, scope, targetKey: `${subject.entity}:${subject.id}:cardback:${slot}`, subject});
    error = null;
    try {
      const source = await readArtworkFile(file);
      if (!artworkPickGuard.isCurrent(operation, workshop.adventure.id, workshop.adventure)) return;
      editBack(slot, (design) => { design[slot].source = source; design[slot].label = file.name; }, subject);
    } catch (cause) {
      if (!artworkPickGuard.isCurrent(operation, workshop.adventure.id, workshop.adventure)) return;
      if (target.entity !== subject.entity || target.id !== subject.id) return;
      error = cause instanceof Error ? cause.message : 'Could not read that file.';
    }
  }

  function removeArtwork(): void {
    const scope = workshop.adventure;
    artworkPickGuard.supersede({setId: scope.id, scope, targetKey: `${target.entity}:${target.id}:cardback:artwork`});
    if (target.entity === 'deck') clearField('artwork');
    else editBack('artwork', (design) => { design.artwork.source = null; design.artwork.label = ''; });
  }

  function replacementPicker(subject: CardbackTarget): (source: string, label: string) => void {
    return (source, label) => {
      editBack('replacement', (design) => { design.replacement.source = source; design.replacement.label = label; }, subject);
      editBack('useReplacement', (design) => (design.useReplacement = true), subject);
    };
  }

  function removeReplacement(): void {
    if (target.entity === 'deck') {
      clearField('replacement');
      clearField('useReplacement');
    } else {
      editBack('replacement', (design) => { design.replacement.source = null; design.replacement.label = ''; });
      editBack('useReplacement', (design) => (design.useReplacement = false));
    }
  }

  onDestroy(() => artworkPickGuard.invalidate());
  const pct = (value: number) => `${Math.round(value * 100)}%`;
  const signed = (value: number) => `${value > 0 ? '+' : ''}${Math.round(value * 100)}%`;
  function resetPlacement(): void {
    editBack('artwork', (design) => (design.artwork.transform = { ...defaults.artwork.transform }));
  }
  function resetAdjustments(): void {
    editBack('artwork', (design) => (design.artwork.adjustments = { ...defaults.artwork.adjustments }));
  }
</script>

{#if target.entity === 'deck'}
  <EditorSection title="Deck back inheritance" hint={`Unchanged fields follow ${origin}. Clear this deck's overrides to follow it completely again.`}>
    {#snippet actions()}
      <Button size="sm" disabled={Object.keys(layer).length === 0} onclick={() => target.entity === 'deck' && workshop.clearDeckCardback(target.id)}>Reset deck back</Button>
    {/snippet}
    <p>{Object.keys(layer).length === 0 ? 'Following the inherited back.' : `${Object.keys(layer).length} deck ${Object.keys(layer).length === 1 ? 'override' : 'overrides'}.`}</p>
  </EditorSection>
{/if}


<!-- The block around this panel carries the subject, so this names its own job. -->
<ReplacementPanel
  artwork={back.replacement}
  enabled={back.useReplacement}
  operationKey={`${target.entity}:${target.id}:cardback:replacement`}
  hint="A finished back, used instead of composing one."
  replaces="Replaces the entire card back, template included."
  onpick={replacementPicker(target)}
  ontoggle={(useReplacement) =>
    editBack('useReplacement', (design) => (design.useReplacement = useReplacement))}
  onclear={removeReplacement}
/>

<input
  bind:this={insetInput}
  class="sr-only"
  type="file"
  accept="image/*"
  onchange={(event) => pick('artwork', event)}
/>

{#if !back.useReplacement || !hasReplacement}
  <EditorSection title="Composed back" columns={2}>
    <FillEditor
      label="Background"
      value={back.background}
      origin={origin}
      overridden={!isDefault('background')}
      resetTitle={RESET_TITLE}
      onchange={(background: Fill) =>
        editBack('background', (design) => (design.background = background))}
      onreset={reset('background')}
    />

    <FillEditor
      label="Frame"
      value={back.frame}
      origin={origin}
      overridden={!isDefault('frame')}
      resetTitle={RESET_TITLE}
      onchange={(frame: Fill) =>
        editBack('frame', (design) => (design.frame = frame))}
      onreset={reset('frame')}
    />

    <label class="stack">
      <span class="field-label">{character?.role === 'hero' ? 'Text & logo' : 'Text'}</span>
      <ColorInput
        value={target.entity === 'deck' ? layer.ink : back.ink === defaults.ink ? undefined : back.ink}
        inherited={defaults.ink}
        origin={origin}
        onchange={(ink) =>
          ink === undefined ? clearField('ink') : editBack('ink', (design) => (design.ink = ink))}
      />
    </label>

    {#if character?.role !== 'hero'}
      <!-- A hero's back prints only the name — see `HeroCardbackFace`. -->
      <label class="stack">
        <span class="field-label">Role line</span>
        <TextInput
          value={back.label}
          placeholder="MINION"
          oninput={(event) =>
            editBack('label', (design) => (design.label = event.currentTarget.value)
            )}
        />
      </label>
    {/if}
  </EditorSection>

  <EditorSection
    title="Back artwork"
    hint="Fills the whole card, edge to edge — the frame is a line drawn over it, not a window around it."
  >
    {#snippet actions()}
      {#if hasInset}
        <Button size="sm" variant="ghost" onclick={resetPlacement}>Reset placement</Button>
        {#if target.entity === 'character' || layer.artwork !== undefined}
          <Button size="sm" variant="ghost" onclick={removeArtwork}>
            {target.entity === 'deck' ? 'Use inherited artwork' : 'Remove'}
          </Button>
        {/if}
      {/if}
    {/snippet}

    <div class="slot">
      <button
        type="button"
        class="thumb"
        class:empty={!hasInset}
        title="Choose inset artwork"
        onclick={() => insetInput?.click()}
      >
        {#if hasInset && back.artwork.source}
          <img src={back.artwork.source} alt="" />
        {:else}
          <Icon name="image" size={16} />
        {/if}
      </button>

      <div class="slot-text">
        <span class="filename">{back.artwork.label || 'No image'}</span>
        <span class="sub">Drawn under the template line art.</span>
      </div>

      <div class="pick-actions">
        <Button size="sm" onclick={() => insetInput?.click()}>
          <Icon name="upload" size={13} />
          {hasInset ? 'Replace' : 'Choose'}
        </Button>
        <ImageLinkButton accept="image/*" onimport={(file) => importFile('artwork', file)} />
      </div>
    </div>

    {#if hasInset}
      <div class="grid">
        <Slider
          label="Scale"
          value={back.artwork.transform.scale}
          min={0.2}
          max={4}
          step={0.01}
          neutral={1}
          format={pct}
          onchange={(scale) =>
            editBack('artwork', (design) => (design.artwork.transform.scale = scale)
            )}
        />
        <Slider
          label="Rotation"
          value={back.artwork.transform.rotation}
          min={-180}
          max={180}
          step={1}
          neutral={0}
          format={(value) => `${value}°`}
          onchange={(rotation) =>
            editBack('artwork', (design) => (design.artwork.transform.rotation = rotation)
            )}
        />
        <Slider
          label="Horizontal"
          value={back.artwork.transform.offsetX}
          min={-1}
          max={1}
          step={0.005}
          neutral={0}
          format={signed}
          onchange={(offsetX) =>
            editBack('artwork', (design) => (design.artwork.transform.offsetX = offsetX)
            )}
        />
        <Slider
          label="Vertical"
          value={back.artwork.transform.offsetY}
          min={-1}
          max={1}
          step={0.005}
          neutral={0}
          format={signed}
          onchange={(offsetY) =>
            editBack('artwork', (design) => (design.artwork.transform.offsetY = offsetY)
            )}
        />
        <Slider
          label="Crop width"
          value={back.artwork.crop.width}
          min={0.1}
          max={1}
          step={0.005}
          neutral={1}
          format={pct}
          onchange={(width) =>
            editBack('artwork', (design) => (design.artwork.crop.width = width))}
        />
        <Slider
          label="Crop height"
          value={back.artwork.crop.height}
          min={0.1}
          max={1}
          step={0.005}
          neutral={1}
          format={pct}
          onchange={(height) =>
            editBack('artwork', (design) => (design.artwork.crop.height = height))}
        />
      </div>

      <Switch
        label="Mirror horizontally"
        checked={back.artwork.transform.flipX}
        onchange={(flipX) =>
          editBack('artwork', (design) => (design.artwork.transform.flipX = flipX))}
      />
    {/if}
  </EditorSection>

  {#if hasInset}
    <EditorSection title="Colour">
      {#snippet actions()}
        <Button size="sm" variant="ghost" onclick={resetAdjustments}>Reset</Button>
      {/snippet}

      <div class="grid">
        <Slider
          label="Brightness"
          value={back.artwork.adjustments.brightness}
          min={0.2}
          max={2}
          step={0.01}
          neutral={1}
          format={pct}
          onchange={(brightness) =>
            editBack('artwork', (design) => (design.artwork.adjustments.brightness = brightness)
            )}
        />
        <Slider
          label="Contrast"
          value={back.artwork.adjustments.contrast}
          min={0.2}
          max={2}
          step={0.01}
          neutral={1}
          format={pct}
          onchange={(contrast) =>
            editBack('artwork', (design) => (design.artwork.adjustments.contrast = contrast)
            )}
        />
        <Slider
          label="Saturation"
          value={back.artwork.adjustments.saturation}
          min={0}
          max={2}
          step={0.01}
          neutral={1}
          format={pct}
          onchange={(saturation) =>
            editBack('artwork', (design) => (design.artwork.adjustments.saturation = saturation)
            )}
        />
        <Slider
          label="Hue"
          value={back.artwork.adjustments.hue}
          min={-180}
          max={180}
          step={1}
          neutral={0}
          format={(value) => `${value}°`}
          onchange={(hue) =>
            editBack('artwork', (design) => (design.artwork.adjustments.hue = hue))}
        />
        <Slider
          label="Greyscale"
          value={back.artwork.adjustments.grayscale}
          min={0}
          max={1}
          step={0.01}
          neutral={0}
          format={pct}
          onchange={(grayscale) =>
            editBack('artwork', (design) => (design.artwork.adjustments.grayscale = grayscale)
            )}
        />
        <Slider
          label="Sepia"
          value={back.artwork.adjustments.sepia}
          min={0}
          max={1}
          step={0.01}
          neutral={0}
          format={pct}
          onchange={(sepia) =>
            editBack('artwork', (design) => (design.artwork.adjustments.sepia = sepia))}
        />
        <Slider
          label="Opacity"
          value={back.artwork.adjustments.opacity}
          min={0}
          max={1}
          step={0.01}
          neutral={1}
          format={pct}
          onchange={(opacity) =>
            editBack('artwork', (design) => (design.artwork.adjustments.opacity = opacity)
            )}
        />
      </div>
    </EditorSection>
  {/if}
{/if}

{#if error}<p class="error">{error}</p>{/if}

<style>
  .pick-actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .slot {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
  }

  .thumb {
    display: grid;
    place-items: center;
    width: 46px;
    height: 62px;
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

  .slot-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
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

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: var(--space-3) var(--space-5);
  }

  .error {
    font-size: var(--text-xs);
    color: var(--danger);
  }
</style>
