<script lang="ts">
  /**
   * The back of a character's deck.
   *
   * Two ways to work: compose one from a background, an inset image and the
   * printed template, or drop in a finished image that replaces the whole
   * thing. The replacement toggle keeps both available, so switching back and
   * forth costs nothing.
   */
  import type { Fill } from '$lib/cards/style';
  import { sameFill } from '$lib/cards/style';
  import { createCardback } from '$lib/characters/factory';
  import type { Character } from '$lib/characters/types';
  import { createArtwork, hasArtwork } from '$lib/core/artwork';
  import { readArtworkFile } from '$lib/core/image-import';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Button, ColorInput, FillEditor, Icon, Slider, Switch, TextInput } from '$lib/ui';
  import EditorSection from './EditorSection.svelte';
  import ReplacementPanel from './ReplacementPanel.svelte';

  interface Props {
    character: Character;
  }

  let { character }: Props = $props();

  /*
   * A deck back's colours are stored outright, not inherited, so a reset goes
   * back to the printed template's own — and `createCardback` is *role-aware*
   * (`frame` is `#f6eada` for a hero, `#ebe8d5` for a villain or minion), so
   * the default has to be taken for this character's own role rather than
   * from a shared constant. Picking one for both would put the wrong colour
   * back for whichever role it was not sampled from.
   */
  const RESET_TITLE = 'Back to the template’s own colour';
  const defaults = $derived(createCardback(character.role));

  const isDefault = (key: 'background' | 'frame') => sameFill(back[key], defaults[key]);
  const reset = (key: 'background' | 'frame') => () =>
    workshop.editCardback(
      character.id,
      (design) => (design[key] = { ...createCardback(character.role)[key] })
    );

  let insetInput = $state<HTMLInputElement | null>(null);
  let error = $state<string | null>(null);

  const back = $derived(character.cardback);
  const hasInset = $derived(hasArtwork(back.artwork));
  const hasReplacement = $derived(hasArtwork(back.replacement));

  async function pick(
    slot: 'artwork',
    event: Event & { currentTarget: HTMLInputElement }
  ): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    error = null;
    try {
      const source = await readArtworkFile(file);
      workshop.editCardback(character.id, (design) => {
        design[slot].source = source;
        design[slot].label = file.name;
      });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not read that file.';
    }
  }

  const pct = (value: number) => `${Math.round(value * 100)}%`;
  const signed = (value: number) => `${value > 0 ? '+' : ''}${Math.round(value * 100)}%`;

  function resetPlacement(): void {
    workshop.editCardback(character.id, (design) => {
      design.artwork.transform = { ...createArtwork().transform };
    });
  }

  function resetAdjustments(): void {
    workshop.editCardback(character.id, (design) => {
      design.artwork.adjustments = { ...createArtwork().adjustments };
    });
  }
</script>

<!-- The block around this panel carries the subject, so this names its own job. -->
<ReplacementPanel
  artwork={back.replacement}
  enabled={back.useReplacement}
  hint="A finished back, used instead of composing one."
  replaces="Replaces the entire card back, template included."
  onpick={(source, label) =>
    workshop.editCardback(character.id, (design) => {
      design.replacement.source = source;
      design.replacement.label = label;
      design.useReplacement = true;
    })}
  ontoggle={(useReplacement) =>
    workshop.editCardback(character.id, (design) => (design.useReplacement = useReplacement))}
  onclear={() =>
    workshop.editCardback(character.id, (design) => {
      design.replacement.source = null;
      design.replacement.label = '';
      design.useReplacement = false;
    })}
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
      origin="the template"
      overridden={!isDefault('background')}
      resetTitle={RESET_TITLE}
      onchange={(background: Fill) =>
        workshop.editCardback(character.id, (design) => (design.background = background))}
      onreset={reset('background')}
    />

    <FillEditor
      label="Frame"
      value={back.frame}
      origin="the template"
      overridden={!isDefault('frame')}
      resetTitle={RESET_TITLE}
      onchange={(frame: Fill) =>
        workshop.editCardback(character.id, (design) => (design.frame = frame))}
      onreset={reset('frame')}
    />

    <label class="stack">
      <span class="field-label">Text</span>
      <ColorInput
        value={back.ink === defaults.ink ? undefined : back.ink}
        inherited={defaults.ink}
        origin="the template"
        onchange={(ink) =>
          workshop.editCardback(character.id, (design) => (design.ink = ink ?? defaults.ink))}
      />
    </label>

    {#if character.role !== 'hero'}
      <!-- A hero's back prints only the name — see `HeroCardbackFace`. -->
      <label class="stack">
        <span class="field-label">Role line</span>
        <TextInput
          value={back.label}
          placeholder="MINION"
          oninput={(event) =>
            workshop.editCardback(
              character.id,
              (design) => (design.label = event.currentTarget.value)
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
        <Button
          size="sm"
          variant="ghost"
          onclick={() =>
            workshop.editCardback(character.id, (design) => {
              design.artwork.source = null;
              design.artwork.label = '';
            })}
        >
          Remove
        </Button>
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

      <Button size="sm" onclick={() => insetInput?.click()}>
        <Icon name="upload" size={13} />
        {hasInset ? 'Replace' : 'Choose'}
      </Button>
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
            workshop.editCardback(
              character.id,
              (design) => (design.artwork.transform.scale = scale)
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
            workshop.editCardback(
              character.id,
              (design) => (design.artwork.transform.rotation = rotation)
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
            workshop.editCardback(
              character.id,
              (design) => (design.artwork.transform.offsetX = offsetX)
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
            workshop.editCardback(
              character.id,
              (design) => (design.artwork.transform.offsetY = offsetY)
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
            workshop.editCardback(character.id, (design) => (design.artwork.crop.width = width))}
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
            workshop.editCardback(character.id, (design) => (design.artwork.crop.height = height))}
        />
      </div>

      <Switch
        label="Mirror horizontally"
        checked={back.artwork.transform.flipX}
        onchange={(flipX) =>
          workshop.editCardback(character.id, (design) => (design.artwork.transform.flipX = flipX))}
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
            workshop.editCardback(
              character.id,
              (design) => (design.artwork.adjustments.brightness = brightness)
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
            workshop.editCardback(
              character.id,
              (design) => (design.artwork.adjustments.contrast = contrast)
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
            workshop.editCardback(
              character.id,
              (design) => (design.artwork.adjustments.saturation = saturation)
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
            workshop.editCardback(character.id, (design) => (design.artwork.adjustments.hue = hue))}
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
            workshop.editCardback(
              character.id,
              (design) => (design.artwork.adjustments.grayscale = grayscale)
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
            workshop.editCardback(
              character.id,
              (design) => (design.artwork.adjustments.sepia = sepia))}
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
            workshop.editCardback(
              character.id,
              (design) => (design.artwork.adjustments.opacity = opacity)
            )}
        />
      </div>
    </EditorSection>
  {/if}
{/if}

{#if error}<p class="error">{error}</p>{/if}

<style>
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
