<script lang="ts">
  /**
   * Set settings: what the set is called, who made it, and its box art.
   *
   * Deliberately not where cards are styled. A look belongs to the deck it
   * prints on, so it is edited beside those cards rather than here, a page away
   * from anything it changes.
   */
  import { hasArtwork } from '$lib/core/artwork';
  import { readArtworkFile } from '$lib/core/image-import';
  import { SET_KINDS, SET_KIND_META } from '$lib/sets/types';
  import type { SetKind } from '$lib/sets/types';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Button, Icon, TextArea, TextInput } from '$lib/ui';
  import type { IconName } from '$lib/ui/Icon.svelte';
  import EditorSection from '../workspace/EditorSection.svelte';
  import ReplacementPanel from '../workspace/ReplacementPanel.svelte';

  const set = $derived(workshop.adventure);

  let boxInput = $state<HTMLInputElement | null>(null);
  let error = $state<string | null>(null);

  /**
   * Why the heroes option cannot be chosen, or `null` when it can.
   *
   * Read every time rather than cached, because it depends on the roster and
   * an author may go and delete a villain while this page is open.
   */
  const heroesBlocked = $derived(workshop.heroesSetBlockedBy());

  /** Set once a switch is refused, and cleared the moment one succeeds. */
  let kindRefusal = $state<string | null>(null);

  function chooseKind(kind: SetKind): void {
    if (kind === set.kind) return;
    kindRefusal = workshop.setKind(kind) ? null : workshop.heroesSetBlockedBy();
  }

  async function pickBoxArt(event: Event & { currentTarget: HTMLInputElement }): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    error = null;
    try {
      const source = await readArtworkFile(file);
      set.boxArt.source = source;
      set.boxArt.label = file.name;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not read that file.';
    }
  }
</script>

<div class="page scroll-y">
  <header class="head">
    <span class="eyebrow">Set tool</span>
    <h1 class="title">Settings</h1>
  </header>

  <div class="panels">
    <!--
      First on the page, because it is the setting that changes the most: which
      sections the workspace draws at all, and what the set is measured against
      on Home. Two cards rather than a dropdown — each says in full what it
      means, where a menu would make the author pick a word and find out later.
    -->
    <EditorSection
      title="What kind of set is this?"
      hint="Changes which sections you see. Nothing you have made is deleted either way."
    >
      <div class="kinds">
        {#each SET_KINDS as kind (kind)}
          {@const meta = SET_KIND_META[kind]}
          {@const chosen = set.kind === kind}
          {@const blocked = kind === 'heroes' && heroesBlocked !== null && !chosen}
          <button
            type="button"
            class="kind"
            class:chosen
            class:blocked
            aria-pressed={chosen}
            onclick={() => chooseKind(kind)}
          >
            <span class="kind-head">
              <Icon name={meta.icon as IconName} size={15} />
              <span class="kind-label">{meta.label}</span>
              {#if chosen}<span class="kind-current">Current</span>{/if}
            </span>
            <span class="kind-summary">{meta.summary}</span>
            <span class="kind-detail">{meta.detail}</span>
          </button>
        {/each}
      </div>

      <!--
        The refusal, spelled out. It names what is in the way and how many,
        because "that isn't allowed" leaves an author to guess which of their
        characters is the problem.
      -->
      {#if kindRefusal}
        <p class="kind-refusal" role="alert">
          <Icon name="skull" size={13} />
          <span>{kindRefusal}</span>
        </p>
      {:else if heroesBlocked && set.kind === 'adventure'}
        <p class="kind-note">{heroesBlocked}</p>
      {/if}
    </EditorSection>

    <EditorSection title="Identity">
      <label class="stack">
        <span class="field-label">Name</span>
        <TextInput bind:value={set.name} placeholder="Name this adventure" prominent />
      </label>

      <label class="stack">
        <span class="field-label">Subtitle</span>
        <TextInput bind:value={set.subtitle} placeholder="e.g. A three-act descent" />
      </label>

      <label class="stack">
        <span class="field-label">Description</span>
        <TextArea
          bind:value={set.meta.description}
          rows={3}
          placeholder="What happens in this adventure?"
        />
      </label>
    </EditorSection>

    <EditorSection title="Publication" columns={2}>
      <label class="stack">
        <span class="field-label">Author</span>
        <TextInput bind:value={set.meta.author} placeholder="Your name" />
      </label>

      <label class="stack">
        <span class="field-label">Version</span>
        <TextInput bind:value={set.meta.version} placeholder="0.1.0" />
      </label>
    </EditorSection>

    <EditorSection title="Box art" hint="Shown on the set's home page and in the library.">
      {#snippet actions()}
        {#if hasArtwork(set.boxArt)}
          <Button
            size="sm"
            variant="ghost"
            onclick={() => {
              set.boxArt.source = null;
              set.boxArt.label = '';
            }}
          >
            Remove
          </Button>
        {/if}
      {/snippet}

      <input
        bind:this={boxInput}
        class="sr-only"
        type="file"
        accept="image/*"
        onchange={pickBoxArt}
      />

      <div class="box-row">
        <button
          type="button"
          class="box-thumb"
          class:empty={!hasArtwork(set.boxArt)}
          onclick={() => boxInput?.click()}
        >
          {#if hasArtwork(set.boxArt) && set.boxArt.source}
            <img src={set.boxArt.source} alt="" />
          {:else}
            <Icon name="image" size={18} />
          {/if}
        </button>

        <div class="box-text">
          <span class="filename">{set.boxArt.label || 'No box art'}</span>
          <span class="sub">Embedded in the set file.</span>
          {#if error}<span class="error">{error}</span>{/if}
        </div>

        <Button size="sm" onclick={() => boxInput?.click()}>
          <Icon name="upload" size={13} />
          {hasArtwork(set.boxArt) ? 'Replace' : 'Choose'}
        </Button>
      </div>
    </EditorSection>

    <!--
      The initiative deck's back, which is the set's rather than a character's:
      the deck belongs to the adventure and every card in it shows the same
      reverse. A character's own deck back is edited on the character.
    -->
    <ReplacementPanel
      artwork={set.initiativeBack}
      enabled={set.useInitiativeBack}
      title="Initiative deck back"
      hint="One image, printed on the back of every initiative card."
      replaces="Replaces the printed initiative back."
      onpick={(source, label) => {
        set.initiativeBack.source = source;
        set.initiativeBack.label = label;
        set.useInitiativeBack = true;
      }}
      ontoggle={(use) => (set.useInitiativeBack = use)}
      onclear={() => {
        set.initiativeBack.source = null;
        set.initiativeBack.label = '';
        set.useInitiativeBack = false;
      }}
    />

    <!--
      Card styling belongs to the deck, not the set, so it is edited where the
      cards are. Duplicating and deleting a set live on the Library, next to
      the rest of the set list.
    -->
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

  /*
   * Two cards side by side, wrapping rather than shrinking: each carries a
   * paragraph, and two narrow columns of prose are harder to compare than two
   * stacked ones.
   */
  .kinds {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  .kind {
    flex: 1 1 260px;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: var(--surface-inset);
    color: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      border-color var(--duration-fast) var(--ease-out),
      background var(--duration-fast) var(--ease-out);
  }

  .kind:hover:not(.chosen) {
    border-color: var(--border-strong);
  }

  .kind.chosen {
    border-color: var(--accent);
    background: var(--surface-raised);
  }

  /*
   * Dimmed, not `disabled`. A disabled button explains nothing and cannot be
   * clicked to find out why — this one stays clickable precisely so pressing
   * it produces the sentence saying what is in the way.
   */
  .kind.blocked {
    opacity: 0.55;
  }

  .kind-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .kind-label {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
  }

  .kind-current {
    margin-left: auto;
    padding: 1px var(--space-2);
    border-radius: var(--radius-full);
    background: var(--accent);
    color: var(--grey-1000, #10100f);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
  }

  .kind-summary {
    font-size: var(--text-sm);
    color: var(--text-default);
  }

  .kind-detail,
  .kind-note {
    font-size: var(--text-xs);
    line-height: var(--leading-relaxed, 1.6);
    color: var(--text-muted);
  }

  .kind-note {
    margin-top: var(--space-3);
  }

  .kind-refusal {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin-top: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--danger);
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    line-height: var(--leading-relaxed, 1.6);
    color: var(--text-default);
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

  .panels {
    display: flex;
    flex-direction: column;
    gap: var(--space-7);
    max-width: 760px;
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

  .box-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
  }

  .box-thumb {
    display: grid;
    place-items: center;
    width: 72px;
    height: 96px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--surface-inset);
    border: 1px solid var(--border-default);
    color: var(--text-muted);
  }

  .box-thumb.empty {
    border-style: dashed;
  }

  .box-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .box-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .filename {
    font-size: var(--text-sm);
    color: var(--text-secondary);
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
