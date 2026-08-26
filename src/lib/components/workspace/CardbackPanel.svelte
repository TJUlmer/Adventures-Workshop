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
  import type { Character } from '$lib/characters/types';
  import { hasArtwork } from '$lib/core/artwork';
  import { readArtworkFile } from '$lib/core/image-import';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Button, ColorInput, FillEditor, Icon, Slider, TextInput } from '$lib/ui';
  import EditorSection from './EditorSection.svelte';
  import ReplacementPanel from './ReplacementPanel.svelte';

  interface Props {
    character: Character;
  }

  let { character }: Props = $props();

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
      onchange={(background: Fill) =>
        workshop.editCardback(character.id, (design) => (design.background = background))}
    />

    <FillEditor
      label="Frame"
      value={back.frame}
      onchange={(frame: Fill) =>
        workshop.editCardback(character.id, (design) => (design.frame = frame))}
    />

    <label class="stack">
      <span class="field-label">Text</span>
      <ColorInput
        value={back.ink}
        inherited={back.ink}
        onchange={(ink) =>
          workshop.editCardback(character.id, (design) => (design.ink = ink ?? '#6f6a55'))}
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
          label="Horizontal"
          value={back.artwork.transform.offsetX}
          min={-1}
          max={1}
          step={0.005}
          neutral={0}
          format={pct}
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
          format={pct}
          onchange={(offsetY) =>
            workshop.editCardback(
              character.id,
              (design) => (design.artwork.transform.offsetY = offsetY)
            )}
        />
      </div>
    {/if}
  </EditorSection>
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
