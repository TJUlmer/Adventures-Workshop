<script lang="ts">
  /**
   * One layer of the style cascade: frame, ribbon, body, artwork bed, plus the
   * pattern and texture overlays.
   *
   * The same component serves the set, a character and a card — only the target
   * and the labels change. An absent key means "inherit"; the controls make
   * that state visible and reversible rather than hiding it behind a default.
   */
  import type { CardTheme, Fill, PatternStyle, TextureKind } from '$lib/cards/style';
  import { TEXTURE_LABELS, TEXTURES } from '$lib/cards/style';
  import { PATTERN_NAMES, patternAspect, patternUrl } from '$lib/renderer/assets';
  import type { StyleTarget } from '$lib/state/workshop.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Button, ColorInput, FillEditor, Slider } from '$lib/ui';
  import EditorSection from './EditorSection.svelte';

  /** One block each, so a page can place them independently. */
  type StyleGroup = 'colour' | 'pattern' | 'texture';

  interface Props {
    /** Which layer to edit. Addressed by reference, never by object. */
    target: StyleTarget;
    /** The look currently in effect, with the whole cascade flattened. */
    resolved: CardTheme;
    /** Human label for where an inherited value is coming from. */
    originFor: (key: keyof CardTheme) => string;
    /**
     * Which blocks to render. Splitting them lets a page put each in its own
     * block without this component having to know about blocks.
     */
    show?: readonly StyleGroup[];
    /**
     * Which surfaces and inks to offer. Templates differ in what they draw —
     * an initiative card has no ribbon, a rules card no boost disc — and a
     * control for something the card cannot show is worse than no control.
     * Omitted means all of them.
     */
    surfaces?: readonly (keyof CardTheme)[];
  }

  let {
    target,
    resolved,
    originFor,
    show = ['colour', 'pattern', 'texture'],
    surfaces
  }: Props = $props();

  const showColour = $derived(show.includes('colour'));
  const showPattern = $derived(show.includes('pattern'));
  const showTexture = $derived(show.includes('texture'));

  const layer = $derived(workshop.styleFor(target) ?? {});
  const overrideCount = $derived(Object.keys(layer).length);

  const ALL_FILLS = [
    { key: 'frame', label: 'Frame & border' },
    { key: 'banner', label: 'Name ribbon' },
    { key: 'header', label: 'Header fill' },
    { key: 'body', label: 'Body fill' },
    { key: 'back', label: 'Back fill' },
    /* The artwork bed lives with the edge masks that reveal it, in Artwork. */
    { key: 'boost', label: 'Boost disc' }
  ] as const satisfies readonly { key: keyof CardTheme; label: string }[];

  const ALL_INKS = [
    { key: 'bannerInk', label: 'Ribbon text' },
    { key: 'headerInk', label: 'Header text' },
    { key: 'bodyInk', label: 'Body text' },
    { key: 'backInk', label: 'Back text' },
    { key: 'divider', label: 'Divider line' },
    { key: 'boostInk', label: 'Boost number' }
  ] as const satisfies readonly { key: keyof CardTheme; label: string }[];

  const wanted = (key: keyof CardTheme) => surfaces === undefined || surfaces.includes(key);

  const FILLS = $derived(ALL_FILLS.filter((entry) => wanted(entry.key)));
  const INKS = $derived(ALL_INKS.filter((entry) => wanted(entry.key)));

  function setFill(key: keyof CardTheme, fill: Fill): void {
    workshop.setStyle(target, key, fill as CardTheme[typeof key]);
  }

  function patchPattern(patch: Partial<PatternStyle>): void {
    workshop.setStyle(target, 'pattern', { ...resolved.pattern, ...patch });
  }

  function setTexture(kind: TextureKind): void {
    workshop.setStyle(target, 'texture', { ...resolved.texture, kind });
  }
</script>

{#if showColour && FILLS.length > 0}
<EditorSection title="Surfaces">
  {#snippet actions()}
    {#if overrideCount > 0}
      <Button size="sm" variant="ghost" onclick={() => workshop.clearStyle(target)}>
        Reset {overrideCount}
      </Button>
    {/if}
  {/snippet}

  <div class="grid">
    {#each FILLS as entry (entry.key)}
      <FillEditor
        label={entry.label}
        value={resolved[entry.key] as Fill}
        origin={originFor(entry.key)}
        overridden={layer[entry.key] !== undefined}
        onchange={(fill) => setFill(entry.key, fill)}
        onreset={() => workshop.setStyle(target, entry.key, undefined)}
      />
    {/each}
  </div>
</EditorSection>
{/if}

{#if showColour && INKS.length > 0}
<EditorSection title="Ink">
  <div class="grid">
    {#each INKS as entry (entry.key)}
      <label class="ink">
        <span class="ink-label">{entry.label}</span>
        <ColorInput
          value={layer[entry.key] as string | undefined}
          inherited={resolved[entry.key] as string}
          origin={originFor(entry.key)}
          onchange={(value) =>
            workshop.setStyle(target, entry.key, value as CardTheme[typeof entry.key])}
        />
      </label>
    {/each}
  </div>
</EditorSection>
{/if}

{#if showPattern}
<EditorSection title="Pattern" hint="Laid over the body panel and recoloured to taste.">
  {#snippet actions()}
    {#if resolved.pattern.name}
      <Button size="sm" variant="ghost" onclick={() => patchPattern({ name: null })}>
        Clear
      </Button>
    {/if}
  {/snippet}

  <div class="patterns">
    <button
      type="button"
      class="swatch none"
      class:selected={resolved.pattern.name === null}
      title="No pattern"
      onclick={() => patchPattern({ name: null })}
    >
      <span class="slash"></span>
    </button>

    {#each PATTERN_NAMES as name (name)}
      <button
        type="button"
        class="swatch"
        class:selected={resolved.pattern.name === name}
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

  {#if resolved.pattern.name}
    <div class="grid">
      <label class="ink">
        <span class="ink-label">Pattern colour</span>
        <ColorInput
          value={resolved.pattern.color}
          inherited={resolved.pattern.color}
          onchange={(color) => patchPattern({ color: color ?? '#ffffff' })}
        />
      </label>
      <Slider
        label="Opacity"
        value={resolved.pattern.opacity}
        min={0}
        max={1}
        step={0.01}
        neutral={0.12}
        format={(value) => `${Math.round(value * 100)}%`}
        onchange={(opacity) => patchPattern({ opacity })}
      />
      <Slider
        label="Tile size"
        value={resolved.pattern.scale}
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
{/if}

{#if showTexture}
<EditorSection title="Texture" hint="A finish laid over the whole card face.">
  <div class="textures" role="group" aria-label="Texture">
    {#each TEXTURES as kind (kind)}
      <button
        type="button"
        class="texture-option"
        class:selected={resolved.texture.kind === kind}
        onclick={() => setTexture(kind)}
      >
        {TEXTURE_LABELS[kind]}
      </button>
    {/each}
  </div>

  {#if resolved.texture.kind !== 'none'}
    <Slider
      label="Texture strength"
      value={resolved.texture.opacity}
      min={0}
      max={1}
      step={0.01}
      neutral={0.3}
      format={(value) => `${Math.round(value * 100)}%`}
      onchange={(opacity) =>
        workshop.setStyle(target, 'texture', { ...resolved.texture, opacity })}
    />
  {/if}
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

  .textures {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .texture-option {
    height: 26px;
    padding-inline: var(--space-3);
    border-radius: var(--radius-full);
    border: 1px solid var(--border-subtle);
    font-size: var(--text-xs);
    color: var(--text-muted);
    transition:
      border-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .texture-option:hover {
    color: var(--text-secondary);
    border-color: var(--border-strong);
  }

  .texture-option.selected {
    color: var(--text-primary);
    border-color: var(--border-accent);
    background: var(--accent-soft);
  }
</style>
