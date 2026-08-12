<script lang="ts">
  /**
   * "I already drew this one" — a finished image standing in for a composed
   * face.
   *
   * The deck back and the threat board grew one of these first and every card
   * has one now, so it is a component rather than a block copied five times.
   * The subject differs but the shape of the decision never does: choose an
   * image, switch it on, and the composition underneath waits untouched for the
   * switch to go back off.
   *
   * It owns no state. The caller says what the artwork *is* and what to do when
   * it changes, because the four places this appears mutate four different
   * parts of the document through four different store commands.
   */
  import type { Artwork } from '$lib/core/artwork';
  import { hasArtwork } from '$lib/core/artwork';
  import { Button, Icon, Switch } from '$lib/ui';
  import EditorSection from './EditorSection.svelte';

  interface Props {
    artwork: Artwork;
    enabled: boolean;
    /** Names the section. Defaults to the wording the card back already uses. */
    title?: string;
    hint?: string;
    /** What it stands in for, said plainly under the filename. */
    replaces: string;
    /** A landscape card should not preview as a portrait one. */
    landscape?: boolean;
    onpick: (source: string, label: string) => void;
    ontoggle: (enabled: boolean) => void;
    onclear: () => void;
  }

  let {
    artwork,
    enabled,
    title = 'Replacement image',
    hint = 'A finished card, used instead of composing one.',
    replaces,
    landscape = false,
    onpick,
    ontoggle,
    onclear
  }: Props = $props();

  let input = $state<HTMLInputElement | null>(null);
  let error = $state<string | null>(null);

  const chosen = $derived(hasArtwork(artwork));

  function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.readAsDataURL(file);
    });
  }

  async function pick(event: Event & { currentTarget: HTMLInputElement }): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    error = null;
    try {
      onpick(await readAsDataUrl(file), file.name);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not read that file.';
    }
  }
</script>

<EditorSection {title} {hint}>
  {#snippet actions()}
    <!-- Only once there is something to switch to. -->
    {#if chosen}
      <Switch label="Use replacement" checked={enabled} onchange={ontoggle} />
    {/if}
  {/snippet}

  <input bind:this={input} class="sr-only" type="file" accept="image/*" onchange={pick} />

  <div class="slot">
    <button
      type="button"
      class="thumb"
      class:empty={!chosen}
      class:landscape
      title={chosen ? 'Replace image' : 'Choose a finished image'}
      onclick={() => input?.click()}
    >
      {#if chosen && artwork.source}
        <img src={artwork.source} alt="" />
      {:else}
        <Icon name="image" size={16} />
      {/if}
    </button>

    <div class="slot-text">
      <span class="filename">{artwork.label || 'No replacement image'}</span>
      <span class="sub">{replaces}</span>
    </div>

    <div class="slot-actions">
      <Button size="sm" onclick={() => input?.click()}>
        <Icon name="upload" size={13} />
        {chosen ? 'Replace' : 'Choose'}
      </Button>
      {#if chosen}
        <Button size="sm" variant="ghost" onclick={onclear}>Clear</Button>
      {/if}
    </div>
  </div>

  {#if error}<p class="error">{error}</p>{/if}
</EditorSection>

<style>
  .slot {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
  }

  .slot-actions {
    display: flex;
    gap: var(--space-2);
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

  .thumb.landscape {
    width: 62px;
    height: 46px;
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

  .error {
    font-size: var(--text-xs);
    color: var(--danger);
  }
</style>
