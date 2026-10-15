<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { CardTheme, CustomPatternStyle, PatternStyle } from '$lib/cards/style';
  import { readArtworkFile } from '$lib/core/image-import';
  import { createOperationGuard } from '$lib/interaction/operation-guard';
  import { PATTERN_NAMES, patternAspect, patternUrl } from '$lib/renderer/assets';
  import { artworkAdjustmentKey } from '$lib/state/artwork-adjustment-view.svelte';
  import type { StyleTarget } from '$lib/state/workshop.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Button, ColorInput, Icon, Slider } from '$lib/ui';
  import EditorSection from './EditorSection.svelte';
  import ImageLinkButton from './ImageLinkButton.svelte';

  interface Props {
    target: StyleTarget;
    resolved: CardTheme;
    originFor: (key: keyof CardTheme) => string;
    surface: 'body' | 'ribbon';
  }

  let { target, resolved, originFor, surface }: Props = $props();

  const patternKey: 'pattern' | 'ribbonPattern' = $derived(surface === 'ribbon' ? 'ribbonPattern' : 'pattern');
  const customPatternKey: 'customPattern' | 'ribbonCustomPattern' = $derived(surface === 'ribbon' ? 'ribbonCustomPattern' : 'customPattern');
  const surfaceLabel = $derived(surface === 'ribbon' ? 'Name ribbon' : 'Body');
  const surfaceName = $derived(surface === 'ribbon' ? 'name ribbon' : 'body panel');
  const pattern = $derived(resolved[patternKey]);
  const customPattern = $derived(resolved[customPatternKey]);
  const layer = $derived(workshop.styleFor(target) ?? {});

  function patchPattern(patch: Partial<PatternStyle>): void {
    workshop.setStyle(target, patternKey, { ...pattern, ...patch });
  }

  function patchCustomPattern(patch: Partial<CustomPatternStyle>): void {
    workshop.setStyle(target, customPatternKey, { ...customPattern, ...patch });
  }

  let customPatternInput = $state<HTMLInputElement | null>(null);
  let customPatternError = $state<string | null>(null);
  const customPatternPickGuard = createOperationGuard();
  let customPatternErrorScope: object | null = null;
  let customPatternErrorTargetKey: string | null = null;

  function styleOperationKey(value: StyleTarget): string {
    const layerKey = value.entity === 'set' ? 'style:set' : `style:${artworkAdjustmentKey(value)}`;
    return `${layerKey}:${customPatternKey}`;
  }

  $effect(() => {
    const nextScope = workshop.adventure;
    const nextTargetKey = styleOperationKey(target);
    if (
      customPatternErrorScope &&
      (customPatternErrorScope !== nextScope ||
        customPatternErrorTargetKey !== nextTargetKey)
    ) {
      customPatternError = null;
    }
    customPatternErrorScope = nextScope;
    customPatternErrorTargetKey = nextTargetKey;
  });

  async function pickCustomPattern(event: Event & { currentTarget: HTMLInputElement }): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    await importCustomPattern(file);
  }

  /** Shared by Choose and From link, so a linked picture takes the same path. */
  async function importCustomPattern(file: File): Promise<void> {
    const origin: StyleTarget = { ...target };
    const scope = workshop.adventure;
    const operation = customPatternPickGuard.begin({
      setId: scope.id,
      targetKey: styleOperationKey(origin),
      scope,
      target: origin,
      key: customPatternKey,
      customPattern: { ...customPattern }
    });
    customPatternError = null;
    try {
      const source = await readArtworkFile(file);
      if (!customPatternPickGuard.isCurrent(operation, workshop.adventure.id, workshop.adventure)) return;
      const currentPattern = workshop.styleFor(operation.context.target)?.[operation.context.key];
      workshop.setStyle(operation.context.target, operation.context.key, {
        ...(currentPattern ?? operation.context.customPattern),
        source,
        label: file.name
      });
    } catch (cause) {
      if (!customPatternPickGuard.isCurrent(operation, workshop.adventure.id, workshop.adventure)) return;
      if (styleOperationKey(target) !== operation.context.targetKey) return;
      customPatternError = cause instanceof Error ? cause.message : 'Could not read that file.';
    }
  }

  function clearCustomPattern(): void {
    const origin: StyleTarget = { ...target };
    const scope = workshop.adventure;
    customPatternPickGuard.supersede({
      setId: scope.id,
      targetKey: styleOperationKey(origin),
      scope
    });
    patchCustomPattern({ source: null, label: '' });
  }

  onDestroy(() => customPatternPickGuard.invalidate());

</script>

<EditorSection title={`${surfaceLabel} pattern`} hint={`Laid over the ${surfaceName} and recoloured to taste.`}>
  {#snippet actions()}
    {#if pattern.name}
      <Button size="sm" variant="ghost" onclick={() => patchPattern({ name: null })}>
        Clear
      </Button>
    {/if}
  {/snippet}

  <div class="patterns">
    <button
      type="button"
      class="swatch none"
      class:selected={pattern.name === null}
      title="No pattern"
      onclick={() => patchPattern({ name: null })}
    >
      <span class="slash"></span>
    </button>

    {#each PATTERN_NAMES as name (name)}
      <button
        type="button"
        class="swatch"
        class:selected={pattern.name === name}
        title={name.replace(/-/g, ' ')}
        onclick={() => patchPattern({ name })}
      >
        <span
          class="tile"
          style:--tile="url('{patternUrl(name)}')"
          style:--tile-aspect={patternAspect(name)}
        ></span>
      </button>
    {/each}
  </div>

  {#if pattern.name}
    <div class="grid">
      <label class="ink">
        <span class="ink-label">Pattern colour</span>
        <!--
          `pattern` is one style key holding the name, the colour and the
          opacity together, so the cascade overrides all three or none — there
          is no "just the colour" to inherit again, and a reset here has to
          clear the whole key. That is what the minus does, which is the same
          thing it means on every other control in this panel; it is only the
          *granularity* that is the pattern's rather than the colour's.

          It reads as inherited (no minus, "from {origin}") whenever this layer
          has no pattern of its own, rather than always showing a reset the way
          `value === inherited` used to.
        -->
        <ColorInput
          value={layer[patternKey] === undefined ? undefined : pattern.color}
          inherited={pattern.color}
          origin={originFor(patternKey)}
          onchange={(color) =>
            color === undefined
              ? workshop.setStyle(target, patternKey, undefined)
              : patchPattern({ color })}
        />
      </label>
      <Slider
        label="Opacity"
        value={pattern.opacity}
        min={0}
        max={1}
        step={0.01}
        neutral={0.12}
        format={(value) => `${Math.round(value * 100)}%`}
        onchange={(opacity) => patchPattern({ opacity })}
      />
      <Slider
        label="Tile size"
        value={pattern.scale}
        min={0.25}
        max={5}
        step={0.05}
        neutral={1}
        format={(value) => `${value.toFixed(2)}×`}
        onchange={(scale) => patchPattern({ scale })}
      />
    </div>
  {/if}
</EditorSection>

<EditorSection title={`${surfaceLabel} custom pattern`} hint={`One picture laid over the ${surfaceName}.`}>
  {#snippet actions()}
    {#if customPattern.source}
      <Button
        size="sm"
        variant="ghost"
        onclick={clearCustomPattern}
      >
        Clear
      </Button>
    {/if}
  {/snippet}

  <input
    bind:this={customPatternInput}
    class="sr-only"
    type="file"
    accept="image/*"
    onchange={pickCustomPattern}
  />

  <div class="custom-pattern-slot">
    <button
      type="button"
      class="custom-pattern-thumb"
      class:empty={!customPattern.source}
      title={customPattern.source ? 'Replace image' : 'Choose an image'}
      onclick={() => customPatternInput?.click()}
    >
      {#if customPattern.source}
        <img src={customPattern.source} alt="" />
      {:else}
        <Icon name="image" size={16} />
      {/if}
    </button>

    <span class="filename">{customPattern.label || 'No image'}</span>

    <div class="pick-actions">
      <Button size="sm" onclick={() => customPatternInput?.click()}>
        <Icon name="upload" size={13} />
        {customPattern.source ? 'Replace' : 'Choose'}
      </Button>
      <ImageLinkButton accept="image/*" onimport={importCustomPattern} />
    </div>
  </div>

  {#if customPatternError}<p class="error">{customPatternError}</p>{/if}

  {#if customPattern.source}
    <div class="grid">
      <Slider
        label="Opacity"
        value={customPattern.opacity}
        min={0}
        max={1}
        step={0.01}
        neutral={1}
        format={(value) => `${Math.round(value * 100)}%`}
        onchange={(opacity) => patchCustomPattern({ opacity })}
      />
      <Slider
        label="Scale"
        value={customPattern.scale}
        min={0.1}
        max={3}
        step={0.05}
        neutral={1}
        format={(value) => `${value.toFixed(2)}×`}
        onchange={(scale) => patchCustomPattern({ scale })}
      />
      <Slider
        label="Rotation"
        value={customPattern.rotation}
        min={-180}
        max={180}
        step={1}
        neutral={0}
        format={(value) => `${value}°`}
        onchange={(rotation) => patchCustomPattern({ rotation })}
      />
      <Slider
        label="Horizontal position"
        value={customPattern.offsetX}
        min={0}
        max={1}
        step={0.01}
        neutral={0.5}
        format={(value) => `${Math.round(value * 100)}%`}
        onchange={(offsetX) => patchCustomPattern({ offsetX })}
      />
      <Slider
        label="Vertical position"
        value={customPattern.offsetY}
        min={0}
        max={1}
        step={0.01}
        neutral={0.5}
        format={(value) => `${Math.round(value * 100)}%`}
        onchange={(offsetY) => patchCustomPattern({ offsetY })}
      />
    </div>
  {/if}
</EditorSection>

{#if customPattern.source}
<EditorSection title={`${surfaceLabel} custom pattern colour`}>
  {#snippet actions()}
    <Button
      size="sm"
      variant="ghost"
      onclick={() =>
        patchCustomPattern({
          brightness: 1,
          contrast: 1,
          saturation: 1,
          hue: 0,
          grayscale: 0,
          sepia: 0
        })}
    >
      Reset
    </Button>
  {/snippet}

  <div class="grid">
    <Slider
      label="Brightness"
      value={customPattern.brightness}
      min={0.2}
      max={2}
      step={0.01}
      neutral={1}
      format={(value) => `${Math.round(value * 100)}%`}
      onchange={(brightness) => patchCustomPattern({ brightness })}
    />
    <Slider
      label="Contrast"
      value={customPattern.contrast}
      min={0.2}
      max={2}
      step={0.01}
      neutral={1}
      format={(value) => `${Math.round(value * 100)}%`}
      onchange={(contrast) => patchCustomPattern({ contrast })}
    />
    <Slider
      label="Saturation"
      value={customPattern.saturation}
      min={0}
      max={2}
      step={0.01}
      neutral={1}
      format={(value) => `${Math.round(value * 100)}%`}
      onchange={(saturation) => patchCustomPattern({ saturation })}
    />
    <Slider
      label="Hue"
      value={customPattern.hue}
      min={-180}
      max={180}
      step={1}
      neutral={0}
      format={(value) => `${value}°`}
      onchange={(hue) => patchCustomPattern({ hue })}
    />
    <Slider
      label="Greyscale"
      value={customPattern.grayscale}
      min={0}
      max={1}
      step={0.01}
      neutral={0}
      format={(value) => `${Math.round(value * 100)}%`}
      onchange={(grayscale) => patchCustomPattern({ grayscale })}
    />
    <Slider
      label="Sepia"
      value={customPattern.sepia}
      min={0}
      max={1}
      step={0.01}
      neutral={0}
      format={(value) => `${Math.round(value * 100)}%`}
      onchange={(sepia) => patchCustomPattern({ sepia })}
    />
  </div>
</EditorSection>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: var(--space-4) var(--space-5);
  }

  .ink {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .ink-label {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .patterns {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
    gap: var(--space-2);
  }

  .swatch {
    position: relative;
    aspect-ratio: 1;
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    border: 1px solid var(--border-subtle);
    overflow: hidden;
    transition: border-color var(--duration-fast) var(--ease-out);
  }

  .swatch:hover {
    border-color: var(--border-strong);
  }

  .swatch.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }

  .tile {
    position: absolute;
    inset: 0;
    background: var(--grey-300);
    mask-image: var(--tile);
    -webkit-mask-image: var(--tile);
    /* Its own proportions, so the swatch tiles the way the card will. */
    mask-size: 22px calc(22px * var(--tile-aspect));
    -webkit-mask-size: 22px calc(22px * var(--tile-aspect));
    mask-repeat: repeat;
    -webkit-mask-repeat: repeat;
  }

  .none .slash {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      135deg,
      transparent calc(50% - 1px),
      var(--grey-600) calc(50% - 1px) calc(50% + 1px),
      transparent calc(50% + 1px)
    );
  }

  .pick-actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .custom-pattern-slot {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
  }

  .custom-pattern-thumb {
    display: grid;
    place-items: center;
    width: 46px;
    height: 46px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--surface-inset);
    border: 1px solid var(--border-default);
    color: var(--text-muted);
  }

  .custom-pattern-thumb.empty {
    border-style: dashed;
  }

  .custom-pattern-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .filename {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .error {
    font-size: var(--text-xs);
    color: var(--danger);
  }

</style>
