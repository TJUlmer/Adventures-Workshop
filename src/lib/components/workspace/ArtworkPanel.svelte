<script lang="ts">
  /**
   * Artwork: import, place, crop, grade, mask.
   *
   * The image is read into a data URL so the document stays a single
   * self-contained file — nothing points at a path that could go missing.
   * Every control writes through a store command, because this panel is shared
   * between the card and character editors.
   */
  import type { CardTheme } from '$lib/cards/style';
  import { hasArtwork } from '$lib/core/artwork';
  import { readArtworkFile } from '$lib/core/image-import';
  import type { EntityRef, StyleTarget } from '$lib/state/workshop.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Button, FillEditor, Icon, Slider, Switch, TextInput } from '$lib/ui';
  import EditorSection from './EditorSection.svelte';

  interface Props {
    target: EntityRef;
    /** Omit when the block around this panel already says what the art is for. */
    hint?: string;
    /**
     * The style layer that owns the artwork bed. Passed in so the bed colour
     * sits with the edge treatment that reveals it, rather than in a distant
     * surfaces list.
     */
    styleTarget?: StyleTarget | null;
    resolved?: CardTheme | null;
    bedOrigin?: string;
  }

  let { target, hint, styleTarget = null, resolved = null, bedOrigin }: Props = $props();

  const bedOverridden = $derived(
    styleTarget ? workshop.styleFor(styleTarget)?.artBackground !== undefined : false
  );

  let fileInput = $state<HTMLInputElement | null>(null);
  let error = $state<string | null>(null);

  const artwork = $derived(workshop.artworkFor(target));
  const attached = $derived(artwork ? hasArtwork(artwork) : false);

  const MASKS = [
    { value: 'none', label: 'None' },
    { value: 'vignette', label: 'Vignette' },
    { value: 'fade-bottom', label: 'Fade' },
    { value: 'fade-edges', label: 'Edges' },
    { value: 'oval', label: 'Oval' }
  ] as const;

  async function pick(event: Event & { currentTarget: HTMLInputElement }): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    error = null;
    try {
      workshop.setArtworkSource(target, await readArtworkFile(file), file.name);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not read that file.';
    }
  }

  const pct = (value: number) => `${Math.round(value * 100)}%`;
  const signed = (value: number) => `${value > 0 ? '+' : ''}${Math.round(value * 100)}%`;
</script>

<EditorSection title="Image" {hint}>
  {#snippet actions()}
    {#if attached}
      <Button size="sm" variant="ghost" onclick={() => workshop.setArtworkSource(target, null)}>
        Remove
      </Button>
    {/if}
  {/snippet}

  <input bind:this={fileInput} class="sr-only" type="file" accept="image/*" onchange={pick} />

  <div class="import">
    <button
      type="button"
      class="thumb"
      class:empty={!attached}
      title={attached ? 'Replace image' : 'Choose image'}
      onclick={() => fileInput?.click()}
    >
      {#if attached && artwork?.source}
        <img src={artwork.source} alt="" />
      {:else}
        <Icon name="image" size={18} />
      {/if}
    </button>

    <div class="import-text">
      <span class="filename">{artwork?.label || 'No image attached'}</span>
      {#if error}
        <span class="error">{error}</span>
      {:else}
        <span class="sub">Embedded in the set file.</span>
      {/if}
    </div>

    <Button size="sm" onclick={() => fileInput?.click()}>
      <Icon name="upload" size={13} />
      {attached ? 'Replace' : 'Choose'}
    </Button>
  </div>
</EditorSection>

{#if attached && artwork}
  <EditorSection title="Placement">
    {#snippet actions()}
      <Button size="sm" variant="ghost" onclick={() => workshop.resetArtwork(target, 'transform')}>
        Reset
      </Button>
    {/snippet}

    <div class="grid">
      <Slider
        label="Scale"
        value={artwork.transform.scale}
        min={0.2}
        max={4}
        step={0.01}
        neutral={1}
        format={pct}
        onchange={(scale) => workshop.setTransform(target, { scale })}
      />
      <Slider
        label="Rotation"
        value={artwork.transform.rotation}
        min={-180}
        max={180}
        step={1}
        neutral={0}
        format={(value) => `${value}°`}
        onchange={(rotation) => workshop.setTransform(target, { rotation })}
      />
      <Slider
        label="Horizontal"
        value={artwork.transform.offsetX}
        min={-1}
        max={1}
        step={0.005}
        neutral={0}
        format={signed}
        onchange={(offsetX) => workshop.setTransform(target, { offsetX })}
      />
      <Slider
        label="Vertical"
        value={artwork.transform.offsetY}
        min={-1}
        max={1}
        step={0.005}
        neutral={0}
        format={signed}
        onchange={(offsetY) => workshop.setTransform(target, { offsetY })}
      />
      <!--
        Crop width and height live here rather than in a section of their own:
        with horizontal and vertical offsets already positioning the image,
        left and top were a second way to say the same thing.
      -->
      <Slider
        label="Crop width"
        value={artwork.crop.width}
        min={0.1}
        max={1}
        step={0.005}
        neutral={1}
        format={pct}
        onchange={(width) => workshop.setCrop(target, { width })}
      />
      <Slider
        label="Crop height"
        value={artwork.crop.height}
        min={0.1}
        max={1}
        step={0.005}
        neutral={1}
        format={pct}
        onchange={(height) => workshop.setCrop(target, { height })}
      />
    </div>

    <Switch
      label="Mirror horizontally"
      checked={artwork.transform.flipX}
      onchange={(flipX) => workshop.setTransform(target, { flipX })}
    />
  </EditorSection>

  <EditorSection title="Colour">
    {#snippet actions()}
      <Button
        size="sm"
        variant="ghost"
        onclick={() => workshop.resetArtwork(target, 'adjustments')}
      >
        Reset
      </Button>
    {/snippet}

    <div class="grid">
      <Slider
        label="Brightness"
        value={artwork.adjustments.brightness}
        min={0.2}
        max={2}
        step={0.01}
        neutral={1}
        format={pct}
        onchange={(brightness) => workshop.setAdjustments(target, { brightness })}
      />
      <Slider
        label="Contrast"
        value={artwork.adjustments.contrast}
        min={0.2}
        max={2}
        step={0.01}
        neutral={1}
        format={pct}
        onchange={(contrast) => workshop.setAdjustments(target, { contrast })}
      />
      <Slider
        label="Saturation"
        value={artwork.adjustments.saturation}
        min={0}
        max={2}
        step={0.01}
        neutral={1}
        format={pct}
        onchange={(saturation) => workshop.setAdjustments(target, { saturation })}
      />
      <Slider
        label="Hue"
        value={artwork.adjustments.hue}
        min={-180}
        max={180}
        step={1}
        neutral={0}
        format={(value) => `${value}°`}
        onchange={(hue) => workshop.setAdjustments(target, { hue })}
      />
      <Slider
        label="Greyscale"
        value={artwork.adjustments.grayscale}
        min={0}
        max={1}
        step={0.01}
        neutral={0}
        format={pct}
        onchange={(grayscale) => workshop.setAdjustments(target, { grayscale })}
      />
      <Slider
        label="Sepia"
        value={artwork.adjustments.sepia}
        min={0}
        max={1}
        step={0.01}
        neutral={0}
        format={pct}
        onchange={(sepia) => workshop.setAdjustments(target, { sepia })}
      />
    </div>
  </EditorSection>

  <EditorSection
    title="Edge"
    hint="Masks fade the artwork to the bed colour, so the bed can be any colour you like."
  >
    {#if styleTarget && resolved}
      <FillEditor
        label="Artwork bed"
        value={resolved.artBackground}
        origin={bedOrigin}
        overridden={bedOverridden}
        onchange={(fill) => workshop.setStyle(styleTarget, 'artBackground', fill)}
        onreset={() => workshop.setStyle(styleTarget, 'artBackground', undefined)}
      />
    {/if}

    <div class="masks" role="group" aria-label="Edge mask">
      {#each MASKS as option (option.value)}
        <button
          type="button"
          class="mask-option"
          class:selected={artwork.effects.mask === option.value}
          onclick={() => workshop.setEffects(target, { mask: option.value })}
        >
          <span class="mask-preview" data-mask={option.value}></span>
          {option.label}
        </button>
      {/each}
    </div>

    <div class="grid">
      {#if artwork.effects.mask !== 'none'}
        <Slider
          label="Mask strength"
          value={artwork.effects.maskStrength}
          min={0}
          max={1}
          step={0.01}
          neutral={0.6}
          format={pct}
          onchange={(maskStrength) => workshop.setEffects(target, { maskStrength })}
        />
      {/if}
      <Slider
        label="Vignette"
        value={artwork.effects.vignette}
        min={0}
        max={1}
        step={0.01}
        neutral={0}
        format={pct}
        onchange={(vignette) => workshop.setEffects(target, { vignette })}
      />
    </div>
  </EditorSection>

  <EditorSection title="Credit">
    <TextInput
      value={artwork.credit}
      placeholder="Artist or source"
      oninput={(event) => workshop.setArtworkCredit(target, event.currentTarget.value)}
    />
  </EditorSection>
{/if}

<style>
  .import {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
  }

  .thumb {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    flex: none;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--surface-inset);
    border: 1px solid var(--border-default);
    color: var(--text-muted);
    transition: border-color var(--duration-fast) var(--ease-out);
  }

  .thumb:hover {
    border-color: var(--border-strong);
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .thumb.empty {
    border-style: dashed;
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

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: var(--space-3) var(--space-5);
  }

  .masks {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .mask-option {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 28px;
    padding-inline: var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle);
    font-size: var(--text-xs);
    color: var(--text-muted);
    transition:
      border-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .mask-option:hover {
    color: var(--text-secondary);
    border-color: var(--border-strong);
  }

  .mask-option.selected {
    color: var(--text-primary);
    border-color: var(--border-accent);
    background: var(--accent-soft);
  }

  .mask-preview {
    width: 16px;
    height: 16px;
    border-radius: 3px;
    background: var(--grey-400);
  }

  .mask-preview[data-mask='vignette'],
  .mask-preview[data-mask='fade-edges'] {
    background: radial-gradient(ellipse at center, var(--grey-300) 40%, transparent 78%);
  }

  .mask-preview[data-mask='fade-bottom'] {
    background: linear-gradient(180deg, var(--grey-300) 40%, transparent 100%);
  }

  .mask-preview[data-mask='oval'] {
    background: radial-gradient(ellipse 60% 78% at center, var(--grey-300) 70%, transparent 82%);
  }
</style>
